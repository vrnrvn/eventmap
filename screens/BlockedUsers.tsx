import { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UserRoundX } from '@/components/icons.generated';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { OfflineState } from '@/components/ui/QueryStates';
import { useConnectivity } from '@/services/connectivity';
import { Avatar } from '@/components/Avatar';
import { socialService, BlockingUnavailableError } from '@/services/social';
import { confirmAction } from '@/utils/confirm';
import { notify } from '@/utils/notify';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';

type BlockedUser = { id: string; name: string; avatar_url: string | null };

/**
 * Everyone the signed-in user has blocked, with unblock. Previously the only
 * way to unblock was to find the person's profile again — impossible if it
 * was private or you couldn't remember the name.
 */
export default function BlockedUsers() {
  const connectivity = useConnectivity();
  const insets = useSafeAreaInsets();
  const [users, setUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Set once the list has loaded; a failed quiet refresh then keeps it.
  const hasLoadedRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setUsers(await socialService.getBlockedUsers());
      setError(null);
      hasLoadedRef.current = true;
    } catch (err) {
      if (silent && hasLoadedRef.current) {
        notify.backgroundError("Couldn't refresh your blocked list.");
        return;
      }
      setError(
        err instanceof BlockingUnavailableError
          ? "Blocking isn't enabled on this server yet."
          : "Couldn't load your blocked list."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load])
  );

  const handleUnblock = useCallback(
    async (user: BlockedUser) => {
      const ok = await confirmAction({
        title: `Unblock ${user.name}?`,
        message: "You'll see their messages and content again.",
        confirmLabel: 'Unblock',
      });
      if (!ok) return;
      setBusyId(user.id);
      const previous = users;
      setUsers((prev) => prev.filter((row) => row.id !== user.id));
      try {
        await socialService.unblockUser(user.id);
        notify.success(`${user.name} unblocked.`);
      } catch {
        setUsers(previous);
        notify.error("Couldn't unblock. Please try again.");
      } finally {
        setBusyId(null);
      }
    },
    [users]
  );

  const renderItem = useCallback(
    ({ item }: { item: BlockedUser }) => (
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.rowMain}
          onPress={() => router.push(`/user/${item.id}` as never)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`View ${item.name}'s profile`}
        >
          <Avatar imageUrl={item.avatar_url} name={item.name} size={44} />
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.unblockBtn}
          onPress={() => void handleUnblock(item)}
          disabled={busyId === item.id}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Unblock ${item.name}`}
        >
          <Text style={styles.unblockText}>
            {busyId === item.id ? 'Working…' : 'Unblock'}
          </Text>
        </TouchableOpacity>
      </View>
    ),
    [busyId, handleUnblock]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScreenHeader title="Blocked users" onBack={() => router.back()} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : error && connectivity === 'offline' ? (
        <OfflineState onRetry={() => void load()} style={styles.center} />
      ) : error ? (
        <ErrorState title={error} onRetry={() => void load()} style={styles.center} />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            users.length === 0 && styles.listContentEmpty,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(true);
              }}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <UserRoundX size={28} color={Colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>No one blocked</Text>
              <Text style={styles.emptyText}>
                Blocking someone hides their chat messages from you. You can block a person from
                their profile or from a chat message.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minWidth: 0,
  },
  name: {
    flex: 1,
    fontSize: Typography.sizes.md,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  unblockBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  unblockText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  empty: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  emptyTitle: {
    fontSize: Typography.sizes.lg,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
    color: Colors.text.secondary,
    fontFamily: Typography.fontFamilies.regular,
  },
});
