import AsyncStorage from '@react-native-async-storage/async-storage';

/** Local, per-user onboarding progress. Cleared when onboarding completes or is restarted. */
export const onboardingDraftKey = (userId: string) => `eventmap.onboardingDraft.${userId}`;

export async function clearOnboardingDraft(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(onboardingDraftKey(userId));
  } catch {
    // Best-effort; a stale draft is harmless because the flow prefills from the server.
  }
}
