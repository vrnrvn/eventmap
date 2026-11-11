import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Device-local part of the getting-started checklist (utils/hostChecklist):
 * things the server does not record (a share, opening the hub) and the card's
 * own state. Per host profile, best-effort: losing it only re-shows an item.
 */
export type HostChecklistLocal = {
  sharedEvent: boolean;
  openedManage: boolean;
  dismissed: boolean;
  /** null until first evaluated; then fixed, so a host never flips category. */
  preexistingHost: boolean | null;
};

export const EMPTY_CHECKLIST_LOCAL: HostChecklistLocal = {
  sharedEvent: false,
  openedManage: false,
  dismissed: false,
  preexistingHost: null,
};

export const hostChecklistKey = (businessId: string) => `eventmap.hostChecklist.${businessId}`;

export async function readChecklistLocal(businessId: string): Promise<HostChecklistLocal> {
  try {
    const raw = await AsyncStorage.getItem(hostChecklistKey(businessId));
    if (!raw) return { ...EMPTY_CHECKLIST_LOCAL };
    const o = JSON.parse(raw) as Partial<HostChecklistLocal>;
    return {
      sharedEvent: o.sharedEvent === true,
      openedManage: o.openedManage === true,
      dismissed: o.dismissed === true,
      preexistingHost: typeof o.preexistingHost === 'boolean' ? o.preexistingHost : null,
    };
  } catch {
    return { ...EMPTY_CHECKLIST_LOCAL };
  }
}

export async function updateChecklistLocal(
  businessId: string,
  patch: Partial<HostChecklistLocal>
): Promise<HostChecklistLocal> {
  const next = { ...(await readChecklistLocal(businessId)), ...patch };
  try {
    await AsyncStorage.setItem(hostChecklistKey(businessId), JSON.stringify(next));
  } catch {
    // Best-effort.
  }
  return next;
}

/** Record a one-way signal (share, hub visit). Never un-sets. */
export function markChecklistSignal(businessId: string | null | undefined, signal: 'sharedEvent' | 'openedManage'): void {
  if (!businessId) return;
  void updateChecklistLocal(businessId, { [signal]: true });
}
