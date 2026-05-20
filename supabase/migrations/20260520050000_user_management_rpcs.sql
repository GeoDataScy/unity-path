-- RPCs powering the manager "Usuários" page and the auth watcher.
-- All SECURITY DEFINER + role checks inside.

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_heartbeat: client UPSERTs every 30s to keep last_seen_at fresh.
-- Only the authenticated user can heartbeat for themselves.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agent_heartbeat(p_user_agent text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  INSERT INTO public.agent_heartbeats (user_id, last_seen_at, user_agent, updated_at)
  VALUES (v_uid, now(), p_user_agent, now())
  ON CONFLICT (user_id) DO UPDATE
  SET last_seen_at = EXCLUDED.last_seen_at,
      user_agent = COALESCE(EXCLUDED.user_agent, public.agent_heartbeats.user_agent),
      updated_at = now();
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- record_auth_event: clients call before signOut to log the logout. Also used
-- internally for force_logout. Authenticated users can only log for themselves
-- (or managers can log for anyone, used by manager_set_user_active etc).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_auth_event(
  p_event_type text,
  p_target_user_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text;
  v_target text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  v_target := COALESCE(p_target_user_id, v_uid);

  IF v_target <> v_uid AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.auth_events (user_id, event_type, actor_id, metadata)
  VALUES (v_target, p_event_type, v_uid, p_metadata);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- me_status: the watcher in the layouts calls this in the polling loop. If
-- is_active = false, the client forces logout. Replaces blockedUsers.ts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.me_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text;
  v_active boolean;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('is_active', false, 'reason', 'unauthenticated');
  END IF;

  SELECT is_active INTO v_active FROM public.profiles WHERE id = v_uid;

  -- No profile row means the user was hard-deleted but the JWT is still around.
  IF v_active IS NULL THEN
    RETURN jsonb_build_object('is_active', false, 'reason', 'no_profile');
  END IF;

  RETURN jsonb_build_object(
    'is_active', v_active,
    'reason', CASE WHEN v_active THEN NULL ELSE 'deactivated' END
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- manager_list_users: single payload for the Usuários page.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manager_list_users()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.is_active DESC, t.full_name ASC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      p.id,
      p.email,
      p.full_name,
      p.role::text AS role,
      p.support_channel,
      p.is_active,
      p.deactivated_at,
      p.deactivated_by,
      (SELECT email FROM public.profiles WHERE id = p.deactivated_by) AS deactivated_by_email,
      p.created_at,
      u.last_sign_in_at,
      u.banned_until,
      u.deleted_at AS auth_deleted_at,
      (u.id IS NULL) AS auth_account_deleted,
      h.last_seen_at,
      (h.last_seen_at IS NOT NULL AND h.last_seen_at > now() - interval '90 seconds') AS is_online,
      (
        SELECT occurred_at
        FROM public.auth_events e
        WHERE e.user_id = p.id AND e.event_type IN ('logout', 'force_logout')
        ORDER BY occurred_at DESC
        LIMIT 1
      ) AS last_logout_at
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id::text = p.id
    LEFT JOIN public.agent_heartbeats h ON h.user_id = p.id
  ) t;

  RETURN v_result;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- manager_set_user_active: toggle inactivation, log event.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manager_set_user_active(
  p_target_user_id text,
  p_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_manager text;
  v_current boolean;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_manager := auth.uid()::text;
  IF v_manager = p_target_user_id THEN
    RAISE EXCEPTION 'cannot deactivate self';
  END IF;

  SELECT is_active INTO v_current FROM public.profiles WHERE id = p_target_user_id;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
  IF v_current = p_active THEN
    -- No-op (idempotent).
    RETURN;
  END IF;

  UPDATE public.profiles
  SET is_active = p_active,
      deactivated_at = CASE WHEN p_active THEN NULL ELSE now() END,
      deactivated_by = CASE WHEN p_active THEN NULL ELSE v_manager END
  WHERE id = p_target_user_id;

  INSERT INTO public.auth_events (user_id, event_type, actor_id)
  VALUES (p_target_user_id, CASE WHEN p_active THEN 'reactivated' ELSE 'deactivated' END, v_manager);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- manager_delete_auth_user: nukes the auth.users row (login + sessions) but
-- preserves the profile row and all history (services, refunds, transfers).
-- Requires the manager to retype the user's email as proof.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manager_delete_auth_user(
  p_target_user_id text,
  p_confirm_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_manager text;
  v_profile_email text;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_manager := auth.uid()::text;
  IF v_manager = p_target_user_id THEN
    RAISE EXCEPTION 'cannot delete self';
  END IF;

  SELECT email INTO v_profile_email FROM public.profiles WHERE id = p_target_user_id;
  IF v_profile_email IS NULL THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
  IF lower(btrim(v_profile_email)) <> lower(btrim(p_confirm_email)) THEN
    RAISE EXCEPTION 'email confirmation does not match';
  END IF;

  -- Mark profile as inactive too so the listing reflects the auth removal,
  -- and remove from heartbeats so the row doesn't keep appearing as online.
  UPDATE public.profiles
  SET is_active = false,
      deactivated_at = COALESCE(deactivated_at, now()),
      deactivated_by = COALESCE(deactivated_by, v_manager)
  WHERE id = p_target_user_id;

  DELETE FROM public.agent_heartbeats WHERE user_id = p_target_user_id;

  -- Delete the auth.users row. Supabase cascades sessions/identities/refresh
  -- tokens via internal FKs. Public-schema tables have no FK to auth.users, so
  -- services, refunds, ticket_transfers, etc. remain intact.
  DELETE FROM auth.users WHERE id::text = p_target_user_id;

  INSERT INTO public.auth_events (user_id, event_type, actor_id, metadata)
  VALUES (p_target_user_id, 'deleted', v_manager, jsonb_build_object('email', v_profile_email));
END;
$function$;
