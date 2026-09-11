import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";

import DashboardRefundsComparativo from "./DashboardRefundsComparativo";
import fixture from "@/features/external-refunds/__fixtures__/comparison.json";

// Resposta real da RPC dashboard_external_refund_comparison (jul+ago/2026,
// gerada no banco local com os 10 exports e uma amostra dos reembolsos internos;
// clientes/agentes anonimizados). O que se testa aqui é a leitura desse jsonb.
const queryResult = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/features/external-refunds/useExternalRefundComparisonQuery", () => ({
  useExternalRefundComparisonQuery: () => queryResult.current,
  useImportExternalRefundsMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteExternalRefundsMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useOutletContext: () => ({ role: "manager" }) };
});

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

// recharts mede o container com ResizeObserver, que o jsdom não tem.
beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/reembolsos/comparativo"]}>
      <DashboardRefundsComparativo />
    </MemoryRouter>,
  );
}

describe("DashboardRefundsComparativo", () => {
  it("mostra os totais da RPC e a tabela produto × mês", () => {
    queryResult.current = { data: fixture, isLoading: false, isError: false };
    renderPage();

    // KPIs do período: 487 internos, 1.470 da loja, 183 casados (12,4%).
    // Cada total aparece no card e na linha "Todos" da tabela.
    expect(screen.getAllByText("487").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("1.470").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("183").length).toBeGreaterThan(0);
    expect(screen.getByText("12,4% dos reembolsos externos")).toBeTruthy();
    expect(screen.getAllByText("US$ 429.783,64").length).toBeGreaterThanOrEqual(2);

    // Linhas produto × mês (6 produtos × 2 meses) + filtro de produto populado.
    expect(screen.getAllByText("jul/2026").length).toBeGreaterThanOrEqual(6);
    expect(screen.getAllByText("Horsefil").length).toBeGreaterThan(0);

    // Botão de import só para gestora; lotes importados listados.
    expect(screen.getByRole("button", { name: /Importar reembolso externo/ })).toBeTruthy();
    expect(screen.getByText("Reembolsos externos importados")).toBeTruthy();

    // Lixeira em cada painel de produto (6 produtos na fixture).
    expect(screen.getAllByRole("button", { name: /Apagar reembolsos externos de/ })).toHaveLength(6);
    // Tabela sem "Casados" e com as duas colunas de percentual.
    expect(screen.queryByText("Casados", { selector: "th" })).toBeNull();
    expect(screen.getByText("% interno")).toBeTruthy();
    expect(screen.getByText("% externo")).toBeTruthy();
  });

  it("mostra estado vazio quando nada foi importado", () => {
    queryResult.current = {
      data: { ...fixture, imports: [], by_product_month: [], by_product: [], divergences: { total_count: 0, rows: [] } },
      isLoading: false,
      isError: false,
    };
    renderPage();
    expect(screen.getByText(/Nenhum reembolso externo foi importado ainda/)).toBeTruthy();
  });

  it("mostra skeletons enquanto carrega", () => {
    queryResult.current = { data: undefined, isLoading: true, isError: false };
    const { container } = renderPage();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });
});
