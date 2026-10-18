import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Dimensions,
} from 'react-native';
import { BottomSheetModal, BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Search, Users } from 'lucide-react-native';
import { Avatar } from '@/components/Avatar';
import { socialService } from '@/services/social';
import { PublicAttendee } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export type AttendeesBottomSheetHandle = {
  present: () => void;
  dismiss: () => void;
};

type AttendeesBottomSheetProps = {
  eventId: string;
  rsvpCount: number;
};

export const AttendeesBottomSheet = forwardRef<
  AttendeesBottomSheetHandle,
  AttendeesBottomSheetProps
>(function AttendeesBottomSheet({ eventId, rsvpCount }, ref) {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets();
  const [attendees, setAttendees] = useState<PublicAttendee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAttendees = searchQuery.trim()
    ? attendees.filter(
        (a) =>
          a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (!a.is_anonymous && a.bio && a.bio.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : attendees;

  const loadAttendees = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await socialService.getEventAttendees(eventId);
      setAttendees(list);
    } catch (e) {
      setError('Failed to load attendees');
      setAttendees([]);
    } finally {
      setLoading(false);
    }
  };

  useImperativeHandle(ref, () => ({
    present: async () => {
      setSearchQuery('');
      await loadAttendees();
      bottomSheetRef.current?.present();
    },
    dismiss: () => bottomSheetRef.current?.dismiss(),
  }));

  const handleAttendeePress = (userId: string) => {
    bottomSheetRef.current?.dismiss();
    router.push(`/user/${userId}` as any);
  };

  const renderItem = ({ item }: { item: PublicAttendee }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => !item.is_anonymous && handleAttendeePress(item.id)}
      activeOpacity={item.is_anonymous ? 1 : 0.7}
      disabled={item.is_anonymous}
    >
      <Avatar imageUrl={item.avatar_url} name={item.name} size={44} />
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        {item.bio && !item.is_anonymous ? (
          <Text style={styles.bio}>{item.bio}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading attendees...</Text>
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      );
    }
    return (
      <View style={styles.centerState}>
        <Users size={48} color={Colors.text.tertiary} />
        <Text style={styles.emptyTitle}>No one going yet</Text>
      </View>
    );
  };

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={[SCREEN_HEIGHT - 40]}
      index={0}
      enablePanDownToClose
      enableDismissOnClose
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.background}
    >
      <View style={[styles.header, { paddingTop: insets.top || Spacing.md }]}>
        <Text style={styles.title}>Who's Going</Text>
        <View style={styles.searchRow}>
          <Search size={18} color={Colors.text.tertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search attendees..."
            placeholderTextColor={Colors.text.tertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>
      <BottomSheetFlatList
        data={filteredAttendees}
        keyExtractor={(item: PublicAttendee) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[
          styles.listContent,
          filteredAttendees.length === 0 && styles.listContentEmpty,
        ]}
      />
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  handleIndicator: {
    backgroundColor: Colors.border.medium,
  },
  background: {
    backgroundColor: Colors.background.primary,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  title: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
    paddingVertical: 0,
  },
  listContent: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.light,
  },
  rowText: {
    flex: 1,
  },
  name: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  bio: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
    marginTop: 2,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl * 2,
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: Typography.sizes.md,
    color: Colors.text.secondary,
  },
  errorText: {
    fontSize: Typography.sizes.md,
    color: Colors.error,
  },
  emptyTitle: {
    marginTop: Spacing.md,
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
    color: Colors.text.primary,
  },
  emptySubtitle: {
    marginTop: Spacing.xs,
    fontSize: Typography.sizes.sm,
    color: Colors.text.secondary,
  },
});
