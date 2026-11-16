import type { CompareInput } from '@/utils/compare';

/**
 * The compare tray's selection (docs/EVENT_COMPARISON_PLAN.md §3.1).
 *
 * A module-level store in the shape the other stores in this folder use —
 * plain functions, no React dependency — plus a `subscribe` / `getSnapshot`
 * pair so a screen can read it through `useSyncExternalStore`. The snapshot
 * identity only changes when the selection does, so subscribers don't
 * re-render on every read.
 *
 * Selection is deliberately **session-scoped and in memory**: "which of these
 * three am I going to" is a question that expires. Persisting it across app
 * restarts is decision D1 — if that lands, it belongs here and nowhere else.
 *
 * Entries are `CompareInput` snapshots taken from the list row the user
 * selected, so the tray and the first paint of the comparison need no network.
 * Fuller data from `get_event_details` replaces them through `upsert`.
 */

/** Plan §3.1 / decision D5. Four columns is the most a phone can carry. */
export const COMPARE_MAX = 4;

export type AddResult =
  | { ok: true; count: number }
  | { ok: false; reason: 'full'; count: number };

let selection: CompareInput[] = [];
/**
 * Compare mode: whether the list screens show their selection checkboxes.
 * Global, not per screen, so a shortlist started on Saved can continue in a
 * collection. Exiting clears the selection too (`exit`).
 */
let active = false;
const listeners = new Set<() => void>();

function notifyAll() {
  for (const listener of listeners) listener();
}

function emit() {
  // New array identity per change; same identity between changes.
  selection = selection.slice();
  notifyAll();
}

export const compareStore = {
  /** Current selection, in the order it was built. Treat as read-only. */
  getSnapshot(): CompareInput[] {
    return selection;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  count(): number {
    return selection.length;
  },

  isActive(): boolean {
    return active;
  },

  setActive(next: boolean): void {
    if (active === next) return;
    active = next;
    notifyAll();
  },

  /** Leave compare mode and drop the selection, in one notification. */
  exit(): void {
    if (!active && selection.length === 0) return;
    active = false;
    selection = [];
    notifyAll();
  },

  isSelected(id: string): boolean {
    return selection.some((e) => e.id === id);
  },

  isFull(): boolean {
    return selection.length >= COMPARE_MAX;
  },

  /**
   * Adds an event, or refreshes the snapshot of one already selected.
   *
   * A re-add is never a duplicate and never an error: the caller may have a
   * better snapshot than the one the tray holds. Past the cap the add is
   * **refused** rather than silently dropping the oldest selection — the user
   * chose those four, so the app does not un-choose one for them.
   */
  add(entry: CompareInput): AddResult {
    const existing = selection.findIndex((e) => e.id === entry.id);
    if (existing >= 0) {
      selection[existing] = entry;
      emit();
      return { ok: true, count: selection.length };
    }
    if (selection.length >= COMPARE_MAX) {
      return { ok: false, reason: 'full', count: selection.length };
    }
    selection.push(entry);
    emit();
    return { ok: true, count: selection.length };
  },

  /**
   * Replaces the snapshot of an already-selected event (the details fetch
   * resolving). Does nothing when the event is not selected — a late response
   * must not re-add something the user just removed.
   */
  upsert(entry: CompareInput): void {
    const index = selection.findIndex((e) => e.id === entry.id);
    if (index < 0) return;
    selection[index] = entry;
    emit();
  },

  remove(id: string): void {
    const next = selection.filter((e) => e.id !== id);
    if (next.length === selection.length) return;
    selection = next;
    emit();
  },

  /** Convenience for a checkbox: returns what the selection became. */
  toggle(entry: CompareInput): AddResult {
    if (compareStore.isSelected(entry.id)) {
      compareStore.remove(entry.id);
      return { ok: true, count: selection.length };
    }
    return compareStore.add(entry);
  },

  clear(): void {
    if (selection.length === 0) return;
    selection = [];
    emit();
  },
};

/** Two events are the minimum that makes a comparison mean anything. */
export function canCompare(count: number): boolean {
  return count >= 2;
}

/**
 * What the tray's call-to-action says. Kept next to the store so the tray,
 * the entry points and the tests all agree on the wording.
 */
export function compareCtaLabel(count: number): string {
  if (count === 0) return 'Select events to compare';
  if (count === 1) return 'Select one more to compare';
  return `Compare ${count} events`;
}

/** Spoken after a selection change (plan §3.8). */
export function compareAnnouncement(action: 'added' | 'removed' | 'full', title: string, count: number): string {
  if (action === 'full') {
    return `Comparing up to ${COMPARE_MAX} events. Remove one before adding ${title}.`;
  }
  const verb = action === 'added' ? 'Added' : 'Removed';
  return `${verb} ${title}. ${count} of ${COMPARE_MAX} selected.`;
}
