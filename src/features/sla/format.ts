import type { OverdueQueueTipo } from "./types";

/**
 * "Vencido há 6h" / "Vencido há 1 dia". As horas vêm do relógio de prazo
 * (horas úteis), então 24h = 1 dia útil.
 */
export function formatVencidoHa(horas: number): string {
  const h = Math.max(0, Math.floor(horas));
  if (h < 1) return "Vencido há menos de 1h";
  if (h < 24) return `Vencido há ${h}h`;
  const dias = Math.floor(h / 24);
  return `Vencido há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

/** "24h úteis" / "48h úteis". */
export function formatPrazoContratual(horas: number): string {
  return `${horas}h úteis`;
}

/** Caso (#id): ids são uuid; os 8 primeiros caracteres bastam para achar na fila. */
export function formatCasoId(id: string): string {
  return `#${id.slice(0, 8)}`;
}

/** "2026-10" → "outubro de 2026". */
export function formatMesPorExtenso(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  if (!y || !m) return mes;
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

/** Primeiro dia do mês (YYYY-MM-01) no fuso de São Paulo, deslocado `offset` meses. */
export function saoPauloMonthStart(offset = 0, now: Date = new Date()): string {
  const [y, m] = now
    .toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
    .split("-")
    .map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Tela onde o caso é tratado. */
export function filaPath(tipo: OverdueQueueTipo): string {
  return tipo === "radar" ? "/workspace/radar" : "/workspace/reembolsos";
}
