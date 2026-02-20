-- Drop old function (return type changed — cannot use CREATE OR REPLACE)
DROP FUNCTION IF EXISTS public.my_refunds_with_refunded_value();

-- Recreate with product column + explicit casts
CREATE FUNCTION public.my_refunds_with_refunded_value()
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
    r.id::uuid,
    r.created_at::timestamptz,
    r.user_id::uuid,
    r.customer_email::text,
    r.request_date::date,
    r.completion_date::date,
    r.reason::text,
    r.items_returned::boolean,
    r.sales_platform::text,
    r.order_id::text,
    r.refund_type::text,
    r.refund_value::numeric,
    CASE
      WHEN r.refund_value IS NULL THEN NULL
      WHEN r.refund_type IS NULL THEN NULL
      WHEN r.refund_type !~ '^\d{1,3}%$' THEN NULL
      ELSE
        CASE
          WHEN (replace(r.refund_type, '%', '')::numeric) < 0 THEN NULL
          WHEN (replace(r.refund_type, '%', '')::numeric) > 100 THEN NULL
          ELSE round((r.refund_value * (replace(r.refund_type, '%', '')::numeric / 100))::numeric, 2)
        END
    END AS refunded_value,
    r.product::text
  FROM public.refunds r
  WHERE r.user_id::uuid = auth.uid()
  ORDER BY r.request_date DESC;
$$;
