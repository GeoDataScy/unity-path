-- Otimização de RLS: envolver funções auxiliares em subselect escalar (InitPlan).
--
-- PROBLEMA
-- Quando uma função STABLE é chamada "nua" dentro da expressão de uma policy,
-- o Postgres NÃO consegue promovê-la a InitPlan: ela é reavaliada UMA VEZ POR
-- LINHA varrida. Como is_manager() -> has_role() lê user_roles e
-- can_view_all_tickets() lê profiles, cada linha de `services` varrida disparava
-- um scan nessas duas tabelas. O mesmo vale para auth.uid(), que também é STABLE.
--
-- Medido em produção (pg_stat_user_tables, janela de 156 dias):
--     user_roles :    33 linhas ->  5.960.838.037 seq scans
--     profiles   :    33 linhas ->  3.007.001.769 seq scans
--     services   : 81.826 linhas ->    2.147.501 seq scans (46.522 linhas/scan)
--
-- Nove bilhões de varreduras em tabelas de 33 linhas: é a maior fonte de queima
-- de CPU do banco e a causa direta do incidente de 24/07/2026 (t4g.micro
-- Unhealthy / 0% success).
--
-- SOLUÇÃO
-- Envolver cada chamada em `(SELECT ...)`. O planner passa a materializá-la como
-- InitPlan, avaliada UMA vez por query. Prova via EXPLAIN em produção:
--
--   -- nua
--   Filter: (can_view_all_tickets() OR (current_owner_id = 'x'))
--   cost=22807.29
--
--   -- envolvida
--   InitPlan 1
--     ->  Result (actual rows=1 loops=1)
--   Filter: ((InitPlan 1).col1 OR (current_owner_id = 'x'))
--   cost=2566.09          <-- 8,9x mais barato
--
-- SEMÂNTICA INALTERADA
-- `(SELECT f())` devolve exatamente o mesmo valor de `f()`. Nenhuma policy muda
-- de regra: quem via, continua vendo; quem não via, continua sem ver. A única
-- diferença é quantas vezes a função roda. Todas as 47 policies do schema public
-- são recriadas aqui — nenhuma tinha o wrap.
--
-- Referência: https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices

-- ============================================================================
-- services
-- ============================================================================
DROP POLICY IF EXISTS "Agents view own services" ON public.services;
CREATE POLICY "Agents view own services" ON public.services
  FOR SELECT USING (current_owner_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Cross-agent view all services" ON public.services;
CREATE POLICY "Cross-agent view all services" ON public.services
  FOR SELECT USING ((SELECT public.can_view_all_tickets()));

DROP POLICY IF EXISTS "Managers view all services" ON public.services;
CREATE POLICY "Managers view all services" ON public.services
  FOR SELECT USING ((SELECT public.is_manager()));

DROP POLICY IF EXISTS "Agents insert own services" ON public.services;
CREATE POLICY "Agents insert own services" ON public.services
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Managers insert services" ON public.services;
CREATE POLICY "Managers insert services" ON public.services
  FOR INSERT WITH CHECK ((SELECT public.is_manager()));

DROP POLICY IF EXISTS "Agents update own services" ON public.services;
CREATE POLICY "Agents update own services" ON public.services
  FOR UPDATE USING (current_owner_id = (SELECT auth.uid())::text)
         WITH CHECK (current_owner_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Cross-agent update services" ON public.services;
CREATE POLICY "Cross-agent update services" ON public.services
  FOR UPDATE USING ((SELECT public.can_view_all_tickets()));

DROP POLICY IF EXISTS "Managers update services" ON public.services;
CREATE POLICY "Managers update services" ON public.services
  FOR UPDATE USING ((SELECT public.is_manager()));

DROP POLICY IF EXISTS "Agents delete own services" ON public.services;
CREATE POLICY "Agents delete own services" ON public.services
  FOR DELETE USING (current_owner_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Managers delete services" ON public.services;
CREATE POLICY "Managers delete services" ON public.services
  FOR DELETE USING ((SELECT public.is_manager()));

-- ============================================================================
-- service_follow_ups
-- ============================================================================
DROP POLICY IF EXISTS "Agents can read own follow-ups" ON public.service_follow_ups;
CREATE POLICY "Agents can read own follow-ups" ON public.service_follow_ups
  FOR SELECT USING (
    user_id = (SELECT auth.uid())::text
    OR EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = service_follow_ups.service_id
        AND s.current_owner_id = (SELECT auth.uid())::text
    )
  );

DROP POLICY IF EXISTS "Cross-agent read all follow-ups" ON public.service_follow_ups;
CREATE POLICY "Cross-agent read all follow-ups" ON public.service_follow_ups
  FOR SELECT USING ((SELECT public.can_view_all_tickets()));

DROP POLICY IF EXISTS "Managers can read all follow-ups" ON public.service_follow_ups;
CREATE POLICY "Managers can read all follow-ups" ON public.service_follow_ups
  FOR SELECT USING ((SELECT public.is_manager()));

DROP POLICY IF EXISTS "Agents can insert own follow-ups" ON public.service_follow_ups;
CREATE POLICY "Agents can insert own follow-ups" ON public.service_follow_ups
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid())::text);

-- ============================================================================
-- profiles
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING ((SELECT auth.uid())::text = id);

DROP POLICY IF EXISTS "Cross-agent view all profiles" ON public.profiles;
CREATE POLICY "Cross-agent view all profiles" ON public.profiles
  FOR SELECT USING ((SELECT public.can_view_all_tickets()));

DROP POLICY IF EXISTS "Managers can view all profiles" ON public.profiles;
CREATE POLICY "Managers can view all profiles" ON public.profiles
  FOR SELECT USING ((SELECT public.is_manager()));

-- ============================================================================
-- refunds
-- ============================================================================
DROP POLICY IF EXISTS "Users view own refunds" ON public.refunds;
CREATE POLICY "Users view own refunds" ON public.refunds
  FOR SELECT USING (user_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Managers view all refunds" ON public.refunds;
CREATE POLICY "Managers view all refunds" ON public.refunds
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT public.is_manager()));

DROP POLICY IF EXISTS "Users insert own refunds" ON public.refunds;
CREATE POLICY "Users insert own refunds" ON public.refunds
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Users update own refunds" ON public.refunds;
CREATE POLICY "Users update own refunds" ON public.refunds
  FOR UPDATE USING (user_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Users delete own refunds" ON public.refunds;
CREATE POLICY "Users delete own refunds" ON public.refunds
  FOR DELETE USING (user_id = (SELECT auth.uid())::text);

-- ============================================================================
-- ticket_transfers
-- ============================================================================
DROP POLICY IF EXISTS "Agents see own transfers" ON public.ticket_transfers;
CREATE POLICY "Agents see own transfers" ON public.ticket_transfers
  FOR SELECT USING (
    from_user_id = (SELECT auth.uid())::text OR to_user_id = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "Managers see all transfers" ON public.ticket_transfers;
CREATE POLICY "Managers see all transfers" ON public.ticket_transfers
  FOR SELECT USING ((SELECT public.is_manager()));

DROP POLICY IF EXISTS "Agents create transfers as sender" ON public.ticket_transfers;
CREATE POLICY "Agents create transfers as sender" ON public.ticket_transfers
  FOR INSERT WITH CHECK (from_user_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Agents update own transfers" ON public.ticket_transfers;
CREATE POLICY "Agents update own transfers" ON public.ticket_transfers
  FOR UPDATE USING (
    from_user_id = (SELECT auth.uid())::text OR to_user_id = (SELECT auth.uid())::text
  ) WITH CHECK (
    from_user_id = (SELECT auth.uid())::text OR to_user_id = (SELECT auth.uid())::text
  );

-- ============================================================================
-- ticket_takeover_requests
-- ============================================================================
DROP POLICY IF EXISTS "takeover_select" ON public.ticket_takeover_requests;
CREATE POLICY "takeover_select" ON public.ticket_takeover_requests
  FOR SELECT USING (
    requester_id = (SELECT auth.uid())::text OR (SELECT public.is_manager())
  );

-- ============================================================================
-- held_orders / held_order_events
-- ============================================================================
DROP POLICY IF EXISTS "held_orders_select" ON public.held_orders;
CREATE POLICY "held_orders_select" ON public.held_orders
  FOR SELECT USING (
    (SELECT auth.uid()) IS NOT NULL
    AND ((SELECT public.is_manager()) OR assigned_to = (SELECT auth.uid())::text)
  );

DROP POLICY IF EXISTS "held_order_events_select" ON public.held_order_events;
CREATE POLICY "held_order_events_select" ON public.held_order_events
  FOR SELECT USING (
    (SELECT auth.uid()) IS NOT NULL
    AND (
      (SELECT public.is_manager())
      OR EXISTS (
        SELECT 1 FROM public.held_orders o
        WHERE o.id = held_order_events.order_id
          AND o.assigned_to = (SELECT auth.uid())::text
      )
    )
  );

-- ============================================================================
-- agent_daily_service_counts
-- ============================================================================
DROP POLICY IF EXISTS "Users view own counts" ON public.agent_daily_service_counts;
CREATE POLICY "Users view own counts" ON public.agent_daily_service_counts
  FOR SELECT USING (user_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Managers view all counts" ON public.agent_daily_service_counts;
CREATE POLICY "Managers view all counts" ON public.agent_daily_service_counts
  FOR SELECT USING ((SELECT public.is_manager()));

-- ============================================================================
-- auth_events
-- ============================================================================
DROP POLICY IF EXISTS "users read own auth events" ON public.auth_events;
CREATE POLICY "users read own auth events" ON public.auth_events
  FOR SELECT USING (user_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "managers read all auth events" ON public.auth_events;
CREATE POLICY "managers read all auth events" ON public.auth_events
  FOR SELECT USING ((SELECT public.is_manager()));

-- ============================================================================
-- agent_heartbeats
-- ============================================================================
DROP POLICY IF EXISTS "managers read all heartbeats" ON public.agent_heartbeats;
CREATE POLICY "managers read all heartbeats" ON public.agent_heartbeats
  FOR SELECT USING ((SELECT public.is_manager()));

-- ============================================================================
-- refund_reason_classifications
-- ============================================================================
DROP POLICY IF EXISTS "managers can read refund reason classifications" ON public.refund_reason_classifications;
CREATE POLICY "managers can read refund reason classifications" ON public.refund_reason_classifications
  FOR SELECT USING ((SELECT public.is_manager()));

-- ============================================================================
-- service_date_corrections
-- ============================================================================
DROP POLICY IF EXISTS "Managers read corrections" ON public.service_date_corrections;
CREATE POLICY "Managers read corrections" ON public.service_date_corrections
  FOR SELECT USING ((SELECT public.is_manager()));

DROP POLICY IF EXISTS "Managers insert corrections" ON public.service_date_corrections;
CREATE POLICY "Managers insert corrections" ON public.service_date_corrections
  FOR INSERT WITH CHECK ((SELECT public.is_manager()));

-- ============================================================================
-- training_video_views
-- ============================================================================
-- Atenção: training_video_views.user_id é uuid (sem cast ::text), diferente das
-- outras tabelas do schema. Mantido como está.
DROP POLICY IF EXISTS "Agents can read own training views" ON public.training_video_views;
CREATE POLICY "Agents can read own training views" ON public.training_video_views
  FOR SELECT USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Managers can read all training views" ON public.training_video_views;
CREATE POLICY "Managers can read all training views" ON public.training_video_views
  FOR SELECT USING ((SELECT public.is_manager()));

DROP POLICY IF EXISTS "Agents can insert own training views" ON public.training_video_views;
CREATE POLICY "Agents can insert own training views" ON public.training_video_views
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Agents can update own training views" ON public.training_video_views;
CREATE POLICY "Agents can update own training views" ON public.training_video_views
  FOR UPDATE USING (user_id = (SELECT auth.uid()))
         WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================================================
-- training_videos / products / goals  (policies FOR ALL de gestor)
-- ============================================================================
DROP POLICY IF EXISTS "Managers can manage training videos" ON public.training_videos;
CREATE POLICY "Managers can manage training videos" ON public.training_videos
  FOR ALL USING ((SELECT public.is_manager()))
          WITH CHECK ((SELECT public.is_manager()));

DROP POLICY IF EXISTS "Managers can manage products" ON public.products;
CREATE POLICY "Managers can manage products" ON public.products
  FOR ALL USING ((SELECT public.is_manager()));

DROP POLICY IF EXISTS "Managers can manage goals" ON public.goals;
CREATE POLICY "Managers can manage goals" ON public.goals
  FOR ALL USING ((SELECT public.is_manager()));

NOTIFY pgrst, 'reload schema';
