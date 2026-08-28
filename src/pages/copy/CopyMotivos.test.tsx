import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import CopyMotivos from "@/pages/copy/CopyMotivos";
import { analyticsFixture } from "@/features/copy/__fixtures__/analytics";

// A tela lê período/nome/role do contexto do CopyLayout; aqui ele é injetado
// direto. `role` decide quem pode editar a cotação — o padrão é o time de copy.
let contextRole = "copy_grup";

vi.mock("react-router-dom", () => ({
  useOutletContext: () => ({
    userId: "u1",
    fullName: "Copy Teste",
    role: contextRole,
    range: undefined,
    setRange: () => {},
    fromISO: "2026-06-01",
    toISO: "2026-08-17",
  }),
}));

vi.mock("@/features/copy/useCopyRefundAnalyticsQuery", () => ({
  useCopyRefundAnalyticsQuery: () => ({
    data: analyticsFixture,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
  }),
}));

// O drill-down tem query própria; o teste aqui é da tela, não do modal.
vi.mock("@/features/copy/useCopyReasonEvidenceQuery", () => ({
  useCopyReasonEvidenceQuery: () => ({ data: undefined, isLoading: false, isError: false, error: null }),
}));

// A nota de cotação grava via TanStack Query, que exige provider no render.
function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CopyMotivos />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  // recharts mede o container com ResizeObserver, que o jsdom não tem.
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe("CopyMotivos", () => {
  it("mostra o universo do período e o mix de motivos com variação em p.p.", () => {
    renderScreen();

    // Universo: 1.348 concluídos, 2.019 no período anterior (queda de 33,2%).
    expect(screen.getByText("1.348")).toBeInTheDocument();
    expect(screen.getByText("2.019 no período anterior")).toBeInTheDocument();
    expect(screen.getByText("-33,2%")).toBeInTheDocument();

    // Motivo dominante: 54,1% de participação, +39 p.p. contra o período anterior.
    // A linha é localizada pela variação (única na tela) — o nome do motivo
    // aparece também na coluna "motivo dominante" da tabela de produtos.
    const linha = screen.getByText("+39,0 p.p.").closest("tr");
    expect(linha).not.toBeNull();
    expect(within(linha as HTMLElement).getByText("Insatisfação com o produto")).toBeInTheDocument();
    expect(within(linha as HTMLElement).getByText("54,1%")).toBeInTheDocument();
    expect(within(linha as HTMLElement).getByText("729")).toBeInTheDocument();
  });

  it("lista como sinal de copy só o par produto×motivo acima do piso de volume e de índice", () => {
    renderScreen();

    const sinais = screen.getByText("Sinais de copy").closest("div[data-slot], div");
    expect(sinais).not.toBeNull();

    // Steelpower × "Produto não funcionou como esperado": 71 casos, índice 1,42×.
    expect(screen.getByText("1,42×")).toBeInTheDocument();
    // Risco de chargeback no Steelpower: 9 casos, 1,50× — passa no piso (n >= 8).
    expect(screen.getByText("1,50×")).toBeInTheDocument();
    // Follow up tem índice 1,65× mas é ausência de motivo: não pode virar sinal.
    expect(screen.queryByText("1,65×")).not.toBeInTheDocument();
    // Índice abaixo de 1,3 fica fora (Insatisfação no Steelpower, 0,97×).
    expect(screen.queryByText("0,97×")).not.toBeInTheDocument();
  });

  it("nomeia o período anterior usado na comparação", () => {
    renderScreen();
    expect(screen.getByText(/15\/03\/2026 a 31\/05\/2026/)).toBeInTheDocument();
  });

  it("mostra o dinheiro em dólar e diz por qual cotação converteu", () => {
    renderScreen();

    // KPI "Valor devolvido": 332.628,65 convertidos vêm da RPC já em dólar.
    expect(screen.getByText("US$ 332.629")).toBeInTheDocument();
    expect(screen.queryByText("R$ 332.629")).not.toBeInTheDocument();
    expect(screen.getByText(/convertidos de real a R\$ 5,40 por US\$ 1/)).toBeInTheDocument();
  });

  it("só a gestora pode mexer na cotação", () => {
    const { unmount } = renderScreen();
    expect(screen.queryByRole("button", { name: "Atualizar cotação" })).not.toBeInTheDocument();
    unmount();

    contextRole = "manager";
    renderScreen();
    expect(screen.getByRole("button", { name: "Atualizar cotação" })).toBeInTheDocument();
    contextRole = "copy_grup";
  });
});
