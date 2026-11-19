import { describe, expect, it } from 'vitest';
import { editNoticePrompt } from '@/utils/eventEditNotice';

const base = {
  timePlaceChanged: false,
  scheduleChanged: false,
  isPostponed: false,
  isDraft: false,
  goingCount: 0,
};

describe('editNoticePrompt (EJ-15 / EJ-20 / EJ-21)', () => {
  it('says nothing when the save notifies nobody', () => {
    expect(editNoticePrompt(base)).toBeNull();
  });

  it('warns before a time or place change', () => {
    const p = editNoticePrompt({ ...base, timePlaceChanged: true, goingCount: 3 });
    expect(p?.title).toBe('Notify attendees?');
    expect(p?.message).toContain('"rescheduled"');
    expect(p?.message).toContain('(3 going)');
    expect(p?.confirmLabel).toBe('Save and notify');
  });

  it('leaves the count out when nobody is going yet', () => {
    expect(editNoticePrompt({ ...base, timePlaceChanged: true })?.message).not.toContain('going)');
  });

  // EJ-21: the old copy promised savers who were never told, and never
  // mentioned date-only goers. Both are in the audience now.
  it('names savers and date-only goers in every audience line', () => {
    for (const p of [
      editNoticePrompt({ ...base, timePlaceChanged: true }),
      editNoticePrompt({ ...base, scheduleChanged: true }),
    ]) {
      expect(p?.message).toContain('saved it');
      expect(p?.message).toContain('going to a single date');
      expect(p?.message).toContain('on the waitlist');
      expect(p?.message).toContain('waiting for your approval');
    }
  });

  // EJ-20: this used to save silently while dropping dates.
  it('warns before a recurrence-pattern change on its own', () => {
    const p = editNoticePrompt({ ...base, scheduleChanged: true, goingCount: 2 });
    expect(p?.title).toBe('Notify attendees?');
    expect(p?.message).toContain('Schedule changed');
    expect(p?.message).toContain('no longer happen');
    expect(p?.message).toContain('(2 going)');
  });

  it('mentions the schedule as well when both changed', () => {
    const p = editNoticePrompt({ ...base, timePlaceChanged: true, scheduleChanged: true });
    expect(p?.message).toContain('"rescheduled"');
    expect(p?.message).toContain('repeat schedule is announced');
  });

  it('asks a postponed event for its new date instead', () => {
    const p = editNoticePrompt({ ...base, timePlaceChanged: true, isPostponed: true });
    expect(p?.title).toBe('Set the new date?');
    expect(p?.confirmLabel).toBe('Set date');
  });

  it('stays silent for a draft: it has no audience yet', () => {
    expect(editNoticePrompt({ ...base, timePlaceChanged: true, isDraft: true })).toBeNull();
    expect(editNoticePrompt({ ...base, scheduleChanged: true, isDraft: true })).toBeNull();
  });

  it('still asks a postponed draft for its new date', () => {
    expect(editNoticePrompt({ ...base, timePlaceChanged: true, isDraft: true, isPostponed: true })?.title).toBe(
      'Set the new date?'
    );
  });

  // notify_rsvp_users_on_event_update only fires for an active, published
  // event, so a postponed series' pattern change reaches nobody.
  it('stays silent for a schedule-only change on a postponed event', () => {
    expect(editNoticePrompt({ ...base, scheduleChanged: true, isPostponed: true })).toBeNull();
  });
});
