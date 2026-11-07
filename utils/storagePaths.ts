import { thumbnailOf } from './imageThumbnails';

/**
 * Object paths in the event-images bucket for a public URL, including the
 * thumbnail sibling of marked uploads (utils/imageThumbnails). Null for
 * anything that isn't a public event-images URL. Pure (node-tested).
 */
export function eventImageObjectPaths(url: string): string[] | null {
  const m = /\/storage\/v1\/object\/public\/event-images\/([^?#]+)/.exec(url);
  if (!m) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[1]);
  } catch {
    return null; // malformed %-escape: not something we uploaded
  }
  const thumb = thumbnailOf(path);
  return thumb === path ? [path] : [path, thumb];
}
