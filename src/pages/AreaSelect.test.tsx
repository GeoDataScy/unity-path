import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import AreaSelect from "./AreaSelect";

// O time de produtos vê os mesmos cards que os outros perfis, mas só entra em
// Produtos. Clicar em Data Analytics ou Copy avisa "Acesso negado" e fica em /areas.

const perfil = { role: "produto", full_name: "Teste Produtos" };

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: perfil, error: null }),
  });
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: "u1" } } }, error: null }),
        signOut: async () => ({ error: null }),
      },
      from: () => chain,
    },
  };
});

vi.mock("@/lib/userSession", () => ({
  getMeStatus: async () => ({ is_active: true, reason: null }),
  recordAuthEvent: async () => {},
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

function renderTela() {
  return render(
    <MemoryRouter initialEntries={["/areas"]}>
      <Routes>
        <Route path="/areas" element={<AreaSelect />} />
        <Route path="/dashboard" element={<div>tela analytics</div>} />
        <Route path="/copy" element={<div>tela copy</div>} />
        <Route path="/produtos" element={<div>tela produtos</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AreaSelect — time de produtos", () => {
  beforeEach(() => {
    toastError.mockClear();
    perfil.role = "produto";
  });

  it("mostra os três cards", async () => {
    renderTela();
    expect(await screen.findByLabelText("Entrar na Data Analytics do Suporte")).toBeTruthy();
    expect(screen.getByLabelText("Entrar na Área de Copy")).toBeTruthy();
    expect(screen.getByLabelText("Entrar na Área de Produtos")).toBeTruthy();
  });

  it("nega Data Analytics e Copy sem sair da tela", async () => {
    renderTela();
    fireEvent.click(await screen.findByLabelText("Entrar na Data Analytics do Suporte"));
    fireEvent.click(screen.getByLabelText("Entrar na Área de Copy"));

    expect(toastError).toHaveBeenCalledTimes(2);
    expect(toastError.mock.calls[0][0]).toBe("Acesso negado");
    expect(screen.queryByText("tela analytics")).toBeNull();
    expect(screen.queryByText("tela copy")).toBeNull();
  });

  it("entra em Produtos normalmente", async () => {
    renderTela();
    fireEvent.click(await screen.findByLabelText("Entrar na Área de Produtos"));
    expect(await screen.findByText("tela produtos")).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("a gestora continua entrando em Data Analytics sem aviso", async () => {
    perfil.role = "manager";
    renderTela();
    fireEvent.click(await screen.findByLabelText("Entrar na Data Analytics do Suporte"));
    expect(await screen.findByText("tela analytics")).toBeTruthy();
    expect(screen.queryByLabelText("Entrar na Área de Produtos")).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });
});
