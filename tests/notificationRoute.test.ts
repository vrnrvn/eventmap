import { describe, expect, it } from 'vitest';
import { notificationRoute, routeFromPushData, IN_APP_FALLBACK, PUSH_FALLBACK } from '@/utils/notificationRoute';

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

// 2026-11-14 (flow 3): the push path used to have its own copy of the old
// inline rule, so a *push* for a host notice still opened the attendee page.
// Both entry points now resolve through notificationRoute; these pin that.
const noLinks = () => null;

describe('routeFromPushData (tapped push)', () => {
  it('agrees with the in-app list for every notification type that carries ids', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ type: 'host_day_of', eventId: 'e1', businessId: 'b1' }, '/business/manage-event/e1'],
      [{ type: 'host_post_event_summary', eventId: 'e1' }, '/business/manage-event/e1?checklist=1'],
      [{ type: 'host_verification_update', businessId: 'b1' }, '/settings'],
      [{ type: 'host_standing_update', businessId: 'b1' }, '/settings'],
      [{ type: 'chat_message', eventId: 'e1' }, '/event-chat/e1'],
      [{ type: 'chat_mention', eventId: 'e1', messageId: 'm2' }, '/event-chat/e1?messageId=m2'],
      [{ type: 'rsvp', eventId: 'e1', businessId: 'b1' }, '/event/e1'],
      [{ type: 'event_reminder', eventId: 'e1' }, '/event/e1'],
      [{ type: 'event_update', eventId: 'e1' }, '/event/e1'],
      [{ type: 'waitlist', eventId: 'e1' }, '/event/e1'],
      [{ type: 'moderation', eventId: 'e1' }, '/event/e1'],
      [{ type: 'report_update', eventId: 'e1' }, '/event/e1'],
      [{ type: 'host_announcement', eventId: 'e1' }, '/event/e1'],
      [{ type: 'interest_event', eventId: 'e1' }, '/event/e1'],
      [{ type: 'new_follower', businessId: 'b1' }, '/business/b1'],
      [{ type: 'new_event_from_followed', eventId: 'e1', businessId: 'b1' }, '/event/e1'],
    ];
    for (const [data, expected] of cases) {
      expect(routeFromPushData(data, noLinks), JSON.stringify(data)).toBe(expected);
      // and the in-app list, given the same fields, lands on the same screen
      expect(
        notificationRoute({
          type: String(data.type),
          eventId: data.eventId as string | undefined,
          businessId: data.businessId as string | undefined,
          messageId: data.messageId as string | undefined,
        }),
        `in-app ${JSON.stringify(data)}`
      ).toBe(expected);
    }
  });

  it('honours the chat triggers’ kind flag even without a chat type', () => {
    expect(routeFromPushData({ type: 'event_update', kind: 'chat', eventId: 'e1' }, noLinks)).toBe('/event-chat/e1');
  });

  it('falls back to the notification centre, not Discover, for a push that points nowhere', () => {
    expect(routeFromPushData({ type: 'promotion' }, noLinks)).toBe(PUSH_FALLBACK);
    expect(routeFromPushData(null, noLinks)).toBe(PUSH_FALLBACK);
    expect(routeFromPushData({ type: 'promotion', eventId: '', businessId: '' }, noLinks)).toBe(PUSH_FALLBACK);
    expect(notificationRoute({ type: 'promotion' })).toBe(IN_APP_FALLBACK);
  });

  it('uses a promotion deep link as the fallback, only when nothing else applies', () => {
    const parse = (url: string) => url.replace('myapp://', '');
    expect(routeFromPushData({ type: 'promotion', linkUrl: 'myapp://business/b9' }, parse)).toBe('/business/b9');
    expect(routeFromPushData({ type: 'promotion', linkUrl: 'myapp://business/b9', eventId: 'e1' }, parse)).toBe('/event/e1');
    expect(routeFromPushData({ type: 'promotion', linkUrl: 'https://example.com' }, parse)).toBe(PUSH_FALLBACK);
  });

  it('ignores non-string ids from an untyped payload', () => {
    expect(routeFromPushData({ type: 'rsvp', eventId: 42, businessId: { id: 'b1' } }, noLinks)).toBe(PUSH_FALLBACK);
  });
});
