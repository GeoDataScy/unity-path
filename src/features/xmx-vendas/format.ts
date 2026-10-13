import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

import type { XmxGroupBy } from "./useXmxSistemaQuery";

const inteiro = new Intl.NumberFormat("pt-BR");
const dolar = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dolarCompacto = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export const fmtInt = (n: number | null | undefined) => inteiro.format(n ?? 0);
/** US$ 1.234.567 — para tabelas e tooltips. */
export const fmtUsd = (n: number | null | undefined) => dolar.format(n ?? 0);
/** Faturamento de uma linha: "—" quando há pedidos mas a plataforma não informa valor (DigiStore). */
export const fmtUsdLinha = (usd: number, pedidos: number) => (pedidos > 0 && !usd ? "—" : fmtUsd(usd));
/** US$ 1,2 mi — para os números grandes dos cartões e eixos. */
export const fmtUsdCurto = (n: number | null | undefined) => dolarCompacto.format(n ?? 0);
export const fmtPct = (n: number | null | undefined, casas = 1) =>
  n === null || n === undefined ? "—" : `${n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

export function rotuloBucket(bucket: string, groupBy: XmxGroupBy) {
  const d = parseISO(bucket);
  if (groupBy === "month") return format(d, "MMM/yy", { locale: ptBR });
  if (groupBy === "week") return `sem. ${format(d, "dd/MM")}`;
  return format(d, "dd/MM");
}

const fmtDia = (iso: string) => format(parseISO(iso), "dd/MM/yyyy");

export function rotuloPeriodo(from: string, to: string) {
  const hoje = format(new Date(), "yyyy-MM-dd");
  if (from === to) return from === hoje ? "hoje" : fmtDia(from);
  return `${fmtDia(from)} a ${fmtDia(to)}`;
}

const PAISES: Record<string, string> = {
  "United States": "Estados Unidos",
  Canada: "Canadá",
  Australia: "Austrália",
  "United Kingdom": "Reino Unido",
  "New Zealand": "Nova Zelândia",
  Outros: "Outros países",
};
export const nomePais = (c: string) => PAISES[c] ?? c;
