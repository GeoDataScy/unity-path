import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AreaSwitcher } from "./AreaSwitcher";
import type { AppArea, AreaGrants } from "@/lib/roles";

function renderSwitcher(role: string | null, currentArea: AppArea, collapsed = false, grants?: AreaGrants) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <AreaSwitcher role={role} currentArea={currentArea} collapsed={collapsed} grants={grants} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("AreaSwitcher", () => {
  it("oferece a área de copy para a gestora no analytics", () => {
    renderSwitcher("manager", "analytics");
    expect(screen.getByText("Ir para Copy")).toBeTruthy();
    expect(screen.getByText("Data Analytics")).toBeTruthy();
  });

  it("oferece copy e produtos para a gestora (ela entra em todas)", () => {
    renderSwitcher("manager", "analytics");
    expect(screen.getByText("Ir para Copy")).toBeTruthy();
    expect(screen.getByText("Ir para Produtos")).toBeTruthy();
  });

  it("não renderiza nada para o time de produtos (área única)", () => {
    const { container } = renderSwitcher("produto", "produtos");
    expect(container.firstChild).toBeNull();
  });

  it("não renderiza nada para o copy (só entra em Copy)", () => {
    const { container } = renderSwitcher("copy_grup", "copy");
    expect(container.firstChild).toBeNull();
  });

  it("não renderiza nada para o agente", () => {
    const { container } = renderSwitcher("agent", "workspace");
    expect(container.firstChild).toBeNull();
  });

  it("não renderiza nada para role desconhecida", () => {
    const { container } = renderSwitcher(null, "workspace");
    expect(container.firstChild).toBeNull();
  });

  it("sem a flag, ninguém vê Análises — nem a gestora", () => {
    renderSwitcher("manager", "analytics");
    expect(screen.queryByText("Ir para Análises")).toBeNull();
  });

  it("com can_view_geovani_analyses, oferece Análises à gestora", () => {
    renderSwitcher("manager", "analytics", false, { canViewGeovaniAnalyses: true });
    expect(screen.getByText("Ir para Análises")).toBeTruthy();
  });

  it("produtos com a flag passa a ver o switcher só com Análises", () => {
    renderSwitcher("produto", "produtos", false, { canViewGeovaniAnalyses: true });
    expect(screen.getByText("Ir para Análises")).toBeTruthy();
    expect(screen.queryByText("Ir para Copy")).toBeNull();
  });

  it("colapsado vira botão de ícone com aria-label", () => {
    renderSwitcher("manager", "analytics", true);
    expect(screen.getByLabelText("Ir para Copy")).toBeTruthy();
  });
});
