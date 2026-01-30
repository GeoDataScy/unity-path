export type RefundItem = {
  id: string;
  created_at: string;
  user_id: string;
  customer_email: string;
  request_date: string; // YYYY-MM-DD
  completion_date: string | null; // YYYY-MM-DD
  reason: string | null;
  items_returned: boolean;
  sales_platform: string;
  order_id: string;
  refund_type: string | null;
  refund_value: number | null; // numeric(10,2)
};

export const SALES_PLATFORMS = ["Cartpanda", "Buygoods", "Hotmart"] as const;
export type SalesPlatform = (typeof SALES_PLATFORMS)[number];
