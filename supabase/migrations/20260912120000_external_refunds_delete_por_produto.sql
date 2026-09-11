-- Lixeira do comparativo de reembolsos externos: a gestora apaga o export
-- importado de um produto (todos os meses, ou só um mês) direto pela tela.
-- Serve para corrigir import com o arquivo errado (ex.: export de Honeyfil
-- importado como Horsefil), já que reimportar não remove pedidos que só
-- existiam no lote errado (chave é produto + nº do pedido + variante).

CREATE OR REPLACE FUNCTION public.manager_delete_external_refunds(
  p_product   text,
  p_month_ref date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_product IS NULL OR btrim(p_product) = '' THEN
    RAISE EXCEPTION 'p_product is required';
  END IF;

  WITH del AS (
    DELETE FROM public.external_refunds
     WHERE product = btrim(p_product)
       AND (p_month_ref IS NULL OR month_ref = p_month_ref)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  RETURN jsonb_build_object('product', btrim(p_product), 'month_ref', p_month_ref, 'deleted', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.manager_delete_external_refunds(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_delete_external_refunds(text, date) TO authenticated;
