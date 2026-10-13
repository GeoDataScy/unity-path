-- Ajuste 6 do Jurídico: as exportações da gestora que levam dado pessoal de
-- cliente também passam a deixar registro (quem, quando, período e filtros).
-- • relatorio_gestora — relatório Excel do topo do painel (aba "Motivos
--   descritos" tem o e-mail do cliente);
-- • motivo_reembolso  — detalhe de "Motivos de reembolso" (e-mail e pedido);
-- • pedidos_espera    — página de Pedidos em Espera da gestora (e-mail e pedido).
-- O registro é gravado pelo front antes de gerar o arquivo, via
-- log_client_data_export (que já exige role manager).
ALTER TABLE public.client_data_export_log
  DROP CONSTRAINT IF EXISTS client_data_export_log_screen_check;

ALTER TABLE public.client_data_export_log
  ADD CONSTRAINT client_data_export_log_screen_check
  CHECK (screen IN ('atendimentos', 'radar', 'relatorio_gestora', 'motivo_reembolso', 'pedidos_espera'));
