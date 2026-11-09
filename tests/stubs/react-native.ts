/**
 * Minimal `react-native` stub for unit tests (see vitest.config.ts).
 * Only covers what pure modules under test actually touch. Tests choose the
 * platform by setting `globalThis.__TEST_PLATFORM__` before importing.
 */
declare global {
  var __TEST_PLATFORM__: 'ios' | 'android' | 'web' | undefined;
}

export const Platform = {
  get OS(): 'ios' | 'android' | 'web' {
    return globalThis.__TEST_PLATFORM__ ?? 'ios';
  },
  select<T>(spec: { ios?: T; android?: T; web?: T; default?: T }): T | undefined {
    return spec[Platform.OS] ?? spec.default;
  },
};

/** Alert.alert is a no-op on web and never called in unit tests. */
export const Alert = { alert: () => {} };
