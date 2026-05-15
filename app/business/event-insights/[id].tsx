import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Eye, Heart, Users, Share2 } from 'lucide-react-native';
import { premiumService } from '@/services/premium';
import { eventsService } from '@/services/events';
import { useApp } from '@/contexts/AppContext';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';

export default function EventInsightsScreen() {
  const insets = useSafeAreaInsets();
  const { userBusiness } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [live, setLive] = useState<{ title: string; saves: number; rsvps: number } | null>(null);
  const [totals, setTotals] = useState<{
    totalViews: number;
    totalSaves: number;
    totalRsvps: number;
    shareClicks: number;
  } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const details = await eventsService.getEventDetails(id);
      if (!details) {
        setError('Event not found.');
        setLive(null);
        setTotals(null);
        return;
      }
      if (!userBusiness || details.event.business_id !== userBusiness.id) {
        setForbidden(true);
        setLive(null);
        setTotals(null);
        return;
      }
      setLive({
        title: details.event.title,
        saves: details.save_count,
        rsvps: details.rsvp_count,
      });
      const data = await premiumService.getEventAnalytics(id, 30);
      setTotals({
        totalViews: data.totalViews,
        totalSaves: data.totalSaves,
        totalRsvps: data.totalRsvps,
        shareClicks: data.shareClicks,
      });
    } catch {
      setError('Could not load insights.');
      setTotals(null);
      setLive(null);
    } finally {
      setLoading(false);
    }
  }, [id, userBusiness?.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityLabel="Back">
          <ArrowLeft size={22} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Event insights</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : forbidden ? (
        <View style={styles.center}>
          <Text style={styles.error}>Only the host business can view analytics for this event.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.retry}>
            <Text style={styles.retryText}>Go back</Text>
          </TouchableOpacity>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity onPress={load} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : totals && live ? (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.liveCard}>
            <Text style={styles.liveTitle} numberOfLines={2}>
              {live.title}
            </Text>
            <View style={styles.liveRow}>
              <View style={styles.liveStat}>
                <Heart size={20} color={Colors.error} />
                <Text style={styles.liveValue}>{live.saves}</Text>
                <Text style={styles.liveLabel}>Saves</Text>
              </View>
              <View style={styles.liveStat}>
                <Users size={20} color={Colors.secondary} />
                <Text style={styles.liveValue}>{live.rsvps}</Text>
                <Text style={styles.liveLabel}>RSVPs</Text>
              </View>
            </View>
            <Text style={styles.liveHint}>Live counts on this listing (all time).</Text>
          </View>
          <Text style={styles.sub}>
            Last 30 days (aggregated). Connect production analytics for live data.
          </Text>
          <View style={styles.grid}>
            <View style={styles.card}>
              <Eye size={22} color={Colors.primary} />
              <Text style={styles.cardValue}>{totals.totalViews.toLocaleString()}</Text>
              <Text style={styles.cardLabel}>Views</Text>
            </View>
            <View style={styles.card}>
              <Heart size={22} color={Colors.error} />
              <Text style={styles.cardValue}>{totals.totalSaves.toLocaleString()}</Text>
              <Text style={styles.cardLabel}>Saves</Text>
            </View>
            <View style={styles.card}>
              <Users size={22} color={Colors.secondary} />
              <Text style={styles.cardValue}>{totals.totalRsvps.toLocaleString()}</Text>
              <Text style={styles.cardLabel}>RSVPs</Text>
            </View>
            <View style={styles.card}>
              <Share2 size={22} color={Colors.text.secondary} />
              <Text style={styles.cardValue}>{totals.shareClicks.toLocaleString()}</Text>
              <Text style={styles.cardLabel}>Share taps</Text>
            </View>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border.light,
  },
  back: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    color: Colors.text.primary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  error: {
    color: Colors.text.secondary,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  retry: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
  },
  retryText: {
    color: Colors.text.inverse,
    fontFamily: Typography.fontFamilies.semibold,
  },
  scroll: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  liveCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.background.secondary,
    borderWidth: 1,
    borderColor: Colors.border.light,
    marginBottom: Spacing.lg,
  },
  liveTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.md,
  },
  liveRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  liveStat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  liveValue: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.displayFontFamilies.bold,
    color: Colors.text.primary,
  },
  liveLabel: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.tertiary,
  },
  liveHint: {
    marginTop: Spacing.md,
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
  },
  sub: {
    fontSize: Typography.sizes.sm,
    color: Colors.text.tertiary,
    marginBottom: Spacing.lg,
    lineHeight: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  card: {
    width: '47%',
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.background.secondary,
    borderWidth: 1,
    borderColor: Colors.border.light,
    gap: Spacing.xs,
  },
  cardValue: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.displayFontFamilies.bold,
    color: Colors.text.primary,
  },
  cardLabel: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
});
