// In-memory fake of the Supabase REST/RPC surface the app uses. Deterministic.
export const UID = '11111111-1111-4111-8111-111111111111';
export const BIZ = '22222222-2222-4222-8222-222222222222';
const iso = (offsetH) => new Date(Date.now() + offsetH * 3600e3).toISOString();
const uuid = (n, p = 'e') => `${p.repeat(8).slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function makeData({ notifications = 140, events = 60, business = false, longText = true } = {}) {
  const categories = ['music', 'food', 'sports', 'art', 'nightlife', 'markets', 'comedy', 'tech', 'outdoors', 'family']
    .map((slug, i) => ({ id: uuid(i + 1, 'c'), slug, label: slug[0].toUpperCase() + slug.slice(1), icon_key: slug, sort_order: i, created_at: iso(-9000) }));
  const biz = {
    id: BIZ, owner_id: business ? UID : uuid(99, 'f'), name: 'Café Ünïcode 🎉 Bar', description: 'A test business',
    category: 'food', address: '1 Market St, San Francisco', lat: 37.7749, lng: -122.4194, logo_url: null, contact_email: null,
    google_reviews_url: null, social_handles: null, verified: true, subscription_tier: 'premium',
    subscription_expires_at: iso(24 * 20), events_created_this_month: 3, last_reset_date: new Date().toISOString().slice(0, 10),
    created_at: iso(-9000),
  };
  const titles = ['Jazz night', 'مهرجان الطعام (RTL title)', '🎸🔥 Rock 🔥🎸', 'Yoga in the park', 'A'.repeat(longText ? 180 : 10), 'Comedy open mic'];
  const ev = Array.from({ length: events }, (_, i) => ({
    id: uuid(i + 1), business_id: BIZ, title: `${titles[i % titles.length]} #${i + 1}`,
    description: longText && i % 7 === 0 ? 'Long description 🎉 '.repeat(200) : 'Short description',
    category_id: categories[i % 10].id, start_datetime: iso(2 + i * 5), end_datetime: iso(5 + i * 5),
    lat: 37.7749 + (i % 10) * 0.004, lng: -122.4194 + Math.floor(i / 10) * 0.004, address: `${i + 1} Test St`,
    cover_image_url: i % 3 === 0 ? `http://127.0.0.1:9/storage/v1/object/public/event-images/${UID}/events/1-x${i}-t.jpg`
      : i % 3 === 1 ? `http://127.0.0.1:9/storage/v1/object/public/event-images/${UID}/events/1-x${i}.jpg` : null,
    is_recurring: i % 11 === 0, recurrence_pattern: i % 11 === 0 ? { frequency: 'weekly', interval: 1 } : null,
    status: i === 4 ? 'cancelled' : i === 5 ? 'postponed' : 'active', max_attendees: i % 9 === 0 ? 2 : null,
    timezone: i % 4 === 0 ? 'Asia/Kathmandu' : 'America/Los_Angeles', publish_state: 'published', visibility: 'public',
    created_at: iso(-100), updated_at: iso(-50),
  }));
  const ranked = ev.map((e, i) => ({ ...e, distance_km: i * 0.3, is_premium: i % 5 === 0, rsvp_count: i % 9 === 0 ? 2 : i * 3,
    save_count: i, business_name: biz.name, business_logo_url: null, category_label: categories[i % 10].label,
    category_slug: categories[i % 10].slug, next_start_datetime: e.start_datetime, user_rsvp: i % 4 === 0 ? 'going' : null,
    user_saved: i % 3 === 0, has_ended: false, saved_at: iso(-i) }));
  const notifs = Array.from({ length: notifications }, (_, i) => ({
    id: uuid(i + 1, 'a'), user_id: UID, type: ['rsvp', 'event_update', 'chat_message', 'new_follower', 'event_reminder'][i % 5],
    title: i % 10 === 0 ? 'Ünïcode 🎉 title ' + 'x'.repeat(longText ? 120 : 1) : `Notification ${i + 1}`,
    body: i % 6 === 0 ? null : `Body ${i + 1}`, event_id: ev[i % ev.length].id, business_id: null, read: i % 3 !== 0,
    created_at: iso(-i * 3), data: {} }));
  const people = Array.from({ length: 30 }, (_, i) => ({ id: uuid(i + 1, 'b'), name: `Attendee ${i + 1} ✨`, avatar_url: null, bio: null, is_private: i % 7 === 0, is_anonymous: false }));
  const messages = Array.from({ length: 250 }, (_, i) => ({ id: uuid(i + 1, 'd'), event_id: ev[0].id,
    sender_id: i % 4 === 0 ? UID : people[i % 30].id, body: i % 25 === 0 ? 'Long msg 🎉 '.repeat(60) : `Message ${i + 1}`,
    created_at: iso(-250 + i), deleted_at: i % 40 === 0 ? iso(-1) : null, deleted_by: null, mentions: [] }));
  const profile = { id: UID, name: 'Test User 🧪', avatar_url: null, bio: 'Bio', social_handles: null, city: 'San Francisco',
    lat: 37.7749, lng: -122.4194, hobbies: null, has_completed_onboarding: true, preferred_categories: [], is_admin: false,
    is_profile_private: false, show_attendance_publicly: true, show_future_events: true, notification_preferences: {},
    event_reminder_enabled: true, event_reminder_minutes: 60, created_at: iso(-9000) };
  return { categories, biz, ev, ranked, notifs, people, messages, profile, business, follows: [{ id: uuid(1, 'f'), business: biz }] };
}

const qp = (q) => Object.fromEntries(new URLSearchParams(q));
const eqv = (s) => (s && s.startsWith('eq.') ? s.slice(3) : undefined);

export function makeRouter(data, { unknown = [], overrides = {} } = {}) {
  const page = (rows, r) => {
    const q = qp(r.query); const range = r.headers.Range || r.headers.range;
    let from = 0, to = rows.length - 1;
    if (range) [from, to] = range.split('-').map(Number);
    if (q.offset) from = +q.offset;
    if (q.limit) to = from + +q.limit - 1;
    return rows.slice(from, to + 1);
  };
  const isObj = (r) => (r.headers.Accept || r.headers.accept || '').includes('vnd.pgrst.object');
  const counted = (rows, total, r) => {
    const prefer = r.headers.Prefer || r.headers.prefer || '';
    const headers = prefer.includes('count=') ? { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${total}` } : {};
    return { json: r.method === 'HEAD' ? null : rows, headers, raw: r.method === 'HEAD' ? '' : undefined };
  };
  const body = (r) => { try { return JSON.parse(r.body || '{}'); } catch { return {}; } };
  const one = (row, r) => (isObj(r) ? { json: row ?? null, status: row ? 200 : 406 } : { json: row ? [row] : [] });

  return async (r) => {
    const key = `${r.method} ${r.path}`;
    if (overrides[r.path]) { const o = await overrides[r.path](r, data); if (o) return o; }
    const q = qp(r.query);
    const P = r.path.replace('/rest/v1/', '');
    if (r.path.startsWith('/storage/')) return { status: 404, raw: 'not found' };
    if (r.path.startsWith('/auth/v1/token')) {
      data.refreshes = (data.refreshes || 0) + 1;
      const { session } = await import('./seed.mjs'); return { json: { ...session(3600), refresh_token: 'r' + data.refreshes } };
    }
    if (r.path.startsWith('/auth/v1/user')) return { json: { id: UID, aud: 'authenticated', email: 'tester@example.test' } };
    switch (P) {
      case 'profiles': return one(data.profile, r);
      case 'banned_users': return isObj(r) ? { json: null, status: 406 } : { json: [] };
      case 'categories': return { json: data.categories };
      case 'app_banners': return { json: [] };
      case 'rpc/get_user_business': return { json: data.business ? [data.biz] : [] };
      case 'rpc/ensure_profile_exists': return { json: null };
      case 'rpc/get_ranked_events': { const b = body(r); const off = b.p_offset || 0; return { json: data.ranked.slice(off, off + (b.result_limit || 100)) }; }
      case 'rpc/get_event_details': {
        const e = data.ev.find((x) => x.id === body(r).event_uuid); if (!e) return { json: null };
        const rk = data.ranked.find((x) => x.id === e.id);
        return { json: { event: e, business: data.biz, category: data.categories.find((c) => c.id === e.category_id), links: [], photos: [],
          rsvp_count: rk.rsvp_count, save_count: rk.save_count, user_rsvp: rk.user_rsvp, user_saved: rk.user_saved, user_following_business: false } };
      }
      case 'notifications': {
        if (r.method === 'PATCH' || r.method === 'DELETE') return { json: [] };
        let rows = data.notifs;
        if (q.read === 'eq.false') rows = rows.filter((n) => !n.read);
        return counted(page(rows, r), rows.length, r);
      }
      case 'event_rsvp_counts': return isObj(r) ? one(null, r) : { json: [] };
      case 'events': {
        const id = eqv(q.id);
        if (id) { const e = data.ev.find((x) => x.id === id); return one(e ? { status: e.status, cover_image_url: e.cover_image_url } : null, r); }
        const rows = data.ev.filter((e) => !q.business_id || e.business_id === eqv(q.business_id));
        return counted(page(rows, r), rows.length, r);
      }
      case 'rpc/get_event_attendees_page': { const b = body(r); const off = b.p_offset || 0, lim = b.p_limit || 30;
        return { json: { total: data.people.length, items: data.people.slice(off, off + lim), has_more: off + lim < data.people.length } }; }
      case 'rpc/get_event_attendees_public': return { json: data.people };
      case 'rpc/get_profiles_display': return { json: data.people.concat([{ id: UID, name: data.profile.name, avatar_url: null }]) };
      case 'rpc/get_user_saved_events': { const b = body(r); const off = b.p_offset || 0, lim = b.p_limit || 30;
        return { json: data.ranked.filter((e) => e.user_saved).slice(off, off + lim) }; }
      case 'rpc/get_user_going_events': { const b = body(r); const off = b.p_offset || 0, lim = b.p_limit || 30;
        return { json: data.ranked.filter((e) => e.user_rsvp === 'going').slice(off, off + lim) }; }
      case 'rpc/get_user_attendance_counts': return { json: { upcoming_count: 15, attended_count: 3, saved_count: 20, interested_count: 2, requested_count: 0 } };
      case 'rpc/get_user_upcoming_events': case 'rpc/get_user_past_events': return { json: data.ranked.slice(0, 5) };
      case 'follows': return r.method === 'HEAD' ? counted([], 42, r) : { json: data.follows };
      case 'reviews': return { json: [] };
      case 'saves': case 'rsvps': return r.method === 'GET' ? one(null, r) : { json: [] };
      case 'rpc/get_event_chat_post_status': return { json: [{ can_read: true, can_post: true, is_banned: false, is_blocked: false,
        is_host: false, is_admin: false, muted: false, locked: false, slow_mode_seconds: data.slowMode ?? 0, block_expires_at: null,
        last_read_at: null, last_post_at: data.lastPostAt ?? null, chat_mode: 'open', open_policy: 'two_going', pinned_message_id: null }] };
      case 'rpc/get_event_chat_messages': { const b = body(r); const lim = b.p_limit || 100;
        let rows = data.messages.filter((m) => m.event_id === b.event_uuid);
        if (b.p_before_created_at) rows = rows.filter((m) => m.created_at < b.p_before_created_at);
        return { json: rows.slice().reverse().slice(0, lim).map((m) => ({ ...m, body: m.deleted_at ? '' : m.body })) }; }
      case 'rpc/get_event_chat_messages_since': { const b = body(r); return { json: data.messages.filter((m) => m.event_id === b.event_uuid && m.created_at >= b.p_since).slice(0, b.p_limit || 100) }; }
      case 'event_chat_messages': {
        if (r.method === 'POST') { const row = { deleted_at: null, deleted_by: null, mentions: [], created_at: new Date().toISOString(), ...body(r) };
          data.sent = (data.sent || []).concat(row); data.messages.push(row);
          if (data.failSends) return { status: 500, json: { message: 'boom' } };
          return isObj(r) ? { json: row, status: 201 } : { json: [row], status: 201 }; }
        const last = data.messages.filter((m) => !m.deleted_at).at(-1); return one(last, r); }
      case 'rpc/get_event_chat_unread_counts': return { json: (body(r).event_ids || body(r).p_event_ids || []).map((id) => ({ event_id: id, unread_count: 3 })) };
      case 'rpc/mark_event_chat_read': case 'rpc/track_event_view': return { json: null };
      case 'user_blocks': return { json: [] };
      case 'rpc/get_business_review_summary': return { json: [{ average: 4.5, review_count: 12 }] };
      case 'rpc/get_business_follower_counts': return { json: (body(r).p_business_ids || []).map((id) => ({ business_id: id, follower_count: 42 })) };
      case 'businesses': return one(data.biz, r);
      case 'business_photos': case 'business_links': return { json: [] };
      case 'rpc/get_event_host_attendees_page': { const b = body(r); const off = b.p_offset || 0, lim = b.p_limit || 30;
        const items = data.people.slice(off, off + lim).map((p, i) => ({ user_id: p.id, name: p.name, avatar_url: null, bio: null,
          is_private: p.is_private, status: b.p_status || 'going', joined_at: iso(-i), reason: null, chat_blocked: false }));
        return { json: { total: data.people.length, items, has_more: off + lim < data.people.length } }; }
      case 'rpc/get_event_host_overview': return { status: 404, json: { code: 'PGRST202', message: 'not found' } };
      case 'rpc/get_user_calendar': return { json: { rows: [], truncated: false } };
      default: unknown.push(key + (r.query || '')); return isObj(r) ? { json: null } : { json: [] };
    }
  };
}
