import { z } from "zod";

/**
 * Tipos compartilhados do contrato (00-CONTRATO.md §3).
 *
 * `camelCase` no JSON, `snake_case` no banco. A conversão é
 * responsabilidade da API.
 */

/** Data sem hora: sempre um dia em America/Sao_Paulo (§5). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "esperado YYYY-MM-DD");

/** Instante com fuso, sempre em UTC no JSON. */
export const isoInstant = z.string().datetime({ offset: true });

export const uuid = z.string().uuid();

/**
 * Dinheiro viaja como valor + moeda, nunca número solto (G5.1).
 *
 * Foi a ausência disso que deixou um valor em dólar ser formatado como
 * real no relatório da gestora até 26/09/2026. Hoje `currency` é sempre
 * USD (decisão D4), mas o campo existe para que o rótulo não possa
 * divergir do dado.
 */
export const moneySchema = z.object({
  amount: z.number(),
  currency: z.literal("USD"),
});
export type Money = z.infer<typeof moneySchema>;

export const money = (amount: number): Money => ({ amount, currency: "USD" });

// ---------------------------------------------------------------------------
// Paginação
// ---------------------------------------------------------------------------

/**
 * Duas formas, por decisão D7.
 *
 * Cursor (keyset) nas listas quentes, que o agente mantém abertas o dia
 * todo e navega a partir do começo. Numerada nas listas frias, onde o
 * total é a informação que o usuário procura.
 *
 * O custo das listas de hoje nunca foi o OFFSET: era o predicado de data
 * em texto que ele percorria. Sobre uma tabela de fatos indexada por dia
 * e agente, saltar alguns milhares de linhas é barato.
 */

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** Teto obrigatório em toda rota de coleção (G10.1). */
export const limitParam = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(DEFAULT_LIMIT);

export const cursorParams = z.object({
  cursor: z.string().min(1).optional(),
  limit: limitParam,
});
export type CursorParams = z.infer<typeof cursorParams>;

export const pageParams = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: limitParam,
});
export type PageParams = z.infer<typeof pageParams>;

/** Coleção paginada por cursor. O cursor é opaco para o front. */
export const cursorPage = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });

/**
 * Coleção paginada por número de página.
 *
 * `totalCount` é devolvido porque as telas mostram "Página 3 de 12,
 * 287 registros". É contado sobre a tabela de fatos e guardado em cache
 * por combinação de filtro, para que trocar de página não reconte.
 */
export const numberedPage = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    limit: z.number().int(),
    totalCount: z.number().int().min(0),
    pageCount: z.number().int().min(0),
  });
