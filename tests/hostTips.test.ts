import { describe, expect, it } from 'vitest';
import { hostTip, nextHostTip, type HostTipFacts, type HostTipId } from '@/utils/hostTips';

const pick = (facts: HostTipFacts, seen: HostTipId[] = []) => nextHostTip(facts, seen);

describe('nextHostTip', () => {
  it('says nothing when nothing has happened', () => {
    expect(pick({})).toBeNull();
    expect(pick({ going: 0, maxAttendees: 10 })).toBeNull();
  });

  it('introduces the first attendee', () => {
    expect(pick({ going: 1, maxAttendees: 10 })).toBe('first_rsvp');
  });

  it('explains the waitlist once the event is full, ahead of the first-attendee tip', () => {
    expect(pick({ going: 10, maxAttendees: 10 })).toBe('capacity_reached');
    expect(pick({ going: 11, maxAttendees: 10 })).toBe('capacity_reached');
    // Unlimited events are never "full".
    expect(pick({ going: 99, maxAttendees: null })).toBe('first_rsvp');
  });

  it('puts things needing attention first', () => {
    expect(pick({ going: 10, maxAttendees: 10, reportsWaiting: 2 })).toBe('reports_waiting');
    expect(pick({ going: 3, maxAttendees: 10, editingWithAttendees: true })).toBe('reschedule_vs_edit');
  });

  it('only warns about editing when people are actually going', () => {
    expect(pick({ going: 0, maxAttendees: 10, editingWithAttendees: true })).toBeNull();
    expect(pick({ going: null, editingWithAttendees: true })).toBeNull();
  });

  it('introduces chat moderation when the host opens the chat', () => {
    expect(pick({ chatOpened: true })).toBe('chat_opened');
    expect(pick({ chatOpened: false })).toBeNull();
  });

  it('warns a free host with one slot left, not at zero or on premium', () => {
    expect(pick({ isPremium: false, eventsUsed: 1, eventsAllowed: 2 })).toBe('last_free_event');
    // At the limit the existing banner covers it.
    expect(pick({ isPremium: false, eventsUsed: 2, eventsAllowed: 2 })).toBeNull();
    expect(pick({ isPremium: false, eventsUsed: 0, eventsAllowed: 2 })).toBeNull();
    expect(pick({ isPremium: true, eventsUsed: 29, eventsAllowed: 30 })).toBeNull();
  });

  it('never repeats a tip the host has seen', () => {
    expect(pick({ going: 1 }, ['first_rsvp'])).toBeNull();
    expect(pick({ going: 10, maxAttendees: 10 }, ['capacity_reached'])).toBe('first_rsvp');
    expect(pick({ going: 10, maxAttendees: 10 }, ['capacity_reached', 'first_rsvp'])).toBeNull();
    expect(pick({ going: 2, reportsWaiting: 1 }, ['reports_waiting'])).toBe('first_rsvp');
  });

  it('ignores unknown facts rather than guessing', () => {
    expect(pick({ going: null, maxAttendees: 10 })).toBeNull();
    expect(pick({ reportsWaiting: null, going: null })).toBeNull();
    expect(pick({ isPremium: false, eventsUsed: null, eventsAllowed: 2 })).toBeNull();
  });

  it('every tip has copy and a sensible action', () => {
    const ids: HostTipId[] = ['first_rsvp', 'capacity_reached', 'chat_opened', 'reports_waiting', 'reschedule_vs_edit', 'last_free_event'];
    for (const id of ids) {
      const tip = hostTip(id);
      expect(tip.title.length).toBeGreaterThan(0);
      expect(tip.body.length).toBeGreaterThan(20);
      expect(tip.action?.label.length ?? 1).toBeGreaterThan(0);
    }
  });
});
