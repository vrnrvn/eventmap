import type { ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { CalendarDays } from '@/components/icons.generated';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { useImageFallback } from '@/hooks/useImageFallback';

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
  /**
   * Right-side decoration inside the tappable row (chevron, source tag).
   * Must not be interactive — use `rightAction` for buttons.
   */
  rightAccessory?: ReactNode;
  /**
   * Right-side button (e.g. remove from saved). Rendered outside the row's
   * tappable area so screen readers can reach it on its own.
   */
  rightAction?: ReactNode;
  /**
   * Optional action row rendered under the content (e.g. Edit / Cancel).
   * Rendered outside the tappable area so each button stays reachable.
   */
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
  success: { bg: Colors.successSoft, fg: Colors.successText },
  primary: { bg: Colors.primarySoft, fg: Colors.primary },
  neutral: { bg: Colors.background.secondary, fg: Colors.text.tertiary },
} as const;

export { formatEventDate } from '@/utils/formatEventWhen';

/**
 * Unified event row used by MyEvents, SavedEvents and JoinedEvents.
 * Thumbnail + title + date line, with per-screen badges, right accessory
 * (chevron / action icon) and an optional footer actions row.
 *
 * Accessibility: the card is a plain View. Only the content area is one
 * button; `rightAction` and `actions` sit beside it, because on iOS a
 * Touchable becomes a single VoiceOver element and hides nested buttons.
 */
export function EventListItem({
  title,
  dateLine,
  subtitle,
  thumbnailUrl,
  badge,
  titleAccessory,
  rightAccessory,
  rightAction,
  actions,
  dateIcon,
  metaLines,
  onPress,
  accessibilityLabel,
  dimmed = false,
  testID,
}: EventListItemProps) {
  const thumb = useImageFallback(thumbnailUrl, { thumbnail: true });
  const tone = badgeTones[badge?.tone ?? 'neutral'];
  return (
    <View style={[styles.card, dimmed && styles.cardDimmed]}>
      <View style={styles.topRow}>
        <TouchableOpacity
          style={[styles.pressArea, rightAction != null && styles.pressAreaWithAction]}
          activeOpacity={0.85}
          onPress={onPress}
          disabled={!onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? `${title}, ${dateLine}`}
          testID={testID}
        >
          <View style={styles.mainRow}>
            {thumbnailUrl && !thumb.failed ? (
              <Image
                source={{ uri: thumb.src ?? undefined }}
                style={styles.thumb}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={thumb.src ?? undefined}
                transition={150}
                onError={thumb.onError}
              />
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
        </TouchableOpacity>
        {rightAction ? <View style={styles.rightAction}>{rightAction}</View> : null}
      </View>
      {actions ? <View style={styles.actionsRow}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pressArea: {
    flex: 1,
    padding: Spacing.md,
    minHeight: 44,
  },
  pressAreaWithAction: {
    paddingRight: 0,
  },
  rightAction: {
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardDimmed: {
    opacity: 0.72,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
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
    fontFamily: Typography.displayFontFamilies.bold,
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
    marginHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border.light,
  },
});
