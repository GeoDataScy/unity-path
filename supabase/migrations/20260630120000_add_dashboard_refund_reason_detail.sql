-- Drill-down do gráfico "Motivos de reembolso": lista os reembolsos que
-- compõem cada categoria normalizada (refund_reason_classifications.category).
--
-- Espelha EXATAMENTE a cláusula de período/filtros da agregação `by_reason`
-- de dashboard_refund_metrics (20260520020000), acrescida de um filtro por
-- categoria, para que as linhas retornadas batam com a contagem da barra.
-- Paginação no mesmo padrão de dashboard_refund_audit.

CREATE OR REPLACE FUNCTION public.dashboard_refund_reason_detail(
  from_date date,
  to_date date,
  reason_category text,
  agent_id text DEFAULT NULL,
  status_filter text DEFAULT NULL,
  refund_type_filter text DEFAULT NULL,
  product_filter text DEFAULT NULL,
  page_size integer DEFAULT 50,
  page_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF page_size IS NULL OR page_size < 1 THEN page_size := 50; END IF;
  IF page_size > 200 THEN page_size := 200; END IF;
  IF page_offset IS NULL OR page_offset < 0 THEN page_offset := 0; END IF;

  SELECT COUNT(*)
    INTO v_total
  FROM public.refunds r
  JOIN public.refund_reason_classifications c
    ON c.refund_id = r.id AND c.category = reason_category
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

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      r.id, r.created_at, r.user_id, r.customer_email, r.request_date,
      r.completion_date, r.sales_platform, r.order_id, r.refund_type,
      r.refund_value, r.reason, r.items_returned, r.product, r.channel,
      c.original_reason,
      jsonb_build_object('full_name', p.full_name) AS profiles
    FROM public.refunds r
    JOIN public.refund_reason_classifications c
      ON c.refund_id = r.id AND c.category = reason_category
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
    ORDER BY r.request_date DESC, r.created_at DESC
    LIMIT page_size
    OFFSET page_offset
  ) t;

  RETURN jsonb_build_object('total_count', v_total, 'rows', v_rows);
END;
$function$;

NOTIFY pgrst, 'reload schema';
