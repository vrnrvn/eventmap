import { memo } from 'react';
import { cadenceLabel } from '@/utils/recurrence';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { MapPin, Bookmark, Check } from '@/components/icons.generated';
import { Avatar } from '@/components/Avatar';
import { EventCardCarousel } from '@/components/EventCardCarousel';
import type { RankedEvent } from '@/types/database';
import { Colors, FontScaleCaps, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { formatDistance, formatEventDate, formatEventDayLabel } from '@/utils/formatEventWhen';
import { a11yState } from '@/utils/accessibility';

type Props = {
  item: RankedEvent;
  /** Next occurrence for recurring events; the scheduled start otherwise. */
  displayDate: string;
  width: number;
  index: number;
  onPress: (eventId: string) => void;
  onBusinessPress: (businessId: string) => void;
  /**
   * Save / unsave from the card (review J8). Undefined hides the control
   * (signed-out Discover still shows the saved glyph through `user_saved`).
   */
  onToggleSave?: (item: RankedEvent) => void;
  /**
   * Compare (decision D6): long-press adds or removes the event; the same is
   * offered as a custom accessibility action, since a long-press is not
   * discoverable to a screen reader.
   */
  onLongPress?: (item: RankedEvent) => void;
  compareSelected?: boolean;
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
 *
 * Layout: the image and copy are one press area that opens the event; the
 * footer (host, going count, bookmark) sits *beside* it, not inside, so each
 * control is its own element for a screen reader — the same split
 * `EventListItem` uses. The card used to be one Touchable with the host
 * button nested inside and exposed as a custom action.
 */
export const DiscoverEventCard = memo(function DiscoverEventCard({
  item,
  displayDate,
  width,
  index,
  onPress,
  onBusinessPress,
  onToggleSave,
  onLongPress,
  compareSelected = false,
}: Props) {
  const dateLine = formatEventDate(displayDate);
  const distance = formatDistance(item.distance_km);
  const spotsLeft =
    item.max_attendees != null ? Math.max(0, item.max_attendees - item.rsvp_count) : null;
  const saved = !!item.user_saved;

  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, STAGGER_MAX_INDEX) * STAGGER_STEP_MS)
        .springify()
        .damping(18)}
      style={styles.wrapper}
    >
      <View style={styles.card}>
        <TouchableOpacity
          onPress={() => onPress(item.id)}
          onLongPress={onLongPress ? () => onLongPress(item) : undefined}
          delayLongPress={350}
          activeOpacity={0.92}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}, ${dateLine}${distance ? `, ${distance}` : ''}${
            item.user_rsvp === 'going' ? ', you are going' : ''
          }${saved ? ', saved' : ''}${compareSelected ? ', selected for comparison' : ''}, by ${item.business_name}`}
          accessibilityHint={onLongPress ? 'Opens event details. Long press to compare' : 'Opens event details'}
          accessibilityActions={
            onLongPress
              ? [{ name: 'toggleCompare', label: compareSelected ? 'Remove from comparison' : 'Add to comparison' }]
              : undefined
          }
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'toggleCompare') onLongPress?.(item);
          }}
        >
          <EventCardCarousel
            imageUrls={item.cover_image_url ? [item.cover_image_url] : []}
            width={width}
          />
          {compareSelected ? (
            <View style={styles.compareBadge} importantForAccessibility="no">
              <Check size={14} color={Colors.white} strokeWidth={3} />
              <Text style={styles.compareBadgeText} maxFontSizeMultiplier={FontScaleCaps.control}>COMPARING</Text>
            </View>
          ) : null}
          <View style={styles.content}>
            <Text style={styles.title} numberOfLines={2} maxFontSizeMultiplier={FontScaleCaps.cell}>
              {item.title}
            </Text>
            <View style={styles.metaRow}>
              <MapPin size={14} color={Colors.text.tertiary} />
              {distance ? (
                <>
                  <Text style={styles.metaText} maxFontSizeMultiplier={FontScaleCaps.control}>{distance}</Text>
                  <Text style={styles.metaDot}>•</Text>
                </>
              ) : null}
              <Text style={styles.metaText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCaps.control}>
                {dateLine}
              </Text>
            </View>
            <View style={styles.badgeRow}>
              <View style={styles.badgeLight}>
                <Text style={styles.badgeLightText} maxFontSizeMultiplier={FontScaleCaps.control}>
                  {formatEventDayLabel(displayDate).toUpperCase()}
                </Text>
              </View>
              <View style={styles.badgeDark}>
                <Text style={styles.badgeDarkText} maxFontSizeMultiplier={FontScaleCaps.control}>
                  {item.category_label.toUpperCase()}
                </Text>
              </View>
              {item.is_recurring && item.recurrence_pattern ? (
                <View style={styles.badgeLight} accessibilityLabel={`Repeats ${cadenceLabel(item.recurrence_pattern).toLowerCase()}`}>
                  <Text style={styles.badgeLightText} maxFontSizeMultiplier={FontScaleCaps.control}>
                    {cadenceLabel(item.recurrence_pattern).toUpperCase()}
                  </Text>
                </View>
              ) : null}
              {item.user_rsvp === 'going' ? (
                <View style={styles.badgeGoing}>
                  <Text style={styles.badgeGoingText} maxFontSizeMultiplier={FontScaleCaps.control}>GOING</Text>
                </View>
              ) : spotsLeft != null && spotsLeft <= 5 ? (
                // Only surfaced when it changes a decision: nearly full or full.
                <View style={[styles.badgeLight, spotsLeft === 0 && styles.badgeFull]}>
                  <Text
                    style={[styles.badgeLightText, spotsLeft === 0 && styles.badgeFullText]}
                    maxFontSizeMultiplier={FontScaleCaps.control}
                  >
                    {spotsLeft === 0 ? 'FULL' : `${spotsLeft} LEFT`}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>

        {/* Footer: its own elements, outside the press area. */}
        <View style={styles.footerRow}>
          <TouchableOpacity
            style={styles.businessRow}
            onPress={() => onBusinessPress(item.business_id)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`View ${item.business_name}`}
          >
            <Avatar imageUrl={item.business_logo_url} name={item.business_name} size={24} />
            <Text style={styles.businessName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCaps.control}>
              {item.business_name}
            </Text>
          </TouchableOpacity>
          {item.rsvp_count > 0 ? (
            <Text style={styles.goingCount} maxFontSizeMultiplier={FontScaleCaps.control}>
              {item.rsvp_count} going
            </Text>
          ) : null}
          {onToggleSave ? (
            <TouchableOpacity
              style={[styles.saveBtn, saved && styles.saveBtnOn]}
              onPress={() => onToggleSave(item)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={saved ? `Remove ${item.title} from saved events` : `Save ${item.title}`}
              {...a11yState({ selected: saved }, 'button')}
            >
              <Bookmark size={18} color={Colors.primary} fill={saved ? Colors.primary : 'transparent'} />
            </TouchableOpacity>
          ) : saved ? (
            <View style={styles.saveBtn} accessibilityLabel="Saved event">
              <Bookmark size={18} color={Colors.primary} fill={Colors.primary} />
            </View>
          ) : null}
        </View>
      </View>
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
    paddingHorizontal: Spacing.sm + 2,
    paddingTop: Spacing.sm + 2,
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
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
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
    // 0.45 gave white text ~3.4:1 on the light card (axe, WCAG 1.4.3 needs
    // 4.5:1 at this size); 0.62 is ~5.5:1 and keeps the same look.
    backgroundColor: 'rgba(0,0,0,0.62)',
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
    // successText, not success: the lighter green failed AA as text (ISSUES).
    color: Colors.successText,
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
  compareBadge: {
    position: 'absolute',
    top: Spacing.sm + 2,
    right: Spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
  },
  compareBadgeText: {
    color: Colors.white,
    fontSize: Typography.sizes.xxs,
    letterSpacing: 1.5,
    fontFamily: Typography.labelFontFamilies.semibold,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm + 2,
    paddingBottom: Spacing.xs,
  },
  businessRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minWidth: 0,
    minHeight: 44,
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
  saveBtn: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnOn: {
    backgroundColor: Colors.primarySoft,
  },
});
