import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarPlus, Pencil, Trash2, X } from '@/components/icons.generated';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { BorderRadius, Colors, Shadows, Spacing, Typography } from '@/constants/theme';
import type { Collection } from '@/types/database';

type Props = {
  target: Collection | null;
  onClose: () => void;
  onRename: (c: Collection) => void;
  onDelete: (c: Collection) => void;
  /** Phase F: export every upcoming member as one .ics. */
  onExportCalendar?: (c: Collection) => void;
};

/**
 * Bottom sheet behind a collection card's "more" button (and long-press):
 * rename and delete. Smart collections cannot be renamed here, they follow
 * their category; deleting one is how a favourited type is removed.
 */
export function CollectionActionsSheet({ target, onClose, onRename, onDelete, onExportCalendar }: Props) {
  const insets = useSafeAreaInsets();
  if (!target) return null;
  const smart = target.kind === 'smart';
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <ModalBackdrop onPress={onClose} label="Close collection options" style={styles.backdrop} />
      <View
        style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.md }]}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        accessibilityLabel={`Options for ${target.name}`}
      >
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {target.name}
          </Text>
          <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
            <X size={20} color={Colors.text.secondary} />
          </Pressable>
        </View>
        {smart ? (
          <Text style={styles.note}>This collection follows an event type, so it keeps that type’s name.</Text>
        ) : (
          <Pressable style={styles.row} onPress={() => onRename(target)} accessibilityRole="button" accessibilityLabel="Rename collection">
            <Pencil size={18} color={Colors.text.primary} />
            <Text style={styles.rowText}>Rename</Text>
          </Pressable>
        )}
        {onExportCalendar && target.upcoming_count > 0 ? (
          <Pressable
            style={styles.row}
            onPress={() => onExportCalendar(target)}
            accessibilityRole="button"
            accessibilityLabel={`Add ${target.upcoming_count} upcoming ${target.upcoming_count === 1 ? 'event' : 'events'} to calendar`}
          >
            <CalendarPlus size={18} color={Colors.text.primary} />
            <Text style={styles.rowText}>Add upcoming to calendar</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.row}
          onPress={() => onDelete(target)}
          accessibilityRole="button"
          accessibilityLabel={smart ? 'Remove favourite event type' : 'Delete collection'}
        >
          <Trash2 size={18} color={Colors.error} />
          <Text style={[styles.rowText, styles.rowTextDanger]}>{smart ? 'Remove favourite' : 'Delete collection'}</Text>
        </Pressable>
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
  title: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  note: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    paddingVertical: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48, paddingVertical: Spacing.sm },
  rowText: { fontSize: Typography.sizes.md, fontFamily: Typography.fontFamilies.semibold, color: Colors.text.primary },
  rowTextDanger: { color: Colors.error },
});
