import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AreaSwitcher } from "./AreaSwitcher";
import type { AppArea } from "@/lib/roles";

function renderSwitcher(role: string | null, currentArea: AppArea, collapsed = false) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <AreaSwitcher role={role} currentArea={currentArea} collapsed={collapsed} />
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

  it("oferece o analytics para o copy na área dele", () => {
    renderSwitcher("copy_grup", "copy");
    expect(screen.getByText("Ir para Data Analytics")).toBeTruthy();
  });

  it("não renderiza nada para o agente", () => {
    const { container } = renderSwitcher("agent", "workspace");
    expect(container.firstChild).toBeNull();
  });

  it("não renderiza nada para role desconhecida", () => {
    const { container } = renderSwitcher(null, "workspace");
    expect(container.firstChild).toBeNull();
  });

  it("colapsado vira botão de ícone com aria-label", () => {
    renderSwitcher("manager", "analytics", true);
    expect(screen.getByLabelText("Ir para Copy")).toBeTruthy();
  });
});
