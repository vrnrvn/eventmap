import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Unit tests for pure logic only — no React Native renderer, no Metro, no
 * backend. Modules under test must not import Expo/RN native modules; where a
 * helper is worth testing but lives next to RN code, extract the pure part
 * (see utils/authCallback.ts) rather than mocking the native surface here.
 *
 * `react-native` is aliased to a tiny stub so modules that only need `Platform`
 * stay testable. Tests set `__TEST_PLATFORM__` to pick the platform under test.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The *.dom.test.ts suites boot the generated map HTML in jsdom.
    environmentMatchGlobs: [['tests/**/*.dom.test.ts', 'jsdom']],
  },
  resolve: {
    // Order matters: the icon aliases must win over the generic '@' prefix.
    alias: [
      { find: 'react-native', replacement: path.resolve(root, 'tests/stubs/react-native.ts') },
      // App code imports icons via the generated deep-import module
      // (components/icons.generated.ts); tests stub it like the package.
      {
        find: '@/components/icons.generated',
        replacement: path.resolve(root, 'tests/stubs/lucide-react-native.ts'),
      },
      { find: /^lucide-react-native(\/.*)?$/, replacement: path.resolve(root, 'tests/stubs/lucide-react-native.ts') },
      { find: '@', replacement: path.resolve(root) },
    ],
  },
});
