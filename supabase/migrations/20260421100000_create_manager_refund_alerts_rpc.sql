-- RPC: manager_refund_alerts
-- Returns all open refunds overdue by more than 24h, grouped by agent.
-- "Overdue" = completion_date IS NULL AND request_date < CURRENT_DATE
-- (mirrors the agent-side PendingRefundsAlert logic that parses request_date as midnight local time)

CREATE OR REPLACE FUNCTION public.manager_refund_alerts()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_manager() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  RETURN (
    WITH overdue AS (
      SELECT
        r.id,
        r.user_id,
        p.full_name                        AS agent_name,
        r.customer_email,
        r.request_date,
        r.sales_platform,
        r.order_id,
        r.product,
        r.channel,
        (CURRENT_DATE - r.request_date::date) AS days_overdue
      FROM public.refunds r
      JOIN public.profiles p ON p.id = r.user_id
      WHERE r.completion_date IS NULL
        AND r.request_date::date < CURRENT_DATE
    )
    SELECT jsonb_build_object(
      'total_overdue',    (SELECT COUNT(*)              FROM overdue),
      'agents_affected',  (SELECT COUNT(DISTINCT user_id) FROM overdue),
      'by_agent', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'agent_id',     user_id,
              'agent_name',   agent_name,
              'overdue_count', cnt,
              'refunds',      refunds
            )
            ORDER BY cnt DESC
          )
          FROM (
            SELECT
              user_id,
              agent_name,
              COUNT(*)      AS cnt,
              jsonb_agg(
                jsonb_build_object(
                  'id',            id,
                  'customer_email', customer_email,
                  'request_date',  request_date,
                  'sales_platform', sales_platform,
                  'order_id',      order_id,
                  'product',       product,
                  'channel',       channel,
                  'days_overdue',  days_overdue
                ) ORDER BY request_date ASC
              ) AS refunds
            FROM overdue
            GROUP BY user_id, agent_name
          ) sub
        ),
        '[]'::jsonb
      )
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.manager_refund_alerts() TO authenticated;
