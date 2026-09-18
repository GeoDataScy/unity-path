import { describe, expect, it } from "vitest";

import { parseReasons } from "./format";
import {
  avaliarSync,
  reasonLabelFromKey,
  resumirEnvelhecimento,
  resumirFluxo,
  type FaixaEnvelhecimento,
  type FluxoPonto,
  type SyncStatus,
} from "./analytics";

/** Série diária consecutiva a partir de `diaInicial` (dia juliano fictício). */
function serie(
  pontos: Array<[entradas: number, saidas: number]>,
  backlogInicial = 100,
  diaInicial = 0,
): FluxoPonto[] {
  let backlog = backlogInicial;
  const base = new Date(Date.UTC(2026, 0, 1));
  return pontos.map(([entradas, saidas], i) => {
    backlog += entradas - saidas;
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + diaInicial + i);
    return { dia: d.toISOString().slice(0, 10), entradas, saidas, backlog };
  });
}

describe("resumirFluxo", () => {
  it("devolve null sem série", () => {
    expect(resumirFluxo([])).toBeNull();
  });

  it("classifica fila que cresce e não promete data para zerar", () => {
    const r = resumirFluxo(serie(Array.from({ length: 14 }, () => [20, 10] as [number, number])));
    expect(r).not.toBeNull();
    expect(r!.saldoDiario).toBe(10);
    expect(r!.tendencia).toBe("subindo");
    // Fila que cresce não zera; prometer um prazo aqui seria mentira.
    expect(r!.diasParaZerar).toBeNull();
  });

  it("estima quantos dias a fila leva para zerar quando drena", () => {
    // 14 dias tirando 10/dia de um backlog que termina em 100.
    const s = serie(Array.from({ length: 14 }, () => [0, 10] as [number, number]), 240);
    const r = resumirFluxo(s)!;
    expect(r.backlogAtual).toBe(100);
    expect(r.tendencia).toBe("drenando");
    expect(r.diasParaZerar).toBe(10);
  });

  it("trata saldo pequeno como estável em relação ao movimento da fila", () => {
    // 200 entram, 199 saem: saldo 1/dia em 200/dia de movimento é ruído, não
    // tendência — chamar isso de "subindo" faria o time caçar fantasma.
    const r = resumirFluxo(serie(Array.from({ length: 14 }, () => [200, 199] as [number, number])))!;
    expect(r.saldoDiario).toBe(1);
    expect(r.tendencia).toBe("estavel");
  });

  it("numa fila pequena, o mesmo saldo de 1/dia já é tendência", () => {
    const r = resumirFluxo(serie(Array.from({ length: 14 }, () => [3, 2] as [number, number])))!;
    expect(r.saldoDiario).toBe(1);
    expect(r.tendencia).toBe("subindo");
  });

  it("usa só a janela de ritmo, ignorando história antiga", () => {
    // 30 dias parados seguidos de 14 dias drenando: o ritmo é o dos 14.
    const antigos = serie(Array.from({ length: 30 }, () => [5, 5] as [number, number]), 200, 0);
    const recentes = serie(Array.from({ length: 14 }, () => [0, 10] as [number, number]), 200, 30);
    const r = resumirFluxo([...antigos, ...recentes])!;
    expect(r.diasConsiderados).toBe(14);
    expect(r.tendencia).toBe("drenando");
  });

  it("aceita série mais curta que a janela", () => {
    const r = resumirFluxo(serie([[10, 0], [10, 0]]))!;
    expect(r.diasConsiderados).toBe(2);
    expect(r.mediaEntradas).toBe(10);
  });

  it("não depende da ordem em que a série chega", () => {
    const s = serie(Array.from({ length: 14 }, () => [0, 10] as [number, number]), 240);
    const embaralhada = [...s].reverse();
    expect(resumirFluxo(embaralhada)!.backlogAtual).toBe(100);
  });
});

describe("resumirEnvelhecimento", () => {
  const faixas: FaixaEnvelhecimento[] = [
    { ordem: 1, faixa: "0-3 dias", total: 10 },
    { ordem: 2, faixa: "4-7 dias", total: 20 },
    { ordem: 3, faixa: "8-14 dias", total: 30 },
    { ordem: 4, faixa: "15-30 dias", total: 20 },
    { ordem: 5, faixa: "31-60 dias", total: 15 },
    { ordem: 6, faixa: "60+ dias", total: 5 },
  ];

  it("soma o total e isola a cauda acima de 30 dias", () => {
    const r = resumirEnvelhecimento(faixas);
    expect(r.total).toBe(100);
    expect(r.cauda).toBe(20);
    expect(r.fracaoCauda).toBeCloseTo(0.2);
  });

  it("não divide por zero com fila vazia", () => {
    const r = resumirEnvelhecimento(faixas.map((f) => ({ ...f, total: 0 })));
    expect(r.total).toBe(0);
    expect(r.fracaoCauda).toBe(0);
  });
});

describe("avaliarSync", () => {
  const base: SyncStatus = {
    referencia: "2026-09-17",
    gerado_em: "2026-09-18T02:00:00Z",
    processado_em: "2026-09-18T02:00:03Z",
    completo: true,
    recebidos: 3289,
    criados: 142,
    atualizados: 3105,
    reabertos: 3,
    encerrados: 87,
    rejeitados: 0,
    dias_desde: 1,
  };

  it("sem lote nenhum, diz que a fila ainda é do import manual", () => {
    expect(avaliarSync(null).estado).toBe("sem-integracao");
  });

  it("um dia de defasagem é o normal do lote diário", () => {
    expect(avaliarSync(base).estado).toBe("em-dia");
  });

  it("dois dias já é atraso", () => {
    expect(avaliarSync({ ...base, dias_desde: 2 }).estado).toBe("atrasado");
  });

  it("três dias é integração parada e a tela precisa dizer isso", () => {
    const r = avaliarSync({ ...base, dias_desde: 3 });
    expect(r.estado).toBe("parado");
    expect(r.descricao).toContain("desatualizada");
  });
});

describe("reasonLabelFromKey", () => {
  it("traduz a chave normalizada que a RPC devolve", () => {
    expect(reasonLabelFromKey("held for bad address", parseReasons)).toBe("Endereço inválido");
  });

  it("motivo desconhecido aparece como veio — nada é escondido", () => {
    expect(reasonLabelFromKey("motivo novo da shipoffers", parseReasons)).toBe(
      "motivo novo da shipoffers",
    );
  });
});
