-- Manager-driven ticket redistribution.
--
-- Adds the assigned_by_manager_id column to ticket_transfers so the agent
-- bell / history UI can distinguish a peer transfer (assigned_by_manager_id
-- IS NULL) from a manager reassign (NOT NULL). And introduces two RPCs:
--
--   * manager_list_open_tickets_by_agent(p_agent_id)
--       -> jsonb array of tickets currently owned by p_agent_id whose
--          effective status is "in progress" (not 'concluido'). Manager-only.
--
--   * manager_reassign_tickets(p_assignments jsonb)
--       -> jsonb {moved, skipped} report. Manager-only. For each
--          {service_id, to_user_id} pair:
--             1. UPDATE services.current_owner_id (the freeze trigger from
--                20260528000200 lets managers do this).
--             2. INSERT a ticket_transfers row with status='accepted',
--                from=old owner, to=new owner, assigned_by_manager_id=manager.
--          Idempotent: if to_user_id is already the current owner, skip.
--          Everything runs in the implicit transaction of the RPC call —
--          any error rolls back the whole batch.
--
-- Also extends manager_list_users with open_tickets_count so the Usuários
-- page can show a badge per agent without a second round-trip.

-- ============================================================================
-- 1) ticket_transfers.assigned_by_manager_id
-- ============================================================================
ALTER TABLE public.ticket_transfers
  ADD COLUMN IF NOT EXISTS assigned_by_manager_id text;

ALTER TABLE public.ticket_transfers
  DROP CONSTRAINT IF EXISTS ticket_transfers_assigned_by_manager_id_fkey;
ALTER TABLE public.ticket_transfers
  ADD CONSTRAINT ticket_transfers_assigned_by_manager_id_fkey
  FOREIGN KEY (assigned_by_manager_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_transfers_assigned_by_manager
  ON public.ticket_transfers (assigned_by_manager_id)
  WHERE assigned_by_manager_id IS NOT NULL;

-- The existing unique partial index forbids two pending requests from the
-- same agent for the same ticket — manager reassigns insert with
-- status='accepted', so it doesn't collide.

-- ============================================================================
-- 2) manager_list_open_tickets_by_agent
-- ============================================================================
-- "Open" means the latest signal isn't 'concluido':
--   * If the ticket has follow-ups, the latest follow-up's status decides.
--   * If the ticket has no follow-ups, services.status decides.
-- This mirrors the rule used by the agent's "Meus Atendimentos" table.

CREATE OR REPLACE FUNCTION public.manager_list_open_tickets_by_agent(p_agent_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_agent_id IS NULL OR length(p_agent_id) = 0 THEN
    RAISE EXCEPTION 'p_agent_id is required';
  END IF;

  WITH latest_followup AS (
    SELECT DISTINCT ON (f.service_id)
      f.service_id,
      f.status,
      f.recorded_at
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE s.current_owner_id = p_agent_id
    ORDER BY f.service_id, f.recorded_at DESC
  ),
  followup_counts AS (
    SELECT f.service_id, COUNT(*)::int AS total
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE s.current_owner_id = p_agent_id
    GROUP BY f.service_id
  ),
  rows AS (
    SELECT
      s.id                                          AS service_id,
      s.client_email,
      s.product,
      s.platform,
      s.channel,
      s.service_date,
      s.has_tracking_code,
      s.contact_reason,
      COALESCE(lf.status, s.status)                 AS effective_status,
      lf.recorded_at                                AS last_followup_at,
      COALESCE(fc.total, 0)                         AS follow_up_count,
      s.user_id                                     AS creator_id,
      pc.full_name                                  AS creator_name,
      pc.email                                      AS creator_email
    FROM public.services s
    LEFT JOIN latest_followup lf  ON lf.service_id = s.id
    LEFT JOIN followup_counts  fc ON fc.service_id = s.id
    LEFT JOIN public.profiles  pc ON pc.id = s.user_id
    WHERE s.current_owner_id = p_agent_id
      AND COALESCE(lf.status, s.status) <> 'concluido'
  )
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.service_date DESC, r.service_id), '[]'::jsonb)
    INTO v_result
  FROM rows r;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_list_open_tickets_by_agent(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_list_open_tickets_by_agent(text) TO authenticated;

-- ============================================================================
-- 3) manager_reassign_tickets
-- ============================================================================
-- Input: jsonb array of objects, each with service_id (text) and to_user_id (text).
-- Output: jsonb {moved: int, skipped: int, skipped_reasons: [...]}.
--
-- Each pair is processed independently inside the same transaction. If any
-- pair raises (e.g. service_id doesn't exist, to_user_id is not a valid
-- active profile), the whole call rolls back — partial reassignments are
-- never visible.

CREATE OR REPLACE FUNCTION public.manager_reassign_tickets(p_assignments jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_manager        text;
  v_pair           jsonb;
  v_service_id     text;
  v_to_user_id     text;
  v_current_owner  text;
  v_creator        text;
  v_moved          int := 0;
  v_skipped        int := 0;
  v_skipped_reasons jsonb := '[]'::jsonb;
  v_to_active      boolean;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_manager := auth.uid()::text;

  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'p_assignments must be a JSON array';
  END IF;

  FOR v_pair IN SELECT * FROM jsonb_array_elements(p_assignments)
  LOOP
    v_service_id := v_pair->>'service_id';
    v_to_user_id := v_pair->>'to_user_id';

    IF v_service_id IS NULL OR v_to_user_id IS NULL THEN
      RAISE EXCEPTION 'each assignment must have service_id and to_user_id (got: %)', v_pair::text;
    END IF;

    -- Validate destination: must be an active profile.
    SELECT is_active INTO v_to_active FROM public.profiles WHERE id = v_to_user_id;
    IF v_to_active IS NULL THEN
      RAISE EXCEPTION 'destination user not found: %', v_to_user_id;
    END IF;
    IF NOT v_to_active THEN
      RAISE EXCEPTION 'destination user is inactive: %', v_to_user_id;
    END IF;

    -- Read current state with a row lock to prevent concurrent reassigns.
    SELECT current_owner_id, user_id
      INTO v_current_owner, v_creator
    FROM public.services
    WHERE id = v_service_id
    FOR UPDATE;

    IF v_current_owner IS NULL THEN
      RAISE EXCEPTION 'service not found: %', v_service_id;
    END IF;

    -- Idempotent: destination already owns it -> skip.
    IF v_current_owner = v_to_user_id THEN
      v_skipped := v_skipped + 1;
      v_skipped_reasons := v_skipped_reasons || jsonb_build_object(
        'service_id', v_service_id,
        'reason', 'already_owned_by_destination'
      );
      CONTINUE;
    END IF;

    -- Move ownership. The freeze trigger allows this because is_manager()
    -- is true for the caller.
    UPDATE public.services
    SET current_owner_id = v_to_user_id
    WHERE id = v_service_id;

    -- Record the move as an accepted transfer for the agent bell + history.
    -- recipient_seen_at = NULL so the destination gets a notification badge.
    -- requester_seen_at = now() so the (deactivated) source doesn't surface
    -- a "your transfer was accepted" notification.
    INSERT INTO public.ticket_transfers (
      service_id,
      from_user_id,
      to_user_id,
      status,
      message,
      responded_at,
      recipient_seen_at,
      requester_seen_at,
      assigned_by_manager_id
    ) VALUES (
      v_service_id,
      v_current_owner,
      v_to_user_id,
      'accepted',
      'Redistribuído pelo gestor',
      now(),
      NULL,
      now(),
      v_manager
    );

    v_moved := v_moved + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'moved', v_moved,
    'skipped', v_skipped,
    'skipped_reasons', v_skipped_reasons
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manager_reassign_tickets(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_reassign_tickets(jsonb) TO authenticated;

-- ============================================================================
-- 4) manager_list_users — add open_tickets_count per agent
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_list_users()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH open_counts AS (
    -- One row per (current_owner, ticket whose effective status != 'concluido').
    -- LATERAL keeps the latest-followup lookup local to each ticket.
    SELECT
      s.current_owner_id AS user_id,
      COUNT(*)::int      AS total
    FROM public.services s
    LEFT JOIN LATERAL (
      SELECT f.status
      FROM public.service_follow_ups f
      WHERE f.service_id = s.id
      ORDER BY f.recorded_at DESC
      LIMIT 1
    ) latest ON true
    WHERE COALESCE(latest.status, s.status) <> 'concluido'
    GROUP BY s.current_owner_id
  )
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
      ) AS last_logout_at,
      COALESCE(oc.total, 0) AS open_tickets_count
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id::text = p.id
    LEFT JOIN public.agent_heartbeats h ON h.user_id = p.id
    LEFT JOIN open_counts oc ON oc.user_id = p.id
  ) t;

  RETURN v_result;
END;
$$;

NOTIFY pgrst, 'reload schema';
