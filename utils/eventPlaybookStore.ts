import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlaybookItemId, PlaybookStage } from '@/utils/eventPlaybook';

/**
 * Device-local part of the per-event playbook (utils/eventPlaybook): the
 * host's manual ticks, per-stage dismissal, and the signals the server does
 * not record (a share, opening insights).
 *
 * Local on purpose for now. `events.host_playbook jsonb` plus
 * `set_event_playbook` (docs/HOST_EVENT_PLAYBOOK_PLAN.md §3.3) will back the
 * ticks later with the same shape; the database is owned by another session
 * and is not touched by this phase. Until then a tick does not follow the
 * host to a second device, which is the cost of not blocking on a migration.
 *
 * Best-effort throughout: losing this only re-shows an item.
 */
export type EventPlaybookLocal = {
  /** Item ids the host ticked by hand. */
  ticked: PlaybookItemId[];
  /** Stages whose card the host dismissed; a later stage still shows. */
  dismissedStages: PlaybookStage[];
  shared: boolean;
  notifiedFollowers: boolean;
  openedInsights: boolean;
  duplicated: boolean;
};

export type PlaybookSignal = 'shared' | 'notifiedFollowers' | 'openedInsights' | 'duplicated';

export const EMPTY_PLAYBOOK_LOCAL: EventPlaybookLocal = {
  ticked: [],
  dismissedStages: [],
  shared: false,
  notifiedFollowers: false,
  openedInsights: false,
  duplicated: false,
};

export const eventPlaybookKey = (eventId: string) => `eventmap.eventPlaybook.${eventId}`;

const stringList = <T extends string>(v: unknown): T[] =>
  Array.isArray(v) ? v.filter((x): x is T => typeof x === 'string') : [];

/** Parses stored JSON defensively; anything missing or corrupt reads as empty. */
export function parsePlaybookLocal(raw: string | null): EventPlaybookLocal {
  if (!raw) return { ...EMPTY_PLAYBOOK_LOCAL };
  try {
    const o = JSON.parse(raw) as Partial<EventPlaybookLocal>;
    if (!o || typeof o !== 'object') return { ...EMPTY_PLAYBOOK_LOCAL };
    return {
      ticked: stringList<PlaybookItemId>(o.ticked),
      dismissedStages: stringList<PlaybookStage>(o.dismissedStages),
      shared: o.shared === true,
      notifiedFollowers: o.notifiedFollowers === true,
      openedInsights: o.openedInsights === true,
      duplicated: o.duplicated === true,
    };
  } catch {
    return { ...EMPTY_PLAYBOOK_LOCAL };
  }
}

export async function readPlaybookLocal(eventId: string): Promise<EventPlaybookLocal> {
  try {
    return parsePlaybookLocal(await AsyncStorage.getItem(eventPlaybookKey(eventId)));
  } catch {
    return { ...EMPTY_PLAYBOOK_LOCAL };
  }
}

export async function updatePlaybookLocal(
  eventId: string,
  patch: Partial<EventPlaybookLocal>
): Promise<EventPlaybookLocal> {
  const next = { ...(await readPlaybookLocal(eventId)), ...patch };
  try {
    await AsyncStorage.setItem(eventPlaybookKey(eventId), JSON.stringify(next));
  } catch {
    // Best-effort.
  }
  return next;
}

/** Ticks or un-ticks a manual item. Unlike signals, this is two-way. */
export async function setPlaybookItemTicked(
  eventId: string,
  item: PlaybookItemId,
  ticked: boolean
): Promise<EventPlaybookLocal> {
  const current = await readPlaybookLocal(eventId);
  const has = current.ticked.includes(item);
  if (has === ticked) return current;
  return updatePlaybookLocal(eventId, {
    ticked: ticked ? [...current.ticked, item] : current.ticked.filter((id) => id !== item),
  });
}

/** Hides the card for this stage only. */
export async function dismissPlaybookStage(
  eventId: string,
  stage: PlaybookStage
): Promise<EventPlaybookLocal> {
  const current = await readPlaybookLocal(eventId);
  if (current.dismissedStages.includes(stage)) return current;
  return updatePlaybookLocal(eventId, { dismissedStages: [...current.dismissedStages, stage] });
}

/** Records a one-way signal (share, insights opened). Never un-sets, never throws. */
export function markPlaybookSignal(eventId: string | null | undefined, signal: PlaybookSignal): void {
  if (!eventId) return;
  void updatePlaybookLocal(eventId, { [signal]: true });
}

/**
 * Reads many events at once, for a list screen. One `multiGet` instead of N
 * reads; ids with nothing stored come back as the empty state, so callers can
 * index the result without checking.
 */
export async function readPlaybookLocalMany(
  eventIds: readonly string[]
): Promise<Map<string, EventPlaybookLocal>> {
  const out = new Map<string, EventPlaybookLocal>();
  const ids = [...new Set(eventIds)];
  if (ids.length === 0) return out;
  try {
    const pairs = await AsyncStorage.multiGet(ids.map(eventPlaybookKey));
    const byKey = new Map(pairs.map(([k, v]) => [k, v]));
    for (const id of ids) out.set(id, parsePlaybookLocal(byKey.get(eventPlaybookKey(id)) ?? null));
  } catch {
    for (const id of ids) out.set(id, { ...EMPTY_PLAYBOOK_LOCAL });
  }
  return out;
}

/**
 * Drops stored state for events the host no longer has open anywhere.
 * One key per event would otherwise accumulate for the life of the install;
 * callers pass the ids still worth keeping (e.g. upcoming + recently ended).
 */
export async function prunePlaybookLocal(keepEventIds: readonly string[]): Promise<number> {
  try {
    const keep = new Set(keepEventIds.map(eventPlaybookKey));
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter((k) => k.startsWith('eventmap.eventPlaybook.') && !keep.has(k));
    if (stale.length > 0) await AsyncStorage.multiRemove(stale);
    return stale.length;
  } catch {
    return 0;
  }
}
