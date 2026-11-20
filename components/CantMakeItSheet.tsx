/**
 * "Can't make it?" (docs/PLAN_B_PLAN.md §3.1 T5, decision D2 confirmed by
 * the owner 2026-11-20): for someone going to an event that is on now or
 * starts within 30 minutes. Freeing the spot is real — it leaves the RSVP
 * (a one-off) or that one date (a series), which lets the waitlist move up —
 * and the sheet's button is the confirmation. Alongside it: what else is on
 * nearby right now, so a missed plan becomes a different one.
 */
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { Button } from '@/components/ui/Button';
import { PlanBSection } from '@/components/PlanBSection';
import type { PlanBAnchor, PlanBPick } from '@/utils/planB';
import { BorderRadius, Colors, Spacing, Typography } from '@/constants/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Frees the spot; the screen applies its own guards (preview, offline, ended). */
  onFreeSpot: () => void;
  busy?: boolean;
  /** The spot is free: the choice is made, the suggestions stay. */
  freed?: boolean;
  /** A series: only this date is given up. */
  seriesDateLabel?: string | null;
  anchor: PlanBAnchor | null;
  picks: readonly PlanBPick[];
  loading: boolean;
  failed: boolean;
};

export function CantMakeItSheet({
  visible,
  onClose,
  onFreeSpot,
  busy,
  freed,
  seriesDateLabel,
  anchor,
  picks,
  loading,
  failed,
}: Props) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <ModalBackdrop onPress={busy ? () => {} : onClose} label="Close" style={styles.backdrop} />
      <View style={styles.sheet} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title} accessibilityRole="header">
            Can&apos;t make it?
          </Text>
          {freed ? (
            <>
              <Text style={styles.done} accessibilityLiveRegion="polite" accessibilityRole="alert">
                {seriesDateLabel ? `Your spot for ${seriesDateLabel} is free.` : 'Your spot is free.'} Thanks for
                letting someone else have it.
              </Text>
              <View style={styles.actions}>
                <Button label="Done" variant="ghost" onPress={onClose} />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.text}>
                {seriesDateLabel
                  ? `Free your spot for ${seriesDateLabel} only — you stay going to the other dates.`
                  : 'Free your spot so someone waiting can have it. You can join again later if there is room.'}
              </Text>
              <View style={styles.actions}>
                <Button label="Keep my spot" variant="ghost" onPress={onClose} disabled={busy} />
                <Button label={busy ? 'Freeing…' : 'Free my spot'} onPress={onFreeSpot} disabled={busy} />
              </View>
            </>
          )}

          {anchor && picks.length > 0 ? (
            <PlanBSection anchor={anchor} picks={picks} seeMoreHref="/live" compact />
          ) : (
            <View style={styles.status}>
              <Text style={styles.text} accessibilityLiveRegion="polite">
                {loading
                  ? "Looking for what's on nearby…"
                  : failed
                    ? "Couldn't load what's on nearby."
                    : 'Nothing nearby fits right now.'}
              </Text>
              {!loading ? (
                <TouchableOpacity
                  onPress={() => {
                    onClose();
                    router.push('/live' as never);
                  }}
                  accessibilityRole="link"
                  style={styles.link}
                >
                  <Text style={styles.linkText}>See what&apos;s happening now</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    top: '12%',
    maxHeight: '80%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
  },
  body: { padding: Spacing.lg, gap: Spacing.sm },
  title: { fontSize: Typography.sizes.lg, fontFamily: Typography.fontFamilies.semibold, color: Colors.text.primary },
  text: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.regular, color: Colors.text.secondary },
  done: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.medium, color: Colors.successText },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm, marginTop: Spacing.xs },
  status: { marginTop: Spacing.sm, gap: Spacing.xs },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.semibold, color: Colors.primary },
});
