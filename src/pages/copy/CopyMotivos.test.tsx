import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import CopyMotivos from "@/pages/copy/CopyMotivos";
import { analyticsFixture } from "@/features/copy/__fixtures__/analytics";

// A tela lê período/nome do contexto do CopyLayout; aqui ele é injetado direto.
vi.mock("react-router-dom", () => ({
  useOutletContext: () => ({
    userId: "u1",
    fullName: "Copy Teste",
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
    render(<CopyMotivos />);

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
    render(<CopyMotivos />);

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
    render(<CopyMotivos />);
    expect(screen.getByText(/15\/03\/2026 a 31\/05\/2026/)).toBeInTheDocument();
  });
});
