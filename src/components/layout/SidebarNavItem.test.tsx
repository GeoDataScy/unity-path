import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarNavItem } from "./SidebarNavItem";

function renderItem(props: Partial<Parameters<typeof SidebarNavItem>[0]> = {}, rota = "/dashboard/lya") {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <TooltipProvider>
        <SidebarNavItem to="/dashboard/lya" end collapsed={false} icon={<span data-testid="icone" />} label="Lya" {...props} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("SidebarNavItem", () => {
  // O bug que motivou o componente: recolhido, o item entra num
  // `TooltipTrigger asChild` e o Slot do Radix serializa um `className` em
  // forma de função para dentro do atributo `class`. O item ficava sem estilo
  // nenhum — sem centralizar, sem marcar a página atual, e o badge solto.
  it("recolhido, aplica classes de verdade em vez da função serializada", () => {
    renderItem({ collapsed: true });
    const link = screen.getByRole("link");
    expect(link.className).not.toContain("=>");
    expect(link.className).not.toContain("isActive");
    expect(link.className).toContain("w-9");
  });

  it("marca a página atual nos dois estados", () => {
    const { unmount } = renderItem({ collapsed: true });
    expect(screen.getByRole("link").className).toContain("bg-white/15");
    unmount();

    renderItem({ collapsed: false });
    expect(screen.getByRole("link").className).toContain("bg-white/15");
  });

  it("não marca quando a rota é outra", () => {
    renderItem({ collapsed: true }, "/dashboard/reembolsos");
    expect(screen.getByRole("link").className).not.toContain("bg-white/15");
  });

  it("casa rotas filhas quando não é `end`", () => {
    renderItem({ to: "/dashboard/reembolsos", end: false }, "/dashboard/reembolsos/comparativo");
    expect(screen.getByRole("link").className).toContain("bg-white/15");
  });

  it("recolhido, o badge fica dentro do slot do ícone — é ele que ancora", () => {
    renderItem({ collapsed: true, badge: <span data-testid="badge" /> });
    const slot = screen.getByTestId("icone").parentElement!;
    expect(slot.className).toContain("relative");
    expect(slot).toContainElement(screen.getByTestId("badge"));
  });

  it("expandido, o badge fica ao lado do rótulo, fora do slot", () => {
    renderItem({ collapsed: false, badge: <span data-testid="badge" /> });
    const slot = screen.getByTestId("icone").parentElement!;
    expect(slot).not.toContainElement(screen.getByTestId("badge"));
    expect(screen.getByText("Lya")).toBeTruthy();
  });
});
