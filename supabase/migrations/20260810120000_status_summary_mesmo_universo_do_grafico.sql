-- Alinha dashboard_status_summary ao mesmo universo de tickets do gráfico
-- "Atendimentos por canal" / modal de detalhamento.
--
-- PROBLEMA (auditoria de 06/08/2026)
-- A gestora compara a tela com o Excel e os números não fecham:
--
--   tela  (modal Canal, 06/08) → 671 atendimentos, Email 411 (175 novos + 236 interações)
--   Excel (Visão Geral, 06/08) → 671 atendimentos, mas "Tickets novos 220 /
--                                em andamento 253 / finalizados 101" = 574 tickets
--
-- Parte da diferença é semântica e está resolvida no relatório (aba nova
-- "Canal — Detalhamento" + rótulos explícitos). Mas 36 tickets sumiam por um
-- motivo que não é semântico: o ramo de follow-ups de dashboard_status_summary
-- exigia `s.user_id::text = f.user_id`, ou seja, descartava toda interação feita
-- por um agente que não é o dono do ticket (transferência / tomada de ticket).
-- _interaction_events — que alimenta o total, o gráfico por canal e o modal —
-- nunca teve essa restrição e atribui o follow-up a quem registrou (f.user_id).
--
-- Medido em produção para 06/08/2026:
--   com a restrição : novo 220 / em_andamento 253 / concluído 101 = 574
--   sem a restrição : novo 220 / em_andamento 277 / concluído 113 = 610
--   (37 follow-ups em 36 tickets feitos por agente diferente do dono)
--
-- → removida a restrição. O filtro por agente passa a significar a mesma coisa
--   das demais métricas: "tickets que ESTE agente tocou no período", não
--   "tickets que este agente tocou E dos quais ele é o dono".
--
-- Reverter: reaplicar 20260428020000_dashboard_status_summary_include_followups.

CREATE OR REPLACE FUNCTION public.dashboard_status_summary(
  from_date date,
  to_date date,
  agent_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_novo         int;
  v_em_andamento int;
  v_concluido    int;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH services_in_range AS (
    -- Tickets ABERTOS no período (dia em São Paulo, como _interaction_events).
    SELECT DISTINCT s.id, s.status
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR s.user_id::text = agent_id)

    UNION

    -- Tickets com INTERAÇÃO no período, independentemente de quem é o dono.
    -- A interação é creditada a quem registrou (f.user_id) — mesma regra de
    -- _interaction_events, para que os dois recortes contem o mesmo universo.
    SELECT DISTINCT s.id, s.status
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR f.user_id = agent_id)
  ),
  last_followup AS (
    SELECT DISTINCT ON (service_id) service_id, status
    FROM public.service_follow_ups
    ORDER BY service_id, follow_up_number DESC
  ),
  classified AS (
    SELECT
      s.id,
      CASE
        WHEN lf.status = 'concluido' THEN 'concluido'
        WHEN s.status = 'concluido' AND lf.service_id IS NULL THEN 'concluido'
        WHEN lf.service_id IS NULL THEN 'novo'
        ELSE 'em_andamento'
      END AS status_label
    FROM services_in_range s
    LEFT JOIN last_followup lf ON lf.service_id = s.id
  )
  SELECT
    COUNT(*) FILTER (WHERE status_label = 'novo')::int,
    COUNT(*) FILTER (WHERE status_label = 'em_andamento')::int,
    COUNT(*) FILTER (WHERE status_label = 'concluido')::int
  INTO v_novo, v_em_andamento, v_concluido
  FROM classified;

  RETURN jsonb_build_object(
    'novo',         COALESCE(v_novo, 0),
    'em_andamento', COALESCE(v_em_andamento, 0),
    'concluido',    COALESCE(v_concluido, 0)
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
