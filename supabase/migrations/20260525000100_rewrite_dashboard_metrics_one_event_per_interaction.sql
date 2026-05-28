-- Rewrite dashboard_metrics with the "cada interação = 1" rule.
--
-- Substitui 20260506000000_align_dashboard_metrics_with_my_services.sql.
--
-- Previous rule used COUNT(DISTINCT service_id), which made
--   SUM(by_day[*].value)  !=  total_count
-- whenever a ticket had activity on multiple days. It also drifted from the
-- per-day count the agent sees, because the agent screen counts by day while
-- the manager screen deduplicated across the whole range.
--
-- New rule: each event in _interaction_events counts as 1.
--   total_count        = total number of events in range
--   by_day             = events per SP calendar day      → sums to total_count
--   by_agent           = events per actor                → sums to total_count
--   by_platform / by_channel / by_product = events per attribute (from the
--     service the event belongs to)                     → sum to total_count
--
-- Why this matters: it makes the manager dashboard mathematically consistent
-- (every breakdown sums to the headline) AND it matches agent_daily_metrics
-- for the same agent on the same day, eliminating the "the past changed"
-- complaint when the cause was just two RPCs answering different questions.

CREATE OR REPLACE FUNCTION public.dashboard_metrics(
  from_date date,
  to_date   date,
  agent_id  text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total       bigint;
  v_by_agent    jsonb;
  v_by_product  jsonb;
  v_by_day      jsonb;
  v_by_platform jsonb;
  v_by_channel  jsonb;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- ── Total: number of interaction events in the period ─────────────────────
  SELECT COUNT(*)::bigint INTO v_total
  FROM public._interaction_events(from_date, to_date, agent_id);

  -- ── Per-agent breakdown ───────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_agent
  FROM (
    SELECT
      e.user_id,
      COALESCE(MAX(p.full_name), 'Sem nome') AS name,
      COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, agent_id) e
    LEFT JOIN public.profiles p ON p.id::text = e.user_id
    GROUP BY e.user_id
  ) t;

  -- ── By product (top 10) ───────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT COALESCE(e.product, 'Não informado') AS name,
           COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, agent_id) e
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC
    LIMIT 10
  ) t;

  -- ── By day ────────────────────────────────────────────────────────────────
  WITH ds AS (
    SELECT generate_series(from_date, to_date, '1 day'::interval)::date AS day
  ),
  per_day AS (
    SELECT day, COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, agent_id)
    GROUP BY day
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT to_char(ds.day, 'YYYY-MM-DD') AS day,
           COALESCE(per_day.value, 0)    AS value
    FROM ds
    LEFT JOIN per_day ON per_day.day = ds.day
  ) t;

  -- ── By platform ───────────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_platform
  FROM (
    SELECT COALESCE(e.platform, 'Não informado') AS name,
           COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, agent_id) e
    GROUP BY 1
  ) t;

  -- ── By channel ────────────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_channel
  FROM (
    SELECT COALESCE(e.channel, 'Não informado') AS name,
           COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, agent_id) e
    GROUP BY 1
  ) t;

  RETURN jsonb_build_object(
    'total_count',  COALESCE(v_total, 0),
    'by_agent',     v_by_agent,
    'by_product',   v_by_product,
    'by_day',       v_by_day,
    'by_platform',  v_by_platform,
    'by_channel',   v_by_channel
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
