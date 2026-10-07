import { describe, expect, it } from "vitest";

import { enderecoLinha, motivoLabel, saudeDoSync } from "./format";
import { lateHunterSheetRows } from "./exportLateHunter";
import type { LateHunterOrder, LateHunterSync } from "./types";

const sync = (recebido_em: string) => ({ recebido_em }) as LateHunterSync;

describe("saudeDoSync", () => {
  const agora = new Date("2026-10-02T12:00:00Z");

  it("sem lote nenhum é 'sem dados'", () => {
    expect(saudeDoSync(null, agora)).toBe("sem_dados");
  });

  it("varredura das 10:15 está em dia", () => {
    expect(saudeDoSync(sync("2026-10-02T10:15:00Z"), agora)).toBe("em_dia");
  });

  it("o buraco da madrugada (22:15 → 04:15, 6 h) não é atraso", () => {
    const madrugada = new Date("2026-10-02T04:10:00Z");
    expect(saudeDoSync(sync("2026-10-01T22:15:00Z"), madrugada)).toBe("em_dia");
  });

  it("mais de 7 h sem lote é atraso (o Late Hunter varre de 3 em 3 h)", () => {
    expect(saudeDoSync(sync("2026-10-02T04:15:00Z"), agora)).toBe("atrasado");
  });
});

describe("motivoLabel", () => {
  it("usa o mesmo rótulo dos Pedidos em Espera", () => {
    expect(motivoLabel("Held for Bad Address")).toBe("Endereço inválido");
    expect(motivoLabel("address-verification-failed")).toBe("Falha na verificação de endereço");
  });

  it("motivo novo sai como veio", () => {
    expect(motivoLabel("Order Hold For QTY Greater Than 60")).toBe("Order Hold For QTY Greater Than 60");
  });
});

describe("enderecoLinha", () => {
  it("junta só as partes que vieram", () => {
    expect(
      enderecoLinha({ logradouro: "SE Green Mountain Rd", cidade: "Brothers", estado: "OR", pais: "US", cep: "97712" }),
    ).toBe("SE Green Mountain Rd · Brothers, OR 97712 · US");
    expect(enderecoLinha({ logradouro: null, cidade: null, pais: "CA" })).toBe("CA");
    expect(enderecoLinha(null)).toBe("");
  });
});

describe("planilha", () => {
  it("leva motivo traduzido e o original, itens e situação legíveis", () => {
    const [row] = lateHunterSheetRows([
      {
        id: 1,
        pedido: "B10Z3955",
        loja: "DSA044",
        loja_nome: "Feilaira",
        motivo: "address-verification-failed, Held for Bad Address",
        motivos: ["address-verification-failed", "Held for Bad Address"],
        cliente_nome: "David stookey",
        cliente_email: "drlstookey@comcast.net",
        data_pedido: "2026-09-16",
        dias_em_espera: 1,
        itens: "6299-VRTYBLND-104 x 2",
        endereco: { cidade: "Brothers", estado: "OR", pais: "US" },
        pais: "US",
        situacao: "encerrado",
        motivo_encerramento: "resolvido-automaticamente",
        encerrado_em: "2026-09-18T02:00:00Z",
        encerrado_referencia: "2026-09-17",
        primeira_referencia: "2026-09-16",
        ultima_referencia: "2026-09-16",
        ultimo_lote: "2026-09-16T22:15:00Z",
        vezes_reaberto: 0,
        atualizado_em: "2026-09-18T02:00:00Z",
      } satisfies LateHunterOrder,
    ]);
    expect(row.Motivo).toBe("Falha na verificação de endereço, Endereço inválido");
    expect(row["Motivo (ShipOffers)"]).toBe("address-verification-failed, Held for Bad Address");
    expect(row.Itens).toBe("6299-VRTYBLND-104 × 2");
    expect(row.Situação).toBe("Saiu do hold");
    expect(row["Saiu em"]).toBe("17/09/2026");
  });
});
