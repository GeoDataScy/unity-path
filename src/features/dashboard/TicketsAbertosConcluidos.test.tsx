import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { TicketsAbertosConcluidos } from "./TicketsAbertosConcluidos";
import type { DailyTickets } from "./useDashboardDailyTicketsQuery";

const dados: DailyTickets = {
  by_day: [
    { day: "2026-09-01", opened: 421, closed: 204 },
    { day: "2026-09-02", opened: 405, closed: 92 },
    { day: "2026-09-06", opened: 0, closed: 0 },
  ],
  total_opened: 826,
  total_closed: 296,
};

describe("TicketsAbertosConcluidos", () => {
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

  it("mostra os dois totais do período, cada um com seu rótulo", () => {
    render(<TicketsAbertosConcluidos data={dados} isLoading={false} />);
    expect(screen.getByText("826")).toBeTruthy();
    expect(screen.getByText("abertos")).toBeTruthy();
    expect(screen.getByText("296")).toBeTruthy();
    expect(screen.getByText("concluídos")).toBeTruthy();
  });

  it("período sem nenhum ticket cai no estado vazio, não num gráfico de zeros", () => {
    render(
      <TicketsAbertosConcluidos
        data={{ by_day: [{ day: "2026-09-06", opened: 0, closed: 0 }], total_opened: 0, total_closed: 0 }}
        isLoading={false}
      />,
    );
    expect(screen.getByText("Nenhum ticket neste período")).toBeTruthy();
  });

  it("carregando, não mostra total nenhum", () => {
    render(<TicketsAbertosConcluidos data={undefined} isLoading />);
    expect(screen.queryByText("abertos")).toBeNull();
  });
});
