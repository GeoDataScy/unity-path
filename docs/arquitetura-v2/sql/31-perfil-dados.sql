-- =====================================================================
-- 31-perfil-dados.sql — perfil quantificado dos dados de produção
-- Projeto: kjkyyqxqrqsdozjyyuon
--
-- SOMENTE LEITURA.
--
-- REGRAS DE SEGURANÇA (produção é t4g.micro e já caiu por CPU em 24/07/2026):
--   * rode UMA consulta por requisição;
--   * o `SET LOCAL statement_timeout` tem de ir na MESMA requisição da consulta;
--   * `WITH ... AS MATERIALIZED` faz a tabela grande ser varrida UMA vez só,
--     mesmo com N subconsultas de agregação — não remova o MATERIALIZED;
--   * se uma consulta estourar o timeout, NÃO repita: reduza o período.
--
-- RECONCILIADO em 26/09/2026 com 00-CONTRATO.md §8-A. As três perguntas que este
-- levantamento deixou abertas foram respondidas pelo dono do projeto:
--   D5 -> platform 'Nenhum' (10.666) e vazio (26.764) permanecem DISTINTOS.
--   D6 -> e-mail preservado como digitado; normalização só em coluna gerada.
--   D4 -> todo valor monetário é DÓLAR; os 88 outliers são qualidade de dado.
-- As consultas abaixo não mudam: elas medem o legado, que não mudou.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. services — ids, datas, e-mails (uma varredura)
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (
  SELECT id, user_id, current_owner_id, service_date, created_at, client_email FROM services
)
SELECT jsonb_pretty(jsonb_build_object(
  'total',                      (SELECT count(*) FROM s),
  'service_date_canonico',      (SELECT count(*) FROM s WHERE service_date ~ '^\d{4}-\d{2}-\d{2}T00:00:00-03:00$'),
  'service_date_fora_do_padrao',(SELECT count(*) FROM s WHERE service_date !~ '^\d{4}-\d{2}-\d{2}T00:00:00-03:00$'),
  'service_date_nulo_ou_vazio', (SELECT count(*) FROM s WHERE service_date IS NULL OR btrim(service_date)=''),
  'id_uuid_valido',    (SELECT count(*) FROM s WHERE id      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  'id_nao_uuid',       (SELECT count(*) FROM s WHERE id      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  'user_id_nao_uuid',  (SELECT count(*) FROM s WHERE user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  'owner_id_nao_uuid', (SELECT count(*) FROM s WHERE current_owner_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  'email_com_espaco',    (SELECT count(*) FROM s WHERE client_email <> btrim(client_email)),
  'email_com_maiuscula', (SELECT count(*) FROM s WHERE client_email <> lower(client_email)),
  'email_sem_arroba',    (SELECT count(*) FROM s WHERE client_email NOT LIKE '%@%'),
  'emails_distintos',              (SELECT count(DISTINCT client_email) FROM s),
  'emails_distintos_normalizados', (SELECT count(DISTINCT lower(btrim(client_email))) FROM s),
  'owner_difere_de_user', (SELECT count(*) FROM s WHERE current_owner_id IS DISTINCT FROM user_id)
));
-- Esperado em 26/09/2026: total 102.738 · canonico 80.418 · fora 22.320 · nulo 0
--                         todos os ids uuid válidos (0 inválidos)
--                         sem_arroba 22.446 · com_maiuscula 1.501 · com_espaco 0

-- ---------------------------------------------------------------------
-- 2. services.service_date — classificar as exceções de formato
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (
  SELECT service_date FROM services
  WHERE service_date !~ '^\d{4}-\d{2}-\d{2}T00:00:00-03:00$'
), cls AS (
  SELECT CASE
    WHEN service_date ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$'      THEN 'A: +00:00'
    WHEN service_date ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+\+00:00$' THEN 'B: ms +00:00'
    WHEN service_date ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'            THEN 'C: Z'
    WHEN service_date ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$'       THEN 'D: ms + Z'
    WHEN service_date ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$'       THEN 'E: hora nao-zero -03:00'
    WHEN service_date ~ '^\d{4}-\d{2}-\d{2}$'                               THEN 'F: so a data'
    WHEN service_date ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}'              THEN 'G: espaco em vez de T'
    ELSE 'Z: OUTRO' END AS fmt, service_date
  FROM s
)
SELECT fmt, count(*) AS n, min(service_date) AS ex_min, max(service_date) AS ex_max
FROM cls GROUP BY fmt ORDER BY n DESC;
-- Esperado: UMA linha — 'A: +00:00', 22.320, de 2026-01-15 a 2026-03-10.

-- ---------------------------------------------------------------------
-- 3. O ERRO QUE A CONVERSÃO INGÊNUA COMETE  (o número mais importante daqui)
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (
  SELECT substring(service_date,1,10)::date                              AS dia_texto,
         (service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS dia_sp
  FROM services
)
SELECT (dia_texto - dia_sp) AS delta_em_dias, count(*)
FROM s GROUP BY 1 ORDER BY 1;
-- Esperado: delta 0 → 95.961 · delta +1 → 6.778
-- Ou seja: substring(...,1,10)::date DATA 6.778 TICKETS UM DIA ADIANTE.
-- A conversão correta é SEMPRE:
--   (service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date

-- ---------------------------------------------------------------------
-- 4. services — distribuições de baixa cardinalidade
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (
  SELECT status, platform, channel, has_tracking_code, contact_reason, contact_reason_note, order_id
  FROM services
)
SELECT jsonb_pretty(jsonb_build_object(
  'status',   (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',coalesce(status,'<NULL>'),'n',count(*)) x            FROM s GROUP BY status ORDER BY count(*) DESC) q),
  'platform', (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',coalesce(platform,'<NULL>'),'n',count(*)) x          FROM s GROUP BY platform ORDER BY count(*) DESC) q),
  'channel',  (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',coalesce(channel,'<NULL>'),'n',count(*)) x           FROM s GROUP BY channel ORDER BY count(*) DESC) q),
  'has_tracking_code', (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',has_tracking_code::text,'n',count(*)) x     FROM s GROUP BY has_tracking_code ORDER BY count(*) DESC) q),
  'contact_reason',    (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',coalesce(contact_reason,'<NULL>'),'n',count(*)) x FROM s GROUP BY contact_reason ORDER BY count(*) DESC) q),
  'contact_reason_note_preenchida', (SELECT count(*) FROM s WHERE contact_reason_note IS NOT NULL),
  'order_id_nulo',  (SELECT count(*) FROM s WHERE order_id IS NULL),
  'order_id_vazio', (SELECT count(*) FROM s WHERE order_id IS NOT NULL AND btrim(order_id)='')
));
-- ATENÇÃO ao resultado: platform tem 'Logicall' (1) além de 'LogiCall' (995) — erro de caixa.
-- 'Nenhum' (10.666) convive com NULL (26.764): por D5 os dois PERMANECEM DISTINTOS
-- no backfill (não unificar, não apagar). O erro de caixa NÃO é coberto por D5.

-- ---------------------------------------------------------------------
-- 5. services.product — distribuição e divergência entre tabelas
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (SELECT product FROM services)
SELECT jsonb_pretty(jsonb_build_object(
  'produtos_usados', (SELECT count(DISTINCT product) FROM s),
  'distribuicao', (SELECT jsonb_agg(x) FROM (
     SELECT jsonb_build_object('p',product,'n',count(*)) AS x FROM s GROUP BY product ORDER BY count(*) DESC) q),
  'produto_de_refunds_que_nao_existe_em_services', (SELECT jsonb_agg(x) FROM (
     SELECT jsonb_build_object('p',r.product,'n',count(*)) AS x FROM refunds r
     WHERE r.product IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM services s2 WHERE s2.product = r.product)
     GROUP BY r.product ORDER BY count(*) DESC) q)
));
-- Esperado: 75 produtos em uso (de 86 no CHECK).
-- refunds tem 'MemoryOn' e 'SteelPower' — variantes de caixa que services recusaria.

-- ---------------------------------------------------------------------
-- 6. service_follow_ups — perfil + numeração duplicada
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
WITH f AS MATERIALIZED (
  SELECT id, service_id, user_id, follow_up_number, status, recorded_at, created_at,
         is_same_day_repeat, observation
  FROM service_follow_ups
)
SELECT jsonb_pretty(jsonb_build_object(
  'total',              (SELECT count(*) FROM f),
  'services_distintos', (SELECT count(DISTINCT service_id) FROM f),
  'status', (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',status,'n',count(*)) x FROM f GROUP BY status ORDER BY count(*) DESC) q),
  'is_same_day_repeat', (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',is_same_day_repeat::text,'n',count(*)) x FROM f GROUP BY is_same_day_repeat) q),
  'recorded_at_min', (SELECT min(recorded_at)::text FROM f),
  'recorded_at_max', (SELECT max(recorded_at)::text FROM f),
  'recorded_at_difere_created_at', (SELECT count(*) FROM f WHERE recorded_at <> created_at),
  'observation_vazia',   (SELECT count(*) FROM f WHERE observation IS NULL OR btrim(observation)=''),
  'follow_up_number_max',(SELECT max(follow_up_number) FROM f),
  'pares_duplicados',    (SELECT count(*) FROM (SELECT service_id, follow_up_number FROM f GROUP BY 1,2 HAVING count(*)>1) d),
  'linhas_excedentes',   (SELECT coalesce(sum(c-1),0) FROM (SELECT count(*) AS c FROM f GROUP BY service_id, follow_up_number HAVING count(*)>1) d),
  'excedentes_por_numero', (SELECT jsonb_agg(x) FROM (
     SELECT jsonb_build_object('num',follow_up_number,'excedentes',sum(c-1)) AS x
     FROM (SELECT service_id, follow_up_number, count(*) AS c FROM f GROUP BY 1,2 HAVING count(*)>1) d
     GROUP BY follow_up_number ORDER BY sum(c-1) DESC LIMIT 12) q)
));
-- Esperado: total 59.710 · pares 5.544 · excedentes 12.755 · 98,1% no número 1

-- ---------------------------------------------------------------------
-- 7. Tickets fantasma: status do banco x status derivado do último follow-up
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
WITH ult AS MATERIALIZED (
  SELECT DISTINCT ON (f.service_id) f.service_id, f.status AS ult_status
  FROM service_follow_ups f
  ORDER BY f.service_id, f.recorded_at DESC, f.follow_up_number DESC, f.id DESC
)
SELECT s.status AS services_status,
       coalesce(u.ult_status,'<sem follow-up>') AS ultimo_followup,
       count(*)
FROM services s LEFT JOIN ult u ON u.service_id = s.id
GROUP BY 1,2 ORDER BY count(*) DESC;
-- Esperado: registered/concluido = 10.087 (os fantasmas)
--           concluido/em_andamento = 28 (o inverso)
--           concluido/<sem follow-up> = 1.220 (só services.status sabe)
--           registered/<sem follow-up> = 71.784

-- ---------------------------------------------------------------------
-- 8. Ambiguidade da derivação: as duas ordens possíveis discordam em quantos?
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
WITH f AS MATERIALIZED (
  SELECT service_id, status, recorded_at, follow_up_number, id FROM service_follow_ups
),
por_num   AS (SELECT DISTINCT ON (service_id) service_id, status AS st FROM f
              ORDER BY service_id, follow_up_number DESC, recorded_at DESC, id DESC),
por_tempo AS (SELECT DISTINCT ON (service_id) service_id, status AS st FROM f
              ORDER BY service_id, recorded_at DESC, follow_up_number DESC, id DESC)
SELECT
  (SELECT count(*) FROM services s JOIN por_tempo p ON p.service_id=s.id
     WHERE p.st='concluido' AND s.status<>'concluido')                       AS fantasmas_por_recorded_at,
  (SELECT count(*) FROM services s JOIN por_num p ON p.service_id=s.id
     WHERE p.st='concluido' AND s.status<>'concluido')                       AS fantasmas_por_follow_up_number,
  (SELECT count(*) FROM por_num a JOIN por_tempo b USING (service_id)
     WHERE a.st <> b.st)                                                     AS as_duas_ordens_discordam,
  (SELECT count(*) FROM (SELECT service_id, recorded_at FROM f
     GROUP BY 1,2 HAVING count(*)>1)                z)                       AS services_com_empate,
  (SELECT count(*) FROM (SELECT service_id, recorded_at FROM f
     GROUP BY 1,2 HAVING count(*)>1 AND count(DISTINCT status)>1) z)         AS empates_com_status_divergente;
-- Esperado: 10.087 · 9.994 · 216 · 85 · 69

-- ---------------------------------------------------------------------
-- 9. refunds — formatos, vocabulário e valores
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
WITH r AS MATERIALIZED (SELECT * FROM refunds)
SELECT jsonb_pretty(jsonb_build_object(
  'total', (SELECT count(*) FROM r),
  'request_date_iso',         (SELECT count(*) FROM r WHERE request_date ~ '^\d{4}-\d{2}-\d{2}$'),
  'request_date_fora_do_iso', (SELECT count(*) FROM r WHERE request_date !~ '^\d{4}-\d{2}-\d{2}$'),
  'request_date_nao_castavel',(SELECT count(*) FROM r WHERE text_to_date_safe(request_date) IS NULL),
  'completion_date_nulo',        (SELECT count(*) FROM r WHERE completion_date IS NULL),
  'completion_date_iso',         (SELECT count(*) FROM r WHERE completion_date ~ '^\d{4}-\d{2}-\d{2}$'),
  'completion_date_fora_do_iso', (SELECT count(*) FROM r WHERE completion_date IS NOT NULL AND completion_date !~ '^\d{4}-\d{2}-\d{2}$'),
  'completion_antes_de_request', (SELECT count(*) FROM r WHERE text_to_date_safe(completion_date) < text_to_date_safe(request_date)),
  'refund_type',    (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',coalesce(refund_type,'<NULL>'),'n',count(*)) x FROM r GROUP BY refund_type ORDER BY count(*) DESC) q),
  'sales_platform', (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',sales_platform,'n',count(*)) x FROM r GROUP BY sales_platform ORDER BY count(*) DESC) q),
  'channel',        (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',coalesce(channel,'<NULL>'),'n',count(*)) x FROM r GROUP BY channel ORDER BY count(*) DESC) q),
  'items_returned', (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',items_returned::text,'n',count(*)) x FROM r GROUP BY items_returned) q),
  'refund_value_nulo',  (SELECT count(*) FROM r WHERE refund_value IS NULL),
  'refund_value_zero',  (SELECT count(*) FROM r WHERE refund_value = 0),
  'refund_value_gt_500',(SELECT count(*) FROM r WHERE refund_value > 500),
  'refund_value_gt_2000',(SELECT count(*) FROM r WHERE refund_value > 2000),
  'refund_value_soma',  (SELECT round(sum(refund_value)::numeric,2) FROM r),
  'refund_value_max',   (SELECT max(refund_value) FROM r),
  'reason_nulo_ou_vazio',(SELECT count(*) FROM r WHERE reason IS NULL OR btrim(reason)=''),
  'service_id_nulo',     (SELECT count(*) FROM r WHERE service_id IS NULL),
  'created_from_service',(SELECT count(*) FROM r WHERE created_from_service),
  'email_com_maiuscula', (SELECT count(*) FROM r WHERE customer_email <> lower(customer_email))
));
-- Esperado: request_date 100% ISO (5.710/5.710) · completion_date 100% ISO nos não-nulos
--           refund_value nulo 1.240 = reason nulo = completion nulo (reembolso ABERTO)
--           soma 2.385.239,01 · max 76.365 (D4: é DÓLAR; os 88 > 2.000 são qualidade)
--           completion < request em 40 linhas

-- ---------------------------------------------------------------------
-- 10. Datas absurdas (formato válido, valor impossível)
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (
  SELECT id, service_date, product, channel,
         (service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS dia
  FROM services)
SELECT id, dia, service_date, product, channel FROM s
WHERE dia < '2026-01-01' OR dia > current_date;
-- Esperado: 2 linhas, ambas dia 1997-04-28, formato canônico -03:00
--           (portanto vieram de backfill com a trigger de pin DESABILITADA)

SET LOCAL statement_timeout = '15s';
SELECT 'request_date' AS col, request_date AS valor, count(*) FROM refunds
WHERE request_date::date < '2026-01-01' OR request_date::date > current_date
GROUP BY request_date
UNION ALL
SELECT 'completion_date', completion_date, count(*) FROM refunds
WHERE completion_date IS NOT NULL
  AND (completion_date::date < '2026-01-01' OR completion_date::date > current_date)
GROUP BY completion_date
ORDER BY 1,2;
-- Esperado incluir: request '0025-11-14' (1) · completion '0026-02-02' (1) e '0026-02-04' (1)
-- Os demais 2025-xx são reembolsos retroativos legítimos (89 linhas), NÃO sujeira.

-- ---------------------------------------------------------------------
-- 11. client_email é polimórfico: e-mail OU telefone, conforme o canal
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (SELECT client_email, channel FROM services)
SELECT coalesce(channel,'<NULL>') AS canal,
       count(*) FILTER (WHERE client_email NOT LIKE '%@%') AS sem_arroba,
       count(*) FILTER (WHERE client_email LIKE '%@%')     AS com_arroba
FROM s GROUP BY channel ORDER BY count(*) DESC;
-- Esperado: TODO o sem_arroba (22.446) está no canal SMS; zero nos demais.

SET LOCAL statement_timeout = '15s';
WITH noat AS MATERIALIZED (
  SELECT CASE
    WHEN client_email ~ '^\+?\d{8,15}$'              THEN 'telefone (so digitos 8-15)'
    WHEN client_email ~ '^\+?[\d\s\(\)\-]{8,20}$'    THEN 'telefone com separadores'
    WHEN client_email ~ '^\d+$'                      THEN 'so digitos (fora de 8-15)'
    ELSE 'outro' END AS fmt
  FROM services WHERE client_email NOT LIKE '%@%'
)
SELECT fmt, count(*) FROM noat GROUP BY fmt ORDER BY count(*) DESC;
-- Esperado: UMA linha — 'telefone com separadores', 22.446. Nenhum 'outro'.

-- ---------------------------------------------------------------------
-- 12. Integridade referencial (as colunas text SEM foreign key)
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
SELECT
  (SELECT count(*) FROM service_follow_ups f
     WHERE NOT EXISTS (SELECT 1 FROM services s  WHERE s.id = f.service_id)) AS fu_service_orfao,
  (SELECT count(*) FROM service_follow_ups f
     WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = f.user_id))     AS fu_user_orfao,
  (SELECT count(*) FROM refunds r
     WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = r.user_id))     AS rf_user_orfao,
  (SELECT count(*) FROM refunds r WHERE r.service_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM services s WHERE s.id = r.service_id))    AS rf_service_orfao,
  (SELECT count(*) FROM ticket_transfers t
     WHERE NOT EXISTS (SELECT 1 FROM services s WHERE s.id = t.service_id))  AS tr_service_orfao,
  (SELECT count(*) FROM user_roles u
     WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = u.user_id))     AS ur_orfao;
-- Esperado: 0 em tudo.

-- ---------------------------------------------------------------------
-- 13. Perfis sem usuário de autenticação — e quanto dado eles carregam
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
SELECT p.id, p.email, p.full_name, p.role::text AS role, p.is_active, p.created_at,
  (SELECT count(*) FROM services s WHERE s.user_id = p.id)           AS tickets_criados,
  (SELECT count(*) FROM services s WHERE s.current_owner_id = p.id)  AS tickets_em_posse,
  (SELECT count(*) FROM service_follow_ups f WHERE f.user_id = p.id) AS followups,
  (SELECT count(*) FROM refunds r WHERE r.user_id = p.id)            AS reembolsos
FROM profiles p
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id::text = p.id)
ORDER BY p.created_at;
-- Esperado: 2 agentes DESATIVADOS cujo auth.users foi apagado.
-- Juntos: 5.665 tickets criados, 2.617 follow-ups, 302 reembolsos.
-- A FK original era ON DELETE CASCADE: se ainda existisse, esse dado teria sumido.

-- ---------------------------------------------------------------------
-- 14. Reembolso x ticket: os dois lados do vínculo
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
SELECT
  (SELECT count(*) FROM refunds WHERE service_id IS NULL)                       AS reembolso_sem_ticket,
  (SELECT count(*) FROM services s WHERE s.contact_reason='reembolso'
     AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.service_id = s.id))        AS ticket_reembolso_sem_reembolso,
  (SELECT count(*) FROM refunds r WHERE NOT EXISTS (
     SELECT 1 FROM services s
      WHERE lower(btrim(s.client_email)) = lower(btrim(r.customer_email))))     AS reembolso_sem_ticket_do_mesmo_cliente;
-- Esperado: 3.975 · 4.837 · 388
-- Os 4.837 se explicam: a trigger sync_refund_from_service entrou em 06/08/2026 SEM backfill.

-- ---------------------------------------------------------------------
-- 15. Crescimento mês a mês (uma varredura por tabela)
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (
  SELECT to_char((service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,'YYYY-MM') AS m FROM services
), f AS MATERIALIZED (
  SELECT to_char((recorded_at AT TIME ZONE 'America/Sao_Paulo')::date,'YYYY-MM') AS m FROM service_follow_ups
), r AS MATERIALIZED (
  SELECT to_char(request_date::date,'YYYY-MM') AS m FROM refunds
)
SELECT coalesce(a.m,b.m,c.m) AS mes, coalesce(a.n,0) AS tickets,
       coalesce(b.n,0) AS followups, coalesce(c.n,0) AS reembolsos
FROM      (SELECT m,count(*) n FROM s GROUP BY m) a
FULL JOIN (SELECT m,count(*) n FROM f GROUP BY m) b ON b.m = a.m
FULL JOIN (SELECT m,count(*) n FROM r GROUP BY m) c ON c.m = coalesce(a.m,b.m)
ORDER BY 1;

-- ---------------------------------------------------------------------
-- 16. Demais tabelas de estado (todas pequenas; uma requisição basta)
-- ---------------------------------------------------------------------
SET LOCAL statement_timeout = '15s';
SELECT jsonb_pretty(jsonb_build_object(
 'held_orders', (SELECT jsonb_build_object('total',count(*),
    'status',       (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',status,'n',count(*)) x FROM held_orders GROUP BY status) q),
    'agent_status', (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',agent_status,'n',count(*)) x FROM held_orders GROUP BY agent_status) q),
    'pending_tag',  (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',coalesce(pending_tag,'<NULL>'),'n',count(*)) x FROM held_orders GROUP BY pending_tag) q),
    'email_nulo', count(*) FILTER (WHERE email IS NULL),
    'email_com_maiuscula', count(*) FILTER (WHERE email IS NOT NULL AND email<>lower(email)),
    'duplicate_of_preenchido', count(*) FILTER (WHERE duplicate_of IS NOT NULL)) FROM held_orders),
 'radar_items', (SELECT jsonb_build_object('total',count(*),
    'status',(SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',status,'n',count(*)) x FROM radar_items GROUP BY status) q),
    'kind',  (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',kind,'n',count(*)) x FROM radar_items GROUP BY kind) q)) FROM radar_items),
 'profiles', (SELECT jsonb_build_object('total',count(*),
    'role',(SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',role::text,'n',count(*)) x FROM profiles GROUP BY role) q),
    'support_channel',(SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',support_channel,'n',count(*)) x FROM profiles GROUP BY support_channel) q),
    'flags', jsonb_build_object(
       'is_active', count(*) FILTER (WHERE is_active),
       'is_available', count(*) FILTER (WHERE is_available),
       'can_view_all_tickets', count(*) FILTER (WHERE can_view_all_tickets),
       'can_register_duplicate_emails', count(*) FILTER (WHERE can_register_duplicate_emails),
       'can_claim_tickets', count(*) FILTER (WHERE can_claim_tickets),
       'can_approve_takeovers', count(*) FILTER (WHERE can_approve_takeovers))) FROM profiles),
 'ticket_transfers', (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',status,'n',count(*)) x FROM ticket_transfers GROUP BY status) q),
 'takeovers',        (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',status,'n',count(*)) x FROM ticket_takeover_requests GROUP BY status) q),
 'refund_reason_categories', (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',category,'n',count(*)) x FROM refund_reason_classifications GROUP BY category ORDER BY count(*) DESC) q),
 'service_date_corrections_total', (SELECT count(*) FROM service_date_corrections),
 'refund_manager_completions_total', (SELECT count(*) FROM refund_manager_completions)
));
-- ATENÇÃO: service_date_corrections = 0. A gestora NUNCA corrigiu uma data.
--          profiles.support_channel = 'email' nas 47 linhas (coluna morta).
--          can_view_all_tickets = 0 usuários (capacidade viva no código, desligada na operação).
