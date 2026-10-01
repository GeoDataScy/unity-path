import { z } from "zod";

/**
 * Códigos de erro do contrato (00-CONTRATO.md §3).
 *
 * O código é estável e faz parte do contrato: o front reage a ele.
 * A `message` é técnica e serve para log — o texto que o usuário lê é
 * escolhido pelo front a partir do código, para manter o pt-BR e o tom
 * da interface no lugar onde ele pertence.
 */
export const ERROR_CODES = [
  // 401
  "UNAUTHENTICATED",
  "TOKEN_EXPIRED",
  // 403
  "ACCOUNT_BLOCKED",
  "FORBIDDEN",
  "MISSING_CAPABILITY",
  // 404
  // Caminho que a API não serve. Distinto de TICKET_NOT_FOUND:
  // um é erro de URL, o outro é recurso que não existe.
  "ROUTE_NOT_FOUND",
  "TICKET_NOT_FOUND",
  "REFUND_NOT_FOUND",
  "USER_NOT_FOUND",
  // 400
  "VALIDATION_FAILED",
  "INVALID_CURSOR",
  "INVALID_PAGE",
  // 409
  "TICKET_DUPLICATE_SAME_AGENT",
  "TICKET_DUPLICATE_OTHER_AGENT",
  "INTERACTION_SEQ_CONFLICT",
  "TRANSFER_ALREADY_PENDING",
  "TAKEOVER_ALREADY_PENDING",
  "REFUND_ALREADY_EXISTS",
  // 422
  "TICKET_ALREADY_CONCLUDED",
  "ORDER_ID_REQUIRED_FOR_REFUND",
  "CONTACT_REASON_NOTE_REQUIRED",
  "CONTACT_REASON_NOTE_NOT_ALLOWED",
  "PLATFORM_NOT_SELECTABLE",
  "CHANNEL_NOT_SELECTABLE",
  "REFUND_COMPLETION_BEFORE_REQUEST",
  // 429 / 500
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/**
 * Status HTTP de cada código. Fica aqui, e não na API, para que o front
 * possa distinguir "erro de regra" de "erro de transporte" sem adivinhar.
 */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  ACCOUNT_BLOCKED: 403,
  FORBIDDEN: 403,
  MISSING_CAPABILITY: 403,
  ROUTE_NOT_FOUND: 404,
  TICKET_NOT_FOUND: 404,
  REFUND_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  INVALID_CURSOR: 400,
  INVALID_PAGE: 400,
  TICKET_DUPLICATE_SAME_AGENT: 409,
  TICKET_DUPLICATE_OTHER_AGENT: 409,
  INTERACTION_SEQ_CONFLICT: 409,
  TRANSFER_ALREADY_PENDING: 409,
  TAKEOVER_ALREADY_PENDING: 409,
  REFUND_ALREADY_EXISTS: 409,
  TICKET_ALREADY_CONCLUDED: 422,
  ORDER_ID_REQUIRED_FOR_REFUND: 422,
  CONTACT_REASON_NOTE_REQUIRED: 422,
  CONTACT_REASON_NOTE_NOT_ALLOWED: 422,
  PLATFORM_NOT_SELECTABLE: 422,
  CHANNEL_NOT_SELECTABLE: 422,
  REFUND_COMPLETION_BEFORE_REQUEST: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};
