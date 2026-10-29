// Unit tests for utils/chatMessages.ts (run: node --experimental-strip-types --test scripts/test-chat-utils.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortMessages, isGrouped, typingLabel, tombstoneLabel, buildMentionPattern, segmentBody,
  resolveMentions, dayLabel, MENTION_TRIGGER, URL_PATTERN,
} from '../utils/chatMessages.ts';

const msg = (over = {}) => ({ id: 'a', sender_id: 'u1', created_at: '2026-10-28T10:00:00Z', deleted_at: null, deleted_by: null, ...over });

test('sortMessages orders by time then id and handles offset-less timestamps as UTC-equivalent', () => {
  const list = [msg({ id: 'b', created_at: '2026-10-28T10:00:00Z' }), msg({ id: 'a', created_at: '2026-10-28T10:00:00Z' }), msg({ id: 'c', created_at: '2026-10-28T09:59:59Z' })];
  assert.deepEqual(sortMessages(list).map((m) => m.id), ['c', 'a', 'b']);
});

test('isGrouped: same sender within 5 minutes, same day, no tombstones', () => {
  const a = msg(), b = msg({ id: 'b', created_at: '2026-10-28T10:04:59Z' });
  assert.equal(isGrouped(a, b), true);
  assert.equal(isGrouped(a, msg({ id: 'c', created_at: '2026-10-28T10:05:01Z' })), false);
  assert.equal(isGrouped(a, msg({ id: 'd', sender_id: 'u2', created_at: '2026-10-28T10:01:00Z' })), false);
  assert.equal(isGrouped(a, msg({ id: 'e', created_at: '2026-10-28T10:01:00Z', deleted_at: '2026-10-28T10:02:00Z' })), false);
});

test('typingLabel', () => {
  assert.equal(typingLabel([]), '');
  assert.equal(typingLabel(['Sam']), 'Sam is typing…');
  assert.equal(typingLabel(['Sam', 'Alex']), 'Sam and Alex are typing…');
  assert.equal(typingLabel(['a', 'b', 'c']), 'Several people are typing…');
});

test('tombstoneLabel per viewer', () => {
  const removedBySelf = msg({ deleted_at: 'x', deleted_by: 'u1' });
  assert.equal(tombstoneLabel(removedBySelf, 'u1', false), 'You deleted this message');
  assert.equal(tombstoneLabel(removedBySelf, 'u2', false), 'Message deleted');
  const removedByMod = msg({ deleted_at: 'x', deleted_by: 'mod' });
  assert.equal(tombstoneLabel(removedByMod, 'mod', true), 'You removed this message');
  assert.equal(tombstoneLabel(removedByMod, 'u2', false), 'Removed by a moderator');
  assert.equal(tombstoneLabel(msg({ deleted_at: 'x', deleted_by: null }), 'u2', false), 'Message removed');
});

test('mention pattern: longest-first, escaped specials, unicode boundary', () => {
  const re = buildMentionPattern(['Ana', 'Ana Maria', 'Dr. Who (Jr.)']);
  assert.deepEqual('@Ana Maria and @Ana and @Anaïs and @Dr. Who (Jr.)!'.match(re), ['@Ana Maria', '@Ana', '@Dr. Who (Jr.)']);
  assert.equal(buildMentionPattern([]), null);
  assert.equal(buildMentionPattern(['  ']), null);
});

test('segmentBody splits links and mentions, keeps trailing punctuation out of links', () => {
  const segs = segmentBody('see https://example.com/a, @Sam!', ['Sam']);
  assert.deepEqual(segs, [
    { kind: 'text', text: 'see ' },
    { kind: 'link', text: 'https://example.com/a', href: 'https://example.com/a' },
    { kind: 'text', text: ', ' },
    { kind: 'mention', text: '@Sam' },
    { kind: 'text', text: '!' },
  ]);
  assert.deepEqual(segmentBody('www.example.org.', []), [{ kind: 'link', text: 'www.example.org', href: 'https://www.example.org' }, { kind: 'text', text: '.' }]);
  assert.deepEqual(segmentBody('plain', []), [{ kind: 'text', text: 'plain' }]);
});

test('resolveMentions keeps only names still present, exact-bounded', () => {
  const drafted = [{ name: 'Alex', id: '1' }, { name: 'Alexandra', id: '2' }, { name: 'Sam', id: '3' }];
  const resolved = resolveMentions('hi @Alexandra and @Sam', drafted);
  assert.deepEqual([...resolved.keys()].sort(), ['2', '3']);
});

test('MENTION_TRIGGER matches only a trailing @token', () => {
  assert.ok(MENTION_TRIGGER.test('hello @sa'));
  assert.ok(MENTION_TRIGGER.test('@'));
  assert.equal(MENTION_TRIGGER.test('email me@x'), false);
  assert.equal(MENTION_TRIGGER.test('@sam done'), false);
});

test('URL_PATTERN excludes closing brackets and quotes', () => {
  assert.deepEqual('(https://a.com/b) "https://c.com"'.match(URL_PATTERN), ['https://a.com/b', 'https://c.com']);
});

test('dayLabel relative days', () => {
  const now = new Date('2026-10-28T12:00:00');
  assert.equal(dayLabel('2026-10-28T01:00:00', now), 'Today');
  assert.equal(dayLabel('2026-10-27T23:00:00', now), 'Yesterday');
  assert.match(dayLabel('2025-01-05T10:00:00', now), /2025/);
});
