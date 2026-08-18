import { beforeEach, describe, expect, it, vi } from "vitest";

// Intercepta a escrita do arquivo: o teste inspeciona a planilha em memória.
const writeFile = vi.hoisted(() => vi.fn());
vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile };
});

import * as XLSX from "xlsx";

import { exportHeldOrders } from "./exportHeldOrders";
import { RETURNS_DYNA_CODE } from "./parseHeldOrdersCsv";
import type { ManagerHeldOrder } from "./types";

function order(overrides: Partial<ManagerHeldOrder> = {}): ManagerHeldOrder {
  return {
    id: "1",
    dyna_code: "LSD001",
    order_number: "PED-1",
    merged_orders: null,
    reason: "Held for Bad Address",
    order_date: "2026-08-10",
    email: "cliente@exemplo.com",
    customer_name: "Cliente Um",
    city: "São Paulo",
    state: "SP",
    country: "BR",
    postal_code: "01000-000",
    street1: "Rua A",
    street2: "Apto 1",
    street3: null,
    age: "5 dias",
    items: "127-MVIT-277 x 1",
    rma: null,
    restocked_items: null,
    damaged_items: null,
    comments: null,
    status: "pending",
    agent_status: "em_andamento",
    pending_tag: null,
    confirmed_at: null,
    event_count: 2,
    source_file: "LSD001_2026-08-10_On_Holds_Details.csv",
    assigned_to: "agente-1",
    assigned_to_name: "Maria",
    imported_at: null,
    assign_count: 1,
    duplicate_of: null,
    ...overrides,
  };
}

const FILTERS = {
  status: "Todos status",
  product: "Todos os produtos",
  agent: "Todos agentes",
  search: "",
  includingDuplicates: false,
};

function sheetOfLastExport(): unknown[][] {
  const wb = writeFile.mock.calls.at(-1)?.[0] as XLSX.WorkBook;
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true }) as unknown[][];
}

// 4 linhas de cabeçalho + linha em branco + cabeçalho de colunas.
const FIRST_DATA_ROW = 6;

describe("exportHeldOrders", () => {
  beforeEach(() => writeFile.mockClear());

  it("exporta exatamente as linhas recebidas, na mesma ordem da tela", () => {
    const rows = [order(), order({ id: "2", order_number: "PED-2" })];

    const count = exportHeldOrders({ rows, filters: FILTERS });

    expect(count).toBe(2);
    const dataRows = sheetOfLastExport().slice(FIRST_DATA_ROW);
    expect(dataRows).toHaveLength(2);
    expect(dataRows[0][0]).toBe("PED-1");
    expect(dataRows[1][0]).toBe("PED-2");
  });

  it("registra no topo os filtros aplicados e o total", () => {
    exportHeldOrders({
      rows: [order()],
      filters: {
        status: "Confirmados",
        product: "Devolução",
        agent: "Sem agente",
        search: "  PED  ",
        includingDuplicates: true,
      },
    });

    const aoa = sheetOfLastExport();
    expect(aoa[0][0]).toBe("Pedidos em Espera");
    const filtros = String(aoa[1][0]);
    expect(filtros).toContain("Status: Confirmados");
    expect(filtros).toContain("Produto: Devolução");
    expect(filtros).toContain("Agente: Sem agente");
    expect(filtros).toContain('Busca: "PED"');
    expect(filtros).toContain("Incluindo linhas repetidas");
    expect(aoa[2][0]).toBe("Total de pedidos: 1");
  });

  it("traduz produto de devolução e o status de cada pedido", () => {
    exportHeldOrders({
      rows: [
        order({ dyna_code: RETURNS_DYNA_CODE, agent_status: "novo", assign_count: 0 }),
        order({ id: "2", agent_status: "concluido", status: "confirmed" }),
        order({ id: "3", duplicate_of: "1" }),
      ],
      filters: FILTERS,
    });

    const aoa = sheetOfLastExport();
    const header = aoa[5] as string[];
    const iProduto = header.indexOf("Produto (loja)");
    const iStatus = header.indexOf("Status");
    const iRepetida = header.indexOf("Linha repetida");

    expect(aoa[FIRST_DATA_ROW][iProduto]).toBe("Devolução");
    expect(aoa[FIRST_DATA_ROW][iStatus]).toBe("Aguardando");
    expect(aoa[FIRST_DATA_ROW + 1][iStatus]).toBe("Confirmado");
    expect(aoa[FIRST_DATA_ROW + 2][iStatus]).toBe("Repetido");
    expect(aoa[FIRST_DATA_ROW + 2][iRepetida]).toBe("Sim");
  });

  it("traz a pendência registrada pelo agente", () => {
    exportHeldOrders({ rows: [order({ pending_tag: "aguardando_cliente" })], filters: FILTERS });

    const header = sheetOfLastExport()[5] as string[];
    const iPendencia = header.indexOf("Pendência");
    expect(sheetOfLastExport()[FIRST_DATA_ROW][iPendencia]).toBe("Aguardando cliente");
  });

  it("avisa na planilha quando o filtro não retorna nenhum pedido", () => {
    const count = exportHeldOrders({
      rows: [],
      filters: { ...FILTERS, status: "Confirmados", product: "LSD999" },
    });

    expect(count).toBe(0);
    expect(sheetOfLastExport()[FIRST_DATA_ROW][0]).toBe("Nenhum pedido com os filtros aplicados");
  });
});
