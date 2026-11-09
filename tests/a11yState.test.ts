import { describe, expect, it } from 'vitest';
import { a11yState, choiceA11y } from '@/utils/accessibility';

/**
 * react-native-web drops `accessibilityState`; only aria-* props reach the
 * DOM. The helper must emit both so one call site serves every platform.
 */
describe('a11yState', () => {
  it('emits the native state and the matching aria props', () => {
    expect(a11yState({ selected: true })).toEqual({ accessibilityState: { selected: true }, 'aria-selected': true });
    expect(a11yState({ disabled: false, busy: true })).toEqual({
      accessibilityState: { disabled: false, busy: true },
      'aria-disabled': false,
      'aria-busy': true,
    });
    expect(a11yState({ expanded: true, checked: 'mixed' })).toMatchObject({ 'aria-expanded': true, 'aria-checked': 'mixed' });
  });

  it('a toggle button gets aria-pressed on web, never aria-selected', () => {
    globalThis.__TEST_PLATFORM__ = 'web';
    try {
      const props = a11yState({ selected: true }, 'button') as Record<string, unknown>;
      expect(props.accessibilityState).toEqual({ selected: true });
      expect(props).not.toHaveProperty('aria-selected');
      expect(props['aria-pressed']).toBe(true);
    } finally {
      globalThis.__TEST_PLATFORM__ = undefined;
    }
    // Native keeps only the state (no pressed state exists there).
    expect(Object.keys(a11yState({ selected: true }, 'button'))).toEqual(['accessibilityState']);
  });

  it('omits aria props for keys that were not given', () => {
    expect(Object.keys(a11yState({ selected: false }))).toEqual(['accessibilityState', 'aria-selected']);
  });
});

describe('choiceA11y', () => {
  it('a radio choice exposes checked (aria-checked is required on role=radio)', () => {
    const props = choiceA11y(true, 'Music');
    expect(props).toMatchObject({ accessibilityRole: 'radio', accessibilityLabel: 'Music', 'aria-checked': true });
    expect(props.accessibilityState).toEqual({ checked: true });
    expect(props).not.toHaveProperty('aria-selected');
  });

  it('a checkbox choice exposes checked', () => {
    expect(choiceA11y(false, 'Food', 'checkbox')).toMatchObject({ accessibilityRole: 'checkbox', 'aria-checked': false });
  });
});
