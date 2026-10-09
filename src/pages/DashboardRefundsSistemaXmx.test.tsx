import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import DashboardRefundsSistemaXmx from "./DashboardRefundsSistemaXmx";

describe("DashboardRefundsSistemaXmx", () => {
  it("mostra as três abas de reembolsos com a do sistema XMX ativa", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard/reembolsos/sistema-xmx"]}>
        <DashboardRefundsSistemaXmx />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Visão geral" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Comparativo com reembolso externo" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Comparativo sistema XMX" }).getAttribute("aria-current")).toBe("page");
  });
});
