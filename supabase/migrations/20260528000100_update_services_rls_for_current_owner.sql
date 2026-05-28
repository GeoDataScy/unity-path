-- Migrates services + service_follow_ups RLS from "owner = creator" to
-- "owner = current handler". After 20260528000000 introduced current_owner_id,
-- the agent who sees / edits / deletes a ticket should be the one currently
-- handling it (current_owner_id), not the one who originally created it
-- (user_id).
--
-- Why we keep INSERT pinned to user_id = auth.uid():
--   The creator is always the agent doing the INSERT — the trigger from
--   the previous migration copies user_id into current_owner_id on insert,
--   so there is no scenario where an agent inserts a ticket "on behalf of"
--   someone else from the client. Manager-side flows that need that go
--   through SECURITY DEFINER RPCs which bypass RLS.
--
-- service_follow_ups SELECT changes:
--   An agent can read follow-ups where they are the author (preserves access
--   to history of tickets they once owned), OR where they are the current
--   owner of the parent service (so they can read history of tickets that
--   were redistributed to them). The EXISTS subquery is the canonical way to
--   express this without a join in the policy expression.

-- ============================================================================
-- services
-- ============================================================================

-- SELECT: own = current handler
DROP POLICY IF EXISTS "Agents view own services" ON public.services;
CREATE POLICY "Agents view own services"
  ON public.services
  FOR SELECT
  USING (current_owner_id = auth.uid()::text);

-- UPDATE: current handler can edit (client_email, product, platform, etc).
-- The freeze trigger (next migration) still blocks user_id from changing
-- and only lets managers move current_owner_id.
DROP POLICY IF EXISTS "Agents update own services" ON public.services;
CREATE POLICY "Agents update own services"
  ON public.services
  FOR UPDATE
  USING (current_owner_id = auth.uid()::text)
  WITH CHECK (current_owner_id = auth.uid()::text);

-- DELETE: only the current handler can drop the ticket. Creator who is no
-- longer handling it loses delete rights (intentional — once redistributed,
-- the new owner is responsible).
DROP POLICY IF EXISTS "Agents delete own services" ON public.services;
CREATE POLICY "Agents delete own services"
  ON public.services
  FOR DELETE
  USING (current_owner_id = auth.uid()::text);

-- INSERT policy is unchanged — creator is always the inserter.
-- Cross-agent (can_view_all_tickets) and manager policies are unchanged —
-- they don't reference user_id.

-- ============================================================================
-- service_follow_ups
-- ============================================================================

-- SELECT: union of "I wrote this follow-up" and "I'm the current owner of
-- the parent service". The first clause preserves access to history written
-- by the agent before a redistribution; the second grants visibility over
-- follow-ups written by others on tickets that have moved to me.
DROP POLICY IF EXISTS "Agents can read own follow-ups" ON public.service_follow_ups;
CREATE POLICY "Agents can read own follow-ups"
  ON public.service_follow_ups
  FOR SELECT
  USING (
    user_id = auth.uid()::text
    OR EXISTS (
      SELECT 1
      FROM public.services s
      WHERE s.id = service_follow_ups.service_id
        AND s.current_owner_id = auth.uid()::text
    )
  );

-- INSERT policy is unchanged — author of a follow-up is always the inserter
-- (the freeze triggers in 20260525000300 already pin user_id and recorded_at).

NOTIFY pgrst, 'reload schema';
