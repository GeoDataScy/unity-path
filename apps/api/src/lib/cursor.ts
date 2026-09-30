import { fail } from "./errors.js";

/**
 * Cursor keyset opaco.
 *
 * O front devolve exatamente o que recebeu, sem interpretar. Assim a
 * chave de ordenação pode mudar sem quebrar contrato.
 *
 * Keyset e não OFFSET porque OFFSET reconta as linhas puladas a cada
 * página. Nas listas frias, onde o total aparece na tela, OFFSET é
 * aceitável — o custo das listas de hoje nunca foi o OFFSET, era o
 * predicado de data em texto que ele percorria.
 */
export type TicketCursor = { createdAt: string; id: string };

export const encodeCursor = (c: TicketCursor): string =>
  Buffer.from(JSON.stringify(c), "utf8").toString("base64url");

export const decodeCursor = (raw: string): TicketCursor => {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed?.createdAt !== "string" ||
      typeof parsed?.id !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      throw new Error("shape");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return fail("INVALID_CURSOR", "cursor inválido ou de uma ordenação anterior");
  }
};
