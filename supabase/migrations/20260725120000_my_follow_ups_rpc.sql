-- RPC my_follow_ups(): carrega, numa ÚNICA chamada, todos os follow-ups visíveis
-- ao agente logado, retornando um único valor jsonb (array de linhas).
--
-- Motivação (bug reportado + incidente 24/07):
--   O cliente (useFollowUpsQuery) baixava TODO o histórico de follow-ups do agente
--   via paginação explícita (`.select('*').range()`, 1000/página → 5+ requisições
--   para contas pesadas). Cada página re-ordenava o conjunto inteiro (ORDER BY
--   recorded_at, id) sob RLS (Seq Scan por causa do OR), e OFFSETs profundos
--   re-classificavam tudo. Sob carga isso estourava o statement_timeout de 8s
--   (pg_stat_statements: média 1.4s, máx 8.0s, 144k chamadas).
--
--   Como o carregamento era "tudo-ou-nada" e o cliente caía silenciosamente para
--   `[]` quando qualquer página falhava, o mapa de follow-ups ficava vazio e TODO
--   ticket aparecia como "Novo" (Em Aberto), mesmo já tendo interações.
--
-- Por que jsonb num único registro:
--   * o PostgREST limita o nº de linhas por resposta (~1000) — a paginação existia
--     justamente por isso; retornando 1 linha (um jsonb) o limite deixa de importar
--     e não há truncamento de histórico;
--   * uma varredura ordenada única: ~60ms para o agente mais pesado (~5k linhas) e
--     ~300ms no pior caso view_all (tabela inteira, ~38k linhas) — bem abaixo dos 8s.
--
-- Visibilidade IDÊNTICA às policies de SELECT de service_follow_ups:
--   - próprios follow-ups (user_id = auth.uid())
--   - OU follow-ups de tickets que o agente detém hoje (services.current_owner_id)
--   - managers / can_view_all_tickets enxergam todos.
-- SECURITY DEFINER apenas para evitar a reavaliação cara do OR do RLS a cada linha;
-- a cláusula WHERE abaixo reproduz exatamente a mesma regra de visibilidade.

CREATE OR REPLACE FUNCTION public.my_follow_ups()
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

  IF v_view_all THEN
    SELECT jsonb_agg(t ORDER BY t.recorded_at, t.id)
      INTO v_result
    FROM public.service_follow_ups t;
  ELSE
    SELECT jsonb_agg(t ORDER BY t.recorded_at, t.id)
      INTO v_result
    FROM public.service_follow_ups t
    WHERE t.user_id = v_uid
       OR t.service_id IN (
            SELECT s.id FROM public.services s WHERE s.current_owner_id = v_uid
          );
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.my_follow_ups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_follow_ups() TO authenticated;

NOTIFY pgrst, 'reload schema';
