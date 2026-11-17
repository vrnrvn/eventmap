/**
 * Resolves the app's `@/…` path alias for plain `node` runs, so perf scripts
 * can import the TypeScript utils directly (with --experimental-strip-types)
 * instead of going through Metro or vitest.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const base = path.join(root, specifier.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
        return next(pathToFileURL(candidate).href, context);
      }
    }
  }
  return next(specifier, context);
}
