import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bumpEventDataVersion, getEventDataVersion, signalEventWrites } from '../utils/eventDataVersion';

/** signalEventWrites: the in-place wrapper services use to bump the event-data version. */

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('signalEventWrites', () => {
  it('preserves `this` (sibling calls through this) and the return value; bumps once per success', async () => {
    const service = {
      prefix: 'svc',
      helper(x: number) {
        return `${this.prefix}:${x}`;
      },
      async write(x: number) {
        return { label: this.helper(x), self: this };
      },
    };
    signalEventWrites(service, ['write']);
    const v0 = getEventDataVersion();
    const out = await service.write(7);
    expect(out.label).toBe('svc:7');
    expect(out.self).toBe(service);
    expect(getEventDataVersion()).toBe(v0 + 1);

    // A detached call still gets whatever `this` the caller supplies.
    const other = { prefix: 'other', helper: service.helper, write: service.write };
    expect((await other.write(1)).label).toBe('other:1');
  });

  it('returns the wrapped service object itself (in place)', () => {
    const s = { async a() {} };
    const original = s.a;
    expect(signalEventWrites(s, ['a'])).toBe(s);
    expect(s.a).not.toBe(original);
  });

  it('rejection propagates (same error object) and does NOT bump', async () => {
    const err = new Error('nope');
    const s = {
      async fail() {
        throw err;
      },
      syncThrow(): Promise<void> {
        throw err; // a non-async method that throws synchronously
      },
    };
    signalEventWrites(s, ['fail', 'syncThrow']);
    const v0 = getEventDataVersion();
    await expect(s.fail()).rejects.toBe(err);
    // Sync throws become rejections (no synchronous throw escapes the wrapper).
    const p = s.syncThrow();
    expect(p).toBeInstanceOf(Promise);
    await expect(p).rejects.toBe(err);
    expect(getEventDataVersion()).toBe(v0);
  });

  it('a resolved Supabase-style `{ error }` result still counts as success (bumps)', async () => {
    const s = { async write() { return { data: null, error: { message: 'denied' } }; } };
    signalEventWrites(s, ['write']);
    const v0 = getEventDataVersion();
    await s.write();
    expect(getEventDataVersion()).toBe(v0 + 1);
  });

  it('concurrent calls bump once each; bump happens after the call resolves, not when it starts', async () => {
    const resolvers: (() => void)[] = [];
    const s = {
      write(i: number) {
        return new Promise<number>((res) => resolvers.push(() => res(i)));
      },
    };
    signalEventWrites(s, ['write']);
    const v0 = getEventDataVersion();
    const calls = Array.from({ length: 25 }, (_, i) => s.write(i));
    await flush();
    expect(getEventDataVersion()).toBe(v0);
    resolvers.slice(0, 10).forEach((r) => r());
    await flush();
    expect(getEventDataVersion()).toBe(v0 + 10);
    resolvers.slice(10).forEach((r) => r());
    expect(await Promise.all(calls)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(getEventDataVersion()).toBe(v0 + 25);
  });

  it('wrapping a non-method throws with the member name', () => {
    const s = { notFn: 42, missing: undefined, fn: async () => 1 } as Record<string, unknown>;
    expect(() => signalEventWrites(s, ['notFn'])).toThrow('signalEventWrites: notFn is not a method');
    expect(() => signalEventWrites(s, ['missing'])).toThrow(/missing is not a method/);
    expect(() => signalEventWrites(s, ['nope' as never])).toThrow(/nope is not a method/);
  });

  it('documented: wrapping is not atomic — names before a bad one are already wrapped', async () => {
    const s = { async good() {}, bad: 1 } as Record<string, unknown> & { good: () => Promise<void> };
    const original = s.good;
    expect(() => signalEventWrites(s, ['good', 'bad'])).toThrow();
    expect(s.good).not.toBe(original);
  });

  it('documented: wrapping the same method twice bumps twice per call', async () => {
    const s = { async w() {} };
    signalEventWrites(s, ['w']);
    signalEventWrites(s, ['w']);
    const v0 = getEventDataVersion();
    await s.w();
    expect(getEventDataVersion()).toBe(v0 + 2);
  });

  it('bumpEventDataVersion is monotonic', () => {
    const v0 = getEventDataVersion();
    for (let i = 0; i < 1000; i++) bumpEventDataVersion();
    expect(getEventDataVersion()).toBe(v0 + 1000);
  });

  it('static: every method wrapped in services is declared async and wrapped exactly once', () => {
    const servicesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'services');
    let checked = 0;
    for (const file of fs.readdirSync(servicesDir).filter((f) => f.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(servicesDir, file), 'utf8');
      const calls = [...src.matchAll(/^signalEventWrites\(\s*(\w+),\s*\[([\s\S]*?)\]\s*\)/gm)];
      const seen = new Set<string>();
      for (const call of calls) {
        for (const [, name] of call[2].matchAll(/'(\w+)'/g)) {
          expect(seen.has(`${call[1]}.${name}`), `${file}: ${name} wrapped twice`).toBe(false);
          seen.add(`${call[1]}.${name}`);
          // Declared as `async name(` in the object literal (wrapping a sync
          // method would change its return type to a Promise).
          expect(new RegExp(`^\\s+async\\s+${name}\\s*[(<]`, 'm').test(src), `${file}: ${name} is not async`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});
