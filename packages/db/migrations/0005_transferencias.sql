-- =====================================================================
-- 0005_transferencias.sql — pedidos de transferência e de tomada de ticket.
--
-- São dois fluxos parecidos e distintos, e o legado já os separa:
--
--   TRANSFERÊNCIA  o agente que atendeu pede que o DONO ORIGINAL continue.
--                  O ticket nunca troca de dono: `to_user_id` é quem já
--                  era dono e está sendo chamado de volta.
--
--   TOMADA         o dono está de folga e outro agente pede autorização
--                  da gestora para assumir. Aí sim o dono muda.
--
-- O unificador é a notificação: hoje são três sinos com três consultas
-- repetindo a cada 30 segundos. Vira uma tabela e um canal.
-- =====================================================================

CREATE TYPE core.request_status AS ENUM ('pending', 'accepted', 'declined', 'cancelled');

-- ---------------------------------------------------------------------
-- Transferências
-- ---------------------------------------------------------------------

CREATE TABLE core.ticket_transfers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id              uuid NOT NULL REFERENCES core.tickets(id) ON DELETE CASCADE,
  from_user_id           uuid NOT NULL REFERENCES core.users(id),
  to_user_id             uuid NOT NULL REFERENCES core.users(id),
  status                 core.request_status NOT NULL DEFAULT 'pending',
  message                text,
  response_note          text,
  responded_at           timestamptz,
  recipient_seen_at      timestamptz,
  requester_seen_at      timestamptz,
  assigned_by_manager_id uuid REFERENCES core.users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  legacy_id              text UNIQUE,

  CONSTRAINT transfers_not_self CHECK (from_user_id <> to_user_id),
  CONSTRAINT transfers_responded_has_status
    CHECK (status = 'pending' OR responded_at IS NOT NULL OR legacy_id IS NOT NULL)
);

-- Um pedido pendente por par. Constraint, não código: hoje a corrida
-- entre duas abas depende de o cliente checar antes de gravar.
CREATE UNIQUE INDEX transfers_one_pending_per_pair
  ON core.ticket_transfers (ticket_id, from_user_id) WHERE status = 'pending';

CREATE INDEX transfers_to_user_idx   ON core.ticket_transfers (to_user_id, status, created_at DESC);
CREATE INDEX transfers_from_user_idx ON core.ticket_transfers (from_user_id, status, created_at DESC);
CREATE INDEX transfers_ticket_idx    ON core.ticket_transfers (ticket_id);

-- ---------------------------------------------------------------------
-- Tomada de ticket
-- ---------------------------------------------------------------------

CREATE TABLE core.ticket_takeovers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    uuid NOT NULL REFERENCES core.tickets(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES core.users(id),
  owner_id     uuid REFERENCES core.users(id),
  status       core.request_status NOT NULL DEFAULT 'pending',
  note         text,
  responded_at timestamptz,
  responded_by uuid REFERENCES core.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  legacy_id    text UNIQUE
);

CREATE UNIQUE INDEX takeovers_one_pending_per_pair
  ON core.ticket_takeovers (ticket_id, requester_id) WHERE status = 'pending';

CREATE INDEX takeovers_pending_idx   ON core.ticket_takeovers (status, created_at DESC)
                                     WHERE status = 'pending';
CREATE INDEX takeovers_requester_idx ON core.ticket_takeovers (requester_id, status, created_at DESC);

-- ---------------------------------------------------------------------
-- Notificações — um sino, uma tabela, um canal
--
-- Hoje são três consultas repetindo a cada 30 segundos por aba: sino de
-- transferência do agente, sino de aprovação da gestora e alerta de
-- reembolso. Somadas às duas de sessão, dão 8 a 14 chamadas por minuto
-- por aba aberta.
--
-- Aqui a API grava a linha e publica no canal do usuário. O sino assina
-- uma vez e nunca mais pergunta.
-- ---------------------------------------------------------------------

CREATE TYPE core.notification_kind AS ENUM (
  'transfer_requested', 'transfer_accepted', 'transfer_declined',
  'takeover_requested', 'takeover_approved', 'takeover_rejected',
  'refund_overdue'
);

CREATE TABLE core.notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  kind        core.notification_kind NOT NULL,
  /* o que a tela precisa para desenhar a linha sem ir buscar mais nada */
  payload     jsonb NOT NULL,
  ticket_id   uuid REFERENCES core.tickets(id) ON DELETE CASCADE,
  seen_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- O sino só pergunta pelas não vistas: índice parcial serve exatamente isso.
CREATE INDEX notifications_unseen_idx
  ON core.notifications (user_id, created_at DESC) WHERE seen_at IS NULL;
CREATE INDEX notifications_user_idx ON core.notifications (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON core.ticket_transfers, core.ticket_takeovers, core.notifications TO api_request;
GRANT USAGE, SELECT ON SEQUENCE core.notifications_id_seq TO api_request;
