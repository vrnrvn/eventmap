import { supabase } from './supabase';
import { eventImageObjectPaths } from '@/utils/storagePaths';
import { getConnectivity } from '@/utils/connectivity';
import {
  isMissingDbFunction,
  isRpcKnownMissing,
  markRpcMissing,
} from '@/utils/rpcErrors';

const RPC = 'unreferenced_owned_images';

/**
 * Best-effort removal of event-images files after the rows pointing at them
 * were deleted or replaced. Only files the DATABASE confirms are referenced
 * nowhere are removed (prepared migration 20261106170000): one file can back
 * several rows (duplicated events share photos; a cover can be a photo), and
 * a client-side check can't see every row. While that function is missing
 * this does nothing. Never throws; call it fire-and-forget after the write.
 */
export function releaseEventImages(urls: readonly (string | null | undefined)[]): void {
  const candidates = Array.from(
    new Set(urls.filter((u): u is string => !!u && eventImageObjectPaths(u) !== null))
  );
  if (candidates.length === 0 || isRpcKnownMissing(RPC)) return;
  void (async () => {
    try {
      const { data, error } = await (
        supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => ReturnType<typeof supabase.rpc>
      )(RPC, { p_urls: candidates });
      if (error) {
        if (isMissingDbFunction(error)) markRpcMissing(RPC);
        return;
      }
      const paths = ((data ?? []) as string[]).flatMap((u) => eventImageObjectPaths(u) ?? []);
      if (paths.length) await supabase.storage.from('event-images').remove(paths);
    } catch {
      // Orphaned files are harmless; never surface cleanup failures.
    }
  })();
}

/**
 * False once this session found the reference-check function missing, so
 * callers can skip the extra reads they do to collect URLs for cleanup.
 */
export function imageCleanupMayRun(): boolean {
  // Also skipped on a weak/absent connection: the pre-read would make the
  // user's edit wait out a request timeout first. An orphaned file is harmless.
  return !isRpcKnownMissing(RPC) && getConnectivity() === 'online';
}
