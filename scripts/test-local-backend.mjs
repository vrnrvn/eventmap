import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const status = JSON.parse(execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}));
assert.ok(['localhost', '127.0.0.1'].includes(new URL(status.API_URL).hostname), 'Tests must only use the local backend');
const client = () => createClient(status.API_URL, status.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const host = client(), alex = client(), sam = client(), anonymous = client(), newcomer = client();
const clients = [host, alex, sam, anonymous, newcomer];
function ok(result) { assert.ifError(result.error); return result.data; }
let eventId;
let channel;
let photoPath;
let newUserId;
try {
  const signup = ok(await newcomer.auth.signUp({
    email: `integration-${Date.now()}@example.test`, password: 'LocalDemo123!',
    options: { data: { name: 'Disposable Test Attendee' } },
  }));
  newUserId = signup.user?.id;
  assert.ok(newUserId && signup.session, 'Local signup should create an email-confirmed session');
  assert.equal(ok(await newcomer.from('profiles').select('name').eq('id', newUserId).single()).name, 'Disposable Test Attendee');
  console.log('PASS: fresh email signup and automatic profile creation');
  for (const [api, email] of [[host, 'host@example.test'], [alex, 'alex@example.test'], [sam, 'sam@example.test']]) {
    ok(await api.auth.signInWithPassword({ email, password: 'LocalDemo123!' }));
  }
  const alexId = (await alex.auth.getUser()).data.user.id;
  const samId = (await sam.auth.getUser()).data.user.id;
  const business = ok(await host.rpc('get_user_business'))[0];
  assert.ok(business);
  const categories = ok(await anonymous.from('categories').select('*'));
  assert.ok(categories.length >= 10);
  const events = ok(await anonymous.rpc('get_ranked_events', { user_lat: 37.7749, user_lng: -122.4194 }));
  assert.ok(events.length >= 3, 'Synthetic events should be discoverable');
  console.log('PASS: demo email authentication, business lookup, public discovery');

  eventId = ok(await host.rpc('create_event_with_limit_check', {
    p_business_id: business.id, p_title: 'Integration test event', p_description: 'Disposable synthetic test',
    p_category_id: categories[0].id, p_start_datetime: new Date(Date.now() + 86400000).toISOString(),
    p_end_datetime: new Date(Date.now() + 90000000).toISOString(), p_lat: 37.7749, p_lng: -122.4194,
    p_address: 'Synthetic test location',
  }));
  assert.ok(eventId);
  ok(await host.from('events').update({ title: 'Updated integration event' }).eq('id', eventId));
  assert.equal(ok(await host.rpc('get_event_details', { event_uuid: eventId })).event.title, 'Updated integration event');
  console.log('PASS: event creation, detail lookup, editing');

  ok(await alex.from('rsvps').upsert({ event_id: eventId, user_id: alexId, status: 'going' }));
  const blocked = await alex.from('event_chat_messages').insert({ event_id: eventId, sender_id: alexId, body: 'Too early' });
  assert.ok(blocked.error, 'One attendee must not activate chat');
  ok(await sam.from('rsvps').upsert({ event_id: eventId, user_id: samId, status: 'going' }));
  const upcoming = ok(await alex.rpc('get_user_upcoming_events', { user_id_param: alexId }));
  assert.ok(upcoming.some((event) => event.id === eventId));

  let received;
  const delivery = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime message not received')), 15000);
    received = () => { clearTimeout(timer); resolve(); };
  });
  // Attach the rejection handler immediately while the subscription connects.
  delivery.catch(() => {});
  channel = alex.channel(`integration-${eventId}`).on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'event_chat_messages', filter: `event_id=eq.${eventId}`,
  }, received);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscription timed out')), 10000);
    channel.on('system', {}, (payload) => {
      if (payload.extension !== 'postgres_changes') return;
      if (payload.status === 'ok') { clearTimeout(timer); resolve(); }
      if (payload.status === 'error') { clearTimeout(timer); reject(new Error(payload.message)); }
    });
    channel.subscribe((state) => {
      if (state === 'CHANNEL_ERROR') { clearTimeout(timer); reject(new Error('Realtime subscription failed')); }
    });
  });
  ok(await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'Hello from Sam' }));
  await delivery;
  assert.equal(ok(await alex.from('event_chat_messages').select('*').eq('event_id', eventId)).length, 1);
  assert.equal(ok(await host.from('event_chat_messages').select('*').eq('event_id', eventId)).length, 0, 'Non-attending host must not read chat');
  assert.equal(ok(await anonymous.from('event_chat_messages').select('*').eq('event_id', eventId)).length, 0);
  assert.ok((await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: alexId, body: 'Spoofed' })).error);
  ok(await sam.from('rsvps').delete().eq('event_id', eventId).eq('user_id', samId));
  assert.equal(ok(await sam.from('event_chat_messages').select('*').eq('event_id', eventId)).length, 0);
  console.log('PASS: RSVP list, two-attendee chat gate, realtime, sender identity, leave-event revocation');

  photoPath = `${alexId}/integration-${Date.now()}.png`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  ok(await alex.storage.from('avatars').upload(photoPath, png, { contentType: 'image/png' }));
  const publicUrl = alex.storage.from('avatars').getPublicUrl(photoPath).data.publicUrl;
  assert.equal((await fetch(publicUrl)).status, 200);
  console.log('PASS: local image storage upload and public retrieval');
} finally {
  if (channel) await alex.removeChannel(channel);
  if (photoPath) await alex.storage.from('avatars').remove([photoPath]);
  if (eventId) ok(await host.from('events').delete().eq('id', eventId));
  if (newUserId) {
    const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    ok(await admin.auth.admin.deleteUser(newUserId));
  }
  await Promise.all(clients.map((api) => api.auth.signOut({ scope: 'local' })));
}
