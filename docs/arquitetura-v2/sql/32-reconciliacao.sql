-- =====================================================================
-- 32-reconciliacao.sql — suíte de reconciliação do backfill
-- Referência: docs/arquitetura-v2/32-banco-migracao.md, seção 8
--
-- SOMENTE LEITURA. Nenhuma instrução aqui escreve.
--
-- Convenções:
--   legado.*  = schema atual (hoje é `public`)
--   novo.*    = schema do modelo v2
--   :run      = run_id (uuid) da execução do backfill sendo verificada
--   :from / :to = recorte de período para as verificações de métrica
--
-- REGRA: nenhuma etapa avança com verificação vermelha.
--        R8 é a única que pode acusar diferença legitimamente (ver 32 §8).
--
-- RECONCILIADO em 26/09/2026 com 00-CONTRATO.md §8-A:
--   D5 -> platform/channel são CÓPIA LITERAL ('Nenhum' preservado). R4.d compara
--         coluna com coluna, igualdade EXATA. Não existe mais legacy_platform.
--   D6 -> e-mail preservado literal; normalização só em COLUNA GERADA.
--   D4 -> refund_value é dólar. VALUE_OUTLIER deixa de ser rejeito e passa a check.
--         Previsão de rejeito caiu de 133 para 45 linhas.
--   Ordem canônica de interação CORRIGIDA para (recorded_at, id) — a do legado,
--   vinda de my_follow_ups(). A anterior errava o status de 37 tickets.
-- =====================================================================


-- =====================================================================
-- R1 — CONSERVAÇÃO DE LINHAS   (critério: legado = novo + rejeitos)
-- É a verificação mais importante: prova que nenhuma linha sumiu.
-- =====================================================================
SET LOCAL statement_timeout = '30s';
SELECT 'services' AS tabela,
       (SELECT count(*) FROM legado.services)  AS legado,
       (SELECT count(*) FROM novo.tickets)     AS novo,
       (SELECT count(*) FROM migration_rejects WHERE source_table='services' AND run_id=:run) AS rejeitos,
       (SELECT count(*) FROM legado.services)
         = (SELECT count(*) FROM novo.tickets)
         + (SELECT count(*) FROM migration_rejects WHERE source_table='services' AND run_id=:run) AS ok
UNION ALL
SELECT 'service_follow_ups',
       (SELECT count(*) FROM legado.service_follow_ups),
       (SELECT count(*) FROM novo.interactions),
       (SELECT count(*) FROM migration_rejects WHERE source_table='service_follow_ups' AND run_id=:run),
       (SELECT count(*) FROM legado.service_follow_ups)
         = (SELECT count(*) FROM novo.interactions)
         + (SELECT count(*) FROM migration_rejects WHERE source_table='service_follow_ups' AND run_id=:run)
UNION ALL
SELECT 'refunds',
       (SELECT count(*) FROM legado.refunds),
       (SELECT count(*) FROM novo.refunds),
       (SELECT count(*) FROM migration_rejects WHERE source_table='refunds' AND run_id=:run),
       (SELECT count(*) FROM legado.refunds)
         = (SELECT count(*) FROM novo.refunds)
         + (SELECT count(*) FROM migration_rejects WHERE source_table='refunds' AND run_id=:run)
UNION ALL
SELECT 'profiles',
       (SELECT count(*) FROM legado.profiles),
       (SELECT count(*) FROM novo.users),
       (SELECT count(*) FROM migration_rejects WHERE source_table='profiles' AND run_id=:run),
       (SELECT count(*) FROM legado.profiles)
         = (SELECT count(*) FROM novo.users)
         + (SELECT count(*) FROM migration_rejects WHERE source_table='profiles' AND run_id=:run);
-- Esperado em T0 ~ 26/09/2026:
--   services 102.743 = 102.741 + 2   (os 2 tickets de 1997)
--   follow_ups 59.715 = 59.715 + 0
--   refunds   5.710  = 5.707  + 3    (1 ano '0025' + 2 ano '0026')
--   (se as 40 de DATE_ORDER_VIOLATION forem rejeito em vez de NOT VALID,
--    refunds fica 5.710 = 5.667 + 43 — decidir antes de rodar)
--   profiles     47  =    47  + 0
-- CRITÉRIO: coluna `ok` = true em TODAS as linhas.


-- =====================================================================
-- R2 — IDENTIDADE PRESERVADA
-- =====================================================================
SET LOCAL statement_timeout = '30s';
SELECT
  (SELECT count(*) FROM novo.tickets WHERE legacy_id::uuid <> id)              AS id_nao_preservado,
  (SELECT count(*) FROM novo.tickets t
     WHERE NOT EXISTS (SELECT 1 FROM legado.services s WHERE s.id = t.legacy_id)) AS novo_sem_origem,
  (SELECT count(*) FROM legado.services s
     WHERE NOT EXISTS (SELECT 1 FROM novo.tickets t WHERE t.legacy_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM migration_rejects r
                        WHERE r.source_table='services' AND r.legacy_id=s.id AND r.run_id=:run))
                                                                               AS origem_sumida;
-- CRITÉRIO: 0, 0, 0.
-- `origem_sumida` > 0 significa linha que não virou registro NEM rejeito: dado perdido.


-- =====================================================================
-- R3 — DATAS CONVERTIDAS CORRETAMENTE
-- A segunda consulta é a que PROVA que a armadilha do substring foi evitada.
-- =====================================================================
SET LOCAL statement_timeout = '30s';
SELECT
  -- (a) a conversão bate com a regra canônica, ticket a ticket
  (SELECT count(*) FROM novo.tickets t JOIN legado.services s ON s.id = t.legacy_id
    WHERE t.business_day <> (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date)
      AS regra_canonica_violada,
  -- (b) quantos diferem do prefixo textual — TEM de ser 6.778
  (SELECT count(*) FROM novo.tickets t JOIN legado.services s ON s.id = t.legacy_id
    WHERE t.business_day <> substring(s.service_date,1,10)::date)
      AS diferem_do_prefixo_textual,
  -- (c) refunds
  (SELECT count(*) FROM novo.refunds n JOIN legado.refunds l ON l.id = n.legacy_id
    WHERE n.request_date <> l.request_date::date
       OR n.completion_date IS DISTINCT FROM l.completion_date::date)
      AS refunds_data_divergente;
-- CRITÉRIO: (a) = 0 · (b) = 6.778 · (c) = 0
--
-- ATENÇÃO: se (b) vier 0 em vez de 6.778, alguém usou substring(...,1,10)::date
--          e 6.778 tickets estão datados UM DIA ADIANTE. Ver 32 §3.1.1.


-- =====================================================================
-- R4 — SOMAS DE CONTROLE
-- =====================================================================

-- R4.a soma do valor de reembolso (tolerância por causa de double -> numeric)
SET LOCAL statement_timeout = '30s';
SELECT (SELECT sum(refund_value::numeric) FROM legado.refunds) AS soma_legado,
       (SELECT sum(refund_value)          FROM novo.refunds)   AS soma_novo,
       abs( (SELECT sum(refund_value::numeric) FROM legado.refunds)
          - (SELECT sum(refund_value)          FROM novo.refunds) ) < 0.01 AS ok;
-- Esperado: soma_legado = 2385239.01 · ok = true

-- R4.b contagem por agente e por mês
SET LOCAL statement_timeout = '30s';
SELECT coalesce(n.agente, l.agente) AS agente,
       coalesce(n.mes, l.mes)       AS mes,
       coalesce(l.legado,0)         AS legado,
       coalesce(n.novo,0)           AS novo
FROM (SELECT u.legacy_id AS agente, to_char(t.business_day,'YYYY-MM') AS mes, count(*) AS novo
        FROM novo.tickets t JOIN novo.users u ON u.id = t.creator_id
       GROUP BY 1,2) n
FULL JOIN (SELECT s.user_id AS agente,
                  to_char((s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,'YYYY-MM') AS mes,
                  count(*) AS legado
             FROM legado.services s GROUP BY 1,2) l
  ON l.agente = n.agente AND l.mes = n.mes
WHERE coalesce(n.novo,0) <> coalesce(l.legado,0)
ORDER BY 1,2;
-- CRITÉRIO: nenhuma linha (exceto o mês 1997-04, que tem os 2 rejeitos)

-- R4.c por produto
SET LOCAL statement_timeout = '30s';
SELECT coalesce(a.produto,b.produto) AS produto, coalesce(b.n,0) AS legado, coalesce(a.n,0) AS novo
FROM      (SELECT p.name AS produto, count(*) n FROM novo.tickets t
             JOIN novo.products p ON p.id = t.product_id GROUP BY 1) a
FULL JOIN (SELECT product AS produto, count(*) n FROM legado.services GROUP BY 1) b USING (produto)
WHERE coalesce(a.n,0) <> coalesce(b.n,0);
-- CRITÉRIO: nenhuma linha. Esperado 75 produtos.

-- R4.d por plataforma e por canal
--     D5: a conversão é LITERAL ('Nenhum' preservado), então compara coluna com
--     coluna e a igualdade tem de ser EXATA. Não há legacy_platform.
SET LOCAL statement_timeout = '30s';
SELECT coalesce(a.p,b.p) AS plataforma, coalesce(b.n,0) AS legado, coalesce(a.n,0) AS novo
FROM      (SELECT platform p, count(*) n FROM novo.tickets      GROUP BY 1) a
FULL JOIN (SELECT platform p, count(*) n FROM legado.services GROUP BY 1) b USING (p)
WHERE coalesce(a.n,0) <> coalesce(b.n,0);
-- CRITÉRIO: nenhuma linha.
-- ÚNICA exceção admissível: se a correção 'Logicall' -> 'LogiCall' (32 §3.1.3) for
-- aceita, aparecem 2 linhas (Logicall -1, LogiCall +1). Tem de estar na aprovação.


-- =====================================================================
-- R5 — INTEGRIDADE REFERENCIAL NO MODELO NOVO
-- =====================================================================
SET LOCAL statement_timeout = '30s';
SELECT
  (SELECT count(*) FROM novo.interactions i
     WHERE NOT EXISTS (SELECT 1 FROM novo.tickets t WHERE t.id = i.ticket_id))     AS interacao_sem_ticket,
  (SELECT count(*) FROM novo.interactions i
     WHERE NOT EXISTS (SELECT 1 FROM novo.users u WHERE u.id = i.actor_id))        AS interacao_sem_autor,
  (SELECT count(*) FROM novo.tickets t
     WHERE NOT EXISTS (SELECT 1 FROM novo.users u WHERE u.id = t.creator_id))      AS ticket_sem_criador,
  (SELECT count(*) FROM novo.tickets t
     WHERE NOT EXISTS (SELECT 1 FROM novo.users u WHERE u.id = t.current_owner_id))AS ticket_sem_dono,
  (SELECT count(*) FROM novo.refunds r WHERE r.ticket_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM novo.tickets t WHERE t.id = r.ticket_id))       AS reembolso_sem_ticket;
-- CRITÉRIO: 0 em tudo.
-- `ticket_sem_criador` = 5.665 significa que os 2 perfis SEM auth.users foram recusados
-- por `novo.users`. Ver 31 §4.8 e 32 §12 (C10).


-- =====================================================================
-- R6 — NUMERAÇÃO DAS INTERAÇÕES
-- =====================================================================
SET LOCAL statement_timeout = '30s';
SELECT
  (SELECT count(*) FROM (
     SELECT ticket_id, count(*) n, max(seq) mx, count(DISTINCT seq) d
       FROM novo.interactions GROUP BY ticket_id) t
    WHERE t.n <> t.mx OR t.n <> t.d)                              AS tickets_com_seq_quebrado,
  (SELECT count(*) FROM legado.service_follow_ups)                AS legado,
  (SELECT count(*) FROM novo.interactions)                        AS novo,
  (SELECT count(*) FROM legado.service_follow_ups)
    = (SELECT count(*) FROM novo.interactions)                    AS contagem_ok;
-- CRITÉRIO: tickets_com_seq_quebrado = 0 · contagem_ok = true
-- (seq sem buraco e sem duplicata: n = max(seq) = count(distinct seq))


-- =====================================================================
-- R7 — MÉTRICA ANTIGA versus MÉTRICA NOVA   (a que o dono vai olhar)
-- Rodar UMA VEZ POR MÊS de 2026-01 a 2026-09. Não rodar o período todo de uma vez.
-- =====================================================================
SET LOCAL statement_timeout = '30s';
WITH legado AS (
  SELECT day, user_id, count(*) AS n
    FROM public._interaction_events(:from, :to, NULL)
   GROUP BY day, user_id
), novo AS (
  SELECT r.day, u.legacy_id AS user_id, r.interaction_count AS n
    FROM novo.daily_rollups r JOIN novo.users u ON u.id = r.agent_id
   WHERE r.day BETWEEN :from AND :to
)
SELECT coalesce(l.day, n.day)         AS dia,
       coalesce(l.user_id, n.user_id) AS agente,
       coalesce(l.n,0)                AS legado,
       coalesce(n.n,0)                AS novo,
       coalesce(n.n,0) - coalesce(l.n,0) AS diff
FROM legado l
FULL JOIN novo n ON n.day = l.day AND n.user_id = l.user_id
WHERE coalesce(l.n,0) <> coalesce(n.n,0)
ORDER BY 1,2;
-- CRITÉRIO: nenhuma linha.
--
-- Baseline medido em 26/09/2026 para AGOSTO/2026 (:from='2026-08-01', :to='2026-08-31'):
--   total_eventos      19.451
--   eventos 'service'   9.399
--   eventos 'follow_up'10.052
--   agentes distintos      13
--   dias cobertos          26
--   por canal:      SMS 10.363 · Email 8.960 · Clickbank 72 · <null> 54 · Nenhum 2
--   por plataforma: Cartpanda 8.865 · Buygoods 6.714 · Nenhum 2.359 · ClickBank 668
--                   LogiCall 414 · PagAmerican 236 · SalesBound 68 · CartCandy 56
--                   <null> 40 · Digistore24 30 · Logicall 1
--
-- ATENÇÃO (D5): os 2.359 eventos com platform='Nenhum' e o 1 com 'Logicall' têm de ser
--          REPRODUZIDOS termo a termo — a conversão é literal. Ver 32 §7.2.

-- R7.b conferência total do período contra a RPC crua
SET LOCAL statement_timeout = '30s';
SELECT (SELECT count(*) FROM public._interaction_events(:from,:to,NULL))            AS legado_total,
       (SELECT coalesce(sum(interaction_count),0) FROM novo.daily_rollups
         WHERE day BETWEEN :from AND :to)                                          AS novo_total;
-- CRITÉRIO: iguais.


-- =====================================================================
-- R8 — ROLLUP LEGADO versus ROLLUP NOVO
-- ÚNICA verificação que pode acusar diferença legitimamente:
-- agent_daily_service_counts é cache mantido por trigger DURANTE uma conversão de
-- tipo, e pode estar errado em algum dia. Divergência é INFORMAÇÃO. Ver 30, emenda 2.
--
-- LEMBRETE: a tabela legada conta TICKET, não interação.
--           daily_rollups.ticket_count  <->  agent_daily_service_counts.service_count
-- =====================================================================
SET LOCAL statement_timeout = '30s';
SELECT coalesce(c.user_id, r.user_id) AS agente,
       coalesce(c.day, r.day)         AS dia,
       coalesce(c.service_count,0)    AS legado,
       coalesce(r.ticket_count,0)     AS novo
FROM legado.agent_daily_service_counts c
FULL JOIN (SELECT u.legacy_id AS user_id, r.day::text AS day, r.ticket_count
             FROM novo.daily_rollups r JOIN novo.users u ON u.id = r.agent_id) r
  ON r.user_id = c.user_id AND r.day = c.day
WHERE coalesce(c.service_count,0) <> coalesce(r.ticket_count,0)
ORDER BY 1,2;
-- CRITÉRIO: nenhuma linha, OU toda divergência registrada como ROLLUP_DIVERGENCE
--           em migration_checks, com explicação.
-- Nota: a tabela legada tem min(day)='1997-04-28' — os 2 tickets rejeitados aparecem aqui.


-- =====================================================================
-- R9 — VOCABULÁRIO COMPLETO (nenhum valor do legado ficou fora do enum novo)
-- =====================================================================
SET LOCAL statement_timeout = '30s';
SELECT 'channel' AS dimensao, v FROM (
  SELECT DISTINCT legacy_channel AS v FROM novo.tickets WHERE legacy_channel IS NOT NULL
  EXCEPT SELECT unnest(enum_range(NULL::novo.channel))::text) z
UNION ALL
SELECT 'contact_reason', v FROM (
  SELECT DISTINCT contact_reason::text FROM legado.services WHERE contact_reason IS NOT NULL
  EXCEPT SELECT unnest(enum_range(NULL::novo.contact_reason))::text) z
UNION ALL
SELECT 'sales_platform', v FROM (
  SELECT DISTINCT sales_platform FROM legado.refunds
  EXCEPT SELECT unnest(enum_range(NULL::novo.sales_platform))::text) z
UNION ALL
SELECT 'refund_percent', v FROM (
  SELECT DISTINCT refund_type FROM legado.refunds WHERE refund_type IS NOT NULL
  EXCEPT SELECT unnest(enum_range(NULL::novo.refund_percent))::text) z;
-- CRITÉRIO: nenhuma linha.
-- ATENÇÃO (32 §12, C3): sales_platform tem 10 valores em produção —
--   Cartpanda, Buygoods, ClickBank, Hotmart, PagAmerican, LogiCall,
--   SalesBound, Nenhum, CartCandy, Digistore24.
--   'Hotmart' (143 linhas) existe SÓ em refunds. Um enum derivado de services o perde.
-- refund_percent: os 20 valores reais são todos múltiplos de 5, de '05%' a '100%'.


-- =====================================================================
-- R10 — REJEITOS DENTRO DO PREVISTO
-- =====================================================================
SET LOCAL statement_timeout = '30s';
SELECT reason_code, source_table, count(*)
FROM migration_rejects WHERE run_id = :run
GROUP BY 1,2 ORDER BY 3 DESC;
-- CRITÉRIO: total <= 45, e SOMENTE nestes códigos:
--   DATE_OUT_OF_RANGE    ~5   (2 em services [1997] + 3 em refunds [anos 0025/0026])
--   DATE_ORDER_VIOLATION ~40
-- VALUE_OUTLIER saiu daqui: D4 confirmou dólar, então os 88 são CHECK, não rejeito.
-- Qualquer linha em ID_NOT_UUID, FK_ORPHAN, ENUM_UNKNOWN, CONTACT_INVALID ou
-- DUPLICATE_LEGACY_ID significa BACKFILL ERRADO, não dado ruim: a etapa PARA.

SET LOCAL statement_timeout = '30s';
SELECT check_code, count(*), count(*) FILTER (WHERE reviewed) AS revisados
FROM migration_checks WHERE run_id = :run GROUP BY 1 ORDER BY 2 DESC;
-- Esperado: STATUS_DIVERGENCE ~10.1 mil · LEGACY_DATE_SHIFT 6.778
--           REFUND_WITHOUT_ANY_TICKET 388 · ORDER_AMBIGUOUS 216 · EMAIL_CASE_COLLISION 179
--           VALUE_OUTLIER 88 · TIE_AMBIGUOUS_STATUS 69
-- PLATFORM_SENTINEL saiu: com D5 não há transformação de 'Nenhum' para registrar.


-- =====================================================================
-- R11 — O STATUS QUE A TELA MOSTRA HOJE  (linha de base de derived_status)
-- Ordem canônica do legado: (recorded_at, id), de my_follow_ups().
-- O fallback em services.status está em useStatusTracking.ts:87 e vale 1.220 tickets.
-- =====================================================================
SET LOCAL statement_timeout = '15s';
WITH f AS MATERIALIZED (SELECT service_id, status, recorded_at, id FROM legado.service_follow_ups),
legado AS (
  SELECT DISTINCT ON (service_id) service_id, status AS st
  FROM f ORDER BY service_id, recorded_at DESC, id DESC
)
SELECT CASE
         WHEN l.st IS NULL AND s.status='concluido' THEN 'Concluido (via services.status)'
         WHEN l.st IS NULL                          THEN 'Em Aberto'
         WHEN l.st='concluido'                      THEN 'Concluido (via follow-up)'
         ELSE 'Em Andamento' END AS exibido,
       count(*)
FROM legado.services s LEFT JOIN legado l ON l.service_id = s.id
GROUP BY 1 ORDER BY count(*) DESC;
-- Medido em 26/09/2026:
--   Em Aberto                        71.798
--   Em Andamento                     19.699
--   Concluido (via follow-up)        10.085
--   Concluido (via services.status)   1.220   <-- C8: some sem o fallback
--
-- derived_status do modelo novo tem de reproduzir esta tabela linha por linha:
SET LOCAL statement_timeout = '30s';
SELECT count(*) FROM novo.tickets t
WHERE t.legacy_status = 'concluido'
  AND NOT EXISTS (SELECT 1 FROM novo.interactions i WHERE i.ticket_id = t.id)
  AND t.derived_status <> 'concluido';
-- CRITÉRIO: 0.  (sem o fallback seriam 1.220)


-- =====================================================================
-- R12 — PROVA DO FUSO DE created_at  (pendência C6 da trilha de backend)
-- created_at de services/refunds/profiles/goals/products é `timestamp` SEM fuso.
-- Se for UTC, created_at AT TIME ZONE 'UTC' nunca é POSTERIOR à primeira interação.
-- Se alguém tratar como hora local, fica 3h à frente — o que é impossível.
-- NÃO FOI EXECUTADA: é agregação sobre as duas tabelas grandes; rodar uma vez, sozinha.
-- =====================================================================
SET LOCAL statement_timeout = '15s';
WITH primeira AS (
  SELECT DISTINCT ON (service_id) service_id, recorded_at
  FROM legado.service_follow_ups ORDER BY service_id, recorded_at
)
SELECT count(*)                                                                   AS com_interacao,
       count(*) FILTER (WHERE s.created_at AT TIME ZONE 'UTC' <= p.recorded_at)    AS utc_coerente,
       count(*) FILTER (WHERE s.created_at                    >  p.recorded_at)    AS local_incoerente
FROM legado.services s JOIN primeira p ON p.service_id = s.id;
-- LEITURA: utc_coerente ~ com_interacao  => created_at é UTC, e a conversão correta
--          é `created_at AT TIME ZONE 'UTC'`, nunca `created_at::timestamptz`.
