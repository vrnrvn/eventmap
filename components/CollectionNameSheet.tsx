import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { CategoryPicker } from '@/components/CategoryPicker';
import { useCategories } from '@/hooks/useCategories';
import { COLLECTION_LIMITS, validateCollectionName } from '@/utils/collections';
import { BorderRadius, Colors, Shadows, Spacing, Typography } from '@/constants/theme';

type Props = {
  visible: boolean;
  /** Existing name when renaming; undefined when creating. */
  initialName?: string;
  /** Id of the collection being renamed, excluded from the clash check. */
  collectionId?: string;
  /** Names already taken, for the client-side clash check. */
  existing: readonly { id: string; name: string; kind: string }[];
  busy?: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
  /**
   * Creating only: offer "Event type" next to "List". Picks one or more
   * categories; each becomes a smart collection via `onFavouriteTypes`.
   * `favouritedCategoryIds` are shown selected and cannot be unpicked here.
   */
  allowType?: boolean;
  initialTab?: 'list' | 'type';
  favouritedCategoryIds?: readonly string[];
  onFavouriteTypes?: (categoryIds: string[]) => void;
};

type Tab = 'list' | 'type';
const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'list', label: 'List' },
  { value: 'type', label: 'Event type' },
];

/**
 * Create / rename a manual collection. A plain Modal (not Alert.prompt) so it
 * works the same on iOS, Android and web. Validation mirrors the server
 * trigger (utils/collections) so the common mistakes never make a request.
 */
export function CollectionNameSheet({
  visible,
  initialName,
  collectionId,
  existing,
  busy,
  onClose,
  onSubmit,
  allowType = false,
  initialTab = 'list',
  favouritedCategoryIds = [],
  onFavouriteTypes,
}: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(initialName ?? '');
  const [touched, setTouched] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [picked, setPicked] = useState<string[]>([]);
  const { categories, isPending: categoriesPending, isError: categoriesError, refetch: refetchCategories } = useCategories();
  useEffect(() => {
    if (visible) {
      setName(initialName ?? '');
      setTouched(false);
      setTab(initialTab);
      setPicked([]);
    }
  }, [visible, initialName, initialTab]);

  const result = validateCollectionName(name, existing, { kind: 'manual', excludeId: collectionId });
  const error = touched && !result.ok ? result.reason : undefined;
  const renaming = initialName !== undefined;
  const typeMode = allowType && !renaming && tab === 'type';
  const selectedTypes = [...favouritedCategoryIds, ...picked];
  const toggleType = (id: string) => {
    if (favouritedCategoryIds.includes(id)) return; // already a collection; manage it from its card
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const submitTypes = () => {
    if (picked.length === 0 || busy) return;
    onFavouriteTypes?.(picked);
  };

  const submit = () => {
    setTouched(true);
    if (!result.ok || busy) return;
    if (renaming && result.name === initialName) {
      onClose();
      return;
    }
    onSubmit(result.name);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <ModalBackdrop onPress={onClose} label="Close" style={styles.backdrop} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.center}
        pointerEvents="box-none"
      >
        <View
          style={[styles.card, { marginBottom: insets.bottom + Spacing.lg }]}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          accessibilityLabel={renaming ? 'Rename collection' : 'New collection'}
        >
          <Text style={styles.title} accessibilityRole="header">
            {renaming ? 'Rename collection' : 'New collection'}
          </Text>
          {allowType && !renaming ? (
            <SegmentedControl options={TABS} value={tab} onChange={setTab} style={styles.tabs} />
          ) : null}
          {typeMode ? (
            <>
              <Text style={styles.typeHint}>
                A favourite type collects everything you save or join in it, automatically.
              </Text>
              <ScrollView style={styles.typeScroll} keyboardShouldPersistTaps="handled">
                <CategoryPicker
                  categories={categories}
                  status={categoriesError && categories.length === 0 ? 'error' : categoriesPending && categories.length === 0 ? 'loading' : 'loaded'}
                  onRetry={() => void refetchCategories()}
                  selectedIds={selectedTypes}
                  onToggle={toggleType}
                  density="compact"
                  showCount={false}
                  noun="event types"
                />
              </ScrollView>
              {favouritedCategoryIds.length > 0 ? (
                <Text style={styles.hint}>Types you already favourited stay selected.</Text>
              ) : null}
              <View style={styles.actions}>
                <Button label="Cancel" variant="ghost" onPress={onClose} disabled={busy} style={styles.action} />
                <Button
                  label={picked.length > 1 ? `Favourite ${picked.length} types` : 'Favourite type'}
                  onPress={submitTypes}
                  loading={busy}
                  disabled={picked.length === 0}
                  style={styles.action}
                />
              </View>
            </>
          ) : (
          <>
          <TextField
            label="Name"
            value={name}
            onChangeText={(t) => {
              setName(t);
              if (!touched && t.trim()) setTouched(true);
            }}
            placeholder="Weekend plans"
            autoFocus
            autoCapitalize="sentences"
            maxLength={COLLECTION_LIMITS.nameLength + 10}
            returnKeyType="done"
            onSubmitEditing={submit}
            error={error}
          />
          <Text style={styles.hint}>
            {name.trim().length}/{COLLECTION_LIMITS.nameLength}
          </Text>
          <View style={styles.actions}>
            <Button label="Cancel" variant="ghost" onPress={onClose} disabled={busy} style={styles.action} />
            <Button
              label={renaming ? 'Save' : 'Create'}
              onPress={submit}
              loading={busy}
              disabled={!name.trim()}
              style={styles.action}
            />
          </View>
          </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: Colors.overlay.dark },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.lg },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadows.lg,
  },
  title: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  tabs: { marginBottom: Spacing.xs },
  typeHint: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.tertiary, lineHeight: 20 },
  typeScroll: { maxHeight: 260 },
  hint: {
    alignSelf: 'flex-end',
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  action: { flex: 1 },
});
