-- Pedidos em Espera para o time de produtos (role `produto`, área /produtos).
--
-- O pedido: o time de produtos precisa ver os pedidos em espera exatamente como
-- a gestora vê em Data Analytics do Suporte — mesmos números, mesmas linhas,
-- mesmos filtros. Em vez de duplicar a RPC (e ter duas fontes divergindo com o
-- tempo, como já aconteceu com canal x interações), a `manager_list_held_orders`
-- passa a aceitar as duas leituras e a guarda vira uma disjunção.
--
-- Só a LEITURA é compartilhada. manager_import_held_orders,
-- manager_assign_held_orders e manager_distribute_held_orders continuam com
-- is_manager() — o time de produtos não mexe na operação do suporte, e a tela
-- deles nem mostra esses botões (HeldOrdersManagerTab com readOnly).
--
-- is_produtos_team() segue o padrão de is_copy_team() (20260817200000): SECURITY
-- DEFINER lendo profiles, para a checagem funcionar sem depender da RLS de
-- profiles do usuário que chamou.

CREATE OR REPLACE FUNCTION public.is_produtos_team()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())::text
      AND p.role::text = 'produto'
  );
$$;

REVOKE ALL ON FUNCTION public.is_produtos_team() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_produtos_team() TO authenticated;

-- Mesma função de 20260810170000, só com a guarda ampliada.
CREATE OR REPLACE FUNCTION public.manager_list_held_orders(
  from_date     date    DEFAULT NULL,
  to_date       date    DEFAULT NULL,
  agent_id      text    DEFAULT NULL,
  status_filter text    DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  WHERE (from_date IS NULL OR o.order_date >= from_date)
    AND (to_date   IS NULL OR o.order_date <= to_date)
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

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.order_date DESC NULLS LAST, t.id), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      o.id::text          AS id,
      o.dyna_code,
      o.order_number,
      o.merged_orders,
      o.reason,
      o.order_date,
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
      o.duplicate_of::text AS duplicate_of
    FROM public.held_orders o
    LEFT JOIN public.profiles pa ON pa.id = o.assigned_to
    WHERE (from_date IS NULL OR o.order_date >= from_date)
      AND (to_date   IS NULL OR o.order_date <= to_date)
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
$$;

REVOKE ALL ON FUNCTION public.manager_list_held_orders(date, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_list_held_orders(date, date, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
