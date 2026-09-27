import { z } from "zod";
import { cursorPage, cursorParams, isoDate, isoInstant, uuid } from "./common";

/**
 * Atendimentos (tickets) — o núcleo do sistema.
 *
 * Origem no legado: `services` + `service_follow_ups`.
 * Especificação: docs/arquitetura-v2/12-backend-schema-alvo.md §3.1 e §3.2.
 */

/** Os 11 motivos, cópia fiel de src/features/services/contact-reasons.ts. */
export const CONTACT_REASONS = [
  "duvida_de_uso",
  "reembolso",
  "cancelamento_de_compra",
  "cancelamento_de_assinatura",
  "reclamacao_vsl",
  "troca_de_endereco",
  "embalagem_danificada",
  "duvida_de_envio",
  "ingredientes",
  "duvidas_geral",
  "outro",
] as const;
export type ContactReason = (typeof CONTACT_REASONS)[number];

/** Só "outro" exige nota; só "reclamacao_vsl" a admite como opcional. */
export const CONTACT_REASON_NOTE_REQUIRED: ContactReason[] = ["outro"];
export const CONTACT_REASON_NOTE_OPTIONAL: ContactReason[] = ["reclamacao_vsl"];
export const CONTACT_REASON_NOTE_MAX = 200;

/**
 * Estado gravado na coluna. Dois valores, não três: `'pendente'` é o
 * default da coluna em produção e tem ZERO linhas (medição M1).
 */
export const TICKET_STATUSES = ["registered", "concluido"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Estado que a tela mostra. Materializado na linha do ticket, escrito na
 * mesma transação da interação (G1.1).
 *
 * Hoje isto é calculado no browser a partir do histórico inteiro de
 * follow-ups, o que baixa até 1,5 MB por agente e produziu 10.115 tickets
 * divergentes. Aqui ele chega pronto.
 */
export const TICKET_DERIVED_STATUSES = ["novo", "em_andamento", "concluido"] as const;
export type TicketDerivedStatus = (typeof TICKET_DERIVED_STATUSES)[number];

/** Status de uma interação. */
export const INTERACTION_STATUSES = ["em_andamento", "concluido"] as const;
export type InteractionStatus = (typeof INTERACTION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Recursos
// ---------------------------------------------------------------------------

/** Item de catálogo. `isSelectable=false` é dado fora de lugar, preservado. */
export const catalogRefSchema = z.object({
  id: z.number().int(),
  label: z.string(),
  kind: z.enum(["value", "not_applicable", "misfiled"]),
});

/**
 * Linha da lista de atendimentos do agente.
 *
 * Tudo que a tela precisa para pintar o badge e o contador já vem aqui.
 * O front não abre o histórico para descobrir o status.
 */
export const ticketListItemSchema = z.object({
  id: uuid,
  clientEmail: z.string(),
  businessDay: isoDate,
  product: z.object({ id: uuid, name: z.string() }),
  platform: catalogRefSchema.nullable(),
  channel: catalogRefSchema.nullable(),
  contactReason: z.enum(CONTACT_REASONS).nullable(),
  contactReasonNote: z.string().nullable(),
  orderId: z.string().nullable(),
  hasTrackingCode: z.boolean(),

  // Estado materializado (G1.1) — nunca derivado no cliente.
  derivedStatus: z.enum(TICKET_DERIVED_STATUSES),
  interactionCount: z.number().int().min(1),
  lastInteractionAt: isoInstant.nullable(),

  ownerId: uuid,
  ownerName: z.string().nullable(),
  isMine: z.boolean(),
  createdAt: isoInstant,
});
export type TicketListItem = z.infer<typeof ticketListItemSchema>;

export const interactionSchema = z.object({
  id: uuid,
  ticketId: uuid,
  /** Atribuído pelo banco, com UNIQUE (ticket_id, seq). O cliente nunca envia. */
  seq: z.number().int().min(1),
  status: z.enum(INTERACTION_STATUSES),
  observation: z.string().nullable(),
  recordedAt: isoInstant,
  authorId: uuid,
  authorName: z.string().nullable(),
  /**
   * Marcado pelo banco. Não bloqueia nada (decisão D1 removeu o bloqueio
   * das 18h), mas é o que impede a métrica de contar a mesma conversa
   * duas vezes.
   */
  isSameDayRepeat: z.boolean(),
});
export type Interaction = z.infer<typeof interactionSchema>;

// ---------------------------------------------------------------------------
// GET /tickets — lista quente do agente, paginada por cursor
// ---------------------------------------------------------------------------

export const listTicketsQuery = cursorParams.extend({
  /** Sem filtro, devolve os do próprio agente. */
  agentId: uuid.optional(),
  status: z.enum(TICKET_DERIVED_STATUSES).optional(),
  contactReason: z.enum(CONTACT_REASONS).optional(),
  /** Busca por e-mail, telefone, produto ou número do pedido. */
  q: z.string().trim().min(1).max(200).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListTicketsQuery = z.infer<typeof listTicketsQuery>;

export const listTicketsResponse = cursorPage(ticketListItemSchema);
export type ListTicketsResponse = z.infer<typeof listTicketsResponse>;

// ---------------------------------------------------------------------------
// POST /tickets
// ---------------------------------------------------------------------------

/**
 * O cliente envia só o que ele conhece.
 *
 * Não existe campo para `seq`, `derivedStatus`, `interactionCount` nem
 * `businessDay`: são do servidor (G1.3). O dia é o dia de São Paulo no
 * momento da criação, como o gatilho legado já fazia.
 */
export const createTicketBody = z
  .object({
    clientEmail: z.string().trim().min(1).max(320),
    productId: uuid,
    platformId: z.number().int().nullable().optional(),
    channelId: z.number().int().nullable().optional(),
    contactReason: z.enum(CONTACT_REASONS),
    contactReasonNote: z.string().trim().max(CONTACT_REASON_NOTE_MAX).nullable().optional(),
    orderId: z.string().trim().max(100).nullable().optional(),
    hasTrackingCode: z.boolean().default(false),
    observation: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const needsNote = CONTACT_REASON_NOTE_REQUIRED.includes(v.contactReason);
    const allowsNote =
      needsNote || CONTACT_REASON_NOTE_OPTIONAL.includes(v.contactReason);
    const note = v.contactReasonNote?.trim();

    if (needsNote && !note) {
      ctx.addIssue({
        code: "custom",
        path: ["contactReasonNote"],
        message: "obrigatório para este motivo",
      });
    }
    if (!allowsNote && note) {
      ctx.addIssue({
        code: "custom",
        path: ["contactReasonNote"],
        message: "não permitido para este motivo",
      });
    }
    // Hoje só a interface exige. Passa a ser regra de servidor.
    if (v.contactReason === "reembolso" && !v.orderId?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["orderId"],
        message: "obrigatório quando o motivo é reembolso",
      });
    }
  });
export type CreateTicketBody = z.infer<typeof createTicketBody>;

// ---------------------------------------------------------------------------
// POST /tickets/:id/interactions
// ---------------------------------------------------------------------------

/**
 * Registrar interação.
 *
 * Não valida janela de horário: a decisão D1 removeu o bloqueio das 18h,
 * que existia só no browser e de forma incoerente (a lista recusava, o
 * diálogo deixava passar).
 */
export const createInteractionBody = z.object({
  status: z.enum(INTERACTION_STATUSES),
  observation: z.string().trim().max(2000).nullable().optional(),
});
export type CreateInteractionBody = z.infer<typeof createInteractionBody>;

/** A resposta devolve o ticket já atualizado, para a tela não recalcular. */
export const createInteractionResponse = z.object({
  interaction: interactionSchema,
  ticket: ticketListItemSchema,
});
export type CreateInteractionResponse = z.infer<typeof createInteractionResponse>;

// ---------------------------------------------------------------------------
// GET /tickets/lookup?email=
// ---------------------------------------------------------------------------

export const lookupTicketQuery = z.object({
  email: z.string().trim().min(1).max(320),
});

export const lookupTicketResponse = z.object({
  /** Ticket aberto encontrado para o e-mail, se houver. */
  ticket: ticketListItemSchema.nullable(),
  /** Quando existe e é de outro agente, isto decide o que a tela oferece. */
  ownerIsAvailable: z.boolean().nullable(),
});
export type LookupTicketResponse = z.infer<typeof lookupTicketResponse>;
