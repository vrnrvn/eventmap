-- Foreign-key indexes + index housekeeping (perf review P1, 2026-11-06).
--
-- PENDING: prepared for a later maintenance window; not applied anywhere yet
-- (unlike the two 20261106 migrations before it, which were validated on an
-- isolated copy). It is plain DDL — review is reading the column list.
--
-- 1) Indexes on referencing columns of foreign keys that had none. Postgres
--    checks the child table on every parent DELETE/UPDATE of the referenced
--    key; without an index that is a sequential scan of the child table —
--    paid on every event delete (events cascade into most of these) and on
--    delete_own_account (profiles cascade). Several also back common lookups
--    (e.g. "this user's waitlist entries").
--
-- 2) Drops indexes that duplicate a UNIQUE constraint's index: they are never
--    chosen over the constraint index and tax every write to those tables.
--
-- 3) Bounds the reminder job's "interested" scan: both reminder slots are
--    within 24h, but the only indexable predicate was start_datetime > now(),
--    so every 5-minute run joined ALL future active events against rsvps.
--    A 25-hour upper bound is a no-op for results and lets
--    idx_events_active_start narrow the scan.

-- ── 1) FK indexes ───────────────────────────────────────────────────────────
-- notifications is the highest-volume table here; its event_id/business_id
-- FKs are ON DELETE SET NULL, which still scans children on parent delete.
CREATE INDEX IF NOT EXISTS idx_notifications_event_id ON public.notifications (event_id);
CREATE INDEX IF NOT EXISTS idx_notifications_business_id ON public.notifications (business_id);

CREATE INDEX IF NOT EXISTS idx_event_chat_blocks_user_id ON public.event_chat_blocks (user_id);
CREATE INDEX IF NOT EXISTS idx_event_chat_blocks_blocked_by ON public.event_chat_blocks (blocked_by);
CREATE INDEX IF NOT EXISTS idx_event_chat_mod_actions_message_id ON public.event_chat_moderation_actions (message_id);
CREATE INDEX IF NOT EXISTS idx_event_chat_mod_actions_target_user_id ON public.event_chat_moderation_actions (target_user_id);
CREATE INDEX IF NOT EXISTS idx_event_chat_mod_actions_actor_id ON public.event_chat_moderation_actions (actor_id);
CREATE INDEX IF NOT EXISTS idx_event_chat_messages_deleted_by ON public.event_chat_messages (deleted_by);
CREATE INDEX IF NOT EXISTS idx_event_chat_reads_event_id ON public.event_chat_reads (event_id);
CREATE INDEX IF NOT EXISTS idx_event_chat_settings_updated_by ON public.event_chat_settings (updated_by);
CREATE INDEX IF NOT EXISTS idx_event_chat_settings_pinned_message_id ON public.event_chat_settings (pinned_message_id);

CREATE INDEX IF NOT EXISTS idx_event_bans_user_id ON public.event_bans (user_id);
CREATE INDEX IF NOT EXISTS idx_event_bans_banned_by ON public.event_bans (banned_by);
CREATE INDEX IF NOT EXISTS idx_event_waitlist_user_id ON public.event_waitlist (user_id);
CREATE INDEX IF NOT EXISTS idx_event_interactions_viewer_id ON public.event_interactions (viewer_id);
CREATE INDEX IF NOT EXISTS idx_rsvp_history_user_id ON public.rsvp_history (user_id);
CREATE INDEX IF NOT EXISTS idx_host_announcements_created_by ON public.host_announcements (created_by);
CREATE INDEX IF NOT EXISTS idx_event_reminder_sent_user_id ON public.event_reminder_sent (user_id);

CREATE INDEX IF NOT EXISTS idx_complaints_resolved_by ON public.complaints (resolved_by);
CREATE INDEX IF NOT EXISTS idx_banned_users_banned_by ON public.banned_users (banned_by);
CREATE INDEX IF NOT EXISTS idx_refund_requests_business_id ON public.refund_requests (business_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_processed_by ON public.refund_requests (processed_by);
CREATE INDEX IF NOT EXISTS idx_promo_notifications_created_by ON public.promotional_notifications (created_by);
CREATE INDEX IF NOT EXISTS idx_promo_notifications_business_id ON public.promotional_notifications (business_id);
CREATE INDEX IF NOT EXISTS idx_promo_notifications_event_id ON public.promotional_notifications (event_id);

-- Analytics: get_business_analytics counts event_views per event in a window;
-- the event_id-only index made the viewed_at check a heap recheck per row.
CREATE INDEX IF NOT EXISTS idx_event_views_event_viewed_at ON public.event_views (event_id, viewed_at);

-- Unread badge: head-count of unread rows per user; a partial index is much
-- tighter than scanning the (user_id, read) index once most rows are read.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id) WHERE read = false;

-- ── 2) duplicates of UNIQUE constraints ────────────────────────────────────
DROP INDEX IF EXISTS public.idx_rsvps_user_id;            -- UNIQUE(user_id, event_id)
DROP INDEX IF EXISTS public.idx_saves_user_id;            -- UNIQUE(user_id, event_id)
DROP INDEX IF EXISTS public.idx_saves_user_event;         -- UNIQUE(user_id, event_id)
DROP INDEX IF EXISTS public.idx_banned_users_user_id;     -- UNIQUE(user_id)
DROP INDEX IF EXISTS public.idx_categories_slug;          -- slug UNIQUE

-- ── 3) bound the reminder scan ──────────────────────────────────────────────
-- send_event_reminders runs every 5 minutes (pg_cron). Its first loop
-- ("going") already bounds start_datetime to now()+25h; the second loop
-- ("interested") does not, so it joins ALL future active events against
-- rsvps/profiles on every run — the slot windows (~24h and ~2h, both inside
-- 25h) are buried in extract(epoch ...) where no index can see them. Add the
-- same 25-hour bound there; results are identical.
--
-- Done by rewriting the live function source so this stays correct even
-- though a later migration re-created the function after 20261102100000:
-- the replacement anchors on the interested loop's unique shape
-- ("> now()" directly followed by the NOT is_recurring line) and skips with
-- a NOTICE if the function has been rewritten in a way that changes it.
DO $$
DECLARE
  src text;
  anchor text := 'AND e.start_datetime > now()
      AND NOT COALESCE(e.is_recurring, false)';
  bounded text := 'AND e.start_datetime > now()
      AND e.start_datetime <= now() + interval ''25 hours''
      AND NOT COALESCE(e.is_recurring, false)';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'send_event_reminders';
  IF src IS NULL THEN
    RAISE NOTICE 'send_event_reminders not found; skipping bound';
    RETURN;
  END IF;
  IF position(bounded IN src) > 0 THEN
    RAISE NOTICE 'interested loop already bounded; skipping';
    RETURN;
  END IF;
  IF position(anchor IN src) = 0 THEN
    RAISE NOTICE 'send_event_reminders shape changed; apply the bound by hand';
    RETURN;
  END IF;
  EXECUTE replace(src, anchor, bounded);
END $$;
