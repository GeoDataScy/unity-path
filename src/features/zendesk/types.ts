/** Contratos da Edge Function `zendesk` (supabase/functions/zendesk/index.ts). */

export const ZENDESK_TICKET_STATUSES = ["new", "open", "pending", "hold", "solved", "closed"] as const;
export type ZendeskTicketStatus = (typeof ZENDESK_TICKET_STATUSES)[number];

export const ZENDESK_STATUS_LABEL: Record<ZendeskTicketStatus, string> = {
  new: "Novo",
  open: "Aberto",
  pending: "Pendente",
  hold: "Em espera",
  solved: "Resolvido",
  closed: "Fechado",
};

/** Nomes em pt-BR para `via.channel` do Zendesk. */
export const ZENDESK_CHANNEL_LABEL: Record<string, string> = {
  email: "E-mail",
  web: "Portal",
  api: "API",
  chat: "Chat",
  voice: "Telefone",
  sms: "SMS",
  whatsapp: "WhatsApp",
  native_messaging: "Messaging",
  instagram_dm: "Instagram",
  facebook: "Facebook",
  twitter: "X (Twitter)",
  any_channel: "Outro",
  rule: "Automação",
  system: "Sistema",
};

/**
 * Campos do Intelligent Triage. Ids fixos da conta xmx-54224 — o Zendesk não
 * nomeia campo customizado na resposta do ticket, só devolve `custom_fields`
 * com o id, então a Edge Function precisa do número para extrair o valor.
 */
export const ZENDESK_TOPIC_FIELD_ID = 53650712058387;
export const ZENDESK_TOPIC_CONFIDENCE_FIELD_ID = 53650712060947;

export const ZENDESK_TOPIC_CONFIDENCES = [
  "topic_confidence__low",
  "topic_confidence__medium",
  "topic_confidence__high",
] as const;
export type ZendeskTopicConfidence = (typeof ZENDESK_TOPIC_CONFIDENCES)[number];

export const ZENDESK_TOPIC_CONFIDENCE_LABEL: Record<ZendeskTopicConfidence, string> = {
  topic_confidence__low: "baixa",
  topic_confidence__medium: "média",
  topic_confidence__high: "alta",
};

export type ZendeskStatus =
  | {
      connected: true;
      subdomain: string;
      account_name: string;
      account_email: string | null;
      total_tickets: number;
      refreshed_at: string;
      period: { from: string | null; to: string | null; total: number };
      by_status: Record<ZendeskTicketStatus, number>;
    }
  | { connected: false; error: string };

export type ZendeskTicket = {
  id: number;
  subject: string | null;
  status: ZendeskTicketStatus;
  priority: string | null;
  channel: string | null;
  received_by: string | null;
  created_at: string;
  updated_at: string;
  requester_name: string | null;
  requester_email: string | null;
  assignee_name: string | null;
  group_id: number | null;
  group_name: string | null;
  tags: string[];
  /** Intenção classificada pelo Intelligent Triage; null quando não classificou. */
  topic: string | null;
  topic_confidence: ZendeskTopicConfidence | null;
  replies: number | null;
  reopens: number | null;
  assignee_updated_at: string | null;
  requester_updated_at: string | null;
  latest_comment_added_at: string | null;
  solved_at: string | null;
  first_reply_minutes: number | null;
  resolution_minutes: number | null;
  url: string;
};

export type ZendeskTicketsPage = {
  page: number;
  per_page: number;
  total: number;
  has_more: boolean;
  query?: string;
  tickets: ZendeskTicket[];
};

export type ZendeskComment = {
  id: number;
  created_at: string;
  author_kind: "cliente" | "time";
  author_name: string | null;
  author_email: string | null;
  public: boolean;
  internal_note: boolean;
  channel: string | null;
  body: string;
  attachments: { file_name: string; content_type: string; size: number; url: string }[];
};

export type ZendeskTicketDetail = {
  ticket: ZendeskTicket;
  summary: {
    total_comments: number;
    team_public_replies: number;
    client_messages: number;
    internal_notes: number;
    last_team_public_reply_at: string | null;
    last_client_message_at: string | null;
    last_internal_note_at: string | null;
  };
  comments: ZendeskComment[];
};

export type ZendeskGroup = { id: number; name: string };

export type ZendeskTicketFilters = {
  status: ZendeskTicketStatus | "all";
  groupId: number | null;
  q: string;
  from: string;
  to: string;
  page: number;
};

/**
 * Resposta da ação `lookup` — a única do Zendesk aberta ao agente.
 *
 * Diferente de `tickets`, não pagina nem aceita busca livre: um e-mail entra,
 * os tickets recentes daquele solicitante saem. Superfície estreita de
 * propósito, porque o agente não precisa navegar a conta inteira para
 * preencher um atendimento.
 */
export type ZendeskLookup = {
  email: string;
  /** Total de tickets do solicitante na conta, mesmo além dos devolvidos. */
  total: number;
  tickets: ZendeskTicket[];
};
