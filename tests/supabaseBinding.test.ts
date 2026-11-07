import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * supabase-js client methods (rpc, from, …) read `this`; storing one in a
 * variable and calling it later throws "Cannot read properties of undefined
 * (reading 'rest')". That silently broke the event page's live count poll and
 * the app's create-event call. Guard: any extracted client method must be
 * `.bind(supabase)`-ed.
 */
describe('supabase client methods are never extracted unbound', () => {
  const root = path.resolve(__dirname, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  };
  for (const d of ['app', 'screens', 'components', 'hooks', 'services', 'contexts', 'utils']) walk(path.join(root, d));

  it('no `= supabase.<method>` without bind', () => {
    const offenders: string[] = [];
    const re = /=\s*\(?\s*supabase\.(rpc|from|channel|removeChannel)\b(?!\s*\()(?!\.bind\(supabase\))/g;
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(re)) offenders.push(`${path.relative(root, f)}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
