import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * Android drops (or may drop) a push aimed at a channel the device never
 * created. Every channel id the server's push_channel_for_type can return
 * must be in the app's ANDROID_CHANNELS.
 */
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('@/services/supabase', () => ({ supabase: {} }));
vi.mock('@/services/runtime', () => ({ pushEnabled: false }));

const { ANDROID_CHANNELS } = await import('@/services/pushNotifications');

function serverChannelIds(): string[] {
  const dirs = ['supabase/migrations', 'supabase/pending'];
  const files = dirs
    .flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).map((f) => path.join(d, f)) : []))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  // Latest definition wins, like applying the files in order.
  let body = '';
  for (const f of files) {
    const sql = fs.readFileSync(f, 'utf8');
    const m = sql.match(/FUNCTION public\.push_channel_for_type[\s\S]*?\$function\$([\s\S]*?)\$function\$/);
    if (m) body = m[1];
  }
  expect(body, 'push_channel_for_type definition not found').not.toBe('');
  return [...body.matchAll(/(?:THEN|ELSE)\s+'([a-z_]+)'/g)].map((x) => x[1]);
}

describe('Android push channels', () => {
  it('the app creates every channel the server can route to', () => {
    const server = new Set(serverChannelIds());
    expect(server.size).toBeGreaterThan(1);
    const client = new Set<string>(ANDROID_CHANNELS.map((c) => c.id));
    expect([...server].filter((id) => !client.has(id))).toEqual([]);
  });

  it('channel ids are unique and named', () => {
    const ids = ANDROID_CHANNELS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of ANDROID_CHANNELS) expect(c.name.length).toBeGreaterThan(0);
  });
});
