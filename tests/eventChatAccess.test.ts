import { describe, expect, it } from 'vitest';
import { eventChatAccess } from '@/utils/eventChatAccess';

describe('eventChatAccess (mirrors user_can_access_event_chat)', () => {
  it('defaults: unlocks for a going viewer once two are going', () => {
    expect(eventChatAccess('going', 1, null)).toEqual({ state: 'waiting' });
    expect(eventChatAccess('going', 2, null)).toEqual({ state: 'open', announcementsOnly: false });
  });

  it('asks non-attendees to join', () => {
    expect(eventChatAccess('interested', 10, null)).toEqual({ state: 'join' });
    expect(eventChatAccess(null, 10, { chat_mode: 'open', open_policy: 'any_going' })).toEqual({ state: 'join' });
  });

  it("'any_going' opens the chat for the first attendee", () => {
    expect(eventChatAccess('going', 1, { chat_mode: 'open', open_policy: 'any_going' })).toEqual({
      state: 'open',
      announcementsOnly: false,
    });
  });

  it("'off' closes it for everyone, whatever the count", () => {
    expect(eventChatAccess('going', 50, { chat_mode: 'off', open_policy: 'any_going' })).toEqual({ state: 'off' });
    expect(eventChatAccess(null, 50, { chat_mode: 'off' })).toEqual({ state: 'off' });
  });

  it("'announcements' is readable and flagged", () => {
    expect(eventChatAccess('going', 3, { chat_mode: 'announcements', open_policy: 'two_going' })).toEqual({
      state: 'open',
      announcementsOnly: true,
    });
  });

  it('missing columns (older backend) behave like the defaults', () => {
    expect(eventChatAccess('going', 2, { chat_mode: undefined, open_policy: undefined })).toEqual({
      state: 'open',
      announcementsOnly: false,
    });
  });

  // EJ-19 (20261117130000): a per-date "going" counts as going.
  describe('date-only goers', () => {
    it('counts a per-date going as going, unlocked by one series goer', () => {
      // The date-only goer is not inside rsvp_count, so one series goer is
      // already "someone else going".
      expect(eventChatAccess(null, 1, null, { dateGoing: true })).toEqual({
        state: 'open',
        announcementsOnly: false,
      });
    });

    it('waits, rather than asking them to join, while they are alone', () => {
      expect(eventChatAccess(null, 0, null, { dateGoing: true })).toEqual({ state: 'waiting' });
    });

    it("opens immediately under 'any_going'", () => {
      expect(eventChatAccess(null, 0, { chat_mode: 'open', open_policy: 'any_going' }, { dateGoing: true })).toEqual({
        state: 'open',
        announcementsOnly: false,
      });
    });

    it("'off' still wins", () => {
      expect(eventChatAccess(null, 5, { chat_mode: 'off' }, { dateGoing: true })).toEqual({ state: 'off' });
    });

    it('a series goer is unaffected by the new input', () => {
      expect(eventChatAccess('going', 1, null, { dateGoing: true })).toEqual({ state: 'waiting' });
      expect(eventChatAccess('going', 2, null, { dateGoing: true })).toEqual({
        state: 'open',
        announcementsOnly: false,
      });
    });

    it('still asks a non-attendee to join', () => {
      expect(eventChatAccess(null, 5, null, { dateGoing: false })).toEqual({ state: 'join' });
      expect(eventChatAccess('interested', 5, null, { dateGoing: false })).toEqual({ state: 'join' });
    });
  });
});

import { CHAT_AFTER_END_DAYS, chatPostingWindow } from '@/utils/eventChatAccess';

describe('chatPostingWindow (mirrors event_chat_posting_open, 20261118150000)', () => {
  const oneOff = (end: string) => ({ start_datetime: '2026-03-01T18:00:00Z', end_datetime: end });

  it('exports the server constant', () => {
    expect(CHAT_AFTER_END_DAYS).toBe(7);
  });

  it('one-off: open until end + 7 days, exclusive at the boundary', () => {
    const ev = oneOff('2026-03-01T21:00:00Z');
    expect(chatPostingWindow(ev, new Date('2026-03-01T20:00:00Z')).open).toBe(true); // still running
    expect(chatPostingWindow(ev, new Date('2026-03-05T12:00:00Z')).open).toBe(true); // mid-window
    expect(chatPostingWindow(ev, new Date('2026-03-08T20:59:59Z')).open).toBe(true); // last minute
    expect(chatPostingWindow(ev, new Date('2026-03-08T21:00:00Z')).open).toBe(false); // the boundary itself (SQL: > now)
    expect(chatPostingWindow(ev, new Date('2026-04-01T00:00:00Z')).open).toBe(false);
  });

  it('one-off: closesOn lands on the closing day', () => {
    const w = chatPostingWindow(oneOff('2026-03-01T21:00:00Z'), new Date('2026-03-02T00:00:00Z'));
    expect(w.closesOn?.toISOString()).toBe('2026-03-08T21:00:00.000Z');
  });

  it('one-off: an unparseable end never closes instead of locking everyone out', () => {
    expect(chatPostingWindow(oneOff('not-a-date'), new Date('2027-01-01T00:00:00Z'))).toEqual({
      open: true,
      closesOn: null,
    });
  });

  it('series with an endDate: whole local days in the event zone — open through endDate + 7, closed on the 8th', () => {
    const ev = {
      start_datetime: '2026-01-06T23:00:00Z',
      end_datetime: '2026-01-07T01:00:00Z',
      is_recurring: true,
      recurrence_pattern: { type: 'weekly', endDate: '2026-03-10' } as never,
      timezone: 'America/New_York',
    };
    // 2026-03-17 is endDate + 7, the last open day in New York.
    expect(chatPostingWindow(ev, new Date('2026-03-17T12:00:00Z')).open).toBe(true);
    // 23:30 New York on the 17th is already the 18th in UTC: still open.
    expect(chatPostingWindow(ev, new Date('2026-03-18T03:30:00Z')).open).toBe(true);
    // Midnight New York, the 18th: closed.
    expect(chatPostingWindow(ev, new Date('2026-03-18T04:01:00Z')).open).toBe(false);
  });

  it('series: closesOn is a display instant on the last open day', () => {
    const ev = {
      start_datetime: '2026-01-06T23:00:00Z',
      end_datetime: '2026-01-07T01:00:00Z',
      is_recurring: true,
      recurrence_pattern: { type: 'weekly', endDate: '2026-03-10' } as never,
      timezone: 'America/New_York',
    };
    const w = chatPostingWindow(ev, new Date('2026-03-01T00:00:00Z'));
    // Noon New York on 2026-03-17 (EDT, UTC-4).
    expect(w.closesOn?.toISOString()).toBe('2026-03-17T16:00:00.000Z');
  });

  it('series endDate + 7 crosses a month end (Date.UTC normalises the overflow)', () => {
    const ev = {
      start_datetime: '2026-01-28T10:00:00Z',
      end_datetime: '2026-01-28T11:00:00Z',
      is_recurring: true,
      recurrence_pattern: { type: 'weekly', endDate: '2026-01-28' } as never,
      timezone: 'UTC',
    };
    expect(chatPostingWindow(ev, new Date('2026-02-04T12:00:00Z')).open).toBe(true); // Feb 4 = Jan 28 + 7
    expect(chatPostingWindow(ev, new Date('2026-02-05T00:30:00Z')).open).toBe(false);
  });

  it('series without an endDate never closes', () => {
    const ev = {
      start_datetime: '2026-01-06T23:00:00Z',
      end_datetime: '2026-01-07T01:00:00Z',
      is_recurring: true,
      recurrence_pattern: { type: 'weekly' } as never,
      timezone: 'America/New_York',
    };
    expect(chatPostingWindow(ev, new Date('2030-01-01T00:00:00Z'))).toEqual({ open: true, closesOn: null });
  });
});
