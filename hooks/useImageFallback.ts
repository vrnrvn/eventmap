import { useCallback, useState } from 'react';

/**
 * Whether the image at `uri` failed to load (offline, deleted, blocked), so
 * the caller can show its placeholder instead of an empty box. Resets when
 * the uri changes. (docs/OFFLINE_PLAN.md §3.10 — until expo-image adds disk
 * caching, images need the network.)
 */
export function useImageFallback(uri: string | null | undefined) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const failed = !!uri && failedUri === uri;
  const onError = useCallback(() => {
    if (uri) setFailedUri(uri);
  }, [uri]);
  return { failed, onError };
}
