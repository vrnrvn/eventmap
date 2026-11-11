import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from '@/components/icons.generated';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { Button } from '@/components/ui/Button';
import { DiscoverEventCard } from '@/components/DiscoverEventCard';
import { describeEventTime } from '@/utils/timezone';
import type { RankedEvent } from '@/types/database';

/**
 * "This is what people will see" step before publishing
 * (HOST_ONBOARDING_PLAN.md §11.2 step 3). Renders the real Discover card from
 * the unsaved form, so the preview cannot drift from the live list.
 *
 * Skippable: Publish and Save draft are both available here, and the host can
 * go back to editing.
 */
export function EventPreviewSheet({
  visible,
  event,
  gaps,
  publishing,
  savingDraft,
  onClose,
  onPublish,
  onSaveDraft,
}: {
  visible: boolean;
  /** Null while the form has nothing worth previewing. */
  event: RankedEvent | null;
  /** Things the host has not filled in yet; hints, not validation. */
  gaps: readonly string[];
  publishing: boolean;
  savingDraft: boolean;
  onClose: () => void;
  onPublish: () => void;
  onSaveDraft: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  if (!event) return null;
  const cardWidth = Math.min(width - Spacing.md * 2, 420);
  const when = describeEventTime(event.start_datetime, event.timezone ?? null);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Tap-outside-to-close for pointer users; screen readers and keyboards
          use the Close button, so the backdrop is hidden from them. */}
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessible={false}
        focusable={false}
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      />
      <View
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
      >
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Preview
          </Text>
          <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close preview">
            <X size={20} color={Colors.text.secondary} />
          </Pressable>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.caption}>How your event appears on Discover</Text>
          <View style={styles.cardWrap} pointerEvents="none" accessibilityElementsHidden={false}>
            <DiscoverEventCard
              item={event}
              index={0}
              width={cardWidth}
              displayDate={event.start_datetime}
              onPress={() => {}}
              onBusinessPress={() => {}}
            />
          </View>

          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>When attendees see</Text>
            <Text style={styles.detailValue}>{when.primary}</Text>
            {when.secondary ? <Text style={styles.detailHint}>{when.secondary}</Text> : null}
            <Text style={[styles.detailLabel, styles.spaced]}>Where</Text>
            <Text style={styles.detailValue}>{event.address || 'No place set yet'}</Text>
            {event.max_attendees != null ? (
              <>
                <Text style={[styles.detailLabel, styles.spaced]}>Capacity</Text>
                <Text style={styles.detailValue}>{event.max_attendees} going</Text>
              </>
            ) : null}
            {event.price_label ? (
              <>
                <Text style={[styles.detailLabel, styles.spaced]}>Price</Text>
                <Text style={styles.detailValue}>{event.price_label}</Text>
              </>
            ) : null}
          </View>

          {gaps.length > 0 ? (
            <Text style={styles.gaps}>
              Still missing: {gaps.join(', ')}. You can publish without them, but the event is easier to find with
              them.
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          <Button label="Publish" onPress={onPublish} loading={publishing} size="lg" fullWidth gradient />
          <Button
            label="Save as Draft"
            onPress={onSaveDraft}
            loading={savingDraft}
            variant="secondary"
            size="lg"
            fullWidth
          />
          <Button label="Keep Editing" onPress={onClose} variant="ghost" size="md" fullWidth />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // 44 px box: hitSlop does not enlarge the target on web.
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  scroll: { flexShrink: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Phones fill the width; on tablets / desktop web the sheet stays a
    // readable column instead of a 1,200 px wide button.
    width: '100%',
    maxWidth: 560,
    marginHorizontal: 'auto',
    maxHeight: '92%',
    backgroundColor: Colors.background.primary,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    ...Shadows.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.displayFontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  body: { paddingBottom: 12, gap: 12 },
  caption: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.tertiary },
  cardWrap: { alignItems: 'center' },
  detailCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: 14 },
  detailLabel: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    marginTop: 2,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
  },
  detailHint: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.secondary },
  spaced: { marginTop: 10 },
  gaps: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.secondary, lineHeight: 19 },
  actions: { gap: 8, paddingTop: 8, flexShrink: 0 },
});
