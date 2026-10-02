import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { HeldOrderTrackingDialog } from "./HeldOrderTrackingDialog";
import type { HeldOrderAgentStatus, MyHeldOrder } from "./types";

const setStatus = vi.hoisted(() => vi.fn());
vi.mock("./useMyHeldOrdersQuery", () => ({
  useHeldOrderEventsQuery: () => ({ data: [], isLoading: false }),
  useSetHeldOrderStatusMutation: () => ({ mutateAsync: setStatus, isPending: false }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function order(agent_status: HeldOrderAgentStatus): MyHeldOrder {
  return {
    id: "pedido-1",
    dyna_code: "LSD033",
    order_number: "A2SZ3F4N",
    merged_orders: null,
    reason: "Held for Bad Address",
    order_date: "2026-08-10",
    email: "cliente@exemplo.com",
    customer_name: "Cliente Um",
    city: "São Paulo",
    state: "SP",
    country: "BR",
    postal_code: "01000-000",
    street1: "Rua Um, 10",
    street2: null,
    street3: null,
    age: "78 day(s)",
    items: null,
    rma: null,
    restocked_items: null,
    damaged_items: null,
    comments: null,
    status: "pending",
    agent_status,
    pending_tag: null,
    confirmed_at: null,
    event_count: 0,
  };
}

/** O primeiro combobox do diálogo é o de Status; o segundo é o de Pendência. */
function statusSelect() {
  return screen.getAllByRole("combobox")[0];
}

beforeAll(() => {
  // Radix mede o viewport ao abrir o diálogo; o jsdom não tem estas APIs.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  setStatus.mockReset();
  setStatus.mockResolvedValue(undefined);
});

describe("HeldOrderTrackingDialog — status inicial do registro", () => {
  it("abre um pedido Novo com Novo selecionado, não com Em Andamento", () => {
    render(<HeldOrderTrackingDialog order={order("novo")} open onOpenChange={vi.fn()} />);
    expect(statusSelect()).toHaveTextContent("Novo");
    expect(statusSelect()).not.toHaveTextContent("Em Andamento");
  });

  it("registrar sem mexer no select não promove o pedido sozinho", async () => {
    render(<HeldOrderTrackingDialog order={order("novo")} open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/Descreva o que foi feito/i), {
      target: { value: "Liguei para o cliente" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));

    await waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1));
    expect(setStatus).toHaveBeenCalledWith({
      orderId: "pedido-1",
      status: "novo",
      note: "Liguei para o cliente",
      pendingTag: null,
    });
  });

  it("mantém o status atual quando o pedido já está em andamento", () => {
    render(<HeldOrderTrackingDialog order={order("em_andamento")} open onOpenChange={vi.fn()} />);
    expect(statusSelect()).toHaveTextContent("Em Andamento");
  });

  it("mantém Concluído em pedido já concluído", () => {
    render(<HeldOrderTrackingDialog order={order("concluido")} open onOpenChange={vi.fn()} />);
    expect(statusSelect()).toHaveTextContent("Concluído");
  });
});
