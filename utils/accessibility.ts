import { AccessibilityInfo, findNodeHandle, Platform } from 'react-native';
import type { Component } from 'react';

/**
 * Screen-reader helpers shared across the app.
 *
 * - announce(): speak a message on iOS and Android. `accessibilityLiveRegion`
 *   is Android-only, so anything that must be heard on iOS (toasts,
 *   validation errors) needs an explicit announcement.
 * - focusElement(): move VoiceOver / TalkBack focus to a view, e.g. a card
 *   or panel that just appeared, or the first invalid field.
 */

export function announce(message: string) {
  if (!message) return;
  AccessibilityInfo.announceForAccessibility(message);
}

// Small delay: focus set in the same frame the view mounts is often ignored
// (the native view isn't in the accessibility tree yet).
const FOCUS_DELAY_MS = 150;

export function focusElement(target: Component | null | undefined, delayMs = FOCUS_DELAY_MS) {
  if (Platform.OS === 'web' || !target) return () => {};
  const timer = setTimeout(() => {
    const tag = findNodeHandle(target);
    if (tag != null) AccessibilityInfo.setAccessibilityFocus(tag);
  }, delayMs);
  return () => clearTimeout(timer);
}

/**
 * Props for a chip / toggle that is one choice in a group. Selection must be
 * exposed as state, not only as color (WCAG 1.4.1 / 4.1.2).
 * - 'radio': single choice (category, plan period, report reason)
 * - 'checkbox': independent on/off choice in a multi-select group
 */
export function choiceA11y(selected: boolean, label: string, kind: 'radio' | 'checkbox' = 'radio') {
  return kind === 'checkbox'
    ? ({ accessibilityRole: 'checkbox', accessibilityLabel: label, accessibilityState: { checked: selected } } as const)
    : ({ accessibilityRole: 'radio', accessibilityLabel: label, accessibilityState: { selected } } as const);
}
