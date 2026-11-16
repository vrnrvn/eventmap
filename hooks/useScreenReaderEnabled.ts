import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether VoiceOver / TalkBack is running. Use it to adapt timing (e.g. keep
 * toasts up longer) — never to hide content or change what is announced.
 *
 * On web this is always true: react-native-web's
 * `AccessibilityInfo.isScreenReaderEnabled()` resolves `true` unconditionally
 * because a browser cannot detect a screen reader. Anything that changes
 * layout on it must check `Platform.OS !== 'web'` as well.
 */
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return enabled;
}
