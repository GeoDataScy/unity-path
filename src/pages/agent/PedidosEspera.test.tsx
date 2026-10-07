import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import PedidosEspera from "./PedidosEspera";
import type { MyHeldOrder } from "@/features/held-orders/types";

vi.mock("react-router-dom", () => ({ useOutletContext: () => ({ userId: "eu" }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const ordersCalls = vi.hoisted(() => [] as unknown[][]);
const orders = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock("@/features/held-orders/useMyHeldOrdersQuery", () => ({
  useMyHeldOrdersQuery: (...args: unknown[]) => {
    ordersCalls.push(args);
    return { data: orders.current, isLoading: false, isError: false };
  },
  useMyHeldOrdersMetricsQuery: () => ({
    data: { confirmed_today: 27, pending: 2, inactive: 1, goal: 30 },
    isLoading: false,
  }),
  useHeldOrderEventsQuery: () => ({ data: [], isLoading: false }),
  useSetHeldOrderStatusMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function order(overrides: Partial<MyHeldOrder>): MyHeldOrder {
  return {
    id: "1",
    dyna_code: "DSA023",
    order_number: "PED-1",
    merged_orders: null,
    reason: "Held for Bad Address",
    order_date: "2026-09-22",
    return_date: null,
    email: "kevin@x.com",
    customer_name: "Kevin Silva",
    city: "Portland",
    state: "OR",
    country: "US",
    postal_code: "97201",
    street1: "1200 SW Main St",
    street2: null,
    street3: null,
    age: "9 day(s)",
    items: "6294-NRVEBLND-114 x 2",
    rma: null,
    restocked_items: null,
    damaged_items: null,
    comments: null,
    status: "pending",
    agent_status: "em_andamento",
    pending_tag: null,
    confirmed_at: null,
    imported_at: "2026-09-24T11:12:00Z",
    status_changed_at: "2026-10-02T18:40:00Z",
    last_note: null,
    last_event_user_id: "eu",
    last_event_by_manager: false,
    event_count: 1,
    ...overrides,
  };
}

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

function setOrders(list: MyHeldOrder[]) {
  orders.current = list;
}

const SAMPLE = [
  order({ id: "1", order_number: "PED-ANDAMENTO" }),
  order({ id: "2", order_number: "PED-NOVO", agent_status: "novo", status_changed_at: null, last_event_user_id: null }),
  order({ id: "3", order_number: "PED-DEVOLVIDO", last_event_user_id: "gestora", last_event_by_manager: true }),
  order({ id: "4", order_number: "PED-REATRIBUIDO", last_event_user_id: "outro-agente" }),
  order({ id: "5", order_number: "PED-INATIVO", agent_status: "inativo", last_note: "3 e-mails sem resposta" }),
  order({ id: "6", order_number: "PED-CONCLUIDO", agent_status: "concluido", status: "confirmed" }),
];

describe("PedidosEspera (agente)", () => {
  it("pede só os concluídos dos últimos 30 dias", () => {
    setOrders(SAMPLE);
    render(<PedidosEspera />);
    expect(ordersCalls.at(-1)).toEqual([true, "all", 30]);
  });

  it("abre em Para fazer: novos e em andamento, sem inativos nem concluídos", () => {
    setOrders(SAMPLE);
    render(<PedidosEspera />);
    const tabs = screen.getByRole("tablist", { name: "Status dos pedidos" });
    expect(within(tabs).getByRole("tab", { name: /Para fazer/ })).toHaveAttribute("aria-selected", "true");
    expect(within(tabs).getByRole("tab", { name: /Para fazer/ })).toHaveTextContent("4");
    expect(within(tabs).getByRole("tab", { name: /Inativos/ })).toHaveTextContent("1");
    expect(screen.getByText("PED-NOVO")).toBeInTheDocument();
    expect(screen.queryByText("PED-INATIVO")).not.toBeInTheDocument();
    expect(screen.queryByText("PED-CONCLUIDO")).not.toBeInTheDocument();
  });

  it("mostra a meta numa linha com o que falta", () => {
    setOrders(SAMPLE);
    render(<PedidosEspera />);
    const meta = screen.getByRole("region", { name: "Meta de hoje" });
    expect(meta).toHaveTextContent("27");
    expect(meta).toHaveTextContent("/ 30");
    expect(meta).toHaveTextContent("Faltam 3");
  });

  it("escreve o nome de cada data no card", () => {
    setOrders([order({ id: "1" })]);
    render(<PedidosEspera />);
    const card = screen.getByRole("button", { name: /PED-1/ });
    expect(card).toHaveTextContent("Data do pedido 22/09/2026");
    expect(card).toHaveTextContent("Entrada no sistema 24/09/2026");
    expect(card).toHaveTextContent("Última mudança 02/10/2026");
    expect(card).toHaveTextContent("Idade no arquivo 9 dia(s)");
  });

  it("devolução mostra a data da devolução no lugar da data do pedido", () => {
    setOrders([order({ id: "1", dyna_code: "RETURNS", order_date: null, return_date: "2026-06-17" })]);
    render(<PedidosEspera />);
    const card = screen.getByRole("button", { name: /PED-1/ });
    expect(card).toHaveTextContent("Data da devolução 17/06/2026");
    expect(card).not.toHaveTextContent("Data do pedido");
  });

  it("avisa quando o pedido voltou pela gestão ou veio de outro prestador", () => {
    setOrders(SAMPLE);
    render(<PedidosEspera />);
    expect(screen.getByRole("button", { name: /PED-DEVOLVIDO/ })).toHaveTextContent("Devolvido pela gestão");
    expect(screen.getByRole("button", { name: /PED-REATRIBUIDO/ })).toHaveTextContent("Veio de outro prestador");
    expect(screen.getByRole("button", { name: /PED-ANDAMENTO/ })).not.toHaveTextContent(/Devolvido|Veio de outro/);
  });

  it("aba Inativos lista com a observação e o botão Reabrir", () => {
    setOrders(SAMPLE);
    render(<PedidosEspera />);
    fireEvent.click(screen.getByRole("tab", { name: /Inativos/ }));
    const table = screen.getByRole("table");
    expect(within(table).getByText("PED-INATIVO")).toBeInTheDocument();
    expect(within(table).getByText("3 e-mails sem resposta")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: /Reabrir/ })).toBeInTheDocument();
  });

  it("a busca filtra por pedido, cliente ou e-mail", () => {
    setOrders(SAMPLE);
    render(<PedidosEspera />);
    fireEvent.change(screen.getByPlaceholderText("Buscar pedido, cliente ou e-mail"), {
      target: { value: "devolvido" },
    });
    expect(screen.getByText("PED-DEVOLVIDO")).toBeInTheDocument();
    expect(screen.queryByText("PED-NOVO")).not.toBeInTheDocument();
  });
});
