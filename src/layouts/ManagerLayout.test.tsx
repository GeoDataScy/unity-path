import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useOutletContext } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { ManagerOutletContext } from "./ManagerLayout";
import ManagerLayout from "./ManagerLayout";

// Quem está logado precisa ser quem a tela mostra. Até 21/09/2026 o layout
// gravava `"Ester"` para qualquer gestora — sobra de 30/04/2026, quando ela era
// a única. Com 11 contas de gestora, todo mundo era saudado como Ester, e o
// nome errado ainda ia no `usuario_nome` que a Lya recebe de contexto.

const perfil = { role: "manager", full_name: "Geovani Pinkman", can_approve_takeovers: false };

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: () => Promise.resolve({ data: perfil, error: null }),
  });
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: "u1" } } }, error: null }),
        getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
        signOut: async () => ({ error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      from: () => chain,
      rpc: async () => ({ data: { is_active: true }, error: null }),
    },
  };
});

vi.mock("@/lib/userSession", () => ({
  getMeStatus: async () => ({ is_active: true, reason: null }),
  recordAuthEvent: async () => {},
  sendHeartbeat: async () => {},
}));

vi.mock("@/lib/reportExport", () => ({ exportManagerReport: async () => {} }));
vi.mock("@/features/lya/components/LyaWidget", () => ({ LyaWidget: () => null }));
vi.mock("@/features/dashboard/ManagerRefundNotification", () => ({ ManagerRefundNotification: () => null }));
vi.mock("@/features/takeovers/ManagerApprovalsBell", () => ({ ManagerApprovalsBell: () => null }));

function Espiao() {
  const { fullName } = useOutletContext<ManagerOutletContext>();
  return <div data-testid="nome">{fullName ?? "(sem nome)"}</div>;
}

function renderLayout() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route path="/dashboard" element={<ManagerLayout />}>
              <Route index element={<Espiao />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("ManagerLayout — nome de quem está logado", () => {
  beforeEach(() => {
    perfil.full_name = "Geovani Pinkman";
  });

  it("usa o full_name do perfil, não um nome fixo no código", async () => {
    renderLayout();
    await waitFor(() => expect(screen.getByTestId("nome").textContent).toBe("Geovani Pinkman"));
    expect(screen.queryByText("Ester")).toBeNull();
  });

  it("não inventa nome quando o perfil não tem um", async () => {
    perfil.full_name = null as unknown as string;
    renderLayout();
    await waitFor(() => expect(screen.getByTestId("nome").textContent).toBe("(sem nome)"));
  });
});

// O botão de tema flutuava com `fixed top-4 right-4` por cima do conteúdo
// (cobria o seletor de ambiente do Late Hunter e cantos de cabeçalho). Agora
// mora na faixa de topo, no fluxo da página.
describe("ManagerLayout — controles de canto de tela", () => {
  it("o botão de tema fica na barra de topo, sem flutuar sobre a página", async () => {
    renderLayout();
    const toggle = await screen.findByRole("button", { name: /Mudar para modo/ });
    expect(screen.getByRole("banner").contains(toggle)).toBe(true);
    expect(toggle.className).not.toMatch(/\bfixed\b/);
  });
});
