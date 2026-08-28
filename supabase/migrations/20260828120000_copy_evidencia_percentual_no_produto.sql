-- Drill-down do motivo: quanto aquele motivo pesa DENTRO do produto.
--
-- "Produtos com mais casos deste motivo" só mostrava o número absoluto. 200 do
-- Steelpower é o maior número da lista, mas sozinho ele não diz nada sobre o
-- produto: um produto que vende dez vezes mais aparece no topo de todo motivo.
-- O que interessa para a copy é a fração — dos reembolsos que o Steelpower teve
-- no período, quantos foram por esse motivo.
--
-- Denominador: todos os reembolsos concluídos daquele produto no período, de
-- qualquer motivo, respeitando os mesmos filtros de plataforma/canal da tela
-- (só o recorte por motivo é que não entra). É exatamente o universo do card
-- "Produtos que mais devolvem" (`copy_refund_reason_analytics.by_product`),
-- então os dois números batem quando alguém for conferir na tela.
--
-- Só o bloco `por_produto` muda; o resto da função é o de
-- 20260817200000_copy_refund_reason_analytics.sql.
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
  product_universe AS (
    -- Mesmo recorte do `base`, MENOS o filtro de motivo: é o total do produto
    -- no período, que vira o denominador do percentual.
    SELECT
      COALESCE(NULLIF(btrim(r.product), ''), 'Não informado') AS product,
      COUNT(*)::int                                           AS n
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
    GROUP BY 1
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
  ),
  products AS (
    -- A ordem continua sendo por volume: o percentual é coluna a mais, não
    -- outro ranking (produto com 3 reembolsos e 1 nesse motivo daria 33% e
    -- roubaria o topo da lista sem significar nada).
    SELECT product, COUNT(*)::int AS n
    FROM base
    GROUP BY product
    ORDER BY 2 DESC, 1
    LIMIT 10
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
      SELECT jsonb_agg(jsonb_build_object(
        'produto', p.product,
        'n', p.n,
        'total_produto', pu.n,
        'share_no_produto', CASE WHEN COALESCE(pu.n, 0) > 0
          THEN round(100.0 * p.n / pu.n, 1) END
      ) ORDER BY p.n DESC, p.product)
      FROM products p
      LEFT JOIN product_universe pu ON pu.product = p.product
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

REVOKE ALL ON FUNCTION public.copy_refund_reason_evidence(date, date, text, text, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.copy_refund_reason_evidence(date, date, text, text, text, text, int) TO authenticated;
