-- =====================================================================
-- 0001_core.sql — núcleo do schema v2: catálogos, usuários, tickets,
-- interações e o estado materializado.
--
-- Especificação: docs/arquitetura-v2/12-backend-schema-alvo.md §3.1, §3.2
-- Garantias cobertas: G1.1, G1.2, G2.1, G2.4, G7.2, G9.1, G9.3, G9.4
--
-- Nasce no schema `core`, ao lado do `public` legado, que fica intocado.
-- Nenhuma tabela do legado é alterada ou removida por este arquivo.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS core;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------

-- [M1] Dois valores, não três. `'pendente'` era o default da coluna em
-- produção e tem ZERO linhas: default morto, nunca materializado.
CREATE TYPE core.ticket_status AS ENUM ('registered', 'concluido');

CREATE TYPE core.ticket_derived_status AS ENUM ('novo', 'em_andamento', 'concluido');

CREATE TYPE core.interaction_status AS ENUM ('em_andamento', 'concluido');

-- Cópia fiel dos 11 motivos de src/features/services/contact-reasons.ts.
CREATE TYPE core.contact_reason AS ENUM (
  'duvida_de_uso',
  'reembolso',
  'cancelamento_de_compra',
  'cancelamento_de_assinatura',
  'reclamacao_vsl',
  'troca_de_endereco',
  'embalagem_danificada',
  'duvida_de_envio',
  'ingredientes',
  'duvidas_geral',
  'outro'
);

-- [G9.3] "Não se aplica" e "não preenchido" são coisas diferentes e
-- precisam de significado nomeado, em vez de um texto disputando sentido
-- com um vazio. `misfiled` guarda dado fora de lugar: preservado e
-- visível como anomalia, em vez de rejeitado por enum ou escondido em
-- texto livre.
CREATE TYPE core.catalog_kind AS ENUM ('value', 'not_applicable', 'misfiled');

CREATE TYPE core.app_role AS ENUM ('agent', 'manager', 'copy_grup', 'produto');

-- ---------------------------------------------------------------------
-- Usuários
-- ---------------------------------------------------------------------

-- Sem FK para auth.users, deliberadamente. O legado perdeu essa FK e isso
-- SALVOU dados: dois agentes tiveram o login apagado e os perfis
-- sobreviveram, carregando 5.665 tickets, 2.617 interações e 302
-- reembolsos. O ON DELETE CASCADE original teria destruído tudo.
CREATE TABLE core.users (
  id                              uuid PRIMARY KEY,
  email                           citext NOT NULL UNIQUE,
  full_name                       text,
  role                            core.app_role NOT NULL,
  is_active                       boolean NOT NULL DEFAULT true,
  is_available                    boolean NOT NULL DEFAULT true,
  support_channel                 text,

  -- Capacidades: uma coluna por capacidade, nomeada pelo que libera.
  -- Nunca por cargo — não existe "supervisor" no código.
  can_view_all_tickets            boolean NOT NULL DEFAULT false,
  can_register_duplicate_emails   boolean NOT NULL DEFAULT false,
  can_claim_tickets               boolean NOT NULL DEFAULT false,
  can_approve_takeovers           boolean NOT NULL DEFAULT false,
  can_view_support_analytics       boolean NOT NULL DEFAULT false,

  deactivated_at                  timestamptz,
  deactivated_by                  uuid REFERENCES core.users(id),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),

  legacy_id                       text NOT NULL UNIQUE
);

CREATE INDEX users_active_idx ON core.users (is_active) WHERE is_active;

-- ---------------------------------------------------------------------
-- Catálogos  [G9.1, G9.2]
-- ---------------------------------------------------------------------

-- Hoje a lista de produtos existe em três arquivos do front e numa
-- restrição CHECK no banco, e produto novo exige migration. Aqui é uma
-- tabela: a tela lê dela, e acrescentar produto é INSERT.
CREATE TABLE core.products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  name_normalized citext GENERATED ALWAYS AS (lower(btrim(name))) STORED UNIQUE,
  is_selectable  boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- [M5] Dez valores no banco contra oito no seletor da tela. Um enum com a
-- lista da tela rejeitaria linhas reais, incluindo 143 de PagAmerican.
CREATE TABLE core.sales_platforms (
  id            smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  code          citext NOT NULL UNIQUE,
  label         text NOT NULL,
  kind          core.catalog_kind NOT NULL DEFAULT 'value',
  is_selectable boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0
);

-- [M4] Mesmo padrão. As 3.710 linhas de 'Clickbank' em canal de
-- atendimento entram como `misfiled`, não selecionável.
CREATE TABLE core.channels (
  id            smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  code          citext NOT NULL UNIQUE,
  label         text NOT NULL,
  kind          core.catalog_kind NOT NULL DEFAULT 'value',
  is_selectable boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0
);

-- Um catálogo `misfiled` nunca pode ser escolhido numa tela nova.
ALTER TABLE core.sales_platforms
  ADD CONSTRAINT sales_platforms_misfiled_not_selectable
  CHECK (kind <> 'misfiled' OR is_selectable = false);
ALTER TABLE core.channels
  ADD CONSTRAINT channels_misfiled_not_selectable
  CHECK (kind <> 'misfiled' OR is_selectable = false);

-- ---------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------

CREATE TABLE core.tickets (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  client_email            text NOT NULL,
  -- Guarda telefone quando o canal é SMS: 22.446 linhas do legado são
  -- telefone, não e-mail. O lookup usa a coluna normalizada.
  client_email_normalized citext GENERATED ALWAYS AS (lower(btrim(client_email))) STORED,

  -- `date`, não texto com formato por convenção. Dia em America/Sao_Paulo.
  business_day            date NOT NULL,

  product_id              uuid NOT NULL REFERENCES core.products(id),
  -- NULL = ninguém preencheu. A linha `not_applicable` = verifiquei, não há.
  platform_id             smallint REFERENCES core.sales_platforms(id),
  channel_id              smallint REFERENCES core.channels(id),

  contact_reason          core.contact_reason,
  contact_reason_note     text,
  order_id                text,
  has_tracking_code       boolean NOT NULL DEFAULT false,

  status                  core.ticket_status NOT NULL DEFAULT 'registered',

  creator_id              uuid NOT NULL REFERENCES core.users(id),
  current_owner_id        uuid NOT NULL REFERENCES core.users(id),
  takeover_approved_at    timestamptz,
  takeover_approved_by    uuid REFERENCES core.users(id),

  -- [G1.1] Estado materializado, escrito na MESMA transação da interação
  -- pelo trigger abaixo. Hoje isto é recalculado no browser a partir do
  -- histórico inteiro, o que baixa até 1,5 MB por agente e já produziu
  -- 10.115 tickets divergentes.
  derived_status          core.ticket_derived_status NOT NULL DEFAULT 'novo',
  interaction_count       integer NOT NULL DEFAULT 1,
  last_interaction_at     timestamptz,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  legacy_id               text UNIQUE,
  legacy_service_date     text,
  legacy_status           text,

  CONSTRAINT tickets_interaction_count_positive
    CHECK (interaction_count >= 1),

  -- Cópia fiel de services_contact_reason_note_check.
  CONSTRAINT tickets_contact_reason_note CHECK (
    CASE
      WHEN contact_reason = 'outro' THEN
        contact_reason_note IS NOT NULL
        AND btrim(contact_reason_note) <> ''
        AND char_length(btrim(contact_reason_note)) <= 200
      WHEN contact_reason = 'reclamacao_vsl' THEN
        contact_reason_note IS NULL
        OR (btrim(contact_reason_note) <> '' AND char_length(btrim(contact_reason_note)) <= 200)
      ELSE contact_reason_note IS NULL
    END
  )
);

-- A regra "reembolso exige número de pedido" NÃO é CHECK.
--
-- `NOT VALID` pula a validação das linhas que já existem, mas continua
-- barrando INSERT — e o backfill é INSERT. Os 4.985 tickets antigos de
-- reembolso sem número de pedido seriam rejeitados na travessia.
--
-- A regra vive no gatilho de 0002, que a aplica só a linha sem
-- `legacy_id`, ou seja só a registro novo. É a mesma decisão do
-- catálogo: o passado entra como está, o futuro obedece.

-- Lista quente do agente: cursor keyset por (created_at, id).
CREATE INDEX tickets_owner_created_idx
  ON core.tickets (current_owner_id, created_at DESC, id DESC);

-- Lookup por e-mail entre tickets abertos.
CREATE INDEX tickets_open_by_email_idx
  ON core.tickets (client_email_normalized)
  WHERE derived_status <> 'concluido';

CREATE INDEX tickets_business_day_idx ON core.tickets (business_day, current_owner_id);

-- ---------------------------------------------------------------------
-- Interações
-- ---------------------------------------------------------------------

CREATE TABLE core.interactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id         uuid NOT NULL REFERENCES core.tickets(id) ON DELETE CASCADE,

  -- [G1.2] Atribuído pelo banco. O cliente nunca envia.
  -- Hoje é `existing.length + 1` calculado no browser, e há 12.753 linhas
  -- excedentes por isso — praticamente todas dos últimos 180 dias.
  seq               smallint NOT NULL,

  status            core.interaction_status NOT NULL,
  observation       text,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  author_id         uuid NOT NULL REFERENCES core.users(id),

  -- Marcado pelo banco. NÃO bloqueia nada: a decisão D1 removeu o
  -- bloqueio das 18h. A marcação é o que impede a métrica de contar a
  -- mesma conversa duas vezes.
  is_same_day_repeat boolean NOT NULL DEFAULT false,

  created_at        timestamptz NOT NULL DEFAULT now(),

  legacy_id         text UNIQUE,
  legacy_follow_up_number integer,

  CONSTRAINT interactions_seq_positive CHECK (seq >= 1),
  CONSTRAINT interactions_seq_unique UNIQUE (ticket_id, seq)
);

-- Ordem canônica (recorded_at, id) — a mesma de my_follow_ups(), que é o
-- que a tela mostra hoje. NÃO é a de maior seq.
CREATE INDEX interactions_ticket_canonical_idx
  ON core.interactions (ticket_id, recorded_at DESC, seq DESC);

CREATE INDEX interactions_author_recorded_idx
  ON core.interactions (author_id, recorded_at DESC);

-- ---------------------------------------------------------------------
-- [G1.1] O trigger que mantém o estado derivado
--
-- É a rede de segurança: a API já escreve o estado na mesma transação,
-- mas se algum script gravar direto, o estado não pode divergir.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.refresh_ticket_derived_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = core, pg_catalog
AS $$
DECLARE
  v_ticket_id     uuid := COALESCE(NEW.ticket_id, OLD.ticket_id);
  v_last_status   core.interaction_status;
  v_last_at       timestamptz;
  v_count         integer;
  v_legacy_status text;
BEGIN
  -- Ordem canônica: (recorded_at, seq).
  --
  -- NÃO é (recorded_at, id), que é a do legado. Descoberto ao executar:
  -- `now()` em Postgres é da TRANSAÇÃO, não da linha, então duas
  -- interações gravadas no mesmo pedido têm `recorded_at` idêntico, e o
  -- desempate por uuid aleatório escolhe uma das duas por sorteio. Num
  -- teste real o ticket ficou 'em_andamento' depois de ser concluído.
  -- É o bug dos 10.115 tickets fantasma reaparecendo por outra porta.
  --
  -- `seq` é monotônico e único por ticket (interactions_seq_unique), logo
  -- o desempate é determinístico. O backfill atribui `seq` na ordem
  -- legada (recorded_at, id), de modo que o histórico exibido não muda e
  -- as duas ordens passam a concordar para sempre.
  SELECT i.status, i.recorded_at
    INTO v_last_status, v_last_at
    FROM core.interactions i
   WHERE i.ticket_id = v_ticket_id
   ORDER BY i.recorded_at DESC, i.seq DESC
   LIMIT 1;

  SELECT count(*) INTO v_count
    FROM core.interactions i WHERE i.ticket_id = v_ticket_id;

  SELECT t.legacy_status INTO v_legacy_status
    FROM core.tickets t WHERE t.id = v_ticket_id;

  UPDATE core.tickets t
     SET derived_status = CASE
           -- [C8] O fallback é obrigatório. Sem ele, 1.220 atendimentos
           -- concluídos antes de existir follow-up reabrem na virada.
           WHEN v_last_status IS NULL AND v_legacy_status = 'concluido' THEN 'concluido'
           WHEN v_last_status IS NULL                                  THEN 'novo'
           WHEN v_last_status = 'concluido'                             THEN 'concluido'
           ELSE 'em_andamento'
         END::core.ticket_derived_status,
         -- A criação conta como interação.
         interaction_count   = GREATEST(v_count, 1),
         last_interaction_at = v_last_at,
         status = CASE
           WHEN v_last_status = 'concluido' THEN 'concluido'
           ELSE 'registered'
         END::core.ticket_status,
         updated_at = now()
   WHERE t.id = v_ticket_id;

  RETURN NULL;
END;
$$;

CREATE TRIGGER interactions_refresh_ticket_state
AFTER INSERT OR UPDATE OR DELETE ON core.interactions
FOR EACH ROW EXECUTE FUNCTION core.refresh_ticket_derived_state();

-- `recorded_at` é do servidor e imutável, como no legado.
CREATE OR REPLACE FUNCTION core.freeze_interaction_recorded_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = core, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.recorded_at := COALESCE(NEW.recorded_at, now());
  ELSIF NEW.recorded_at IS DISTINCT FROM OLD.recorded_at THEN
    RAISE EXCEPTION 'recorded_at é imutável (interaction %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER interactions_freeze_recorded_at
BEFORE INSERT OR UPDATE ON core.interactions
FOR EACH ROW EXECUTE FUNCTION core.freeze_interaction_recorded_at();

-- ---------------------------------------------------------------------
-- [G7.1, G7.2] Privilégios
--
-- Nenhum papel anônimo ou de usuário final toca estas tabelas. Só a API.
-- Hoje `anon` e `authenticated` têm privilégio de escrita nas 32 tabelas
-- do schema público, com a proteção por linha como única defesa.
-- ---------------------------------------------------------------------

REVOKE ALL ON SCHEMA core FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA core REVOKE ALL ON TABLES FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_request') THEN
    CREATE ROLE api_request NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA core TO api_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core TO api_request;
ALTER DEFAULT PRIVILEGES IN SCHEMA core
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_request;
