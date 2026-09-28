-- =====================================================================
-- 0003_backfill.sql — travessia do schema legado `public` para `core`.
--
-- Roda DENTRO do banco: lê `public`, escreve `core`. Nenhum dado sai.
-- Nenhuma linha do legado é alterada, apagada ou movida.
--
-- Reexecutável: `ON CONFLICT (legacy_id) DO NOTHING`. Rodar duas vezes
-- não duplica nada, e rodar de novo depois de corrigir um rejeito traz
-- só o que faltava.
--
-- Nada é descartado. Linha que não converte vai para `core.migration_rejects`
-- com o motivo e o conteúdo original, para decisão humana.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Onde ficam as linhas que não atravessaram
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS core.migration_rejects (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table text        NOT NULL,
  legacy_id    text        NOT NULL,
  reason_code  text        NOT NULL,
  detail       text,
  payload      jsonb       NOT NULL,
  rejected_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  UNIQUE (source_table, legacy_id, reason_code)
);

COMMENT ON TABLE core.migration_rejects IS
  'Linhas do legado que não atravessaram, com o conteúdo original intacto. '
  'Rejeito é pendência de decisão, nunca perda: a linha original continua em public.';

-- ---------------------------------------------------------------------
-- Conversões auxiliares
-- ---------------------------------------------------------------------

-- `services.service_date` é texto. O formato de hoje é ISO com fuso; até
-- 10/03/2026 era `+00:00`. Converter é a MESMA regra que
-- `_interaction_events` já aplica, e não um recorte de string: 6.778
-- linhas mudariam de dia com `substring`.
CREATE OR REPLACE FUNCTION core.legacy_business_day(p_text text)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = core, public, pg_catalog
AS $$
BEGIN
  RETURN (p_text::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date;
EXCEPTION WHEN others THEN
  RETURN NULL;  -- quem chama manda para migration_rejects
END;
$$;

CREATE OR REPLACE FUNCTION core.is_uuid(p_text text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM p_text::uuid; RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END;
$$;

-- ---------------------------------------------------------------------
-- 1. Usuários
--
-- Sem FK para auth.users, deliberadamente: o legado perdeu essa FK e foi
-- isso que salvou 5.665 tickets de dois agentes cujo login foi apagado.
-- `created_at` é `timestamp` SEM fuso e é UTC — provado em 91-MEDICOES §M8
-- comparando com a data que o gatilho de fixação grava.
-- ---------------------------------------------------------------------

INSERT INTO core.users (
  id, email, full_name, role, is_active, is_available, support_channel,
  can_view_all_tickets, can_register_duplicate_emails, can_claim_tickets,
  can_approve_takeovers, can_view_support_analytics,
  deactivated_at, created_at, legacy_id)
SELECT p.id::uuid,
       p.email,
       p.full_name,
       p.role::text::core.app_role,
       p.is_active,
       coalesce(p.is_available, true),
       p.support_channel,
       coalesce(p.can_view_all_tickets, false),
       coalesce(p.can_register_duplicate_emails, false),
       coalesce(p.can_claim_tickets, false),
       coalesce(p.can_approve_takeovers, false),
       -- A coluna não existe no legado: a capacidade vem do papel.
       p.role::text IN ('manager', 'copy_grup'),
       p.deactivated_at,
       coalesce(p.created_at AT TIME ZONE 'UTC', now()),
       p.id
  FROM public.profiles p
 WHERE core.is_uuid(p.id)
ON CONFLICT (legacy_id) DO NOTHING;

-- `deactivated_by` depois, porque aponta para a própria tabela.
UPDATE core.users u
   SET deactivated_by = d.id
  FROM public.profiles p JOIN core.users d ON d.legacy_id = p.deactivated_by
 WHERE u.legacy_id = p.id AND p.deactivated_by IS NOT NULL AND u.deactivated_by IS NULL;

-- ---------------------------------------------------------------------
-- 2. Produtos
--
-- O catálogo absorve o que existe. Produto novo hoje exige migration,
-- porque `services.product` tem CHECK; aqui vira linha.
-- ---------------------------------------------------------------------

INSERT INTO core.products (name)
SELECT DISTINCT btrim(s.product)
  FROM public.services s
 WHERE btrim(coalesce(s.product, '')) <> ''
ON CONFLICT (name_normalized) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Rejeitos de atendimento — computados ANTES, para o insert principal
--    poder excluí-los sem repetir a lógica
-- ---------------------------------------------------------------------

INSERT INTO core.migration_rejects (source_table, legacy_id, reason_code, detail, payload)
SELECT 'services', s.id,
       CASE
         WHEN NOT core.is_uuid(s.id)                       THEN 'INVALID_ID'
         WHEN core.legacy_business_day(s.service_date) IS NULL THEN 'UNPARSEABLE_DATE'
         WHEN core.legacy_business_day(s.service_date)
              NOT BETWEEN date '2020-01-01' AND current_date + 1 THEN 'DATE_OUT_OF_RANGE'
         WHEN btrim(coalesce(s.product, '')) = ''          THEN 'MISSING_PRODUCT'
         WHEN NOT EXISTS (SELECT 1 FROM core.users u WHERE u.legacy_id = s.user_id)
                                                           THEN 'UNKNOWN_CREATOR'
         WHEN s.contact_reason IS NOT NULL
              AND s.contact_reason NOT IN (SELECT unnest(enum_range(NULL::core.contact_reason))::text)
                                                           THEN 'UNKNOWN_CONTACT_REASON'
       END,
       'service_date=' || coalesce(s.service_date, '<nulo>') ||
       ' product='     || coalesce(s.product, '<nulo>'),
       to_jsonb(s)
  FROM public.services s
 WHERE NOT core.is_uuid(s.id)
    OR core.legacy_business_day(s.service_date) IS NULL
    OR core.legacy_business_day(s.service_date) NOT BETWEEN date '2020-01-01' AND current_date + 1
    OR btrim(coalesce(s.product, '')) = ''
    OR NOT EXISTS (SELECT 1 FROM core.users u WHERE u.legacy_id = s.user_id)
    OR (s.contact_reason IS NOT NULL
        AND s.contact_reason NOT IN (SELECT unnest(enum_range(NULL::core.contact_reason))::text))
ON CONFLICT (source_table, legacy_id, reason_code) DO NOTHING;

-- ---------------------------------------------------------------------
-- 4. Atendimentos
--
-- `derived_status` e `interaction_count` entram provisórios e são
-- recalculados no passo 6, depois das interações existirem.
-- A restrição de número de pedido em reembolso é NOT VALID, então o
-- histórico entra como está e a regra passa a valer só para escrita nova.
-- ---------------------------------------------------------------------

INSERT INTO core.tickets (
  id, client_email, business_day, product_id, platform_id, channel_id,
  contact_reason, contact_reason_note, order_id, has_tracking_code,
  status, creator_id, current_owner_id, takeover_approved_at, takeover_approved_by,
  derived_status, interaction_count, created_at,
  legacy_id, legacy_service_date, legacy_status, legacy_platform, legacy_channel)
SELECT s.id::uuid,
       btrim(s.client_email),
       core.legacy_business_day(s.service_date),
       p.id,
       core.resolve_sales_platform(s.platform),
       core.resolve_channel(s.channel),
       s.contact_reason::core.contact_reason,
       nullif(btrim(coalesce(s.contact_reason_note, '')), ''),
       nullif(btrim(coalesce(s.order_id, '')), ''),
       coalesce(s.has_tracking_code, false),
       CASE WHEN s.status = 'concluido' THEN 'concluido' ELSE 'registered' END::core.ticket_status,
       uc.id,
       coalesce(uo.id, uc.id),
       s.takeover_approved_at,
       ua.id,
       'novo'::core.ticket_derived_status,   -- provisório: passo 6 corrige
       1,                                     -- provisório: passo 6 corrige
       coalesce(s.created_at AT TIME ZONE 'UTC',
                (core.legacy_business_day(s.service_date) + time '12:00')
                  AT TIME ZONE 'America/Sao_Paulo'),
       s.id,
       s.service_date,
       s.status,
       s.platform,   -- texto cru: nenhuma grafia se perde
       s.channel
  FROM public.services s
  JOIN core.users uc ON uc.legacy_id = s.user_id
  JOIN core.products p ON p.name_normalized = lower(btrim(s.product))
  LEFT JOIN core.users uo ON uo.legacy_id = s.current_owner_id
  LEFT JOIN core.users ua ON ua.legacy_id = s.takeover_approved_by
 WHERE NOT EXISTS (SELECT 1 FROM core.migration_rejects r
                    WHERE r.source_table = 'services' AND r.legacy_id = s.id)
ON CONFLICT (legacy_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. Interações
--
-- `seq` é REATRIBUÍDO na ordem canônica do legado — `(recorded_at, id)`,
-- que é a de `my_follow_ups()` e portanto a que a tela mostra hoje. O
-- `follow_up_number` original fica em `legacy_follow_up_number`.
--
-- Isto resolve as 12.753 linhas com número repetido sem apagar nenhuma:
-- elas ganham números distintos, na ordem em que sempre foram exibidas.
--
-- Depois disto, `seq` é a ordem canônica do sistema novo, e a ambiguidade
-- de desempate por uuid aleatório (M9) deixa de existir.
-- ---------------------------------------------------------------------

INSERT INTO core.migration_rejects (source_table, legacy_id, reason_code, detail, payload)
SELECT 'service_follow_ups', f.id,
       CASE
         WHEN NOT core.is_uuid(f.id) THEN 'INVALID_ID'
         WHEN NOT EXISTS (SELECT 1 FROM core.tickets t WHERE t.legacy_id = f.service_id)
              THEN 'ORPHAN_TICKET'
         WHEN NOT EXISTS (SELECT 1 FROM core.users u WHERE u.legacy_id = f.user_id)
              THEN 'UNKNOWN_AUTHOR'
         ELSE 'UNKNOWN_STATUS'
       END,
       'status=' || coalesce(f.status, '<nulo>') || ' service_id=' || coalesce(f.service_id, '<nulo>'),
       to_jsonb(f)
  FROM public.service_follow_ups f
 WHERE NOT core.is_uuid(f.id)
    OR NOT EXISTS (SELECT 1 FROM core.tickets t WHERE t.legacy_id = f.service_id)
    OR NOT EXISTS (SELECT 1 FROM core.users u WHERE u.legacy_id = f.user_id)
    OR f.status NOT IN ('em_andamento', 'concluido')
ON CONFLICT (source_table, legacy_id, reason_code) DO NOTHING;

INSERT INTO core.interactions (
  id, ticket_id, seq, status, observation, recorded_at, author_id,
  is_same_day_repeat, created_at, legacy_id, legacy_follow_up_number)
SELECT f.id::uuid,
       t.id,
       row_number() OVER (PARTITION BY t.id ORDER BY f.recorded_at, f.id)::smallint,
       f.status::core.interaction_status,
       nullif(btrim(coalesce(f.observation, '')), ''),
       f.recorded_at,
       ua.id,
       coalesce(f.is_same_day_repeat, false),
       coalesce(f.created_at, f.recorded_at),
       f.id,
       f.follow_up_number
  FROM public.service_follow_ups f
  JOIN core.tickets t ON t.legacy_id = f.service_id
  JOIN core.users  ua ON ua.legacy_id = f.user_id
 WHERE NOT EXISTS (SELECT 1 FROM core.migration_rejects r
                    WHERE r.source_table = 'service_follow_ups' AND r.legacy_id = f.id)
ON CONFLICT (legacy_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 6. Estado materializado
--
-- [C8] O fallback em `legacy_status` é obrigatório. Sem ele, os 1.220
-- atendimentos concluídos ANTES de existir follow-up reabrem na virada.
-- A contagem inclui a criação, por isso o GREATEST com 1.
-- ---------------------------------------------------------------------

WITH ultima AS (
  SELECT DISTINCT ON (i.ticket_id) i.ticket_id, i.status, i.recorded_at
    FROM core.interactions i
   ORDER BY i.ticket_id, i.recorded_at DESC, i.seq DESC
), contagem AS (
  SELECT ticket_id, count(*)::int AS n FROM core.interactions GROUP BY 1
)
UPDATE core.tickets t
   SET derived_status = CASE
         WHEN u.status IS NULL AND t.legacy_status = 'concluido' THEN 'concluido'
         WHEN u.status IS NULL                                   THEN 'novo'
         WHEN u.status = 'concluido'                             THEN 'concluido'
         ELSE 'em_andamento'
       END::core.ticket_derived_status,
       interaction_count   = GREATEST(coalesce(c.n, 0), 1),
       last_interaction_at = u.recorded_at,
       status = CASE WHEN u.status = 'concluido' OR (u.status IS NULL AND t.legacy_status = 'concluido')
                     THEN 'concluido' ELSE 'registered' END::core.ticket_status
  FROM core.tickets t2
  LEFT JOIN ultima   u ON u.ticket_id   = t2.id
  LEFT JOIN contagem c ON c.ticket_id   = t2.id
 WHERE t.id = t2.id;

ANALYZE core.tickets;
ANALYZE core.interactions;
