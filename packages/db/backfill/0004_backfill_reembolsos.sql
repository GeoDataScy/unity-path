-- =====================================================================
-- 0004_backfill_reembolsos.sql — travessia de reembolsos e transferências.
--
-- Mesmas regras de sempre: roda dentro do banco, nada sai, nada do legado
-- é alterado, reexecutável, e o que não converte vira rejeito auditável
-- em vez de sumir.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Percentual: de texto para número
--
-- 21 variantes no legado, com `05%` usando zero à esquerda e os demais
-- não. `(vazio)` é o maior grupo, com 1.242 linhas, e continua nulo.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.legacy_refund_percent(p_text text)
RETURNS smallint
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE v text := btrim(coalesce(p_text, ''));
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  v := regexp_replace(v, '[^0-9]', '', 'g');   -- '05%' e '5 %' viram '05' e '5'
  IF v = '' THEN RETURN NULL; END IF;
  IF v::int NOT BETWEEN 0 AND 100 THEN RETURN NULL; END IF;
  RETURN v::smallint;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$;

-- Data em texto. O legado tem texto livre até maio/2026, por isso a
-- conversão é tolerante e quem falha vira rejeito.
CREATE OR REPLACE FUNCTION core.legacy_date(p_text text)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog
AS $$
BEGIN
  RETURN btrim(p_text)::date;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------
-- Categorias de motivo, do que existe no legado
-- ---------------------------------------------------------------------

INSERT INTO core.refund_reason_categories (code, label)
SELECT DISTINCT btrim(c.category), btrim(c.category)
  FROM public.refund_reason_classifications c
 WHERE btrim(coalesce(c.category, '')) <> ''
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- Rejeitos de reembolso
-- ---------------------------------------------------------------------

INSERT INTO core.migration_rejects (source_table, legacy_id, reason_code, detail, payload)
SELECT 'refunds', r.id,
       CASE
         WHEN NOT core.is_uuid(r.id)                        THEN 'INVALID_ID'
         WHEN core.legacy_date(r.request_date) IS NULL      THEN 'UNPARSEABLE_REQUEST_DATE'
         WHEN core.legacy_date(r.request_date)
              NOT BETWEEN date '2020-01-01' AND current_date + 1 THEN 'DATE_OUT_OF_RANGE'
         WHEN NOT EXISTS (SELECT 1 FROM core.users u WHERE u.legacy_id = r.user_id)
                                                            THEN 'UNKNOWN_AGENT'
         WHEN r.completion_date IS NOT NULL
              AND btrim(r.completion_date) <> ''
              AND core.legacy_date(r.completion_date) IS NULL THEN 'UNPARSEABLE_COMPLETION_DATE'
       END,
       'request_date=' || coalesce(r.request_date, '<nulo>') ||
       ' completion_date=' || coalesce(r.completion_date, '<nulo>'),
       to_jsonb(r)
  FROM public.refunds r
 WHERE NOT core.is_uuid(r.id)
    OR core.legacy_date(r.request_date) IS NULL
    OR core.legacy_date(r.request_date) NOT BETWEEN date '2020-01-01' AND current_date + 1
    OR NOT EXISTS (SELECT 1 FROM core.users u WHERE u.legacy_id = r.user_id)
    OR (r.completion_date IS NOT NULL AND btrim(r.completion_date) <> ''
        AND core.legacy_date(r.completion_date) IS NULL)
ON CONFLICT (source_table, legacy_id, reason_code) DO NOTHING;

-- ---------------------------------------------------------------------
-- Reembolsos
--
-- `ticket_id` só é preenchido quando o ticket atravessou: um reembolso
-- cujo ticket virou rejeito entra sem vínculo, em vez de ser rejeitado
-- junto. O vínculo original fica no legado.
-- ---------------------------------------------------------------------

INSERT INTO core.refunds (
  id, ticket_id, agent_id, order_id, customer_email,
  platform_id, channel_id, product_id,
  request_date, completion_date, refund_value, refund_percent,
  reason, reason_category_id, items_returned, created_from_ticket,
  picked_up_at, picked_up_by, created_at,
  legacy_id, legacy_refund_type, legacy_platform, legacy_channel)
SELECT r.id::uuid,
       t.id,
       ua.id,
       r.order_id,
       btrim(r.customer_email),
       core.resolve_sales_platform(r.sales_platform),
       core.resolve_channel(r.channel),
       p.id,
       core.legacy_date(r.request_date),
       core.legacy_date(r.completion_date),
       -- double precision -> numeric exato
       round(r.refund_value::numeric, 2),
       core.legacy_refund_percent(r.refund_type),
       nullif(btrim(coalesce(r.reason, '')), ''),
       core.resolve_refund_category(rc.category),
       coalesce(r.items_returned, false),
       coalesce(r.created_from_service, false),
       r.picked_up_at,
       up.id,
       coalesce(r.created_at AT TIME ZONE 'UTC', now()),
       r.id,
       r.refund_type,
       r.sales_platform,
       r.channel
  FROM public.refunds r
  JOIN core.users ua ON ua.legacy_id = r.user_id
  LEFT JOIN core.tickets  t  ON t.legacy_id = r.service_id
  LEFT JOIN core.users    up ON up.legacy_id = r.picked_up_by
  LEFT JOIN core.products p  ON p.name_normalized = lower(btrim(r.product))
  LEFT JOIN public.refund_reason_classifications rc ON rc.refund_id = r.id
 WHERE NOT EXISTS (SELECT 1 FROM core.migration_rejects mr
                    WHERE mr.source_table = 'refunds' AND mr.legacy_id = r.id)
ON CONFLICT (legacy_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- Eventos de reembolso
--
-- A baixa da gestora era a única auditada, em tabela à parte. Ela entra
-- como evento. A baixa do agente não deixou rastro nenhum no legado, e
-- por isso não há como reconstruí-la — o que está registrado aqui é
-- exatamente o que existia, sem inventar histórico.
-- ---------------------------------------------------------------------

INSERT INTO core.refund_events (refund_id, kind, actor_id, snapshot, recorded_at, legacy_id)
SELECT rf.id, 'completed', uc.id,
       jsonb_build_object(
         'completion_date', c.completion_date,
         'refund_value',    c.refund_value,
         'refund_type',     c.refund_type,
         'reason',          c.reason,
         'items_returned',  c.items_returned,
         'days_overdue',    c.days_overdue,
         'origem',          'refund_manager_completions'),
       c.created_at,
       c.id::text
  FROM public.refund_manager_completions c
  JOIN core.refunds rf ON rf.legacy_id = c.refund_id
  JOIN core.users   uc ON uc.id = c.completed_by
ON CONFLICT (legacy_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- Transferências
-- ---------------------------------------------------------------------

INSERT INTO core.migration_rejects (source_table, legacy_id, reason_code, detail, payload)
SELECT 'ticket_transfers', tr.id::text,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM core.tickets t WHERE t.legacy_id = tr.service_id)
              THEN 'ORPHAN_TICKET'
         WHEN NOT EXISTS (SELECT 1 FROM core.users u WHERE u.legacy_id = tr.from_user_id)
              THEN 'UNKNOWN_FROM_USER'
         WHEN NOT EXISTS (SELECT 1 FROM core.users u WHERE u.legacy_id = tr.to_user_id)
              THEN 'UNKNOWN_TO_USER'
         ELSE 'SELF_TRANSFER'
       END,
       'status=' || coalesce(tr.status, '<nulo>'),
       to_jsonb(tr)
  FROM public.ticket_transfers tr
 WHERE NOT EXISTS (SELECT 1 FROM core.tickets t WHERE t.legacy_id = tr.service_id)
    OR NOT EXISTS (SELECT 1 FROM core.users u WHERE u.legacy_id = tr.from_user_id)
    OR NOT EXISTS (SELECT 1 FROM core.users u WHERE u.legacy_id = tr.to_user_id)
    OR tr.from_user_id = tr.to_user_id
ON CONFLICT (source_table, legacy_id, reason_code) DO NOTHING;

INSERT INTO core.ticket_transfers (
  id, ticket_id, from_user_id, to_user_id, status, message, response_note,
  responded_at, recipient_seen_at, requester_seen_at, assigned_by_manager_id,
  created_at, legacy_id)
SELECT tr.id,
       t.id, uf.id, ut.id,
       CASE tr.status WHEN 'pending' THEN 'pending' WHEN 'accepted' THEN 'accepted'
                      WHEN 'declined' THEN 'declined' ELSE 'cancelled' END::core.request_status,
       tr.message, tr.response_note, tr.responded_at,
       tr.recipient_seen_at, tr.requester_seen_at, um.id,
       tr.created_at, tr.id::text
  FROM public.ticket_transfers tr
  JOIN core.tickets t  ON t.legacy_id  = tr.service_id
  JOIN core.users   uf ON uf.legacy_id = tr.from_user_id
  JOIN core.users   ut ON ut.legacy_id = tr.to_user_id
  LEFT JOIN core.users um ON um.legacy_id = tr.assigned_by_manager_id
 WHERE NOT EXISTS (SELECT 1 FROM core.migration_rejects mr
                    WHERE mr.source_table = 'ticket_transfers' AND mr.legacy_id = tr.id::text)
ON CONFLICT (legacy_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- Tomadas de ticket
-- ---------------------------------------------------------------------

INSERT INTO core.migration_rejects (source_table, legacy_id, reason_code, detail, payload)
SELECT 'ticket_takeover_requests', tk.id::text,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM core.tickets t WHERE t.legacy_id = tk.service_id)
              THEN 'ORPHAN_TICKET'
         ELSE 'UNKNOWN_REQUESTER'
       END,
       'status=' || coalesce(tk.status, '<nulo>'),
       to_jsonb(tk)
  FROM public.ticket_takeover_requests tk
 WHERE NOT EXISTS (SELECT 1 FROM core.tickets t WHERE t.legacy_id = tk.service_id)
    OR NOT EXISTS (SELECT 1 FROM core.users u WHERE u.legacy_id = tk.requester_id)
ON CONFLICT (source_table, legacy_id, reason_code) DO NOTHING;

INSERT INTO core.ticket_takeovers (
  id, ticket_id, requester_id, owner_id, status, note,
  responded_at, responded_by, created_at, legacy_id)
SELECT tk.id, t.id, ur.id, uo.id,
       CASE tk.status WHEN 'pending' THEN 'pending' WHEN 'approved' THEN 'accepted'
                      WHEN 'accepted' THEN 'accepted' WHEN 'rejected' THEN 'declined'
                      WHEN 'declined' THEN 'declined' ELSE 'cancelled' END::core.request_status,
       tk.note, tk.responded_at, urb.id, tk.created_at, tk.id::text
  FROM public.ticket_takeover_requests tk
  JOIN core.tickets t  ON t.legacy_id  = tk.service_id
  JOIN core.users   ur ON ur.legacy_id = tk.requester_id
  LEFT JOIN core.users uo  ON uo.legacy_id  = tk.owner_id
  LEFT JOIN core.users urb ON urb.legacy_id = tk.responded_by
 WHERE NOT EXISTS (SELECT 1 FROM core.migration_rejects mr
                    WHERE mr.source_table = 'ticket_takeover_requests' AND mr.legacy_id = tk.id::text)
ON CONFLICT (legacy_id) DO NOTHING;

ANALYZE core.refunds;
ANALYZE core.refund_events;
ANALYZE core.ticket_transfers;
ANALYZE core.ticket_takeovers;
