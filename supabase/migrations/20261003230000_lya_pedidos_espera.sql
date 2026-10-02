-- Lya: sandbox de leitura passa a enxergar os alertas de Inativo de Pedidos em
-- Espera (held_order_inactive_alerts, criada em 20261003150000 sem acesso para
-- ninguém além das RPCs). Mesmo padrão de 20260907120000_lya_agente_ia.sql:
-- GRANT SELECT + policy de leitura para a role lya_sql_ro.
-- held_orders.return_date (20261003120000) já está coberta pelo GRANT da tabela.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lya_sql_ro') THEN
    RAISE NOTICE 'lya_sql_ro não existe, pulando';
    RETURN;
  END IF;
  GRANT SELECT ON public.held_order_inactive_alerts TO lya_sql_ro;
  DROP POLICY IF EXISTS "lya_sql_ro read" ON public.held_order_inactive_alerts;
  CREATE POLICY "lya_sql_ro read" ON public.held_order_inactive_alerts FOR SELECT TO lya_sql_ro USING (true);
END $$;
