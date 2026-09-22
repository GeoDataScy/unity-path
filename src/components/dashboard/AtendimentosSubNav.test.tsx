import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AtendimentosSubNav } from "./AtendimentosSubNav";

function renderNav(rota: string) {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <AtendimentosSubNav />
    </MemoryRouter>,
  );
}

describe("AtendimentosSubNav", () => {
  it("em /dashboard marca a performance por agente", () => {
    renderNav("/dashboard");
    expect(screen.getByRole("link", { name: "Performance por agente" }).className).toContain("bg-background");
    expect(screen.getByRole("link", { name: "Visão Geral Atendimentos" }).className).not.toContain("bg-background");
  });

  it("na visão geral, a aba da performance solta o destaque", () => {
    renderNav("/dashboard/visao-geral");
    expect(screen.getByRole("link", { name: "Visão Geral Atendimentos" }).className).toContain("bg-background");
    expect(screen.getByRole("link", { name: "Performance por agente" }).className).not.toContain("bg-background");
  });
});
