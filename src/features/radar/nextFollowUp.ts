// Radar — cálculo da data sugerida de próximo acompanhamento.
//
// Duas armadilhas que este arquivo existe para evitar:
//
// 1) Fuso. `new Date().getDate()` devolve o dia da MÁQUINA do agente. O sistema
//    trabalha em America/Sao_Paulo (é o "hoje" que o banco usa em radar_today()),
//    então "hoje" sai de um Intl.DateTimeFormat com timeZone explícito.
//
// 2) Aritmética de datas com objeto Date local. Somar dias em horário local
//    esbarra em horário de verão e devolve o dia errado. Aqui a conta é feita em
//    UTC sobre 'YYYY-MM-DD' — a string nunca vira instante local.
//
// Sábado e domingo são pulados: o parceiro de logística não responde no fim de
// semana, e cair num sábado só gera caso "atrasado" na segunda de manhã.
// Feriado não é tratado de propósito: exigiria calendário mantido à mão, e a
// data é apenas sugestão que o agente pode ajustar.

import { RADAR_KINDS, type RadarKind } from "./types";

const SP_TIME_ZONE = "America/Sao_Paulo";

/** Data de hoje em São Paulo, como 'YYYY-MM-DD'. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  // 'en-CA' formata como YYYY-MM-DD, que é exatamente o formato que queremos.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** true quando a string é uma data 'YYYY-MM-DD' válida (inclusive o calendário). */
export function isIsoDate(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  // Rejeita 2026-02-31, que o Date.parse aceitaria rolando para março.
  return new Date(ms).toISOString().slice(0, 10) === value;
}

/**
 * Soma `days` dias ÚTEIS a uma data 'YYYY-MM-DD'. `days = 0` devolve o próximo
 * dia útil (a própria data, se ela já for útil).
 */
export function addBusinessDays(isoDate: string, days: number): string {
  if (!isIsoDate(isoDate)) return isoDate;

  const cursor = new Date(`${isoDate}T00:00:00Z`);
  const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

  let remaining = Math.max(0, Math.trunc(days));
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (!isWeekend(cursor)) remaining -= 1;
  }
  // Se a data de partida (ou a de chegada) caiu no fim de semana, empurra para
  // a segunda: nunca sugerimos acompanhar num dia em que ninguém trabalha.
  while (isWeekend(cursor)) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return cursor.toISOString().slice(0, 10);
}

/**
 * Data sugerida para o próximo acompanhamento de um tipo, contando de `fromDate`
 * (padrão: hoje em São Paulo).
 */
export function suggestNextFollowUp(kind: RadarKind, fromDate?: string): string {
  const from = fromDate && isIsoDate(fromDate) ? fromDate : todayInSaoPaulo();
  const meta = RADAR_KINDS.find((k) => k.code === kind);
  return addBusinessDays(from, meta?.suggestedBusinessDays ?? 3);
}

/** Texto da dica embaixo do campo de data ("+3 dias úteis · Logística"). */
export function suggestionHint(kind: RadarKind): string {
  const meta = RADAR_KINDS.find((k) => k.code === kind);
  if (!meta) return "";
  const d = meta.suggestedBusinessDays;
  return `Sugestão para "${meta.label}": +${d} ${d === 1 ? "dia útil" : "dias úteis"}`;
}

/** 'YYYY-MM-DD' -> 'dd/MM/yyyy'. Devolve '' para entrada inválida. */
export function formatBrDate(isoDate: string | null | undefined): string {
  if (!isIsoDate(isoDate)) return "";
  const [y, m, d] = isoDate!.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Rótulo humano do prazo, relativo ao "hoje" que o SERVIDOR informou (não ao
 * relógio do navegador): "Atrasado 3 dias", "Hoje", "Amanhã", "Em 4 dias".
 */
export function dueLabel(
  nextFollowUpDate: string | null | undefined,
  today: string,
): string {
  if (!isIsoDate(nextFollowUpDate) || !isIsoDate(today)) return "—";
  const diff = daysBetween(today, nextFollowUpDate!);
  if (diff < 0) {
    const late = Math.abs(diff);
    return `Atrasado ${late} ${late === 1 ? "dia" : "dias"}`;
  }
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  return `Em ${diff} dias`;
}

/** Dias inteiros de `fromIso` até `toIso` (negativo quando `toIso` é anterior). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
