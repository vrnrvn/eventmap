import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Button } from '@/components/ui/Button';
import { CompareTable, columnWidthFor } from '@/components/compare/CompareTable';
import { CompareCards } from '@/components/compare/CompareCards';
import { useCompareSelection } from '@/hooks/useCompareSelection';
import { useCompareEvents } from '@/hooks/useCompareEvents';
import { useBrowseCenter } from '@/hooks/useBrowseCenter';
import { useScreenReaderEnabled } from '@/hooks/useScreenReaderEnabled';
import { useAuth } from '@/contexts/AuthContext';
import { queryKeys } from '@/hooks/queryKeys';
import { socialService } from '@/services/social';
import { runOrQueueWithNotice } from '@/services/pendingWrites';
import { compareStore } from '@/stores/compareStore';
import { eventsService } from '@/services/events';
import { Share2 } from '@/components/icons.generated';
import { shareEventLink } from '@/utils/eventShare';
import {
  droppedFromLinkMessage,
  filterLinkedEvents,
  getCompareWebUrl,
  parseCompareIds,
  shareableCompareIds,
} from '@/utils/compareLink';
import { buildCompareRows, fromEventDetails, partitionRows, type CompareInput } from '@/utils/compare';
import { goBackOr } from '@/utils/navigation';
import { blockedOffline } from '@/utils/requireOnline';
import { notify } from '@/utils/notify';
import { successHaptic } from '@/utils/haptics';
import { connectionErrorMessage } from '@/utils/networkErrors';
import { a11yState } from '@/utils/accessibility';
import { classifyRsvpError, rsvpErrorMessage, rsvpErrorNeedsRefresh } from '@/utils/rsvpErrors';
import { Colors, Spacing, Typography } from '@/constants/theme';
import type { EventDetails } from '@/types/database';

type ViewMode = 'table' | 'cards';

/** Decision D4: at this system font scale the table gives way to cards. */
const LARGE_TEXT_SCALE = 1.3;

const MODES = [
  { value: 'table', label: 'Table', accessibilityLabel: 'Side by side table' },
  { value: 'cards', label: 'Cards', accessibilityLabel: 'One card per event' },
] as const;

/**
 * The comparison (docs/EVENT_COMPARISON_PLAN.md §3.2). Two layouts over the
 * same rows: the side-by-side table, and cards — which a screen reader or
 * large text gets by default (D4), with the toggle always available.
 *
 * Writes go through the same service calls and query keys the event page
 * uses, so the two never disagree; anything with a second step (waitlist,
 * approval, sign-in) hands off to the event page rather than re-implementing
 * it here (`joinActionFor`).
 */
export default function CompareEvents() {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const screenReader = useScreenReaderEnabled();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { items, remove, exit } = useCompareSelection();
  const columns = useCompareEvents(items);
  const center = useBrowseCenter();

  // A shared link (D2): `/compare?ids=a,b,c` fills the selection from the
  // server, dropping anything not returned and any unlisted event the viewer
  // could not already see (utils/compareLink).
  const { ids: idsParam } = useLocalSearchParams<{ ids?: string }>();
  const [hydrating, setHydrating] = useState(() => parseCompareIds(idsParam).length > 0);
  useEffect(() => {
    const ids = parseCompareIds(idsParam);
    if (ids.length === 0) return;
    let cancelled = false;
    setHydrating(true);
    (async () => {
      const alreadyVisible = new Set<string>([
        ...compareStore.getSnapshot().map((e) => e.id),
        ...ids.filter((id) => queryClient.getQueryData(queryKeys.eventDetails(id)) != null),
      ]);
      const results = await Promise.all(
        ids.map(async (id) => ({
          id,
          details: await queryClient
            .fetchQuery({
              queryKey: queryKeys.eventDetails(id),
              queryFn: () => eventsService.getEventDetails(id),
              staleTime: 60 * 1000,
            })
            .catch(() => null),
        }))
      );
      if (cancelled) return;
      const { keep, dropped } = filterLinkedEvents(results, alreadyVisible);
      for (const d of keep) compareStore.add(fromEventDetails(d));
      if (dropped > 0) notify.error(droppedFromLinkMessage(dropped));
      setHydrating(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [idsParam, queryClient]);

  const share = async () => {
    const { ids, excluded } = shareableCompareIds(items);
    if (ids.length < 2) {
      notify.error(excluded > 0 ? "Unlisted events can't be shared in a comparison link." : 'Pick at least two events to share.');
      return;
    }
    try {
      const outcome = await shareEventLink({
        title: 'Compare events on EventMap',
        url: getCompareWebUrl(ids),
        copyToClipboard: (text) => Clipboard.setStringAsync(text).then(() => {}),
      });
      const leftOut = excluded > 0 ? ` ${excluded} unlisted ${excluded === 1 ? 'event was' : 'events were'} left out.` : '';
      if (outcome === 'copied') notify.success(`Link copied to clipboard.${leftOut}`);
      else if (outcome === 'shared' && leftOut) notify.success(leftOut.trim());
    } catch {
      notify.error("Couldn't share this link.");
    }
  };

  // D4. Native only for the screen-reader half: react-native-web's
  // AccessibilityInfo.isScreenReaderEnabled() always resolves true (a browser
  // cannot tell), which would force cards on every web visitor. Web keeps the
  // table by default and the toggle; fontScale is 1 there too.
  const autoCards = (Platform.OS !== 'web' && screenReader) || fontScale >= LARGE_TEXT_SCALE;
  const [mode, setMode] = useState<ViewMode>(autoCards ? 'cards' : 'table');
  // A screen reader turned on while the screen is open switches to cards;
  // the person can still switch back.
  useEffect(() => {
    if (autoCards) setMode('cards');
  }, [autoCards]);
  const [showIdentical, setShowIdentical] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const inputs = useMemo(() => columns.map((c) => c.input), [columns]);
  const rows = useMemo(
    () => buildCompareRows(inputs, { reference: center ? { lat: center.lat, lng: center.lng } : null }),
    [inputs, center]
  );
  const { differing, identical } = useMemo(() => partitionRows(rows), [rows]);

  const back = useCallback(() => goBackOr(router, '/saved-events'), []);
  const open = useCallback((id: string) => router.push(`/event/${id}` as never), []);

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Mirror a viewer-state change into both places a column reads from. */
  const patchColumn = (id: string, patch: Partial<CompareInput>, details: (d: EventDetails) => EventDetails) => {
    queryClient.setQueryData<EventDetails>(queryKeys.eventDetails(id), (d) => (d ? details(d) : d));
    const snapshot = compareStore.getSnapshot().find((e) => e.id === id);
    if (snapshot) compareStore.upsert({ ...snapshot, ...patch });
  };

  const join = async (input: CompareInput) => {
    if (!user) {
      router.push({ pathname: '/(auth)/login', params: { redirect: `/event/${input.id}` } } as never);
      return;
    }
    if (blockedOffline('RSVP')) return;
    if (busyIds.has(input.id)) return;
    setBusy(input.id, true);
    try {
      const result = await socialService.createOrUpdateRsvp(input.id, 'going');
      const wentGoing = result === 'going' && input.userRsvp !== 'going';
      patchColumn(
        input.id,
        { userRsvp: result, rsvpCount: input.rsvpCount + (wentGoing ? 1 : 0) },
        (d) => ({ ...d, user_rsvp: result, rsvp_count: d.rsvp_count + (wentGoing && d.user_rsvp !== 'going' ? 1 : 0) })
      );
      queryKeys.markAttendanceListsStale(queryClient);
      successHaptic();
      notify.success(
        result === 'requested'
          ? `Request sent for ${input.title}. The host usually replies within a day.`
          : `You're going to ${input.title}.`
      );
    } catch (err) {
      const code = classifyRsvpError(err);
      notify.error(rsvpErrorMessage(code));
      // The event changed under the viewer (filled up, cancelled…): refresh
      // that column so the action reflects what is actually possible.
      if (rsvpErrorNeedsRefresh(code)) columns.find((c) => c.input.id === input.id)?.refetch();
    } finally {
      setBusy(input.id, false);
    }
  };

  const toggleSave = async (input: CompareInput) => {
    if (!user) {
      router.push({ pathname: '/(auth)/login', params: { redirect: `/event/${input.id}` } } as never);
      return;
    }
    if (busyIds.has(input.id)) return;
    const wasSaved = !!input.userSaved;
    // Optimistic, like the event page; reverted on failure.
    patchColumn(input.id, { userSaved: !wasSaved }, (d) => ({ ...d, user_saved: !wasSaved }));
    setBusy(input.id, true);
    try {
      const result = await runOrQueueWithNotice({ kind: 'save', targetId: input.id, on: !wasSaved, label: input.title });
      if (result === 'done') queryKeys.markAttendanceListsStale(queryClient);
    } catch (err) {
      patchColumn(input.id, { userSaved: wasSaved }, (d) => ({ ...d, user_saved: wasSaved }));
      notify.error(connectionErrorMessage(err) ?? (wasSaved ? 'Failed to remove from saved events' : 'Failed to save event'));
    } finally {
      setBusy(input.id, false);
    }
  };

  if (items.length < 2) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Compare" onBack={back} />
        {hydrating ? (
          <View style={styles.empty} accessibilityLabel="Loading the comparison" {...a11yState({ busy: true })}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.emptyBody}>Loading the comparison…</Text>
          </View>
        ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Pick at least two events</Text>
          <Text style={styles.emptyBody}>
            Tick events on Saved, in a collection or in a category to line them up here.
          </Text>
          <Button label="Back" variant="secondary" onPress={back} />
        </View>
        )}
      </View>
    );
  }

  const note = `${
    center ? `Distances from ${center.precise ? 'your location' : 'your home area'}. ` : ''
  }★ marks the event clearly ahead on a row.`;
  const shared = {
    columns,
    rows: differing,
    identicalRows: identical,
    showIdentical,
    onToggleIdentical: () => setShowIdentical((v) => !v),
    signedIn: !!user,
    busyIds,
    onOpen: open,
    onJoin: (input: CompareInput) => void join(input),
    onToggleSave: (input: CompareInput) => void toggleSave(input),
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Compare"
        onBack={back}
        right={
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.shareBtn}
              onPress={() => void share()}
              accessibilityRole="button"
              accessibilityLabel="Share this comparison"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Share2 size={20} color={Colors.text.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => {
                exit();
                back();
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear the comparison"
            >
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          </View>
        }
      />
      <View style={styles.toolbar}>
        <SegmentedControl options={MODES} value={mode} onChange={setMode} style={styles.modeControl} />
        {mode === 'table' ? (
          <Text style={styles.toolbarNote} numberOfLines={2}>
            {note}
          </Text>
        ) : null}
      </View>
      {mode === 'table' ? (
        <CompareTable {...shared} columnWidth={columnWidthFor(width)} bottomInset={insets.bottom} />
      ) : (
        <CompareCards {...shared} onRemove={remove} bottomInset={insets.bottom} note={note} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background.primary },
  toolbar: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm, gap: Spacing.sm },
  modeControl: { width: 200 },
  toolbarNote: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    lineHeight: 16,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  shareBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  clearBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.xs },
  clearText: { fontSize: Typography.sizes.sm, fontFamily: Typography.fontFamilies.semibold, color: Colors.primary },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.sm },
  emptyTitle: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.displayFontFamilies.bold,
    color: Colors.text.primary,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.secondary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
});
