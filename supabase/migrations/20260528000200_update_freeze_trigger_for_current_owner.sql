-- Extends the services freeze trigger so it also governs current_owner_id.
--
-- Rules after this migration:
--   user_id          -> immutable, period (it's the creator; mutating it
--                       would rewrite historical credit in _interaction_events)
--   service_date     -> immutable except for managers (unchanged)
--   current_owner_id -> immutable except for managers (NEW)
--
-- Manager carve-outs work because:
--   * Trigger functions execute in the caller's auth context (auth.uid()
--     returns the end-user even when the calling RPC is SECURITY DEFINER).
--   * is_manager() is STABLE SECURITY DEFINER and reads profiles.role for
--     the current end-user.
-- So manager_reassign_tickets (defined in 20260528000400) flows through this
-- trigger and succeeds only when invoked by a manager.

CREATE OR REPLACE FUNCTION public._tg_service_block_freeze_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- user_id is the creator. Always immutable, no manager override.
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id is immutable (creator is frozen)';
  END IF;

  -- service_date: manager-only carve-out (manager_correct_service_date RPC).
  IF NEW.service_date IS DISTINCT FROM OLD.service_date THEN
    IF NOT public.is_manager() THEN
      RAISE EXCEPTION 'service_date is immutable (use manager_correct_service_date)';
    END IF;
  END IF;

  -- current_owner_id: manager-only carve-out (manager_reassign_tickets RPC).
  IF NEW.current_owner_id IS DISTINCT FROM OLD.current_owner_id THEN
    IF NOT public.is_manager() THEN
      RAISE EXCEPTION 'current_owner_id can only be changed by a manager';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger binding is unchanged; CREATE OR REPLACE FUNCTION above swaps the
-- body in place.

NOTIFY pgrst, 'reload schema';
