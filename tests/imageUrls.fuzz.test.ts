import { describe, it, expect } from 'vitest';
import { markedUploadName, preferredThumbnailUrl, thumbnailOf } from '../utils/imageThumbnails';
import { eventImageObjectPaths } from '../utils/storagePaths';

/** URL fuzzing for the thumbnail marker and the storage-path parser. */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const HOST = 'https://abc.supabase.co';
const PUBLIC = `${HOST}/storage/v1/object/public/event-images/`;

const SEGMENTS = [
  'uid-123',
  'events',
  'logos',
  'a-t.jpg', // marker-looking FOLDER name
  'x-t.jpg.d',
  '%2D',
  '%20space',
  'é',
  '%C3%A9',
  '東京',
  '🎉',
  'with space',
  '-t',
  '.jpg',
  '..',
  '',
];
const FILES_UNMARKED = [
  '1730000000000-ab12c.jpg',
  'photo.JPG',
  'photo-T.JPG',
  'photo-t.JPG',
  'photo-t.jpeg',
  'photo-t.jpg.png', // double extension
  'photo-t.jpgx',
  'photo-t.thumb.jpg', // already a thumbnail
  'photo-tt.jpg',
  'photo_t.jpg',
  'phot-t%2Ejpg',
  'logo.png',
  'x',
];
const SUFFIXES = ['', '?t=1', '?width=200&height=200', '#frag', '?a=1#b', '?', '#', '?download=photo.jpg'];

function randPath(r: Rng) {
  const n = int(r, 0, 4);
  return Array.from({ length: n }, () => pick(r, SEGMENTS)).join('/');
}

describe('preferredThumbnailUrl / thumbnailOf — fuzz', () => {
  it('never maps an unmarked URL (unmarked file name; suffix query/fragment does not end in "-t.jpg")', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 20_000; i++) {
      const url = `${pick(r, [PUBLIC, `${HOST}/other/`, 'file:///', ''])}${randPath(r)}/${pick(r, FILES_UNMARKED)}${pick(r, SUFFIXES)}`;
      expect(preferredThumbnailUrl(url), url).toBe(url);
    }
  });

  it('marked uploads: thumbnailOf(markedUploadName(base)) round-trips to base + "-t.thumb.jpg" (with any suffix)', () => {
    const r = mulberry32(2);
    for (let i = 0; i < 20_000; i++) {
      const base = `${randPath(r)}/${Date.now() - int(r, 0, 1e9)}-${Math.floor(r() * 36 ** 5).toString(36)}`;
      const suffix = pick(r, SUFFIXES);
      const marked = markedUploadName(base) + suffix;
      expect(thumbnailOf(marked), marked).toBe(`${base}-t.thumb.jpg${suffix}`);
      expect(preferredThumbnailUrl(marked)).toBe(`${base}-t.thumb.jpg${suffix}`);
      // Idempotent: a thumbnail URL is not re-mapped.
      expect(preferredThumbnailUrl(preferredThumbnailUrl(marked))).toBe(preferredThumbnailUrl(marked));
    }
  });

  it('only the file-name marker is rewritten, never a marker-looking folder', () => {
    expect(thumbnailOf('u/a-t.jpg/b-t.jpg')).toBe('u/a-t.jpg/b-t.thumb.jpg');
    expect(thumbnailOf('u/a-t.jpg/b.png')).toBe('u/a-t.jpg/b.png');
    expect(preferredThumbnailUrl(`${PUBLIC}u/a-t.jpg/b-t.jpg?x=1`)).toBe(`${PUBLIC}u/a-t.jpg/b-t.thumb.jpg?x=1`);
  });

  it('null / undefined / empty pass through with their type', () => {
    expect(preferredThumbnailUrl(null)).toBeNull();
    expect(preferredThumbnailUrl(undefined)).toBeUndefined();
    expect(preferredThumbnailUrl('')).toBe('');
  });

  it('documented: an unmarked file whose query/fragment ENDS in "-t.jpg" is rewritten (only the suffix changes)', () => {
    // The regex anchors on end-of-string / ? / #, not on the path, so a
    // trailing "-t.jpg" in a query value or fragment matches. URLs come from
    // our own storage (no such queries), so this is theoretical.
    expect(preferredThumbnailUrl(`${PUBLIC}u/a.png?ref=b-t.jpg`)).toBe(`${PUBLIC}u/a.png?ref=b-t.thumb.jpg`);
    expect(preferredThumbnailUrl(`${PUBLIC}u/a.png#b-t.jpg`)).toBe(`${PUBLIC}u/a.png#b-t.thumb.jpg`);
    // Storage cleanup is immune: it only looks at the path part.
    expect(eventImageObjectPaths(`${PUBLIC}u/a.png?ref=b-t.jpg`)).toEqual(['u/a.png']);
  });
});

describe('eventImageObjectPaths — fuzz', () => {
  const CHARS = 'abc/%?#-.t_jpgéœ東🎉 \u0000𐀀%ED%A0%80%E0%A4%A%'.split('');

  it('never throws on 30k random strings and returns null or a non-empty list of decoded paths', () => {
    const r = mulberry32(3);
    for (let i = 0; i < 30_000; i++) {
      const prefix = pick(r, ['', PUBLIC, `${HOST}/storage/v1/object/public/other/`, `${PUBLIC}${PUBLIC}`, 'x' + PUBLIC]);
      let tail = '';
      for (let k = int(r, 0, 30); k > 0; k--) tail += pick(r, CHARS);
      const url = prefix + tail;
      let out: string[] | null = null;
      expect(() => (out = eventImageObjectPaths(url)), JSON.stringify(url)).not.toThrow();
      if (out !== null) {
        const paths = out as string[];
        expect(paths.length === 1 || paths.length === 2).toBe(true);
        expect(paths[0].length).toBeGreaterThan(0);
        if (paths.length === 2) expect(paths[1]).toBe(thumbnailOf(paths[0]));
      }
    }
  });

  it('round-trip: encodeURI-ed marked/unmarked paths decode back; marked ones include the thumbnail', () => {
    const r = mulberry32(4);
    for (let i = 0; i < 5_000; i++) {
      const dir = randPath(r).replace(/%/g, '');
      const marked = r() < 0.5;
      const file = marked ? markedUploadName(`f${i}`) : pick(r, FILES_UNMARKED).replace(/%/g, '');
      const raw = dir ? `${dir}/${file}` : file;
      const url = PUBLIC + raw.split('/').map(encodeURIComponent).join('/') + pick(r, SUFFIXES);
      const out = eventImageObjectPaths(url);
      expect(out?.[0], url).toBe(raw);
      expect(out?.length, url).toBe(marked ? 2 : 1);
    }
  });

  it('malformed %-escapes → null, not a throw', () => {
    for (const bad of ['%', '%E0%A4%A', '%ED%A0%80', '%FF', 'a%2']) {
      expect(eventImageObjectPaths(`${PUBLIC}u/${bad}.jpg`), bad).toBeNull();
    }
  });

  it('non-event-images URLs → null', () => {
    expect(eventImageObjectPaths(`${HOST}/storage/v1/object/public/avatars/u/x.jpg`)).toBeNull();
    expect(eventImageObjectPaths(`${HOST}/storage/v1/object/sign/event-images/u/x.jpg`)).toBeNull();
    expect(eventImageObjectPaths(`${PUBLIC}`)).toBeNull();
    expect(eventImageObjectPaths(`${PUBLIC}?x=1`)).toBeNull();
    expect(eventImageObjectPaths('')).toBeNull();
  });
});
