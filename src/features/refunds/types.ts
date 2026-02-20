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
  refunded_value?: number | null; // calculado no backend (numeric)
  product: string | null;
};

export const SALES_PLATFORMS = ["Cartpanda", "Buygoods", "Hotmart"] as const;
export type SalesPlatform = (typeof SALES_PLATFORMS)[number];

export const REFUND_PRODUCTS = [
  "Arialief",
  "Alphacur",
  "Blinzador",
  "Feilaira",
  "Garaherb",
  "Karylief",
  "Kymezol",
  "Jertaris",
  "Laellium",
  "Memyts",
  "Presgera",
  "Biografa",
  "Cetacondor",
  "Cetadusse",
  "Sciatilief",
  "Goldenfrib",
  "Felaromi",
  "Tenurima",
  "Ariovira",
  "CucuDrops",
  "Zalovira",
  "Xelovita",
  "Cerami",
  "NATHUREX",
  "Mahgryn",
  "Levhyn",
  "Ariomyx",
  "Alitoryn",
  "Athentys",
  "Velynivo",
  "Mioralab",
  "Vergolief",
  "Olisteren",
  "Halegryn",
  "Danmyts",
  "Maizkidor",
  "Basmontex",
  "Fraganief",
  "Ceramiri",
  "Shapeon",
  "Nexburn",
  "Memoryon",
  "Korvizol",
  "Erectozyn",
  "Thewellnesswize",
  "VIP.Shipping",
] as const;
