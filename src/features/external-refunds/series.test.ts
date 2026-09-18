import { describe, expect, it } from "vitest";

import {
  buildBuckets,
  granularitiesFor,
  hasRefundDate,
  linearTrend,
  mondayOf,
  movingAverage,
  niceMax,
  parseISODate,
  productsInSeries,
  teamShare,
} from "./series";
import type { ComparisonSeriesRow } from "./types";

function row(date: string, product: string, orders: number, amount: number, matched = 0): ComparisonSeriesRow {
  return { date, product, orders, amount, full: orders, partial: 0, unspecified: 0, partial_amount: 0, matched };
}

// 12/08 é uma quarta; 10/08 é a segunda da mesma semana.
const SERIE: ComparisonSeriesRow[] = [
  row("2026-08-12", "Jellyrock", 2, 200, 1),
  row("2026-08-12", "Honeyfil", 1, 50, 0),
  row("2026-08-14", "Jellyrock", 3, 300, 0),
  row("2026-08-17", "Jellyrock", 4, 400, 2), // semana seguinte
  row("2026-09-02", "Honeyfil", 5, 500, 0), // mês seguinte
];

describe("buildBuckets", () => {
  it("agrupa por dia mantendo cada produto separado", () => {
    const b = buildBuckets(SERIE, "dia", "qtd");
    expect(b.map((x) => x.id)).toEqual(["2026-08-12", "2026-08-14", "2026-08-17", "2026-09-02"]);
    expect(b[0].byProduct).toEqual({ Jellyrock: 2, Honeyfil: 1 });
    expect(b[0].total).toBe(3);
    expect(b[0].label).toBe("12/08");
    expect(b[0].sub).toBe("qua");
  });

  it("agrupa por semana na segunda-feira", () => {
    const b = buildBuckets(SERIE, "sem", "qtd");
    // 12/08 e 14/08 caem na semana de 10/08; 17/08 abre a seguinte.
    expect(b.map((x) => x.id)).toEqual(["2026-08-10", "2026-08-17", "2026-08-31"]);
    expect(b[0].total).toBe(6);
    expect(b[0].label).toBe("10/08–16/08");
  });

  it("agrupa por mês", () => {
    const b = buildBuckets(SERIE, "mes", "qtd");
    expect(b.map((x) => x.id)).toEqual(["2026-08", "2026-09"]);
    expect(b[0].total).toBe(10);
    expect(b[1].total).toBe(5);
    expect(b[0].label).toBe("ago/26");
  });

  it("soma valor quando a métrica é valor", () => {
    const b = buildBuckets(SERIE, "mes", "valor");
    expect(b[0].total).toBe(950); // 200 + 50 + 300 + 400
    expect(b[1].total).toBe(500);
  });

  it("produto escondido sai do total e também da fatia do time", () => {
    const b = buildBuckets(SERIE, "mes", "qtd", new Set(["Jellyrock"]));
    expect(b[0].total).toBe(1); // só o Honeyfil de agosto
    // sem Jellyrock não sobra nenhum casado em agosto
    expect(b[0].matched).toBe(0);
    expect(b[0].orders).toBe(1);
    expect(teamShare(b[0])).toBe(0);
  });

  it("a fatia do time é contagem mesmo quando o gráfico mede valor", () => {
    const porQtd = buildBuckets(SERIE, "mes", "qtd")[0];
    const porValor = buildBuckets(SERIE, "mes", "valor")[0];
    expect(porValor.matched).toBe(porQtd.matched);
    expect(porValor.orders).toBe(porQtd.orders);
    expect(teamShare(porValor)).toBe(teamShare(porQtd));
  });

  it("calcula a fatia do time", () => {
    const b = buildBuckets(SERIE, "mes", "qtd");
    expect(b[0].matched).toBe(3); // 1 + 2
    expect(b[0].orders).toBe(10);
    expect(teamShare(b[0])).toBe(30);
    expect(teamShare(b[1])).toBe(0);
  });
});

describe("granularidade por plataforma", () => {
  it("só a PagAmerican tem data de reembolso", () => {
    expect(hasRefundDate("PagAmerican")).toBe(true);
    expect(hasRefundDate("Cartpanda")).toBe(false);
    expect(hasRefundDate("Buygoods")).toBe(false);
  });

  it("plataforma sem data de reembolso só oferece mês", () => {
    expect(granularitiesFor("PagAmerican")).toEqual(["dia", "sem", "mes"]);
    expect(granularitiesFor("Cartpanda")).toEqual(["mes"]);
  });
});

describe("auxiliares do gráfico", () => {
  it("média móvel usa janela parcial no começo", () => {
    expect(movingAverage([3, 5, 10], 3)).toEqual([3, 4, 6]);
  });

  it("tendência de reta sobe e desce", () => {
    expect(linearTrend([1, 2, 3]).slope).toBeCloseTo(1, 10);
    expect(linearTrend([3, 2, 1]).slope).toBeCloseTo(-1, 10);
    expect(linearTrend([5]).slope).toBe(0);
    expect(linearTrend([]).intercept).toBe(0);
  });

  it("teto redondo do eixo", () => {
    expect(niceMax(7)).toBe(10);
    expect(niceMax(45)).toBe(50);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(0)).toBe(1);
  });

  it("data ISO vira data local, não UTC", () => {
    // new Date('2026-08-12') daria 11/08 em fuso negativo.
    expect(parseISODate("2026-08-12").getDate()).toBe(12);
    expect(mondayOf(parseISODate("2026-08-12")).getDate()).toBe(10);
  });

  it("produtos vêm ordenados por volume", () => {
    expect(productsInSeries(SERIE)).toEqual(["Jellyrock", "Honeyfil"]);
  });
});
