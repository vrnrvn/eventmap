// PostgREST-layer regression for the host-tools stack (20261103100000–170000).
//
// Complements scripts/test-host-tools.sql: psql can't tell whether PostgREST
// resolves the client's *named-argument* RPC calls (overload ambiguity, PGRST202
// for renamed shapes, return-type decoding), so every call below mirrors the
// exact shape services/*.ts sends — including which keys are omitted when the
// client passes `undefined` (JSON.stringify drops them).
//
// Talks ONLY to a private PostgREST bound to an isolated scratch DB:
//   SCRATCH_DB=... scripts/db-scratch.sh refresh && apply the 8 migrations
//   docker run ... postgrest on :3998 (see docs/ISSUES.md "final regression")
//   scripts/db-scratch.sh apply scripts/regress-host-tools.fixture.sql
//   JWT_K=<oct k from PGRST_JWT_SECRET JWKS> REST=http://127.0.0.1:3998 \
//     node scripts/regress-host-tools.mjs
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const REST = process.env.REST ?? 'http://127.0.0.1:3998';
assert.ok(/127\.0\.0\.1|localhost/.test(REST), 'refusing to run against a non-local REST endpoint');

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
const KEY = Buffer.from(process.env.JWT_K.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function mint(claims) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now, exp: now + 3600, iss: 'supabase', ...claims }));
  const sig = b64url(createHmac('sha256', KEY).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

const U = {
  host: '10000000-0000-4000-8000-000000000001',
  alex: '10000000-0000-4000-8000-000000000002',
  sam: '10000000-0000-4000-8000-000000000003',
};
const E = {
  art: '30000000-0000-4000-8000-000000000001',
  run: '30000000-0000-4000-8000-000000000002',
};

function client(sub) {
  const token = mint({ sub, role: 'authenticated', aud: 'authenticated' });
  const rewrite = (url, init) => fetch(String(url).replace(`${REST}/rest/v1`, REST), init);
  return createClient(REST, 'local-anon', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: rewrite },
  });
}
const host = client(U.host);
const alex = client(U.alex);
const sam = client(U.sam);

let step = '';
const steps = [];
function ok(tag) {
  steps.push(tag);
  console.log('  ✓', tag);
}

try {
  // ── Join / approval shapes (services/social.ts) ────────────────────────────
  step = 'join returns text';
  {
    const { data, error } = await alex.rpc('join_event_with_capacity', { p_event_id: E.run, p_status: 'going' });
    assert.equal(error, null, JSON.stringify(error));
    assert.equal(data, 'going');
    ok(step);
  }
  step = 'approval mode: join lands as requested';
  {
    const { data, error } = await alex.rpc('join_event_with_capacity', { p_event_id: E.art, p_status: 'going' });
    assert.equal(error, null, JSON.stringify(error));
    assert.equal(data, 'requested');
    ok(step);
  }
  step = 'host_review_rsvp approve';
  {
    const { error } = await host.rpc('host_review_rsvp', { p_event_id: E.art, p_user_id: U.alex, p_decision: 'approve' });
    assert.equal(error, null, JSON.stringify(error));
    ok(step);
  }

  // ── Host views (services/hostTools.ts) ────────────────────────────────────
  step = 'host overview shape';
  {
    const { data, error } = await host.rpc('get_event_host_overview', { p_event_id: E.art });
    assert.equal(error, null, JSON.stringify(error));
    for (const key of ['going', 'interested', 'waitlist', 'removed', 'requested', 'saves', 'views_total', 'announcements_today', 'chat']) {
      assert.ok(key in data, `overview missing ${key}`);
    }
    assert.equal(data.going, 1);
    ok(step);
  }
  step = 'host attendees page, p_search omitted like the client does';
  {
    const { data, error } = await host.rpc('get_event_host_attendees_page', {
      p_event_id: E.art, p_status: 'going', p_limit: 30, p_offset: 0, p_search: undefined,
    });
    assert.equal(error, null, JSON.stringify(error));
    assert.equal(data.total, 1);
    assert.ok(data.items[0].user_id === U.alex && 'chat_blocked' in data.items[0]);
    ok(step);
  }
  step = 'attendees page refused for a non-host';
  {
    const { error } = await alex.rpc('get_event_host_attendees_page', { p_event_id: E.art, p_status: 'going', p_limit: 30, p_offset: 0 });
    assert.ok(error && /only the event host/.test(error.message));
    ok(step);
  }
  step = 'batched counts';
  {
    const { data, error } = await host.rpc('get_host_events_counts', { p_event_ids: [E.art, E.run] });
    assert.equal(error, null, JSON.stringify(error));
    assert.equal(data.length, 2);
    ok(step);
  }

  // ── Settings: every subset the client can send ─────────────────────────────
  step = 'settings with all four named args';
  {
    const { data, error } = await host.rpc('host_set_event_settings', {
      p_event_id: E.run, p_rsvp_closed: false, p_waitlist_mode: 'notify', p_rsvp_mode: 'open',
    });
    assert.equal(error, null, JSON.stringify(error));
    assert.equal(data.rsvp_mode, 'open');
    ok(step);
  }
  step = 'settings with undefined keys dropped (3-named-arg shape)';
  {
    const { data, error } = await host.rpc('host_set_event_settings', {
      p_event_id: E.run, p_rsvp_closed: true, p_waitlist_mode: undefined, p_rsvp_mode: undefined,
    });
    assert.equal(error, null, JSON.stringify(error));
    assert.equal(data.rsvp_closed, true);
    const undo = await host.rpc('host_set_event_settings', { p_event_id: E.run, p_rsvp_closed: false });
    assert.equal(undo.error, null, JSON.stringify(undo.error));
    ok(step);
  }
  step = 'capacity RPC';
  {
    const { error } = await host.rpc('host_set_event_capacity', { p_event_id: E.run, p_max_attendees: 40 });
    assert.equal(error, null, JSON.stringify(error));
    ok(step);
  }

  // ── Creation shapes (services/events.ts fallback ladder) ──────────────────
  step = 'create: richest shape (draft, zone, capacity)';
  let draftId;
  {
    const base = {
      p_business_id: null, p_title: 'REST draft', p_description: 'd',
      p_category_id: null,
      p_start_datetime: new Date(Date.now() + 3 * 864e5).toISOString(),
      p_end_datetime: new Date(Date.now() + 3 * 864e5 + 72e5).toISOString(),
      p_lat: 37.7, p_lng: -122.4, p_address: 'x', p_cover_image_url: undefined,
      p_is_recurring: false, p_recurrence_pattern: null,
    };
    const biz = await host.from('businesses').select('id, category').eq('owner_id', U.host).single();
    assert.equal(biz.error, null, JSON.stringify(biz.error));
    const cat = await host.from('categories').select('id').limit(1).single();
    base.p_business_id = biz.data.id;
    base.p_category_id = cat.data.id;
    const { data, error } = await host.rpc('create_event_with_limit_check', {
      ...base, p_max_attendees: 25, p_timezone: 'Europe/Lisbon', p_publish_state: 'draft',
    });
    assert.equal(error, null, JSON.stringify(error));
    draftId = data;
    const twelve = await host.rpc('create_event_with_limit_check', base);
    assert.equal(twelve.error, null, `12-arg shape must still resolve: ${JSON.stringify(twelve.error)}`);
    ok(step);
  }
  step = 'draft hidden from another user via details RPC';
  {
    const { data, error } = await alex.rpc('get_event_details', { event_uuid: draftId });
    assert.equal(error, null, JSON.stringify(error));
    assert.equal(data, null);
    ok(step);
  }
  step = 'publish / postpone / reschedule / duplicate shapes';
  {
    const pub = await host.rpc('publish_event', { p_event_id: draftId });
    assert.equal(pub.error, null, JSON.stringify(pub.error));
    const post = await host.rpc('postpone_event', { p_event_id: draftId, p_note: null });
    assert.equal(post.error, null, JSON.stringify(post.error));
    assert.equal(post.data.status, 'postponed');
    const resch = await host.rpc('reschedule_event', {
      p_event_id: draftId,
      p_start_datetime: new Date(Date.now() + 5 * 864e5).toISOString(),
      p_end_datetime: new Date(Date.now() + 5 * 864e5 + 72e5).toISOString(),
      p_note: null, p_address: null, p_lat: null, p_lng: null,
    });
    assert.equal(resch.error, null, JSON.stringify(resch.error));
    assert.equal(resch.data.status, 'active');
    const dup = await host.rpc('duplicate_event', { p_event_id: draftId });
    assert.equal(dup.error, null, JSON.stringify(dup.error));
    assert.ok(typeof dup.data === 'string');
    ok(step);
  }

  // ── getBusinessEvents filter shapes (services/events.ts) ──────────────────
  step = 'drafts scope + published upcoming filter syntax';
  {
    const biz = await host.from('businesses').select('id').eq('owner_id', U.host).single();
    const drafts = await host.from('events').select('*').eq('business_id', biz.data.id)
      .eq('publish_state', 'draft').order('updated_at', { ascending: false });
    assert.equal(drafts.error, null, JSON.stringify(drafts.error));
    assert.ok(drafts.data.length >= 1);
    const upcoming = await host.from('events').select('*').eq('business_id', biz.data.id)
      .eq('publish_state', 'published')
      .in('status', ['active', 'postponed'])
      .or(`end_datetime.gt.${new Date().toISOString()},is_recurring.eq.true`)
      .order('start_datetime', { ascending: true });
    assert.equal(upcoming.error, null, JSON.stringify(upcoming.error));
    ok(step);
  }
  step = 'event_rsvp_counts fallback read';
  {
    const { error } = await host.from('event_rsvp_counts').select('event_id, going_count, interested_count').in('event_id', [E.art, E.run]);
    assert.equal(error, null, JSON.stringify(error));
    ok(step);
  }

  // ── Chat shapes (services/eventChat.ts) ────────────────────────────────────
  step = 'post status row carries the new fields';
  {
    const { data, error } = await host.rpc('get_event_chat_post_status', { event_uuid: E.art });
    assert.equal(error, null, JSON.stringify(error));
    const row = data[0];
    for (const key of ['chat_mode', 'open_policy', 'pinned_message_id', 'locked', 'slow_mode_seconds']) {
      assert.ok(key in row, `post status missing ${key}`);
    }
    ok(step);
  }
  step = 'set_event_chat_mode / legacy set_event_chat_settings / pin';
  {
    const mode = await host.rpc('set_event_chat_mode', { p_event_id: E.art, p_chat_mode: 'open', p_open_policy: 'any_going' });
    assert.equal(mode.error, null, JSON.stringify(mode.error));
    const legacy = await host.rpc('set_event_chat_settings', { p_event_id: E.art, p_locked: true, p_slow_mode_seconds: undefined });
    assert.equal(legacy.error, null, JSON.stringify(legacy.error));
    const reopen = await host.rpc('set_event_chat_mode', { p_event_id: E.art, p_chat_mode: 'open', p_open_policy: undefined });
    assert.equal(reopen.error, null, JSON.stringify(reopen.error));
    const msg = await alex.from('event_chat_messages')
      .insert({ event_id: E.art, sender_id: U.alex, body: 'rest hello', mentions: [] })
      .select('id').single();
    assert.equal(msg.error, null, JSON.stringify(msg.error));
    const pin = await host.rpc('set_event_chat_pin', { p_event_id: E.art, p_message_id: msg.data.id });
    assert.equal(pin.error, null, JSON.stringify(pin.error));
    const unpin = await host.rpc('set_event_chat_pin', { p_event_id: E.art, p_message_id: null });
    assert.equal(unpin.error, null, JSON.stringify(unpin.error));
    ok(step);
  }
  step = 'announcement shape';
  {
    const { data, error } = await host.rpc('send_event_announcement', { p_event_id: E.art, p_body: 'REST check', p_audience: 'going' });
    assert.equal(error, null, JSON.stringify(error));
    assert.ok('recipients' in data && 'sent_today' in data);
    ok(step);
  }

  // ── Attendee management shapes ─────────────────────────────────────────────
  step = 'remove (4-arg), unban, waitlist promote';
  {
    const rm = await host.rpc('host_remove_attendee', { p_event_id: E.art, p_user_id: U.alex, p_reason: null, p_ban: true });
    assert.equal(rm.error, null, JSON.stringify(rm.error));
    const rejoin = await alex.rpc('join_event_with_capacity', { p_event_id: E.art, p_status: 'going' });
    assert.ok(rejoin.error && /removed_from_event/.test(rejoin.error.message));
    const unban = await host.rpc('host_unban_attendee', { p_event_id: E.art, p_user_id: U.alex });
    assert.equal(unban.error, null, JSON.stringify(unban.error));
    // run is open with capacity 40 and 1-2 going: push sam onto the waitlist path.
    await host.rpc('host_set_event_capacity', { p_event_id: E.run, p_max_attendees: 1 });
    const wl = await sam.rpc('join_event_waitlist', { p_event_id: E.run });
    assert.ok(wl.error === null || /spot_available|already_going/.test(wl.error?.message ?? ''), JSON.stringify(wl.error));
    if (wl.error === null) {
      await host.rpc('host_set_event_capacity', { p_event_id: E.run, p_max_attendees: 5 });
      const promote = await host.rpc('host_promote_from_waitlist', { p_event_id: E.run, p_user_id: U.sam });
      assert.ok(promote.error === null || /not_on_waitlist/.test(promote.error?.message ?? ''), JSON.stringify(promote.error));
    }
    ok(step);
  }

  console.log(`\nALL ${steps.length} POSTGREST CHECKS PASSED`);
} catch (err) {
  console.error(`\nFAILED at [${step}]`);
  console.error(err);
  process.exit(1);
}
