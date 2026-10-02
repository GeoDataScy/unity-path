// O <input type="date"> do Chrome dispara onChange a cada dígito do ano: quem
// digita "2026" produz "0002-…", "0020-…", "0202-…" e só então "2026-…". Esses
// anos parciais são datas VÁLIDAS para o navegador e para o Postgres, e uma
// RPC que gera uma linha por dia (agent_my_metrics → by_day) passa a montar
// ~740 mil dias e prende o banco até o statement_timeout. Só mandamos ao banco
// datas com ano plausível para o sistema.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Menor ano aceito num filtro que vai para o banco (não há dado antes disso). */
export const MIN_FILTER_YEAR = 2020;

/** true quando `iso` é uma data YYYY-MM-DD completa e com ano plausível. */
export function isUsableFilterDate(iso: string, now: Date = new Date()): boolean {
  const match = ISO_DATE.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_FILTER_YEAR || year > now.getFullYear() + 1) return false;
  if (month < 1 || month > 12) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}
