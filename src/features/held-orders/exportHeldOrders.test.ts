import { beforeEach, describe, expect, it, vi } from "vitest";

// Intercepta a escrita do arquivo: o teste inspeciona a planilha em memória.
const writeFile = vi.hoisted(() => vi.fn());
vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile };
});

import * as XLSX from "xlsx";

import { exportHeldOrders, type HeldOrdersExportFilters } from "./exportHeldOrders";
import type { ManagerHeldOrder } from "./types";

function order(overrides: Partial<ManagerHeldOrder> = {}): ManagerHeldOrder {
  return {
    id: "1",
    dyna_code: "LSD001",
    order_number: "PED-1",
    merged_orders: null,
    reason: "Held for Bad Address",
    return_date: null,
    order_date: "2026-08-10",
    email: "cliente@exemplo.com",
    customer_name: "Cliente Um",
    city: "São Paulo",
    state: "SP",
    country: "BR",
    postal_code: "01000-000",
    street1: "Rua A, 100",
    street2: "Rua A, 100",
    street3: "Apto 1",
    age: "5",
    items: "6294-NRVEBLND-114 x 2, 127-MVIT-277 x 1",
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
    status_changed_at: null,
    assign_count: 1,
    duplicate_of: null,
    ...overrides,
  };
}

const NO_FILTERS: HeldOrdersExportFilters = {
  status: null,
  store: null,
  product: null,
  agent: null,
  search: "",
  includesDuplicates: false,
};

function sheetOfLastExport(): unknown[][] {
  const wb = writeFile.mock.calls.at(-1)?.[0] as XLSX.WorkBook;
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true }) as unknown[][];
}

function fileNameOfLastExport(): string {
  return writeFile.mock.calls.at(-1)?.[1] as string;
}

// 4 linhas de cabeçalho + linha em branco = cabeçalho de colunas na linha 5.
const HEADER_ROW = 5;
const FIRST_DATA_ROW = 6;

function column(name: string): number {
  const index = (sheetOfLastExport()[HEADER_ROW] as string[]).indexOf(name);
  expect(index, `coluna "${name}"`).toBeGreaterThanOrEqual(0);
  return index;
}

describe("exportHeldOrders", () => {
  beforeEach(() => writeFile.mockClear());

  it("exporta exatamente as linhas recebidas, na mesma ordem da tela", () => {
    const rows = [order({ id: "1" }), order({ id: "2", order_number: "PED-2" })];

    const count = exportHeldOrders({ rows, filters: NO_FILTERS });

    expect(count).toBe(2);
    const dataRows = sheetOfLastExport().slice(FIRST_DATA_ROW);
    expect(dataRows).toHaveLength(2);
    expect(dataRows[0][0]).toBe("PED-1");
    expect(dataRows[1][0]).toBe("PED-2");
  });

  it("registra no topo os filtros aplicados, o total e a busca", () => {
    exportHeldOrders({
      rows: [order()],
      filters: {
        status: "Concluído",
        store: "Devolução",
        product: "NRVEBLND",
        agent: "Sem agente",
        search: "  PED  ",
        includesDuplicates: true,
      },
    });

    const aoa = sheetOfLastExport();
    expect(aoa[0][0]).toBe("Pedidos em Espera");
    const filtros = String(aoa[1][0]);
    expect(filtros).toContain("Status: Concluído");
    expect(filtros).toContain("Loja: Devolução");
    expect(filtros).toContain("Produto: NRVEBLND");
    expect(filtros).toContain("Agente: Sem agente");
    expect(filtros).toContain('Busca: "PED"');
    expect(filtros).toContain("Inclui linhas repetidas");
    expect(aoa[2][0]).toBe("Total de pedidos: 1");
    expect(String(aoa[3][0])).toMatch(/^Gerado em: \d{2}\/\d{2}\/\d{4}/);
  });

  it("descreve o filtro em aberto como 'todos' quando nada foi escolhido", () => {
    exportHeldOrders({ rows: [order()], filters: NO_FILTERS });

    const filtros = String(sheetOfLastExport()[1][0]);
    expect(filtros).toContain("Status: todos");
    expect(filtros).toContain("Loja: todas");
    expect(filtros).toContain("Produto: todos");
    expect(filtros).toContain("Agente: todos");
    expect(filtros).not.toContain("Busca:");
    expect(filtros).not.toContain("repetidas");
  });

  it("mantém cada data na sua coluna, sem uma substituir a outra", () => {
    exportHeldOrders({
      rows: [
        order({
          order_date: "2026-08-10",
          imported_at: "2026-08-15 13:00:00",
          status_changed_at: "2026-08-20T18:45:00Z",
        }),
        // devolução: não tem data de compra, só a da devolução
        order({ id: "2", dyna_code: "RETURNS", order_date: null, return_date: "2026-06-17" }),
      ],
      filters: NO_FILTERS,
    });

    const aoa = sheetOfLastExport();
    const pedido = column("Data do pedido");
    const devolucao = column("Data da devolução");
    const entrada = column("Entrada no sistema");
    const mudanca = column("Última mudança de status");

    expect(aoa[FIRST_DATA_ROW][pedido]).toBe("10/08/2026");
    expect(aoa[FIRST_DATA_ROW][devolucao]).toBe("");
    expect(aoa[FIRST_DATA_ROW][entrada]).toBe("15/08/2026, 10:00");
    expect(aoa[FIRST_DATA_ROW][mudanca]).toBe("20/08/2026, 15:45");

    expect(aoa[FIRST_DATA_ROW + 1][pedido]).toBe("");
    expect(aoa[FIRST_DATA_ROW + 1][devolucao]).toBe("17/06/2026");
  });

  it("mostra o pedido inativo como Inativo, não como aguardando", () => {
    exportHeldOrders({
      rows: [order({ agent_status: "inativo", status: "pending", assign_count: 1 })],
      filters: NO_FILTERS,
    });

    const aoa = sheetOfLastExport();
    expect(aoa[FIRST_DATA_ROW][column("Situação")]).toBe("Inativo");
    expect(aoa[FIRST_DATA_ROW][column("Status")]).toBe("Inativo");
  });

  it("traduz situação, status e loja de devolução", () => {
    exportHeldOrders({
      rows: [
        // aguardando, nunca distribuído, veio do arquivo de devoluções
        order({ agent_status: "novo", assign_count: 0, dyna_code: "RETURNS" }),
        // aguardando, já distribuído 2 vezes e ainda não iniciado
        order({ id: "2", agent_status: "novo", assign_count: 2 }),
        // em atendimento, com pendência registrada pelo agente
        order({ id: "3", pending_tag: "aguardando_cliente" }),
        // concluído
        order({ id: "4", agent_status: "concluido", status: "confirmed", confirmed_at: "2026-08-12 14:30:00" }),
        // linha repetida (só aparece quando a gestora pede para ver os repetidos)
        order({ id: "5", duplicate_of: "1" }),
      ],
      filters: { ...NO_FILTERS, includesDuplicates: true },
    });

    const aoa = sheetOfLastExport();
    const loja = column("Loja");
    const situacao = column("Situação");
    const status = column("Status");
    const pendencia = column("Pendência");

    expect(aoa[FIRST_DATA_ROW][loja]).toBe("Devolução");
    expect(aoa[FIRST_DATA_ROW][situacao]).toBe("Aguardando atendimento");
    expect(aoa[FIRST_DATA_ROW][status]).toBe("Novo");

    expect(aoa[FIRST_DATA_ROW + 1][status]).toBe("Pendente 2");

    expect(aoa[FIRST_DATA_ROW + 2][situacao]).toBe("Em andamento");
    expect(aoa[FIRST_DATA_ROW + 2][status]).toBe("Em andamento");
    expect(aoa[FIRST_DATA_ROW + 2][pendencia]).toBe("Aguardando cliente");

    expect(aoa[FIRST_DATA_ROW + 3][situacao]).toBe("Concluído");
    expect(aoa[FIRST_DATA_ROW + 3][status]).toBe("Confirmado");
    expect(aoa[FIRST_DATA_ROW + 3][column("Concluído em")]).toBe("12/08/2026, 11:30");

    expect(aoa[FIRST_DATA_ROW + 4][status]).toBe("Repetido");
  });

  it("quebra os itens em produtos legíveis, sem perder o texto do arquivo", () => {
    exportHeldOrders({ rows: [order()], filters: NO_FILTERS });

    const aoa = sheetOfLastExport();
    expect(aoa[FIRST_DATA_ROW][column("Produtos")]).toBe("NRVEBLND x2, MVIT x1");
    expect(aoa[FIRST_DATA_ROW][column("Itens (arquivo)")]).toBe(
      "6294-NRVEBLND-114 x 2, 127-MVIT-277 x 1",
    );
  });

  it("monta o endereço sem repetir a linha duplicada do arquivo", () => {
    exportHeldOrders({ rows: [order()], filters: NO_FILTERS });

    expect(sheetOfLastExport()[FIRST_DATA_ROW][column("Endereço")]).toBe(
      "Rua A, 100, Apto 1, São Paulo, SP 01000-000, BR",
    );
  });

  it("põe no nome do arquivo só os filtros ativos", () => {
    exportHeldOrders({
      rows: [order()],
      filters: { ...NO_FILTERS, status: "Concluído" },
    });
    expect(fileNameOfLastExport()).toMatch(/^pedidos-em-espera_concluido_\d{4}-\d{2}-\d{2}\.xlsx$/);

    exportHeldOrders({
      rows: [order()],
      filters: { ...NO_FILTERS, status: "Em andamento", store: "LSD123", product: "NRVEBLND", agent: "Maria" },
    });
    expect(fileNameOfLastExport()).toMatch(
      /^pedidos-em-espera_em-andamento_lsd123_nrveblnd_maria_\d{4}-\d{2}-\d{2}\.xlsx$/,
    );

    exportHeldOrders({ rows: [order()], filters: NO_FILTERS });
    expect(fileNameOfLastExport()).toMatch(/^pedidos-em-espera_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("não gera planilha vazia sem aviso quando o filtro não retorna nada", () => {
    const count = exportHeldOrders({
      rows: [],
      filters: { ...NO_FILTERS, status: "Concluído", store: "LSD999" },
    });

    expect(count).toBe(0);
    expect(sheetOfLastExport()[FIRST_DATA_ROW][0]).toBe("Nenhum pedido com os filtros aplicados");
  });
});
