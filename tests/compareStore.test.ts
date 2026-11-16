import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPARE_MAX,
  canCompare,
  compareAnnouncement,
  compareCtaLabel,
  compareStore,
} from '@/stores/compareStore';
import type { CompareInput } from '@/utils/compare';

function entry(id: string, overrides: Partial<CompareInput> = {}): CompareInput {
  return {
    id,
    title: `Event ${id}`,
    coverImageUrl: null,
    categoryLabel: 'Live Music',
    startIso: '2026-11-20T19:00:00Z',
    endIso: '2026-11-20T22:00:00Z',
    timezone: null,
    lat: 52.52,
    lng: 13.405,
    address: '',
    priceLabel: null,
    ticketUrl: null,
    maxAttendees: null,
    rsvpCount: 0,
    isRecurring: false,
    recurrence: null,
    hostName: 'Blue Note',
    hostVerified: false,
    ageRestriction: null,
    accessibilityNotes: null,
    whatToBring: null,
    rsvpMode: null,
    rsvpClosed: false,
    waitlistMode: null,
    status: 'active',
    ...overrides,
  };
}

beforeEach(() => {
  compareStore.exit();
});

describe('compareStore', () => {
  it('keeps selection order', () => {
    compareStore.add(entry('a'));
    compareStore.add(entry('b'));
    expect(compareStore.getSnapshot().map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('refuses past the cap instead of dropping an earlier choice', () => {
    for (let i = 0; i < COMPARE_MAX; i++) compareStore.add(entry(`e${i}`));
    const result = compareStore.add(entry('one-too-many'));
    expect(result).toEqual({ ok: false, reason: 'full', count: COMPARE_MAX });
    expect(compareStore.count()).toBe(COMPARE_MAX);
    expect(compareStore.isSelected('one-too-many')).toBe(false);
    expect(compareStore.isSelected('e0')).toBe(true);
  });

  it('re-adding the same event refreshes its snapshot without duplicating it', () => {
    compareStore.add(entry('a', { rsvpCount: 1 }));
    const result = compareStore.add(entry('a', { rsvpCount: 9 }));
    expect(result).toEqual({ ok: true, count: 1 });
    expect(compareStore.count()).toBe(1);
    expect(compareStore.getSnapshot()[0].rsvpCount).toBe(9);
  });

  it('upserts only what is already selected, so a late response cannot re-add', () => {
    compareStore.add(entry('a', { rsvpCount: 1 }));
    compareStore.remove('a');
    compareStore.upsert(entry('a', { rsvpCount: 9 }));
    expect(compareStore.count()).toBe(0);
  });

  it('toggles both ways', () => {
    compareStore.toggle(entry('a'));
    expect(compareStore.isSelected('a')).toBe(true);
    compareStore.toggle(entry('a'));
    expect(compareStore.isSelected('a')).toBe(false);
  });

  it('reports fullness', () => {
    expect(compareStore.isFull()).toBe(false);
    for (let i = 0; i < COMPARE_MAX; i++) compareStore.add(entry(`e${i}`));
    expect(compareStore.isFull()).toBe(true);
  });

  it('notifies subscribers on every change and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = compareStore.subscribe(listener);
    compareStore.add(entry('a'));
    compareStore.remove('a');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    compareStore.add(entry('b'));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps one snapshot identity between changes', () => {
    compareStore.add(entry('a'));
    const first = compareStore.getSnapshot();
    expect(compareStore.getSnapshot()).toBe(first);
    compareStore.add(entry('b'));
    expect(compareStore.getSnapshot()).not.toBe(first);
  });

  it('does not notify for a no-op remove or clear', () => {
    const listener = vi.fn();
    compareStore.subscribe(listener);
    compareStore.remove('nothing');
    compareStore.clear();
    compareStore.setActive(false);
    compareStore.exit();
    expect(listener).not.toHaveBeenCalled();
  });

  it('tracks compare mode separately from the selection', () => {
    const listener = vi.fn();
    compareStore.subscribe(listener);
    expect(compareStore.isActive()).toBe(false);
    compareStore.setActive(true);
    expect(compareStore.isActive()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    // Turning the mode on does not touch what is selected, and vice versa.
    compareStore.add(entry('a'));
    expect(compareStore.isActive()).toBe(true);
    compareStore.clear();
    expect(compareStore.isActive()).toBe(true);
  });

  it('exit leaves the mode and drops the selection in one notification', () => {
    compareStore.setActive(true);
    compareStore.add(entry('a'));
    const listener = vi.fn();
    compareStore.subscribe(listener);
    compareStore.exit();
    expect(compareStore.isActive()).toBe(false);
    expect(compareStore.count()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('copy', () => {
  it('needs two events before a comparison means anything', () => {
    expect(canCompare(0)).toBe(false);
    expect(canCompare(1)).toBe(false);
    expect(canCompare(2)).toBe(true);
  });

  it('asks for what is missing', () => {
    expect(compareCtaLabel(0)).toBe('Select events to compare');
    expect(compareCtaLabel(1)).toBe('Select one more to compare');
    expect(compareCtaLabel(3)).toBe('Compare 3 events');
  });

  it('announces selection changes with the count', () => {
    expect(compareAnnouncement('added', 'Jazz Night', 2)).toBe(`Added Jazz Night. 2 of ${COMPARE_MAX} selected.`);
    expect(compareAnnouncement('removed', 'Jazz Night', 1)).toBe(`Removed Jazz Night. 1 of ${COMPARE_MAX} selected.`);
    expect(compareAnnouncement('full', 'Jazz Night', COMPARE_MAX)).toBe(
      `Comparing up to ${COMPARE_MAX} events. Remove one before adding Jazz Night.`
    );
  });
});
