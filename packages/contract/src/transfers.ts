import { z } from "zod";
import { isoInstant, uuid } from "./common.js";

/**
 * Transferências, tomadas de ticket e notificações.
 *
 * Transferência e tomada são fluxos parecidos e distintos:
 *
 *   TRANSFERÊNCIA  quem atendeu pede que o DONO ORIGINAL continue.
 *                  O ticket não muda de dono.
 *   TOMADA         o dono está de folga e outro agente pede autorização
 *                  da gestora para assumir. Aí o dono muda.
 *
 * As duas, mais o alerta de reembolso, viram uma notificação só. Hoje são
 * três sinos com três consultas repetindo a cada 30 segundos por aba.
 */

export const REQUEST_STATUSES = ["pending", "accepted", "declined", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const ticketRefSchema = z.object({
  id: uuid,
  clientEmail: z.string(),
  productName: z.string(),
});

export const transferSchema = z.object({
  id: uuid,
  ticket: ticketRefSchema,
  fromUserId: uuid,
  fromUserName: z.string().nullable(),
  toUserId: uuid,
  toUserName: z.string().nullable(),
  status: z.enum(REQUEST_STATUSES),
  message: z.string().nullable(),
  responseNote: z.string().nullable(),
  respondedAt: isoInstant.nullable(),
  createdAt: isoInstant,
  /** Verdadeiro quando o usuário que pediu a lista é quem deve responder. */
  awaitingMe: z.boolean(),
});
export type Transfer = z.infer<typeof transferSchema>;

export const takeoverSchema = z.object({
  id: uuid,
  ticket: ticketRefSchema,
  requesterId: uuid,
  requesterName: z.string().nullable(),
  ownerId: uuid.nullable(),
  ownerName: z.string().nullable(),
  /** Por que a tomada é possível: o dono está de folga. */
  ownerIsAvailable: z.boolean().nullable(),
  status: z.enum(REQUEST_STATUSES),
  note: z.string().nullable(),
  respondedAt: isoInstant.nullable(),
  respondedByName: z.string().nullable(),
  createdAt: isoInstant,
});
export type Takeover = z.infer<typeof takeoverSchema>;

// ---------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------

export const createTransferBody = z.object({
  ticketId: uuid,
  message: z.string().trim().max(1000).nullable().optional(),
});

export const respondTransferBody = z.object({
  responseNote: z.string().trim().max(1000).nullable().optional(),
});

export const createTakeoverBody = z.object({
  ticketId: uuid,
  note: z.string().trim().max(1000).nullable().optional(),
});

export const respondTakeoverBody = z.object({
  note: z.string().trim().max(1000).nullable().optional(),
});

// ---------------------------------------------------------------------
// Notificações — um sino, uma tabela, um canal
// ---------------------------------------------------------------------

export const NOTIFICATION_KINDS = [
  "transfer_requested", "transfer_accepted", "transfer_declined",
  "takeover_requested", "takeover_approved", "takeover_rejected",
  "refund_overdue",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notificationSchema = z.object({
  id: z.number(),
  kind: z.enum(NOTIFICATION_KINDS),
  /** Tudo que a linha do sino precisa, sem ir buscar mais nada. */
  payload: z.record(z.string(), z.unknown()),
  ticketId: uuid.nullable(),
  seenAt: isoInstant.nullable(),
  createdAt: isoInstant,
});
export type Notification = z.infer<typeof notificationSchema>;

export const listNotificationsResponse = z.object({
  items: z.array(notificationSchema),
  unseenCount: z.number().int().min(0),
});
export type ListNotificationsResponse = z.infer<typeof listNotificationsResponse>;
