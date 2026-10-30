-- Enforce user_blocks in event chat (follow-up to 20261030111000).
--
-- Message visibility: a viewer no longer sees messages from users they have
-- blocked. All client read paths flow through event_chat_messages RLS — the
-- paging RPCs get_event_chat_messages / get_event_chat_messages_since
-- (20261028160000) are SECURITY INVOKER, services/eventChat.ts getMessage /
-- getLatestMessage select the table directly, and realtime postgres_changes
-- applies RLS — so amending the attendee SELECT policy covers them all.
--
-- Sending is deliberately NOT restricted: blocking is viewer-side muting, not
-- a ban. A blocked user's messages are still written and remain visible to
-- everyone who hasn't blocked them; only the blocker's own view filters them
-- out. (Being unable to post would also reveal who blocked you, which
-- 20261030111000 explicitly avoids.)
--
-- Scope notes:
--   * "Hosts can read own event chat" (20261028130000) and "Admins can read
--     event chat" (20261028120000) are left untouched: RLS policies OR
--     together, so a host/admin who blocked a user still sees their messages
--     in chats they moderate. That is intentional — moderation needs the full
--     transcript.
--   * get_event_chat_unread_counts (20261028120000) is SECURITY DEFINER and
--     still counts blocked senders' messages, so the unread badge can exceed
--     the number of messages actually rendered; tracked in docs/ISSUES.md.
--   * The NOT EXISTS subquery evaluates under user_blocks RLS, whose
--     "Users can view own blocks" policy (blocker_id = auth.uid(),
--     20261030111000) matches the predicate exactly, so semantics are
--     unchanged by nested RLS.
--
-- The policy body otherwise matches 20260301000000 (the current definition).

DROP POLICY IF EXISTS "Going attendees can read active event chat" ON event_chat_messages;
CREATE POLICY "Going attendees can read active event chat"
  ON event_chat_messages
  FOR SELECT
  TO authenticated
  USING (
    user_can_access_event_chat(event_id)
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE ub.blocker_id = auth.uid()
        AND ub.blocked_id = event_chat_messages.sender_id
    )
  );
