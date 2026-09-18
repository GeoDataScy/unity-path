-- Pedidos em Espera — RPC de análise para a Área de Produtos.
--
-- A tela de produtos hoje mostra a MESMA lista da gestora: cinco contagens de
-- status e uma tabela. Isso responde "quantos tem". Não responde nada do que o time
-- de produtos decide: a fila está crescendo ou drenando? qual motivo produz mais
-- on-hold? em que lojas ele se concentra? o que está envelhecendo na cauda? o sync
-- rodou hoje?
--
-- Convenção do projeto (CLAUDE.md): métrica de gestão não se calcula no cliente.
-- Tudo abaixo é agregado no Postgres e volta pronto para o gráfico.
--
-- DEFINIÇÕES — as mesmas em todos os números desta RPC. É o que impede a tela de
-- contar uma história e a planilha outra:
--
--   aberto     closed_at IS NULL AND agent_status <> 'concluido'
--   saída      COALESCE(confirmed_at, closed_at) — o agente concluiu, ou o sync
--              encerrou porque o pedido sumiu do relatório da ShipOffers
--   entrada    first_seen_at — quando o pedido entrou na FILA. Não é imported_at
--              (data da planilha) nem order_date (data do pedido)
--   idade      dias em on-hold. Prefere days_held, que a ShipOffers já calcula e é
--              a fonte da verdade do fulfillment; cai para CURRENT_DATE - order_date
--              e, por último, para o tempo de fila
--   resolução  dias entre entrada e saída
--
-- Linhas repetidas (duplicate_of IS NOT NULL) ficam FORA de tudo: são resíduo de
-- auditoria de antes de 05/08/2026 e contá-las inflaria toda série temporal.
--
-- Fuso: recortes por dia em America/Sao_Paulo, como o resto do painel.
--
-- A função é STABLE e resolve tudo numa única query — as CTEs compartilham a mesma
-- leitura de held_orders, então nenhum painel da tela pode divergir de outro.

CREATE OR REPLACE FUNCTION public.produtos_held_orders_analytics(
  janela_dias int DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ini    date;
  v_hoje   date;
  v_janela int;
  v_out    jsonb;
BEGIN
  IF NOT (public.is_manager() OR public.is_produtos_team()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_janela := LEAST(GREATEST(COALESCE(janela_dias, 90), 7), 365);
  v_hoje   := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ini    := v_hoje - (v_janela - 1);

  WITH
  -- ==========================================================================
  -- Base: uma linha por pedido, com entrada, saída e idade já resolvidas.
  -- ==========================================================================
  base AS (
    SELECT
      o.id,
      o.dyna_code,
      o.store_name,
      o.reason,
      NULLIF(btrim(o.state), '')                                      AS estado,
      o.agent_status,
      o.assigned_to,
      o.synced_at,
      COALESCE(o.reopen_count, 0)                                     AS reopen_count,
      (o.closed_at IS NULL AND o.agent_status <> 'concluido')         AS aberto,
      (o.agent_status = 'concluido')                                  AS concluido,
      (o.closed_at IS NOT NULL)                                       AS encerrado_auto,
      (COALESCE(o.first_seen_at, o.imported_at) AT TIME ZONE 'America/Sao_Paulo')::date AS entrada,
      (COALESCE(o.confirmed_at, o.closed_at)    AT TIME ZONE 'America/Sao_Paulo')::date AS saida,
      CASE
        WHEN o.closed_at IS NULL AND o.agent_status <> 'concluido' THEN
          COALESCE(
            o.days_held,
            v_hoje - o.order_date,
            v_hoje - (COALESCE(o.first_seen_at, o.imported_at) AT TIME ZONE 'America/Sao_Paulo')::date
          )::numeric
      END                                                             AS idade,
      CASE
        WHEN COALESCE(o.confirmed_at, o.closed_at) IS NOT NULL THEN
          GREATEST(
            (COALESCE(o.confirmed_at, o.closed_at) AT TIME ZONE 'America/Sao_Paulo')::date
              - (COALESCE(o.first_seen_at, o.imported_at) AT TIME ZONE 'America/Sao_Paulo')::date,
            0)::numeric
      END                                                             AS resolucao
    FROM public.held_orders o
    WHERE o.duplicate_of IS NULL
  ),

  -- ==========================================================================
  -- 1) KPIs
  -- ==========================================================================
  kpis AS (
    SELECT jsonb_build_object(
      'abertos',            count(*) FILTER (WHERE aberto),
      'aguardando',         count(*) FILTER (WHERE aberto AND agent_status <> 'em_andamento'),
      'em_andamento',       count(*) FILTER (WHERE aberto AND agent_status =  'em_andamento'),
      'sem_agente',         count(*) FILTER (WHERE aberto AND assigned_to IS NULL),
      'concluidos_agente',  count(*) FILTER (WHERE concluido),
      'encerrados_auto',    count(*) FILTER (WHERE encerrado_auto AND NOT concluido),
      'reabertos',          COALESCE(sum(reopen_count), 0),
      -- Fila que o sync ainda não reconheceu. Enquanto for alto, o `encerrados` do
      -- Wall-E não limpa essa parte da fila — ver divergência B na migração do sync.
      'legado_fora_do_sync', count(*) FILTER (WHERE aberto AND synced_at IS NULL),
      'idade_media',        ROUND(AVG(idade) FILTER (WHERE aberto), 1),
      'idade_p50',          ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY idade) FILTER (WHERE aberto))::numeric, 1),
      'idade_p90',          ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY idade) FILTER (WHERE aberto))::numeric, 1),
      'idade_max',          MAX(idade) FILTER (WHERE aberto),
      'resolucao_media',    ROUND(AVG(resolucao) FILTER (WHERE saida >= v_ini), 1),
      'entradas_janela',    count(*) FILTER (WHERE entrada >= v_ini),
      'saidas_janela',      count(*) FILTER (WHERE saida   >= v_ini)
    ) AS j
    FROM base
  ),

  -- ==========================================================================
  -- 2) Fluxo diário: entradas x saídas x backlog acumulado.
  --
  -- O backlog não pode ser somado só dentro da janela — a fila já existia antes
  -- dela. Começa do estoque real na véspera e acumula o saldo dia a dia. É essa
  -- curva que responde "a fila está drenando ou empilhando", que nem entradas nem
  -- saídas sozinhas respondem.
  -- ==========================================================================
  serie AS (
    SELECT generate_series(v_ini, v_hoje, interval '1 day')::date AS dia
  ),
  ent AS (
    SELECT entrada AS dia, count(*)::int AS n FROM base
    WHERE entrada BETWEEN v_ini AND v_hoje GROUP BY 1
  ),
  sai AS (
    SELECT saida AS dia, count(*)::int AS n FROM base
    WHERE saida BETWEEN v_ini AND v_hoje GROUP BY 1
  ),
  estoque_inicial AS (
    SELECT count(*)::int AS n FROM base
    WHERE entrada < v_ini AND (saida IS NULL OR saida >= v_ini)
  ),
  dias AS (
    SELECT s.dia, COALESCE(e.n, 0) AS entradas, COALESCE(x.n, 0) AS saidas
    FROM serie s
    LEFT JOIN ent e ON e.dia = s.dia
    LEFT JOIN sai x ON x.dia = s.dia
  ),
  fluxo AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'dia', dia, 'entradas', entradas, 'saidas', saidas, 'backlog', backlog
    ) ORDER BY dia), '[]'::jsonb) AS j
    FROM (
      SELECT
        d.dia, d.entradas, d.saidas,
        (SELECT n FROM estoque_inicial) + SUM(d.entradas - d.saidas) OVER (ORDER BY d.dia) AS backlog
      FROM dias d
    ) t
  ),

  -- ==========================================================================
  -- 3) Envelhecimento da fila aberta (aging buckets).
  --
  -- Média de idade esconde o que importa: a cauda. Média 9 com p90 40 é uma fila
  -- com problema crônico num canto só, e é esse canto que o time precisa ver.
  -- ==========================================================================
  faixas AS (
    SELECT * FROM (VALUES
      (1, '0-3 dias',   0,      3),
      (2, '4-7 dias',   4,      7),
      (3, '8-14 dias',  8,     14),
      (4, '15-30 dias', 15,    30),
      (5, '31-60 dias', 31,    60),
      (6, '60+ dias',   61, 100000)
    ) AS f(ordem, faixa, lo, hi)
  ),
  envelhecimento AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'ordem', ordem, 'faixa', faixa, 'total', total
    ) ORDER BY ordem), '[]'::jsonb) AS j
    FROM (
      SELECT f.ordem, f.faixa,
             (SELECT count(*)::int FROM base b
               WHERE b.aberto AND b.idade BETWEEN f.lo AND f.hi) AS total
      FROM faixas f
    ) t
  ),

  -- ==========================================================================
  -- 4) Pareto de motivos.
  --
  -- `reason` vem da ShipOffers como lista separada por vírgula
  -- ("address-verification-failed, Held for Bad Address"), então um pedido conta em
  -- mais de um motivo — é o comportamento certo para causa raiz, e a soma dos
  -- motivos é MAIOR que o total de pedidos de propósito.
  -- A normalização (minúsculo, hífen/underscore -> espaço) é a mesma de
  -- src/features/held-orders/format.ts, para tela e banco agruparem igual.
  -- ==========================================================================
  explodido AS (
    SELECT
      b.aberto,
      b.idade,
      regexp_replace(lower(btrim(m.motivo)), '[-_]+', ' ', 'g') AS motivo
    FROM base b
    CROSS JOIN LATERAL unnest(string_to_array(COALESCE(b.reason, ''), ',')) AS m(motivo)
    WHERE NULLIF(btrim(m.motivo), '') IS NOT NULL
  ),
  motivo_agg AS (
    SELECT
      motivo,
      count(*)::int                              AS total,
      count(*) FILTER (WHERE aberto)::int        AS abertos,
      ROUND(AVG(idade) FILTER (WHERE aberto), 1) AS idade_media
    FROM explodido
    GROUP BY motivo
  ),
  motivo_rank AS (
    SELECT
      a.*,
      SUM(a.total) OVER ()                               AS total_geral,
      SUM(a.total) OVER (ORDER BY a.total DESC, a.motivo) AS acumulado,
      ROW_NUMBER() OVER (ORDER BY a.total DESC, a.motivo) AS rn
    FROM motivo_agg a
  ),
  motivos AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'motivo', motivo,
      'total', total,
      'abertos', abertos,
      'idade_media', idade_media,
      'pct_acumulado', ROUND(100.0 * acumulado / NULLIF(total_geral, 0), 1)
    ) ORDER BY rn), '[]'::jsonb) AS j
    FROM motivo_rank WHERE rn <= 12
  ),

  -- ==========================================================================
  -- 5) Concentração por loja (dyna code + nome do produto que o sync passa a trazer)
  -- ==========================================================================
  lojas AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'loja', dyna_code,
      'loja_nome', store_name,
      'abertos', abertos,
      'total', total,
      'idade_media', idade_media
    ) ORDER BY abertos DESC, total DESC, dyna_code), '[]'::jsonb) AS j
    FROM (
      SELECT
        b.dyna_code,
        -- store_name só existe nas linhas vindas do sync; pega o que houver.
        MAX(b.store_name)                              AS store_name,
        count(*)::int                                  AS total,
        count(*) FILTER (WHERE b.aberto)::int          AS abertos,
        ROUND(AVG(b.idade) FILTER (WHERE b.aberto), 1) AS idade_media
      FROM base b
      GROUP BY b.dyna_code
      ORDER BY count(*) FILTER (WHERE b.aberto) DESC, count(*) DESC
      LIMIT 15
    ) t
  ),

  -- ==========================================================================
  -- 6) Geografia — o motivo campeão é endereço ruim, então onde ele bate importa.
  -- ==========================================================================
  estados AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'estado', estado, 'abertos', abertos
    ) ORDER BY abertos DESC, estado), '[]'::jsonb) AS j
    FROM (
      SELECT b.estado, count(*)::int AS abertos
      FROM base b
      WHERE b.aberto AND b.estado IS NOT NULL
      GROUP BY b.estado
      ORDER BY count(*) DESC
      LIMIT 10
    ) t
  ),

  -- ==========================================================================
  -- 7) Saúde da integração — o time precisa saber se o número na tela é de hoje
  --    ou de três dias atrás.
  -- ==========================================================================
  sync AS (
    SELECT to_jsonb(s) AS j
    FROM (
      SELECT
        b.referencia,
        b.gerado_em,
        b.processado_em,
        b.completo,
        b.recebidos,
        b.criados,
        b.atualizados,
        b.reabertos,
        b.encerrados,
        jsonb_array_length(b.rejeitados) AS rejeitados,
        (v_hoje - b.referencia)          AS dias_desde
      FROM public.held_order_sync_batches b
      ORDER BY b.referencia DESC, b.pagina DESC
      LIMIT 1
    ) s
  )

  SELECT jsonb_build_object(
    'gerado_em',      now(),
    'janela_dias',    v_janela,
    'kpis',           (SELECT j FROM kpis),
    'fluxo',          (SELECT j FROM fluxo),
    'envelhecimento', (SELECT j FROM envelhecimento),
    'motivos',        (SELECT j FROM motivos),
    'lojas',          (SELECT j FROM lojas),
    'estados',        (SELECT j FROM estados),
    'sync',           (SELECT j FROM sync)
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.produtos_held_orders_analytics(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.produtos_held_orders_analytics(int) TO authenticated;

NOTIFY pgrst, 'reload schema';
