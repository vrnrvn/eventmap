-- Host analytics foundation (docs/ANALYTICS_AND_CALENDAR_PLAN.md §1.3, §1.8).
--
-- STATUS: prepared, NOT applied to the shared DB. Validated on an isolated
-- scratch copy with scripts/test-event-insights.sql. Depends on the 20261103*
-- set (event_bans, event_waitlist, host_announcements, rsvps 'requested',
-- events.timezone / publish_state / postponed) and on 20261104090000
-- (event_interactions, rsvp_history).
--
--   1. business_has_premium(business_uuid): the same rule the client uses
--      (services/premium.ts): tier 'premium' and not past its expiry.
--   2. get_event_insights(p_event_id, p_days): per-event analytics for the
--      host (or an admin). Tiered, never raises for free hosts: free gets
--      the counts and funnel over a fixed 30 days; premium adds trend, RSVP
--      lead time, audience split, announcement reach, chat activity, taps
--      (share / ticket / calendar / directions), RSVP changes in the window
--      and a comparison with the business's usual event. Premium-only sections
--      are null on the free tier, so the screen can draw locked cards.
--   3. get_business_analytics(business_uuid, days): same signature and keys
--      as before, hardened: drafts excluded everywhere, "upcoming" uses the
--      zone-aware ended check and skips cancelled events, admins allowed,
--      tiered like (2) (trend / topEvents null on free), window totals
--      added, top events carry start and status. EXECUTE revoked from anon.
--
-- Aggregates only: nothing here returns who viewed, saved or joined.

-- ── 1. Premium rule ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.business_has_premium(business_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = business_uuid
      AND b.subscription_tier = 'premium'
      AND (b.subscription_expires_at IS NULL OR b.subscription_expires_at > now())
  );
$$;

REVOKE ALL ON FUNCTION public.business_has_premium(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_has_premium(uuid) TO authenticated;

-- ── 2. Per-event insights ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_event_insights(p_event_id uuid, p_days integer DEFAULT 30)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  e events%ROWTYPE;
  v_owner uuid;
  v_premium boolean;
  v_days integer;
  v_tz text;
  v_since timestamptz;
  v_today date;
  v_totals json;
  v_trend json;
  v_lead json;
  v_audience json;
  v_announcements json;
  v_chat json;
  v_median json;
  v_interactions json;
  v_rsvp_changes json;
  v_going integer;
  v_unique integer;
  v_saves integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT ev.* INTO e FROM events ev WHERE ev.id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = e.business_id;
  IF NOT (v_owner = v_uid OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can view insights';
  END IF;

  v_premium := is_admin_user() OR business_has_premium(e.business_id);
  v_days := CASE WHEN v_premium THEN LEAST(GREATEST(COALESCE(p_days, 30), 7), 365) ELSE 30 END;
  v_tz := COALESCE(NULLIF(e.timezone, ''), 'UTC');
  v_since := now() - make_interval(days => v_days);
  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT COUNT(*) FILTER (WHERE r.status = 'going') INTO v_going FROM rsvps r WHERE r.event_id = e.id;
  SELECT COUNT(DISTINCT v.viewer_id) INTO v_unique FROM event_views v WHERE v.event_id = e.id;
  SELECT COUNT(*) INTO v_saves FROM saves s WHERE s.event_id = e.id;

  -- Free + premium: counts and funnel.
  SELECT json_build_object(
    'views',          (SELECT COUNT(*) FROM event_views v WHERE v.event_id = e.id),
    'unique_viewers', v_unique,
    'views_period',   (SELECT COUNT(*) FROM event_views v WHERE v.event_id = e.id AND v.viewed_at >= v_since),
    'saves',          v_saves,
    'saves_period',   (SELECT COUNT(*) FROM saves s WHERE s.event_id = e.id AND s.created_at >= v_since),
    'going',          v_going,
    'going_period',   (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going' AND r.created_at >= v_since),
    'interested',     (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'interested'),
    'requested',      (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'requested'),
    'waitlist',       (SELECT COUNT(*) FROM event_waitlist w WHERE w.event_id = e.id),
    'removed',        (SELECT COUNT(*) FROM event_bans eb WHERE eb.event_id = e.id),
    'fill_rate',      CASE WHEN e.max_attendees IS NULL OR e.max_attendees <= 0 THEN NULL
                           ELSE ROUND(v_going::numeric / e.max_attendees, 3) END,
    'view_to_save',   CASE WHEN v_unique = 0 THEN 0 ELSE ROUND(v_saves::numeric / v_unique, 3) END,
    'view_to_going',  CASE WHEN v_unique = 0 THEN 0 ELSE ROUND(v_going::numeric / v_unique, 3) END
  ) INTO v_totals;

  IF v_premium THEN
    -- Daily series in the event's zone (UTC for legacy rows), oldest first.
    WITH days AS (
      SELECT generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date AS day
    ),
    vd AS (
      SELECT (v.viewed_at AT TIME ZONE v_tz)::date AS day, COUNT(*) AS n
      FROM event_views v WHERE v.event_id = e.id AND v.viewed_at >= v_since - interval '1 day'
      GROUP BY 1
    ),
    sd AS (
      SELECT (s.created_at AT TIME ZONE v_tz)::date AS day, COUNT(*) AS n
      FROM saves s WHERE s.event_id = e.id AND s.created_at >= v_since - interval '1 day'
      GROUP BY 1
    ),
    gd AS (
      SELECT (r.created_at AT TIME ZONE v_tz)::date AS day, COUNT(*) AS n
      FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going'
      GROUP BY 1
    ),
    rows_ AS (
      SELECT d.day,
             COALESCE(vd.n, 0) AS views,
             COALESCE(sd.n, 0) AS saves,
             COALESCE(gd.n, 0) AS going,
             -- Everyone currently going who first RSVP'd on or before this day.
             (SELECT COALESCE(SUM(g2.n), 0) FROM gd g2 WHERE g2.day <= d.day) AS going_cumulative
      FROM days d
      LEFT JOIN vd ON vd.day = d.day
      LEFT JOIN sd ON sd.day = d.day
      LEFT JOIN gd ON gd.day = d.day
    )
    SELECT json_agg(json_build_object(
      'date', to_char(day, 'YYYY-MM-DD'), 'views', views, 'saves', saves,
      'going', going, 'going_cumulative', going_cumulative
    ) ORDER BY day) INTO v_trend FROM rows_;

    -- Lead time only means something against one start date.
    IF COALESCE(e.is_recurring, false) THEN
      v_lead := json_build_object('available', false, 'reason', 'recurring');
    ELSE
      SELECT json_build_object(
        'available', true,
        'same_day', COUNT(*) FILTER (WHERE lead < interval '1 day'),
        'd1_3',     COUNT(*) FILTER (WHERE lead >= interval '1 day'  AND lead < interval '4 days'),
        'd4_7',     COUNT(*) FILTER (WHERE lead >= interval '4 days' AND lead < interval '8 days'),
        'd8_14',    COUNT(*) FILTER (WHERE lead >= interval '8 days' AND lead < interval '15 days'),
        'd15_plus', COUNT(*) FILTER (WHERE lead >= interval '15 days')
      ) INTO v_lead
      FROM (
        SELECT e.start_datetime - r.created_at AS lead
        FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going'
      ) l;
    END IF;

    SELECT json_build_object(
      'followers_going', COUNT(*) FILTER (WHERE is_follower),
      'returning_going', COUNT(*) FILTER (WHERE is_returning),
      'first_time_going', COUNT(*) FILTER (WHERE NOT is_returning)
    ) INTO v_audience
    FROM (
      SELECT
        EXISTS (SELECT 1 FROM follows f WHERE f.user_id = r.user_id AND f.business_id = e.business_id) AS is_follower,
        EXISTS (
          SELECT 1 FROM rsvps r2 JOIN events e2 ON e2.id = r2.event_id
          WHERE r2.user_id = r.user_id AND r2.status = 'going'
            AND e2.business_id = e.business_id AND e2.id <> e.id
            AND e2.status <> 'cancelled' AND e2.start_datetime < e.start_datetime
        ) AS is_returning
      FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going'
    ) a;

    SELECT json_build_object(
      'sent',       (SELECT COUNT(*) FROM host_announcements h WHERE h.event_id = e.id),
      'recipients', (SELECT COALESCE(SUM(h.recipients), 0) FROM host_announcements h WHERE h.event_id = e.id),
      'read',       (SELECT COUNT(*) FROM notifications n
                     WHERE n.event_id = e.id AND n.type = 'host_announcement' AND n.read)
    ) INTO v_announcements;

    SELECT json_build_object(
      'messages',       COUNT(*),
      'active_senders', COUNT(DISTINCT m.sender_id),
      'messages_period', COUNT(*) FILTER (WHERE m.created_at >= v_since)
    ) INTO v_chat
    FROM event_chat_messages m WHERE m.event_id = e.id AND m.deleted_at IS NULL;

    SELECT json_build_object(
      'share',      COUNT(*) FILTER (WHERE i.kind = 'share'),
      'ticket',     COUNT(*) FILTER (WHERE i.kind = 'ticket'),
      'calendar',   COUNT(*) FILTER (WHERE i.kind = 'calendar'),
      'directions', COUNT(*) FILTER (WHERE i.kind = 'directions'),
      'period',     COUNT(*) FILTER (WHERE i.created_at >= v_since)
    ) INTO v_interactions
    FROM event_interactions i WHERE i.event_id = e.id;

    -- RSVP movement inside the window. History only exists from the day
    -- 20261104090000 was applied; tracked_since says from when.
    SELECT json_build_object(
      'tracked_since', MIN(h.changed_at),
      'joined',     COUNT(*) FILTER (WHERE h.to_status = 'going' AND h.changed_at >= v_since),
      'left',       COUNT(*) FILTER (WHERE h.from_status = 'going' AND h.to_status = 'left' AND h.changed_at >= v_since),
      'downgraded', COUNT(*) FILTER (WHERE h.from_status = 'going' AND h.to_status = 'interested' AND h.changed_at >= v_since),
      'declined',   COUNT(*) FILTER (WHERE h.to_status = 'declined' AND h.changed_at >= v_since),
      'removed',    COUNT(*) FILTER (WHERE h.to_status = 'removed' AND h.changed_at >= v_since)
    ) INTO v_rsvp_changes
    FROM rsvp_history h WHERE h.event_id = e.id;

    -- "Your usual event": median over the business's other published,
    -- non-cancelled events. Withheld below three events (too noisy).
    SELECT CASE WHEN COUNT(*) >= 3 THEN json_build_object(
      'events', COUNT(*),
      'views', percentile_cont(0.5) WITHIN GROUP (ORDER BY o.views),
      'going', percentile_cont(0.5) WITHIN GROUP (ORDER BY o.going)
    ) END INTO v_median
    FROM (
      SELECT
        (SELECT COUNT(*) FROM event_views v WHERE v.event_id = o.id) AS views,
        (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = o.id AND r.status = 'going') AS going
      FROM events o
      WHERE o.business_id = e.business_id AND o.id <> e.id
        AND COALESCE(o.publish_state, 'published') = 'published'
        AND o.status <> 'cancelled'
    ) o;
  END IF;

  RETURN json_build_object(
    'tier', CASE WHEN v_premium THEN 'premium' ELSE 'free' END,
    'period_days', v_days,
    'event', json_build_object(
      'id', e.id, 'title', e.title, 'start_datetime', e.start_datetime,
      'end_datetime', e.end_datetime, 'timezone', e.timezone, 'status', e.status,
      'publish_state', e.publish_state, 'max_attendees', e.max_attendees,
      'is_recurring', COALESCE(e.is_recurring, false), 'rsvp_mode', e.rsvp_mode,
      'created_at', e.created_at
    ),
    'totals', v_totals,
    'trend', v_trend,
    'lead_time', v_lead,
    'audience', v_audience,
    'announcements', v_announcements,
    'chat', v_chat,
    'interactions', v_interactions,
    'rsvp_changes', v_rsvp_changes,
    'business_median', v_median
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_insights(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_insights(uuid, integer) TO authenticated;

-- ── 3. Business overview, hardened and tiered ────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_business_analytics(business_uuid uuid, days integer DEFAULT 30)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  v_premium boolean;
  v_days integer;
  v_since timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = business_uuid AND (b.owner_id = auth.uid() OR is_admin_user())
  ) THEN
    RAISE EXCEPTION 'Not authorized to view analytics for this business';
  END IF;

  v_premium := is_admin_user() OR business_has_premium(business_uuid);
  v_days := CASE WHEN v_premium THEN LEAST(GREATEST(COALESCE(days, 30), 7), 365) ELSE 30 END;
  v_since := now() - make_interval(days => v_days);

  WITH business_events AS (
    -- Drafts never count: they aren't public and can't be viewed or joined.
    SELECT e.id, e.title, e.created_at, e.start_datetime, e.end_datetime, e.status,
           COALESCE(e.is_recurring, false) AS is_recurring, e.recurrence_pattern, e.timezone
    FROM events e
    WHERE e.business_id = business_uuid
      AND COALESCE(e.publish_state, 'published') = 'published'
  ),
  event_summary AS (
    SELECT
      COUNT(*)::int AS total_posts,
      COUNT(*) FILTER (WHERE created_at >= v_since)::int AS posts_this_period,
      COUNT(*) FILTER (WHERE is_recurring)::int AS recurring_posts,
      COUNT(*) FILTER (
        WHERE status <> 'cancelled'
          AND NOT event_has_ended(end_datetime, is_recurring, recurrence_pattern, timezone)
      )::int AS upcoming_events
    FROM business_events
  ),
  per_event AS (
    SELECT be.id, be.title, be.start_datetime, be.status,
      (SELECT COUNT(*) FROM event_views v WHERE v.event_id = be.id)::int AS views,
      (SELECT COUNT(*) FROM event_views v WHERE v.event_id = be.id AND v.viewed_at >= v_since)::int AS views_period,
      (SELECT COUNT(*) FROM saves s WHERE s.event_id = be.id)::int AS saves,
      (SELECT COUNT(*) FROM saves s WHERE s.event_id = be.id AND s.created_at >= v_since)::int AS saves_period,
      (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = be.id AND r.status = 'going')::int AS rsvps,
      (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = be.id AND r.status = 'going' AND r.created_at >= v_since)::int AS rsvps_period
    FROM business_events be
  ),
  totals AS (
    SELECT
      COALESCE(SUM(views), 0)::int AS total_views,
      COALESCE(SUM(saves), 0)::int AS total_saves,
      COALESCE(SUM(rsvps), 0)::int AS total_rsvps,
      COALESCE(SUM(views_period), 0)::int AS period_views,
      COALESCE(SUM(saves_period), 0)::int AS period_saves,
      COALESCE(SUM(rsvps_period), 0)::int AS period_rsvps
    FROM per_event
  ),
  follower_summary AS (
    SELECT COUNT(*)::int AS follower_total,
           COUNT(*) FILTER (WHERE f.created_at >= v_since)::int AS followers_this_period
    FROM follows f WHERE f.business_id = business_uuid
  ),
  review_summary AS (
    SELECT COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0)::float8 AS average_rating,
           COUNT(*)::int AS review_count
    FROM reviews r WHERE r.business_id = business_uuid
  )
  SELECT json_build_object(
    'tier', CASE WHEN v_premium THEN 'premium' ELSE 'free' END,
    'periodDays', v_days,
    'totalPosts', es.total_posts,
    'postsThisPeriod', es.posts_this_period,
    'recurringPosts', es.recurring_posts,
    'upcomingEvents', es.upcoming_events,
    'totalViews', t.total_views,
    'totalSaves', t.total_saves,
    'totalRsvps', t.total_rsvps,
    'periodViews', t.period_views,
    'periodSaves', t.period_saves,
    'periodRsvps', t.period_rsvps,
    'engagementRate', CASE WHEN t.total_views = 0 THEN 0
      ELSE ROUND(((t.total_saves + t.total_rsvps)::numeric / t.total_views) * 100, 1) END,
    'followerTotal', fs.follower_total,
    'followersThisPeriod', fs.followers_this_period,
    'averageRating', rv.average_rating,
    'reviewCount', rv.review_count,
    'topEvents', CASE WHEN v_premium THEN (
      SELECT COALESCE(json_agg(row_to_json(te)), '[]'::json) FROM (
        SELECT pe.id, pe.title, pe.start_datetime, pe.status, pe.views, pe.saves, pe.rsvps,
          CASE WHEN pe.views = 0 THEN 0
            ELSE ROUND(((pe.saves + pe.rsvps)::numeric / pe.views) * 100, 1) END::float8 AS conversion
        FROM per_event pe
        ORDER BY pe.views DESC, (pe.saves + pe.rsvps) DESC, pe.start_datetime DESC
        LIMIT 5
      ) te
    ) END,
    'interactionTotals', CASE WHEN v_premium THEN (
      SELECT json_build_object(
        'share',      COUNT(*) FILTER (WHERE i.kind = 'share'),
        'ticket',     COUNT(*) FILTER (WHERE i.kind = 'ticket'),
        'calendar',   COUNT(*) FILTER (WHERE i.kind = 'calendar'),
        'directions', COUNT(*) FILTER (WHERE i.kind = 'directions')
      )
      FROM event_interactions i JOIN business_events be ON be.id = i.event_id
      WHERE i.created_at >= v_since
    ) END,
    'trend', CASE WHEN v_premium THEN (
      SELECT COALESCE(json_agg(json_build_object(
        'date', ds.day, 'views', COALESCE(vd.cnt, 0), 'saves', COALESCE(sd.cnt, 0), 'rsvps', COALESCE(rd.cnt, 0)
      ) ORDER BY ds.day), '[]'::json)
      FROM generate_series(CURRENT_DATE - (v_days - 1), CURRENT_DATE, interval '1 day') AS ds_raw(day_ts)
      CROSS JOIN LATERAL (SELECT ds_raw.day_ts::date AS day) ds
      LEFT JOIN (
        SELECT v.viewed_at::date AS day, COUNT(*)::int AS cnt FROM event_views v
        JOIN business_events be ON be.id = v.event_id WHERE v.viewed_at >= v_since GROUP BY 1
      ) vd ON vd.day = ds.day
      LEFT JOIN (
        SELECT s.created_at::date AS day, COUNT(*)::int AS cnt FROM saves s
        JOIN business_events be ON be.id = s.event_id WHERE s.created_at >= v_since GROUP BY 1
      ) sd ON sd.day = ds.day
      LEFT JOIN (
        SELECT r.created_at::date AS day, COUNT(*)::int AS cnt FROM rsvps r
        JOIN business_events be ON be.id = r.event_id
        WHERE r.status = 'going' AND r.created_at >= v_since GROUP BY 1
      ) rd ON rd.day = ds.day
    ) END
  )
  INTO result
  FROM event_summary es, totals t, follower_summary fs, review_summary rv;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_business_analytics(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_analytics(uuid, integer) TO authenticated;
