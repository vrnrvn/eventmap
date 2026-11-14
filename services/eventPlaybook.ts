/**
 * Server half of the per-event host checklist (migration 20261113100000,
 * docs/HOST_EVENT_PLAYBOOK_PLAN.md P5).
 *
 * The device-local store (`utils/eventPlaybookStore`) stays the source of
 * truth for this device and the only store for signals (a share, opening
 * insights). This adds the half that follows a host to a second device:
 * their manual ticks and dismissed stages.
 *
 * Until the migration is applied the table and RPCs do not exist. Every call
 * here then reports `unavailable` instead of throwing, the caller keeps
 * using the local store, and the outage is remembered for the session so a
 * list screen does not pay one failed round trip per render.
 */
import { supabase } from './supabase';
import type { PlaybookItemId, PlaybookStage } from '@/utils/eventPlaybook';

export type PlaybookServerState = {
  ticked: PlaybookItemId[];
  dismissedStages: PlaybookStage[];
};

/** undefined_table, PostgREST unknown table, undefined_function, unknown function. */
const MISSING = new Set(['42P01', 'PGRST205', '42883', 'PGRST202']);
let unavailable = false;

export function isPlaybookServerUnavailable(): boolean {
  return unavailable;
}

/** Test seam: the session-wide "not on this backend" latch. */
export function resetPlaybookServerAvailability(): void {
  unavailable = false;
}

function noteMissing(error: { code?: string } | null | undefined): boolean {
  if (error?.code && MISSING.has(error.code)) {
    unavailable = true;
    return true;
  }
  return false;
}

const asList = <T extends string>(v: unknown): T[] =>
  Array.isArray(v) ? v.filter((x): x is T => typeof x === 'string') : [];

/** Row → state, defensively: a malformed array reads as empty, never throws. */
export function parseServerState(row: unknown): PlaybookServerState {
  const o = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
  return {
    ticked: asList<PlaybookItemId>(o.ticked),
    dismissedStages: asList<PlaybookStage>(o.dismissed_stages),
  };
}

export const eventPlaybookService = {
  /**
   * Stored state for several events. `null` means this backend does not have
   * the table yet, which callers read as "use the device's copy" — different
   * from an empty map, which means the host has ticked nothing.
   */
  async getMany(eventIds: readonly string[]): Promise<Map<string, PlaybookServerState> | null> {
    if (unavailable) return null;
    const ids = [...new Set(eventIds)].filter(Boolean);
    if (ids.length === 0) return new Map();
    const { data, error } = await supabase
      .from('event_host_playbook')
      .select('event_id, ticked, dismissed_stages')
      .in('event_id', ids);
    if (error) {
      if (noteMissing(error)) return null;
      throw error;
    }
    const out = new Map<string, PlaybookServerState>();
    for (const row of data ?? []) {
      const id = (row as { event_id?: unknown }).event_id;
      if (typeof id === 'string') out.set(id, parseServerState(row));
    }
    return out;
  },

  async get(eventId: string): Promise<PlaybookServerState | null> {
    const many = await this.getMany([eventId]);
    if (many === null) return null;
    return many.get(eventId) ?? { ticked: [], dismissedStages: [] };
  },

  /**
   * Ticks or un-ticks one item. Returns the merged state, or null when the
   * backend has no checklist table yet. The server merges, so two devices
   * cannot overwrite each other's ticks.
   */
  async setItem(eventId: string, item: PlaybookItemId, done: boolean): Promise<PlaybookServerState | null> {
    if (unavailable) return null;
    const { data, error } = await supabase.rpc('set_event_playbook_item', {
      p_event_id: eventId,
      p_item: item,
      p_done: done,
    });
    if (error) {
      if (noteMissing(error)) return null;
      throw error;
    }
    return parseServerState(data);
  },

  async dismissStage(eventId: string, stage: PlaybookStage): Promise<PlaybookServerState | null> {
    if (unavailable) return null;
    // 'none' is not a real stage and the server rejects it; never send it.
    if (stage === 'none') return null;
    const { data, error } = await supabase.rpc('dismiss_event_playbook_stage', {
      p_event_id: eventId,
      p_stage: stage,
    });
    if (error) {
      if (noteMissing(error)) return null;
      throw error;
    }
    return parseServerState(data);
  },
};
