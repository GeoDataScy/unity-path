-- Remove the uuid-typed overload of dashboard_refund_metrics that was created by mistake.
-- This database stores all IDs as text, so the text-typed version is the correct one.
-- Having both caused an ambiguous function call error, making the dashboard show all zeros.
DROP FUNCTION IF EXISTS public.dashboard_refund_metrics(date, date, uuid, text, text, text);
