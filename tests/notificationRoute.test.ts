import { describe, expect, it } from 'vitest';
import { notificationRoute } from '@/utils/notificationRoute';

describe('notificationRoute', () => {
  it('sends a host to the hub, not the attendee page', () => {
    expect(notificationRoute({ type: 'host_day_of', eventId: 'e1' })).toBe('/business/manage-event/e1');
  });

  it('opens the after-the-event checklist from the post-event summary', () => {
    expect(notificationRoute({ type: 'host_post_event_summary', eventId: 'e1' })).toBe(
      '/business/manage-event/e1?checklist=1'
    );
  });

  it('sends profile-level host notices to Settings', () => {
    expect(notificationRoute({ type: 'host_verification_update', businessId: 'b1' })).toBe('/settings');
    expect(notificationRoute({ type: 'host_standing_update', businessId: 'b1' })).toBe('/settings');
  });

  it('keeps the existing chat behaviour', () => {
    expect(notificationRoute({ type: 'chat_message', eventId: 'e1' })).toBe('/event-chat/e1');
    expect(notificationRoute({ type: 'chat_mention', eventId: 'e1', messageId: 'm2' })).toBe(
      '/event-chat/e1?messageId=m2'
    );
  });

  it('keeps the existing attendee behaviour', () => {
    expect(notificationRoute({ type: 'event_reminder', eventId: 'e1' })).toBe('/event/e1');
    expect(notificationRoute({ type: 'rsvp', eventId: 'e1', businessId: 'b1' })).toBe('/event/e1');
    expect(notificationRoute({ type: 'new_follower', businessId: 'b1' })).toBe('/business/b1');
    expect(notificationRoute({ type: 'promotion' })).toBe('/(tabs)/discover');
  });
});
