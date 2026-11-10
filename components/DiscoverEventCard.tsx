import { memo } from 'react';
import { cadenceLabel } from '@/utils/recurrence';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { MapPin, BookmarkCheck } from '@/components/icons.generated';
import { Avatar } from '@/components/Avatar';
import { EventCardCarousel } from '@/components/EventCardCarousel';
import type { RankedEvent } from '@/types/database';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { formatDistance, formatEventDate, formatEventDayLabel } from '@/utils/formatEventWhen';

type Props = {
  item: RankedEvent;
  /** Next occurrence for recurring events; the scheduled start otherwise. */
  displayDate: string;
  width: number;
  index: number;
  onPress: (eventId: string) => void;
  onBusinessPress: (businessId: string) => void;
};

/**
 * Entrance stagger is capped: FlatList mounts rows lazily, so an unbounded
 * `index * 60` left a second-page card blank for 3–6 seconds after it scrolled
 * into view. Only the first screenful cascades; later rows appear at once.
 */
const STAGGER_MAX_INDEX = 6;
const STAGGER_STEP_MS = 60;

/**
 * Discover list card. Memoised so map pans (which update screen state on every
 * moveend) don't re-render every mounted card. Props are primitives plus
 * stable callbacks; `item` identity only changes when the events array does.
 */
export const DiscoverEventCard = memo(function DiscoverEventCard({
  item,
  displayDate,
  width,
  index,
  onPress,
  onBusinessPress,
}: Props) {
  const dateLine = formatEventDate(displayDate);
  const distance = formatDistance(item.distance_km);
  const spotsLeft =
    item.max_attendees != null ? Math.max(0, item.max_attendees - item.rsvp_count) : null;

  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, STAGGER_MAX_INDEX) * STAGGER_STEP_MS)
        .springify()
        .damping(18)}
      style={styles.wrapper}
    >
      <TouchableOpacity
        style={styles.card}
        onPress={() => onPress(item.id)}
        activeOpacity={0.92}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${dateLine}${distance ? `, ${distance}` : ''}${
          item.user_rsvp === 'going' ? ', you are going' : ''
        }${item.user_saved ? ', saved' : ''}, by ${item.business_name}`}
        // The business button below is nested in this card, which VoiceOver
        // reads as one element; expose it as a custom action instead.
        accessibilityHint="Opens event details"
        accessibilityActions={[{ name: 'viewBusiness', label: `View ${item.business_name}` }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'viewBusiness') onBusinessPress(item.business_id);
        }}
      >
        <EventCardCarousel
          imageUrls={item.cover_image_url ? [item.cover_image_url] : []}
          width={width}
        />
        <View style={styles.content}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          <View style={styles.metaRow}>
            <MapPin size={14} color={Colors.text.tertiary} />
            {distance ? (
              <>
                <Text style={styles.metaText}>{distance}</Text>
                <Text style={styles.metaDot}>•</Text>
              </>
            ) : null}
            <Text style={styles.metaText} numberOfLines={1}>
              {dateLine}
            </Text>
          </View>
          <View style={styles.badgeRow}>
            <View style={styles.badgeLight}>
              <Text style={styles.badgeLightText}>
                {formatEventDayLabel(displayDate).toUpperCase()}
              </Text>
            </View>
            <View style={styles.badgeDark}>
              <Text style={styles.badgeDarkText}>{item.category_label.toUpperCase()}</Text>
            </View>
            {item.is_recurring && item.recurrence_pattern ? (
              <View style={styles.badgeLight} accessibilityLabel={`Repeats ${cadenceLabel(item.recurrence_pattern).toLowerCase()}`}>
                <Text style={styles.badgeLightText}>{cadenceLabel(item.recurrence_pattern).toUpperCase()}</Text>
              </View>
            ) : null}
            {item.user_rsvp === 'going' ? (
              <View style={styles.badgeGoing}>
                <Text style={styles.badgeGoingText}>GOING</Text>
              </View>
            ) : spotsLeft != null && spotsLeft <= 5 ? (
              // Only surfaced when it changes a decision: nearly full or full.
              <View style={[styles.badgeLight, spotsLeft === 0 && styles.badgeFull]}>
                <Text style={[styles.badgeLightText, spotsLeft === 0 && styles.badgeFullText]}>
                  {spotsLeft === 0 ? 'FULL' : `${spotsLeft} LEFT`}
                </Text>
              </View>
            ) : null}
            {item.user_saved ? (
              <View style={styles.savedGlyph} accessibilityLabel="Saved event">
                <BookmarkCheck size={14} color={Colors.primary} />
              </View>
            ) : null}
          </View>
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={styles.businessRow}
              onPress={() => onBusinessPress(item.business_id)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`View ${item.business_name}`}
            >
              <Avatar imageUrl={item.business_logo_url} name={item.business_name} size={24} />
              <Text style={styles.businessName} numberOfLines={1}>
                {item.business_name}
              </Text>
            </TouchableOpacity>
            {item.rsvp_count > 0 ? (
              <Text style={styles.goingCount}>
                {item.rsvp_count} going
              </Text>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 18,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xxl,
    overflow: 'hidden',
    borderWidth: 0,
    ...Shadows.sm,
  },
  content: {
    padding: Spacing.sm + 2,
  },
  title: {
    fontSize: Typography.sizes.xl,
    lineHeight: 28,
    fontFamily: Typography.displayFontFamilies.extrabold,
    fontWeight: '800',
    color: Colors.text.primary,
    letterSpacing: -0.2,
    marginBottom: Spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.sm + 2,
  },
  metaText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.secondary,
  },
  metaDot: {
    color: Colors.text.tertiary,
    marginHorizontal: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm + 2,
  },
  badgeLight: {
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: Spacing.md - 2,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
  },
  badgeLightText: {
    color: Colors.primary,
    fontSize: Typography.sizes.xxs,
    letterSpacing: 2,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  badgeDark: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: Spacing.md - 2,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
  },
  badgeDarkText: {
    color: '#FFFFFF',
    fontSize: Typography.sizes.xxs,
    letterSpacing: 2,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  badgeGoing: {
    backgroundColor: Colors.successSoft,
    paddingHorizontal: Spacing.md - 2,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
  },
  badgeGoingText: {
    color: Colors.success,
    fontSize: Typography.sizes.xxs,
    letterSpacing: 2,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  badgeFull: {
    backgroundColor: Colors.errorSoft,
  },
  badgeFullText: {
    color: Colors.error,
  },
  savedGlyph: {
    alignSelf: 'center',
    marginLeft: 'auto',
    paddingHorizontal: Spacing.xs,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: 2,
  },
  businessRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minWidth: 0,
  },
  businessName: {
    flex: 1,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.secondary,
  },
  goingCount: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.semibold,
    color: Colors.text.secondary,
  },
});
