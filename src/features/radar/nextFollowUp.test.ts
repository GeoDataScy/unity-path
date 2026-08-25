import { describe, expect, it } from "vitest";

import {
  addBusinessDays,
  daysBetween,
  dueLabel,
  formatBrDate,
  isIsoDate,
  suggestNextFollowUp,
  todayInSaoPaulo,
} from "./nextFollowUp";

describe("todayInSaoPaulo", () => {
  it("usa o dia de São Paulo, não o UTC, na virada da noite", () => {
    // 2026-08-26T01:30Z ainda é 25/08 em São Paulo (UTC-3).
    expect(todayInSaoPaulo(new Date("2026-08-26T01:30:00Z"))).toBe("2026-08-25");
  });

  it("já virou o dia quando passa da meia-noite em São Paulo", () => {
    expect(todayInSaoPaulo(new Date("2026-08-26T03:30:00Z"))).toBe("2026-08-26");
  });
});

describe("addBusinessDays", () => {
  it("soma dias úteis sem contar o fim de semana", () => {
    // 2026-08-25 é uma terça.
    expect(addBusinessDays("2026-08-25", 2)).toBe("2026-08-27");
    // +3 cairia no sábado 29; pula para segunda 31.
    expect(addBusinessDays("2026-08-25", 4)).toBe("2026-08-31");
  });

  it("empurra para segunda quando a própria partida é fim de semana", () => {
    // 2026-08-29 é sábado; +0 dias úteis = próximo dia útil.
    expect(addBusinessDays("2026-08-29", 0)).toBe("2026-08-31");
  });

  it("atravessa a virada de mês e de ano", () => {
    // 2026-12-31 é uma quinta; +1 dia útil = sexta 01/01/2027.
    expect(addBusinessDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("não muda a data quando a entrada não é uma data ISO", () => {
    expect(addBusinessDays("25/08/2026", 3)).toBe("25/08/2026");
  });
});

describe("suggestNextFollowUp", () => {
  it("usa a régua do tipo de acompanhamento", () => {
    // logistica = +2 dias úteis; terça 25 -> quinta 27.
    expect(suggestNextFollowUp("logistica", "2026-08-25")).toBe("2026-08-27");
    // devolucao = +5 dias úteis; terça 25 -> terça 01/09.
    expect(suggestNextFollowUp("devolucao", "2026-08-25")).toBe("2026-09-01");
  });
});

describe("isIsoDate", () => {
  it("rejeita data de calendário inexistente", () => {
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-08-25")).toBe(true);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe("formatBrDate", () => {
  it("converte para dd/MM/yyyy", () => {
    expect(formatBrDate("2026-08-25")).toBe("25/08/2026");
    expect(formatBrDate(null)).toBe("");
  });
});

describe("dueLabel", () => {
  const today = "2026-08-25";

  it("descreve o prazo em relação ao hoje do servidor", () => {
    expect(dueLabel("2026-08-22", today)).toBe("Atrasado 3 dias");
    expect(dueLabel("2026-08-24", today)).toBe("Atrasado 1 dia");
    expect(dueLabel("2026-08-25", today)).toBe("Hoje");
    expect(dueLabel("2026-08-26", today)).toBe("Amanhã");
    expect(dueLabel("2026-08-29", today)).toBe("Em 4 dias");
  });

  it("devolve travessão quando não há data (caso fechado)", () => {
    expect(dueLabel(null, today)).toBe("—");
  });
});

describe("daysBetween", () => {
  it("conta dias corridos com sinal", () => {
    expect(daysBetween("2026-08-25", "2026-09-01")).toBe(7);
    expect(daysBetween("2026-08-25", "2026-08-20")).toBe(-5);
  });
});
