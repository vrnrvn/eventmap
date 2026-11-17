import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform, findNodeHandle, type View } from 'react-native';

/**
 * Moves focus into an overlay when it opens: attach the returned ref to the
 * control that should receive it (usually the first one — the WAI-ARIA dialog
 * pattern).
 *
 * Overlays with a text field get this from `autoFocus`. Without a field,
 * React Native's `Modal` leaves focus on the trigger behind it: a keyboard
 * user tabs through the page underneath and a screen reader keeps reading the
 * screen below. Found on the host dashboard's date sheet (C6) and on
 * CollectionActionsSheet / EventPublishedSheet.
 *
 * Web gets DOM focus; native gets accessibility focus. `findNodeHandle`
 * throws on web, hence the branch.
 */
export function useFocusOnOpen<T extends View = View>(open: boolean, delayMs = 120) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!open) return;
    // After the Modal's open animation has mounted the content.
    const t = setTimeout(() => {
      const node = ref.current;
      if (!node) return;
      if (Platform.OS === 'web') {
        (node as unknown as { focus?: () => void }).focus?.();
        return;
      }
      const handle = findNodeHandle(node);
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    }, delayMs);
    return () => clearTimeout(t);
  }, [open, delayMs]);
  return ref;
}
