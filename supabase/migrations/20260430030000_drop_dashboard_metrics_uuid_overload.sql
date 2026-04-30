-- Remove the old uuid overload of dashboard_metrics left over from
-- migration 20260316130100. Later migrations redefined the function with
-- agent_id TEXT, but CREATE OR REPLACE with a different parameter type
-- creates a second overload instead of replacing the original, causing
-- "could not choose best candidate function" errors at call time.
DROP FUNCTION IF EXISTS public.dashboard_metrics(date, date, uuid);

NOTIFY pgrst, 'reload schema';
