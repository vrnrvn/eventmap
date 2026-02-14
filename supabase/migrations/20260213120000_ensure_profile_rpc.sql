-- Ensure profile exists before business creation (handles race with handle_new_user trigger)
CREATE OR REPLACE FUNCTION public.ensure_profile_exists(p_user_id uuid, p_name text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Cannot ensure profile for another user';
  END IF;
  INSERT INTO public.profiles (id, name)
  VALUES (p_user_id, COALESCE(NULLIF(TRIM(p_name), ''), 'User'))
  ON CONFLICT (id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile_exists(uuid, text) TO authenticated;
