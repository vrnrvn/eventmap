import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Poor-connection guarantees from docs/OFFLINE_PLAN.md step 0. The Supabase
 * client module is replaced with an in-memory fake (no backend, no native
 * modules), so only the services' own handling is under test.
 */

const insertResult = { error: null as { code: string; message: string } | null };
const getSessionResult = {
  data: { session: { user: { id: 'user-1' } } as { user: { id: string } } | null },
  error: null as Error | null,
};

vi.mock('@/services/supabase', () => {
  const supabase = {
    from: vi.fn(() => ({
      insert: vi.fn(async () => insertResult),
    })),
    auth: {
      getSession: vi.fn(async () => getSessionResult),
    },
  };
  return {
    supabase,
    async getSessionUser() {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session?.user ?? null;
    },
  };
});

const { socialService } = await import('@/services/social');

describe('retry-safe writes', () => {
  beforeEach(() => {
    insertResult.error = null;
    getSessionResult.error = null;
  });

  it('treats a duplicate save (earlier insert landed, response lost) as success', async () => {
    insertResult.error = { code: '23505', message: 'duplicate key value violates unique constraint' };
    await expect(socialService.saveEvent('event-1')).resolves.toBeUndefined();
  });

  it('treats a duplicate follow as success', async () => {
    insertResult.error = { code: '23505', message: 'duplicate key value violates unique constraint' };
    await expect(socialService.followBusiness('biz-1')).resolves.toBeUndefined();
  });

  it('still surfaces other save / follow failures', async () => {
    insertResult.error = { code: '42501', message: 'permission denied' };
    await expect(socialService.saveEvent('event-1')).rejects.toMatchObject({ code: '42501' });
    await expect(socialService.followBusiness('biz-1')).rejects.toMatchObject({ code: '42501' });
  });

  it('reports a failed session restore as an error, not as "signed out"', async () => {
    getSessionResult.error = new Error('AuthRetryableFetchError: Network request failed');
    await expect(socialService.saveEvent('event-1')).rejects.toThrow(/Network request failed/);
  });
});

describe('service auth lookups stay local', () => {
  const servicesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'services');
  // auth.ts deliberately asks the server (password and identity checks).
  const ALLOWED = new Set(['auth.ts']);

  it('no service calls auth.getUser() (a network round trip) for the caller id', () => {
    const offenders = fs
      .readdirSync(servicesDir)
      .filter((name) => name.endsWith('.ts') && !ALLOWED.has(name))
      .filter((name) =>
        /\.auth\.getUser\(\)/.test(
          fs.readFileSync(path.join(servicesDir, name), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
        )
      );
    expect(offenders).toEqual([]);
  });
});
