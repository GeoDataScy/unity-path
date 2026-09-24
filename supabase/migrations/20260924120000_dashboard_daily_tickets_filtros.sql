-- Visão Geral Atendimentos: filtros de PLATAFORMA e PRODUTO no gráfico de
-- tickets abertos × concluídos.
--
-- As regras de contagem são as de 20260923130000_dashboard_daily_tickets.sql,
-- sem mudança: ticket (não interação), aberto pelo `service_date`, concluído
-- pela última interação que vale hoje, agente = dono do ticket. O que muda:
--
--   * `platform_filter` / `product_filter` recortam os tickets pelo que está
--     gravado em `services.platform` / `services.product`. NULL = todos.
--     '__sem__' = ticket sem valor gravado (há ~26 mil tickets antigos com
--     plataforma NULL; "Nenhum" é outra coisa — foi o agente que escolheu).
--   * A resposta traz `platforms` e `products`: os valores que aparecem nos
--     tickets do período (abertos OU concluídos nele) para o agente filtrado.
--     As opções dependem só de período + agente, nunca dos próprios filtros —
--     escolher uma plataforma não pode fazer as outras sumirem da lista.
--     Vêm do banco, e não do catálogo do front, porque o histórico tem valores
--     que o catálogo não tem mais.
--
-- A assinatura de 3 argumentos é removida: com as duas versões no banco, a
-- chamada nomeada do PostgREST com 3 argumentos ficaria ambígua. O front que
-- ainda estiver no ar manda só os 3 e cai nos DEFAULT NULL desta aqui.
DROP FUNCTION IF EXISTS public.dashboard_daily_tickets(date, date, text);

CREATE OR REPLACE FUNCTION public.dashboard_daily_tickets(
  from_date      date,
  to_date        date,
  agent_id       text DEFAULT NULL::text,
  platform_filter text DEFAULT NULL::text,
  product_filter  text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agent    text;
  v_platform text;
  v_product  text;
  v_result   jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- O front manda 'all' quando o filtro está em "Todos".
  v_agent    := NULLIF(NULLIF(agent_id, 'all'), '');
  v_platform := NULLIF(NULLIF(platform_filter, 'all'), '');
  v_product  := NULLIF(NULLIF(product_filter, 'all'), '');

  WITH dias AS (
    SELECT d::date AS day
    FROM generate_series(from_date, to_date, interval '1 day') d
  ),
  -- Os dois CTEs abaixo ainda NÃO aplicam plataforma/produto: são também a
  -- base das opções dos filtros. O recorte acontece na contagem.
  aberturas AS (
    SELECT s.platform, s.product,
           (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (v_agent IS NULL OR s.user_id::text = v_agent)
  ),
  fechamentos AS (
    -- Por interação: a última interação do ticket é 'concluido' e caiu no período.
    SELECT s.platform, s.product,
           (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date AS day
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE f.status = 'concluido'
      AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (v_agent IS NULL OR s.user_id::text = v_agent)
      AND NOT EXISTS (
        SELECT 1 FROM public.service_follow_ups f2
        WHERE f2.service_id = f.service_id
          AND f2.follow_up_number > f.follow_up_number
      )
    UNION ALL
    -- Direto: concluído na própria abertura, sem follow-up.
    SELECT s.platform, s.product,
           (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day
    FROM public.services s
    WHERE s.status = 'concluido'
      AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (v_agent IS NULL OR s.user_id::text = v_agent)
      AND NOT EXISTS (
        SELECT 1 FROM public.service_follow_ups f WHERE f.service_id = s.id
      )
  ),
  -- Mesmo predicado para os dois lados: NULL = todos, '__sem__' = vazio.
  abertos AS (
    SELECT day, COUNT(*)::int AS qtd
    FROM aberturas
    WHERE (v_platform IS NULL
           OR (v_platform = '__sem__' AND NULLIF(btrim(platform), '') IS NULL)
           OR platform = v_platform)
      AND (v_product IS NULL
           OR (v_product = '__sem__' AND NULLIF(btrim(product), '') IS NULL)
           OR product = v_product)
    GROUP BY 1
  ),
  fechados AS (
    SELECT day, COUNT(*)::int AS qtd
    FROM fechamentos
    WHERE (v_platform IS NULL
           OR (v_platform = '__sem__' AND NULLIF(btrim(platform), '') IS NULL)
           OR platform = v_platform)
      AND (v_product IS NULL
           OR (v_product = '__sem__' AND NULLIF(btrim(product), '') IS NULL)
           OR product = v_product)
    GROUP BY 1
  ),
  serie AS (
    SELECT d.day, COALESCE(a.qtd, 0) AS opened, COALESCE(fe.qtd, 0) AS closed
    FROM dias d
    LEFT JOIN abertos  a  ON a.day  = d.day
    LEFT JOIN fechados fe ON fe.day = d.day
  ),
  universo AS (
    SELECT platform, product FROM aberturas
    UNION ALL
    SELECT platform, product FROM fechamentos
  )
  SELECT jsonb_build_object(
    'by_day', COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'day',    to_char(day, 'YYYY-MM-DD'),
                  'opened', opened,
                  'closed', closed
                )
                ORDER BY day)
       FROM serie),
      '[]'::jsonb),
    'total_opened', COALESCE((SELECT SUM(opened)::int FROM serie), 0),
    'total_closed', COALESCE((SELECT SUM(closed)::int FROM serie), 0),
    -- Ordem alfabética sem caixa; o "sem valor" vai para o fim.
    'platforms', COALESCE(
      (SELECT jsonb_agg(v ORDER BY v = '__sem__', lower(v))
       FROM (SELECT DISTINCT COALESCE(NULLIF(btrim(platform), ''), '__sem__') AS v FROM universo) x),
      '[]'::jsonb),
    'products', COALESCE(
      (SELECT jsonb_agg(v ORDER BY v = '__sem__', lower(v))
       FROM (SELECT DISTINCT COALESCE(NULLIF(btrim(product), ''), '__sem__') AS v FROM universo) x),
      '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.dashboard_daily_tickets(date, date, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_daily_tickets(date, date, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.dashboard_daily_tickets(date, date, text, text, text) IS
  'Visão Geral Atendimentos: tickets abertos e concluídos por dia no período, com filtro opcional de plataforma e produto. Conta TICKET, não interação — follow-up não entra.';
