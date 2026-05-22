-- Flag por agente para pular o TransferTicketDialog quando o e-mail do cliente
-- já tem ticket aberto com OUTRO agente. Quando true, o agente cria um novo ticket
-- próprio mesmo havendo duplicidade cross-agent.
--
-- Não altera RLS: o bypass é puramente de UX no front (createMutation em
-- src/pages/agent/Atendimentos.tsx ignora o resultado "other_agent" da RPC
-- find_ticket_by_email quando esta flag está true).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_register_duplicate_emails boolean NOT NULL DEFAULT false;
