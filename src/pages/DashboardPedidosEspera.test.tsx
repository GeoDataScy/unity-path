import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPedidosEspera from "./DashboardPedidosEspera";

// O banco é simulado pela RPC: cada teste olha COM QUE FILTROS a tela pergunta.
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

const exportHeldOrders = vi.hoisted(() => vi.fn((_params: unknown) => 2));
vi.mock("@/features/held-orders/exportHeldOrders", () => ({ exportHeldOrders }));

vi.mock("@/features/dashboard/useManagerUsersQuery", () => ({
  useManagerUsersQuery: () => ({
    data: [{ id: "ag-1", email: "maria@x.com", full_name: "Maria", role: "agent", is_active: true }],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    bucket: "andamento",
    client_key: `cliente-${id}`,
    dyna_code: "DSA023",
    order_number: `PED-${id}`,
    merged_orders: null,
    reason: "Held for Bad Address",
    order_date: "2026-09-22",
    return_date: null,
    email: `c${id}@x.com`,
    customer_name: `Cliente ${id}`,
    city: null,
    state: null,
    country: null,
    postal_code: null,
    street1: null,
    street2: null,
    street3: null,
    age: null,
    items: "6294-NRVEBLND-114 x 1",
    rma: null,
    restocked_items: null,
    damaged_items: null,
    comments: null,
    source_file: "x.csv",
    status: "pending",
    agent_status: "em_andamento",
    pending_tag: null,
    assign_count: 1,
    assigned_to: "ag-1",
    assigned_to_name: "Maria",
    confirmed_at: null,
    imported_at: "2026-09-24T11:12:00Z",
    status_changed_at: "2026-10-02T18:40:00Z",
    event_count: 1,
    duplicate_of: null,
    ...overrides,
  };
}

const PAGE = {
  total: 2,
  counts: { sem_agente: 0, novo: 5, andamento: 2, inativo: 1, concluido: 9 },
  open_outside_period: 1206,
  products: [{ code: "NRVEBLND", count: 2 }],
  rows: [row("1"), row("2")],
};

const TEAM = {
  goal: 30,
  agents: [
    {
      agent_id: "ag-1",
      full_name: "Maria",
      is_active: true,
      fila: 5,
      andamento: 2,
      inativo: 1,
      done_today: 12,
      last_event_at: new Date().toISOString(),
    },
  ],
  today: { imported: 42, started: 16, done: 34, concluded: 30, inactive_alerts: 3 },
};

/** Argumentos da última chamada de manager_held_orders_page que pediu uma página. */
function lastPageArgs(): Record<string, unknown> {
  const calls = rpc.mock.calls.filter(
    ([fn, args]) => fn === "manager_held_orders_page" && !args.p_ids_only && args.p_limit !== null,
  );
  return calls[calls.length - 1][1];
}

function spDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DashboardPedidosEspera />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

beforeEach(() => {
  rpc.mockReset();
  exportHeldOrders.mockClear();
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "manager_held_orders_team") return { data: TEAM, error: null };
    if (fn === "manager_held_orders_page") {
      if (args.p_ids_only) {
        return {
          data: [
            { id: "1", client_key: "cliente-A" },
            { id: "2", client_key: "cliente-A" },
            { id: "3", client_key: "cliente-B" },
          ],
          error: null,
        };
      }
      return { data: PAGE, error: null };
    }
    return { data: null, error: null };
  });
});

describe("DashboardPedidosEspera", () => {
  it("abre nos últimos 30 dias pela entrada no sistema, sem status nem agente", async () => {
    renderPage();
    await screen.findByText("PED-1");
    expect(lastPageArgs()).toMatchObject({
      p_status: null,
      p_agent_id: null,
      p_date_field: "entrada",
      p_from: spDate(-29),
      p_to: null,
      p_limit: 50,
      p_offset: 0,
    });
  });

  it("as abas de status mostram a contagem e filtram a lista", async () => {
    renderPage();
    await screen.findByText("PED-1");
    const strip = screen.getByRole("group", { name: "Filtrar por status" });
    const andamento = within(strip).getByRole("button", { name: /Em andamento/ });
    expect(andamento).toHaveTextContent("2");
    expect(within(strip).getByText("3 para revisar")).toBeInTheDocument();

    fireEvent.click(andamento);
    await waitFor(() => expect(lastPageArgs().p_status).toBe("andamento"));
    expect(andamento).toHaveAttribute("aria-pressed", "true");

    // Clicar de novo na aba ativa volta para todos.
    fireEvent.click(andamento);
    await waitFor(() => expect(lastPageArgs().p_status).toBeNull());
  });

  it("clicar no agente da equipe filtra a lista por ele", async () => {
    renderPage();
    await screen.findByText("PED-1");
    // A tabela da equipe vem antes da lista de pedidos (que também mostra "Maria").
    const teamCell = screen.getAllByRole("cell", { name: "Maria" })[0];
    fireEvent.click(teamCell);
    await waitFor(() => expect(lastPageArgs().p_agent_id).toBe("ag-1"));
    expect(screen.getByText(/Agente: Maria/)).toBeInTheDocument();
  });

  it("avisa dos pedidos em aberto fora do período e deixa ver todos", async () => {
    renderPage();
    await screen.findByText(/1\.206 pedido\(s\) em aberto ficaram fora deste período/);
    fireEvent.click(screen.getByRole("button", { name: "Ver todo o período" }));
    await waitFor(() => expect(lastPageArgs().p_from).toBeNull());
  });

  it("selecionar os primeiros N mostra a barra de distribuir com a contagem de clientes", async () => {
    renderPage();
    await screen.findByText("PED-1");
    fireEvent.click(screen.getByRole("button", { name: "Selecionar" }));
    await screen.findByText("3 pedido(s) de 2 cliente(s)");
    const call = rpc.mock.calls.find(([fn, args]) => fn === "manager_held_orders_page" && args.p_ids_only);
    expect(call?.[1]).toMatchObject({ p_limit: 10, p_date_field: "entrada", p_from: spDate(-29) });
    expect(screen.getByRole("button", { name: /Distribuir/ })).toBeInTheDocument();
  });

  it("exporta todas as páginas do filtro e descreve o período na planilha", async () => {
    renderPage();
    await screen.findByText("PED-1");
    fireEvent.click(screen.getByRole("button", { name: /Exportar \(2\)/ }));
    await waitFor(() => expect(exportHeldOrders).toHaveBeenCalledTimes(1));
    const exportCall = rpc.mock.calls.find(([fn, args]) => fn === "manager_held_orders_page" && args.p_limit === null);
    expect(exportCall?.[1]).toMatchObject({ p_from: spDate(-29), p_date_field: "entrada" });
    const params = exportHeldOrders.mock.calls[0][0] as { filters: { period: string } };
    expect(params.filters.period).toContain("Entrada no sistema");
  });
});
