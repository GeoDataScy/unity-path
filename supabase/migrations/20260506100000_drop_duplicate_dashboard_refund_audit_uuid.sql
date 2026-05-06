-- Drop the leftover uuid-typed overload of dashboard_refund_audit.
--
-- Same root cause that affected dashboard_refund_metrics back in 20260428000000:
-- the database stores user IDs as text, so the text-typed version is the
-- canonical one. The uuid overload remained registered though, and PostgREST
-- could not pick a candidate when the frontend passed agent_id=null, returning
-- HTTP 300 with PGRST203. The refunds dashboard table fed by this RPC was
-- silently failing on every request (and retrying every 15s thanks to the
-- React Query refetchInterval).
--
-- Mirrors the strategy of 20260428000000_drop_duplicate_dashboard_refund_metrics_uuid.sql.

DROP FUNCTION IF EXISTS public.dashboard_refund_audit(
  date, date, uuid, text, text, text, integer, integer
);

NOTIFY pgrst, 'reload schema';
