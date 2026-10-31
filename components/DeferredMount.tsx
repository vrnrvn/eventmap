import { useEffect, useState, type ReactNode } from 'react';
import { InteractionManager, View, type ViewStyle } from 'react-native';

type DeferredMountProps = {
  children: ReactNode;
  /** Rendered in place of `children` until mounting. Should reserve the same space. */
  placeholder?: ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Extra delay after interactions settle. Keep small; this is jank insurance. */
  delayMs?: number;
};

/**
 * Renders `children` only once the screen has finished animating in.
 *
 * Embedded maps are the motivating case: each one builds ~200 KB of inlined
 * Leaflet and spins up a WebView, and on the event and business pages that map
 * sits well below the fold. Doing that work during the navigation transition
 * makes the push animation stutter for content the user hasn't reached yet.
 *
 * `InteractionManager` resolves after the running animation completes, so the
 * map still loads promptly — well before a user can scroll down to it — but no
 * longer competes with the transition.
 *
 * Deliberately not used for the Discover map or the location pickers, where the
 * map *is* the screen's primary content.
 */
export function DeferredMount({
  children,
  placeholder = null,
  style,
  delayMs = 0,
}: DeferredMountProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handle = InteractionManager.runAfterInteractions(() => {
      if (delayMs > 0) {
        timer = setTimeout(() => setReady(true), delayMs);
      } else {
        setReady(true);
      }
    });
    return () => {
      handle.cancel();
      if (timer) clearTimeout(timer);
    };
  }, [delayMs]);

  // Always the same wrapper so the layout tree doesn't change shape when the
  // real content swaps in — only its children change.
  return <View style={style}>{ready ? children : placeholder}</View>;
}
