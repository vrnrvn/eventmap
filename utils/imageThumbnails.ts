/**
 * Small image variants without a database column. New uploads (JPEG, which
 * every picker path produces) carry a marker in the file name and get a
 * 512 px sibling stored next to them:
 *
 *   <uid>/events/1730000000000-ab12c-t.jpg        original (≤1600 px)
 *   <uid>/events/1730000000000-ab12c-t.thumb.jpg  thumbnail (512 px wide)
 *
 * Small renders (list rows, logos) ask for the thumbnail only when the
 * marker is present, so images uploaded before this change keep loading
 * their original — no request ever goes to a thumbnail that doesn't exist.
 * Pure module (node-tested).
 */
export const THUMBNAIL_WIDTH = 512;
const MARKED = /-t\.jpg(?=$|[?#])/;

/** File name for a new JPEG upload that will have a thumbnail sibling. */
export function markedUploadName(base: string): string {
  return `${base}-t.jpg`;
}

/** Storage path (or URL) of the thumbnail sibling of a marked original. */
export function thumbnailOf(pathOrUrl: string): string {
  return pathOrUrl.replace(MARKED, '-t.thumb.jpg');
}

/** The thumbnail URL when `url` is a marked upload, else `url` unchanged. */
export function preferredThumbnailUrl<T extends string | null | undefined>(url: T): T {
  if (!url || !MARKED.test(url)) return url;
  return thumbnailOf(url) as T;
}
