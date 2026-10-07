import { beforeEach, describe, expect, it, vi } from "vitest";

// Intercepta a escrita do arquivo: o teste inspeciona a planilha em memória.
const writeFile = vi.hoisted(() => vi.fn());
vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile };
});

import * as XLSX from "xlsx";

import { exportRadar } from "./exportRadar";
import type { MyRadarItem } from "./types";

function item(overrides: Partial<MyRadarItem> = {}): MyRadarItem {
  return {
    id: "1",
    client_email: "cliente@exemplo.com",
    order_number: "PED-1",
    product: "Presgera",
    kind: "rma",
    action_needed: "Cobrar o parceiro pelo RMA",
    status: "aguardando_logistica",
    next_follow_up_date: "2026-08-27",
    notes: "Cliente já mandou a foto do produto",
    created_at: "2026-08-20T12:00:00Z",
    updated_at: "2026-08-24T12:00:00Z",
    closed_at: null,
    agent_name: "Maria",
    event_count: 3,
    last_action: "Cobrei o parceiro, sem resposta",
    last_action_at: "2026-08-24T12:00:00Z",
    days_overdue: -2,
    is_overdue: false,
    is_due_today: false,
    ...overrides,
  };
}

function sheetOf(call: number = 0) {
  const wb = writeFile.mock.calls[call][0] as XLSX.WorkBook;
  return XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
}

const params = {
  today: "2026-08-25",
  agentName: "Maria",
  filters: { bucket: "Todos", kind: "Todos os tipos", status: "Todos os status", search: "" },
};

describe("exportRadar", () => {
  beforeEach(() => writeFile.mockClear());

  it("exporta uma linha por caso, com os rótulos que a tela mostra", () => {
    const count = exportRadar({ ...params, rows: [item()] });

    expect(count).toBe(1);
    const rows = sheetOf();
    // 0..3 = cabeçalho do relatório, 4 = linha vazia, 5 = colunas, 6 = 1º caso.
    expect(rows[5]).toEqual([
      "E-mail",
      "Número do pedido",
      "Produto",
      "Tipo de acompanhamento",
      "Ação necessária",
      "Data de criação",
      "Data do próximo acompanhamento",
      "Prazo",
      "Status",
      "Observações",
      "Prestador responsável",
      "Última ação registrada",
      "Registrada em",
      "Registros no histórico",
      "Fechado em",
    ]);
    expect(rows[6][0]).toBe("cliente@exemplo.com");
    expect(rows[6][3]).toBe("Envio/acompanhamento de RMA");
    expect(rows[6][6]).toBe("27/08/2026");
    expect(rows[6][7]).toBe("Em 2 dias");
    expect(rows[6][8]).toBe("Aguardando logística");
    expect(rows[6][13]).toBe(3);
  });

  it("calcula o prazo contra o 'hoje' do servidor, não o do navegador", () => {
    exportRadar({ ...params, rows: [item({ next_follow_up_date: "2026-08-22" })] });
    expect(sheetOf()[6][7]).toBe("Atrasado 3 dias");
  });

  it("deixa data e prazo em branco no caso já fechado", () => {
    exportRadar({
      ...params,
      rows: [
        item({
          status: "resolvido",
          next_follow_up_date: null,
          closed_at: "2026-08-24T18:30:00Z",
          days_overdue: null,
        }),
      ],
    });
    const row = sheetOf()[6];
    expect(row[6]).toBe("");
    expect(row[7]).toBe("");
    expect(row[8]).toBe("Resolvido");
    expect(row[14]).toBe("24/08/2026, 15:30");
  });

  it("registra os filtros aplicados e o total no topo da planilha", () => {
    exportRadar({
      ...params,
      filters: { bucket: "Atrasados", kind: "RMA", status: "Todos os status", search: "presgera" },
      rows: [item(), item({ id: "2" })],
    });
    const rows = sheetOf();
    expect(rows[0][0]).toBe("Radar — acompanhamentos de Maria");
    expect(rows[1][0]).toContain("Prazo: Atrasados");
    expect(rows[1][0]).toContain('Busca: "presgera"');
    expect(rows[2][0]).toBe("Total de casos: 2");
  });

  it("gera planilha com aviso quando o filtro não deixou nenhum caso", () => {
    const count = exportRadar({ ...params, rows: [] });
    expect(count).toBe(0);
    expect(sheetOf()[6][0]).toBe("Nenhum caso com os filtros aplicados");
  });

  it("usa nome de arquivo sem acento nem espaço", () => {
    exportRadar({
      ...params,
      agentName: "Ana Vidotti",
      filters: { ...params.filters, bucket: "Atrasados" },
      rows: [item()],
    });
    expect(writeFile.mock.calls[0][1]).toMatch(
      /^radar_ana-vidotti_atrasados_todos-os-tipos_\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
  });
});
