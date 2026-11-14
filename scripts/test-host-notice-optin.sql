-- Regression suite for opt-in host notices
-- (migrations 20261110160000 + 20261113110000_host_notice_optin.sql;
--  docs/HOST_EVENT_PLAYBOOK_PLAN.md P6).
--
-- Runs ONLY against an isolated copy of the database, inside one transaction
-- that is rolled back; every check is an ASSERT.
--
--   scripts/db-isolated.sh init
--   scripts/db-isolated.sh apply scripts/test-host-notice-optin.sql
--
-- The point of the suite: a host who has not opted in gets nothing, and a
-- host who has gets exactly one of each notice.
BEGIN;
SET LOCAL client_min_messages = notice;

CREATE TEMP TABLE ctx AS
SELECT (SELECT id FROM businesses LIMIT 1) AS biz,
       (SELECT owner_id FROM businesses LIMIT 1) AS host,
       (SELECT id FROM categories LIMIT 1) AS cat,
       '94000000-0000-4000-8000-000000000001'::uuid AS e_soon,
       '94000000-0000-4000-8000-000000000002'::uuid AS e_done;

-- One event starting inside the day-of window, one that just ended.
INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address)
SELECT c.e_soon, c.biz, 'Starts soon', 'x', c.cat, now() + interval '3 hours', now() + interval '5 hours', 37.77, -122.41, '1 Main St' FROM ctx c;
INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address)
SELECT c.e_done, c.biz, 'Just ended', 'x', c.cat, now() - interval '6 hours', now() - interval '4 hours', 37.77, -122.41, '1 Main St' FROM ctx c;

DO $$
DECLARE
  c ctx%ROWTYPE;
  n integer;
  route text;
BEGIN
  SELECT * INTO c FROM ctx;

  -- Defaults: both notices off, even though the master switch is on.
  SELECT count(*) INTO n FROM businesses
   WHERE id = c.biz AND host_day_of_notice = false AND host_post_event_notice = false;
  ASSERT n = 1, 'both notices must default to off';

  -- ── Not opted in: nothing is sent ────────────────────────────────────────
  PERFORM send_host_event_notices();
  SELECT count(*) INTO n FROM notifications
   WHERE user_id = c.host AND type IN ('host_day_of', 'host_post_event_summary');
  ASSERT n = 0, 'a host who has not opted in must get nothing, saw ' || n;

  -- ── Opted in: one of each ────────────────────────────────────────────────
  UPDATE businesses SET host_day_of_notice = true, host_post_event_notice = true WHERE id = c.biz;
  PERFORM send_host_event_notices();

  SELECT count(*) INTO n FROM notifications
   WHERE user_id = c.host AND type = 'host_day_of' AND event_id = c.e_soon;
  ASSERT n = 1, 'the day-of notice is sent once opted in, saw ' || n;

  SELECT count(*) INTO n FROM notifications
   WHERE user_id = c.host AND type = 'host_post_event_summary' AND event_id = c.e_done;
  ASSERT n = 1, 'the post-event summary is sent once opted in, saw ' || n;

  -- ── Idempotent: a second cron pass sends nothing more ────────────────────
  PERFORM send_host_event_notices();
  SELECT count(*) INTO n FROM notifications
   WHERE user_id = c.host AND type IN ('host_day_of', 'host_post_event_summary');
  ASSERT n = 2, 'a re-run must not send duplicates, saw ' || n;

  -- ── One switch at a time ─────────────────────────────────────────────────
  DELETE FROM host_notifications_sent WHERE event_id IN (c.e_soon, c.e_done);
  DELETE FROM notifications WHERE user_id = c.host AND type IN ('host_day_of', 'host_post_event_summary');
  UPDATE businesses SET host_day_of_notice = true, host_post_event_notice = false WHERE id = c.biz;
  PERFORM send_host_event_notices();
  SELECT count(*) INTO n FROM notifications WHERE user_id = c.host AND type = 'host_day_of';
  ASSERT n = 1, 'day-of alone still sends, saw ' || n;
  SELECT count(*) INTO n FROM notifications WHERE user_id = c.host AND type = 'host_post_event_summary';
  ASSERT n = 0, 'the summary stays off when its own switch is off, saw ' || n;

  -- ── The master switch still wins ─────────────────────────────────────────
  DELETE FROM host_notifications_sent WHERE event_id IN (c.e_soon, c.e_done);
  DELETE FROM notifications WHERE user_id = c.host AND type IN ('host_day_of', 'host_post_event_summary');
  UPDATE businesses
     SET notifications_enabled = false, host_day_of_notice = true, host_post_event_notice = true
   WHERE id = c.biz;
  PERFORM send_host_event_notices();
  SELECT count(*) INTO n FROM notifications
   WHERE user_id = c.host AND type IN ('host_day_of', 'host_post_event_summary');
  ASSERT n = 0, 'turning off all host notifications silences these too, saw ' || n;

  RAISE NOTICE 'test-host-notice-optin: all checks passed';
END $$;

ROLLBACK;
