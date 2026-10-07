import { describe, expect, it } from "vitest";

import {
  filaPath,
  formatCasoId,
  formatMesPorExtenso,
  formatPrazoContratual,
  formatVencidoHa,
  saoPauloMonthStart,
} from "./format";

describe("formatVencidoHa", () => {
  it("mostra horas abaixo de 24h úteis", () => {
    expect(formatVencidoHa(6)).toBe("Vencido há 6h");
    expect(formatVencidoHa(23.9)).toBe("Vencido há 23h");
  });

  it("mostra dias a partir de 24h úteis, com singular e plural", () => {
    expect(formatVencidoHa(24)).toBe("Vencido há 1 dia");
    expect(formatVencidoHa(47)).toBe("Vencido há 1 dia");
    expect(formatVencidoHa(48)).toBe("Vencido há 2 dias");
  });

  it("trata menos de 1h e valores negativos", () => {
    expect(formatVencidoHa(0)).toBe("Vencido há menos de 1h");
    expect(formatVencidoHa(-3)).toBe("Vencido há menos de 1h");
  });
});

describe("formatação auxiliar", () => {
  it("prazo contratual em horas úteis", () => {
    expect(formatPrazoContratual(24)).toBe("24h úteis");
    expect(formatPrazoContratual(48)).toBe("48h úteis");
  });

  it("caso com os 8 primeiros caracteres do id", () => {
    expect(formatCasoId("aaaaaaaa-0000-0000-0000-000000000003")).toBe("#aaaaaaaa");
  });

  it("mês por extenso em pt-BR", () => {
    expect(formatMesPorExtenso("2026-10")).toBe("outubro de 2026");
  });

  it("fila de destino por tipo", () => {
    expect(filaPath("radar")).toBe("/workspace/radar");
    expect(filaPath("reembolso_conclusao")).toBe("/workspace/reembolsos");
    expect(filaPath("reembolso_abertura")).toBe("/workspace/reembolsos");
  });
});

describe("saoPauloMonthStart", () => {
  it("usa o fuso de São Paulo, não UTC", () => {
    // 01/11 01:00 UTC ainda é 31/10 22:00 em SP
    const now = new Date("2026-11-01T01:00:00Z");
    expect(saoPauloMonthStart(0, now)).toBe("2026-10-01");
    expect(saoPauloMonthStart(-1, now)).toBe("2026-09-01");
  });

  it("atravessa a virada do ano", () => {
    const now = new Date("2027-01-15T12:00:00Z");
    expect(saoPauloMonthStart(-1, now)).toBe("2026-12-01");
  });
});
