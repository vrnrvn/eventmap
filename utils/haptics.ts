import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Fire-and-forget haptics that are a no-op on web and never throw.
 * Use these instead of calling expo-haptics directly from screens.
 */
export function tapHaptic(style: 'light' | 'medium' = 'light'): void {
  if (Platform.OS === 'web') return;
  const impact =
    style === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light;
  Haptics.impactAsync(impact).catch(() => {});
}

export function selectionHaptic(): void {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync().catch(() => {});
}

export function successHaptic(): void {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
