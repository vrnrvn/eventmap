-- Account deletion (store-policy requirement).
--
-- IRREVERSIBLE: delete_own_account() permanently erases the calling user's
-- account and every row that hangs off it. There is no soft-delete, grace
-- period, or recovery path.
--
-- Cascade audit (20260213092127_create_initial_schema.sql and later):
--   profiles.id            -> auth.users  ON DELETE CASCADE
--   businesses.owner_id    -> profiles    ON DELETE CASCADE
--   events.business_id     -> businesses  ON DELETE CASCADE
--   event_photos/event_links.event_id -> events ON DELETE CASCADE
--   rsvps/saves.user_id    -> profiles ON DELETE CASCADE (and event_id -> events CASCADE)
--   reviews.user_id        -> profiles CASCADE; reviews.business_id -> businesses CASCADE
--   follows.user_id        -> profiles CASCADE
--   complaints.reporter_id -> profiles CASCADE
--   banned_users.user_id / refund_requests.user_id -> profiles CASCADE
--   event_chat_messages.sender_id -> profiles CASCADE (per-event chat tables cascade from events)
--   notifications.user_id / user_push_tokens.user_id -> auth.users CASCADE
--   event_views.viewer_id  -> profiles ON DELETE SET NULL (anonymised, intentionally kept)
--   *_by / processed_by / deleted_by audit columns -> ON DELETE SET NULL (kept, anonymised)
--
-- Because every user-owned row ultimately cascades from auth.users (via
-- profiles -> businesses -> events), a single DELETE on auth.users is
-- sufficient; the explicit business/profile deletes below are kept first so
-- the heavy event cascades run in a predictable order and the intent is
-- auditable. Storage objects in the 'avatars' and 'event-images' buckets
-- (20260215110000 / 20260213092328) that live under the user's uid folder
-- (the layout enforced by 20261030102000) are deleted here as well; legacy
-- event images under pre-20261030102000 non-uid paths (e.g. 'events/...')
-- cannot be attributed to a user and stay orphaned.

CREATE OR REPLACE FUNCTION delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 1. Business (cascades: events -> photos/links/rsvps/saves/chat, reviews,
  --    follows, business_photos/links, promotions SET NULL).
  DELETE FROM businesses WHERE owner_id = v_user_id;

  -- 2. Profile (cascades: rsvps, saved_events, reviews, follows, complaints,
  --    banned_users, refund_requests, event_chat_messages, etc.).
  DELETE FROM profiles WHERE id = v_user_id;

  -- 3. Storage objects: the user's avatar and event images, both uploaded
  --    under `${uid}/...` (enforced by the owner-folder policies in
  --    20261030102000). Older event images under legacy non-uid paths
  --    (e.g. 'events/...') carry no owner in their path and can't be
  --    attributed to this user, so they are left behind (orphaned).
  DELETE FROM storage.objects
  WHERE bucket_id IN ('avatars', 'event-images')
    AND (storage.foldername(name))[1] = v_user_id::text;

  -- 4. Auth user (cascades: notifications, user_push_tokens, and would have
  --    cascaded the profile as well). This invalidates all sessions.
  DELETE FROM auth.users WHERE id = v_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION delete_own_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delete_own_account() TO authenticated, service_role;
