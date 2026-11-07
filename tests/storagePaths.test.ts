import { describe, it, expect } from 'vitest';
import { eventImageObjectPaths } from '../utils/storagePaths';

const PUB = 'http://127.0.0.1:54321/storage/v1/object/public/event-images';

describe('eventImageObjectPaths', () => {
  it('maps public event-images URLs to object paths', () => {
    expect(eventImageObjectPaths(`${PUB}/u1/events/1-ab.jpg`)).toEqual(['u1/events/1-ab.jpg']);
    expect(eventImageObjectPaths(`${PUB}/u1/logos/1-ab.png?t=3`)).toEqual(['u1/logos/1-ab.png']);
  });

  it('includes the thumbnail sibling of marked uploads', () => {
    expect(eventImageObjectPaths(`${PUB}/u1/events/1-ab-t.jpg`)).toEqual([
      'u1/events/1-ab-t.jpg',
      'u1/events/1-ab-t.thumb.jpg',
    ]);
  });

  it('ignores other buckets and foreign URLs', () => {
    expect(eventImageObjectPaths('http://127.0.0.1:54321/storage/v1/object/public/avatars/u1/a.jpg')).toBeNull();
    expect(eventImageObjectPaths('https://example.com/event-images/u1/a.jpg')).toBeNull();
    expect(eventImageObjectPaths(`${PUB}/u1/events/bad%E0%A4%A.jpg`)).toBeNull();
  });
});

describe('rpcSignatureKey', () => {
  it('distinguishes call shapes of the same function, ignoring undefined args and order', async () => {
    const { rpcSignatureKey } = await import('../utils/rpcErrors');
    const withBan = rpcSignatureKey('host_remove_attendee', { p_event_id: 'e', p_user_id: 'u', p_ban: true });
    const without = rpcSignatureKey('host_remove_attendee', { p_user_id: 'u', p_event_id: 'e', p_ban: undefined });
    expect(withBan).not.toBe(without);
    expect(without).toBe('host_remove_attendee(p_event_id,p_user_id)');
  });
});
