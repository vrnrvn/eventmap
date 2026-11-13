/**
 * "Add to collection" bottom sheet (docs/EVENT_COLLECTIONS_PLAN.md Phase C).
 * Lists the viewer's collections with a check per collection this event is
 * in; tapping pins / unpins (optimistic, queueable offline through the
 * `collectionItem` pending write). Events matching a smart collection's rule
 * show as "included automatically" — unpinning only removes the explicit pin.
 * "New collection" expands inline (no nested modal) and pins the event into
 * the list it creates.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useCollectionsList, useInvalidateCollections, usePendingCollectionItems } from '@/hooks/useCollections';
import { queryKeys } from '@/hooks/queryKeys';
import { CollectionsUnavailableError, collectionsService } from '@/services/collections';
import { runOrQueue } from '@/services/pendingWrites';
import { CategoryIcon } from '@/components/CategoryIcon';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { Button } from '@/components/ui/Button';
import { Check, CloudOff, FolderHeart, FolderPlus, X } from '@/components/icons.generated';
import {
  COLLECTION_LIMITS,
  applyMembershipChange,
  collectionErrorMessage,
  collectionItemTarget,
  describeCollectionCounts,
  overlayPendingMembership,
  validateCollectionName,
} from '@/utils/collections';
import { notify } from '@/utils/notify';
import { blockedOffline } from '@/utils/requireOnline';
import { a11yState } from '@/utils/accessibility';
import { BorderRadius, Colors, Shadows, Spacing, Typography } from '@/constants/theme';
import type { Collection, CollectionMembership } from '@/types/database';

type Props = {
  /** The event to file; null while closed. */
  event: { id: string; title: string } | null;
  onClose: () => void;
};

export function AddToCollectionSheet({ event, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateCollections();
  const listQuery = useCollectionsList();
  const collections = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const eventId = event?.id ?? null;
  const membershipKey = queryKeys.eventCollections(eventId ?? 'none');
  const membershipQuery = useQuery({
    queryKey: membershipKey,
    enabled: !!eventId && !!user,
    queryFn: () => collectionsService.membership(eventId!),
    staleTime: 15_000,
  });
  const pendingByCollection = usePendingCollectionItems(eventId);
  // What the user asked for wins over a server read the queue has not reached yet.
  const memberships = useMemo(
    () => overlayPendingMembership(membershipQuery.data ?? [], pendingByCollection),
    [membershipQuery.data, pendingByCollection]
  );
  const unavailable =
    listQuery.error instanceof CollectionsUnavailableError ||
    membershipQuery.error instanceof CollectionsUnavailableError;

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (event) {
      setCreating(false);
      setNewName('');
      setTouched(false);
    }
  }, [event]);

  const toggle = async (collection: Collection, membership: CollectionMembership | undefined) => {
    if (!event) return;
    const pinned = membership?.pinned ?? false;
    const next = !pinned;
    const previous = queryClient.getQueryData<CollectionMembership[]>(membershipKey);
    queryClient.setQueryData<CollectionMembership[]>(membershipKey, (old) =>
      applyMembershipChange(old ?? membershipQuery.data ?? [], collection.id, next)
    );
    try {
      const result = await runOrQueue({
        kind: 'collectionItem',
        targetId: collectionItemTarget(collection.id, event.id),
        on: next,
        label: event.title,
        collectionName: collection.name,
      });
      if (result === 'done') {
        invalidate(collection.id);
        void queryClient.invalidateQueries({ queryKey: membershipKey });
      }
    } catch (err) {
      queryClient.setQueryData(membershipKey, previous);
      notify.error(collectionErrorMessage(err) ?? (next ? "Couldn't add to the collection." : "Couldn't remove from the collection."));
    }
  };

  const createAndPin = async () => {
    setTouched(true);
    const result = validateCollectionName(newName, collections, { kind: 'manual' });
    if (!event || !result.ok || createBusy) return;
    if (blockedOffline('Creating a collection')) return;
    setCreateBusy(true);
    try {
      const created = await collectionsService.create({ kind: 'manual', name: result.name });
      await collectionsService.addItem(created.id, event.id);
      queryClient.setQueryData<CollectionMembership[]>(membershipKey, (old) =>
        applyMembershipChange(old ?? [], created.id, true)
      );
      invalidate(created.id);
      setCreating(false);
      setNewName('');
      setTouched(false);
      notify.success(`Added “${event.title}” to “${created.name}”.`);
    } catch (err) {
      notify.error(collectionErrorMessage(err) ?? "Couldn't create the collection.");
    } finally {
      setCreateBusy(false);
    }
  };

  const nameResult = validateCollectionName(newName, collections, { kind: 'manual' });
  const nameError = touched && creating && !nameResult.ok ? nameResult.reason : null;
  const loading = (listQuery.isPending || membershipQuery.isPending) && !unavailable;

  if (!event) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <ModalBackdrop onPress={onClose} label="Close add to collection" style={styles.backdrop} />
      <View
        style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.md }]}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        accessibilityLabel={`Add ${event.title} to a collection`}
      >
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            Add to collection
          </Text>
          <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
            <X size={20} color={Colors.text.secondary} />
          </Pressable>
        </View>
        <Text style={styles.subtitle} numberOfLines={1}>
          {event.title}
        </Text>

        {unavailable ? (
          <Text style={styles.note}>Collections aren’t available on this server yet. The event is still in Saved.</Text>
        ) : loading ? (
          <View style={styles.loadingBox} accessibilityLabel="Loading collections" {...a11yState({ busy: true })}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : (
          <ScrollView style={styles.listScroll} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
            {collections.map((c) => {
              const membership = memberships.find((m) => m.collection_id === c.id);
              const pinned = membership?.pinned ?? false;
              const byRule = membership?.by_rule ?? false;
              const pending = membership?.pending ?? pendingByCollection.has(c.id);
              const checked = pinned || byRule;
              return (
                <Pressable
                  key={c.id}
                  style={styles.row}
                  onPress={() => void toggle(c, membership)}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${c.name}${byRule && !pinned ? ', included automatically' : ''}`}
                  accessibilityHint={pending ? "Waiting for a connection; it will sync when you're back online." : undefined}
                  {...a11yState({ checked, busy: pending })}
                >
                  <View style={styles.rowIcon}>
                    {c.kind === 'smart' ? (
                      <CategoryIcon category={{ label: c.name, icon_key: c.icon_key ?? undefined, color: c.color }} size="sm" />
                    ) : (
                      <FolderHeart size={16} color={Colors.primary} />
                    )}
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {pending
                        ? "Will sync when you're back online"
                        : byRule && !pinned
                          ? 'Included automatically'
                          : describeCollectionCounts(c)}
                    </Text>
                  </View>
                  <View style={[styles.checkbox, checked && styles.checkboxChecked, byRule && !pinned && styles.checkboxAuto, pending && styles.checkboxPending]}>
                    {pending ? (
                      <CloudOff size={13} color={checked ? Colors.white : Colors.text.secondary} />
                    ) : checked ? (
                      <Check size={14} color={Colors.white} />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
            {collections.length === 0 ? (
              <Text style={styles.note}>No collections yet — create your first one below.</Text>
            ) : null}

            {creating ? (
              <View style={styles.createBox}>
                <TextInput
                  style={styles.createInput}
                  value={newName}
                  onChangeText={(t) => {
                    setNewName(t);
                    if (!touched && t.trim()) setTouched(true);
                  }}
                  placeholder="Collection name"
                  placeholderTextColor={Colors.text.tertiary}
                  accessibilityLabel="Collection name"
                  autoFocus
                  maxLength={COLLECTION_LIMITS.nameLength + 10}
                  returnKeyType="done"
                  onSubmitEditing={() => void createAndPin()}
                />
                {nameError ? (
                  <Text style={styles.errorText} accessibilityLiveRegion="polite">
                    {nameError}
                  </Text>
                ) : null}
                <View style={styles.createActions}>
                  <Button label="Cancel" variant="ghost" onPress={() => setCreating(false)} disabled={createBusy} style={styles.createAction} />
                  <Button label="Create and add" onPress={() => void createAndPin()} loading={createBusy} disabled={!newName.trim()} style={styles.createAction} />
                </View>
              </View>
            ) : (
              <Pressable
                style={styles.row}
                onPress={() => setCreating(true)}
                accessibilityRole="button"
                accessibilityLabel="New collection"
              >
                <View style={[styles.rowIcon, styles.rowIconAccent]}>
                  <FolderPlus size={16} color={Colors.primary} />
                </View>
                <Text style={[styles.rowTitle, styles.rowTitleAccent]}>New collection</Text>
              </Pressable>
            )}
          </ScrollView>
        )}
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
    maxHeight: '75%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    ...Shadows.lg,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border.light, marginBottom: Spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: {
    flex: 1,
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamilies.bold,
    fontWeight: Typography.weights.bold,
    color: Colors.text.primary,
  },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  subtitle: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.tertiary, marginBottom: Spacing.sm },
  note: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamily, color: Colors.text.tertiary, paddingVertical: Spacing.md, lineHeight: 20 },
  loadingBox: { paddingVertical: Spacing.xl, alignItems: 'center' },
  listScroll: { flexGrow: 0 },
  list: { paddingBottom: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 56, paddingVertical: Spacing.xs },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  rowIconAccent: { backgroundColor: Colors.primarySoft },
  rowBody: { flex: 1, gap: 1 },
  rowTitle: { fontSize: Typography.sizes.md, fontFamily: Typography.fontFamilies.semibold, color: Colors.text.primary },
  rowTitleAccent: { color: Colors.primary },
  rowMeta: { fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamily, color: Colors.text.tertiary },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: Colors.border.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkboxAuto: { backgroundColor: Colors.border.medium, borderColor: Colors.border.medium },
  checkboxPending: { borderStyle: 'dashed' },
  createBox: { gap: Spacing.sm, paddingVertical: Spacing.sm },
  createInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: Colors.border.light,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
    backgroundColor: Colors.background.primary,
  },
  errorText: { color: Colors.error, fontSize: Typography.sizes.xs, fontFamily: Typography.fontFamily },
  createActions: { flexDirection: 'row', gap: Spacing.sm },
  createAction: { flex: 1 },
});
