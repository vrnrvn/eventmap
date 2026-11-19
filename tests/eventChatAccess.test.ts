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
