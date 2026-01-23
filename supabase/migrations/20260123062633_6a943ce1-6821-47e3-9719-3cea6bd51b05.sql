-- Allow managers to read refunds for analytics
DROP POLICY IF EXISTS "Managers view all refunds" ON public.refunds;
CREATE POLICY "Managers view all refunds"
ON public.refunds
FOR SELECT
USING ((auth.uid() IS NOT NULL) AND public.is_manager());

-- Aggregated refund metrics for manager dashboard
CREATE OR REPLACE FUNCTION public.dashboard_refund_metrics(
  from_date date,
  to_date date,
  agent_id uuid DEFAULT NULL::uuid,
  status_filter text DEFAULT NULL,
  refund_type_filter text DEFAULT NULL
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
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Total / open / done
  SELECT
    COUNT(*)::bigint,
    SUM(CASE WHEN r.completion_date IS NULL THEN 1 ELSE 0 END)::bigint,
    SUM(CASE WHEN r.completion_date IS NOT NULL THEN 1 ELSE 0 END)::bigint
  INTO v_total, v_open, v_done
  FROM public.refunds r
  WHERE r.request_date >= from_date
    AND r.request_date <= to_date
    AND (agent_id IS NULL OR r.user_id = agent_id)
    AND (status_filter IS NULL OR status_filter = 'all'
      OR (status_filter = 'open' AND r.completion_date IS NULL)
      OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
    AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
      OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
      OR r.refund_type = refund_type_filter);

  -- By agent
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_agent
  FROM (
    SELECT
      COALESCE(p.full_name, 'Sem nome') AS name,
      COUNT(*)::int AS value,
      r.user_id
    FROM public.refunds r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE r.request_date >= from_date
      AND r.request_date <= to_date
      AND (agent_id IS NULL OR r.user_id = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
    GROUP BY r.user_id, p.full_name
  ) t;

  -- By status
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC), '[]'::jsonb)
    INTO v_by_status
  FROM (
    SELECT
      CASE WHEN r.completion_date IS NULL THEN 'Em aberto' ELSE 'Concluído' END AS name,
      COUNT(*)::int AS value
    FROM public.refunds r
    WHERE r.request_date >= from_date
      AND r.request_date <= to_date
      AND (agent_id IS NULL OR r.user_id = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
    GROUP BY 1
  ) t;

  -- By refund_type (done only)
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_refund_type
  FROM (
    SELECT
      COALESCE(r.refund_type, 'Não informado') AS name,
      COUNT(*)::int AS value
    FROM public.refunds r
    WHERE r.request_date >= from_date
      AND r.request_date <= to_date
      AND (agent_id IS NULL OR r.user_id = agent_id)
      AND r.completion_date IS NOT NULL
      AND (status_filter IS NULL OR status_filter = 'all' OR status_filter = 'done')
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
    GROUP BY COALESCE(r.refund_type, 'Não informado')
  ) t;

  RETURN jsonb_build_object(
    'total_count', COALESCE(v_total, 0),
    'open_count', COALESCE(v_open, 0),
    'done_count', COALESCE(v_done, 0),
    'by_agent', v_by_agent,
    'by_status', v_by_status,
    'by_refund_type', v_by_refund_type
  );
END;
$$;

-- Paginated refund audit for manager dashboard
CREATE OR REPLACE FUNCTION public.dashboard_refund_audit(
  from_date date,
  to_date date,
  agent_id uuid DEFAULT NULL::uuid,
  status_filter text DEFAULT NULL,
  refund_type_filter text DEFAULT NULL,
  page_size integer DEFAULT 25,
  page_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF page_size IS NULL OR page_size < 1 THEN
    page_size := 25;
  END IF;
  IF page_size > 200 THEN
    page_size := 200;
  END IF;
  IF page_offset IS NULL OR page_offset < 0 THEN
    page_offset := 0;
  END IF;

  SELECT COUNT(*)
    INTO v_total
  FROM public.refunds r
  WHERE r.request_date >= from_date
    AND r.request_date <= to_date
    AND (agent_id IS NULL OR r.user_id = agent_id)
    AND (status_filter IS NULL OR status_filter = 'all'
      OR (status_filter = 'open' AND r.completion_date IS NULL)
      OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
    AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
      OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
      OR r.refund_type = refund_type_filter);

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      r.id,
      r.created_at,
      r.user_id,
      r.customer_email,
      r.request_date,
      r.completion_date,
      r.sales_platform,
      r.order_id,
      r.refund_type,
      r.reason,
      r.items_returned,
      jsonb_build_object('full_name', p.full_name) AS profiles
    FROM public.refunds r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE r.request_date >= from_date
      AND r.request_date <= to_date
      AND (agent_id IS NULL OR r.user_id = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
    ORDER BY r.request_date DESC, r.created_at DESC
    LIMIT page_size
    OFFSET page_offset
  ) t;

  RETURN jsonb_build_object(
    'total_count', v_total,
    'rows', v_rows
  );
END;
$$;