import { z } from "zod";
import { isoDate, isoInstant, moneySchema, numberedPage, pageParams, uuid } from "./common";
import { catalogRefSchema } from "./tickets";

/**
 * Reembolsos.
 *
 * Três coisas mudam em relação ao legado:
 *
 * 1. O valor viaja como `{ amount, currency }`. Era `double precision`
 *    no banco e número solto no JSON, e a mesma coluna foi formatada em
 *    real numa tela e em dólar em outra até 26/09/2026.
 * 2. O percentual é número, não texto. `05%` e `5%` eram coisas
 *    diferentes para a ordenação.
 * 3. A baixa é uma rota só. Hoje o agente escreve direto na tabela sem
 *    validação nenhuma e a gestora passa por função que recusa data no
 *    futuro, data anterior à solicitação e valor negativo. Mesma ação,
 *    dois comportamentos.
 */

export const REFUND_STATUSES = ["aberto", "concluido"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const refundSchema = z.object({
  id: uuid,
  ticketId: uuid.nullable(),
  agentId: uuid,
  agentName: z.string().nullable(),

  orderId: z.string(),
  customerEmail: z.string(),

  platform: catalogRefSchema.nullable(),
  channel: catalogRefSchema.nullable(),
  product: z.object({ id: uuid, name: z.string() }).nullable(),

  requestDate: isoDate,
  completionDate: isoDate.nullable(),

  value: moneySchema.nullable(),
  /** Percentual inteiro. A tela formata como "80%". */
  percent: z.number().int().min(0).max(100).nullable(),

  reason: z.string().nullable(),
  reasonCategory: z.string().nullable(),

  itemsReturned: z.boolean(),
  createdFromTicket: z.boolean(),

  pickedUpAt: isoInstant.nullable(),
  pickedUpByName: z.string().nullable(),

  /** Derivado da data de baixa, para a tela não decidir. */
  status: z.enum(REFUND_STATUSES),
  /** Dias desde a solicitação, para reembolso ainda aberto. */
  daysOpen: z.number().int().nullable(),

  createdAt: isoInstant,
});
export type Refund = z.infer<typeof refundSchema>;

// ---------------------------------------------------------------------
// GET /refunds — lista fria, paginada por número (decisão D7)
// ---------------------------------------------------------------------

export const listRefundsQuery = pageParams.extend({
  agentId: uuid.optional(),
  status: z.enum(REFUND_STATUSES).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListRefundsQuery = z.infer<typeof listRefundsQuery>;

export const listRefundsResponse = numberedPage(refundSchema).extend({
  /** Soma dos valores da consulta inteira, não só da página. */
  totalValue: moneySchema,
});
export type ListRefundsResponse = z.infer<typeof listRefundsResponse>;

// ---------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------

export const createRefundBody = z.object({
  ticketId: uuid.nullable().optional(),
  orderId: z.string().trim().min(1).max(100),
  customerEmail: z.string().trim().min(1).max(320),
  platformId: z.number().int().nullable().optional(),
  channelId: z.number().int().nullable().optional(),
  productId: uuid.nullable().optional(),
  requestDate: isoDate,
  reason: z.string().trim().max(2000).nullable().optional(),
  itemsReturned: z.boolean().default(false),
});
export type CreateRefundBody = z.infer<typeof createRefundBody>;

/**
 * Dar baixa.
 *
 * Uma rota só, com a validação que hoje só a gestora enfrenta. Custo
 * medido de aplicar a todos: 39 linhas históricas violam, e elas
 * atravessaram pela regra do passado.
 */
export const completeRefundBody = z
  .object({
    completionDate: isoDate,
    /** Em dólar. O sistema inteiro é dólar (decisão D4). */
    amount: z.number().min(0),
    percent: z.number().int().min(0).max(100),
    reason: z.string().trim().min(1).max(2000),
    itemsReturned: z.boolean().default(false),
  })
  .strict();
export type CompleteRefundBody = z.infer<typeof completeRefundBody>;

export const updateRefundBody = createRefundBody.partial().strict();
export type UpdateRefundBody = z.infer<typeof updateRefundBody>;

// ---------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------

export const REFUND_EVENT_KINDS = [
  "created", "picked_up", "completed", "reopened", "edited", "deleted",
] as const;

export const refundEventSchema = z.object({
  id: z.number(),
  kind: z.enum(REFUND_EVENT_KINDS),
  actorId: uuid,
  actorName: z.string().nullable(),
  note: z.string().nullable(),
  recordedAt: isoInstant,
});
export type RefundEvent = z.infer<typeof refundEventSchema>;
