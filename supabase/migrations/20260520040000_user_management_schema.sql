-- User management schema for the manager "Usuários" page.
--
-- 1. profiles gains soft-deactivation columns. Replaces the hard-coded list in
--    src/lib/blockedUsers.ts so the manager can deactivate without a redeploy.
-- 2. agent_heartbeats tracks last_seen_at via 30s client UPSERT — powers the
--    online/offline indicator.
-- 3. auth_events is an append-only audit log for login/logout/deactivate/delete.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) profiles: deactivation columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by text;

CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON public.profiles (is_active);

-- Backfill: preserve the Samuel block that today lives in blockedUsers.ts.
UPDATE public.profiles
SET is_active = false,
    deactivated_at = COALESCE(deactivated_at, now())
WHERE id = 'd259b282-dd5f-4b7c-8bd0-33029ae578b5'
  AND is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) agent_heartbeats: presence tracking
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_heartbeats (
  user_id text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_last_seen
  ON public.agent_heartbeats (last_seen_at DESC);

ALTER TABLE public.agent_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers read all heartbeats" ON public.agent_heartbeats;
CREATE POLICY "managers read all heartbeats"
  ON public.agent_heartbeats
  FOR SELECT
  USING (public.is_manager());

-- Writes go through RPC agent_heartbeat() below (SECURITY DEFINER), so no
-- direct INSERT/UPDATE policy is needed.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) auth_events: append-only audit log
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_events (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id text,
  metadata jsonb,
  CONSTRAINT auth_events_type_check CHECK (event_type IN (
    'login', 'logout', 'force_logout',
    'deactivated', 'reactivated',
    'deleted', 'restored'
  ))
);

CREATE INDEX IF NOT EXISTS idx_auth_events_user_id_occurred
  ON public.auth_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_event_type
  ON public.auth_events (event_type);

ALTER TABLE public.auth_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers read all auth events" ON public.auth_events;
CREATE POLICY "managers read all auth events"
  ON public.auth_events
  FOR SELECT
  USING (public.is_manager());

DROP POLICY IF EXISTS "users read own auth events" ON public.auth_events;
CREATE POLICY "users read own auth events"
  ON public.auth_events
  FOR SELECT
  USING (user_id = auth.uid()::text);
