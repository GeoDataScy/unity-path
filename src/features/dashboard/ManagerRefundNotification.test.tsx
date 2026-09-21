import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ManagerRefundNotification } from "./ManagerRefundNotification";

vi.mock("./useDashboardRefundAlertsQuery", () => ({
  useDashboardRefundAlertsQuery: () => ({
    data: {
      total_overdue: 1040,
      agents_affected: 16,
      by_agent: [{ agent_id: "1", agent_name: "Ana", overdue_count: 7, refunds: [] }],
    },
  }),
}));

describe("ManagerRefundNotification", () => {
  it("oferece só Ciente e Ver agentes — sem um terceiro jeito de dispensar", () => {
    render(<ManagerRefundNotification />);
    const card = screen.getByText("Reembolsos em atraso").closest("div.fixed") as HTMLElement;
    expect([...card.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual([
      "Ciente",
      "Ver agentes",
    ]);
    // O X do canto fazia exatamente o mesmo que o Ciente; se voltar, some daqui.
    expect(card.querySelector('[aria-label="Fechar"]')).toBeNull();
  });
});
