import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ChannelEfficiencyCard } from "./ChannelEfficiencyCard";
import type {
  ChannelEfficiencyRow,
  ChannelEfficiencyTotal,
} from "@/features/dashboard/useDashboardRefundMetricsQuery";

// Números de agosto/2026 em produção (conferidos direto na tabela refunds).
const rows: ChannelEfficiencyRow[] = [
  { channel: "Clickbank", total_done: 4, partial_count: 4, full_count: 0, partial_rate: 100, full_rate: 0, partial_share: 1, full_share: 0, efficiency_score: 100 },
  { channel: "SMS", total_done: 110, partial_count: 103, full_count: 7, partial_rate: 93.6, full_rate: 6.4, partial_share: 25.8, full_share: 21.9, efficiency_score: 93.6 },
  { channel: "Email", total_done: 310, partial_count: 290, full_count: 20, partial_rate: 93.5, full_rate: 6.5, partial_share: 72.5, full_share: 62.5, efficiency_score: 93.5 },
  { channel: "Não informado", total_done: 8, partial_count: 3, full_count: 5, partial_rate: 37.5, full_rate: 62.5, partial_share: 0.8, full_share: 15.6, efficiency_score: 37.5 },
];
const total: ChannelEfficiencyTotal = { total_done: 432, partial_count: 400, full_count: 32, partial_rate: 92.6, full_rate: 7.4 };

describe("ChannelEfficiencyCard", () => {
  // jsdom não tem ResizeObserver; o ResponsiveContainer do recharts exige um.
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("mostra as quatro taxas por canal e a linha de todos os canais", () => {
    render(<ChannelEfficiencyCard rows={rows} total={total} isLoading={false} />);

    const email = screen.getByRole("row", { name: /^Email/ });
    const cells = within(email).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(["Email", "310", "290", "72,5%", "20", "62,5%", "93,5%", "6,5%"]);

    const todos = screen.getByRole("row", { name: /^Todos os canais/ });
    const totalCells = within(todos).getAllByRole("cell").map((c) => c.textContent);
    expect(totalCells).toEqual(["Todos os canais", "432", "400", "—", "32", "—", "92,6%", "7,4%"]);
  });

  it("não inventa linha de total quando só há um canal", () => {
    render(<ChannelEfficiencyCard rows={[rows[2]]} total={{ ...total, total_done: 310 }} isLoading={false} />);
    expect(screen.queryByText("Todos os canais")).toBeNull();
  });

  it("mostra estado vazio sem dados", () => {
    render(<ChannelEfficiencyCard rows={[]} total={null} isLoading={false} />);
    expect(screen.getByText("Nenhum dado encontrado neste período")).toBeTruthy();
  });
});
