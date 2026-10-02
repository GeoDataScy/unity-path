import { describe, expect, it } from "vitest";

import { isUsableFilterDate } from "./filterDate";

const NOW = new Date(2026, 9, 2);

describe("isUsableFilterDate", () => {
  it("aceita data completa com ano plausível", () => {
    expect(isUsableFilterDate("2026-10-02", NOW)).toBe(true);
    expect(isUsableFilterDate("2025-01-01", NOW)).toBe(true);
    expect(isUsableFilterDate("2027-12-31", NOW)).toBe(true);
  });

  it("rejeita os anos parciais que o Chrome emite enquanto se digita", () => {
    expect(isUsableFilterDate("0002-10-02", NOW)).toBe(false);
    expect(isUsableFilterDate("0020-10-02", NOW)).toBe(false);
    expect(isUsableFilterDate("0202-10-02", NOW)).toBe(false);
  });

  it("rejeita ano no futuro distante", () => {
    expect(isUsableFilterDate("2202-10-02", NOW)).toBe(false);
    expect(isUsableFilterDate("9999-12-31", NOW)).toBe(false);
  });

  it("rejeita vazio, formato errado e dia inexistente", () => {
    expect(isUsableFilterDate("", NOW)).toBe(false);
    expect(isUsableFilterDate("2026-10", NOW)).toBe(false);
    expect(isUsableFilterDate("02/10/2026", NOW)).toBe(false);
    expect(isUsableFilterDate("2026-02-30", NOW)).toBe(false);
    expect(isUsableFilterDate("2026-13-01", NOW)).toBe(false);
  });
});
