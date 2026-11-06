import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Business, Profile } from '@/types/database';
import {
  isBusinessSnapshot,
  isProfileSnapshot,
  parseSnapshot,
  serializeSnapshot,
  snapshotKeys,
  type BusinessSnapshotData,
  type ProfileSnapshotData,
} from '@/utils/offlineSnapshot';
import { outboxPrefix } from '@/utils/chatOutbox';
import { draftKeys } from '@/utils/formDraft';

/**
 * Device-local snapshots of the signed-in user's profile, business and
 * premium state (docs/OFFLINE_PLAN.md §3.6), so the app opens straight into
 * the tabs with the last known data — offline, or before the network
 * answers. All storage access is best-effort: a failed read is "no
 * snapshot" and a failed write is ignored. Cleared on sign-out.
 */

async function read(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  AsyncStorage.setItem(key, value).catch(() => {});
}

export async function readProfileSnapshot(userId: string) {
  return parseSnapshot(await read(snapshotKeys.profile(userId)), userId, isProfileSnapshot<Profile>(userId));
}

export function writeProfileSnapshot(userId: string, data: ProfileSnapshotData<Profile>) {
  // Only onboarded profiles are ever read back (see isProfileSnapshot).
  if (data.profile.has_completed_onboarding !== true) {
    AsyncStorage.removeItem(snapshotKeys.profile(userId)).catch(() => {});
    return;
  }
  write(snapshotKeys.profile(userId), serializeSnapshot(userId, data));
}

export async function readBusinessSnapshot(userId: string) {
  return parseSnapshot(await read(snapshotKeys.business(userId)), userId, isBusinessSnapshot<Business>(userId));
}

export function writeBusinessSnapshot(userId: string, data: BusinessSnapshotData<Business>) {
  write(snapshotKeys.business(userId), serializeSnapshot(userId, data));
}

export async function readPremiumSnapshot<T>(businessId: string, isValid: (data: unknown) => data is T) {
  return parseSnapshot(await read(snapshotKeys.premium(businessId)), businessId, isValid);
}

export function writePremiumSnapshot<T>(businessId: string, data: T) {
  write(snapshotKeys.premium(businessId), serializeSnapshot(businessId, data));
}

/** Removes everything kept on the device for this user, cached lists included (call on sign-out). */
export async function clearOfflineSnapshots(userId: string) {
  const business = await readBusinessSnapshot(userId);
  const keys = [
    snapshotKeys.profile(userId),
    snapshotKeys.business(userId),
    snapshotKeys.queryCache(userId),
    snapshotKeys.pendingWrites(userId),
  ];
  if (business?.data.business) keys.push(snapshotKeys.premium(business.data.business.id));
  // Per-item keys: chat outboxes (one per room) and event form drafts.
  const all = await AsyncStorage.getAllKeys().catch(() => [] as readonly string[]);
  keys.push(
    ...all.filter(
      (k) =>
        k.startsWith(outboxPrefix(userId)) ||
        k === draftKeys.createEvent(userId) ||
        k.startsWith(draftKeys.editEvent(userId, ''))
    )
  );
  await AsyncStorage.multiRemove(keys).catch(() => {});
}
