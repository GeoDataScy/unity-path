import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardSistemaXmx from "./DashboardSistemaXmx";

let periodo = { fromISO: "2026-09-01", toISO: "2026-09-30" };
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useOutletContext: () => periodo };
});

// Recorte real de set/2026 (RPC rodada contra a cópia local do banco de vendas).
const resultado = {
  kpis: {
    orders: 54673,
    gross_usd: 16821768.28,
    ticket_usd: 307.68,
    refunds: 6449,
    refunds_total: 5167,
    refunds_parcial: 1282,
    refunds_usd: 1735891.4,
    refunds_with_amount: 6428,
    refund_rate: 9.1,
    chargebacks: 1057,
    chargebacks_usd: 421823.93,
    chargeback_rate: 1.49,
  },
  by_platform: [
    { key: "buygoods", orders: 28739, gross_usd: 7502786.04, refunds: 4297, chargebacks: 0, refund_rate: 11.6, chargeback_rate: 0 },
    { key: "pagamerican", orders: 13423, gross_usd: 4987669.27, refunds: 724, chargebacks: 384, refund_rate: 5.6, chargeback_rate: 3.18 },
  ],
  countries: [
    { country: "United States", orders: 51157, gross_usd: 15863068.37, refunds: 6009, chargebacks: 1035, refund_rate: 9.1, chargeback_rate: 1.56 },
    { country: "Outros", orders: 314, gross_usd: 76978.93, refunds: 71, chargebacks: 1, refund_rate: 19.7, chargeback_rate: 0.32 },
  ],
  sales_series: [
    { bucket: "2026-09-01", key: "buygoods", orders: 900, gross_usd: 230000 },
    { bucket: "2026-09-01", key: "pagamerican", orders: 400, gross_usd: 150000 },
  ],
  refunds_series: [{ bucket: "2026-09-01", key: "buygoods", count: 130 }],
  chargebacks_series: [{ bucket: "2026-09-01", key: "pagamerican", count: 12 }],
  rates_series: [{ bucket: "2026-09-01", orders: 1300, refund_rate: 10.6, chargeback_rate: 1.87 }],
  refund_reasons: [
    { reason: "Entrega ou rastreio", count: 475, pct: 33.4 },
    { reason: "Sem resultado ou insatisfeito", count: 212, pct: 14.9 },
  ],
  refunds_without_reason: 5027,
  refund_days: [
    { bucket: "0–7 dias", count: 2810 },
    { bucket: "8–14 dias", count: 930 },
  ],
  refund_days_median: 9.4,
  platforms: ["buygoods", "cartpanda", "pagamerican"],
  group_by: "day",
  sync: { last_sync_at: "2026-10-13T12:56:24-03:00", last_status: "ok", ready: true },
};

const useXmxSistemaQuery = vi.fn();
vi.mock("@/features/xmx-vendas/useXmxSistemaQuery", () => ({
  useXmxSistemaQuery: (args: unknown) => useXmxSistemaQuery(args),
}));

beforeAll(() => {
  // Recharts mede o contêiner; no jsdom não há layout.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  periodo = { fromISO: "2026-09-01", toISO: "2026-09-30" };
  useXmxSistemaQuery.mockReset();
  useXmxSistemaQuery.mockReturnValue({ data: resultado, isLoading: false, isError: false });
});

const renderTela = () =>
  render(
    <MemoryRouter>
      <DashboardSistemaXmx />
    </MemoryRouter>,
  );

describe("DashboardSistemaXmx", () => {
  it("mostra os quatro indicadores do período", () => {
    renderTela();
    expect(screen.getByRole("heading", { name: "Sistema XMX" })).toBeInTheDocument();
    expect(screen.getByText("54.673")).toBeInTheDocument();
    expect(screen.getByText("6.449")).toBeInTheDocument();
    expect(screen.getByText("1.057")).toBeInTheDocument();
    expect(screen.getByText(/9,1% dos pedidos/)).toBeInTheDocument();
    expect(screen.getByText(/1,49% dos pedidos/)).toBeInTheDocument();
  });

  it("visão geral traz a tabela por plataforma", () => {
    renderTela();
    const tabela = screen.getByRole("table");
    expect(within(tabela).getByText("BuyGoods")).toBeInTheDocument();
    expect(within(tabela).getByText("11,6%")).toBeInTheDocument();
  });

  it("aba Reembolsos mostra motivos e tempo até o reembolso", () => {
    renderTela();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Reembolsos" }));
    expect(screen.getByText("Entrega ou rastreio")).toBeInTheDocument();
    expect(screen.getByText(/Metade acontece em até 9 dias/)).toBeInTheDocument();
    expect(screen.getByText("5.167 integrais · 1.282 parciais")).toBeInTheDocument();
  });

  it("aba Países traduz o nome do país", () => {
    renderTela();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Países" }));
    expect(screen.getByText("Estados Unidos")).toBeInTheDocument();
    expect(screen.getByText("Outros países")).toBeInTheDocument();
  });

  it("pede a RPC com período, agrupamento e plataforma", () => {
    renderTela();
    expect(useXmxSistemaQuery).toHaveBeenCalledWith({ from: "2026-09-01", to: "2026-09-30", groupBy: "day", platform: "all" });
  });

  it("em período longo, 'Dias' fica bloqueado e o agrupamento vira mês", () => {
    periodo = { fromISO: "2025-01-01", toISO: "2026-09-30" };
    renderTela();
    expect(screen.getByRole("radio", { name: "Dias" })).toBeDisabled();
    expect(useXmxSistemaQuery).toHaveBeenLastCalledWith(expect.objectContaining({ groupBy: "month" }));
  });

  it("avisa quando a carga inicial ainda não terminou", () => {
    useXmxSistemaQuery.mockReturnValue({
      data: { ...resultado, sync: { ...resultado.sync, ready: false } },
      isLoading: false,
      isError: false,
    });
    renderTela();
    expect(screen.getByText(/Carga inicial em andamento/)).toBeInTheDocument();
  });

  it("mostra erro sem quebrar a tela", () => {
    useXmxSistemaQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderTela();
    expect(screen.getByText("Não foi possível carregar os dados do sistema XMX.")).toBeInTheDocument();
  });
});
