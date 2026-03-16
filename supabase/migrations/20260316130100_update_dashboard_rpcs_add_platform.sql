-- Update dashboard_metrics to include by_platform
CREATE OR REPLACE FUNCTION public.dashboard_metrics(
  from_date date,
  to_date date,
  agent_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total bigint; v_by_agent jsonb; v_by_product jsonb; v_by_day jsonb; v_by_platform jsonb;
  v_agent text := agent_id::text;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COUNT(*) INTO v_total FROM public.services s
  WHERE s.service_date::timestamptz >= from_date::timestamptz
    AND s.service_date::timestamptz < (to_date::timestamptz + interval '1 day')
    AND (v_agent IS NULL OR s.user_id = v_agent);

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb) INTO v_by_agent
  FROM (
    SELECT COALESCE(p.full_name, 'Sem nome') AS name, COUNT(*)::int AS value, s.user_id
    FROM public.services s LEFT JOIN public.profiles p ON p.id = s.user_id
    WHERE s.service_date::timestamptz >= from_date::timestamptz
      AND s.service_date::timestamptz < (to_date::timestamptz + interval '1 day')
      AND (v_agent IS NULL OR s.user_id = v_agent)
    GROUP BY s.user_id, p.full_name
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb) INTO v_by_product
  FROM (
    SELECT s.product AS name, COUNT(*)::int AS value FROM public.services s
    WHERE s.service_date::timestamptz >= from_date::timestamptz
      AND s.service_date::timestamptz < (to_date::timestamptz + interval '1 day')
      AND (v_agent IS NULL OR s.user_id = v_agent)
    GROUP BY s.product ORDER BY COUNT(*) DESC, s.product ASC LIMIT 10
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::jsonb) INTO v_by_day
  FROM (
    SELECT to_char(date_trunc('day', s.service_date::timestamptz), 'YYYY-MM-DD') AS day, COUNT(*)::int AS value
    FROM public.services s
    WHERE s.service_date::timestamptz >= from_date::timestamptz
      AND s.service_date::timestamptz < (to_date::timestamptz + interval '1 day')
      AND (v_agent IS NULL OR s.user_id = v_agent)
    GROUP BY date_trunc('day', s.service_date::timestamptz)
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb) INTO v_by_platform
  FROM (
    SELECT COALESCE(s.platform, 'Nao informado') AS name, COUNT(*)::int AS value
    FROM public.services s
    WHERE s.service_date::timestamptz >= from_date::timestamptz
      AND s.service_date::timestamptz < (to_date::timestamptz + interval '1 day')
      AND (v_agent IS NULL OR s.user_id = v_agent)
    GROUP BY COALESCE(s.platform, 'Nao informado')
  ) t;

  RETURN jsonb_build_object('total_count', v_total, 'by_agent', v_by_agent, 'by_product', v_by_product, 'by_day', v_by_day, 'by_platform', v_by_platform);
END;
$$;

-- Update dashboard_audit to include platform column
CREATE OR REPLACE FUNCTION public.dashboard_audit(
  from_date date,
  to_date date,
  agent_id uuid DEFAULT NULL,
  page_size integer DEFAULT 25,
  page_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_total bigint; v_rows jsonb; v_agent text := agent_id::text;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF page_size IS NULL OR page_size < 1 THEN page_size := 25; END IF;
  IF page_size > 200 THEN page_size := 200; END IF;
  IF page_offset IS NULL OR page_offset < 0 THEN page_offset := 0; END IF;

  SELECT COUNT(*) INTO v_total FROM public.services s
  WHERE s.service_date::timestamptz >= from_date::timestamptz
    AND s.service_date::timestamptz < (to_date::timestamptz + interval '1 day')
    AND (v_agent IS NULL OR s.user_id = v_agent);

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT s.id, s.created_at, s.service_date, s.client_email, s.product, s.platform, s.status, s.user_id,
      jsonb_build_object('full_name', p.full_name) AS profiles
    FROM public.services s LEFT JOIN public.profiles p ON p.id = s.user_id
    WHERE s.service_date::timestamptz >= from_date::timestamptz
      AND s.service_date::timestamptz < (to_date::timestamptz + interval '1 day')
      AND (v_agent IS NULL OR s.user_id = v_agent)
    ORDER BY s.service_date::timestamptz DESC LIMIT page_size OFFSET page_offset
  ) t;

  RETURN jsonb_build_object('total_count', v_total, 'rows', v_rows);
END;
$$;
