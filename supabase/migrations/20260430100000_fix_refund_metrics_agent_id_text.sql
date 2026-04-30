-- Migration 090000 re-created the uuid-typed overload of dashboard_refund_metrics,
-- which was previously dropped by 20260428000000 because it caused ambiguous function
-- call errors (database stores IDs as text, not uuid).
-- Drop the uuid overload and replace with text-typed version that has the correct
-- completion_date filter logic.

DROP FUNCTION IF EXISTS public.dashboard_refund_metrics(date, date, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.dashboard_refund_metrics(
  from_date date,
  to_date date,
  agent_id text DEFAULT NULL,
  status_filter text DEFAULT NULL,
  refund_type_filter text DEFAULT NULL,
  product_filter text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total bigint;
  v_open bigint;
  v_done bigint;
  v_by_agent jsonb;
  v_by_status jsonb;
  v_by_refund_type jsonb;
  v_by_product jsonb;
  v_by_channel jsonb;
  v_by_channel_efficiency jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- ── Total / open / done ───────────────────────────────────────────────────────
  SELECT
    COUNT(*)::bigint,
    SUM(CASE WHEN r.completion_date IS NULL     THEN 1 ELSE 0 END)::bigint,
    SUM(CASE WHEN r.completion_date IS NOT NULL THEN 1 ELSE 0 END)::bigint
  INTO v_total, v_open, v_done
  FROM public.refunds r
  WHERE (
    (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
    OR
    (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
  )
    AND (agent_id IS NULL OR r.user_id::text = agent_id)
    AND (status_filter IS NULL OR status_filter = 'all'
      OR (status_filter = 'open' AND r.completion_date IS NULL)
      OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
    AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
      OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
      OR r.refund_type = refund_type_filter)
    AND (product_filter IS NULL OR product_filter = 'all'
      OR (product_filter = 'null' AND r.product IS NULL)
      OR r.product = product_filter);

  -- ── By agent ──────────────────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_agent
  FROM (
    SELECT
      COALESCE(p.full_name, 'Sem nome') AS name,
      COUNT(*)::int AS value,
      r.user_id
    FROM public.refunds r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE (
      (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
      OR
      (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
    )
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY r.user_id, p.full_name
  ) t;

  -- ── By status ─────────────────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC), '[]'::jsonb)
    INTO v_by_status
  FROM (
    SELECT
      CASE WHEN r.completion_date IS NULL THEN 'Em aberto' ELSE 'Concluído' END AS name,
      COUNT(*)::int AS value
    FROM public.refunds r
    WHERE (
      (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
      OR
      (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
    )
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY 1
  ) t;

  -- ── By refund_type (done only) ────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_refund_type
  FROM (
    SELECT
      COALESCE(r.refund_type, 'Não informado') AS name,
      COUNT(*)::int AS value
    FROM public.refunds r
    WHERE r.completion_date IS NOT NULL
      AND r.completion_date::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all' OR status_filter = 'done')
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY COALESCE(r.refund_type, 'Não informado')
  ) t;

  -- ── By product ────────────────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_product
  FROM (
    SELECT
      COALESCE(r.product, 'Não informado') AS name,
      COUNT(*)::int AS value
    FROM public.refunds r
    WHERE (
      (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
      OR
      (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
    )
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY COALESCE(r.product, 'Não informado')
  ) t;

  -- ── By channel ────────────────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_channel
  FROM (
    SELECT
      COALESCE(r.channel, 'Não informado') AS name,
      COUNT(*)::int AS value
    FROM public.refunds r
    WHERE (
      (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
      OR
      (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
    )
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY COALESCE(r.channel, 'Não informado')
  ) t;

  -- ── Channel efficiency (done only) ────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.efficiency_score DESC, t.channel ASC), '[]'::jsonb)
    INTO v_by_channel_efficiency
  FROM (
    SELECT
      COALESCE(r.channel, 'Não informado') AS channel,
      COUNT(*)::int AS total_done,
      COUNT(*) FILTER (WHERE r.refund_type IS NOT NULL AND r.refund_type != '100%')::int AS partial_count,
      COUNT(*) FILTER (WHERE r.refund_type = '100%')::int AS full_count,
      CASE
        WHEN COUNT(*) > 0
        THEN ROUND((COUNT(*) FILTER (WHERE r.refund_type IS NOT NULL AND r.refund_type != '100%')::numeric / COUNT(*)) * 100, 1)
        ELSE 0
      END AS efficiency_score
    FROM public.refunds r
    WHERE r.completion_date IS NOT NULL
      AND r.completion_date::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY COALESCE(r.channel, 'Não informado')
  ) t;

  RETURN jsonb_build_object(
    'total_count', COALESCE(v_total, 0),
    'open_count',  COALESCE(v_open, 0),
    'done_count',  COALESCE(v_done, 0),
    'by_agent',              v_by_agent,
    'by_status',             v_by_status,
    'by_refund_type',        v_by_refund_type,
    'by_product',            v_by_product,
    'by_channel',            v_by_channel,
    'by_channel_efficiency', v_by_channel_efficiency
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_refund_metrics(date, date, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
