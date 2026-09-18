import { describe, expect, it } from "vitest";

import { computeSlot, labelStep, PAD, tickCount } from "./chartLayout";

describe("computeSlot", () => {
  it("estica a barra para ocupar a largura quando há poucos baldes", () => {
    // 15 dias num painel de 1200px: a fatia fixa de 26px do layout original
    // deixaria o gráfico com 390px no meio de 1200.
    const slot = computeSlot(1200, 15, "dia");
    expect(slot).toBeGreaterThan(26);
    expect(PAD.l + PAD.r + 15 * slot).toBeLessThanOrEqual(1200);
  });

  it("respeita o piso do layout original e passa a rolar quando não cabe", () => {
    // 60 dias não cabem em 1200px com 26px cada: fica no piso e o container rola.
    expect(computeSlot(1200, 60, "dia")).toBe(26);
    expect(computeSlot(400, 35, "dia")).toBe(26);
  });

  it("tem teto para não virar tarja com dois ou três baldes", () => {
    expect(computeSlot(1200, 2, "dia")).toBe(64);
    expect(computeSlot(1200, 2, "mes")).toBe(260);
  });

  it("não quebra sem baldes", () => {
    expect(computeSlot(1200, 0, "dia")).toBe(26);
  });
});

describe("labelStep", () => {
  it("pula rótulos quando a fatia é mais estreita que o texto", () => {
    // "02/09" ocupa ~34px; com fatia de 26 só cabe um a cada dois.
    expect(labelStep(26, 34)).toBe(2);
    expect(labelStep(12, 34)).toBe(3);
  });

  it("mostra todos quando a fatia é larga", () => {
    expect(labelStep(70, 34)).toBe(1);
    expect(labelStep(34, 34)).toBe(1);
  });
});

describe("tickCount", () => {
  // Com 4 divisões fixas, um teto de 50 dá "0 · 13 · 25 · 38 · 50", que parece
  // erro de conta. O eixo tem de cair em número redondo.
  it("escolhe a divisão que dá rótulo redondo", () => {
    for (const top of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]) {
      const n = tickCount(top);
      for (let t = 0; t <= n; t++) {
        expect(Number.isInteger((top * t) / n)).toBe(true);
      }
    }
  });

  it("eixo minúsculo não ganha divisão quebrada", () => {
    expect(tickCount(50)).toBe(5); // 0 · 10 · 20 · 30 · 40 · 50
    expect(tickCount(2)).toBe(2); // 0 · 1 · 2
    expect(tickCount(1)).toBe(1); // 0 · 1
  });
});
