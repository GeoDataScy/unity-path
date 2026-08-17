-- Índices de performance — incidente de 2026-07-24
-- Contexto: o banco de produção (t4g.micro) ficou Unhealthy / 0% success por
-- sobrecarga de CPU. Poucas queries chamadas 100k+ vezes faziam varredura de
-- tabela sem índice (ver pg_stat_statements). Estes índices atacam as queries
-- mais quentes identificadas.
--
-- Já aplicados em produção em 2026-07-24 via CREATE INDEX CONCURRENTLY (fora de
-- transação, sem lock de escrita). Aqui usamos IF NOT EXISTS sem CONCURRENTLY
-- para serem idempotentes e seguros dentro do runner de migrations.

-- "Meus Atendimentos" e afins: SELECT ... FROM services WHERE user_id = $1 ORDER BY created_at DESC
-- Antes: seq scan de ~80k linhas + sort (552–2574 ms). Depois: index scan (~0,3 ms).
CREATE INDEX IF NOT EXISTS idx_services_user_id_created_at
  ON public.services (user_id, created_at DESC);

-- Busca de ticket por e-mail: find_ticket_by_email() usa LOWER(TRIM(client_email)) = LOWER(TRIM($1))
-- Índice de expressão para casar exatamente com o predicado.
CREATE INDEX IF NOT EXISTS idx_services_lower_trim_email
  ON public.services (LOWER(TRIM(client_email)));

-- Follow-ups do agente: a query campeã (34,7% da carga) ordena por follow_up_number
-- filtrando por usuário via RLS. Índice composto para o caso "linhas do próprio agente".
-- (O ganho pleno para managers/can_view_all depende também de otimizar as políticas RLS.)
CREATE INDEX IF NOT EXISTS idx_service_follow_ups_user_followup
  ON public.service_follow_ups (user_id, follow_up_number);

-- Reembolsos do agente: RPC my_refunds_with_refunded_value() filtra por user_id.
CREATE INDEX IF NOT EXISTS idx_refunds_user_id
  ON public.refunds (user_id);
