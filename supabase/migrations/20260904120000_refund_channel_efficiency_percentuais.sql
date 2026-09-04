-- Eficiência por canal (aba Reembolsos da gestora) passa a ser percentual.
--
-- Antes: by_channel_efficiency devolvia só volumes (partial_count / full_count)
-- e um efficiency_score (= % de parciais sobre os concluídos do canal).
-- Agora cada canal devolve também:
--   partial_rate  — taxa de conversão para parcial: parciais / concluídos do canal
--   full_rate     — taxa de conversão para integral: integrais / concluídos do canal
--   partial_share — % dos reembolsos parciais do período que vieram deste canal
--   full_share    — % dos reembolsos integrais do período que vieram deste canal
-- e a resposta ganha channel_efficiency_total (mesmos números somando todos os
-- canais), para a UI ter a linha "Todos os canais" sem calcular no cliente.
--
-- efficiency_score é mantido (igual a partial_rate) para o front em produção
-- continuar funcionando até o deploy da tela nova.
--
-- Regras preservadas da versão anterior: o bloco considera só reembolsos
-- concluídos (completion_date no período), respeita filtro de agente e de
-- produto e ignora de propósito status_filter e refund_type_filter — filtrar
-- por tipo faria a taxa degenerar em 0% ou 100%.

CREATE OR REPLACE FUNCTION public.dashboard_refund_metrics(from_date date, to_date date, agent_id text DEFAULT NULL::text, status_filter text DEFAULT NULL::text, refund_type_filter text DEFAULT NULL::text, product_filter text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_channel_efficiency_total jsonb;
  v_by_platform jsonb;
  v_by_reason jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

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

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_platform
  FROM (
    SELECT
      r.sales_platform AS name,
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
    GROUP BY r.sales_platform
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_reason
  FROM (
    SELECT
      c.category AS name,
      COUNT(*)::int AS value
    FROM public.refunds r
    JOIN public.refund_reason_classifications c ON c.refund_id = r.id
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
    GROUP BY c.category
  ) t;

  -- Eficiência por canal: só concluídos; ignora status_filter e
  -- refund_type_filter de propósito (ver cabeçalho da migration).
  -- Parcial = refund_type informado e diferente de '100%'; integral = '100%'.
  -- *_rate = dentro do canal (parcial + integral = 100% quando todo concluído
  -- tem tipo); *_share = fatia do canal no total de parciais/integrais do período.
  WITH por_canal AS (
    SELECT
      COALESCE(r.channel, 'Não informado') AS channel,
      COUNT(*)::int AS total_done,
      COUNT(*) FILTER (WHERE r.refund_type IS NOT NULL AND r.refund_type != '100%')::int AS partial_count,
      COUNT(*) FILTER (WHERE r.refund_type = '100%')::int AS full_count
    FROM public.refunds r
    WHERE r.completion_date IS NOT NULL
      AND r.completion_date::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY COALESCE(r.channel, 'Não informado')
  ),
  geral AS (
    SELECT
      COALESCE(SUM(total_done), 0)::int    AS total_done,
      COALESCE(SUM(partial_count), 0)::int AS partial_count,
      COALESCE(SUM(full_count), 0)::int    AS full_count
    FROM por_canal
  ),
  linhas AS (
    SELECT
      c.channel,
      c.total_done,
      c.partial_count,
      c.full_count,
      COALESCE(ROUND(c.partial_count::numeric / NULLIF(c.total_done, 0) * 100, 1), 0) AS partial_rate,
      COALESCE(ROUND(c.full_count::numeric    / NULLIF(c.total_done, 0) * 100, 1), 0) AS full_rate,
      COALESCE(ROUND(c.partial_count::numeric / NULLIF(g.partial_count, 0) * 100, 1), 0) AS partial_share,
      COALESCE(ROUND(c.full_count::numeric    / NULLIF(g.full_count, 0) * 100, 1), 0) AS full_share,
      -- compatibilidade com o front antigo (= partial_rate)
      COALESCE(ROUND(c.partial_count::numeric / NULLIF(c.total_done, 0) * 100, 1), 0) AS efficiency_score
    FROM por_canal c
    CROSS JOIN geral g
  )
  SELECT
    COALESCE(
      (SELECT jsonb_agg(row_to_json(l) ORDER BY l.partial_rate DESC, l.total_done DESC, l.channel ASC) FROM linhas l),
      '[]'::jsonb
    ),
    (
      SELECT jsonb_build_object(
        'total_done',    g.total_done,
        'partial_count', g.partial_count,
        'full_count',    g.full_count,
        'partial_rate',  COALESCE(ROUND(g.partial_count::numeric / NULLIF(g.total_done, 0) * 100, 1), 0),
        'full_rate',     COALESCE(ROUND(g.full_count::numeric    / NULLIF(g.total_done, 0) * 100, 1), 0)
      )
      FROM geral g
    )
  INTO v_by_channel_efficiency, v_channel_efficiency_total;

  RETURN jsonb_build_object(
    'total_count', COALESCE(v_total, 0),
    'open_count',  COALESCE(v_open, 0),
    'done_count',  COALESCE(v_done, 0),
    'by_agent',              v_by_agent,
    'by_status',             v_by_status,
    'by_refund_type',        v_by_refund_type,
    'by_product',            v_by_product,
    'by_channel',            v_by_channel,
    'by_platform',           v_by_platform,
    'by_reason',             v_by_reason,
    'by_channel_efficiency', v_by_channel_efficiency,
    'channel_efficiency_total', v_channel_efficiency_total
  );
END;
$function$;
