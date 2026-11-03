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
const serviceRole = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const clients = [host, alex, sam, anonymous, newcomer];
function ok(result) { assert.ifError(result.error); return result.data; }
// Sam sends many messages across test blocks; backdate recent ones so the
// 10-messages-per-10-seconds limit only fires in the test that targets it.
const coolDownSender = async (userId) =>
  ok(await serviceRole.from('event_chat_messages').update({ created_at: new Date(Date.now() - 60000).toISOString() })
    .eq('sender_id', userId).gt('created_at', new Date(Date.now() - 30000).toISOString()));
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

  // --- Profile attendance: upcoming/past split, counts, server-side privacy, anonymous attendee ids ---
  {
    const going = ok(await alex.rpc('get_user_going_events', { user_id_param: alexId, p_scope: 'upcoming', p_limit: 50 }));
    const mine = going.find((event) => event.id === eventId);
    assert.ok(mine && mine.next_start_datetime, 'Upcoming rows include the event and a next occurrence');
    assert.ok(!ok(await alex.rpc('get_user_going_events', { user_id_param: alexId, p_scope: 'past', p_limit: 50 })).some((event) => event.id === eventId), 'A future event is not in the past list');
    const counts = ok(await alex.rpc('get_user_attendance_counts', { user_id_param: alexId }));
    assert.ok(counts.upcoming_count >= 1, 'Owner sees an upcoming count');
    assert.ok(ok(await sam.rpc('get_user_upcoming_events', { user_id_param: alexId })).some((event) => event.id === eventId), 'Public profile upcoming list is visible to others');
    assert.equal(ok(await sam.rpc('get_user_past_events', { user_id_param: alexId })).length, 0, 'History is never visible to others');
    assert.equal(ok(await sam.rpc('get_user_attendance_counts', { user_id_param: alexId })).attended_count, 0, 'Attended count is withheld from others');
    assert.equal(ok(await anonymous.rpc('get_user_upcoming_events', { user_id_param: alexId })).length, 0, 'Anonymous callers get nothing');

    ok(await alex.from('profiles').update({ is_profile_private: true }).eq('id', alexId));
    try {
      assert.equal(ok(await sam.rpc('get_user_upcoming_events', { user_id_param: alexId })).length, 0, 'Private profile hides the upcoming list server-side');
      assert.equal(ok(await sam.rpc('get_user_attendance_counts', { user_id_param: alexId })).upcoming_count, 0, 'Private profile hides counts server-side');
      assert.ok(ok(await alex.rpc('get_user_upcoming_events', { user_id_param: alexId })).some((event) => event.id === eventId), 'Owner still sees own list while private');
      const attendees = ok(await sam.rpc('get_event_attendees_public', { event_uuid: eventId }));
      const anon = attendees.find((row) => row.is_anonymous);
      assert.ok(anon, 'Private attendee is listed anonymously');
      assert.ok(!anon.id.includes(alexId) && anon.id.startsWith('anon-') && anon.avatar_url === null, 'Anonymous attendee id does not expose the user id');
    } finally {
      ok(await alex.from('profiles').update({ is_profile_private: false }).eq('id', alexId));
    }
    assert.ok(ok(await sam.rpc('get_event_attendees_public', { event_uuid: eventId })).some((row) => row.id === alexId && !row.is_anonymous), 'Public attendee is listed with the real id again');
    const badScope = await alex.rpc('get_user_going_events', { user_id_param: alexId, p_scope: 'everything' });
    assert.ok(badScope.error, 'Invalid scope is rejected');
    ok(await alex.from('saves').upsert({ event_id: eventId, user_id: alexId }, { onConflict: 'user_id,event_id' }));
    const saved = ok(await alex.rpc('get_user_saved_events', {}));
    assert.ok(saved.some((event) => event.id === eventId && event.has_ended === false && event.saved_at), 'Saved events come back from one RPC with status fields');
    assert.ok(ok(await alex.rpc('get_user_attendance_counts', { user_id_param: alexId })).saved_count >= 1, 'Owner sees a saved count');
    assert.ok(!ok(await sam.rpc('get_user_saved_events', {})).some((event) => event.id === eventId), 'Saved events are caller-scoped');
    ok(await alex.from('saves').delete().eq('event_id', eventId).eq('user_id', alexId));

    // Interested RSVPs: owner-only list and count
    ok(await alex.from('rsvps').upsert({ event_id: eventId, user_id: alexId, status: 'interested' }, { onConflict: 'user_id,event_id' }));
    assert.ok(ok(await alex.rpc('get_user_going_events', { user_id_param: alexId, p_scope: 'interested' })).some((event) => event.id === eventId), 'Owner sees interested list');
    assert.equal(ok(await sam.rpc('get_user_going_events', { user_id_param: alexId, p_scope: 'interested' })).length, 0, 'Interested list is owner-only');
    assert.ok(ok(await alex.rpc('get_user_attendance_counts', { user_id_param: alexId })).interested_count >= 1, 'Owner sees interested count');
    ok(await alex.from('rsvps').upsert({ event_id: eventId, user_id: alexId, status: 'going' }, { onConflict: 'user_id,event_id' }));

    // Profiles table lockdown: only own row readable; RPCs provide the rest
    assert.equal(ok(await sam.from('profiles').select('id').eq('id', alexId)).length, 0, 'Other users cannot read profile rows directly');
    assert.equal(ok(await alex.from('profiles').select('id').eq('id', alexId)).length, 1, 'Owner still reads own profile row');
    const pub = ok(await sam.rpc('get_public_profile', { user_id_param: alexId }));
    assert.ok(pub && pub.is_private === false && pub.profile?.name && pub.profile.is_admin === undefined && pub.profile.lat === undefined, 'Public profile RPC returns safe columns only');
    const display = ok(await sam.rpc('get_profiles_display', { user_ids: [alexId, samId] }));
    assert.equal(display.length, 2, 'Display RPC resolves names for chat and lists');
    console.log('PASS: attendance lists, counts, privacy enforcement, anonymous attendee ids');
  }

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
  assert.equal(ok(await host.from('event_chat_messages').select('*').eq('event_id', eventId)).length, 1, 'Non-attending admin can read chat for moderation');
  assert.equal(ok(await newcomer.from('event_chat_messages').select('*').eq('event_id', eventId)).length, 0, 'Non-attending non-admin must not read chat');
  assert.equal(ok(await anonymous.from('event_chat_messages').select('*').eq('event_id', eventId)).length, 0);
  assert.ok((await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: alexId, body: 'Spoofed' })).error);

  // --- Chat features: client ids (idempotent sends), soft delete, reads/unread, notifications, reports, rate limit ---
  const clientMessageId = crypto.randomUUID();
  ok(await sam.from('event_chat_messages').insert({ id: clientMessageId, event_id: eventId, sender_id: samId, body: 'Client id message' }));
  const dupe = await sam.from('event_chat_messages').insert({ id: clientMessageId, event_id: eventId, sender_id: samId, body: 'Client id message' });
  assert.equal(dupe.error?.code, '23505', 'Re-sending with the same client id must be a unique violation, not a second message');
  assert.equal(ok(await alex.from('event_chat_messages').select('id').eq('event_id', eventId)).length, 2);

  const unreadBefore = ok(await alex.rpc('get_event_chat_unread_counts', { p_event_ids: [eventId] }));
  assert.equal(unreadBefore.find((row) => row.event_id === eventId)?.unread_count, 2, 'Alex has not read either of Sam\'s messages');
  ok(await alex.rpc('mark_event_chat_read', { p_event_id: eventId }));
  const unreadAfter = ok(await alex.rpc('get_event_chat_unread_counts', { p_event_ids: [eventId] }));
  assert.equal(unreadAfter.find((row) => row.event_id === eventId)?.unread_count, 0, 'Marking read clears the unread count');
  assert.equal(ok(await sam.rpc('get_event_chat_unread_counts', { p_event_ids: [eventId] })).find((row) => row.event_id === eventId)?.unread_count, 0, 'Own messages never count as unread');

  const alexChatNotifications = ok(await alex.from('notifications').select('id,type,body,data').eq('type', 'chat_message').eq('event_id', eventId));
  assert.equal(alexChatNotifications.length, 1, 'Exactly one throttled chat notification for Alex');
  const samName = ok(await sam.from('profiles').select('name').eq('id', samId).single()).name;
  assert.ok(alexChatNotifications[0].body.startsWith(`${samName}: `), 'Chat notification names the sender');
  assert.equal(alexChatNotifications[0].data?.kind, 'chat');
  assert.equal(ok(await sam.from('notifications').select('id').eq('type', 'chat_message').eq('event_id', eventId)).length, 0, 'Senders are not notified about their own messages');

  assert.equal(ok(await alex.rpc('delete_event_chat_message', { p_message_id: clientMessageId })), false, 'Cannot delete someone else\'s message');
  assert.equal(ok(await sam.rpc('delete_event_chat_message', { p_message_id: clientMessageId })), true, 'Can delete own message');
  assert.equal(ok(await alex.from('event_chat_messages').select('id').eq('event_id', eventId).is('deleted_at', null)).length, 1, 'Soft-deleted message hidden');

  ok(await alex.from('complaints').insert({ reporter_id: alexId, target_type: 'chat_message', target_id: clientMessageId, reason: 'test report' }));

  // --- Moderation: host/admin reads, blocks, bans, host delete + audit log, auto-hide, one report per user, mute, post status ---
  await coolDownSender(samId);
  const hostId = (await host.auth.getUser()).data.user.id;
  // Exercise the host-only path: the seeded host is also an admin, so drop admin for this section.
  ok(await serviceRole.from('profiles').update({ is_admin: false }).eq('id', hostId));
  assert.equal(ok(await host.rpc('get_event_chat_post_status', { event_uuid: eventId }))[0].is_admin, false, 'Admin flag cleared for host-only checks');
  assert.ok(ok(await host.from('event_chat_messages').select('id').eq('event_id', eventId)).length >= 1, 'Host can read own event chat without attending');
  const hostStatus = ok(await host.rpc('get_event_chat_post_status', { event_uuid: eventId }))[0];
  assert.equal(hostStatus.can_read, true); assert.equal(hostStatus.can_post, true, 'Host can post without an RSVP'); assert.equal(hostStatus.is_host, true);

  const modMsgId = crypto.randomUUID();
  ok(await sam.from('event_chat_messages').insert({ id: modMsgId, event_id: eventId, sender_id: samId, body: 'To be moderated' }));
  assert.equal(ok(await host.rpc('delete_event_chat_message', { p_message_id: modMsgId })), true, 'Host can delete a message in own event');
  const log1 = ok(await host.from('event_chat_moderation_actions').select('message_id,action,actor_id').eq('event_id', eventId));
  assert.ok(log1.some((row) => row.message_id === modMsgId && row.action === 'delete' && row.actor_id === hostId), 'Moderator delete is logged and visible to the host via RLS');
  assert.equal(ok(await alex.from('event_chat_moderation_actions').select('id').eq('event_id', eventId)).length, 0, 'Attendees cannot read the moderation log');

  ok(await host.rpc('block_event_chat_user', { p_event_id: eventId, p_user_id: samId, p_reason: 'test block' }));
  const blockedStatus = ok(await sam.rpc('get_event_chat_post_status', { event_uuid: eventId }))[0];
  assert.equal(blockedStatus.is_blocked, true); assert.equal(blockedStatus.can_post, false); assert.equal(blockedStatus.can_read, true, 'Blocked users can still read');
  assert.ok((await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'blocked' })).error, 'Blocked user cannot post');
  assert.ok((await alex.rpc('block_event_chat_user', { p_event_id: eventId, p_user_id: samId })).error, 'Attendees cannot block others');
  ok(await host.rpc('unblock_event_chat_user', { p_event_id: eventId, p_user_id: samId }));
  assert.equal(ok(await sam.rpc('get_event_chat_post_status', { event_uuid: eventId }))[0].can_post, true, 'Unblocked user can post again');
  assert.equal(ok(await alex.rpc('delete_event_chat_message', { p_message_id: (ok(await alex.from('event_chat_messages').select('id').eq('event_id', eventId).eq('sender_id', samId).is('deleted_at', null).limit(1)))[0].id })), false, 'Attendees cannot delete others\' messages');
  assert.ok((await host.rpc('admin_get_chat_moderation_log', { p_limit: 5 })).error === null && ok(await host.rpc('admin_get_chat_moderation_log', { p_limit: 5 })).length === 0, 'Non-admin host gets an empty admin log');
  ok(await serviceRole.from('profiles').update({ is_admin: true }).eq('id', hostId));

  ok(await host.rpc('admin_ban_user', { p_user_id: samId, p_reason: 'test ban' }));
  assert.ok((await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'banned' })).error, 'Banned user cannot post');
  assert.equal(ok(await sam.rpc('get_event_chat_post_status', { event_uuid: eventId }))[0].is_banned, true);
  ok(await host.rpc('admin_unban_user', { p_user_id: samId }));

  const reportedId = crypto.randomUUID();
  ok(await sam.from('event_chat_messages').insert({ id: reportedId, event_id: eventId, sender_id: samId, body: 'Reported by many' }));
  ok(await alex.from('complaints').insert({ reporter_id: alexId, target_type: 'chat_message', target_id: reportedId, reason: 'Spam' }));
  assert.equal((await alex.from('complaints').insert({ reporter_id: alexId, target_type: 'chat_message', target_id: reportedId, reason: 'Spam again' })).error?.code, '23505', 'One report per user per message');
  const queue = ok(await host.rpc('admin_get_chat_reports', { p_status: 'pending' }));
  const queued = queue.find((row) => row.message_id === reportedId);
  assert.ok(queued && queued.report_count === 1 && queued.reasons.includes('Spam') && queued.sender_id === samId, 'Admin report queue aggregates reports');
  const nonAdminQueue = await alex.rpc('admin_get_chat_reports', { p_status: 'pending' });
  assert.ok(!nonAdminQueue.error && nonAdminQueue.data.length === 0, 'Non-admins see no report queue');
  assert.ok((await sam.from('complaints').insert({ reporter_id: samId, target_type: 'chat_message', target_id: reportedId, reason: 'Spam' })).error?.message.includes('chat_report_not_allowed'), 'Cannot report your own message');
  assert.ok((await newcomer.from('complaints').insert({ reporter_id: newUserId, target_type: 'chat_message', target_id: reportedId, reason: 'Other' })).error?.message.includes('chat_report_not_allowed'), 'Users without chat access cannot report');
  ok(await host.from('complaints').insert({ reporter_id: hostId, target_type: 'chat_message', target_id: reportedId, reason: 'Harassment' }));
  assert.equal(ok(await host.rpc('admin_dismiss_chat_reports', { p_message_id: reportedId })), 2, 'Dismiss clears the two pending reports');
  ok(await newcomer.from('rsvps').upsert({ event_id: eventId, user_id: newUserId, status: 'going' }));
  ok(await newcomer.from('complaints').insert({ reporter_id: newUserId, target_type: 'chat_message', target_id: reportedId, reason: 'Other' }));
  assert.equal(ok(await host.from('event_chat_messages').select('deleted_at').eq('id', reportedId).single()).deleted_at, null, 'Dismissed reports do not count toward auto-hide');
  ok(await serviceRole.from('complaints').update({ status: 'pending' }).eq('target_type', 'chat_message').eq('target_id', reportedId));
  const hidden = ok(await host.from('event_chat_messages').select('deleted_at').eq('id', reportedId).single());
  assert.ok(hidden.deleted_at === null, 'Auto-hide is evaluated on report insert, not on status edits');
  ok(await serviceRole.from('complaints').delete().eq('target_type', 'chat_message').eq('target_id', reportedId).eq('reporter_id', newUserId));
  ok(await newcomer.from('complaints').insert({ reporter_id: newUserId, target_type: 'chat_message', target_id: reportedId, reason: 'Other' }));
  assert.ok(ok(await host.from('event_chat_messages').select('deleted_at').eq('id', reportedId).single()).deleted_at, 'Message auto-hidden after 3 distinct pending reporters');
  assert.ok(ok(await host.rpc('admin_get_chat_moderation_log', { p_limit: 20 })).some((row) => row.message_id === reportedId && row.action === 'auto_hide'), 'Auto-hide is logged');
  assert.equal(ok(await host.rpc('admin_resolve_chat_reports', { p_message_id: reportedId })), 3, 'Confirming a hide resolves all pending reports');
  assert.equal(ok(await host.rpc('admin_restore_chat_message', { p_message_id: reportedId })), true, 'Admin can restore a hidden message');
  assert.equal(ok(await alex.from('event_chat_messages').select('id').eq('id', reportedId).is('deleted_at', null)).length, 1, 'Restored message visible again');
  assert.ok(ok(await host.rpc('admin_get_chat_moderation_log', { p_limit: 20 })).some((row) => row.message_id === reportedId && row.action === 'restore'), 'Restore is logged');
  ok(await newcomer.from('rsvps').delete().eq('event_id', eventId).eq('user_id', newUserId));

  ok(await alex.rpc('set_event_chat_muted', { p_event_id: eventId, p_muted: true }));
  assert.equal(ok(await alex.rpc('get_event_chat_post_status', { event_uuid: eventId }))[0].muted, true);
  ok(await serviceRole.from('notifications').delete().eq('type', 'chat_message').eq('event_id', eventId));
  ok(await serviceRole.from('event_chat_reads').update({ last_read_at: new Date(Date.now() - 3600000).toISOString() }).eq('event_id', eventId).eq('user_id', alexId));
  ok(await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'Muted test' }));
  assert.equal(ok(await alex.from('notifications').select('id').eq('type', 'chat_message').eq('event_id', eventId)).length, 0, 'Muted chats do not notify');
  ok(await alex.rpc('set_event_chat_muted', { p_event_id: eventId, p_muted: false }));
  ok(await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'Unmuted test' }));
  assert.equal(ok(await alex.from('notifications').select('id').eq('type', 'chat_message').eq('event_id', eventId)).length, 1, 'Unmuted chats notify again');

  // --- Tombstones, mentions, admin report details ---
  await coolDownSender(samId);
  const tombId = crypto.randomUUID();
  ok(await sam.from('event_chat_messages').insert({ id: tombId, event_id: eventId, sender_id: samId, body: 'Secret to be removed' }));
  ok(await host.rpc('delete_event_chat_message', { p_message_id: tombId }));
  const page = ok(await alex.rpc('get_event_chat_messages', { event_uuid: eventId, p_limit: 50 }));
  const tomb = page.find((row) => row.id === tombId);
  assert.ok(tomb && tomb.deleted_at && tomb.body === '' && tomb.deleted_by === hostId, 'Removed messages are returned as tombstones with the body masked');
  const since = ok(await alex.rpc('get_event_chat_messages_since', { event_uuid: eventId, p_since: new Date(Date.now() - 600000).toISOString(), p_limit: 50 }));
  assert.ok(since.some((row) => row.id === tombId && row.body === ''), 'Gap recovery also masks removed bodies');
  assert.equal(ok(await host.rpc('admin_restore_chat_message', { p_message_id: tombId })), true);
  assert.ok(ok(await alex.rpc('get_event_chat_messages', { event_uuid: eventId, p_limit: 50 })).some((row) => row.id === tombId && row.body === 'Secret to be removed' && row.deleted_by === null), 'Restore clears deleted_by and returns the body again');
  assert.equal(ok(await newcomer.rpc('get_event_chat_messages', { event_uuid: eventId, p_limit: 50 })).length, 0, 'Message RPC still honours RLS for outsiders');

  ok(await serviceRole.from('notifications').delete().in('type', ['chat_message', 'chat_mention']).eq('event_id', eventId));
  ok(await serviceRole.from('event_chat_reads').upsert({ user_id: alexId, event_id: eventId, last_read_at: new Date(Date.now() - 3600000).toISOString(), muted: true }));
  ok(await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: '@Demo Alex are you coming?', mentions: [alexId] }));
  const mentionNotes = ok(await alex.from('notifications').select('type,title,data').eq('event_id', eventId).in('type', ['chat_message', 'chat_mention']));
  assert.ok(mentionNotes.length === 1 && mentionNotes[0].type === 'chat_mention' && mentionNotes[0].data?.kind === 'chat', 'Mentions notify even when the chat is muted');
  ok(await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: '@Demo Alex second ping', mentions: [alexId] }));
  assert.equal(ok(await alex.from('notifications').select('id').eq('event_id', eventId).eq('type', 'chat_mention')).length, 1, 'A sender can only ping the same person once per 5 minutes');
  ok(await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'plain message after mention' }));
  assert.equal(ok(await alex.from('notifications').select('id').eq('event_id', eventId).eq('type', 'chat_message')).length, 0, 'Mention pushes count toward the regular 15-minute throttle');
  ok(await serviceRole.from('event_chat_reads').update({ muted: false }).eq('user_id', alexId).eq('event_id', eventId));
  const overflow = ok(await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'too many', mentions: Array.from({ length: 21 }, () => crypto.randomUUID()) }).select('mentions').single());
  assert.deepEqual(overflow.mentions, [], 'Unknown mention ids are stripped server-side');

  const detailsRow = (ok(await host.rpc('admin_get_chat_reports', { p_status: 'all' })))[0];
  const detail = ok(await host.rpc('admin_get_chat_report_details', { p_message_id: detailsRow.message_id }));
  assert.ok(Array.isArray(detail.reporters) && detail.reporters.length >= 1 && Array.isArray(detail.context) && detail.context.some((m) => m.is_target) && detail.sender_history, 'Admin report details include reporters, context and sender history');
  assert.equal(ok(await alex.rpc('admin_get_chat_report_details', { p_message_id: detailsRow.message_id })), null, 'Non-admins get no report details');
  assert.equal(typeof ok(await host.rpc('admin_count_pending_chat_reports')), 'number');
  assert.equal(ok(await alex.rpc('admin_count_pending_chat_reports')), 0, 'Non-admins see a zero pending count');
  console.log('PASS: tombstones, mention notifications, admin report details');

  // --- Hardening 2: removed bodies unreadable, mention sanitizing/throttle, host report tools ---
  await coolDownSender(samId);
  const secretId = crypto.randomUUID();
  ok(await sam.from('event_chat_messages').insert({ id: secretId, event_id: eventId, sender_id: samId, body: 'Secret body text' }));
  ok(await host.rpc('delete_event_chat_message', { p_message_id: secretId }));
  const rawRow = ok(await alex.from('event_chat_messages').select('body,deleted_at').eq('id', secretId).single());
  assert.ok(rawRow.deleted_at && rawRow.body === '', 'Removed body is not readable through the table API');
  assert.equal(ok(await alex.from('event_chat_removed_bodies').select('*').eq('message_id', secretId)).length, 0, 'Removed bodies are admin-only');
  assert.equal(ok(await host.rpc('admin_restore_chat_message', { p_message_id: secretId })), true);
  assert.equal(ok(await alex.from('event_chat_messages').select('body').eq('id', secretId).single()).body, 'Secret body text', 'Restore brings the body back');
  const adminQueueRow = ok(await host.rpc('admin_get_chat_reports', { p_status: 'all' })).find((row) => row.deleted_at);
  if (adminQueueRow) assert.ok(typeof adminQueueRow.body === 'string', 'Admin queue still exposes removed bodies to admins');

  const spam = ok(await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'mention spam', mentions: [samId, hostId, crypto.randomUUID(), alexId] }).select('mentions').single());
  assert.deepEqual([...spam.mentions].sort(), [alexId].sort(), 'Mentions are limited to going attendees other than the sender');
  ok(await serviceRole.from('notifications').delete().in('type', ['chat_message', 'chat_mention']).eq('event_id', eventId));
  ok(await serviceRole.from('event_chat_reads').upsert({ user_id: alexId, event_id: eventId, last_read_at: new Date(Date.now() - 3600000).toISOString(), muted: false }));
  ok(await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'ping 1', mentions: [alexId] }));
  ok(await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'ping 2', mentions: [alexId] }));
  assert.equal(ok(await alex.from('notifications').select('id').eq('event_id', eventId).eq('type', 'chat_mention')).length, 1, 'Same sender cannot ping the same person twice within 5 minutes');

  const hostReportedId = crypto.randomUUID();
  ok(await sam.from('event_chat_messages').insert({ id: hostReportedId, event_id: eventId, sender_id: samId, body: 'Please review me' }));
  ok(await alex.from('complaints').insert({ reporter_id: alexId, target_type: 'chat_message', target_id: hostReportedId, reason: 'Spam' }));
  ok(await serviceRole.from('profiles').update({ is_admin: false }).eq('id', hostId));
  const hostReported = ok(await host.rpc('get_event_chat_reported_messages', { event_uuid: eventId }));
  assert.ok(hostReported.some((row) => row.message_id === hostReportedId && row.report_count === 1 && row.body === 'Please review me'), 'Non-admin host sees pending reports for own event');
  assert.equal(ok(await alex.rpc('get_event_chat_reported_messages', { event_uuid: eventId })).length, 0, 'Attendees cannot see the report list');
  assert.equal(ok(await host.rpc('dismiss_event_chat_reports', { p_message_id: hostReportedId })), 1, 'Host can keep a reported message and clear its reports');
  assert.ok((await alex.rpc('dismiss_event_chat_reports', { p_message_id: hostReportedId })).error, 'Attendees cannot dismiss reports');
  ok(await serviceRole.from('profiles').update({ is_admin: true }).eq('id', hostId));
  console.log('PASS: removed bodies hidden, mention sanitizing and throttle, host report tools');

  // --- Host controls: lock, slow mode, timed blocks, host restore, post status fields ---
  await coolDownSender(samId);
  ok(await serviceRole.from('profiles').update({ is_admin: false }).eq('id', hostId));
  assert.ok((await alex.rpc('set_event_chat_settings', { p_event_id: eventId, p_locked: true })).error, 'Attendees cannot change chat settings');
  ok(await host.rpc('set_event_chat_settings', { p_event_id: eventId, p_locked: true }));
  const lockedStatus = ok(await sam.rpc('get_event_chat_post_status', { event_uuid: eventId }))[0];
  assert.equal(lockedStatus.locked, true); assert.equal(lockedStatus.can_post, false, 'Locked chat blocks attendee posting');
  assert.ok((await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'while locked' })).error, 'Insert rejected while locked');
  ok(await host.rpc('set_event_chat_settings', { p_event_id: eventId, p_locked: false, p_slow_mode_seconds: 30 }));
  ok(await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'slow 1' }));
  const slowErr = (await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'slow 2' })).error;
  assert.ok(slowErr?.message.includes('chat_slow_mode'), 'Slow mode rejects a second message within the window');
  const slowStatus = ok(await sam.rpc('get_event_chat_post_status', { event_uuid: eventId }))[0];
  assert.equal(slowStatus.slow_mode_seconds, 30); assert.ok(slowStatus.last_post_at, 'Status exposes the caller\'s last post time');
  ok(await host.rpc('set_event_chat_settings', { p_event_id: eventId, p_slow_mode_seconds: 0 }));
  assert.ok(ok(await host.from('event_chat_moderation_actions').select('action').eq('event_id', eventId)).some((row) => row.action === 'lock'), 'Lock is logged');

  ok(await host.rpc('block_event_chat_user', { p_event_id: eventId, p_user_id: samId, p_reason: 'timed', p_duration_minutes: 60 }));
  const timed = ok(await sam.rpc('get_event_chat_post_status', { event_uuid: eventId }))[0];
  assert.ok(timed.is_blocked && timed.block_expires_at, 'Timed block exposes its expiry');
  ok(await serviceRole.from('event_chat_blocks').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('event_id', eventId).eq('user_id', samId));
  assert.equal(ok(await sam.rpc('get_event_chat_post_status', { event_uuid: eventId }))[0].is_blocked, false, 'Expired blocks no longer apply');
  ok(await host.rpc('unblock_event_chat_user', { p_event_id: eventId, p_user_id: samId }));

  const hostRestoreId = crypto.randomUUID();
  await coolDownSender(samId);
  ok(await sam.from('event_chat_messages').insert({ id: hostRestoreId, event_id: eventId, sender_id: samId, body: 'host restore me' }));
  ok(await host.rpc('delete_event_chat_message', { p_message_id: hostRestoreId }));
  assert.ok((await alex.rpc('restore_event_chat_message', { p_message_id: hostRestoreId })).error, 'Attendees cannot restore');
  assert.equal(ok(await host.rpc('restore_event_chat_message', { p_message_id: hostRestoreId })), true, 'Non-admin host can restore');
  assert.equal(ok(await alex.from('event_chat_messages').select('body').eq('id', hostRestoreId).single()).body, 'host restore me');
  ok(await serviceRole.from('profiles').update({ is_admin: true }).eq('id', hostId));
  ok(await alex.rpc('mark_event_chat_read', { p_event_id: eventId }));
  assert.ok(ok(await alex.rpc('get_event_chat_post_status', { event_uuid: eventId }))[0].last_read_at, 'Status exposes the read marker');
  console.log('PASS: host controls (lock, slow mode, timed blocks, host restore, status fields)');

  // --- Final hardening: server-controlled timestamps, self-delete retraction, admin block expiry, slow-mode exemption ---
  await coolDownSender(samId);
  assert.ok((await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'spoofed time', created_at: '2000-01-01T00:00:00Z' })).error, 'Clients cannot supply created_at');
  assert.ok((await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: 'spoofed delete', deleted_by: samId })).error, 'Clients cannot supply deleted_by');
  const selfDelId = crypto.randomUUID();
  ok(await sam.from('event_chat_messages').insert({ id: selfDelId, event_id: eventId, sender_id: samId, body: 'retract me' }));
  ok(await sam.rpc('delete_event_chat_message', { p_message_id: selfDelId }));
  assert.equal(ok(await host.rpc('restore_event_chat_message', { p_message_id: selfDelId })), false, 'Self-deleted messages cannot be restored by moderators');
  assert.equal(ok(await serviceRole.from('event_chat_removed_bodies').select('message_id').eq('message_id', selfDelId)).length, 0, 'Self-deleted bodies are not retained');
  ok(await host.rpc('block_event_chat_user', { p_event_id: eventId, p_user_id: samId, p_reason: 'expiry test', p_duration_minutes: 60 }));
  ok(await serviceRole.from('event_chat_blocks').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('event_id', eventId).eq('user_id', samId));
  const queueRows = ok(await host.rpc('admin_get_chat_reports', { p_status: 'all' })).filter((row) => row.event_id === eventId);
  assert.ok(queueRows.every((row) => row.sender_blocked === false), 'Admin queue treats expired blocks as inactive');
  ok(await host.rpc('unblock_event_chat_user', { p_event_id: eventId, p_user_id: samId }));
  ok(await host.rpc('set_event_chat_settings', { p_event_id: eventId, p_slow_mode_seconds: 60 }));
  ok(await host.from('rsvps').upsert({ event_id: eventId, user_id: hostId, status: 'going' }));
  ok(await host.from('event_chat_messages').insert({ event_id: eventId, sender_id: hostId, body: 'host 1' }));
  ok(await host.from('event_chat_messages').insert({ event_id: eventId, sender_id: hostId, body: 'host 2' }));
  ok(await host.from('rsvps').delete().eq('event_id', eventId).eq('user_id', hostId));
  ok(await host.rpc('set_event_chat_settings', { p_event_id: eventId, p_slow_mode_seconds: 0 }));
  console.log('PASS: server-controlled timestamps, self-delete retraction, admin block expiry, slow-mode host exemption');

  // Presence: every client must land in the same realtime room for "here now" / typing to work.
  const roomTopic = `event-chat:${eventId}`;
  // realtime-js only enables presence on a channel that binds a presence listener (as the app does).
  const alexRoom = alex.channel(roomTopic, { config: { presence: { key: alexId } } }).on('presence', { event: 'sync' }, () => {});
  const samRoom = sam.channel(roomTopic, { config: { presence: { key: samId } } }).on('presence', { event: 'sync' }, () => {});
  const joined = (ch) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Presence subscription timed out')), 10000);
    ch.subscribe((state) => { if (state === 'SUBSCRIBED') { clearTimeout(timer); resolve(); } if (state === 'CHANNEL_ERROR') { clearTimeout(timer); reject(new Error('Presence channel error')); } });
  });
  await Promise.all([joined(alexRoom), joined(samRoom)]);
  await Promise.all([alexRoom.track({ name: 'Alex' }), samRoom.track({ name: 'Sam' })]);
  let members = 0;
  for (let i = 0; i < 40 && members < 2; i++) { await new Promise((r) => setTimeout(r, 250)); members = Object.keys(alexRoom.presenceState()).length; }
  assert.equal(members, 2, 'Both attendees are visible in the shared chat room presence');
  await Promise.all([alex.removeChannel(alexRoom), sam.removeChannel(samRoom)]);
  console.log('PASS: chat moderation (host-only path, blocks, bans, audit log, report validation, auto-hide, resolve/restore, mute, shared presence room)');

  const burst = [];
  await coolDownSender(samId);
  for (let i = 0; i < 12; i++) {
    burst.push(await sam.from('event_chat_messages').insert({ event_id: eventId, sender_id: samId, body: `burst ${i}` }));
  }
  const limited = burst.filter((r) => r.error?.message?.includes('chat_rate_limited'));
  const firstLimited = burst.findIndex((r) => r.error);
  assert.ok(firstLimited > 0 && limited.length >= 1 && burst.slice(firstLimited).every((r) => r.error?.message?.includes('chat_rate_limited')), 'Rate limit kicks in only after a burst and then holds');
  console.log('PASS: chat client ids, unread tracking, chat notifications, soft delete, reporting, rate limit');
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
