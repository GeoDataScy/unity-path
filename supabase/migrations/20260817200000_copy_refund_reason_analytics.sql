-- Analytics de reembolsos para o time de copy (role copy_grup).
--
-- O painel do copy é sobre UMA pergunta: por que o cliente pede reembolso, e o
-- que isso diz sobre a promessa feita na copy/VSL. Então tudo aqui gira em
-- torno de `refund_reason_classifications.category` (o motivo normalizado).
--
-- Decisões de modelagem que a tela depende:
--
-- 1. O universo de análise são os reembolsos CONCLUÍDOS. Reembolso em aberto não
--    tem motivo preenchido no banco (o motivo é escolhido no diálogo de baixa),
--    então incluir os abertos só criaria um bucket "vazio" gigante. Os abertos
--    aparecem como contexto (`universe.em_aberto`), não no mix de motivos.
-- 2. Período recortado por `completion_date` — é a data em que o motivo passou a
--    existir. O período anterior de mesma duração é calculado no mesmo passo
--    para dar variação em pontos percentuais (Δ p.p.) por motivo.
-- 3. "Motivo declarado" exclui 'Outros' e 'Follow up (sem motivo declarado)':
--    são buckets de ausência de informação, e misturá-los com motivo real
--    inflaria o denominador de qualquer conclusão.
-- 4. Nada de PII: nenhuma função aqui devolve e-mail do cliente, nº do pedido
--    ou identificação de agente. O copy vê agregados e o texto do motivo (as
--    palavras do cliente), com e-mail/números longos mascarados por precaução.

-- ─────────────────────────────────────────────────────────────────────────────
-- Guardas de acesso
-- ─────────────────────────────────────────────────────────────────────────────

-- Gate na mesma fonte que o CopyLayout usa para liberar a tela: profiles.role.
-- (public.is_manager() olha user_roles; as duas tabelas carregam a role, mas o
-- app decide o mundo do usuário por profiles.role, então é essa que vale aqui.)
-- profiles.id é text e auth.uid() é uuid — daí o ::text.
-- profiles.role é do enum public."AppRole"; comparar como text evita depender
-- do nome do tipo (existem dois enums de role no banco, um deles órfão).
CREATE OR REPLACE FUNCTION public.is_copy_team()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())::text
      AND p.role::text = 'copy_grup'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_refund_analytics()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_manager() OR public.is_copy_team();
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────────────────────

-- refunds.request_date/completion_date são text. Uma única linha com lixo
-- derrubaria a tela inteira num `::date`; aqui vira NULL.
CREATE OR REPLACE FUNCTION public.text_to_date_safe(p_value text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $function$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(p_value)::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$function$;

-- Mesma regra do my_refunds_with_refunded_value: refund_value é o valor do
-- pedido, refund_type é o percentual devolvido ("80%").
CREATE OR REPLACE FUNCTION public.refund_refunded_value(p_refund_value numeric, p_refund_type text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_refund_value IS NULL OR p_refund_type IS NULL THEN NULL
    WHEN p_refund_type !~ '^\d{1,3}%$' THEN NULL
    WHEN replace(p_refund_type, '%', '')::numeric > 100 THEN NULL
    ELSE round(p_refund_value * (replace(p_refund_type, '%', '')::numeric / 100), 2)
  END;
$$;

-- Mascara e-mail e sequências longas de dígitos antes de mostrar texto livre.
CREATE OR REPLACE FUNCTION public.redact_free_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    ELSE regexp_replace(
           regexp_replace(p_value, '[[:alnum:]._%+-]+@[[:alnum:].-]+', '[e-mail]', 'g'),
           '\d{6,}', '[número]', 'g')
  END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC principal: um único jsonb com tudo que as duas telas do copy precisam.
-- Uma chamada só (banco é instância pequena; ver incidente de sobrecarga).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.copy_refund_reason_analytics(
  from_date date,
  to_date date,
  product_filter text DEFAULT 'all',
  platform_filter text DEFAULT 'all',
  channel_filter text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_span int;
  v_prev_from date;
  v_prev_to date;
  v_result jsonb;
BEGIN
  IF NOT public.can_read_refund_analytics() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_span := GREATEST(1, (to_date - from_date) + 1);
  v_prev_to := from_date - 1;
  v_prev_from := v_prev_to - (v_span - 1);

  WITH period_all AS (
    -- Tudo que fechou no período, sem os filtros locais: alimenta as listas de
    -- filtro (senão escolher um produto apagaria os outros da lista).
    SELECT
      COALESCE(NULLIF(btrim(r.product), ''), 'Não informado')        AS product,
      COALESCE(NULLIF(btrim(r.sales_platform), ''), 'Não informado') AS platform,
      COALESCE(NULLIF(btrim(r.channel), ''), 'Não informado')        AS channel
    FROM public.refunds r
    WHERE r.completion_date IS NOT NULL
      AND public.text_to_date_safe(r.completion_date) BETWEEN from_date AND to_date
  ),
  base AS (
    SELECT
      c.category,
      COALESCE(NULLIF(btrim(r.product), ''), 'Não informado')        AS product,
      COALESCE(NULLIF(btrim(r.sales_platform), ''), 'Não informado') AS platform,
      COALESCE(NULLIF(btrim(r.channel), ''), 'Não informado')        AS channel,
      -- refunds.refund_value é double precision; o cast para numeric é
      -- obrigatório (float8 → numeric não é conversão implícita, então a
      -- chamada abaixo nem resolveria) e mantém o dinheiro sem ruído binário.
      r.refund_value::numeric                                        AS order_value,
      public.refund_refunded_value(r.refund_value::numeric, r.refund_type) AS refunded_value,
      public.text_to_date_safe(r.completion_date)                     AS closed_on,
      CASE
        WHEN public.text_to_date_safe(r.request_date) >= DATE '2025-01-01'
         AND public.text_to_date_safe(r.completion_date) >= public.text_to_date_safe(r.request_date)
        THEN public.text_to_date_safe(r.completion_date) - public.text_to_date_safe(r.request_date)
      END                                                            AS days_to_close
    FROM public.refunds r
    JOIN public.refund_reason_classifications c ON c.refund_id = r.id
    WHERE r.completion_date IS NOT NULL
      AND public.text_to_date_safe(r.completion_date) BETWEEN from_date AND to_date
      AND (product_filter IS NULL OR product_filter = 'all'
           OR COALESCE(NULLIF(btrim(r.product), ''), 'Não informado') = product_filter)
      AND (platform_filter IS NULL OR platform_filter = 'all'
           OR COALESCE(NULLIF(btrim(r.sales_platform), ''), 'Não informado') = platform_filter)
      AND (channel_filter IS NULL OR channel_filter = 'all'
           OR COALESCE(NULLIF(btrim(r.channel), ''), 'Não informado') = channel_filter)
  ),
  prev AS (
    SELECT c.category
    FROM public.refunds r
    JOIN public.refund_reason_classifications c ON c.refund_id = r.id
    WHERE r.completion_date IS NOT NULL
      AND public.text_to_date_safe(r.completion_date) BETWEEN v_prev_from AND v_prev_to
      AND (product_filter IS NULL OR product_filter = 'all'
           OR COALESCE(NULLIF(btrim(r.product), ''), 'Não informado') = product_filter)
      AND (platform_filter IS NULL OR platform_filter = 'all'
           OR COALESCE(NULLIF(btrim(r.sales_platform), ''), 'Não informado') = platform_filter)
      AND (channel_filter IS NULL OR channel_filter = 'all'
           OR COALESCE(NULLIF(btrim(r.channel), ''), 'Não informado') = channel_filter)
  ),
  open_now AS (
    SELECT COUNT(*)::int AS n
    FROM public.refunds r
    WHERE r.completion_date IS NULL
      AND public.text_to_date_safe(r.request_date) BETWEEN from_date AND to_date
      AND (product_filter IS NULL OR product_filter = 'all'
           OR COALESCE(NULLIF(btrim(r.product), ''), 'Não informado') = product_filter)
      AND (platform_filter IS NULL OR platform_filter = 'all'
           OR COALESCE(NULLIF(btrim(r.sales_platform), ''), 'Não informado') = platform_filter)
      AND (channel_filter IS NULL OR channel_filter = 'all'
           OR COALESCE(NULLIF(btrim(r.channel), ''), 'Não informado') = channel_filter)
  ),
  totals AS (
    SELECT
      COUNT(*)::int                                                      AS n,
      COALESCE(SUM(order_value), 0)::numeric                             AS order_value,
      COALESCE(SUM(refunded_value), 0)::numeric                          AS refunded_value,
      COUNT(*) FILTER (
        WHERE category NOT IN ('Outros', 'Follow up (sem motivo declarado)')
      )::int                                                             AS declared_n,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY days_to_close)          AS days_median
    FROM base
  ),
  totals_prev AS (
    SELECT COUNT(*)::int AS n FROM prev
  ),
  reason_now AS (
    SELECT
      category,
      COUNT(*)::int                                              AS n,
      COALESCE(SUM(order_value), 0)::numeric                     AS order_value,
      COALESCE(SUM(refunded_value), 0)::numeric                  AS refunded_value,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY days_to_close)  AS days_median
    FROM base
    GROUP BY category
  ),
  reason_prev AS (
    SELECT category, COUNT(*)::int AS n FROM prev GROUP BY category
  ),
  monthly AS (
    SELECT to_char(closed_on, 'YYYY-MM') AS month, category, COUNT(*)::int AS n
    FROM base
    WHERE closed_on IS NOT NULL
    GROUP BY 1, 2
  ),
  monthly_totals AS (
    SELECT
      to_char(closed_on, 'YYYY-MM')             AS month,
      COUNT(*)::int                             AS n,
      COALESCE(SUM(order_value), 0)::numeric    AS order_value,
      COALESCE(SUM(refunded_value), 0)::numeric AS refunded_value
    FROM base
    WHERE closed_on IS NOT NULL
    GROUP BY 1
  ),
  product_agg AS (
    SELECT
      product,
      COUNT(*)::int                             AS n,
      COALESCE(SUM(order_value), 0)::numeric    AS order_value,
      COALESCE(SUM(refunded_value), 0)::numeric AS refunded_value
    FROM base
    GROUP BY product
  ),
  matrix_full AS (
    SELECT product, category, COUNT(*)::int AS n
    FROM base
    GROUP BY 1, 2
  ),
  product_top_reason AS (
    SELECT DISTINCT ON (product) product, category, n
    FROM matrix_full
    ORDER BY product, n DESC, category
  ),
  top_products AS (
    -- Matriz motivo×produto só para produtos com massa crítica: índice de
    -- sobre-representação em cima de 3 reembolsos é ruído, não sinal.
    SELECT product, n
    FROM product_agg
    WHERE n >= 10
    ORDER BY n DESC
    LIMIT 12
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object(
      'from', from_date,
      'to', to_date,
      'days', v_span,
      'prev_from', v_prev_from,
      'prev_to', v_prev_to
    ),
    'universe', jsonb_build_object(
      'concluidos', t.n,
      'em_aberto', o.n,
      'concluidos_periodo_anterior', tp.n,
      'com_motivo_declarado', t.declared_n,
      'sem_motivo_declarado', t.n - t.declared_n,
      'cobertura_pct', CASE WHEN t.n > 0 THEN round(100.0 * t.declared_n / t.n, 1) ELSE NULL END,
      'variacao_volume_pct', CASE WHEN tp.n > 0 THEN round(100.0 * (t.n - tp.n) / tp.n, 1) ELSE NULL END
    ),
    'kpis', jsonb_build_object(
      'valor_pedidos', round(t.order_value, 2),
      'valor_devolvido', round(t.refunded_value, 2),
      'retencao_pct', CASE WHEN t.order_value > 0
        THEN round(100.0 * (t.order_value - t.refunded_value) / t.order_value, 1) END,
      'devolvido_pct', CASE WHEN t.order_value > 0
        THEN round(100.0 * t.refunded_value / t.order_value, 1) END,
      'ticket_medio_pedido', CASE WHEN t.n > 0 THEN round(t.order_value / t.n, 2) END,
      'dias_mediano', t.days_median
    ),
    'by_reason', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'category', rn.category,
        'n', rn.n,
        'share', CASE WHEN t.n > 0 THEN round(100.0 * rn.n / t.n, 1) END,
        'prev_n', COALESCE(rp.n, 0),
        'prev_share', CASE WHEN tp.n > 0 THEN round(100.0 * COALESCE(rp.n, 0) / tp.n, 1) END,
        'delta_pp', CASE WHEN tp.n > 0 AND t.n > 0
          THEN round((100.0 * rn.n / t.n) - (100.0 * COALESCE(rp.n, 0) / tp.n), 1) END,
        'order_value', round(rn.order_value, 2),
        'refunded_value', round(rn.refunded_value, 2),
        'devolvido_pct', CASE WHEN rn.order_value > 0
          THEN round(100.0 * rn.refunded_value / rn.order_value, 1) END,
        'dias_mediano', rn.days_median
      ) ORDER BY rn.n DESC, rn.category)
      FROM reason_now rn
      LEFT JOIN reason_prev rp ON rp.category = rn.category
    ), '[]'::jsonb),
    'reason_monthly', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'month', m.month,
        'category', m.category,
        'n', m.n,
        'share', CASE WHEN mt.n > 0 THEN round(100.0 * m.n / mt.n, 1) END
      ) ORDER BY m.month, m.n DESC)
      FROM monthly m
      JOIN monthly_totals mt ON mt.month = m.month
    ), '[]'::jsonb),
    'monthly', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'month', mt.month,
        'n', mt.n,
        'order_value', round(mt.order_value, 2),
        'refunded_value', round(mt.refunded_value, 2)
      ) ORDER BY mt.month)
      FROM monthly_totals mt
    ), '[]'::jsonb),
    'by_product', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product', pa.product,
        'n', pa.n,
        'share', CASE WHEN t.n > 0 THEN round(100.0 * pa.n / t.n, 1) END,
        'order_value', round(pa.order_value, 2),
        'refunded_value', round(pa.refunded_value, 2),
        'devolvido_pct', CASE WHEN pa.order_value > 0
          THEN round(100.0 * pa.refunded_value / pa.order_value, 1) END,
        'top_reason', ptr.category,
        'top_reason_n', ptr.n,
        'top_reason_share', CASE WHEN pa.n > 0 THEN round(100.0 * ptr.n / pa.n, 1) END
      ) ORDER BY pa.n DESC, pa.product)
      FROM product_agg pa
      LEFT JOIN product_top_reason ptr ON ptr.product = pa.product
    ), '[]'::jsonb),
    'reason_by_product', COALESCE((
      -- share_in_product = participação do motivo dentro do produto.
      -- lift = share_in_product / share geral do motivo. >1 significa que o
      -- produto puxa aquele motivo mais que a média — é o sinal de copy.
      SELECT jsonb_agg(jsonb_build_object(
        'product', mf.product,
        'category', mf.category,
        'n', mf.n,
        'share_in_product', round(100.0 * mf.n / tpr.n, 1),
        'baseline_share', CASE WHEN t.n > 0 THEN round(100.0 * rn.n / t.n, 1) END,
        'lift', CASE WHEN rn.n > 0 AND t.n > 0
          THEN round((1.0 * mf.n / tpr.n) / (1.0 * rn.n / t.n), 2) END
      ) ORDER BY tpr.n DESC, mf.product, mf.n DESC)
      FROM matrix_full mf
      JOIN top_products tpr ON tpr.product = mf.product
      JOIN reason_now rn ON rn.category = mf.category
    ), '[]'::jsonb),
    'matrix_products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('product', tpr.product, 'n', tpr.n) ORDER BY tpr.n DESC)
      FROM top_products tpr
    ), '[]'::jsonb),
    'by_platform', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', x.platform,
        'n', x.n,
        'share', CASE WHEN t.n > 0 THEN round(100.0 * x.n / t.n, 1) END
      ) ORDER BY x.n DESC, x.platform)
      FROM (SELECT platform, COUNT(*)::int AS n FROM base GROUP BY platform) x
    ), '[]'::jsonb),
    'by_channel', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', x.channel,
        'n', x.n,
        'share', CASE WHEN t.n > 0 THEN round(100.0 * x.n / t.n, 1) END
      ) ORDER BY x.n DESC, x.channel)
      FROM (SELECT channel, COUNT(*)::int AS n FROM base GROUP BY channel) x
    ), '[]'::jsonb),
    'filters', jsonb_build_object(
      'products', COALESCE((SELECT jsonb_agg(DISTINCT pa.product) FROM period_all pa), '[]'::jsonb),
      'platforms', COALESCE((SELECT jsonb_agg(DISTINCT pa.platform) FROM period_all pa), '[]'::jsonb),
      'channels', COALESCE((SELECT jsonb_agg(DISTINCT pa.channel) FROM period_all pa), '[]'::jsonb)
    )
  )
  INTO v_result
  FROM totals t
  CROSS JOIN totals_prev tp
  CROSS JOIN open_now o;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC de evidência: as palavras do cliente por trás de um motivo.
--
-- Dois blocos, porque eles respondem coisas diferentes:
--   `textos`  — os textos exatos mais frequentes (mostra o quanto é rótulo
--               padrão do menu vs. texto escrito à mão pelo atendente);
--   `termos`  — frequência de palavras SÓ nos textos que não são um rótulo
--               padrão. É aí que aparece a linguagem real do cliente.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.copy_refund_reason_evidence(
  from_date date,
  to_date date,
  reason_category text,
  product_filter text DEFAULT 'all',
  platform_filter text DEFAULT 'all',
  channel_filter text DEFAULT 'all',
  max_rows int DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_limit int := LEAST(GREATEST(COALESCE(max_rows, 25), 5), 100);
  v_canon text[] := ARRAY[
    'insatisfação com o produto', 'não reconhece a compra', 'compra duplicada',
    'cobrança recorrente', 'produto não funcionou como esperado',
    'atraso na entrega/acesso', 'arrependimento de compra', 'dificuldade de uso',
    'problemas técnicos', 'compra em excesso',
    'indicação médica / efeitos colaterais', 'risco de chargeback',
    'reclamação vsl / propaganda', 'follow up (sem motivo declarado)', 'outros'
  ];
  v_stopwords text[] := ARRAY[
    'cliente','clientes','produto','produtos','pedido','para','como','pois',
    'porque','sobre','pelo','pela','este','esta','essa','esse','isso','muito',
    'mesmo','ainda','apenas','depois','antes','mais','sem','com','que','nao',
    'não','uma','dos','das','tinha','tambem','também','sendo','pode','fazer',
    'todo','toda','entao','então','estava','fica','ficou','disse','informou',
    'informa','relatou','alegou','alega','pelos','pelas','seus','suas','foi',
    'era','tem','tenho','teve','houve','estar','está','sido','ser','por','dela',
    'dele','nos','nas','num','numa','aos','uns','mas','porém','porem','onde',
    'quando','qual','quais','sua','seu'
  ];
  v_result jsonb;
BEGIN
  IF NOT public.can_read_refund_analytics() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH base AS (
    SELECT
      public.redact_free_text(btrim(c.original_reason)) AS txt,
      COALESCE(NULLIF(btrim(r.product), ''), 'Não informado') AS product,
      COALESCE(NULLIF(btrim(r.channel), ''), 'Não informado') AS channel
    FROM public.refunds r
    JOIN public.refund_reason_classifications c ON c.refund_id = r.id
    WHERE r.completion_date IS NOT NULL
      AND public.text_to_date_safe(r.completion_date) BETWEEN from_date AND to_date
      AND c.category = reason_category
      AND (product_filter IS NULL OR product_filter = 'all'
           OR COALESCE(NULLIF(btrim(r.product), ''), 'Não informado') = product_filter)
      AND (platform_filter IS NULL OR platform_filter = 'all'
           OR COALESCE(NULLIF(btrim(r.sales_platform), ''), 'Não informado') = platform_filter)
      AND (channel_filter IS NULL OR channel_filter = 'all'
           OR COALESCE(NULLIF(btrim(r.channel), ''), 'Não informado') = channel_filter)
  ),
  with_text AS (
    SELECT * FROM base WHERE COALESCE(txt, '') <> ''
  ),
  free_text AS (
    SELECT * FROM with_text WHERE lower(txt) <> ALL (v_canon)
  ),
  totals AS (
    SELECT
      (SELECT COUNT(*)::int FROM base)      AS total,
      (SELECT COUNT(*)::int FROM with_text) AS com_texto,
      (SELECT COUNT(*)::int FROM free_text) AS texto_livre
  ),
  texts AS (
    SELECT txt, COUNT(*)::int AS n,
           bool_or(lower(txt) = ANY (v_canon)) AS is_canon
    FROM with_text
    GROUP BY txt
    ORDER BY COUNT(*) DESC, txt
    LIMIT v_limit
  ),
  words AS (
    SELECT regexp_replace(lower(w), '[^a-z0-9áàâãéêíóôõúüç]', '', 'g') AS term
    FROM free_text ft, regexp_split_to_table(ft.txt, '\s+') AS w
  ),
  terms AS (
    SELECT term, COUNT(*)::int AS n
    FROM words
    WHERE char_length(term) >= 4
      AND term <> ALL (v_stopwords)
    GROUP BY term
    ORDER BY COUNT(*) DESC, term
    LIMIT v_limit
  )
  SELECT jsonb_build_object(
    'category', reason_category,
    'total', t.total,
    'com_texto', t.com_texto,
    'texto_livre', t.texto_livre,
    'textos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'texto', x.txt,
        'n', x.n,
        'share', CASE WHEN t.com_texto > 0 THEN round(100.0 * x.n / t.com_texto, 1) END,
        'padrao', x.is_canon
      ) ORDER BY x.n DESC, x.txt)
      FROM texts x
    ), '[]'::jsonb),
    'termos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('termo', x.term, 'n', x.n) ORDER BY x.n DESC, x.term)
      FROM terms x
    ), '[]'::jsonb),
    'por_produto', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('produto', x.product, 'n', x.n) ORDER BY x.n DESC, x.product)
      FROM (SELECT product, COUNT(*)::int AS n FROM base GROUP BY product ORDER BY 2 DESC LIMIT 10) x
    ), '[]'::jsonb),
    'por_canal', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('canal', x.channel, 'n', x.n) ORDER BY x.n DESC, x.channel)
      FROM (SELECT channel, COUNT(*)::int AS n FROM base GROUP BY channel) x
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM totals t;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.copy_refund_reason_analytics(date, date, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.copy_refund_reason_evidence(date, date, text, text, text, text, int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.copy_refund_reason_analytics(date, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copy_refund_reason_evidence(date, date, text, text, text, text, int) TO authenticated;

-- Sem índice de propósito. O recorte de período é
-- `text_to_date_safe(completion_date) BETWEEN ...`, um predicado com função em
-- cima da coluna: nenhum índice btree simples em `completion_date` seria usado.
-- Um índice de expressão resolveria, mas cast text→date depende do GUC DateStyle
-- e portanto não é de fato IMMUTABLE — índice sobre ele pode corromper
-- silenciosamente. Com ~4,3 mil linhas em `refunds` o seq scan custa
-- milissegundos; se a tabela crescer uma ordem de grandeza, a saída é
-- materializar a data em coluna `date` real, não indexar a expressão.
