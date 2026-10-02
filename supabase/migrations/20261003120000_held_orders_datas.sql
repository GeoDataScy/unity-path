-- Pedidos em Espera: as datas de cada pedido, cada uma no seu campo.
--
-- 1. Data do pedido (order_date): data da compra, como veio na planilha.
-- 2. Data da devolução (return_date, nova): o arquivo de devoluções (Returned
--    Shipments) não traz a data da compra, só a da devolução — que até aqui era
--    gravada em order_date e apareceria rotulada como "Data do pedido". As 179
--    linhas de devolução existentes são movidas para o campo novo.
-- 3. Data de entrada no sistema (imported_at): gravada pelo banco no import e,
--    a partir daqui, imutável — o trigger recusa qualquer UPDATE que a altere.
-- 4. Data da última mudança de status (status_changed_at): derivada do log
--    held_order_events (último recorded_at), devolvida pelas RPCs de listagem.
--
-- Filtro de período, ordenação e rateio usam COALESCE(order_date, return_date):
-- uma devolução não tem data de compra, e sem isso cairia sempre no fim da fila.

ALTER TABLE public.held_orders ADD COLUMN IF NOT EXISTS return_date date;

COMMENT ON COLUMN public.held_orders.order_date  IS 'Data do pedido (compra), como veio na planilha. NULL nas devoluções.';
COMMENT ON COLUMN public.held_orders.return_date IS 'Data da devolução (arquivo Returned Shipments). NULL nos On Holds.';
COMMENT ON COLUMN public.held_orders.imported_at IS 'Data de entrada no sistema. Imutável (trg_held_orders_lock_imported_at).';

-- Devoluções já importadas: a data que está em order_date é a da devolução.
UPDATE public.held_orders
SET return_date = order_date,
    order_date  = NULL
WHERE dyna_code = 'RETURNS'
  AND return_date IS NULL
  AND order_date IS NOT NULL;

CREATE OR REPLACE FUNCTION public.held_orders_lock_imported_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.imported_at IS DISTINCT FROM OLD.imported_at THEN
    RAISE EXCEPTION 'held_orders.imported_at (data de entrada no sistema) não pode ser alterada';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_held_orders_lock_imported_at ON public.held_orders;
CREATE TRIGGER trg_held_orders_lock_imported_at
  BEFORE UPDATE OF imported_at ON public.held_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.held_orders_lock_imported_at();

CREATE OR REPLACE FUNCTION public.manager_import_held_orders(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_manager    text;
  v_total      int := 0;
  v_with_data  int := 0;
  v_inserted   int := 0;
  v_duplicates int := 0;
  v_dup_orders jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  v_manager := auth.uid()::text;
  v_total := jsonb_array_length(p_rows);

  WITH src AS (
    SELECT
      COALESCE(NULLIF(trim(r->>'dyna_code'), ''), 'RETURNS') AS dyna_code,
      NULLIF(trim(r->>'order_number'), '') AS order_number,
      NULLIF(r->>'merged_orders', '')      AS merged_orders,
      NULLIF(r->>'reason', '')             AS reason,
      -- Data do pedido = data da compra, como veio na planilha. Nas devoluções
      -- o arquivo não traz a compra, só a devolução: ela vai para return_date.
      -- Bundle antigo (antes de 03/10/2026) ainda manda a data da devolução em
      -- order_date — sem return_date na linha de devolução, é isso que ela é.
      CASE WHEN (r->>'order_date') ~ '^\d{4}-\d{2}-\d{2}$'
            AND NOT (COALESCE(NULLIF(trim(r->>'dyna_code'), ''), 'RETURNS') = 'RETURNS'
                     AND NULLIF(r->>'return_date', '') IS NULL)
           THEN (r->>'order_date')::date END AS order_date,
      CASE WHEN COALESCE(NULLIF(r->>'return_date', ''),
                         CASE WHEN COALESCE(NULLIF(trim(r->>'dyna_code'), ''), 'RETURNS') = 'RETURNS'
                              THEN r->>'order_date' END) ~ '^\d{4}-\d{2}-\d{2}$'
           THEN COALESCE(NULLIF(r->>'return_date', ''), r->>'order_date')::date END AS return_date,
      NULLIF(r->>'email', '')              AS email,
      NULLIF(r->>'name', '')               AS customer_name,
      NULLIF(r->>'city', '')               AS city,
      NULLIF(r->>'street1', '')            AS street1,
      NULLIF(r->>'street2', '')            AS street2,
      NULLIF(r->>'street3', '')            AS street3,
      NULLIF(r->>'state', '')              AS state,
      NULLIF(r->>'country', '')            AS country,
      NULLIF(r->>'postal_code', '')        AS postal_code,
      NULLIF(r->>'age', '')                AS age,
      NULLIF(r->>'items', '')              AS items,
      NULLIF(r->>'rma', '')                AS rma,
      NULLIF(r->>'restocked_items', '')    AS restocked_items,
      NULLIF(r->>'damaged_items', '')      AS damaged_items,
      NULLIF(r->>'comments', '')           AS comments,
      NULLIF(r->>'source_file', '')        AS source_file,
      -- A linha tem algum dado real? (ignora dyna_code/source_file)
      NULLIF(trim(concat_ws('',
        r->>'order_number', r->>'merged_orders', r->>'reason', r->>'order_date', r->>'return_date',
        r->>'email', r->>'name', r->>'city', r->>'street1', r->>'street2',
        r->>'street3', r->>'state', r->>'country', r->>'postal_code', r->>'age',
        r->>'items', r->>'rma', r->>'restocked_items', r->>'damaged_items',
        r->>'comments')), '') IS NOT NULL AS has_data,
      -- Identidade do pedido: order_number (+ RMA nas devoluções parciais) quando
      -- houver; senão hash do conteúdo da linha.
      COALESCE(
        NULLIF(trim(r->>'order_number'), '')
          || COALESCE('#' || NULLIF(trim(r->>'rma'), ''), ''),
        md5(concat_ws('|',
          COALESCE(r->>'order_date', r->>'return_date'), r->>'email', r->>'name', r->>'reason', r->>'items',
          r->>'merged_orders', r->>'rma', r->>'restocked_items', r->>'damaged_items',
          r->>'comments', r->>'city', r->>'state', r->>'country', r->>'postal_code',
          r->>'street1', r->>'street2', r->>'street3', r->>'age'))
      ) AS import_key,
      ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(r, ord)
  ),
  -- Colapsa repetições DENTRO do próprio lote (o mesmo pedido em dois arquivos
  -- selecionados juntos, ou a mesma linha repetida no arquivo). Fica a primeira
  -- ocorrência na ordem do arquivo (ord) — desempate determinístico.
  dedup AS (
    SELECT DISTINCT ON (dyna_code, import_key) *
    FROM src
    WHERE has_data
    ORDER BY dyna_code, import_key, ord
  ),
  -- Repetição de pedido que JÁ está em aberto no banco: não entra.
  fresh AS (
    SELECT d.*
    FROM dedup d
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.held_orders o
      WHERE o.dyna_code = d.dyna_code
        AND o.import_key = d.import_key
        AND o.agent_status <> 'concluido'
        AND o.duplicate_of IS NULL
    )
  ),
  ins AS (
    INSERT INTO public.held_orders (
      dyna_code, order_number, merged_orders, reason, order_date, return_date, email,
      customer_name, city, street1, street2, street3, state, country,
      postal_code, age, items, rma, restocked_items, damaged_items, comments,
      source_file, import_key, imported_by
    )
    SELECT
      dyna_code, order_number, merged_orders, reason, order_date, return_date, email,
      customer_name, city, street1, street2, street3, state, country,
      postal_code, age, items, rma, restocked_items, damaged_items, comments,
      source_file, import_key, v_manager
    FROM fresh
    -- Backstop de corrida: dois imports simultâneos do mesmo arquivo não veem as
    -- linhas não commitadas do outro; o índice parcial único resolve.
    ON CONFLICT (dyna_code, import_key)
      WHERE agent_status <> 'concluido' AND duplicate_of IS NULL
      DO NOTHING
    RETURNING 1
  ),
  -- Amostra dos pedidos ignorados, pelos DOIS motivos: já estava em aberto no
  -- banco, ou se repetia dentro do próprio lote.
  dup_labels AS (
    SELECT COALESCE(d.order_number, '(sem número)') AS label
    FROM dedup d
    WHERE EXISTS (
      SELECT 1
      FROM public.held_orders o
      WHERE o.dyna_code = d.dyna_code
        AND o.import_key = d.import_key
        AND o.agent_status <> 'concluido'
        AND o.duplicate_of IS NULL
    )
    UNION
    SELECT COALESCE(s.order_number, '(sem número)')
    FROM (
      SELECT order_number,
             row_number() OVER (PARTITION BY dyna_code, import_key ORDER BY ord) AS rn
      FROM src
      WHERE has_data
    ) s
    WHERE s.rn > 1
  ),
  dup_sample AS (
    SELECT label FROM dup_labels ORDER BY label LIMIT 20
  )
  SELECT
    (SELECT count(*)::int FROM src WHERE has_data),
    (SELECT count(*)::int FROM ins),
    (SELECT COALESCE(jsonb_agg(label), '[]'::jsonb) FROM dup_sample)
  INTO v_with_data, v_inserted, v_dup_orders;

  v_duplicates := v_with_data - v_inserted;

  RETURN jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'duplicates', v_duplicates,
    'empty_rows', v_total - v_with_data,
    'duplicate_orders', v_dup_orders,
    -- compatibilidade com o bundle antigo (lê apenas inserted/skipped)
    'skipped', v_total - v_inserted
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.manager_list_held_orders(from_date date DEFAULT NULL::date, to_date date DEFAULT NULL::date, agent_id text DEFAULT NULL::text, status_filter text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows       jsonb;
  v_total      bigint;
  v_duplicates bigint;
  v_summary    jsonb;
BEGIN
  -- Gestora (Data Analytics) e time de produtos (/produtos) leem a MESMA lista.
  -- Quem escreve (importar planilha, distribuir) continua só a gestora: essas
  -- RPCs são outras e seguem com guarda is_manager().
  IF NOT (public.is_manager() OR public.is_produtos_team()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE o.duplicate_of IS NOT NULL)
  INTO v_total, v_duplicates
  FROM public.held_orders o
  WHERE (from_date IS NULL OR COALESCE(o.order_date, o.return_date) >= from_date)
    AND (to_date   IS NULL OR COALESCE(o.order_date, o.return_date) <= to_date)
    AND (agent_id  IS NULL OR o.assigned_to = agent_id)
    AND (
      status_filter IS NULL
      OR status_filter = 'all'
      -- legado: 'pending' engloba aguardando + em andamento.
      OR (status_filter = 'pending'      AND o.status = 'pending')
      OR (status_filter = 'confirmed'    AND o.status = 'confirmed')
      OR (status_filter = 'aguardando'   AND o.status = 'pending' AND o.agent_status <> 'em_andamento')
      OR (status_filter = 'em_andamento' AND o.agent_status = 'em_andamento')
    );

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY COALESCE(t.order_date, t.return_date) DESC NULLS LAST, t.id), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      o.id::text          AS id,
      o.dyna_code,
      o.order_number,
      o.merged_orders,
      o.reason,
      o.order_date,
      o.return_date,
      o.email,
      o.customer_name,
      o.city, o.state, o.country, o.postal_code,
      o.street1, o.street2, o.street3,
      o.age,
      o.items,
      o.rma,
      o.restocked_items,
      o.damaged_items,
      o.comments,
      o.source_file,
      o.status,
      o.agent_status,
      o.pending_tag,
      o.assign_count,
      o.assigned_to,
      pa.full_name        AS assigned_to_name,
      o.confirmed_at,
      o.imported_at,
      (SELECT max(e.recorded_at) FROM public.held_order_events e WHERE e.order_id = o.id) AS status_changed_at,
      o.duplicate_of::text AS duplicate_of
    FROM public.held_orders o
    LEFT JOIN public.profiles pa ON pa.id = o.assigned_to
    WHERE (from_date IS NULL OR COALESCE(o.order_date, o.return_date) >= from_date)
      AND (to_date   IS NULL OR COALESCE(o.order_date, o.return_date) <= to_date)
      AND (agent_id  IS NULL OR o.assigned_to = agent_id)
      AND (
        status_filter IS NULL
        OR status_filter = 'all'
        OR (status_filter = 'pending'      AND o.status = 'pending')
        OR (status_filter = 'confirmed'    AND o.status = 'confirmed')
        OR (status_filter = 'aguardando'   AND o.status = 'pending' AND o.agent_status <> 'em_andamento')
        OR (status_filter = 'em_andamento' AND o.agent_status = 'em_andamento')
      )
  ) t;

  -- Resumo por agente (sempre global, sem as linhas repetidas: aquele número é
  -- carga de trabalho real). pending continua sendo "tudo que não está concluído";
  -- in_progress é o subconjunto já em atendimento, para a ADM ver quem começou.
  SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.full_name), '[]'::jsonb)
    INTO v_summary
  FROM (
    SELECT
      o.assigned_to                                                   AS agent_id,
      p.full_name,
      count(*) FILTER (WHERE o.status = 'pending')::int               AS pending,
      count(*) FILTER (WHERE o.agent_status = 'em_andamento')::int    AS in_progress,
      count(*) FILTER (WHERE o.status = 'confirmed')::int             AS confirmed
    FROM public.held_orders o
    JOIN public.profiles p ON p.id = o.assigned_to
    WHERE o.assigned_to IS NOT NULL
      AND o.duplicate_of IS NULL
    GROUP BY o.assigned_to, p.full_name
  ) s;

  RETURN jsonb_build_object(
    'total', v_total,
    'duplicates', v_duplicates,
    'rows', v_rows,
    'summary_by_agent', v_summary
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.my_held_orders(p_status text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    text;
  v_result jsonb;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)
           ORDER BY
             CASE t.agent_status WHEN 'novo' THEN 0 WHEN 'em_andamento' THEN 1 ELSE 2 END,
             CASE WHEN t.pending_tag IS NOT NULL THEN 0 ELSE 1 END,
             COALESCE(t.order_date, t.return_date) ASC NULLS LAST, t.id), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      o.id::text   AS id,
      o.dyna_code,
      o.order_number,
      o.merged_orders,
      o.reason,
      o.order_date,
      o.return_date,
      o.email,
      o.customer_name,
      o.city, o.state, o.country, o.postal_code,
      o.street1, o.street2, o.street3,
      o.age,
      o.items,
      o.rma,
      o.restocked_items,
      o.damaged_items,
      o.comments,
      o.status,
      o.agent_status,
      o.pending_tag,
      o.confirmed_at,
      o.imported_at,
      (SELECT max(e.recorded_at) FROM public.held_order_events e WHERE e.order_id = o.id) AS status_changed_at,
      (SELECT count(*)::int FROM public.held_order_events e WHERE e.order_id = o.id) AS event_count
    FROM public.held_orders o
    WHERE o.assigned_to = v_uid
      AND o.duplicate_of IS NULL
      AND (
        p_status = 'all' OR p_status IS NULL OR o.agent_status = p_status
        -- compatibilidade: chamadas antigas pediam 'pending'/'confirmed'
        OR (p_status = 'pending'   AND o.agent_status <> 'concluido')
        OR (p_status = 'confirmed' AND o.agent_status =  'concluido')
      )
  ) t;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.manager_distribute_held_orders(p_order_ids uuid[], p_agent_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_agents   text[];
  v_n        int;
  v_moved    int := 0;
  v_sticky   int := 0;
  v_siblings int := 0;
  v_by_agent jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_order_ids is required';
  END IF;

  -- Normaliza a lista de agentes: remove nulos/vazios e duplicados, ordena estável.
  SELECT array_agg(a ORDER BY a) INTO v_agents
  FROM (SELECT DISTINCT unnest(p_agent_ids) AS a) s
  WHERE a IS NOT NULL AND length(a) > 0;

  v_n := COALESCE(array_length(v_agents, 1), 0);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'at least one destination agent is required';
  END IF;

  -- Todos os agentes destino precisam existir e estar ativos.
  IF EXISTS (
    SELECT 1
    FROM unnest(v_agents) x(id)
    LEFT JOIN public.profiles p ON p.id = x.id
    WHERE p.id IS NULL OR p.is_active IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'one or more destination agents not found or inactive';
  END IF;

  WITH batch AS (
    SELECT o.id,
           public.held_order_client_key(o.email, o.customer_name, o.id) AS client_key,
           COALESCE(o.order_date, o.return_date) AS order_date
    FROM public.held_orders o
    WHERE o.id = ANY(p_order_ids)
      AND o.agent_status <> 'concluido'
      AND o.duplicate_of IS NULL
  ),
  -- Todas as linhas em aberto dos clientes envolvidos (inclui as de fora do lote:
  -- é o que garante o cliente inteiro num só agente).
  affected AS (
    SELECT o.id,
           public.held_order_client_key(o.email, o.customer_name, o.id) AS client_key,
           o.assigned_to,
           o.agent_status,
           o.imported_at,
           o.order_date,
           (o.id = ANY(p_order_ids)) AS in_batch
    FROM public.held_orders o
    WHERE o.duplicate_of IS NULL
      AND o.agent_status <> 'concluido'
      AND public.held_order_client_key(o.email, o.customer_name, o.id)
          IN (SELECT client_key FROM batch)
  ),
  -- Dono atual do cliente: agente ATIVO com linha em aberto fora do lote. Agente
  -- inativo não conta — a linha dele é remanejada junto.
  owner AS (
    SELECT DISTINCT ON (a.client_key) a.client_key, a.assigned_to AS agent_id
    FROM affected a
    JOIN public.profiles p ON p.id = a.assigned_to AND p.is_active
    WHERE a.assigned_to IS NOT NULL
      AND NOT a.in_batch
    ORDER BY a.client_key, (a.agent_status = 'em_andamento') DESC, a.imported_at, a.id
  ),
  -- Clientes sem dono ativo entram no round-robin — um agente por cliente.
  groups AS (
    SELECT b.client_key,
           (row_number() OVER (ORDER BY max(b.order_date) DESC NULLS LAST, b.client_key)) - 1 AS gn
    FROM batch b
    WHERE NOT EXISTS (SELECT 1 FROM owner o WHERE o.client_key = b.client_key)
    GROUP BY b.client_key
  ),
  plan AS (
    SELECT a.id, a.in_batch, a.assigned_to AS was, o.agent_id, true AS sticky
    FROM affected a
    JOIN owner o ON o.client_key = a.client_key
    UNION ALL
    SELECT a.id, a.in_batch, a.assigned_to, v_agents[(g.gn % v_n) + 1], false
    FROM affected a
    JOIN groups g ON g.client_key = a.client_key
  ),
  upd AS (
    UPDATE public.held_orders o
    SET assigned_to  = pl.agent_id,
        -- Só conta como nova distribuição quando o agente realmente muda.
        assign_count = o.assign_count
                       + CASE WHEN o.assigned_to IS DISTINCT FROM pl.agent_id THEN 1 ELSE 0 END
    FROM plan pl
    WHERE o.id = pl.id
    RETURNING pl.agent_id AS agent_id, pl.in_batch, pl.sticky,
              (pl.was IS DISTINCT FROM pl.agent_id) AS changed
  ),
  agg AS (
    SELECT u.agent_id,
           -- Só o que esta operação de fato fez: linha do lote ou irmã remanejada.
           -- Linha do mesmo cliente que já estava com o agente certo não entra na conta.
           count(*) FILTER (WHERE u.in_batch OR u.changed)::int        AS cnt,
           count(*) FILTER (WHERE u.in_batch)::int                    AS in_batch,
           count(*) FILTER (WHERE u.in_batch AND u.sticky)::int       AS sticky,
           count(*) FILTER (WHERE NOT u.in_batch AND u.changed)::int  AS siblings
    FROM upd u
    GROUP BY u.agent_id
  )
  SELECT
    COALESCE(sum(a.in_batch), 0)::int,
    COALESCE(sum(a.sticky), 0)::int,
    COALESCE(sum(a.siblings), 0)::int,
    COALESCE(
      jsonb_agg(
        jsonb_build_object('agent_id', a.agent_id, 'full_name', p.full_name, 'count', a.cnt)
        ORDER BY p.full_name
      ),
      '[]'::jsonb
    )
  INTO v_moved, v_sticky, v_siblings, v_by_agent
  FROM agg a
  LEFT JOIN public.profiles p ON p.id = a.agent_id;

  RETURN jsonb_build_object(
    'moved', v_moved,
    'by_agent', v_by_agent,
    'kept_with_owner', v_sticky,
    'pulled_siblings', v_siblings
  );
END;
$function$;
