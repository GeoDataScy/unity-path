-- Visão Geral Atendimentos: tickets ABERTOS e CONCLUÍDOS por dia.
--
-- Este recorte não é o mesmo das outras telas de Atendimentos. Lá a unidade é a
-- INTERAÇÃO (abertura + follow-ups), porque a pergunta é "quanto cada agente
-- trabalhou". Aqui a unidade é o TICKET e a pergunta é operacional: quantos
-- chamados entraram no dia e quantos foram fechados. Follow-up não conta como
-- atendimento novo — um ticket com cinco retornos entra uma vez só, no dia em
-- que nasceu.
--
-- Regras:
--   * ABERTO no dia D  = `services.service_date` cai em D (dia de São Paulo, a
--     mesma régua de _interaction_events e dashboard_status_summary).
--   * CONCLUÍDO no dia D = o ticket está fechado HOJE e o fechamento aconteceu
--     em D. Fechado é o que dashboard_status_summary já chama de 'concluido':
--     a ÚLTIMA interação tem status 'concluido', ou o ticket não tem interação
--     nenhuma e `services.status` = 'concluido'. Olhar só a última interação é
--     o que impede um ticket reaberto e fechado de novo de contar duas vezes —
--     ele conta uma vez, no dia do fechamento que vale.
--   * Os dois recortes são independentes: um ticket aberto antes do período e
--     fechado dentro dele aparece só em "concluídos". É o comportamento certo
--     para ler backlog, e por isso as duas barras não somam entre si.
--   * O filtro de agente é o DONO do ticket (`services.user_id`), inclusive na
--     conclusão registrada por outra pessoa — senão o mesmo ticket mudaria de
--     coluna conforme quem clicou.
--
-- A série vem com o período completo, dia a dia: dia sem movimento volta como
-- zero em vez de sumir, para o gráfico não mentir sobre fim de semana e feriado.
CREATE OR REPLACE FUNCTION public.dashboard_daily_tickets(
  from_date date,
  to_date   date,
  agent_id  text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agent   text;
  v_rows    jsonb;
  v_abertos int;
  v_fechados int;
BEGIN
  IF NOT public.can_view_support_analytics() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- O front manda 'all' quando o filtro está em "Todos os agentes".
  v_agent := NULLIF(NULLIF(agent_id, 'all'), '');

  WITH dias AS (
    SELECT d::date AS day
    FROM generate_series(from_date, to_date, interval '1 day') d
  ),
  abertos AS (
    SELECT (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*)::int AS qtd
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (v_agent IS NULL OR s.user_id::text = v_agent)
    GROUP BY 1
  ),
  -- Fechamento por interação: a última interação do ticket é 'concluido' e caiu
  -- dentro do período. O NOT EXISTS é o "última" — filtrar o período antes de
  -- procurar a seguinte mantém a varredura no tamanho do período.
  fechados_por_interacao AS (
    SELECT (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*)::int AS qtd
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
    GROUP BY 1
  ),
  -- Fechamento direto: o agente concluiu na própria abertura, sem follow-up.
  -- O dia do fechamento é o da abertura — é o único carimbo que existe.
  fechados_direto AS (
    SELECT (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*)::int AS qtd
    FROM public.services s
    WHERE s.status = 'concluido'
      AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (v_agent IS NULL OR s.user_id::text = v_agent)
      AND NOT EXISTS (
        SELECT 1 FROM public.service_follow_ups f WHERE f.service_id = s.id
      )
    GROUP BY 1
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'day',    to_char(d.day, 'YYYY-MM-DD'),
          'opened', COALESCE(a.qtd, 0),
          'closed', COALESCE(fi.qtd, 0) + COALESCE(fd.qtd, 0)
        )
        ORDER BY d.day
      ),
      '[]'::jsonb
    ),
    COALESCE(SUM(COALESCE(a.qtd, 0))::int, 0),
    COALESCE(SUM(COALESCE(fi.qtd, 0) + COALESCE(fd.qtd, 0))::int, 0)
  INTO v_rows, v_abertos, v_fechados
  FROM dias d
  LEFT JOIN abertos                a  ON a.day  = d.day
  LEFT JOIN fechados_por_interacao fi ON fi.day = d.day
  LEFT JOIN fechados_direto        fd ON fd.day = d.day;

  RETURN jsonb_build_object(
    'by_day',       v_rows,
    'total_opened', COALESCE(v_abertos, 0),
    'total_closed', COALESCE(v_fechados, 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dashboard_daily_tickets(date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_daily_tickets(date, date, text) TO authenticated;

COMMENT ON FUNCTION public.dashboard_daily_tickets(date, date, text) IS
  'Visão Geral Atendimentos: tickets abertos e concluídos por dia no período. Conta TICKET, não interação — follow-up não entra.';
