import type { ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { CalendarDays } from 'lucide-react-native';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';

export type EventListItemBadge = {
  label: string;
  /** Visual tone of the badge. */
  tone?: 'danger' | 'success' | 'primary' | 'neutral';
};

type EventListItemProps = {
  title: string;
  /** Pre-formatted date line; use formatEventDate() for consistency. */
  dateLine: string;
  /** Secondary line under the title (e.g. business name). */
  subtitle?: string;
  thumbnailUrl?: string | null;
  /** Optional status badge rendered next to the title (e.g. Cancelled, LIVE). */
  badge?: EventListItemBadge | null;
  /** Extra inline element after the badge (e.g. unread chat pill). */
  titleAccessory?: ReactNode;
  /** Right-side accessory: chevron, bookmark button, etc. */
  rightAccessory?: ReactNode;
  /** Optional action row rendered under the content (e.g. Edit / Cancel). */
  actions?: ReactNode;
  /** Icon shown next to the date line; defaults to a calendar. */
  dateIcon?: ReactNode;
  /** Extra plain-text meta lines rendered under the date line. */
  metaLines?: string[];
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Dims the row (e.g. past/ended events). */
  dimmed?: boolean;
  testID?: string;
};

const badgeTones = {
  danger: { bg: Colors.errorSoft, fg: Colors.error },
  success: { bg: Colors.success, fg: Colors.text.inverse },
  primary: { bg: Colors.primarySoft, fg: Colors.primary },
  neutral: { bg: Colors.background.secondary, fg: Colors.text.tertiary },
} as const;

/** Shared date formatting for event list rows (device locale). */
export function formatEventDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Unified event row used by MyEvents, SavedEvents and JoinedEvents.
 * Thumbnail + title + date line, with per-screen badges, right accessory
 * (chevron / action icon) and an optional footer actions row.
 */
export function EventListItem({
  title,
  dateLine,
  subtitle,
  thumbnailUrl,
  badge,
  titleAccessory,
  rightAccessory,
  actions,
  dateIcon,
  metaLines,
  onPress,
  accessibilityLabel,
  dimmed = false,
  testID,
}: EventListItemProps) {
  const tone = badgeTones[badge?.tone ?? 'neutral'];
  return (
    <TouchableOpacity
      style={[styles.card, dimmed && styles.cardDimmed]}
      activeOpacity={0.85}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${title}, ${dateLine}`}
      testID={testID}
    >
      <View style={styles.mainRow}>
        {thumbnailUrl ? (
          <Image source={{ uri: thumbnailUrl }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <CalendarDays size={22} color={Colors.primary} />
          </View>
        )}
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            {badge ? (
              <View style={[styles.badge, { backgroundColor: tone.bg }]}>
                <Text style={[styles.badgeText, { color: tone.fg }]}>{badge.label}</Text>
              </View>
            ) : null}
            {titleAccessory}
          </View>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          <View style={styles.metaRow}>
            {dateIcon ?? <CalendarDays size={12} color={Colors.text.tertiary} />}
            <Text style={styles.metaText} numberOfLines={1}>
              {dateLine}
            </Text>
          </View>
          {metaLines?.map((line, index) => (
            <Text key={`${index}-${line}`} style={[styles.metaText, styles.extraMeta]} numberOfLines={1}>
              {line}
            </Text>
          ))}
        </View>
        {rightAccessory ? <View style={styles.right}>{rightAccessory}</View> : null}
      </View>
      {actions ? <View style={styles.actionsRow}>{actions}</View> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.background.primary,
    borderRadius: BorderRadius.md + 4,
    borderWidth: 1,
    borderColor: Colors.border.light,
    padding: Spacing.sm + 4,
    minHeight: 44,
  },
  cardDimmed: {
    opacity: 0.72,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 4,
  },
  thumb: {
    width: 58,
    height: 58,
    borderRadius: BorderRadius.md + 2,
  },
  thumbPlaceholder: {
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    flexShrink: 1,
    color: Colors.text.primary,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  badgeText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    fontWeight: Typography.weights.semibold,
  },
  subtitle: {
    marginTop: 2,
    color: Colors.text.secondary,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  metaRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    flexShrink: 1,
    color: Colors.text.tertiary,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.medium,
  },
  extraMeta: {
    marginTop: 4,
    marginLeft: 17,
  },
  right: {
    marginLeft: Spacing.xs,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.sm + 2,
    marginTop: Spacing.sm + 4,
    paddingTop: Spacing.sm + 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border.light,
  },
});
