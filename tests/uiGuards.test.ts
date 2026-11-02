import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repo-scan guards against UI regressions: wrong brand spellings, banned
 * legacy colors, the retired support address, deleted components resurfacing,
 * forced-light configuration, and new ad-hoc local palettes.
 *
 * These tests reflect the repo's current state. Allowlists below document
 * known remaining offenders — shrink them, never grow them.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['app', 'screens', 'components'];

/** Recursively list all .tsx files under the given directory. */
function listTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listTsxFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      results.push(full);
    }
  }
  return results;
}

const sourceFiles = SCAN_DIRS.flatMap((dir) => {
  const full = path.join(repoRoot, dir);
  return fs.existsSync(full) ? listTsxFiles(full) : [];
});

/** Repo-relative, forward-slash path for stable reporting/allowlists. */
function rel(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

/** Return `relativePath:line: text` hits for every match of `pattern`. */
function findMatches(
  pattern: RegExp,
  files: string[] = sourceFiles,
): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, index) => {
      if (pattern.test(text)) {
        hits.push({ file: rel(file), line: index + 1, text: text.trim() });
      }
    });
  }
  return hits;
}

function formatHits(hits: Array<{ file: string; line: number; text: string }>): string {
  return hits.map((h) => `${h.file}:${h.line}: ${h.text}`).join('\n');
}

it('scans a sane number of source files', () => {
  // Guard the guard: if the walker breaks, every scan would pass vacuously.
  expect(sourceFiles.length).toBeGreaterThan(50);
});

describe('brand spelling', () => {
  // The canonical display name is "EventMap" (see app/(auth)/welcome.tsx,
  // components/BrandedSplashScreen.tsx). Empty: all copy is compliant.
  const BRAND_ALLOWLIST = new Set<string>([]);

  it('no new "EventMaps" / "Event Maps" spellings appear', () => {
    const hits = findMatches(/EventMaps|Event Maps/).filter(
      (h) => !BRAND_ALLOWLIST.has(h.file),
    );
    expect(
      hits.length,
      `Wrong brand spelling (use "EventMap"):\n${formatHits(hits)}`,
    ).toBe(0);
  });

  it('brand allowlist only shrinks', () => {
    const offenders = new Set(findMatches(/EventMaps|Event Maps/).map((h) => h.file));
    for (const file of offenders) {
      expect(
        BRAND_ALLOWLIST.has(file),
        `${file} has a wrong brand spelling but is not in the (frozen) allowlist`,
      ).toBe(true);
    }
  });
});

describe('banned colors', () => {
  const BANNED_COLOR_PATTERNS: Array<[string, RegExp]> = [
    ['#EC4899', /#EC4899/i],
    ['#F43F5E', /#F43F5E/i],
    ['#EF4444', /#EF4444/i],
    ['rgba(196, 92, 62', /rgba\(196,\s*92,\s*62/],
  ];

  for (const [label, pattern] of BANNED_COLOR_PATTERNS) {
    it(`${label} is absent`, () => {
      const hits = findMatches(pattern);
      expect(
        hits.length,
        `Banned color ${label} found (use a theme token):\n${formatHits(hits)}`,
      ).toBe(0);
    });
  }
});

describe('support email', () => {
  it('old address support@eventmaps.app is absent', () => {
    const hits = findMatches(/support@eventmaps\.app/i);
    expect(
      hits.length,
      `Old support address found:\n${formatHits(hits)}`,
    ).toBe(0);
  });
});

describe('deleted components stay deleted', () => {
  it('components/AddressMapPicker.tsx does not exist', () => {
    expect(fs.existsSync(path.join(repoRoot, 'components', 'AddressMapPicker.tsx'))).toBe(
      false,
    );
  });
});

describe('app.json', () => {
  it('forces light mode via userInterfaceStyle', () => {
    const appJson = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'app.json'), 'utf8'),
    ) as { expo?: { userInterfaceStyle?: string } };
    expect(appJson.expo?.userInterfaceStyle).toBe('light');
  });
});

describe('local Palette declarations', () => {
  // KNOWN OFFENDERS — screens still carrying a local `const Palette = {`
  // instead of using constants/theme tokens directly. Migrate them and
  // shrink this allowlist; adding NEW local palettes is a regression.
  const PALETTE_ALLOWLIST = new Set([
    'app/(auth)/welcome.tsx',
    'app/(onboarding)/index.tsx',
    'app/(tabs)/create.tsx',
    'app/(tabs)/notifications.tsx',
    'app/(tabs)/profile.tsx',
    'app/premium/manage.tsx',
    'app/premium/plans.tsx',
    'screens/Settings.tsx',
  ]);

  it('the set of files with a local Palette does not grow', () => {
    const offenders = new Set(
      findMatches(/const Palette = \{/).map((h) => h.file),
    );
    const newOffenders = [...offenders].filter((f) => !PALETTE_ALLOWLIST.has(f));
    expect(
      newOffenders.length,
      `New local Palette declarations (use constants/theme tokens instead):\n` +
        newOffenders.join('\n'),
    ).toBe(0);
  });
});
