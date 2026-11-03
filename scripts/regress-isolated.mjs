// API-level regression run for the events flow, against an ISOLATED backend.
//
// Talks to a private PostgREST (default http://127.0.0.1:3999) bound to a
// scratch copy of the local DB that has the prepared 20261102* migrations
// applied. Tokens are minted locally from the stack's JWT secret, so neither
// the shared database nor the shared GoTrue is touched — no sign-ins, no
// sign-ups, no session rows.
//
//   SCRATCH_DB=eventmap_scratch_elm scripts/db-scratch.sh refresh && apply migrations...
//   docker run ... postgrest bound to the scratch DB on :3999   (see docs/ISSUES.md)
//   JWT_K=<base64url oct key from PGRST_JWT_SECRET JWKS> node scripts/regress-isolated.mjs
//
// Every call below mirrors the exact table / RPC / filter shapes used by
// services/*.ts, so a PostgREST-layer regression (RLS from the API role,
// filter syntax, RPC arg names, JSON keys) shows up here where psql checks
// can't see it. Fixtures are created via a service-role token and removed at
// the end; the scratch DB can also just be refreshed.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const REST = process.env.REST ?? 'http://127.0.0.1:3999';
assert.ok(/127\.0\.0\.1|localhost/.test(REST), 'refusing to run against a non-local REST endpoint');

// --- token minting -----------------------------------------------------------
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function hmacKey() {
  if (process.env.JWT_K) return Buffer.from(process.env.JWT_K.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const status = JSON.parse(
    execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  );
  return Buffer.from(status.JWT_SECRET, 'utf8');
}
const KEY = hmacKey();
function mint(claims) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now, exp: now + 3600, iss: 'supabase', ...claims }));
  const sig = b64url(createHmac('sha256', KEY).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

const USERS = {
  host: '10000000-0000-4000-8000-000000000001',
  alex: '10000000-0000-4000-8000-000000000002',
  sam: '10000000-0000-4000-8000-000000000003',
};

function client(role, sub) {
  const token = mint(sub ? { sub, role, aud: role } : { role });
  // supabase-js prefixes /rest/v1; raw PostgREST has no such prefix.
  const rewrite = (url, init) => fetch(String(url).replace(`${REST}/rest/v1`, REST), init);
  return createClient(REST, 'local-anon', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: rewrite },
  });
}
const svc = client('service_role');
const anon = client('anon');
const host = client('authenticated', USERS.host);
const alex = client('authenticated', USERS.alex);
const sam = client('authenticated', USERS.sam);

// --- harness -------------------------------------------------------------------
let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL  ${name}\n      ${err?.message ?? err}`);
  }
}
const ok = (r) => {
  if (r.error) throw new Error(`${r.error.code ?? ''} ${r.error.message}`.trim());
  return r.data;
};
const expectErr = (r, needle) => {
  assert.ok(r.error, `expected an error containing "${needle}", got success`);
  const text = `${r.error.code ?? ''} ${r.error.message ?? ''} ${r.error.details ?? ''}`;
  assert.ok(text.toLowerCase().includes(needle.toLowerCase()), `expected error containing "${needle}", got: ${text}`);
};
const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

const created = { events: [], complaints: [], follows: false, blocks: false, businesses: [] };
const startedAt = new Date().toISOString();

// --- fixtures ------------------------------------------------------------------
const business = ok(await svc.from('businesses').select('id, owner_id, subscription_tier').eq('owner_id', USERS.host).single());
const category = ok(await svc.from('categories').select('id').limit(1).single());
const SF = { lat: 37.7749, lng: -122.4194 };

async function fixtureEvent(overrides = {}) {
  const { title, ...rest } = overrides;
  const row = {
    business_id: business.id,
    description: 'isolated regression fixture',
    category_id: category.id,
    start_datetime: inHours(48),
    end_datetime: inHours(50),
    lat: SF.lat,
    lng: SF.lng,
    address: 'Scratch St',
    ...rest,
    // Applied last so every fixture carries the prefix the checks look for.
    title: `REGRESS ${title ?? 'event'}`,
  };
  const data = ok(await svc.from('events').insert(row).select('id').single());
  created.events.push(data.id);
  return data.id;
}

console.log(`\nIsolated regression run against ${REST} (business ${business.id}, tier ${business.subscription_tier})\n`);

// ── 1. Event creation path ───────────────────────────────────────────────────
await check('direct INSERT into events is refused for the host (RLS: RPC only)', async () => {
  expectErr(
    await host.from('events').insert({
      business_id: business.id, title: 'bypass', description: 'x', category_id: category.id,
      start_datetime: inHours(24), end_datetime: inHours(26), lat: SF.lat, lng: SF.lng, address: 'x',
    }),
    'row-level security'
  );
});

let rpcEventId = null;
await check('create_event_with_limit_check works with the service arg names', async () => {
  const r = await host.rpc('create_event_with_limit_check', {
    p_business_id: business.id, p_title: 'REGRESS via rpc', p_description: 'd', p_category_id: category.id,
    p_start_datetime: inHours(72), p_end_datetime: inHours(74), p_lat: SF.lat, p_lng: SF.lng, p_address: 'Scratch Ave',
    p_cover_image_url: undefined, p_is_recurring: false, p_recurrence_pattern: null,
  });
  if (r.error && /limit reached/i.test(r.error.message)) {
    console.log('      (monthly limit reached for this business; creation path covered by validation checks below)');
    return;
  }
  rpcEventId = ok(r);
  assert.match(String(rpcEventId), /^[0-9a-f-]{36}$/);
  created.events.push(rpcEventId);
});

await check('create RPC validates title / coordinates / dates', async () => {
  const base = { p_business_id: business.id, p_description: 'd', p_category_id: category.id, p_lat: SF.lat, p_lng: SF.lng, p_address: 'x' };
  expectErr(await host.rpc('create_event_with_limit_check', { ...base, p_title: '   ', p_start_datetime: inHours(72), p_end_datetime: inHours(74) }), 'invalid_title');
  expectErr(await host.rpc('create_event_with_limit_check', { ...base, p_title: 't', p_lat: 137, p_start_datetime: inHours(72), p_end_datetime: inHours(74) }), 'invalid_location');
  expectErr(await host.rpc('create_event_with_limit_check', { ...base, p_title: 't', p_start_datetime: inHours(74), p_end_datetime: inHours(72) }), 'invalid_dates');
});

// ── 2. Host list queries exactly as services/events.ts builds them ──────────
const upcomingId = await fixtureEvent({ title: 'upcoming' });
const pastId = await fixtureEvent({ title: 'past', start_datetime: inHours(-50), end_datetime: inHours(-48) });
const recurringOldId = await fixtureEvent({
  title: 'weekly old', start_datetime: inHours(-24 * 30), end_datetime: inHours(-24 * 30 + 2),
  is_recurring: true, recurrence_pattern: { frequency: 'weekly', interval: 1 },
});

await check("getBusinessEvents scope 'upcoming' filter parses and returns the right rows (owner)", async () => {
  const nowIso = new Date().toISOString();
  const rows = ok(await host.from('events').select('*').eq('business_id', business.id)
    .eq('status', 'active').or(`end_datetime.gt.${nowIso},is_recurring.eq.true`)
    .order('start_datetime', { ascending: true }).range(0, 49));
  const ids = new Set(rows.map((r) => r.id));
  assert.ok(ids.has(upcomingId), 'upcoming event present');
  assert.ok(ids.has(recurringOldId), 'ongoing recurring series present');
  assert.ok(!ids.has(pastId), 'past one-off excluded');
});

await check("getBusinessEvents scope 'past' filter parses and returns past + cancelled", async () => {
  const nowIso = new Date().toISOString();
  const rows = ok(await host.from('events').select('*').eq('business_id', business.id)
    .or(`status.eq.cancelled,and(is_recurring.eq.false,end_datetime.lte.${nowIso})`)
    .order('start_datetime', { ascending: false }).range(0, 49));
  const ids = new Set(rows.map((r) => r.id));
  assert.ok(ids.has(pastId));
  assert.ok(!ids.has(upcomingId));
});

await check('getBusinessEventsCount upcoming (head count with the same filter)', async () => {
  const r = await host.from('events').select('*', { count: 'exact', head: true }).eq('business_id', business.id)
    .eq('status', 'active').or(`end_datetime.gt.${new Date().toISOString()},is_recurring.eq.true`);
  ok(r);
  assert.ok(r.count >= 2, `count ${r.count}`);
});

await check('visitor (anon) sees the ongoing recurring series via the recurrence-aware SELECT policy', async () => {
  const rows = ok(await anon.from('events').select('id').eq('id', recurringOldId));
  assert.equal(rows.length, 1);
  const past = ok(await anon.from('events').select('id').eq('id', pastId));
  assert.equal(past.length, 0, 'ended one-off hidden from visitors');
});

// ── 3. Event links (syncEventLinks path) ─────────────────────────────────────
await check('host can insert / update / delete event_links; another user cannot', async () => {
  const inserted = ok(await host.from('event_links').insert({ event_id: upcomingId, label: 'Tickets', url: 'https://example.com/t', sort_order: 0 }).select('id').single());
  ok(await host.from('event_links').update({ label: 'Tix', url: 'https://example.com/t2', sort_order: 1 }).eq('id', inserted.id));
  const after = ok(await anon.from('event_links').select('label, sort_order').eq('id', inserted.id).single());
  assert.equal(after.label, 'Tix');
  // RLS on UPDATE hides the row from non-owners: zero rows affected, no error.
  const foreign = await alex.from('event_links').update({ label: 'hacked' }).eq('id', inserted.id).select('id');
  assert.ok(foreign.error || (foreign.data ?? []).length === 0, 'non-owner update must not affect rows');
  ok(await host.from('event_links').delete().eq('id', inserted.id));
});

// ── 4. get_event_details shape used by EventDetail ───────────────────────────
await check('get_event_details returns status, max_attendees, links and the waitlist key', async () => {
  const d = ok(await alex.rpc('get_event_details', { event_uuid: upcomingId }));
  assert.equal(d.event.status, 'active');
  assert.ok('max_attendees' in d.event);
  assert.ok(Array.isArray(d.links));
  assert.ok(d.waitlist && typeof d.waitlist.count === 'number', 'waitlist key present');
  assert.equal(d.user_following_business, false);
});

// ── 5. Capacity, RSVP errors, waitlist ───────────────────────────────────────
const cappedId = await fixtureEvent({ title: 'capped', max_attendees: 1 });

await check('join_event_with_capacity: first going succeeds, second gets EVENT_FULL (client maps this)', async () => {
  ok(await alex.rpc('join_event_with_capacity', { p_event_id: cappedId, p_status: 'going' }));
  expectErr(await sam.rpc('join_event_with_capacity', { p_event_id: cappedId, p_status: 'going' }), 'EVENT_FULL');
});

await check('direct rsvps upsert (old client path) is also refused by the capacity trigger', async () => {
  expectErr(await sam.from('rsvps').upsert({ user_id: USERS.sam, event_id: cappedId, status: 'going' }, { onConflict: 'user_id,event_id' }), 'EVENT_FULL');
});

await check('interested does not consume a seat; event_rsvp_counts is publicly readable and correct', async () => {
  ok(await sam.rpc('join_event_with_capacity', { p_event_id: cappedId, p_status: 'interested' }));
  const counts = ok(await anon.from('event_rsvp_counts').select('going_count, interested_count').eq('event_id', cappedId).single());
  assert.deepEqual(counts, { going_count: 1, interested_count: 1 });
});

await check('waitlist: join returns position 1; details expose it; spot_available when not full', async () => {
  const pos = ok(await sam.rpc('join_event_waitlist', { p_event_id: cappedId }));
  assert.equal(pos, 1);
  const d = ok(await sam.rpc('get_event_details', { event_uuid: cappedId }));
  assert.equal(d.waitlist.position, 1);
  assert.equal(d.waitlist.count, 1);
  expectErr(await sam.rpc('join_event_waitlist', { p_event_id: upcomingId }), 'waitlist_not_needed');
});

await check('a leave frees the seat: waiter is notified, then joins and drops off the waitlist', async () => {
  ok(await alex.from('rsvps').delete().eq('user_id', USERS.alex).eq('event_id', cappedId));
  const notes = ok(await sam.from('notifications').select('type, title').eq('event_id', cappedId).gte('created_at', startedAt));
  assert.ok(notes.some((n) => n.type === 'waitlist'), `expected a waitlist notification, got ${JSON.stringify(notes)}`);
  ok(await sam.rpc('join_event_with_capacity', { p_event_id: cappedId, p_status: 'going' }));
  const d = ok(await sam.rpc('get_event_details', { event_uuid: cappedId }));
  assert.equal(d.waitlist.count, 0);
  assert.equal(d.user_rsvp, 'going');
});

await check('leave_event_waitlist is idempotent for someone not on it', async () => {
  ok(await alex.rpc('leave_event_waitlist', { p_event_id: cappedId }));
});

// ── 6. Cancel lifecycle ──────────────────────────────────────────────────────
// The demo host is also a platform admin, and the lifecycle trigger exempts
// admins from the status guard by design. Run these as a plain, non-admin
// owner: a second business owned by sam.
const samBiz = ok(await svc.from('businesses').insert({
  owner_id: USERS.sam, name: 'REGRESS Sam Biz', description: 'fixture', category: 'food-drink',
  address: 'Scratch Rd', lat: SF.lat, lng: SF.lng,
}).select('id').single());
created.businesses = [samBiz.id];
const cancelId = await fixtureEvent({ title: 'to cancel', business_id: samBiz.id, start_datetime: inHours(1), end_datetime: inHours(3) });
ok(await alex.rpc('join_event_with_capacity', { p_event_id: cancelId, p_status: 'going' }));
ok(await alex.from('saves').insert({ user_id: USERS.alex, event_id: cancelId }));
// Reminder fixture: alex wants a 60-minute reminder and this event starts in ~60.
ok(await svc.from('profiles').update({ event_reminder_enabled: true, event_reminder_minutes: 60 }).eq('id', USERS.alex));
const activeSoonId = await fixtureEvent({ title: 'soon active', start_datetime: inHours(1), end_datetime: inHours(3) });
ok(await alex.rpc('join_event_with_capacity', { p_event_id: activeSoonId, p_status: 'going' }));

await check('cancel_event works for a (non-admin) owner; status flips; attendee + saver notified once', async () => {
  ok(await sam.rpc('cancel_event', { p_event_id: cancelId }));
  const d = ok(await alex.rpc('get_event_details', { event_uuid: cancelId }));
  assert.equal(d.event.status, 'cancelled');
  const notes = ok(await alex.from('notifications').select('title').eq('event_id', cancelId).eq('title', 'Event cancelled'));
  assert.equal(notes.length, 1, `expected exactly one cancel notice, got ${notes.length}`);
});

await check('cancelled event is read-only and cannot be un-cancelled by its owner', async () => {
  const edit = await sam.from('events').update({ title: 'edited' }).eq('id', cancelId).select('id');
  assert.ok(edit.error, 'edit after cancel must error');
  assert.match(edit.error.message, /event_cancelled/);
  const flip = await sam.from('events').update({ status: 'active' }).eq('id', cancelId).select('id');
  assert.ok(flip.error && /cancel_event/.test(flip.error.message), `status flip must be refused, got ${JSON.stringify(flip)}`);
});

await check('send_event_reminders: reminds for the imminent active event, never for the cancelled one', async () => {
  ok(await svc.rpc('send_event_reminders'));
  const notes = ok(await alex.from('notifications').select('event_id, type').eq('type', 'event_reminder').gte('created_at', startedAt));
  assert.ok(notes.some((n) => n.event_id === activeSoonId), `expected a reminder for the active event, got ${JSON.stringify(notes)}`);
  assert.ok(!notes.some((n) => n.event_id === cancelId), 'cancelled event must not produce a reminder');
});

await check('RSVP to a cancelled event is refused as event_closed (client shows "no longer accepting RSVPs")', async () => {
  expectErr(await sam.rpc('join_event_with_capacity', { p_event_id: cancelId, p_status: 'going' }), 'event_closed');
});

await check("get_user_going_events('upcoming') excludes the cancelled event; saved list carries status", async () => {
  const going = ok(await alex.rpc('get_user_going_events', { user_id_param: USERS.alex, p_scope: 'upcoming', p_limit: 50, p_offset: 0 }));
  assert.ok(!going.some((e) => e.id === cancelId), 'cancelled event must not be in Going');
  const saved = ok(await alex.rpc('get_user_saved_events', { p_limit: 50, p_offset: 0 }));
  const row = saved.find((e) => e.id === cancelId);
  assert.ok(row, 'cancelled save still listed');
  assert.equal(row.status, 'cancelled');
  assert.equal(row.has_ended, true, 'cancelled saves sort with past ones');
});

// ── 7. Discovery ─────────────────────────────────────────────────────────────
for (let i = 0; i < 12; i += 1) {
  await fixtureEvent({ title: `page ${i}`, start_datetime: inHours(24 + i), end_datetime: inHours(26 + i), lat: SF.lat + i * 0.001, lng: SF.lng });
}
await check('get_ranked_events (9-arg) returns new columns and ranks near+soon first', async () => {
  const rows = ok(await anon.rpc('get_ranked_events', {
    user_lat: SF.lat, user_lng: SF.lng, radius_km: 50, category_ids: undefined, start_date: undefined, end_date: undefined,
    search_query: undefined, result_limit: 50, p_offset: 0,
  }));
  assert.ok(rows.length >= 12, `rows ${rows.length}`);
  for (const key of ['next_start_datetime', 'max_attendees', 'has_ended', 'user_rsvp', 'user_saved']) {
    assert.ok(key in rows[0], `missing column ${key}`);
  }
  const weekly = rows.find((r) => r.id === recurringOldId);
  assert.ok(weekly, 'ongoing weekly series is discoverable');
  assert.ok(new Date(weekly.next_start_datetime) > new Date(), 'recurring row carries its NEXT occurrence');
  assert.ok(!rows.some((r) => r.id === cancelId), 'cancelled excluded');
  assert.ok(!rows.some((r) => r.id === pastId), 'ended excluded');
});

await check('offset pagination is stable (no duplicate ids across pages)', async () => {
  const page = (offset) => anon.rpc('get_ranked_events', { user_lat: SF.lat, user_lng: SF.lng, radius_km: 50, result_limit: 5, p_offset: offset });
  const all = [...ok(await page(0)), ...ok(await page(5)), ...ok(await page(10))];
  assert.equal(new Set(all.map((r) => r.id)).size, all.length, 'duplicate ids across pages');
});

await check('date filter matches a recurring series by its next occurrence', async () => {
  const rows = ok(await anon.rpc('get_ranked_events', {
    user_lat: SF.lat, user_lng: SF.lng, radius_km: 50, start_date: new Date().toISOString(), end_date: inHours(24 * 30), result_limit: 100, p_offset: 0,
  }));
  assert.ok(rows.some((r) => r.id === recurringOldId));
});

await check('date window that starts after a daily event\'s next occurrence still matches the series', async () => {
  // Daily series: next occurrence is within ~24h; ask for a window that
  // starts 3 days out. The old next_start-only test excluded it.
  const dailyId = await fixtureEvent({
    title: 'daily', start_datetime: inHours(-24 * 10), end_datetime: inHours(-24 * 10 + 1),
    is_recurring: true, recurrence_pattern: { frequency: 'daily', interval: 1 },
  });
  const rows = ok(await anon.rpc('get_ranked_events', {
    user_lat: SF.lat, user_lng: SF.lng, radius_km: 50, start_date: inHours(72), end_date: inHours(120), result_limit: 100, p_offset: 0,
  }));
  assert.ok(rows.some((r) => r.id === dailyId), 'daily series must match a later window');
  const ended = await fixtureEvent({
    title: 'daily ended', start_datetime: inHours(-24 * 10), end_datetime: inHours(-24 * 10 + 1),
    is_recurring: true, recurrence_pattern: { frequency: 'daily', interval: 1, endDate: new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10) },
  });
  const later = ok(await anon.rpc('get_ranked_events', {
    user_lat: SF.lat, user_lng: SF.lng, radius_km: 50, start_date: inHours(72), end_date: inHours(120), result_limit: 100, p_offset: 0,
  }));
  assert.ok(!later.some((r) => r.id === ended), 'a series ending before the window must not match');
});

await check('keyword search still works with the trigram indexes in place', async () => {
  const base = { user_lat: SF.lat, user_lng: SF.lng, radius_km: 50, result_limit: 100, p_offset: 0 };
  const plain = ok(await anon.rpc('get_ranked_events', base));
  const searched = ok(await anon.rpc('get_ranked_events', { ...base, search_query: 'REGRESS page' }));
  const matching = searched.filter((r) => /^REGRESS page/.test(r.title));
  assert.ok(
    matching.length >= 12,
    `expected the 12 "REGRESS page" fixtures, got ${matching.length} ` +
      `(search returned ${searched.length}; same call without search returned ${plain.length}, ` +
      `of which ${plain.filter((r) => /^REGRESS page/.test(r.title)).length} are the fixtures)`
  );
});

// ── 8. Chat: host posting, lock, blocks ──────────────────────────────────────
const chatId = await fixtureEvent({ title: 'chat' });
ok(await svc.from('rsvps').insert([{ user_id: USERS.alex, event_id: chatId, status: 'going' }, { user_id: USERS.sam, event_id: chatId, status: 'going' }]));

await check('host can post in their own chat without an RSVP; post status says so', async () => {
  const status = ok(await host.rpc('get_event_chat_post_status', { event_uuid: chatId }));
  const row = Array.isArray(status) ? status[0] : status;
  assert.equal(row.is_host, true);
  assert.equal(row.can_post, true);
  ok(await host.from('event_chat_messages').insert({ id: crypto.randomUUID(), event_id: chatId, sender_id: USERS.host, body: 'announcement', mentions: [] }).select('*').single());
});

await check('locked chat refuses attendees (RLS) but not the host', async () => {
  ok(await host.rpc('set_event_chat_settings', { p_event_id: chatId, p_locked: true, p_slow_mode_seconds: 0 }));
  expectErr(await alex.from('event_chat_messages').insert({ id: crypto.randomUUID(), event_id: chatId, sender_id: USERS.alex, body: 'nope', mentions: [] }).select('*').single(), 'row-level security');
  ok(await host.from('event_chat_messages').insert({ id: crypto.randomUUID(), event_id: chatId, sender_id: USERS.host, body: 'still me', mentions: [] }).select('*').single());
  ok(await host.rpc('set_event_chat_settings', { p_event_id: chatId, p_locked: false, p_slow_mode_seconds: 0 }));
});

await check('blocking: own-rows select, get_profiles_display, and no notifications from a blocked sender', async () => {
  ok(await sam.from('user_blocks').insert({ blocker_id: USERS.sam, blocked_id: USERS.alex }));
  created.blocks = true;
  const blocks = ok(await sam.from('user_blocks').select('blocked_id, created_at').eq('blocker_id', USERS.sam).order('created_at', { ascending: false }));
  assert.ok(blocks.some((b) => b.blocked_id === USERS.alex));
  const profiles = ok(await sam.rpc('get_profiles_display', { user_ids: [USERS.alex] }));
  assert.ok(Array.isArray(profiles) && profiles[0]?.id === USERS.alex);
  // Make sam look "away" so the notification trigger would otherwise fire.
  ok(await svc.from('event_chat_reads').upsert({ event_id: chatId, user_id: USERS.sam, last_read_at: inHours(-2) }, { onConflict: 'event_id,user_id' }));
  const before = ok(await sam.from('notifications').select('id').eq('event_id', chatId).in('type', ['chat_message', 'chat_mention']).gte('created_at', startedAt));
  ok(await alex.from('event_chat_messages').insert({ id: crypto.randomUUID(), event_id: chatId, sender_id: USERS.alex, body: 'hey @Sam', mentions: [USERS.sam] }).select('*').single());
  const after = ok(await sam.from('notifications').select('id, type, data').eq('event_id', chatId).in('type', ['chat_message', 'chat_mention']).gte('created_at', startedAt));
  // The host's earlier messages legitimately notified sam; the mention from a
  // blocked sender must add nothing (mentions bypass the per-chat throttle,
  // so this isn't masked by the 15-minute window).
  assert.equal(after.length, before.length, `blocked sender added ${after.length - before.length} notification(s): ${JSON.stringify(after)}`);
  assert.ok(!after.some((n) => n.type === 'chat_mention' && n.data?.senderId === USERS.alex), 'mention from a blocked sender must not notify');
  const unread = ok(await sam.rpc('get_event_chat_unread_counts', { p_event_ids: [chatId] }));
  const mine = unread.find((u) => u.event_id === chatId);
  // Host messages (2) are unread; alex's is hidden.
  assert.equal(mine?.unread_count, 2, `unread ${JSON.stringify(unread)}`);
});

// ── 9. Host removes an attendee ──────────────────────────────────────────────
await check('host_remove_attendee: non-host refused, host succeeds, user told', async () => {
  expectErr(await sam.rpc('host_remove_attendee', { p_event_id: chatId, p_user_id: USERS.alex, p_reason: 'x' }), 'not_allowed');
  const hostBefore = ok(await host.from('notifications').select('id').eq('event_id', chatId).eq('title', 'Someone left your event'));
  ok(await host.rpc('host_remove_attendee', { p_event_id: chatId, p_user_id: USERS.alex, p_reason: 'Repeated spam' }));
  const left = ok(await svc.from('rsvps').select('id').eq('event_id', chatId).eq('user_id', USERS.alex));
  assert.equal(left.length, 0);
  const hostAfter = ok(await host.from('notifications').select('id').eq('event_id', chatId).eq('title', 'Someone left your event'));
  assert.equal(hostAfter.length, hostBefore.length, 'host must not be told about their own removal');
  const notes = ok(await alex.from('notifications').select('type, title').eq('event_id', chatId).eq('type', 'moderation'));
  assert.ok(notes.length >= 1);
});

// ── 10. Reports ──────────────────────────────────────────────────────────────
await check('duplicate event report returns 23505 (client renders "already reported")', async () => {
  const first = ok(await alex.from('complaints').insert({ reporter_id: USERS.alex, target_type: 'event', target_id: upcomingId, reason: 'Spam' }).select('id').single());
  created.complaints.push(first.id);
  const dup = await alex.from('complaints').insert({ reporter_id: USERS.alex, target_type: 'event', target_id: upcomingId, reason: 'Spam again' });
  assert.equal(dup.error?.code, '23505');
});

// ── 11. Notifications pagination + follow toggle ─────────────────────────────
await check('notifications page query (created_at desc, id desc, range) parses', async () => {
  const rows = ok(await alex.from('notifications').select('id, type, title, body, read, event_id, business_id, created_at, data')
    .eq('user_id', USERS.alex).order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, 4));
  assert.ok(rows.length <= 5);
});

await check('follow / unfollow from the event page', async () => {
  ok(await alex.from('follows').insert({ user_id: USERS.alex, business_id: business.id }));
  created.follows = true;
  const d = ok(await alex.rpc('get_event_details', { event_uuid: upcomingId }));
  assert.equal(d.user_following_business, true);
  ok(await alex.from('follows').delete().eq('user_id', USERS.alex).eq('business_id', business.id));
  created.follows = false;
});

// --- cleanup (scratch only) -------------------------------------------------------
try {
  if (created.complaints.length) await svc.from('complaints').delete().in('id', created.complaints);
  if (created.blocks) await svc.from('user_blocks').delete().eq('blocker_id', USERS.sam).eq('blocked_id', USERS.alex);
  if (created.follows) await svc.from('follows').delete().eq('user_id', USERS.alex).eq('business_id', business.id);
  if (created.events.length) await svc.from('events').delete().in('id', created.events);
  if (created.businesses.length) await svc.from('businesses').delete().in('id', created.businesses);
  await svc.from('notifications').delete().in('user_id', Object.values(USERS)).gte('created_at', startedAt);
} catch (err) {
  console.log(`(cleanup warning: ${err?.message ?? err})`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f.name}: ${f.err?.message ?? f.err}`);
  process.exit(1);
}
