import { describe, expect, it } from "vitest";

import { formatHeldOrderAge, formatHeldOrderDate, formatHeldOrderDateTime } from "./dates";

describe("formatHeldOrderDate", () => {
  it("converte YYYY-MM-DD para dd/MM/aaaa", () => {
    expect(formatHeldOrderDate("2026-09-01")).toBe("01/09/2026");
  });

  it("aceita ISO completo usando só a parte da data", () => {
    expect(formatHeldOrderDate("2026-09-01T23:00:00Z")).toBe("01/09/2026");
  });

  it("devolve o marcador de vazio quando não há data", () => {
    expect(formatHeldOrderDate(null)).toBe("—");
    expect(formatHeldOrderDate(null, "")).toBe("");
  });
});

describe("formatHeldOrderDateTime", () => {
  it("mostra o horário de São Paulo, não o UTC", () => {
    // 02:30 UTC do dia 2 = 23:30 do dia 1 em São Paulo.
    expect(formatHeldOrderDateTime("2026-10-02T02:30:00Z")).toBe("01/10/2026, 23:30");
  });

  it("trata timestamp sem fuso como UTC", () => {
    expect(formatHeldOrderDateTime("2026-10-02T02:30:00")).toBe("01/10/2026, 23:30");
  });

  it("devolve o marcador de vazio para valor ausente ou inválido", () => {
    expect(formatHeldOrderDateTime(null)).toBe("—");
    expect(formatHeldOrderDateTime("não é data", "")).toBe("");
  });
});

describe("formatHeldOrderAge", () => {
  it("traduz a idade do arquivo", () => {
    expect(formatHeldOrderAge("9 day(s)")).toBe("9 dia(s)");
    expect(formatHeldOrderAge(null)).toBe("");
  });
});
