-- =====================================================================
-- 0005_sync_edicoes.sql — traz para `core` as EDIÇÕES feitas no legado.
--
-- Por que existe: a travessia (`0003`, `0004`) usa
-- `ON CONFLICT (legacy_id) DO NOTHING`. Isso é o certo para não duplicar,
-- mas significa que ela **pega registro novo e ignora registro alterado**.
--
-- Medido em produção em 30/09/2026: 3 atendimentos tiveram a plataforma
-- trocada no sistema antigo depois de já terem migrado, e a reconciliação
-- acusou. Enquanto os dois sistemas convivem, esse número cresce.
--
-- QUANDO RODAR: junto com a travessia, sempre. E obrigatoriamente na
-- janela de corte, com a escrita do legado já travada.
--
-- QUANDO **NÃO** RODAR: depois que a API virar a dona da escrita. A partir
-- daí o legado para de ser a verdade, e sincronizar de volta apagaria o
-- que o time fez no sistema novo. A guarda está na cláusula `WHERE`:
-- só toca linha com `legacy_id`, e o passo 4 confere se alguma foi
-- escrita pela API.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Atendimentos
--
-- Só as colunas que DERIVAM do legado. O estado materializado
-- (`derived_status`, `interaction_count`, `last_interaction_at`) não entra:
-- ele é recalculado a partir das interações, no passo 3.
-- ---------------------------------------------------------------------

UPDATE core.tickets t
   SET client_email        = btrim(s.client_email),
       business_day        = core.legacy_business_day(s.service_date),
       platform_id         = core.resolve_sales_platform(s.platform),
       channel_id          = core.resolve_channel(s.channel),
       contact_reason      = s.contact_reason::core.contact_reason,
       contact_reason_note = nullif(btrim(coalesce(s.contact_reason_note, '')), ''),
       order_id            = nullif(btrim(coalesce(s.order_id, '')), ''),
       has_tracking_code   = coalesce(s.has_tracking_code, false),
       current_owner_id    = coalesce(uo.id, t.current_owner_id),
       legacy_service_date = s.service_date,
       legacy_status       = s.status,
       legacy_platform     = s.platform,
       legacy_channel      = s.channel,
       updated_at          = now()
  FROM public.services s
  LEFT JOIN core.users uo ON uo.legacy_id = s.current_owner_id
 WHERE t.legacy_id = s.id
   AND core.legacy_business_day(s.service_date) IS NOT NULL
   AND (t.legacy_service_date IS DISTINCT FROM s.service_date
     OR t.legacy_platform     IS DISTINCT FROM s.platform
     OR t.legacy_channel      IS DISTINCT FROM s.channel
     OR t.legacy_status       IS DISTINCT FROM s.status
     OR t.client_email        IS DISTINCT FROM btrim(s.client_email)
     OR t.contact_reason::text IS DISTINCT FROM s.contact_reason
     OR t.contact_reason_note IS DISTINCT FROM nullif(btrim(coalesce(s.contact_reason_note,'')),'')
     OR t.order_id            IS DISTINCT FROM nullif(btrim(coalesce(s.order_id,'')),'')
     OR t.has_tracking_code   IS DISTINCT FROM coalesce(s.has_tracking_code, false));

-- ---------------------------------------------------------------------
-- 2. Interações
--
-- `recorded_at` é congelado por gatilho e não entra. O que muda na
-- prática é a observação e o status.
-- ---------------------------------------------------------------------

UPDATE core.interactions i
   SET status             = f.status::core.interaction_status,
       observation        = nullif(btrim(coalesce(f.observation, '')), ''),
       is_same_day_repeat = coalesce(f.is_same_day_repeat, false)
  FROM public.service_follow_ups f
 WHERE i.legacy_id = f.id
   AND f.status IN ('em_andamento', 'concluido')
   AND (i.status::text        IS DISTINCT FROM f.status
     OR i.observation         IS DISTINCT FROM nullif(btrim(coalesce(f.observation,'')),'')
     OR i.is_same_day_repeat  IS DISTINCT FROM coalesce(f.is_same_day_repeat, false));

-- ---------------------------------------------------------------------
-- 3. Reembolsos
-- ---------------------------------------------------------------------

UPDATE core.refunds r
   SET order_id        = s.order_id,
       customer_email  = btrim(s.customer_email),
       platform_id     = core.resolve_sales_platform(s.sales_platform),
       channel_id      = core.resolve_channel(s.channel),
       request_date    = core.legacy_date(s.request_date),
       completion_date = core.legacy_date(s.completion_date),
       refund_value    = round(s.refund_value::numeric, 2),
       refund_percent  = core.legacy_refund_percent(s.refund_type),
       reason          = nullif(btrim(coalesce(s.reason, '')), ''),
       items_returned  = coalesce(s.items_returned, false),
       legacy_refund_type = s.refund_type,
       legacy_platform    = s.sales_platform,
       legacy_channel     = s.channel,
       updated_at      = now()
  FROM public.refunds s
 WHERE r.legacy_id = s.id
   AND core.legacy_date(s.request_date) IS NOT NULL
   AND (r.legacy_refund_type IS DISTINCT FROM s.refund_type
     OR r.legacy_platform    IS DISTINCT FROM s.sales_platform
     OR r.legacy_channel     IS DISTINCT FROM s.channel
     OR r.completion_date    IS DISTINCT FROM core.legacy_date(s.completion_date)
     OR r.refund_value       IS DISTINCT FROM round(s.refund_value::numeric, 2)
     OR r.reason             IS DISTINCT FROM nullif(btrim(coalesce(s.reason,'')),'')
     OR r.items_returned     IS DISTINCT FROM coalesce(s.items_returned, false));

-- ---------------------------------------------------------------------
-- 4. Recalcular o estado materializado
--
-- A edição pode ter mudado o status de uma interação, e aí o estado do
-- ticket muda junto. Mesma regra do passo 6 da travessia, incluindo o
-- fallback em `legacy_status` que impede concluído sem interação de
-- reabrir.
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
         WHEN u.status IS NULL AND t2.legacy_status = 'concluido' THEN 'concluido'
         WHEN u.status IS NULL                                     THEN 'novo'
         WHEN u.status = 'concluido'                               THEN 'concluido'
         ELSE 'em_andamento'
       END::core.ticket_derived_status,
       interaction_count   = GREATEST(coalesce(c.n, 0), 1),
       last_interaction_at = u.recorded_at,
       status = CASE WHEN u.status = 'concluido'
                       OR (u.status IS NULL AND t2.legacy_status = 'concluido')
                     THEN 'concluido' ELSE 'registered' END::core.ticket_status
  FROM core.tickets t2
  LEFT JOIN ultima   u ON u.ticket_id = t2.id
  LEFT JOIN contagem c ON c.ticket_id = t2.id
 WHERE t.id = t2.id AND t.legacy_id IS NOT NULL;

ANALYZE core.tickets;
ANALYZE core.interactions;
ANALYZE core.refunds;
