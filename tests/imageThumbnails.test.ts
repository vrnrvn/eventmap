import { describe, it, expect } from 'vitest';
import { markedUploadName, preferredThumbnailUrl, thumbnailOf } from '../utils/imageThumbnails';

const BASE = 'https://x.supabase.co/storage/v1/object/public/event-images/u1/events';

describe('image thumbnails', () => {
  it('marked uploads map to their sibling; paths and URLs alike', () => {
    expect(markedUploadName('123-ab')).toBe('123-ab-t.jpg');
    expect(thumbnailOf('u1/events/123-ab-t.jpg')).toBe('u1/events/123-ab-t.thumb.jpg');
    expect(preferredThumbnailUrl(`${BASE}/123-ab-t.jpg`)).toBe(`${BASE}/123-ab-t.thumb.jpg`);
    expect(preferredThumbnailUrl(`${BASE}/123-ab-t.jpg?v=2`)).toBe(`${BASE}/123-ab-t.thumb.jpg?v=2`);
  });

  it('legacy and foreign images are left alone (no request to a missing thumbnail)', () => {
    for (const url of [
      `${BASE}/123-ab.jpg`,
      `${BASE}/123-ab.png`,
      `${BASE}/my-t.jpg-folder/x.jpg`,
      'https://example.com/a.jpg',
      `${BASE}/123-ab-t.thumb.jpg`,
    ]) {
      expect(preferredThumbnailUrl(url)).toBe(url);
    }
    expect(preferredThumbnailUrl(null)).toBeNull();
    expect(preferredThumbnailUrl(undefined)).toBeUndefined();
  });
});
