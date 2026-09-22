import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  PX_POR_DIA,
  TicketsAbertosConcluidos,
  escalaY,
  larguraMinimaDoGrafico,
} from "./TicketsAbertosConcluidos";
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

const botao = (nome: RegExp) => screen.getByRole("button", { name: nome });

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

  it("a legenda é botão: clicar desliga a série e clicar de novo traz de volta", () => {
    render(<TicketsAbertosConcluidos data={dados} isLoading={false} />);

    const concluidos = botao(/^concluídos:/);
    expect(concluidos.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(concluidos);
    expect(botao(/^concluídos:/).getAttribute("aria-pressed")).toBe("false");
    // A outra série continua ligada — o clique é independente.
    expect(botao(/^abertos:/).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(botao(/^concluídos:/));
    expect(botao(/^concluídos:/).getAttribute("aria-pressed")).toBe("true");
  });

  it("desligar as duas séries cai num estado que o próprio usuário desfaz", () => {
    render(<TicketsAbertosConcluidos data={dados} isLoading={false} />);

    fireEvent.click(botao(/^abertos:/));
    fireEvent.click(botao(/^concluídos:/));

    expect(screen.getByText(/Nenhuma série selecionada/)).toBeTruthy();
    // Os botões seguem na tela: não é um beco sem saída.
    expect(botao(/^abertos:/)).toBeTruthy();
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

describe("larguraMinimaDoGrafico", () => {
  it("reserva a mesma faixa para cada dia, para todos caberem no eixo", () => {
    expect(larguraMinimaDoGrafico(7)).toBe(7 * PX_POR_DIA);
    // Dois meses: é aqui que a área passa a rolar em vez de espremer as barras.
    expect(larguraMinimaDoGrafico(61)).toBe(61 * PX_POR_DIA);
    expect(larguraMinimaDoGrafico(0)).toBe(0);
  });
});

describe("escalaY", () => {
  it("fecha o topo num número redondo acima do maior valor", () => {
    expect(escalaY(421)).toEqual({ topo: 500, ticks: [0, 100, 200, 300, 400, 500] });
    expect(escalaY(7)).toEqual({ topo: 8, ticks: [0, 2, 4, 6, 8] });
    expect(escalaY(1000)).toEqual({ topo: 1000, ticks: [0, 200, 400, 600, 800, 1000] });
  });

  it("só produz inteiros — a contagem de tickets não tem meia unidade", () => {
    for (let v = 1; v <= 60; v += 1) {
      const { topo, ticks } = escalaY(v);
      expect(topo).toBeGreaterThanOrEqual(v);
      expect(ticks.every(Number.isInteger)).toBe(true);
      expect(ticks[ticks.length - 1]).toBe(topo);
    }
  });

  it("sem valor (série desligada ou período vazio) não quebra a escala", () => {
    expect(escalaY(0)).toEqual({ topo: 1, ticks: [0, 1] });
    expect(escalaY(Number.NaN)).toEqual({ topo: 1, ticks: [0, 1] });
  });
});
