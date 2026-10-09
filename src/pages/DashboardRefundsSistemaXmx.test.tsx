import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";

import DashboardRefundsSistemaXmx from "./DashboardRefundsSistemaXmx";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useOutletContext: () => ({ fromISO: "2026-10-08", toISO: "2026-10-08" }) };
});

const resultado = {
  distribution: [
    { key: "buygoods", count: 187, total: 169, parcial: 18, pct: 72.8 },
    { key: "pagamerican", count: 38, total: 4, parcial: 34, pct: 14.8 },
    { key: "cartpanda", count: 29, total: 12, parcial: 17, pct: 11.3 },
  ],
  series: [
    { bucket: "2026-10-08", key: "buygoods", count: 187 },
    { bucket: "2026-10-08", key: "pagamerican", count: 38 },
    { bucket: "2026-10-08", key: "cartpanda", count: 29 },
  ],
  total: 254,
  kinds: { total: 185, parcial: 69 },
  platforms: ["buygoods", "cartpanda", "pagamerican"],
  group_by: "day",
  last_sync_at: "2026-10-09T16:18:52-03:00",
  last_status: "ok",
  backfill_done: true,
};

const useXmxRefundsQuery = vi.fn();
vi.mock("@/features/xmx-vendas/useXmxRefundsQuery", () => ({
  useXmxRefundsQuery: (args: unknown) => useXmxRefundsQuery(args),
}));

function renderTela() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/reembolsos/sistema-xmx"]}>
      <DashboardRefundsSistemaXmx />
    </MemoryRouter>,
  );
}

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
});

describe("DashboardRefundsSistemaXmx", () => {
  it("mostra as três abas de reembolsos com a do sistema XMX ativa", () => {
    useXmxRefundsQuery.mockReturnValue({ data: resultado, isLoading: false, isError: false });
    renderTela();
    expect(screen.getByRole("link", { name: "Visão geral" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Comparativo com reembolso externo" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Comparativo sistema XMX" }).getAttribute("aria-current")).toBe("page");
  });

  it("legenda da rosca no formato Plataforma - N (x.x%), da maior para a menor", () => {
    useXmxRefundsQuery.mockReturnValue({ data: resultado, isLoading: false, isError: false });
    renderTela();
    const itens = screen.getAllByText(/ - \d+ \(\d+\.\d%\)$/).map((el) => el.textContent);
    expect(itens).toEqual(["BuyGoods - 187 (72.8%)", "PagAmerican - 38 (14.8%)", "Cartpanda - 29 (11.3%)"]);
    expect(screen.getByText("Distribuição dos Reembolsos")).toBeTruthy();
    expect(screen.getByText("Agrupar por:")).toBeTruthy();
    expect(screen.getByText(/Atualizado em \d\d\/\d\d às \d\d:\d\d/)).toBeTruthy();
  });

  it("pede o período e o agrupamento à RPC", () => {
    useXmxRefundsQuery.mockReturnValue({ data: resultado, isLoading: false, isError: false });
    renderTela();
    expect(useXmxRefundsQuery).toHaveBeenLastCalledWith({
      from: "2026-10-08",
      to: "2026-10-08",
      groupBy: "day",
      platform: "all",
    });
  });

  it("avisa quando ainda não houve sincronização", () => {
    useXmxRefundsQuery.mockReturnValue({
      data: { ...resultado, distribution: [], series: [], total: 0, platforms: [], last_sync_at: null },
      isLoading: false,
      isError: false,
    });
    renderTela();
    expect(screen.getAllByText("Aguardando a primeira sincronização com o sistema XMX.")).toHaveLength(2);
  });
});
