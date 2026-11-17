import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusOnOpen } from '@/hooks/useFocusOnOpen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarX, Clock, ExternalLink, RotateCcw, X } from '@/components/icons.generated';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { BorderRadius, Colors, Shadows, Spacing, Typography } from '@/constants/theme';
import type { AgendaEntry, DateAction } from '@/utils/hostDashboard';

/**
 * One string per row, used for both the visible text and the accessible name
 * so they can never drift apart (WCAG 2.5.3 Label in Name — voice control
 * users say what they see).
 */
export const LABELS = {
  move: 'Change this date’s time',
  skip: 'Skip this date',
  restore: 'Restore the original date',
  manage: 'Open Manage event',
} as const;

type Props = {
  entry: AgendaEntry | null;
  /** What this date allows (utils/hostDashboard dateActionsFor). */
  actions: readonly DateAction[];
  /** "Thu 19 Nov, 7:00 pm" for the sheet's subtitle. */
  when: string;
  onClose: () => void;
  onMove: () => void;
  onSkip: () => void;
  onRestore: () => void;
  onOpenManage: () => void;
};

/**
 * Bottom sheet behind a series row's "Date options" button on the host
 * dashboard (docs/HOST_DASHBOARD_PLAN.md C5): change this date's time, skip
 * it, or restore it — the same operations Manage event's "Upcoming dates"
 * offers, run through the same hook (hooks/useOccurrenceActions).
 */
export function AgendaDateActionsSheet({ entry, actions, when, onClose, onMove, onSkip, onRestore, onOpenManage }: Props) {
  const insets = useSafeAreaInsets();
  // Move focus into the sheet when it opens (hooks/useFocusOnOpen).
  const firstAction = useFocusOnOpen(!!entry);
  if (!entry) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <ModalBackdrop onPress={onClose} label="Close date options" style={styles.backdrop} />
      <View
        style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.md }]}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        accessibilityLabel={`Options for ${entry.title}, ${when}`}
        testID="agenda-date-actions"
      >
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {entry.title}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {when}
              {entry.status === 'cancelled' ? ' · skipped' : entry.status === 'moved' ? ' · moved' : ''}
            </Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
            <X size={20} color={Colors.text.secondary} />
          </Pressable>
        </View>

        {actions.includes('move') && (
          <Pressable ref={actions[0] === 'move' ? firstAction : undefined} style={styles.row} onPress={onMove} accessibilityRole="button" accessibilityLabel={LABELS.move}>
            <Clock size={18} color={Colors.primary} />
            <Text style={styles.rowText}>{LABELS.move}</Text>
          </Pressable>
        )}
        {actions.includes('skip') && (
          <Pressable ref={actions[0] === 'skip' ? firstAction : undefined} style={styles.row} onPress={onSkip} accessibilityRole="button" accessibilityLabel={LABELS.skip}>
            <CalendarX size={18} color={Colors.error} />
            <Text style={[styles.rowText, styles.rowTextDanger]}>{LABELS.skip}</Text>
          </Pressable>
        )}
        {actions.includes('restore') && (
          <Pressable ref={actions[0] === 'restore' ? firstAction : undefined} style={styles.row} onPress={onRestore} accessibilityRole="button" accessibilityLabel={LABELS.restore}>
            <RotateCcw size={18} color={Colors.primary} />
            <Text style={styles.rowText}>{LABELS.restore}</Text>
          </Pressable>
        )}
        <Pressable ref={actions.length === 0 ? firstAction : undefined} style={styles.row} onPress={onOpenManage} accessibilityRole="button" accessibilityLabel={LABELS.manage}>
          <ExternalLink size={18} color={Colors.text.secondary} />
          <Text style={styles.rowText}>{LABELS.manage}</Text>
        </Pressable>
        <Text style={styles.note}>Changes affect this date only. Attendees can be told in the next step.</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: Colors.overlay.dark },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    ...Shadows.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border.light,
    marginBottom: Spacing.sm,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xs },
  headerText: { flex: 1, minWidth: 0 },
  title: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  subtitle: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.secondary, marginTop: 2 },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48, paddingVertical: Spacing.sm },
  rowText: { fontSize: Typography.sizes.md, fontFamily: Typography.fontFamilies.semibold, color: Colors.text.primary },
  rowTextDanger: { color: Colors.error },
  note: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    paddingTop: Spacing.sm,
  },
});
