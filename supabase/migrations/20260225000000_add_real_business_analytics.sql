-- Real analytics support:
-- 1) Track event detail views in event_views
-- 2) Owner-scoped aggregate analytics RPC

CREATE TABLE IF NOT EXISTS event_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  viewer_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  view_date date NOT NULL DEFAULT CURRENT_DATE
);

CREATE INDEX IF NOT EXISTS idx_event_views_event_id ON event_views(event_id);
CREATE INDEX IF NOT EXISTS idx_event_views_viewed_at ON event_views(viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_views_viewer_id ON event_views(viewer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_views_dedup_daily
  ON event_views(event_id, viewer_id, view_date)
  WHERE viewer_id IS NOT NULL;

ALTER TABLE event_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create their own event views"
  ON event_views
  FOR INSERT
  TO authenticated
  WITH CHECK (viewer_id = auth.uid());

CREATE POLICY "Users can view their own event views"
  ON event_views
  FOR SELECT
  TO authenticated
  USING (viewer_id = auth.uid());

CREATE OR REPLACE FUNCTION track_event_view(event_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer uuid := auth.uid();
BEGIN
  IF viewer IS NULL THEN
    RETURN;
  END IF;

  -- Do not count self-views by the business owner.
  IF EXISTS (
    SELECT 1
    FROM events e
    JOIN businesses b ON b.id = e.business_id
    WHERE e.id = event_uuid
      AND b.owner_id = viewer
  ) THEN
    RETURN;
  END IF;

  INSERT INTO event_views (event_id, viewer_id, viewed_at, view_date)
  VALUES (event_uuid, viewer, now(), CURRENT_DATE)
  ON CONFLICT (event_id, viewer_id, view_date)
  DO UPDATE SET viewed_at = EXCLUDED.viewed_at;
END;
$$;

CREATE OR REPLACE FUNCTION get_business_analytics(
  business_uuid uuid,
  days integer DEFAULT 30
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM businesses b
    WHERE b.id = business_uuid
      AND b.owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to view analytics for this business';
  END IF;

  WITH business_events AS (
    SELECT
      e.id,
      e.title,
      e.created_at,
      e.start_datetime,
      COALESCE(e.is_recurring, false) AS is_recurring
    FROM events e
    WHERE e.business_id = business_uuid
  ),
  event_summary AS (
    SELECT
      COUNT(*)::int AS total_posts,
      COUNT(*) FILTER (
        WHERE created_at >= (now() - make_interval(days => GREATEST(days, 1)))
      )::int AS posts_this_period,
      COUNT(*) FILTER (WHERE is_recurring)::int AS recurring_posts,
      COUNT(*) FILTER (WHERE start_datetime >= now())::int AS upcoming_events
    FROM business_events
  ),
  view_summary AS (
    SELECT COUNT(*)::int AS total_views
    FROM event_views ev
    JOIN business_events be ON be.id = ev.event_id
  ),
  save_summary AS (
    SELECT COUNT(*)::int AS total_saves
    FROM saves s
    JOIN business_events be ON be.id = s.event_id
  ),
  rsvp_summary AS (
    SELECT COUNT(*)::int AS total_rsvps
    FROM rsvps r
    JOIN business_events be ON be.id = r.event_id
    WHERE r.status = 'going'
  ),
  follower_summary AS (
    SELECT
      COUNT(*)::int AS follower_total,
      COUNT(*) FILTER (
        WHERE created_at >= (now() - make_interval(days => GREATEST(days, 1)))
      )::int AS followers_this_period
    FROM follows f
    WHERE f.business_id = business_uuid
  ),
  review_summary AS (
    SELECT
      COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0)::float8 AS average_rating,
      COUNT(*)::int AS review_count
    FROM reviews r
    WHERE r.business_id = business_uuid
  ),
  top_event_rows AS (
    SELECT
      be.id,
      be.title,
      COALESCE(v.view_count, 0)::int AS views,
      COALESCE(s.save_count, 0)::int AS saves,
      COALESCE(r.rsvp_count, 0)::int AS rsvps,
      CASE
        WHEN COALESCE(v.view_count, 0) = 0 THEN 0
        ELSE ROUND((((COALESCE(s.save_count, 0) + COALESCE(r.rsvp_count, 0))::numeric / v.view_count::numeric) * 100), 1)
      END::float8 AS conversion
    FROM business_events be
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS view_count
      FROM event_views
      GROUP BY event_id
    ) v ON v.event_id = be.id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS save_count
      FROM saves
      GROUP BY event_id
    ) s ON s.event_id = be.id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS rsvp_count
      FROM rsvps
      WHERE status = 'going'
      GROUP BY event_id
    ) r ON r.event_id = be.id
    ORDER BY COALESCE(v.view_count, 0) DESC, (COALESCE(s.save_count, 0) + COALESCE(r.rsvp_count, 0)) DESC
    LIMIT 5
  ),
  date_series AS (
    SELECT generate_series(
      (CURRENT_DATE - (GREATEST(days, 1) - 1)),
      CURRENT_DATE,
      interval '1 day'
    )::date AS day
  ),
  view_daily AS (
    SELECT ev.viewed_at::date AS day, COUNT(*)::int AS cnt
    FROM event_views ev
    JOIN business_events be ON be.id = ev.event_id
    WHERE ev.viewed_at >= (now() - make_interval(days => GREATEST(days, 1)))
    GROUP BY ev.viewed_at::date
  ),
  save_daily AS (
    SELECT s.created_at::date AS day, COUNT(*)::int AS cnt
    FROM saves s
    JOIN business_events be ON be.id = s.event_id
    WHERE s.created_at >= (now() - make_interval(days => GREATEST(days, 1)))
    GROUP BY s.created_at::date
  ),
  rsvp_daily AS (
    SELECT r.created_at::date AS day, COUNT(*)::int AS cnt
    FROM rsvps r
    JOIN business_events be ON be.id = r.event_id
    WHERE r.status = 'going'
      AND r.created_at >= (now() - make_interval(days => GREATEST(days, 1)))
    GROUP BY r.created_at::date
  ),
  trend_rows AS (
    SELECT
      ds.day,
      COALESCE(vd.cnt, 0)::int AS views,
      COALESCE(sd.cnt, 0)::int AS saves,
      COALESCE(rd.cnt, 0)::int AS rsvps
    FROM date_series ds
    LEFT JOIN view_daily vd ON vd.day = ds.day
    LEFT JOIN save_daily sd ON sd.day = ds.day
    LEFT JOIN rsvp_daily rd ON rd.day = ds.day
    ORDER BY ds.day
  )
  SELECT json_build_object(
    'totalPosts', es.total_posts,
    'postsThisPeriod', es.posts_this_period,
    'recurringPosts', es.recurring_posts,
    'upcomingEvents', es.upcoming_events,
    'totalViews', vs.total_views,
    'totalSaves', ss.total_saves,
    'totalRsvps', rs.total_rsvps,
    'engagementRate',
      CASE
        WHEN vs.total_views = 0 THEN 0
        ELSE ROUND((((ss.total_saves + rs.total_rsvps)::numeric / vs.total_views::numeric) * 100), 1)
      END,
    'followerTotal', fs.follower_total,
    'followersThisPeriod', fs.followers_this_period,
    'averageRating', rv.average_rating,
    'reviewCount', rv.review_count,
    'topEvents', (
      SELECT COALESCE(json_agg(row_to_json(te)), '[]'::json)
      FROM top_event_rows te
    ),
    'trend', (
      SELECT COALESCE(json_agg(json_build_object(
        'date', tr.day,
        'views', tr.views,
        'saves', tr.saves,
        'rsvps', tr.rsvps
      )), '[]'::json)
      FROM trend_rows tr
    )
  )
  INTO result
  FROM event_summary es
  CROSS JOIN view_summary vs
  CROSS JOIN save_summary ss
  CROSS JOIN rsvp_summary rs
  CROSS JOIN follower_summary fs
  CROSS JOIN review_summary rv;

  RETURN result;
END;
$$;
