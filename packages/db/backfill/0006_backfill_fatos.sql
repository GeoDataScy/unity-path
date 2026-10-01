-- =====================================================================
-- 0006_backfill_fatos.sql — popula a tabela de fatos a partir do que já
-- atravessou. Reexecutável.
--
-- Os gatilhos de 0006 só valem para escrita NOVA. Os 104 mil tickets e
-- 61 mil interações que já estão em `core` precisam entrar aqui.
--
-- EXIGE as migrations até 0007: a coluna `occurred_at` é obrigatória, e
-- este arquivo a preenche. Em produção, onde este backfill rodou antes de
-- 0007 existir, foi a própria 0007 que preencheu as linhas já gravadas.
--
-- Os dois eixos de tempo saem de origens diferentes, e isso é deliberado:
--   abertura   → `day` da data declarada, `occurred_at` de `created_at`
--   interação  → os dois de `recorded_at`
-- =====================================================================

INSERT INTO core.interaction_facts
  (day, occurred_at, agent_id, kind, ticket_id, product_id, platform_id,
   channel_id, contact_reason, has_tracking_code)
SELECT t.business_day, t.created_at, t.creator_id, 'ticket', t.id,
       t.product_id, t.platform_id, t.channel_id, t.contact_reason,
       t.has_tracking_code
  FROM core.tickets t
ON CONFLICT (ticket_id) WHERE kind = 'ticket' DO NOTHING;

INSERT INTO core.interaction_facts
  (day, occurred_at, agent_id, kind, ticket_id, interaction_id, product_id,
   platform_id, channel_id, contact_reason, is_same_day_repeat,
   has_tracking_code)
SELECT (i.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date,
       i.recorded_at,
       i.author_id, 'interaction', i.ticket_id, i.id,
       t.product_id, t.platform_id, t.channel_id, t.contact_reason,
       i.is_same_day_repeat, t.has_tracking_code
  FROM core.interactions i JOIN core.tickets t ON t.id = i.ticket_id
ON CONFLICT (interaction_id) WHERE kind = 'interaction' DO NOTHING;

ANALYZE core.interaction_facts;
