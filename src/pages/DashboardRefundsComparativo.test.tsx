import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";

import DashboardRefundsComparativo from "./DashboardRefundsComparativo";
import fixture from "@/features/external-refunds/__fixtures__/comparison.json";

// Resposta real da RPC dashboard_external_refund_comparison, gerada em Postgres
// local com os dois exports da PagAmerican e os reembolsos internos copiados de
// produção (clientes, e-mails e agentes anonimizados). O que se testa aqui é a
// leitura desse jsonb — os números vêm do banco, não escritos à mão.
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

function withData(data: unknown = fixture) {
  queryResult.current = { data, isLoading: false, isError: false };
  return renderPage();
}

describe("DashboardRefundsComparativo", () => {
  it("mostra os KPIs do período a partir da série", () => {
    withData();
    // 622 reembolsos e US$ 220.031,36 são a soma da série na fixture.
    expect(screen.getByText("Reembolsos no período")).toBeTruthy();
    expect(screen.getAllByText("622").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/220\.031,36/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Produto líder")).toBeTruthy();
    expect(screen.getAllByText("Jellyrock").length).toBeGreaterThan(0);
  });

  // A conta oficial do gestor: dos pedidos que a plataforma reembolsou, quantos
  // passaram pelo time. O numerador é o CASAMENTO, não o volume interno — o
  // volume (14 na fixture) é maior que os casados (12) e não pode aparecer no
  // lugar dele.
  it("o % interno sai do casamento, não do volume interno", () => {
    const s = fixture.summary;
    expect(s.matched_count).toBe(12);
    expect(s.internal_count).toBe(14);
    expect(s.internal_pct).toBeCloseTo((100 * s.matched_count) / s.external_count, 1);

    withData();
    expect(screen.getByText("1,9%")).toBeTruthy();
    expect(screen.getByText(/98,1% externo · 12 de 622 pedidos/)).toBeTruthy();
  });

  it("os percentuais somam 100 e o externo é o que não casou", () => {
    const linhas = [...fixture.by_product_month, fixture.summary];
    const comTotal = linhas.filter((r) => r.external_count > 0);
    expect(comTotal.length).toBeGreaterThan(0);
    for (const r of comTotal) {
      expect(r.external_diff).toBe(r.external_count - r.matched_count);
      expect((r.internal_pct as number) + (r.external_pct as number)).toBeCloseTo(100, 5);
      // casados ⊆ total: o interno nunca passa de 100%
      expect(r.matched_count).toBeLessThanOrEqual(r.external_count);
    }
  });

  // Invariante do agregado (20260917120000): o período só soma os pares
  // (produto, mês) que têm arquivo importado.
  it("o agregado soma só as linhas com arquivo importado", () => {
    const comArquivo = fixture.by_product_month.filter((r) => r.external_count > 0);
    const soma = (k: "internal_count" | "matched_count" | "external_count") =>
      comArquivo.reduce((a, r) => a + r[k], 0);
    expect(fixture.summary.internal_count).toBe(soma("internal_count"));
    expect(fixture.summary.matched_count).toBe(soma("matched_count"));
    expect(fixture.summary.external_count).toBe(soma("external_count"));
  });

  // A série é a base dos gráficos: se ela não fechar com o summary, o gráfico
  // conta uma história e os cards outra.
  it("a série fecha com o summary", () => {
    const s = fixture.summary;
    const soma = (k: "orders" | "matched" | "full" | "partial" | "unspecified") =>
      fixture.series.reduce((a, r) => a + r[k], 0);
    expect(soma("orders")).toBe(s.external_count);
    expect(soma("matched")).toBe(s.matched_count);
    expect(soma("full")).toBe(s.external_full);
    expect(soma("partial")).toBe(s.external_partial);
    expect(soma("full") + soma("partial") + soma("unspecified")).toBe(s.external_count);
    expect(fixture.series.reduce((a, r) => a + Number(r.amount), 0)).toBeCloseTo(Number(s.external_amount), 2);
  });

  it("clicar no produto da legenda tira ele da conta", () => {
    withData();
    const legenda = screen.getAllByRole("button", { name: /Jellyrock/ })[0];
    expect(legenda.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(legenda);
    expect(legenda.getAttribute("aria-pressed")).toBe("false");
  });

  // A Cartpanda (plataforma padrão da tela) só tem a data da COMPRA no arquivo.
  // Oferecer "Diário" ali seria rotular compra como reembolso, então o controle
  // nasce com uma opção só. A regra por plataforma está coberta em series.test.
  it("na Cartpanda o gráfico só oferece a visão mensal", () => {
    withData();
    const grupo = screen.getByRole("group", { name: "agrupar por" });
    expect(within(grupo).getByText("Mensal")).toBeTruthy();
    expect(within(grupo).queryByText("Diário")).toBeNull();
    expect(within(grupo).queryByText("Semanal")).toBeNull();
    // e a tela diz por quê, em vez de deixar o controle mudo
    expect(screen.getByText(/traz a data da compra, não a do reembolso/)).toBeTruthy();
  });

  // O pico e a contagem de períodos têm de seguir a régua do arquivo. A fixture
  // tem 35 dias espalhados por 2 meses; com a Cartpanda (que só tem data de
  // compra, logo só visão mensal) somar por dia e rotular "meses" diria
  // "35 meses com reembolso".
  it("na Cartpanda o pico e a contagem são por mês, não por dia", () => {
    const dias = new Set(fixture.series.map((r) => r.date)).size;
    const meses = new Set(fixture.series.map((r) => r.date.slice(0, 7))).size;
    expect(dias).toBe(35);
    expect(meses).toBe(2);

    withData();
    expect(screen.getByText(`${meses} meses com reembolso`)).toBeTruthy();
    expect(screen.queryByText(`${dias} meses com reembolso`)).toBeNull();
    expect(screen.getByText("Pico em um único mês")).toBeTruthy();

    // o maior mês da fixture, não o maior dia
    const porMes = new Map<string, number>();
    for (const r of fixture.series) porMes.set(r.date.slice(0, 7), (porMes.get(r.date.slice(0, 7)) ?? 0) + r.orders);
    const maiorMes = Math.max(...porMes.values());
    const maiorDia = Math.max(
      ...[...fixture.series.reduce((m, r) => m.set(r.date, (m.get(r.date) ?? 0) + r.orders), new Map<string, number>()).values()],
    );
    expect(maiorMes).toBeGreaterThan(maiorDia);
    expect(screen.getAllByText(String(maiorMes)).length).toBeGreaterThanOrEqual(1);
  });

  // Os três cartões dentro do painel de migração, como no painel de referência.
  // A evolução compara SEMPRE o primeiro mês com o último, mesmo que o gráfico
  // esteja em dia ou semana — fatia dia a dia é ruído.
  it("mostra os cartões de equipe × plataforma com a evolução entre meses", () => {
    const total = fixture.series.reduce((a, r) => a + r.orders, 0);
    const equipe = fixture.series.reduce((a, r) => a + r.matched, 0);
    const porMes = new Map<string, { t: number; p: number }>();
    for (const r of fixture.series) {
      const k = r.date.slice(0, 7);
      const c = porMes.get(k) ?? { t: 0, p: 0 };
      c.t += r.orders;
      c.p += r.matched;
      porMes.set(k, c);
    }
    const meses = [...porMes.keys()].sort();
    expect(meses.length).toBe(2);
    const pctUltimo = (porMes.get(meses[1])!.p / porMes.get(meses[1])!.t) * 100;
    const pctPrimeiro = (porMes.get(meses[0])!.p / porMes.get(meses[0])!.t) * 100;

    withData();
    expect(screen.getByText("Atendidos pela sua equipe")).toBeTruthy();
    expect(screen.getByText("Atendidos pela plataforma")).toBeTruthy();
    expect(screen.getByText("Evolução da sua fatia")).toBeTruthy();

    // equipe + plataforma = total do período
    expect(screen.getAllByText(String(equipe)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(String(total - equipe)).length).toBeGreaterThan(0);

    // a evolução mostra o último mês, e o subtítulo traz o primeiro com a seta
    const fmt = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;
    expect(screen.getAllByText(fmt(pctUltimo)).length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(`ago/2026 ${fmt(pctPrimeiro).replace(",", ",")}`))).toBeTruthy();
    expect(pctUltimo).toBeGreaterThan(pctPrimeiro); // sobe, então vai de verde com ▲
    expect(screen.getByText("▲")).toBeTruthy();
  });

  it("mantém importação, filtro de plataforma e lista pedido a pedido", () => {
    withData();
    expect(screen.getByRole("button", { name: /Importar/ })).toBeTruthy();
    expect(screen.getAllByText("Plataforma").length).toBeGreaterThan(0);
    expect(screen.getByText("Pedido a pedido")).toBeTruthy();
    expect(screen.getByText("Arquivos importados")).toBeTruthy();
  });

  it("mostra a composição com o terceiro tipo quando o arquivo não classifica", () => {
    withData();
    expect(screen.getByText("Sem tipo no arquivo")).toBeTruthy();
    expect(screen.getByText(/Chargeback sem reembolso não entra na base/)).toBeTruthy();
  });

  // O seletor de período substituiu o select de "Mês": ele faz o mesmo em um
  // clique (atalhos por mês) e ainda permite o recorte dia a dia, que é o que o
  // gestor precisa para reproduzir a janela exata de um relatório.
  it("tem seletor de período com calendário e atalhos por mês", async () => {
    withData();
    const botao = screen.getByRole("button", { name: /Escolher o período/ });
    // sem escolha, mostra o intervalo real dos dados
    expect(botao.textContent).toContain("12/08/2026 – 16/09/2026");
    // o select de Mês não existe mais
    expect(screen.queryByText("Todos os meses importados")).toBeNull();

    fireEvent.click(botao);
    expect(await screen.findByText("Todo o período importado")).toBeTruthy();
    // um atalho por mês importado, vindos dos lotes da RPC
    const meses = new Set(fixture.imports.map((b) => b.month_ref.slice(0, 7)));
    for (const m of meses) {
      const [y, mm] = m.split("-");
      const nome = new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
      expect(screen.getAllByText((t) => t.includes(nome.slice(0, 3))).length).toBeGreaterThan(0);
    }
  });

  it("mostra estado vazio quando nada foi importado", () => {
    withData({
      ...fixture,
      imports: [],
      series: [],
      by_product_month: [],
      by_product: [],
      divergences: { total_count: 0, rows: [] },
    });
    expect(screen.getByText(/Nenhum reembolso externo de Cartpanda foi importado ainda/)).toBeTruthy();
  });

  it("mostra skeletons enquanto carrega", () => {
    queryResult.current = { data: undefined, isLoading: true, isError: false };
    const { container } = renderPage();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });
});
