-- Fix: add product column to my_refunds_with_refunded_value RPC
CREATE OR REPLACE FUNCTION public.my_refunds_with_refunded_value()
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  user_id uuid,
  customer_email text,
  request_date date,
  completion_date date,
  reason text,
  items_returned boolean,
  sales_platform text,
  order_id text,
  refund_type text,
  refund_value numeric,
  refunded_value numeric,
  product text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    r.id,
    r.created_at,
    r.user_id,
    r.customer_email,
    r.request_date,
    r.completion_date,
    r.reason,
    r.items_returned,
    r.sales_platform,
    r.order_id,
    r.refund_type,
    r.refund_value,
    CASE
      WHEN r.refund_value IS NULL THEN NULL
      WHEN r.refund_type IS NULL THEN NULL
      WHEN r.refund_type !~ '^\d{1,3}%$' THEN NULL
      ELSE
        CASE
          WHEN (replace(r.refund_type, '%', '')::numeric) < 0 THEN NULL
          WHEN (replace(r.refund_type, '%', '')::numeric) > 100 THEN NULL
          ELSE round(r.refund_value * (replace(r.refund_type, '%', '')::numeric / 100), 2)
        END
    END AS refunded_value,
    r.product
  FROM public.refunds r
  WHERE r.user_id = auth.uid()
  ORDER BY r.request_date DESC;
$$;
