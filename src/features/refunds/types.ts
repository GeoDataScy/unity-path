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
  channel: string | null;
  /** Atendimento que originou o reembolso; null = cadastrado direto nesta aba. */
  service_id?: string | null;
  /** Quando o agente assumiu. Vindo do atendimento e ainda null = linha apagada. */
  picked_up_at?: string | null;
};

export const SALES_PLATFORMS = ["Nenhum", "Cartpanda", "CartCandy", "Buygoods", "ClickBank", "Digistore24", "SalesBound", "LogiCall", "PagAmerican"] as const;
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
  "VisualEase",
  "NerveEase",
  "Steelpower",
  "Gluco Off",
  "Cognivex",
  "Nad Dermal+",
  "Alpharock",
  "Hair Bloom",
  "Guardon",
  "Joint Mend",
  "Keskara",
  "Lipolegs",
  "LipoShape",
  "Mind Recall",
  "Mind Wake",
  "Prostate Vital",
  "Quiet Nerves",
  "Quiet Rest",
  "RingSilence",
  "FlowStrong",
  "Youth Within",
  "Thermo Ignite",
  "Glyco Barrier",
  "Gluco Mild",
  "Horsefil",
  "Honeyfil",
  "Clear Gaze",
  "PagAmerican",
  "Jellyrock",
  "Blue Horse",
  "Nail Defender",
  "Mind Honey Trick",
  "Nerve Relief Protocol",
  "Lean Leg",
  "Soda Burn",
  "Nerve Stride",
  "Honey Vital",
  "Cardio Honey",
  "Gut Active",
  "Military Honey",
  "Golden Nerves",
] as const;
