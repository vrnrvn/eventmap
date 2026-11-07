-- RLS initplan rewrite (perf review P1 → DB bucket, 2026-11-06).
--
-- PENDING: prepared for a later maintenance window; validated on an isolated
-- container (applies cleanly after all prior migrations, policy count
-- unchanged, repo SQL suites pass before/after), never run against the
-- shared DB.
--
-- Every policy below referenced auth.uid() or is_admin_user() directly.
-- Both are STABLE functions (is_admin_user is also SECURITY DEFINER, so it
-- can't be inlined), which Postgres re-evaluates for every candidate row —
-- an extra profiles lookup per row for the admin check, on every table scan
-- these policies guard. Wrapping each call as a scalar subquery turns it
-- into an init plan: evaluated once per statement, same result.
--
-- GENERATED from pg_policy on a database built from this migrations
-- directory (see scripts/perf/README.md): each policy is recreated verbatim
-- except auth.uid() → (SELECT auth.uid()) and is_admin_user() →
-- (SELECT is_admin_user()). No role, command, or predicate logic changes.
-- Policies that already used the subquery form were skipped.
--
-- NOTE for the reviewer: because this file freezes the policy text as of
-- 2026-11-06, any LATER migration that redefines one of these policies wins
-- (normal migration ordering); regenerate before applying if more policy
-- migrations landed in between.

BEGIN;

DROP POLICY IF EXISTS "Admins can manage app_banners" ON public.app_banners;
CREATE POLICY "Admins can manage app_banners" ON public.app_banners
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (( SELECT is_admin_user() AS is_admin_user))
  WITH CHECK (( SELECT is_admin_user() AS is_admin_user));

DROP POLICY IF EXISTS "Admins can manage banned_users" ON public.banned_users;
CREATE POLICY "Admins can manage banned_users" ON public.banned_users
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (( SELECT is_admin_user() AS is_admin_user))
  WITH CHECK (( SELECT is_admin_user() AS is_admin_user));

DROP POLICY IF EXISTS "Users can check own ban status" ON public.banned_users;
CREATE POLICY "Users can check own ban status" ON public.banned_users
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Business owners can manage their links" ON public.business_links;
CREATE POLICY "Business owners can manage their links" ON public.business_links
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM businesses
  WHERE ((businesses.id = business_links.business_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM businesses
  WHERE ((businesses.id = business_links.business_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Business owners can manage their photos" ON public.business_photos;
CREATE POLICY "Business owners can manage their photos" ON public.business_photos
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM businesses
  WHERE ((businesses.id = business_photos.business_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM businesses
  WHERE ((businesses.id = business_photos.business_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Admins can update any business" ON public.businesses;
CREATE POLICY "Admins can update any business" ON public.businesses
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (( SELECT is_admin_user() AS is_admin_user))
  WITH CHECK (( SELECT is_admin_user() AS is_admin_user));

DROP POLICY IF EXISTS "Authenticated users can create business" ON public.businesses;
CREATE POLICY "Authenticated users can create business" ON public.businesses
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((( SELECT auth.uid() AS uid) = owner_id) AND (NOT (EXISTS ( SELECT 1
   FROM businesses businesses_1
  WHERE (businesses_1.owner_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Business owners can delete their business" ON public.businesses;
CREATE POLICY "Business owners can delete their business" ON public.businesses
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = owner_id));

DROP POLICY IF EXISTS "Business owners can update their business" ON public.businesses;
CREATE POLICY "Business owners can update their business" ON public.businesses
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = owner_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id));

DROP POLICY IF EXISTS "Admins can update complaints" ON public.complaints;
CREATE POLICY "Admins can update complaints" ON public.complaints
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (( SELECT is_admin_user() AS is_admin_user))
  WITH CHECK (( SELECT is_admin_user() AS is_admin_user));

DROP POLICY IF EXISTS "Admins can view all complaints" ON public.complaints;
CREATE POLICY "Admins can view all complaints" ON public.complaints
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (( SELECT is_admin_user() AS is_admin_user));

DROP POLICY IF EXISTS "Users can create their own complaint" ON public.complaints;
CREATE POLICY "Users can create their own complaint" ON public.complaints
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = reporter_id));

DROP POLICY IF EXISTS "Users can view their own complaints" ON public.complaints;
CREATE POLICY "Users can view their own complaints" ON public.complaints
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = reporter_id));

DROP POLICY IF EXISTS "Event bans visible to host, admins and subject" ON public.event_bans;
CREATE POLICY "Event bans visible to host, admins and subject" ON public.event_bans
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR user_is_event_host(event_id) OR ( SELECT is_admin_user() AS is_admin_user)));

DROP POLICY IF EXISTS "Chat blocks visible to host and admins" ON public.event_chat_blocks;
CREATE POLICY "Chat blocks visible to host and admins" ON public.event_chat_blocks
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((( SELECT is_admin_user() AS is_admin_user) OR user_is_event_host(event_id)));

DROP POLICY IF EXISTS "Going attendees can send active event chat messages" ON public.event_chat_messages;
CREATE POLICY "Going attendees can send active event chat messages" ON public.event_chat_messages
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((sender_id = ( SELECT auth.uid() AS uid)) AND (deleted_at IS NULL) AND (user_can_access_event_chat(event_id) OR user_is_event_host(event_id)) AND (NOT user_is_banned(( SELECT auth.uid() AS uid))) AND (NOT user_is_blocked_from_event_chat(event_id, ( SELECT auth.uid() AS uid))) AND
CASE COALESCE(( SELECT s.chat_mode
       FROM event_chat_settings s
      WHERE (s.event_id = event_chat_messages.event_id)), 'open'::text)
    WHEN 'open'::text THEN true
    WHEN 'announcements'::text THEN (( SELECT is_admin_user() AS is_admin_user) OR user_is_event_host(event_id))
    ELSE false
END));

DROP POLICY IF EXISTS "Hosts and admins can read chat moderation log" ON public.event_chat_moderation_actions;
CREATE POLICY "Hosts and admins can read chat moderation log" ON public.event_chat_moderation_actions
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((( SELECT is_admin_user() AS is_admin_user) OR user_is_event_host(event_id)));

DROP POLICY IF EXISTS "Users manage own chat reads" ON public.event_chat_reads;
CREATE POLICY "Users manage own chat reads" ON public.event_chat_reads
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Admins can read removed chat bodies" ON public.event_chat_removed_bodies;
CREATE POLICY "Admins can read removed chat bodies" ON public.event_chat_removed_bodies
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (( SELECT is_admin_user() AS is_admin_user));

DROP POLICY IF EXISTS "Chat readers can see chat settings" ON public.event_chat_settings;
CREATE POLICY "Chat readers can see chat settings" ON public.event_chat_settings
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_can_access_event_chat(event_id) OR user_is_event_host(event_id) OR ( SELECT is_admin_user() AS is_admin_user)));

DROP POLICY IF EXISTS "Event owners can delete links" ON public.event_links;
CREATE POLICY "Event owners can delete links" ON public.event_links
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (events
     JOIN businesses ON ((businesses.id = events.business_id)))
  WHERE ((events.id = event_links.event_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Event owners can insert links" ON public.event_links;
CREATE POLICY "Event owners can insert links" ON public.event_links
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (events
     JOIN businesses ON ((businesses.id = events.business_id)))
  WHERE ((events.id = event_links.event_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Event owners can update links" ON public.event_links;
CREATE POLICY "Event owners can update links" ON public.event_links
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (events
     JOIN businesses ON ((businesses.id = events.business_id)))
  WHERE ((events.id = event_links.event_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (events
     JOIN businesses ON ((businesses.id = events.business_id)))
  WHERE ((events.id = event_links.event_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Event owners can delete photos" ON public.event_photos;
CREATE POLICY "Event owners can delete photos" ON public.event_photos
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (events
     JOIN businesses ON ((businesses.id = events.business_id)))
  WHERE ((events.id = event_photos.event_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Event owners can insert photos" ON public.event_photos;
CREATE POLICY "Event owners can insert photos" ON public.event_photos
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (events
     JOIN businesses ON ((businesses.id = events.business_id)))
  WHERE ((events.id = event_photos.event_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Event owners can update photos" ON public.event_photos;
CREATE POLICY "Event owners can update photos" ON public.event_photos
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (events
     JOIN businesses ON ((businesses.id = events.business_id)))
  WHERE ((events.id = event_photos.event_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (events
     JOIN businesses ON ((businesses.id = events.business_id)))
  WHERE ((events.id = event_photos.event_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Users can create their own event views" ON public.event_views;
CREATE POLICY "Users can create their own event views" ON public.event_views
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((viewer_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Users can view their own event views" ON public.event_views;
CREATE POLICY "Users can view their own event views" ON public.event_views
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((viewer_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Users can view their own waitlist rows" ON public.event_waitlist;
CREATE POLICY "Users can view their own waitlist rows" ON public.event_waitlist
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Admins can delete any event" ON public.events;
CREATE POLICY "Admins can delete any event" ON public.events
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (( SELECT is_admin_user() AS is_admin_user));

DROP POLICY IF EXISTS "Admins can view all events including past" ON public.events;
CREATE POLICY "Admins can view all events including past" ON public.events
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (( SELECT is_admin_user() AS is_admin_user));

DROP POLICY IF EXISTS "Business owners can delete their events" ON public.events;
CREATE POLICY "Business owners can delete their events" ON public.events
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM businesses
  WHERE ((businesses.id = events.business_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Business owners can update their events" ON public.events;
CREATE POLICY "Business owners can update their events" ON public.events
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM businesses
  WHERE ((businesses.id = events.business_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM businesses
  WHERE ((businesses.id = events.business_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Business owners can view their own events" ON public.events;
CREATE POLICY "Business owners can view their own events" ON public.events
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM businesses b
  WHERE ((b.id = events.business_id) AND (b.owner_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Business owners can view followers of their business" ON public.follows;
CREATE POLICY "Business owners can view followers of their business" ON public.follows
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM businesses
  WHERE ((businesses.id = follows.business_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Users can create their own follows" ON public.follows;
CREATE POLICY "Users can create their own follows" ON public.follows
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can delete their own follows" ON public.follows;
CREATE POLICY "Users can delete their own follows" ON public.follows
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can view their own follows" ON public.follows;
CREATE POLICY "Users can view their own follows" ON public.follows
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Announcements visible to host, admins and attendees" ON public.host_announcements;
CREATE POLICY "Announcements visible to host, admins and attendees" ON public.host_announcements
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_is_event_host(event_id) OR ( SELECT is_admin_user() AS is_admin_user) OR (EXISTS ( SELECT 1
   FROM rsvps r
  WHERE ((r.event_id = host_announcements.event_id) AND (r.user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications" ON public.notifications
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can read own notifications" ON public.notifications;
CREATE POLICY "Users can read own notifications" ON public.notifications
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can update own notifications (mark read)" ON public.notifications;
CREATE POLICY "Users can update own notifications (mark read)" ON public.notifications
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications" ON public.notifications
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles" ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (( SELECT is_admin_user() AS is_admin_user));

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = id));

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = id));

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = id));

DROP POLICY IF EXISTS "Admins can manage promotional notifications" ON public.promotional_notifications;
CREATE POLICY "Admins can manage promotional notifications" ON public.promotional_notifications
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (( SELECT is_admin_user() AS is_admin_user))
  WITH CHECK (( SELECT is_admin_user() AS is_admin_user));

DROP POLICY IF EXISTS "Admins can manage refund_requests" ON public.refund_requests;
CREATE POLICY "Admins can manage refund_requests" ON public.refund_requests
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (( SELECT is_admin_user() AS is_admin_user))
  WITH CHECK (( SELECT is_admin_user() AS is_admin_user));

DROP POLICY IF EXISTS "Admins can delete any review" ON public.reviews;
CREATE POLICY "Admins can delete any review" ON public.reviews
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (( SELECT is_admin_user() AS is_admin_user));

DROP POLICY IF EXISTS "Admins can view all reviews" ON public.reviews;
CREATE POLICY "Admins can view all reviews" ON public.reviews
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (( SELECT is_admin_user() AS is_admin_user));

DROP POLICY IF EXISTS "Attendees can create their own review" ON public.reviews;
CREATE POLICY "Attendees can create their own review" ON public.reviews
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT user_is_banned(( SELECT auth.uid() AS uid))) AND user_can_review_business(business_id)));

DROP POLICY IF EXISTS "Business owners can respond to reviews" ON public.reviews;
CREATE POLICY "Business owners can respond to reviews" ON public.reviews
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM businesses
  WHERE ((businesses.id = reviews.business_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM businesses
  WHERE ((businesses.id = reviews.business_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "Users can delete their own review" ON public.reviews;
CREATE POLICY "Users can delete their own review" ON public.reviews
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can update their own review" ON public.reviews;
CREATE POLICY "Users can update their own review" ON public.reviews
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can create their own RSVPs" ON public.rsvps;
CREATE POLICY "Users can create their own RSVPs" ON public.rsvps
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT user_is_banned(( SELECT auth.uid() AS uid))) AND (NOT user_is_banned_from_event(event_id, ( SELECT auth.uid() AS uid))) AND (NOT event_rsvps_closed(event_id)) AND event_is_open_for_rsvp(event_id)));

DROP POLICY IF EXISTS "Users can delete their own RSVPs" ON public.rsvps;
CREATE POLICY "Users can delete their own RSVPs" ON public.rsvps
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can update their own RSVPs" ON public.rsvps;
CREATE POLICY "Users can update their own RSVPs" ON public.rsvps
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT user_is_banned(( SELECT auth.uid() AS uid))) AND (NOT user_is_banned_from_event(event_id, ( SELECT auth.uid() AS uid))) AND event_allows_rsvp_changes(event_id)));

DROP POLICY IF EXISTS "Users can view their own RSVPs" ON public.rsvps;
CREATE POLICY "Users can view their own RSVPs" ON public.rsvps
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can create their own saves" ON public.saves;
CREATE POLICY "Users can create their own saves" ON public.saves
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT user_is_banned(( SELECT auth.uid() AS uid)))));

DROP POLICY IF EXISTS "Users can delete their own saves" ON public.saves;
CREATE POLICY "Users can delete their own saves" ON public.saves
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can view their own saves" ON public.saves;
CREATE POLICY "Users can view their own saves" ON public.saves
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can create own blocks" ON public.user_blocks;
CREATE POLICY "Users can create own blocks" ON public.user_blocks
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((blocker_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Users can delete own blocks" ON public.user_blocks;
CREATE POLICY "Users can delete own blocks" ON public.user_blocks
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((blocker_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Users can view own blocks" ON public.user_blocks;
CREATE POLICY "Users can view own blocks" ON public.user_blocks
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((blocker_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Users can delete own push tokens" ON public.user_push_tokens;
CREATE POLICY "Users can delete own push tokens" ON public.user_push_tokens
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can insert own push tokens" ON public.user_push_tokens;
CREATE POLICY "Users can insert own push tokens" ON public.user_push_tokens
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can read own push tokens" ON public.user_push_tokens;
CREATE POLICY "Users can read own push tokens" ON public.user_push_tokens
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Users can update own push tokens" ON public.user_push_tokens;
CREATE POLICY "Users can update own push tokens" ON public.user_push_tokens
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


COMMIT;
