-- Pedidos em Espera: consultas da tela nova da gestora (/dashboard/pedidos-espera).
--
-- A aba antiga baixava os ~4,2 mil pedidos de todo o histórico de uma vez
-- (manager_list_held_orders, ~4 MB) e nunca recarregava sozinha — os números
-- dos agentes ficavam parados. A tela nova divide o trabalho:
--
--   manager_held_orders_page  lista paginada e filtrada no banco + contagens por
--                             status com os mesmos filtros (as abas de status
--                             batem com a lista) + opções do filtro de produto.
--                             Sem limite = exportação; p_ids_only = seleção em lote.
--   manager_held_orders_team  números da equipe e do dia, leves, para atualizar
--                             a cada minuto.
--
-- manager_list_held_orders continua existindo: a Área de Produtos segue na tela
-- antiga, só leitura.
--
-- Status da tela (um pedido cai em exatamente um):
--   sem_agente  ninguém atribuído, ainda não concluído nem inativo
--   novo        atribuído, agente ainda não começou
--   andamento   agente registrou atendimento
--   inativo     cliente não responde (fora da fila do agente)
--   concluido   encerrado
-- Linhas repetidas (duplicate_of, dados anteriores a 05/08/2026) ficam fora.

-- Produtos de um pedido: o miolo de cada SKU do campo items, mesma regra de
-- productFromSku em src/features/held-orders/format.ts
-- ("6294-NRVEBLND-114 x 2, 127-MVIT-277 x 1" -> {NRVEBLND, MVIT}).
CREATE OR REPLACE FUNCTION public.held_order_products(p_items text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_out   text[] := '{}';
  v_part  text;
  v_sku   text;
  v_parts text[];
  v_prod  text;
BEGIN
  IF p_items IS NULL THEN
    RETURN v_out;
  END IF;
  FOREACH v_part IN ARRAY string_to_array(p_items, ',') LOOP
    v_sku := trim(regexp_replace(trim(v_part), '\s*[x×]\s*\d+$', '', 'i'));
    CONTINUE WHEN v_sku = '';
    v_parts := array_remove(string_to_array(v_sku, '-'), '');
    IF array_length(v_parts, 1) >= 3 THEN
      v_prod := array_to_string(v_parts[2:array_length(v_parts, 1) - 1], '-');
    ELSIF array_length(v_parts, 1) = 2 THEN
      v_prod := v_parts[2];
    ELSE
      v_prod := v_sku;
    END IF;
    IF NOT v_prod = ANY(v_out) THEN
      v_out := v_out || v_prod;
    END IF;
  END LOOP;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.manager_held_orders_page(
  p_status     text    DEFAULT NULL,
  p_agent_id   text    DEFAULT NULL,
  p_search     text    DEFAULT NULL,
  p_product    text    DEFAULT NULL,
  p_date_field text    DEFAULT 'entrada',
  p_from       date    DEFAULT NULL,
  p_to         date    DEFAULT NULL,
  p_limit      int     DEFAULT 50,
  p_offset     int     DEFAULT 0,
  p_ids_only   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_term    text;
  v_result  jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('sem_agente', 'novo', 'andamento', 'inativo', 'concluido') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;
  IF p_date_field NOT IN ('pedido', 'entrada') THEN
    RAISE EXCEPTION 'invalid date field: %', p_date_field;
  END IF;

  v_term := NULLIF(lower(trim(COALESCE(p_search, ''))), '');

  WITH
  -- Todos os filtros menos período, produto e status.
  scope AS (
    SELECT
      o.*,
      CASE
        WHEN o.agent_status = 'concluido' THEN 'concluido'
        WHEN o.agent_status = 'inativo'   THEN 'inativo'
        WHEN o.assigned_to IS NULL        THEN 'sem_agente'
        WHEN o.agent_status = 'em_andamento' THEN 'andamento'
        ELSE 'novo'
      END AS bucket,
      CASE WHEN p_date_field = 'pedido'
           THEN COALESCE(o.order_date, o.return_date)
           ELSE (o.imported_at AT TIME ZONE 'America/Sao_Paulo')::date
      END AS ref_date,
      public.held_order_products(o.items) AS products
    FROM public.held_orders o
    WHERE o.duplicate_of IS NULL
      AND (p_agent_id IS NULL OR o.assigned_to = p_agent_id)
      AND (v_term IS NULL OR lower(concat_ws(' ', o.order_number, o.dyna_code, o.email, o.customer_name)) LIKE '%' || v_term || '%')
  ),
  in_period AS (
    SELECT * FROM scope s
    WHERE (p_from IS NULL OR s.ref_date >= p_from)
      AND (p_to   IS NULL OR s.ref_date <= p_to)
  ),
  -- Base das abas de status: todos os filtros menos o status.
  base AS (
    SELECT * FROM in_period s
    WHERE p_product IS NULL OR p_product = ANY(s.products)
  ),
  filtered AS (
    SELECT * FROM base b WHERE p_status IS NULL OR b.bucket = p_status
  ),
  page AS (
    SELECT * FROM filtered f
    ORDER BY f.ref_date DESC NULLS LAST, f.id
    LIMIT p_limit OFFSET COALESCE(p_offset, 0)
  )
  SELECT CASE WHEN p_ids_only THEN
    -- Seleção em lote: só o que pode ser distribuído (não concluído), na ordem da
    -- lista, com o cliente de cada um (a distribuição agrupa por cliente).
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'client_key', x.client_key)
                               ORDER BY x.ref_date DESC NULLS LAST, x.id), '[]'::jsonb)
     FROM (SELECT f.id, f.ref_date,
                  public.held_order_client_key(f.email, f.customer_name, f.id) AS client_key
           FROM filtered f WHERE f.bucket <> 'concluido'
           ORDER BY f.ref_date DESC NULLS LAST, f.id LIMIT p_limit) x)
  ELSE jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'counts', (SELECT jsonb_build_object(
        'sem_agente', count(*) FILTER (WHERE bucket = 'sem_agente'),
        'novo',       count(*) FILTER (WHERE bucket = 'novo'),
        'andamento',  count(*) FILTER (WHERE bucket = 'andamento'),
        'inativo',    count(*) FILTER (WHERE bucket = 'inativo'),
        'concluido',  count(*) FILTER (WHERE bucket = 'concluido'))
      FROM base),
    -- Pedidos ainda em aberto que o período escondeu — para a gestora não achar
    -- que a fila é menor do que é.
    'open_outside_period', CASE WHEN p_from IS NULL AND p_to IS NULL THEN 0 ELSE (
      SELECT count(*) FROM scope s
      WHERE s.bucket IN ('sem_agente', 'novo', 'andamento')
        AND (p_product IS NULL OR p_product = ANY(s.products))
        AND NOT ((p_from IS NULL OR s.ref_date >= p_from) AND (p_to IS NULL OR s.ref_date <= p_to))
    ) END,
    -- Opções do filtro de produto: com todos os filtros menos o próprio produto.
    'products', (SELECT COALESCE(jsonb_agg(jsonb_build_object('code', code, 'count', n) ORDER BY code), '[]'::jsonb)
      FROM (SELECT p AS code, count(*) AS n
            FROM in_period s, unnest(s.products) p
            WHERE p_status IS NULL OR s.bucket = p_status
            GROUP BY p) pc),
    'rows', (SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.ord), '[]'::jsonb) FROM (
      SELECT
        row_number() OVER (ORDER BY pg.ref_date DESC NULLS LAST, pg.id) AS ord,
        pg.id::text AS id,
        pg.bucket,
        pg.dyna_code, pg.order_number, pg.merged_orders, pg.reason,
        pg.order_date, pg.return_date, pg.email, pg.customer_name,
        pg.city, pg.state, pg.country, pg.postal_code,
        pg.street1, pg.street2, pg.street3,
        pg.age, pg.items, pg.rma, pg.restocked_items, pg.damaged_items, pg.comments,
        pg.source_file, pg.status, pg.agent_status, pg.pending_tag, pg.assign_count,
        pg.assigned_to, pa.full_name AS assigned_to_name,
        pg.confirmed_at, pg.imported_at,
        (SELECT max(e.recorded_at) FROM public.held_order_events e WHERE e.order_id = pg.id) AS status_changed_at,
        (SELECT count(*)::int FROM public.held_order_events e WHERE e.order_id = pg.id) AS event_count,
        pg.duplicate_of::text AS duplicate_of,
        public.held_order_client_key(pg.email, pg.customer_name, pg.id) AS client_key
      FROM page pg
      LEFT JOIN public.profiles pa ON pa.id = pg.assigned_to
    ) t)
  ) END
  INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.manager_held_orders_team()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_day_start timestamptz;
  v_result    jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Mesma janela do dia da meta do agente (my_held_orders_daily_metrics).
  v_day_start := date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
                 AT TIME ZONE 'America/Sao_Paulo';

  WITH
  load AS (
    SELECT o.assigned_to AS agent_id,
           count(*) FILTER (WHERE o.agent_status = 'novo')         AS fila,
           count(*) FILTER (WHERE o.agent_status = 'em_andamento') AS andamento,
           count(*) FILTER (WHERE o.agent_status = 'inativo')      AS inativo
    FROM public.held_orders o
    WHERE o.duplicate_of IS NULL AND o.assigned_to IS NOT NULL
    GROUP BY o.assigned_to
  ),
  -- Meta de Pedidos em Espera: concluído ou inativo, cada pedido uma vez por dia.
  today AS (
    SELECT e.user_id AS agent_id, count(DISTINCT e.order_id) AS done_today
    FROM public.held_order_events e
    JOIN public.held_orders o ON o.id = e.order_id AND o.duplicate_of IS NULL
    WHERE e.status IN ('concluido', 'inativo')
      AND e.recorded_at >= v_day_start
      AND e.recorded_at <  v_day_start + interval '1 day'
    GROUP BY e.user_id
  ),
  last_event AS (
    SELECT e.user_id AS agent_id, max(e.recorded_at) AS last_event_at
    FROM public.held_order_events e
    GROUP BY e.user_id
  ),
  -- Agentes ativos, mais qualquer perfil que ainda segure pedido em aberto.
  agents AS (
    SELECT p.id, p.full_name, p.is_active
    FROM public.profiles p
    WHERE (p.role::text = 'agent' AND p.is_active)
       OR EXISTS (SELECT 1 FROM load l WHERE l.agent_id = p.id AND (l.fila + l.andamento + l.inativo) > 0)
  )
  SELECT jsonb_build_object(
    'goal', 30,
    'agents', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'agent_id', a.id,
        'full_name', a.full_name,
        'is_active', a.is_active,
        'fila', COALESCE(l.fila, 0),
        'andamento', COALESCE(l.andamento, 0),
        'inativo', COALESCE(l.inativo, 0),
        'done_today', COALESCE(t.done_today, 0),
        'last_event_at', le.last_event_at
      ) ORDER BY a.full_name), '[]'::jsonb)
      FROM agents a
      LEFT JOIN load l        ON l.agent_id = a.id
      LEFT JOIN today t       ON t.agent_id = a.id
      LEFT JOIN last_event le ON le.agent_id = a.id),
    'today', jsonb_build_object(
      'imported', (SELECT count(*) FROM public.held_orders o
                   WHERE o.imported_at >= v_day_start AND o.imported_at < v_day_start + interval '1 day'
                     AND o.duplicate_of IS NULL),
      'started',  (SELECT count(DISTINCT e.order_id) FROM public.held_order_events e
                   WHERE e.status = 'em_andamento'
                     AND e.recorded_at >= v_day_start AND e.recorded_at < v_day_start + interval '1 day'),
      'done',     (SELECT COALESCE(sum(t.done_today), 0) FROM today t),
      'concluded', (SELECT count(DISTINCT e.order_id) FROM public.held_order_events e
                    WHERE e.status = 'concluido'
                      AND e.recorded_at >= v_day_start AND e.recorded_at < v_day_start + interval '1 day'),
      'inactive_alerts', (SELECT count(*) FROM public.held_order_inactive_alerts a WHERE a.decision IS NULL)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.manager_held_orders_page(text, text, text, text, text, date, date, int, int, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.manager_held_orders_team() FROM anon;
GRANT EXECUTE ON FUNCTION public.manager_held_orders_page(text, text, text, text, text, date, date, int, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_held_orders_team() TO authenticated;
