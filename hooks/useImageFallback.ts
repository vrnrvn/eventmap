import { useCallback, useState } from 'react';
import { preferredThumbnailUrl } from '@/utils/imageThumbnails';

/**
 * Whether the image at `uri` failed to load (offline and not in expo-image's
 * disk cache, deleted, blocked), so the caller can show its placeholder
 * instead of an empty box. Resets when the uri changes. The error event's
 * payload is ignored.
 *
 * `thumbnail: true` (small renders: list rows, logos) loads the 512 px
 * sibling of uploads that have one (utils/imageThumbnails) via `src`; if that
 * fails it falls back to the original once, and only then reports `failed`.
 */
export function useImageFallback(uri: string | null | undefined, opts?: { thumbnail?: boolean }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [thumbFailedFor, setThumbFailedFor] = useState<string | null>(null);
  const thumb = opts?.thumbnail ? preferredThumbnailUrl(uri) : uri;
  const useThumb = !!uri && thumb !== uri && thumbFailedFor !== uri;
  const src = useThumb ? thumb : uri;
  const failed = !!uri && failedUri === uri;
  const onError = useCallback(() => {
    if (!uri) return;
    if (useThumb) setThumbFailedFor(uri);
    else setFailedUri(uri);
  }, [uri, useThumb]);
  return { failed, onError, src: src ?? null };
}
