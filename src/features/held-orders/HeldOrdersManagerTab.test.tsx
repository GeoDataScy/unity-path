import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { HeldOrdersManagerTab } from "./HeldOrdersManagerTab";
import type { HeldOrdersExportParams } from "./exportHeldOrders";
import type { ManagerHeldOrder, ManagerHeldOrdersResult } from "./types";

// A exportação é testada em exportHeldOrders.test.ts; aqui o que importa é O QUE
// a tela entrega para ela.
const exportHeldOrders = vi.hoisted(() => vi.fn());
vi.mock("./exportHeldOrders", () => ({ exportHeldOrders }));

const queryResult = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("./useManagerHeldOrdersQuery", () => ({
  useManagerHeldOrdersQuery: () => queryResult.current,
  useImportHeldOrdersMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAssignHeldOrdersMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDistributeHeldOrdersMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/features/dashboard/useManagerUsersQuery", () => ({
  useManagerUsersQuery: () => ({
    data: [
      { id: "agente-1", email: "maria@x.com", full_name: "Maria", role: "agent" },
      { id: "agente-2", email: "joao@x.com", full_name: "João", role: "agent" },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

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
    street1: "Rua A, 100",
    street2: null,
    street3: null,
    age: "5",
    items: "6294-NRVEBLND-114 x 2",
    rma: null,
    restocked_items: null,
    damaged_items: null,
    comments: null,
    status: "pending",
    agent_status: "novo",
    pending_tag: null,
    confirmed_at: null,
    event_count: 0,
    source_file: "arquivo.csv",
    assigned_to: "agente-1",
    assigned_to_name: "Maria",
    imported_at: null,
    assign_count: 1,
    duplicate_of: null,
    ...overrides,
  };
}

function setRows(rows: ManagerHeldOrder[]) {
  const result: ManagerHeldOrdersResult = {
    total: rows.length,
    duplicates: rows.filter((o) => o.duplicate_of).length,
    rows,
    summary_by_agent: [],
  };
  queryResult.current = { data: result, isLoading: false, isError: false };
}

/** Números de pedido na ordem em que a tabela os mostra. */
function orderNumbersOnScreen(): string[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1) // cabeçalho
    .map((row) => within(row).getAllByRole("cell")[1].textContent?.trim() ?? "");
}

/** O que a tela passou para a exportação na n-ésima vez que o botão foi clicado. */
function exportCall(index = 0): HeldOrdersExportParams {
  return exportHeldOrders.mock.calls[index][0] as HeldOrdersExportParams;
}

function ids(rows: ManagerHeldOrder[]): string[] {
  return rows.map((o) => o.id);
}

function exportButton(): HTMLElement {
  return screen.getByRole("button", { name: /Exportar/ });
}

/**
 * Abre o select cujo gatilho mostra `current`. É pelo gatilho, e não por
 * getByText, porque os cartões do resumo repetem os nomes dos status.
 */
function openSelect(current: string) {
  const trigger = screen
    .getAllByRole("combobox")
    .find((el) => (el.textContent ?? "").trim() === current);
  expect(trigger, `select com "${current}"`).toBeDefined();
  fireEvent.click(trigger as HTMLElement);
}

function chooseOption(name: string) {
  fireEvent.click(screen.getByRole("option", { name }));
}

/** Radix Select precisa destes ganchos de ponteiro, que o jsdom não implementa. */
beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

beforeEach(() => exportHeldOrders.mockClear());

describe("HeldOrdersManagerTab — exportação", () => {
  it("exporta exatamente as linhas da tela, na mesma ordem", () => {
    setRows([
      order({ id: "1", order_number: "PED-1" }),
      order({ id: "2", order_number: "PED-2" }),
      order({ id: "3", order_number: "PED-3" }),
    ]);
    render(<HeldOrdersManagerTab />);

    expect(exportButton()).toHaveTextContent("Exportar (3)");
    fireEvent.click(exportButton());

    const { rows } = exportCall();
    expect(rows.map((o) => o.order_number)).toEqual(orderNumbersOnScreen());
    expect(rows.map((o) => o.order_number)).toEqual(["PED-1", "PED-2", "PED-3"]);
  });

  it("a busca da tela também estreita o relatório", () => {
    setRows([
      order({ id: "1", order_number: "PED-1", customer_name: "Ana" }),
      order({ id: "2", order_number: "PED-2", customer_name: "Bruno" }),
    ]);
    render(<HeldOrdersManagerTab />);

    fireEvent.change(screen.getByPlaceholderText(/Buscar pedido/), { target: { value: "bruno" } });

    expect(orderNumbersOnScreen()).toEqual(["PED-2"]);
    expect(exportButton()).toHaveTextContent("Exportar (1)");

    fireEvent.click(exportButton());
    const call = exportCall();
    expect(ids(call.rows)).toEqual(["2"]);
    expect(call.filters.search).toBe("bruno");
  });

  it("linhas repetidas ficam fora do relatório até a gestora pedir para vê-las", () => {
    setRows([
      order({ id: "1", order_number: "PED-1" }),
      order({ id: "2", order_number: "PED-1-REP", duplicate_of: "1" }),
    ]);
    render(<HeldOrdersManagerTab />);

    fireEvent.click(exportButton());
    expect(ids(exportCall().rows)).toEqual(["1"]);
    expect(exportCall().filters.includesDuplicates).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Ver repetidos/ }));
    fireEvent.click(exportButton());
    const segunda = exportCall(1);
    expect(ids(segunda.rows)).toEqual(["1", "2"]);
    expect(segunda.filters.includesDuplicates).toBe(true);
  });

  it("filtra por produto (item do pedido) e leva o filtro para o relatório", () => {
    setRows([
      order({ id: "1", order_number: "PED-1", items: "6294-NRVEBLND-114 x 2" }),
      order({ id: "2", order_number: "PED-2", items: "127-MVIT-277 x 1" }),
      order({ id: "3", order_number: "PED-3", items: "6294-NRVEBLND-114 x 1, 127-MVIT-277 x 1" }),
    ]);
    render(<HeldOrdersManagerTab />);

    // O select de produtos mostra a contagem de pedidos que contêm cada um.
    openSelect("Todos os produtos");
    expect(screen.getByRole("option", { name: "NRVEBLND (2)" })).toBeInTheDocument();
    chooseOption("MVIT (2)");

    expect(orderNumbersOnScreen()).toEqual(["PED-2", "PED-3"]);
    fireEvent.click(exportButton());
    const call = exportCall();
    expect(ids(call.rows)).toEqual(["2", "3"]);
    expect(call.filters.product).toBe("MVIT");
  });

  it("não oferece mais o filtro de lojas e sempre exporta 'store: null'", () => {
    setRows([
      order({ id: "1", order_number: "PED-1", dyna_code: "LSD001" }),
      order({ id: "2", order_number: "PED-2", dyna_code: "RETURNS" }),
    ]);
    render(<HeldOrdersManagerTab />);

    expect(screen.queryByText("Todas as lojas")).not.toBeInTheDocument();

    fireEvent.click(exportButton());
    const call = exportCall();
    expect(ids(call.rows)).toEqual(["1", "2"]);
    expect(call.filters.store).toBeNull();
  });

  // Os três relatórios que a operação pede por nome, e a combinação deles.
  it("leva status e agente escolhidos para o cabeçalho do relatório", () => {
    setRows([order({ id: "1", agent_status: "concluido", status: "confirmed" })]);
    render(<HeldOrdersManagerTab />);

    openSelect("Todos status");
    chooseOption("Confirmados");
    fireEvent.click(exportButton());
    expect(exportCall().filters.status).toBe("Concluído");

    openSelect("Confirmados");
    chooseOption("Aguardando");
    fireEvent.click(exportButton());
    expect(exportCall(1).filters.status).toBe("Aguardando atendimento");

    openSelect("Aguardando");
    chooseOption("Em andamento");
    fireEvent.click(exportButton());
    expect(exportCall(2).filters.status).toBe("Em andamento");

    // Por agente — e "todos os agentes" não vira rótulo nenhum.
    expect(exportCall(2).filters.agent).toBeNull();
    openSelect("Todos agentes");
    chooseOption("Maria");
    fireEvent.click(exportButton());
    const combinado = exportCall(3).filters;
    expect(combinado.agent).toBe("Maria");
    expect(combinado.status).toBe("Em andamento");
  });

  it("não deixa exportar quando o filtro não devolve nada", () => {
    setRows([order({ id: "1", order_number: "PED-1" })]);
    render(<HeldOrdersManagerTab />);

    fireEvent.change(screen.getByPlaceholderText(/Buscar pedido/), { target: { value: "zzz" } });

    expect(screen.getByText("Nenhum pedido encontrado.")).toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
  });
});
