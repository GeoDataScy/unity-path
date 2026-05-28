-- Freeze the historical timeline in the database.
--
-- Two attack surfaces caused "the past changes" complaints:
--   1. Follow-ups inserted with `recorded_at` in the past.
--   2. `service_date` (or `user_id`) edited after creation.
--
-- This migration installs triggers that make both impossible from the
-- application path. Managers retain an escape hatch via the
-- manager_correct_service_date RPC (next migration), which audits each
-- correction. All other paths see immutable history.
--
-- Why is_manager() inside triggers works: triggers run in the caller's
-- security context. auth.uid() returns the actual end-user. The
-- manager_correct_service_date RPC will be SECURITY DEFINER but the
-- is_manager() check inside the trigger still resolves against the
-- original caller, which must be a manager — so the RPC succeeds only
-- when invoked by a manager.

-- ============================================================================
-- service_follow_ups
-- ============================================================================
-- INSERT: force recorded_at to NOW(). The client cannot pick a date.
CREATE OR REPLACE FUNCTION public._tg_follow_up_force_now()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.recorded_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_follow_up_force_now ON public.service_follow_ups;
CREATE TRIGGER trg_follow_up_force_now
  BEFORE INSERT ON public.service_follow_ups
  FOR EACH ROW
  EXECUTE FUNCTION public._tg_follow_up_force_now();

-- UPDATE: recorded_at is immutable (no manager carve-out: follow-ups are not
-- correctable, period — if a follow-up is wrong, delete and reinsert).
CREATE OR REPLACE FUNCTION public._tg_follow_up_block_date_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.recorded_at IS DISTINCT FROM OLD.recorded_at THEN
    RAISE EXCEPTION 'recorded_at is immutable (history is frozen)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_follow_up_block_date_change ON public.service_follow_ups;
CREATE TRIGGER trg_follow_up_block_date_change
  BEFORE UPDATE ON public.service_follow_ups
  FOR EACH ROW
  EXECUTE FUNCTION public._tg_follow_up_block_date_change();

-- ============================================================================
-- services
-- ============================================================================
-- INSERT: pin service_date to today's date in São Paulo, regardless of what
-- the client sent. Preserves the existing convention (midnight SP, ISO 8601
-- string in `services.service_date::text`) so the "follow-up blocked until
-- 18:00 SP" rule continues to work.
CREATE OR REPLACE FUNCTION public._tg_service_pin_date_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today_sp date;
BEGIN
  v_today_sp := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  NEW.service_date := to_char(v_today_sp, 'YYYY-MM-DD') || 'T00:00:00-03:00';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_pin_date_on_insert ON public.services;
CREATE TRIGGER trg_service_pin_date_on_insert
  BEFORE INSERT ON public.services
  FOR EACH ROW
  EXECUTE FUNCTION public._tg_service_pin_date_on_insert();

-- UPDATE: service_date and user_id are frozen. Managers may override via the
-- dedicated RPC (which uses SECURITY DEFINER + is_manager() check + audits).
CREATE OR REPLACE FUNCTION public._tg_service_block_freeze_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id is immutable (ticket ownership is frozen)';
  END IF;

  IF NEW.service_date IS DISTINCT FROM OLD.service_date THEN
    IF NOT public.is_manager() THEN
      RAISE EXCEPTION 'service_date is immutable (use manager_correct_service_date)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_block_freeze_fields ON public.services;
CREATE TRIGGER trg_service_block_freeze_fields
  BEFORE UPDATE ON public.services
  FOR EACH ROW
  EXECUTE FUNCTION public._tg_service_block_freeze_fields();

NOTIFY pgrst, 'reload schema';
