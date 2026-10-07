import { describe, expect, it } from "vitest";

import { parseOverdueQueueItems, parseSlaMensal, parseSlaRelatorio } from "./types";

// Formato real devolvido pela RPC sla_mensal em produção.
const RPC_SLA_MENSAL = {
  mes: "2026-09",
  volume: 3013,
  capacidade: 2100,
  dias_uteis: 21,
  indicadores: [
    { chave: "reembolso_abertura", rotulo: "Abertura de reembolso", casos_total: 18, pct_no_prazo: 83.3, casos_no_prazo: 15, casos_vencidos: 3, parametro_horas: 24 },
    { chave: "reembolso_conclusao", rotulo: "Conclusão de reembolso", casos_total: 0, pct_no_prazo: null, casos_no_prazo: 0, casos_vencidos: 0, parametro_horas: 48 },
    { chave: "radar_envelhecido", rotulo: "Radar sem acompanhamento", casos_total: 13, pct_no_prazo: "15.4", casos_no_prazo: 2, casos_vencidos: 11, parametro_horas: 48 },
  ],
};

describe("parseSlaMensal", () => {
  it("mapeia volume, capacidade e os três indicadores", () => {
    const r = parseSlaMensal(RPC_SLA_MENSAL);
    expect(r).toMatchObject({ mes: "2026-09", volume: 3013, capacidade: 2100, dias_uteis: 21 });
    expect(r.indicadores.map((i) => i.chave)).toEqual([
      "reembolso_abertura",
      "reembolso_conclusao",
      "radar_envelhecido",
    ]);
    expect(r.indicadores[0]).toEqual({
      chave: "reembolso_abertura",
      rotulo: "Abertura de reembolso",
      parametro_horas: 24,
      casos_total: 18,
      casos_no_prazo: 15,
      casos_vencidos: 3,
      pct_no_prazo: 83.3,
    });
  });

  it("mantém null quando não houve caso e converte numeric vindo como string", () => {
    const r = parseSlaMensal(RPC_SLA_MENSAL);
    expect(r.indicadores[1].pct_no_prazo).toBeNull();
    expect(r.indicadores[2].pct_no_prazo).toBe(15.4);
  });

  it("não quebra com payload vazio", () => {
    expect(parseSlaMensal(null)).toEqual({ mes: "", dias_uteis: 0, volume: 0, capacidade: 0, indicadores: [] });
  });
});

describe("parseSlaRelatorio", () => {
  it("mês ainda não liberado", () => {
    expect(parseSlaRelatorio({ mes: "2026-09", disponivel: false, disponivel_em: "2026-10-05" })).toEqual({
      disponivel: false,
      mes: "2026-09",
      disponivel_em: "2026-10-05",
    });
  });

  it("mês liberado traz o mesmo conteúdo do sla_mensal", () => {
    const r = parseSlaRelatorio({ ...RPC_SLA_MENSAL, disponivel: true, disponivel_em: "2026-10-05" });
    expect(r.disponivel).toBe(true);
    if (r.disponivel) {
      expect(r.volume).toBe(3013);
      expect(r.indicadores).toHaveLength(3);
    }
  });
});

describe("parseOverdueQueueItems", () => {
  it("mapeia as linhas da RPC", () => {
    expect(
      parseOverdueQueueItems([
        { caso_id: "c-1", tipo: "reembolso_conclusao", rotulo_tipo: "Conclusão de reembolso", prazo_horas: 48, vencido_ha_horas: 6 },
        { caso_id: "r-1", tipo: "radar", rotulo_tipo: "Radar sem acompanhamento", prazo_horas: "48", vencido_ha_horas: "30" },
      ]),
    ).toEqual([
      { caso_id: "c-1", tipo: "reembolso_conclusao", rotulo_tipo: "Conclusão de reembolso", prazo_horas: 48, vencido_ha_horas: 6 },
      { caso_id: "r-1", tipo: "radar", rotulo_tipo: "Radar sem acompanhamento", prazo_horas: 48, vencido_ha_horas: 30 },
    ]);
  });

  it("devolve lista vazia para payload inesperado", () => {
    expect(parseOverdueQueueItems(null)).toEqual([]);
  });
});
