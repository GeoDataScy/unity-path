-- Drop existing function to allow changing return type
DROP FUNCTION IF EXISTS public.create_refund(text, date, text, text);
DROP FUNCTION IF EXISTS public.create_refund(text, date, text, text, text);

-- Create RPC function for inserting refunds (bypasses PostgREST schema cache)
CREATE OR REPLACE FUNCTION public.create_refund(
  p_customer_email text,
  p_request_date date,
  p_sales_platform text,
  p_order_id text,
  p_product text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.refunds (
    user_id,
    customer_email,
    request_date,
    sales_platform,
    order_id,
    product,
    reason,
    refund_type
  ) VALUES (
    auth.uid(),
    p_customer_email,
    p_request_date,
    p_sales_platform,
    p_order_id,
    p_product,
    '',
    'Estorno'
  );
END;
$$;
