-- Ajuste 6 do Jurídico, área de Produtos (opção A, decidida em 13/10/2026):
-- o time de produtos continua baixando a planilha completa do Late Hunter e
-- dos Pedidos em Espera (nome, e-mail, endereço, pedido), mas cada exportação
-- passa a deixar registro em client_data_export_log.
-- • late_hunter             — aba Late Hunter (/produtos);
-- • pedidos_espera_produtos — Pedidos em Espera da área de Produtos.

ALTER TABLE public.client_data_export_log
  DROP CONSTRAINT IF EXISTS client_data_export_log_screen_check;

ALTER TABLE public.client_data_export_log
  ADD CONSTRAINT client_data_export_log_screen_check
  CHECK (screen IN (
    'atendimentos', 'radar', 'relatorio_gestora', 'motivo_reembolso', 'pedidos_espera',
    'late_hunter', 'pedidos_espera_produtos'
  ));

-- A trava continua: manager registra (e exporta) qualquer tela; a role produto
-- só registra as duas telas da área dela. Prestador segue recusado.
CREATE OR REPLACE FUNCTION public.log_client_data_export(
  p_screen    text,
  p_row_count integer,
  p_filters   jsonb DEFAULT '{}'::jsonb,
  p_from      date  DEFAULT NULL,
  p_to        date  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT (
    public.can_export_full_client_data()
    OR (p_screen IN ('late_hunter', 'pedidos_espera_produtos') AND public.is_produtos_team())
  ) THEN
    RAISE EXCEPTION 'forbidden: exportação completa indisponível neste perfil';
  END IF;

  INSERT INTO public.client_data_export_log (user_id, screen, period_from, period_to, filters, row_count)
  VALUES (v_uid, p_screen, p_from, p_to, COALESCE(p_filters, '{}'::jsonb), COALESCE(p_row_count, 0));
END;
$$;

NOTIFY pgrst, 'reload schema';
