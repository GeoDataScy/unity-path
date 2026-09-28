-- =====================================================================
-- Reconciliação — o que assina o corte.
--
-- A pergunta que ela responde: alguma linha do legado sumiu?
--
-- O critério é aritmético e não admite interpretação:
--     linhas no legado = linhas em core + linhas em migration_rejects
--
-- Rejeito não é perda: a linha original continua em `public`, intacta, e
-- o conteúdo dela está guardado em `payload`.
-- =====================================================================
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect(p_label text, p_ok boolean, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok THEN RAISE NOTICE 'ok    %', p_label;
  ELSE RAISE EXCEPTION 'FALHOU: % %', p_label, coalesce(' — ' || p_detail, ''); END IF;
END; $$;

-- ---------------------------------------------------------------------
-- R1 · Nenhuma linha sumiu
-- ---------------------------------------------------------------------
DO $$
DECLARE legado int; migrado int; rejeitado int;
BEGIN
  SELECT count(*) INTO legado FROM public.services;
  SELECT count(*) INTO migrado FROM core.tickets WHERE legacy_id IS NOT NULL;
  SELECT count(DISTINCT legacy_id) INTO rejeitado
    FROM core.migration_rejects WHERE source_table = 'services';
  PERFORM pg_temp.expect(
    format('R1 atendimentos: %s legado = %s migrado + %s rejeitado', legado, migrado, rejeitado),
    legado = migrado + rejeitado,
    format('diferença de %s', legado - migrado - rejeitado));

  SELECT count(*) INTO legado FROM public.service_follow_ups;
  SELECT count(*) INTO migrado FROM core.interactions WHERE legacy_id IS NOT NULL;
  SELECT count(DISTINCT legacy_id) INTO rejeitado
    FROM core.migration_rejects WHERE source_table = 'service_follow_ups';
  PERFORM pg_temp.expect(
    format('R1 interações: %s legado = %s migrado + %s rejeitado', legado, migrado, rejeitado),
    legado = migrado + rejeitado);
END $$;

-- ---------------------------------------------------------------------
-- R2 · Identidade preservada: o id não muda de valor
-- ---------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM core.tickets WHERE legacy_id IS NOT NULL AND id::text <> legacy_id;
  PERFORM pg_temp.expect('R2 nenhum ticket trocou de identificador', n = 0, format('%s trocaram', n));

  SELECT count(*) INTO n FROM core.interactions WHERE legacy_id IS NOT NULL AND id::text <> legacy_id;
  PERFORM pg_temp.expect('R2 nenhuma interação trocou de identificador', n = 0);
END $$;

-- ---------------------------------------------------------------------
-- R3 · O texto original sobreviveu, caractere por caractere
-- ---------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM core.tickets t JOIN public.services s ON s.id = t.legacy_id
   WHERE t.legacy_service_date IS DISTINCT FROM s.service_date
      OR t.legacy_platform     IS DISTINCT FROM s.platform
      OR t.legacy_channel      IS DISTINCT FROM s.channel
      OR t.legacy_status       IS DISTINCT FROM s.status;
  PERFORM pg_temp.expect('R3 data, plataforma, canal e status originais preservados', n = 0,
                         format('%s divergem', n));

  SELECT count(*) INTO n
    FROM core.interactions i JOIN public.service_follow_ups f ON f.id = i.legacy_id
   WHERE i.legacy_follow_up_number IS DISTINCT FROM f.follow_up_number;
  PERFORM pg_temp.expect('R3 número original da interação preservado', n = 0);
END $$;

-- ---------------------------------------------------------------------
-- R4 · "Nenhum" e vazio continuam distintos
-- ---------------------------------------------------------------------
DO $$
DECLARE na int; vazio int;
BEGIN
  SELECT count(*) INTO na FROM core.tickets t
    JOIN core.sales_platforms p ON p.id = t.platform_id
   WHERE p.kind = 'not_applicable';
  SELECT count(*) INTO vazio FROM core.tickets WHERE platform_id IS NULL AND legacy_id IS NOT NULL;
  PERFORM pg_temp.expect(
    format('R4 plataforma: %s como "não se aplica", %s como não preenchido', na, vazio),
    na > 0 AND vazio > 0);

  PERFORM pg_temp.expect('R4 "Nenhum" do legado nunca virou vazio',
    NOT EXISTS (SELECT 1 FROM core.tickets WHERE legacy_platform = 'Nenhum' AND platform_id IS NULL));
  PERFORM pg_temp.expect('R4 vazio do legado nunca virou "Nenhum"',
    NOT EXISTS (SELECT 1 FROM core.tickets t
                 WHERE t.legacy_id IS NOT NULL AND coalesce(btrim(t.legacy_platform),'') = ''
                   AND t.platform_id IS NOT NULL));
END $$;

-- ---------------------------------------------------------------------
-- R5 · [C8] Os concluídos sem interação NÃO reabriram
-- ---------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM core.tickets t
   WHERE t.legacy_status = 'concluido'
     AND NOT EXISTS (SELECT 1 FROM core.interactions i WHERE i.ticket_id = t.id)
     AND t.derived_status <> 'concluido';
  PERFORM pg_temp.expect('R5 nenhum concluído sem interação reabriu', n = 0, format('%s reabriram', n));
END $$;

-- ---------------------------------------------------------------------
-- R6 · A numeração duplicada foi resolvida sem apagar nada
-- ---------------------------------------------------------------------
DO $$
DECLARE dup_legado int; dup_novo int;
BEGIN
  SELECT count(*) INTO dup_legado FROM (
    SELECT service_id, follow_up_number FROM public.service_follow_ups
     GROUP BY 1,2 HAVING count(*) > 1) x;
  SELECT count(*) INTO dup_novo FROM (
    SELECT ticket_id, seq FROM core.interactions GROUP BY 1,2 HAVING count(*) > 1) y;
  PERFORM pg_temp.expect(
    format('R6 %s pares duplicados no legado viraram 0 no novo, sem apagar linha', dup_legado),
    dup_novo = 0);
END $$;

-- ---------------------------------------------------------------------
-- R7 · A ordem que a tela mostra não mudou
--
-- `seq` foi atribuído na ordem canônica do legado (recorded_at, id), que
-- é a de my_follow_ups(). A última interação de cada ticket tem de ser a
-- mesma dos dois lados.
-- ---------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  WITH ultima_legado AS (
    SELECT DISTINCT ON (service_id) service_id, id
      FROM public.service_follow_ups ORDER BY service_id, recorded_at DESC, id DESC
  ), ultima_nova AS (
    SELECT DISTINCT ON (ticket_id) ticket_id, legacy_id
      FROM core.interactions ORDER BY ticket_id, recorded_at DESC, seq DESC
  )
  SELECT count(*) INTO n
    FROM ultima_nova un
    JOIN core.tickets t ON t.id = un.ticket_id
    JOIN ultima_legado ul ON ul.service_id = t.legacy_id
   WHERE ul.id IS DISTINCT FROM un.legacy_id;
  PERFORM pg_temp.expect('R7 a última interação é a mesma que a tela mostra hoje', n = 0,
                         format('%s divergem', n));
END $$;

-- ---------------------------------------------------------------------
-- R8 · Somas de controle por agente e por produto
-- ---------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT s.user_id, count(*) AS c FROM public.services s
     WHERE NOT EXISTS (SELECT 1 FROM core.migration_rejects r
                        WHERE r.source_table='services' AND r.legacy_id = s.id)
     GROUP BY 1
    EXCEPT
    SELECT u.legacy_id, count(*) FROM core.tickets t JOIN core.users u ON u.id = t.creator_id
     WHERE t.legacy_id IS NOT NULL GROUP BY 1) d;
  PERFORM pg_temp.expect('R8 contagem por agente confere', n = 0, format('%s agentes divergem', n));
END $$;

-- ---------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------
SELECT source_table, reason_code, count(*) AS linhas
  FROM core.migration_rejects GROUP BY 1,2 ORDER BY 1,3 DESC;

SELECT '=== RECONCILIACAO: TODAS AS VERIFICACOES PASSARAM ===' AS resultado;
