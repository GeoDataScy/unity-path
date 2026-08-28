-- Tela do copy passa a mostrar dinheiro em dólar.
--
-- `refunds.refund_value` é lançado em real e não existe coluna de moeda, então
-- a conversão precisa de uma cotação. Ela mora em `app_settings` (chave
-- `usd_brl_rate`, em reais por US$ 1) e não numa constante no código: cotação
-- muda toda semana e a gestora não pode depender de deploy para corrigir o
-- número que aparece na tela.
--
-- A conversão acontece no ponto de entrada do dinheiro dentro da RPC (CTE
-- `base`), então todo agregado que vem depois — KPIs, valor por motivo, valor
-- por produto — já sai em dólar de uma vez só. Percentuais não mudam: numerador
-- e denominador foram divididos pela mesma cotação.
--
-- Só a tela do copy muda. As telas da gestora (/dashboard/reembolsos) e os
-- relatórios exportados continuam em real.

-- ─────────────────────────────────────────────────────────────────────────────
-- app_settings — configuração de app editável pela gestora (chave/valor)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.app_settings IS
  'Configuração de app em chave/valor, editável pela gestora. Hoje: usd_brl_rate (reais por US$ 1).';

CREATE OR REPLACE FUNCTION public.app_settings_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid()::text;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_settings_touch ON public.app_settings;
CREATE TRIGGER trg_app_settings_touch
  BEFORE INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.app_settings_touch();

-- Mesmo desenho das tabelas support_*: todo autenticado lê, só gestora escreve.
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_select ON public.app_settings;
CREATE POLICY app_settings_select ON public.app_settings
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS app_settings_write ON public.app_settings;
CREATE POLICY app_settings_write ON public.app_settings
  FOR ALL USING ((SELECT public.is_manager())) WITH CHECK ((SELECT public.is_manager()));

-- Valor provisório combinado com o usuário: a gestora corrige na própria tela.
INSERT INTO public.app_settings (key, value)
VALUES ('usd_brl_rate', '5.40')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cotação com defesa: linha apagada, texto inválido ou zero não podem derrubar
-- a tela nem gerar divisão por zero — cai no padrão e a tela mostra qual usou.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.usd_brl_rate()
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rate numeric;
BEGIN
  SELECT NULLIF(btrim(s.value), '')::numeric
    INTO v_rate
    FROM public.app_settings s
   WHERE s.key = 'usd_brl_rate';

  IF v_rate IS NULL OR v_rate <= 0 THEN
    RETURN 5.40;
  END IF;
  RETURN v_rate;
EXCEPTION WHEN others THEN
  RETURN 5.40;
END;
$function$;

REVOKE ALL ON FUNCTION public.usd_brl_rate() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.usd_brl_rate() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- copy_refund_reason_analytics: idêntica à de 20260817200000, com a conversão
-- na CTE `base` e a cotação devolvida no payload.
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
  v_rate numeric;
  v_result jsonb;
BEGIN
  IF NOT public.can_read_refund_analytics() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Cotação com que os valores viram dólar. Mora em app_settings para a gestora
  -- corrigir sem depender de deploy; a função devolve um padrão se a linha
  -- sumir, porque tela em branco é pior do que valor aproximado.
  v_rate := public.usd_brl_rate();

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
      -- Converte no ponto de entrada: tudo que agrega depois (KPIs, motivo,
      -- produto) já sai em dólar, e os percentuais não mudam porque numerador
      -- e denominador foram divididos pela mesma cotação.
      round(r.refund_value::numeric / v_rate, 2)                     AS order_value,
      round(public.refund_refunded_value(r.refund_value::numeric, r.refund_type) / v_rate, 2)
                                                                     AS refunded_value,
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
    'cotacao', jsonb_build_object(
      'usd_brl', v_rate,
      'atualizada_em', (SELECT s.updated_at FROM public.app_settings s WHERE s.key = 'usd_brl_rate')
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

REVOKE ALL ON FUNCTION public.copy_refund_reason_analytics(date, date, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.copy_refund_reason_analytics(date, date, text, text, text) TO authenticated;
