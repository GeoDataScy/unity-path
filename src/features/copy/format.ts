const DASH = "—";

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined) return DASH;
  return value.toLocaleString("pt-BR");
}

/**
 * Dólar: `refunds.refund_value` é lançado em real e a RPC já devolve convertido
 * pela cotação de `app_settings`. Locale continua pt-BR (separador de milhar
 * com ponto), só a moeda muda — sai "US$ 119.938".
 */
export function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return DASH;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** A cotação em si é real por dólar — essa continua em R$, com centavos. */
export function fmtRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return DASH;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return DASH;
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** Variação com sinal explícito — sem sinal, "3 p.p." não diz se subiu ou caiu. */
export function fmtSigned(value: number | null | undefined, suffix: string, digits = 1): string {
  if (value === null || value === undefined) return DASH;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}

export function fmtDays(value: number | null | undefined): string {
  if (value === null || value === undefined) return DASH;
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("pt-BR")} ${rounded === 1 ? "dia" : "dias"}`;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-08" → "ago/26". Sem parse de Date: evita fuso virando o mês. */
export function fmtMonth(value: string): string {
  const [year, month] = value.split("-");
  const idx = Number(month) - 1;
  if (!year || Number.isNaN(idx) || idx < 0 || idx > 11) return value;
  return `${MONTHS[idx]}/${year.slice(2)}`;
}

/** "2026-08-17" → "17/08/2026", sem passar por Date (o texto já é local). */
export function fmtISODate(value: string | null | undefined): string {
  if (!value) return DASH;
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}
