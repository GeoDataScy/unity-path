-- Separates "who created the ticket" from "who is handling it now".
--
-- Before this migration: services.user_id is the only ownership signal — it
-- represents both the creator (for metrics/history) and the current handler
-- (for "Meus Atendimentos" listing, RLS, transfers). When a manager
-- redistributes a deactivated agent's tickets, mutating user_id would rewrite
-- the historical credit (the original agent would lose their interactions in
-- past dashboards). Adding a second column lets us keep user_id immutable
-- (creator/history) while letting current_owner_id move freely under manager
-- control.
--
-- Conventions established here (consumed by subsequent migrations):
--   * services.user_id          -> creator (immutable, source of truth for
--                                  _interaction_events service-creation events)
--   * services.current_owner_id -> agent who is handling the ticket right now
--                                  (RLS-relevant, mutable only by managers)
--
-- The BEFORE INSERT trigger auto-fills current_owner_id = user_id when the
-- client does not provide it. The existing INSERT path in Workspace.tsx /
-- Atendimentos.tsx therefore continues to work without code changes.

-- 1) Add column (nullable initially so the backfill can populate it safely)
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS current_owner_id text;

-- 2) Backfill: every existing ticket is currently being handled by its
-- creator. Done in a single UPDATE because 64k rows is fine for one shot.
UPDATE public.services
SET current_owner_id = user_id
WHERE current_owner_id IS NULL;

-- 3) Trigger to auto-fill current_owner_id on INSERT when the client omits it.
-- Lives separately from the existing freeze trigger because that one runs on
-- UPDATE; this one is BEFORE INSERT only.
CREATE OR REPLACE FUNCTION public._tg_service_default_current_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.current_owner_id IS NULL THEN
    NEW.current_owner_id := NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_default_current_owner ON public.services;
CREATE TRIGGER trg_service_default_current_owner
  BEFORE INSERT ON public.services
  FOR EACH ROW
  EXECUTE FUNCTION public._tg_service_default_current_owner();

-- 4) Now that all rows are populated and inserts are covered, mark NOT NULL.
ALTER TABLE public.services
  ALTER COLUMN current_owner_id SET NOT NULL;

-- 5) Foreign key to profiles. ON DELETE CASCADE matches services_user_id_fkey,
-- but in practice profiles are never hard-deleted — they're deactivated.
ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_current_owner_id_fkey;
ALTER TABLE public.services
  ADD CONSTRAINT services_current_owner_id_fkey
  FOREIGN KEY (current_owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- 6) Index for the agent-side filter "tickets I'm currently handling".
CREATE INDEX IF NOT EXISTS idx_services_current_owner_id
  ON public.services (current_owner_id);

NOTIFY pgrst, 'reload schema';
