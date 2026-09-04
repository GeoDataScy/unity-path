-- Auditoria (reembolsos) passa a usar a MESMA regra de período das métricas.
--
-- Sintoma relatado (27/08/2026): filtro 24/08–27/08 com status "Concluídos" mostrava
-- 58 no card e apenas 7 registros na tabela de auditoria.
--
-- Causa: a migration 20260430090000 corrigiu a regra de data só em
-- dashboard_refund_metrics. O dashboard_refund_audit continuou filtrando sempre por
-- request_date, então descartava todo reembolso pedido antes do período e baixado
-- dentro dele — 51 casos no intervalo acima (pedidos de junho/julho baixados entre
-- 24 e 27/08). Com status "Em aberto" as duas regras coincidem e os números batiam,
-- o que escondeu o problema.
--
-- Regra única (idêntica à de dashboard_refund_metrics):
--   Em aberto  (completion_date IS NULL)     → filtra por request_date
--   Concluído  (completion_date IS NOT NULL) → filtra por completion_date
--
-- Também ordena pela data que colocou a linha no período (COALESCE(completion_date,
-- request_date)) em vez de request_date puro: senão os reembolsos antigos recém
-- baixados afundariam para as últimas páginas.
--
-- Obs.: a versão que rodava em produção nunca esteve no repo (os arquivos só tinham a
-- variante antiga com agent_id uuid, derrubada por 20260506100000). Esta migration
-- passa a ser a fonte de verdade da função.

CREATE OR REPLACE FUNCTION public.dashboard_refund_audit(
  from_date date,
  to_date date,
  agent_id text DEFAULT NULL::text,
  status_filter text DEFAULT NULL::text,
  refund_type_filter text DEFAULT NULL::text,
  product_filter text DEFAULT NULL::text,
  page_size integer DEFAULT 25,
  page_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text;
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF agent_id IS NOT NULL AND agent_id != '' THEN
    v_uid := agent_id;
  END IF;

  IF page_size IS NULL OR page_size < 1 THEN page_size := 25; END IF;
  IF page_size > 200 THEN page_size := 200; END IF;
  IF page_offset IS NULL OR page_offset < 0 THEN page_offset := 0; END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.refunds r
  WHERE (
    (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
    OR
    (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
  )
    AND (v_uid IS NULL OR r.user_id = v_uid)
    AND (status_filter IS NULL OR status_filter = 'all'
      OR (status_filter = 'open' AND r.completion_date IS NULL)
      OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
    AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
      OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
      OR r.refund_type = refund_type_filter)
    AND (product_filter IS NULL OR product_filter = 'all'
      OR (product_filter = 'null' AND r.product IS NULL)
      OR r.product = product_filter);

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT r.id, r.created_at, r.user_id, r.customer_email, r.request_date,
      r.completion_date, r.sales_platform, r.order_id, r.refund_type,
      r.reason, r.items_returned, r.product, r.channel,
      jsonb_build_object('full_name', p.full_name) AS profiles
    FROM public.refunds r LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE (
      (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
      OR
      (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
    )
      AND (v_uid IS NULL OR r.user_id = v_uid)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    ORDER BY COALESCE(r.completion_date, r.request_date)::date DESC, r.created_at DESC
    LIMIT page_size OFFSET page_offset
  ) t;

  RETURN jsonb_build_object('total_count', v_total, 'rows', v_rows);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_refund_audit(date, date, text, text, text, text, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
