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

    // KPIs do período: 487 internos, 1.470 externos.
    expect(screen.getByText("Interno concluído (Cartpanda)")).toBeTruthy();
    expect(screen.getAllByText("Plataforma").length).toBeGreaterThanOrEqual(2); // filtro + coluna dos lotes
    // Cada total aparece no card e na linha "Todos" da tabela.
    expect(screen.getAllByText("487").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("1.470").length).toBeGreaterThanOrEqual(2);
    // Card "Casados" foi removido a pedido da gestora.
    expect(screen.queryByText("Casados")).toBeNull();
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
    // aparecem como coluna e como explicação no rodapé
    expect(screen.getAllByText("% interno").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("% externo").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Total da loja").length).toBeGreaterThanOrEqual(2); // card + coluna
  });

  // O percentual sai do CASAMENTO por pedido, não do volume interno: dos pedidos
  // que a loja reembolsou, quantos passaram pelo time. Como casados ⊆ total, o
  // interno nunca passa de 100% e não há clamp — se essas identidades quebrarem,
  // a conta voltou a misturar coortes diferentes (ver 20260916200000).
  it("os percentuais saem de casados ÷ total e somam 100%", () => {
    const linhas = [...fixture.by_product_month, fixture.by_product, fixture.summary].flat();
    const comTotal = linhas.filter((r) => r.external_count > 0);
    expect(comTotal.length).toBeGreaterThan(0);

    for (const r of comTotal) {
      expect(r.matched_count).toBeLessThanOrEqual(r.external_count);
      expect(r.external_diff).toBe(r.external_count - r.matched_count);
      expect(r.internal_pct).toBeCloseTo((100 * r.matched_count) / r.external_count, 1);
      expect(r.internal_pct as number).toBeLessThanOrEqual(100);
      expect((r.internal_pct as number) + (r.external_pct as number)).toBeCloseTo(100, 5);
    }
  });

  // Volume interno acima do arquivo não quebra mais percentual nenhum (o interno
  // conta pela data da baixa e inclui pedido comprado noutro mês). Segue valendo
  // como pista de arquivo velho.
  it("avisa quando o volume interno do mês passa do arquivo", () => {
    queryResult.current = { data: fixture, isLoading: false, isError: false };
    renderPage();
    const incoerentes = fixture.by_product_month.filter((r) => r.inconsistent);
    expect(incoerentes.length).toBeGreaterThan(0);

    const avisos = screen.getAllByTitle(/provável import velho ou faltando/);
    expect(avisos.length).toBe(incoerentes.length);

    // O percentual da linha avisada continua válido: sai do casamento, não do volume.
    for (const r of incoerentes) {
      expect(r.internal_pct as number).toBeLessThanOrEqual(100);
      expect(r.internal_count).toBeGreaterThan(r.external_count);
    }
  });

  it("sem arquivo importado no período mostra “—” em vez de 0%", () => {
    const semArquivo = {
      ...fixture,
      by_product_month: [
        {
          ...fixture.by_product_month[0],
          product: "Sem Arquivo",
          month: "2026-09",
          internal_count: 7,
          external_count: 0,
          external_diff: 0,
          internal_pct: null,
          external_pct: null,
          inconsistent: false,
        },
      ],
    };
    queryResult.current = { data: semArquivo, isLoading: false, isError: false };
    renderPage();
    const linha = screen.getAllByText("Sem Arquivo").map((e) => e.closest("tr")).find(Boolean)!;
    const celulas = Array.from(linha.querySelectorAll("td")).map((c) => c.textContent);
    expect(celulas.filter((c) => c === "—")).toHaveLength(2);
    expect(celulas).not.toContain("0,0%");
  });

  // O comparativo só cobre produto × mês com arquivo importado. Sem este aviso,
  // "interno 487" se lê como a operação inteira da plataforma — em produção eram
  // 43 de 124 reembolsos de agosto fora da conta, em silêncio.
  it("declara os reembolsos que ficaram fora por falta de arquivo", () => {
    queryResult.current = { data: fixture, isLoading: false, isError: false };
    renderPage();

    expect(screen.getByText(/43 reembolsos de Cartpanda fora do comparativo/)).toBeTruthy();
    // Os produtos viram fila de trabalho: quais arquivos o analista precisa buscar.
    expect(screen.getByText("Presgera")).toBeTruthy();
    expect(screen.getByText("Shapeon")).toBeTruthy();
    expect(screen.getAllByText("(ago/2026)").length).toBe(fixture.missing_imports.length);
  });

  it("não mostra o aviso quando todo o interno está coberto", () => {
    queryResult.current = {
      data: {
        ...fixture,
        summary: { ...fixture.summary, internal_not_compared: 0 },
        missing_imports: [],
      },
      isLoading: false,
      isError: false,
    };
    renderPage();
    expect(screen.queryByText(/fora do comparativo/)).toBeNull();
  });

  // Pedido que a loja já reembolsou e cujo registro interno segue em aberto conta
  // na cobertura (passou pelo time) e é fila de trabalho — a tela diz as duas coisas.
  it("mostra os casados e quantos deles ainda estão em aberto", () => {
    queryResult.current = { data: fixture, isLoading: false, isError: false };
    renderPage();

    expect(screen.getByText(/183 casados com o arquivo/)).toBeTruthy();
    expect(screen.getByText(/21 deles a loja já reembolsou e o registro interno segue em aberto/)).toBeTruthy();
  });

  it("omite a linha de em aberto quando não há nenhum", () => {
    queryResult.current = {
      data: { ...fixture, summary: { ...fixture.summary, matched_open_only: 0 } },
      isLoading: false,
      isError: false,
    };
    renderPage();
    expect(screen.queryByText(/segue em aberto/)).toBeNull();
  });

  it("mostra estado vazio quando nada foi importado", () => {
    queryResult.current = {
      data: { ...fixture, imports: [], by_product_month: [], by_product: [], divergences: { total_count: 0, rows: [] } },
      isLoading: false,
      isError: false,
    };
    renderPage();
    expect(screen.getByText(/Nenhum reembolso externo de Cartpanda foi importado ainda/)).toBeTruthy();
  });

  it("mostra skeletons enquanto carrega", () => {
    queryResult.current = { data: undefined, isLoading: true, isError: false };
    const { container } = renderPage();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });
});
