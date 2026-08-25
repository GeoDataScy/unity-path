// Bloco de notas — aritmética e rótulos de data.
//
// Duas regras que este arquivo existe para garantir:
//
// 1) "Hoje" é o dia em America/Sao_Paulo, igual ao DEFAULT de agent_notes.note_date.
//    Usar `new Date().getDate()` daria o dia da máquina do agente e, num turno da
//    noite, a anotação apareceria numa página diferente da que o banco gravou.
//
// 2) Toda conta é feita em UTC sobre 'YYYY-MM-DD'. A string nunca vira instante
//    local — somar dias com Date local erra o dia na virada de horário de verão.
//
// O módulo é autocontido de propósito: não importa helper de outra feature para
// que o caderno não quebre quando o Radar (que tem helpers parecidos) mudar.

const SP_TIME_ZONE = "America/Sao_Paulo";

/** Semana começa na SEGUNDA (é como a escala do time é lida). */
const WEEK_STARTS_ON_MONDAY = true;

/** Data de hoje em São Paulo, como 'YYYY-MM-DD'. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  // 'en-CA' formata exatamente como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** true quando a string é 'YYYY-MM-DD' e existe no calendário. */
export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  // Rejeita 2026-02-31, que Date.parse aceitaria rolando para março.
  return new Date(ms).toISOString().slice(0, 10) === value;
}

function toUtc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Soma (ou subtrai) dias corridos a uma data 'YYYY-MM-DD'. */
export function addDays(isoDate: string, days: number): string {
  if (!isIsoDate(isoDate)) return isoDate;
  const cursor = toUtc(isoDate);
  cursor.setUTCDate(cursor.getUTCDate() + Math.trunc(days));
  return toIso(cursor);
}

/** Soma (ou subtrai) meses, ancorando no dia 1 para não estourar fim de mês. */
export function addMonths(isoDate: string, months: number): string {
  if (!isIsoDate(isoDate)) return isoDate;
  const cursor = toUtc(isoDate);
  const day = cursor.getUTCDate();
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() + Math.trunc(months));
  // 31/01 + 1 mês = 28/02 (e não 03/03, que é o que o rollover daria).
  const lastDay = new Date(
    Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0),
  ).getUTCDate();
  cursor.setUTCDate(Math.min(day, lastDay));
  return toIso(cursor);
}

/** Segunda-feira da semana da data. */
export function startOfWeek(isoDate: string): string {
  if (!isIsoDate(isoDate)) return isoDate;
  const cursor = toUtc(isoDate);
  const dow = cursor.getUTCDay(); // 0 = domingo
  const offset = WEEK_STARTS_ON_MONDAY ? (dow === 0 ? -6 : 1 - dow) : -dow;
  return addDays(isoDate, offset);
}

/** Domingo da semana da data. */
export function endOfWeek(isoDate: string): string {
  return addDays(startOfWeek(isoDate), 6);
}

/** Sábado ou domingo. Usado só para enxugar a visão de semana. */
export function isWeekend(isoDate: string): boolean {
  if (!isIsoDate(isoDate)) return false;
  const dow = toUtc(isoDate).getUTCDay();
  return dow === 0 || dow === 6;
}

export function startOfMonth(isoDate: string): string {
  return isIsoDate(isoDate) ? `${isoDate.slice(0, 7)}-01` : isoDate;
}

export function endOfMonth(isoDate: string): string {
  if (!isIsoDate(isoDate)) return isoDate;
  const cursor = toUtc(isoDate);
  // Dia 0 do mês seguinte = último dia deste mês.
  return toIso(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)));
}

/** Dias inteiros de `fromIso` até `toIso` (negativo quando `toIso` é anterior). */
export function daysBetween(fromIso: string, toIso: string): number {
  if (!isIsoDate(fromIso) || !isIsoDate(toIso)) return 0;
  return Math.round((toUtc(toIso).getTime() - toUtc(fromIso).getTime()) / 86_400_000);
}

/** Todos os dias do intervalo, inclusive as duas pontas. */
export function enumerateDays(fromIso: string, toIso: string): string[] {
  if (!isIsoDate(fromIso) || !isIsoDate(toIso)) return [];
  const total = daysBetween(fromIso, toIso);
  if (total < 0) return [];
  // Trava de segurança: nenhum recorte do caderno passa de um mês.
  return Array.from({ length: Math.min(total, 366) + 1 }, (_, i) => addDays(fromIso, i));
}

export type NotepadRange = { from: string; to: string };

/** Intervalo de datas que o recorte atual mostra. */
export function rangeForScope(
  scope: "dia" | "semana" | "mes",
  cursorIso: string,
): NotepadRange {
  if (scope === "dia") return { from: cursorIso, to: cursorIso };
  if (scope === "semana") return { from: startOfWeek(cursorIso), to: endOfWeek(cursorIso) };
  return { from: startOfMonth(cursorIso), to: endOfMonth(cursorIso) };
}

/** Passa a página: um dia, uma semana ou um mês para trás/frente. */
export function shiftCursor(
  scope: "dia" | "semana" | "mes",
  cursorIso: string,
  direction: 1 | -1,
): string {
  if (scope === "dia") return addDays(cursorIso, direction);
  if (scope === "semana") return addDays(cursorIso, 7 * direction);
  return addMonths(cursorIso, direction);
}

// ── Rótulos ──────────────────────────────────────────────────────────────────
//
// Tudo formatado com timeZone 'UTC' porque a data já é uma string de calendário:
// converter para o fuso do navegador aqui é o que faz "25/08" virar "24/08".

function format(isoDate: string, options: Intl.DateTimeFormatOptions): string {
  if (!isIsoDate(isoDate)) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", ...options }).format(
    toUtc(isoDate),
  );
}

/**
 * Só a primeira letra em maiúscula.
 *
 * O Intl devolve 'terça-feira', 'agosto' — tudo minúsculo, que é o correto em
 * pt-BR. A maiúscula da abertura de rótulo é feita AQUI, e não com `capitalize`
 * no CSS: aquela regra capitaliza toda palavra e escreve "Terça-Feira, 25 De
 * Agosto", que está errado na língua.
 */
function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** 'YYYY-MM-DD' -> 'dd/MM/yyyy'. */
export function formatBrDate(isoDate: string): string {
  return format(isoDate, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** 'Sexta-feira, 25 de agosto' (sem o ano, que já está no cabeçalho). */
export function formatLongDay(isoDate: string): string {
  return capitalizeFirst(format(isoDate, { weekday: "long", day: "numeric", month: "long" }));
}

/**
 * 'Sex, 25 de ago' — cabeçalho de grupo nas visões de semana e mês.
 * O Intl devolve 'sex., 25 de ago.'; os pontos das abreviações poluem uma lista
 * de sete linhas empilhadas, então saem aqui.
 */
export function formatShortDay(isoDate: string): string {
  return capitalizeFirst(
    format(isoDate, { weekday: "short", day: "2-digit", month: "short" })
      .replace(/\.,/, ",")
      .replace(/\.$/, ""),
  );
}

/**
 * Rótulo relativo da página, do jeito que o agente pensa no dia: "Hoje",
 * "Ontem", "Amanhã" e, fora dessa janela, a data por extenso.
 */
export function dayHeadline(isoDate: string, todayIso: string): string {
  const diff = daysBetween(todayIso, isoDate);
  if (diff === 0) return "Hoje";
  if (diff === -1) return "Ontem";
  if (diff === 1) return "Amanhã";
  return formatLongDay(isoDate);
}

/** Título do recorte: a data do dia, o intervalo da semana ou o mês. */
export function scopeHeadline(
  scope: "dia" | "semana" | "mes",
  cursorIso: string,
  todayIso: string,
): string {
  if (scope === "dia") return dayHeadline(cursorIso, todayIso);

  if (scope === "semana") {
    const from = startOfWeek(cursorIso);
    const to = endOfWeek(cursorIso);
    const sameMonth = from.slice(0, 7) === to.slice(0, 7);
    // O `.replace` tira o ponto de 'ago.': a semana que vira o mês ficaria
    // "31 de ago. – 06 de setembro", com um ponto no meio da frase que não
    // aparece em nenhum outro rótulo do caderno.
    const left = format(
      from,
      sameMonth ? { day: "2-digit" } : { day: "2-digit", month: "short" },
    ).replace(/\.$/, "");
    const right = format(to, { day: "2-digit", month: "long" });
    return `${left} – ${right}`;
  }

  // Só o mês: o ano vai na legenda de baixo, igual ao recorte de semana.
  // "Agosto de 2026" com "2026" logo abaixo repetiria o ano duas vezes.
  return capitalizeFirst(format(cursorIso, { month: "long" }));
}

/** Legenda embaixo do título: o ano, ou a data completa quando o título é relativo. */
export function scopeSubtitle(
  scope: "dia" | "semana" | "mes",
  cursorIso: string,
  todayIso: string,
): string {
  if (scope !== "dia") return format(cursorIso, { year: "numeric" });
  const diff = daysBetween(todayIso, cursorIso);
  // Título já é a data por extenso: repetir não informa nada, mostra o ano.
  if (diff < -1 || diff > 1) return format(cursorIso, { year: "numeric" });
  return formatLongDay(cursorIso);
}

/** 'HH:mm' de um timestamptz, no fuso de São Paulo. */
export function formatTime(timestamp: string | null | undefined): string {
  if (!timestamp) return "";
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}
