import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HostTipId } from '@/utils/hostTips';

/**
 * Which one-time host tips this device has already shown, per host profile.
 *
 * Device-local on purpose for now: a tip repeating once on a second device is
 * a small cost next to a column the client cannot rely on yet. `businesses.
 * host_tips_seen text[]` (plan §6) can later back this with the same shape.
 */
export const hostTipsKey = (businessId: string) => `eventmap.hostTips.${businessId}`;

export async function readSeenTips(businessId: string): Promise<HostTipId[]> {
  try {
    const raw = await AsyncStorage.getItem(hostTipsKey(businessId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is HostTipId => typeof v === 'string') : [];
  } catch {
    // Corrupt or unavailable: showing a tip once more is harmless.
    return [];
  }
}

/** Records a tip as seen. Never un-sets, and never throws. */
export async function markTipSeen(businessId: string, tip: HostTipId): Promise<HostTipId[]> {
  const seen = await readSeenTips(businessId);
  if (seen.includes(tip)) return seen;
  const next = [...seen, tip];
  try {
    await AsyncStorage.setItem(hostTipsKey(businessId), JSON.stringify(next));
  } catch {
    // Best-effort.
  }
  return next;
}
