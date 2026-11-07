import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * scripts/generate-icons.mjs is idempotent: regenerating from the current
 * sources reproduces components/icons.generated.ts byte for byte.
 *
 * The script writes into the repo root it lives in, so it runs from a
 * throwaway mirror (script copied, sources symlinked, node_modules linked)
 * and the real working tree is never touched — another engineer may be
 * editing it in parallel.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = path.join(ROOT, 'components/icons.generated.ts');
const SOURCE_DIRS = ['app', 'screens', 'components', 'constants', 'hooks', 'utils'];

/** Real directories, symlinked files (the script's walk skips symlinked dirs). */
function mirror(src: string, dst: string, skip: (rel: string) => boolean, rel = '') {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (skip(r)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) mirror(s, d, skip, r);
    else if (e.isFile()) fs.symlinkSync(s, d);
  }
}

let tmp: string;
function runGenerator() {
  const res = spawnSync(process.execPath, [path.join(tmp, 'scripts/generate-icons.mjs')], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  return res;
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-gen-'));
  fs.mkdirSync(path.join(tmp, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts/generate-icons.mjs'), path.join(tmp, 'scripts/generate-icons.mjs'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
  for (const dir of SOURCE_DIRS) {
    if (!fs.existsSync(path.join(ROOT, dir))) continue;
    mirror(path.join(ROOT, dir), path.join(tmp, dir), (rel) => rel === 'icons.generated.ts' && dir === 'components');
  }
});

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('scripts/generate-icons.mjs', () => {
  it('regenerates components/icons.generated.ts byte-for-byte (idempotent), twice in a row', () => {
    const committed = fs.readFileSync(GENERATED, 'utf8');
    const out = path.join(tmp, 'components/icons.generated.ts');
    for (let i = 0; i < 2; i++) {
      const res = runGenerator();
      expect(res.status, res.stderr).toBe(0);
      expect(res.stdout).toMatch(/components\/icons\.generated\.ts: \d+ icons/);
      expect(fs.readFileSync(out, 'utf8')).toBe(committed);
    }
  }, 60_000);

  it('every deep import in the generated file exists, and names are unique and sorted', () => {
    const lines = fs.readFileSync(GENERATED, 'utf8').split('\n').filter((l) => l.startsWith('export'));
    const names: string[] = [];
    for (const line of lines) {
      const m = /^export \{ default as (\w+) \} from '(lucide-react-native\/dist\/esm\/icons\/[\w-]+\.js)';$/.exec(line);
      expect(m, line).not.toBeNull();
      names.push(m![1]);
      expect(fs.existsSync(path.join(ROOT, 'node_modules', m![2])), m![2]).toBe(true);
    }
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(names);
    expect(fs.readFileSync(GENERATED, 'utf8')).toContain(`only these ${names.length} icons`);
  });

  it('every icon name imported anywhere in app code is exported by the generated file (not only the scanned dirs)', () => {
    const exported = new Set(
      [...fs.readFileSync(GENERATED, 'utf8').matchAll(/default as (\w+) \}/g)].map((m) => m[1])
    );
    const importRe = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'(?:lucide-react-native|@\/components\/icons\.generated)'/gs;
    const missing: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'tests', 'admin', 'types'].includes(e.name) || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) {
          for (const m of fs.readFileSync(p, 'utf8').matchAll(importRe)) {
            for (const piece of m[1].split(',')) {
              const name = piece.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
              if (name && !exported.has(name)) missing.push(`${path.relative(ROOT, p)}: ${name}`);
            }
          }
        }
      }
    };
    walk(ROOT);
    expect(missing).toEqual([]);
  });
});
