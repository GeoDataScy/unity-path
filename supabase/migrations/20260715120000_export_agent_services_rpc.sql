-- Exportação de atendimentos do agente para planilha (Excel).
--
-- Devolve, num único JSON, tudo que o agente precisa para gerar o relatório
-- de atendimentos de um período: os tickets (com nome do agente criador/dono e
-- métricas derivadas) e o histórico completo de interações (follow-ups) desses
-- tickets. Espelha a regra de visibilidade da my_recent_services:
--   - gestor / supervisor (is_manager() OR can_view_all_tickets()) → vê todos;
--   - demais agentes → apenas os tickets sob sua propriedade atual.
--
-- SECURITY DEFINER: necessário para o histórico completo de tickets
-- redistribuídos (o follow-up pode ter sido registrado por outro agente).
--
-- Um ticket entra no período quando a data de abertura (service_date) cai no
-- intervalo OU quando teve alguma interação (follow-up) registrada no intervalo
-- — mesma lógica da tela "Meus Atendimentos".

CREATE OR REPLACE FUNCTION public.export_agent_services(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid      text;
  v_view_all boolean;
  v_result   jsonb;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  v_view_all := public.is_manager() OR public.can_view_all_tickets();

  WITH visible AS (
    SELECT s.*
    FROM public.services s
    WHERE (v_view_all OR s.current_owner_id = v_uid)
      AND (
        -- Aberto dentro do período (compara a parte de data, ISO ordena lexicograficamente)
        left(s.service_date, 10) BETWEEN to_char(p_from, 'YYYY-MM-DD') AND to_char(p_to, 'YYYY-MM-DD')
        -- Ou teve follow-up dentro do período (pega tickets antigos redistribuídos)
        OR EXISTS (
          SELECT 1
          FROM public.service_follow_ups f
          WHERE f.service_id = s.id
            AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_from AND p_to
        )
      )
  ),
  ticket_rows AS (
    SELECT
      s.id,
      s.client_email,
      s.service_date,
      s.product,
      s.platform,
      s.channel,
      s.status,
      s.created_at,
      s.has_tracking_code,
      s.contact_reason,
      s.user_id,
      s.current_owner_id,
      creator.full_name AS creator_name,
      owner.full_name   AS owner_name,
      (SELECT count(*)
         FROM public.service_follow_ups f
        WHERE f.service_id = s.id) AS follow_up_count,
      (SELECT max(f.recorded_at)
         FROM public.service_follow_ups f
        WHERE f.service_id = s.id) AS last_interaction_at,
      (SELECT f.status
         FROM public.service_follow_ups f
        WHERE f.service_id = s.id
        ORDER BY f.recorded_at DESC, f.id DESC
        LIMIT 1) AS last_follow_up_status
    FROM visible s
    LEFT JOIN public.profiles creator ON creator.id::text = s.user_id
    LEFT JOIN public.profiles owner   ON owner.id::text   = s.current_owner_id
  )
  SELECT jsonb_build_object(
    'tickets', COALESCE(
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC NULLS LAST)
         FROM ticket_rows t),
      '[]'::jsonb
    ),
    'follow_ups', COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'service_id',       f.service_id,
                  'client_email',     v.client_email,
                  'follow_up_number', f.follow_up_number,
                  'status',           f.status,
                  'observation',      f.observation,
                  'recorded_at',      f.recorded_at,
                  'user_id',          f.user_id,
                  'agent_name',       p.full_name
                )
                ORDER BY v.client_email, f.recorded_at, f.id
              )
         FROM public.service_follow_ups f
         JOIN visible v ON v.id = f.service_id
         LEFT JOIN public.profiles p ON p.id::text = f.user_id),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.export_agent_services(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_agent_services(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
