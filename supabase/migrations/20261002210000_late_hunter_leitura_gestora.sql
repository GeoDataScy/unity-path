-- A gestora passa a entrar na Área de Produtos (decisão do dono, 02/10/2026:
-- "manager pode acessar todos"). As três leituras do Late Hunter aceitavam só
-- o time de produtos; agora aceitam também a gestora.
--
-- Corpo idêntico ao de 20261002190000_late_hunter.sql, com UMA troca por função:
-- a linha da guarda. Nada de escrita foi aberto — late_hunter_sync continua só
-- para service_role.
--
-- O copy NÃO entra em Produtos (só na área dele).

-- Visão geral: saúde do último sync, KPIs, envelhecimento, fluxo diário e as
-- quebras que alimentam gráficos e opções de filtro.
CREATE OR REPLACE FUNCTION public.late_hunter_overview(p_ambiente text DEFAULT 'producao')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT (public.is_manager() OR public.is_produtos_team()) THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH abertos AS (
    SELECT * FROM public.late_hunter_orders WHERE ambiente = p_ambiente AND situacao = 'aberto'
  ),
  ultimo AS (
    SELECT * FROM public.late_hunter_syncs WHERE ambiente = p_ambiente
    ORDER BY recebido_em DESC LIMIT 1
  ),
  ultima_ref AS (
    SELECT max(referencia) AS ref FROM public.late_hunter_syncs WHERE ambiente = p_ambiente
  ),
  -- Últimas 30 referências: estoque aberto ao fim do dia + entradas/saídas.
  refs AS (
    SELECT DISTINCT referencia FROM public.late_hunter_syncs
    WHERE ambiente = p_ambiente ORDER BY referencia DESC LIMIT 30
  ),
  fluxo AS (
    SELECT r.referencia,
      -- Lote antigo reprocessado depois não descreve o dia dele: o estoque
      -- daquela hora já é o de um dia mais novo.
      (SELECT s.abertos_apos FROM public.late_hunter_syncs s
        WHERE s.ambiente = p_ambiente AND s.referencia = r.referencia AND s.encerramento <> 'lote_antigo'
        ORDER BY s.recebido_em DESC LIMIT 1) AS abertos,
      (SELECT count(*) FROM public.late_hunter_order_events e
        WHERE e.ambiente = p_ambiente AND e.referencia = r.referencia AND e.evento IN ('criado', 'reaberto')) AS entraram,
      (SELECT count(*) FROM public.late_hunter_order_events e
        WHERE e.ambiente = p_ambiente AND e.referencia = r.referencia AND e.evento = 'encerrado') AS sairam
    FROM refs r
  ),
  faixas AS (
    SELECT
      CASE
        WHEN dias_em_espera IS NULL THEN 'sem_dado'
        WHEN dias_em_espera <= 3  THEN '0-3'
        WHEN dias_em_espera <= 7  THEN '4-7'
        WHEN dias_em_espera <= 14 THEN '8-14'
        WHEN dias_em_espera <= 30 THEN '15-30'
        WHEN dias_em_espera <= 60 THEN '31-60'
        ELSE '60+'
      END AS faixa,
      count(*) AS n
    FROM abertos GROUP BY 1
  ),
  todos AS (
    SELECT * FROM public.late_hunter_orders WHERE ambiente = p_ambiente
  )
  SELECT jsonb_build_object(
    'ultimo_sync', (SELECT to_jsonb(u) - 'id' FROM ultimo u),
    'kpis', jsonb_build_object(
      'abertos',          (SELECT count(*) FROM abertos),
      'encerrados',       (SELECT count(*) FROM todos WHERE situacao = 'encerrado'),
      'mais_30_dias',     (SELECT count(*) FROM abertos WHERE dias_em_espera > 30),
      'reabertos_abertos',(SELECT count(*) FROM abertos WHERE vezes_reaberto > 0),
      'mediana_dias',     (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dias_em_espera) FROM abertos),
      'p90_dias',         (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY dias_em_espera) FROM abertos),
      'entraram_ultimo',  (SELECT count(*) FROM public.late_hunter_order_events e, ultima_ref u
                            WHERE e.ambiente = p_ambiente AND e.referencia = u.ref AND e.evento IN ('criado', 'reaberto')),
      'sairam_ultimo',    (SELECT count(*) FROM public.late_hunter_order_events e, ultima_ref u
                            WHERE e.ambiente = p_ambiente AND e.referencia = u.ref AND e.evento = 'encerrado'),
      'clientes_abertos', (SELECT count(DISTINCT NULLIF(cliente_email, '')) FROM abertos)
    ),
    'envelhecimento', COALESCE((SELECT jsonb_object_agg(faixa, n) FROM faixas), '{}'::jsonb),
    'fluxo', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.referencia) FROM fluxo f), '[]'::jsonb),
    'motivos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('motivo', m, 'abertos', ab, 'total', tt) ORDER BY ab DESC, tt DESC, m)
      FROM (
        SELECT m, count(*) FILTER (WHERE t.situacao = 'aberto') AS ab, count(*) AS tt
        FROM todos t, unnest(t.motivos) AS m GROUP BY m
      ) x), '[]'::jsonb),
    'lojas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('loja', loja, 'loja_nome', nome, 'abertos', ab, 'total', tt,
                                          'mais_30_dias', velhos) ORDER BY ab DESC, tt DESC, loja)
      FROM (
        SELECT loja, max(loja_nome) AS nome,
               count(*) FILTER (WHERE situacao = 'aberto') AS ab, count(*) AS tt,
               count(*) FILTER (WHERE situacao = 'aberto' AND dias_em_espera > 30) AS velhos
        FROM todos GROUP BY loja
      ) x), '[]'::jsonb),
    'paises', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('pais', pais, 'abertos', ab, 'total', tt) ORDER BY ab DESC, tt DESC, pais)
      FROM (
        SELECT COALESCE(pais, '') AS pais, count(*) FILTER (WHERE situacao = 'aberto') AS ab, count(*) AS tt
        FROM todos GROUP BY 1
      ) x), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.late_hunter_overview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.late_hunter_overview(text) TO authenticated;

-- Lista filtrada e paginada. Paginação numerada (OFFSET) de propósito: a base é
-- pequena (centenas a poucos milhares de linhas por ambiente) e a tela tem
-- números de página como o resto do app.
CREATE OR REPLACE FUNCTION public.late_hunter_list(
  p_ambiente  text    DEFAULT 'producao',
  p_situacao  text    DEFAULT 'aberto',   -- aberto | encerrado | todos
  p_motivos   text[]  DEFAULT NULL,       -- pedido entra se tiver QUALQUER um
  p_lojas     text[]  DEFAULT NULL,
  p_paises    text[]  DEFAULT NULL,       -- '' = sem país
  p_dias_min  integer DEFAULT NULL,
  p_dias_max  integer DEFAULT NULL,
  p_data_de   date    DEFAULT NULL,
  p_data_ate  date    DEFAULT NULL,
  p_reabertos boolean DEFAULT false,
  p_busca     text    DEFAULT NULL,
  p_ordem     text    DEFAULT 'dias_desc',
  p_limite    integer DEFAULT 50,
  p_offset    integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_busca text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_total bigint;
  v_rows  jsonb;
BEGIN
  IF NOT (public.is_manager() OR public.is_produtos_team()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  -- Limite alto só para a exportação (planilha com todos os filtrados).
  p_limite := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 10000);
  p_offset := GREATEST(COALESCE(p_offset, 0), 0);

  WITH f AS (
    SELECT o.* FROM public.late_hunter_orders o
    WHERE o.ambiente = p_ambiente
      AND (p_situacao = 'todos' OR o.situacao = p_situacao)
      AND (p_motivos IS NULL OR cardinality(p_motivos) = 0 OR o.motivos && p_motivos)
      AND (p_lojas   IS NULL OR cardinality(p_lojas)   = 0 OR o.loja = ANY (p_lojas))
      AND (p_paises  IS NULL OR cardinality(p_paises)  = 0 OR COALESCE(o.pais, '') = ANY (p_paises))
      AND (p_dias_min IS NULL OR o.dias_em_espera >= p_dias_min)
      AND (p_dias_max IS NULL OR o.dias_em_espera <= p_dias_max)
      AND (p_data_de  IS NULL OR o.data_pedido >= p_data_de)
      AND (p_data_ate IS NULL OR o.data_pedido <= p_data_ate)
      AND (NOT COALESCE(p_reabertos, false) OR o.vezes_reaberto > 0)
      AND (v_busca IS NULL OR (
            o.pedido ILIKE '%' || v_busca || '%'
         OR o.cliente_email ILIKE '%' || v_busca || '%'
         OR o.cliente_nome ILIKE '%' || v_busca || '%'
         OR o.loja ILIKE '%' || v_busca || '%'
         OR COALESCE(o.loja_nome, '') ILIKE '%' || v_busca || '%'
         OR COALESCE(o.itens, '') ILIKE '%' || v_busca || '%'))
  ),
  pg AS (
    SELECT f.*, row_number() OVER (ORDER BY
        CASE WHEN p_ordem = 'dias_desc'  THEN dias_em_espera END DESC NULLS LAST,
        CASE WHEN p_ordem = 'dias_asc'   THEN dias_em_espera END ASC NULLS LAST,
        CASE WHEN p_ordem = 'data_desc'  THEN data_pedido END DESC,
        CASE WHEN p_ordem = 'data_asc'   THEN data_pedido END ASC,
        CASE WHEN p_ordem = 'recentes'   THEN primeira_referencia END DESC,
        CASE WHEN p_ordem = 'encerrados' THEN encerrado_em END DESC NULLS LAST,
        loja, pedido) AS rn
    FROM f
  )
  SELECT (SELECT count(*) FROM f),
         COALESCE((
           SELECT jsonb_agg(to_jsonb(x) - 'ambiente' - 'criado_em' - 'rn' ORDER BY x.rn)
           FROM (SELECT * FROM pg WHERE rn > p_offset ORDER BY rn LIMIT p_limite) x
         ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.late_hunter_list(text, text, text[], text[], text[], integer, integer, date, date, boolean, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.late_hunter_list(text, text, text[], text[], text[], integer, integer, date, date, boolean, text, text, integer, integer) TO authenticated;

-- Linha do tempo de um pedido (entrou, saiu, voltou).
CREATE OR REPLACE FUNCTION public.late_hunter_order_history(p_order_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_manager() OR public.is_produtos_team()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('evento', evento, 'referencia', referencia, 'ocorrido_em', ocorrido_em)
                     ORDER BY ocorrido_em, id)
    FROM public.late_hunter_order_events WHERE order_id = p_order_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.late_hunter_order_history(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.late_hunter_order_history(bigint) TO authenticated;
