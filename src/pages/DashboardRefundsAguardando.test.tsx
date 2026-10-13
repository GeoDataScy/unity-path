import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import DashboardRefundsAguardando from "./DashboardRefundsAguardando";

describe("DashboardRefundsAguardando", () => {
  it("mostra que a plataforma ainda não está conectada", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard/reembolsos/cartpanda"]}>
        <DashboardRefundsAguardando plataforma="Cartpanda" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Reembolsos" })).toBeInTheDocument();
    expect(screen.getByText("Aguardando conexão com a plataforma Cartpanda.")).toBeInTheDocument();
  });

  it("traz as seis abas de Reembolsos, com a da plataforma ativa", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard/reembolsos/pagamerican"]}>
        <DashboardRefundsAguardando plataforma="PagAmerican" />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "Seções de reembolsos" });
    const abas = within(nav).getAllByRole("link").map((a) => a.textContent);
    expect(abas).toEqual([
      "Visão geral",
      "Comparativo com reembolso externo",
      "Sistema XMX",
      "Cartpanda",
      "Buygoods",
      "PagAmerican",
    ]);
    expect(within(nav).getByRole("link", { name: "PagAmerican" })).toHaveAttribute("aria-current", "page");
  });
});
