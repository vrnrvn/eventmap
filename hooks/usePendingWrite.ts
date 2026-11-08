import { useEffect, useState } from 'react';
import { getPendingWrites, subscribePendingWrites } from '@/services/pendingWrites';
import type { PendingWrite } from '@/utils/pendingWrites';

/**
 * The intent queued offline for one target (e.g. a save for this event), or
 * null. Lets a screen show "will sync" on the control instead of pretending
 * the change already reached the server (docs/OFFLINE_PLAN.md §3.9).
 */
export function usePendingWrite(kind: PendingWrite['kind'], targetId: string | null | undefined): PendingWrite | null {
  const find = () => (targetId ? getPendingWrites().find((w) => w.kind === kind && w.targetId === targetId) ?? null : null);
  const [pending, setPending] = useState<PendingWrite | null>(find);
  useEffect(() => {
    setPending(find());
    return subscribePendingWrites(() => setPending(find()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, targetId]);
  return pending;
}
