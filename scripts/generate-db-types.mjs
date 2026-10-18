import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = execFileSync(resolve(root, 'node_modules/.bin/supabase'),
  ['gen', 'types', 'typescript', '--local'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
if (!source.includes('export type Database')) throw new Error('Database type generation failed');
writeFileSync(resolve(root, 'types/supabase.generated.ts'), source);
console.log('Updated types/supabase.generated.ts from the local schema.');
