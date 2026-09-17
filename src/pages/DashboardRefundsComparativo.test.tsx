import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";

import DashboardRefundsComparativo from "./DashboardRefundsComparativo";
import fixture from "@/features/external-refunds/__fixtures__/comparison.json";

// Resposta real da RPC dashboard_external_refund_comparison (jul+ago/2026,
// gerada no banco local com os 10 exports e uma amostra dos reembolsos internos;
// clientes/agentes anonimizados). O que se testa aqui é a leitura desse jsonb.
//
// Os campos de agregado do summary foram recalculados em 20260917120000, quando o
// agregado passou a considerar só pares (produto, mês) com arquivo importado: a
// fixture tem duas linhas em "—" (Mind Wake e Quiet Nerves em julho) com 5
// reembolsos internos, que o summary somava sem ter denominador para eles.
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

    // KPIs do período: 482 internos (só os meses com arquivo), 1.470 externos.
    expect(screen.getByText("Interno concluído (Cartpanda)")).toBeTruthy();
    expect(screen.getAllByText("Plataforma").length).toBeGreaterThanOrEqual(2); // filtro + coluna dos lotes
    // Cada total aparece no card e na linha "Todos" da tabela.
    expect(screen.getAllByText("482").length).toBeGreaterThanOrEqual(2);
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

  // A regra do Webert: total (arquivo) = interno (concluídos) + externo (o resto).
  // Se os dois percentuais deixarem de somar 100, a conta quebrou em algum lugar.
  // A exceção é a linha incoerente (interno > total), onde o externo é clampado em 0.
  it("os percentuais somam 100% sempre que existe total importado", () => {
    const linhas = [...fixture.by_product_month, fixture.summary];
    const comTotal = linhas.filter((r) => r.external_count > 0);
    expect(comTotal.length).toBeGreaterThan(0);

    for (const r of comTotal) {
      expect(r.internal_pct).not.toBeNull();
      expect(r.external_diff).toBe(Math.max(r.external_count - r.internal_count, 0));
      if (r.inconsistent) {
        expect(r.internal_pct as number).toBeGreaterThan(100);
        expect(r.external_pct).toBe(0);
      } else {
        expect((r.internal_pct as number) + (r.external_pct as number)).toBeCloseTo(100, 5);
      }
    }
  });

  // O agregado (linha "Todos" e os cards) considera SOMENTE pares (produto, mês)
  // com arquivo importado: linha em "—" fica fora do numerador E do denominador.
  // Antes, o interno dessas linhas entrava no numerador sem ter nada para somar
  // no denominador e inflava o % interno de todo mundo — em produção,
  // 224/847 = 26,4% no lugar de 86/847 = 10,2%.
  it("o agregado soma só as linhas com arquivo importado", () => {
    const comArquivo = fixture.by_product_month.filter((r) => r.external_count > 0);
    const semArquivo = fixture.by_product_month.filter((r) => r.external_count === 0);

    // Sem os dois casos na fixture o teste não prova nada.
    expect(comArquivo.length).toBeGreaterThan(0);
    expect(semArquivo.length).toBeGreaterThan(0);
    expect(semArquivo.reduce((a, r) => a + r.internal_count, 0)).toBeGreaterThan(0);

    expect(fixture.summary.internal_count).toBe(
      comArquivo.reduce((a, r) => a + r.internal_count, 0),
    );
    // O recorte vale para o agregado inteiro, não só para a fração: senão a linha
    // "Todos" mostraria "Só interno" acima de "Interno".
    expect(fixture.summary.internal_only).toBe(
      comArquivo.reduce((a, r) => a + r.internal_only, 0),
    );
    expect(fixture.summary.internal_without_order).toBe(
      comArquivo.reduce((a, r) => a + r.internal_without_order, 0),
    );
    expect(fixture.summary.internal_only).toBeLessThanOrEqual(fixture.summary.internal_count);
    // O denominador já só tinha linhas com arquivo; continua igual.
    expect(fixture.summary.external_count).toBe(
      comArquivo.reduce((a, r) => a + r.external_count, 0),
    );
  });

  it("marca a linha em que o interno passa do total importado", () => {
    queryResult.current = { data: fixture, isLoading: false, isError: false };
    renderPage();
    // Alpharock/ago na fixture tem 34 internos contra 15 no arquivo.
    const avisos = screen.getAllByTitle("interno excede o total importado; verificar import do período");
    expect(avisos.length).toBe(fixture.by_product_month.filter((r) => r.inconsistent).length);
    const linha = avisos[0].closest("tr")!;
    const celulas = Array.from(linha.querySelectorAll("td")).map((c) => c.textContent);
    expect(celulas).toContain("0,0%"); // externo clampado
    expect(celulas.some((c) => c && /^2\d\d,\d%$/.test(c))).toBe(true); // interno acima de 100% fica visível
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

  // PagAmerican: o arquivo confirma o reembolso mas nem sempre diz o tipo. Esses
  // pedidos contam no total (e portanto nas porcentagens, que não usam o tipo),
  // mas não entram em integral nem em parcial — sem o terceiro número a coluna
  // não fecharia com o total e a diferença sumiria da tela.
  it("mostra os reembolsos sem tipo separados na coluna integral / parcial", () => {
    const comSemTipo = {
      ...fixture,
      by_product_month: [
        { ...fixture.by_product_month[0], product: "Jellyrock", month: "2026-09",
          external_count: 259, external_full: 104, external_partial: 113,
          internal_count: 2, external_diff: 257, internal_pct: 0.8, external_pct: 99.2, inconsistent: false },
      ],
    };
    queryResult.current = { data: comSemTipo, isLoading: false, isError: false };
    renderPage();

    const linha = screen.getAllByText("Jellyrock").map((e) => e.closest("tr")).find(Boolean)!;
    const texto = linha.textContent ?? "";
    expect(texto).toContain("104 / 113");
    expect(texto).toContain("42 s/ tipo"); // 259 - 104 - 113
  });

  it("não mostra o terceiro número quando todo pedido tem tipo (Cartpanda)", () => {
    queryResult.current = { data: fixture, isLoading: false, isError: false };
    renderPage();
    expect(screen.queryByText(/s\/ tipo/)).toBeNull();
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
