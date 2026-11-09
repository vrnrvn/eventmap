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
 * Accessibility state that reaches every platform.
 *
 * react-native-web (0.19+) drops `accessibilityState` entirely: only the
 * `aria-*` props reach the DOM. React Native (0.73+) maps those same props
 * into the native state, so emitting both keeps one call site per control.
 * Spread the result: `{...a11yState({ selected })}`.
 */
export type A11yState = {
  selected?: boolean;
  checked?: boolean | 'mixed';
  disabled?: boolean;
  expanded?: boolean;
  busy?: boolean;
};

export function a11yState(state: A11yState, role?: 'button') {
  return {
    accessibilityState: state,
    // On a plain button "selected" means a toggle: aria-selected is not
    // allowed there, aria-pressed is (native has no pressed state and keeps
    // reading `selected`).
    ...(state.selected !== undefined
      ? role === 'button'
        ? Platform.OS === 'web'
          ? { 'aria-pressed': state.selected }
          : null
        : { 'aria-selected': state.selected }
      : null),
    ...(state.checked !== undefined ? { 'aria-checked': state.checked } : null),
    ...(state.disabled !== undefined ? { 'aria-disabled': state.disabled } : null),
    ...(state.expanded !== undefined ? { 'aria-expanded': state.expanded } : null),
    ...(state.busy !== undefined ? { 'aria-busy': state.busy } : null),
  };
}

/**
 * Props for a chip / toggle that is one choice in a group. Selection must be
 * exposed as state, not only as color (WCAG 1.4.1 / 4.1.2).
 * - 'radio': single choice (category, plan period, report reason)
 * - 'checkbox': independent on/off choice in a multi-select group
 */
export function choiceA11y(selected: boolean, label: string, kind: 'radio' | 'checkbox' = 'radio') {
  return kind === 'checkbox'
    ? ({ accessibilityRole: 'checkbox', accessibilityLabel: label, ...a11yState({ checked: selected }) } as const)
    // A radio exposes `checked` (aria-checked is required on role=radio;
    // `selected` renders aria-selected, which is invalid there).
    : ({ accessibilityRole: 'radio', accessibilityLabel: label, ...a11yState({ checked: selected }) } as const);
}
