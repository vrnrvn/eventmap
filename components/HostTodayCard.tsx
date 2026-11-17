import { View, Text, StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '@/contexts/AppContext';
import { useCachedHostDashboardSummary } from '@/hooks/useHostDashboard';
import { describeEventTime } from '@/utils/timezone';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { CalendarClock, ChevronRight } from '@/components/icons.generated';
import { todayCardCopy } from '@/utils/hostDashboard';

/**
 * Business-mode Profile entry to the host dashboard (DC1,
 * docs/HOST_DASHBOARD_PLAN.md). Reads only what the dashboard last cached,
 * so the Profile tab makes no extra requests; before the first visit it
 * shows a plain invitation instead of numbers.
 */
export function HostTodayCard({ style }: { style?: StyleProp<ViewStyle> }) {
  const { userBusiness } = useApp();
  const summary = useCachedHostDashboardSummary(userBusiness?.id);
  if (!userBusiness) return null;

  const { title, detail } = todayCardCopy(summary, (e) => describeEventTime(e.start, e.timezone).primary);
  return (
    <TouchableOpacity
      style={[styles.card, style]}
      onPress={() => router.push('/hosting' as never)}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Hosting schedule. ${title}. ${detail}`}
      testID="host-today-card"
    >
      <View style={styles.iconWrap}>
        <CalendarClock size={20} color={Colors.primary} />
      </View>
      <View style={styles.textCol}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
      </View>
      <ChevronRight size={18} color={Colors.text.tertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 4,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    minHeight: 64,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flex: 1, gap: 2 },
  title: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
  },
  detail: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
  },
});
