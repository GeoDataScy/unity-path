import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import AreaSelect from "./AreaSelect";

// Gestora, copy e produtos veem os mesmos três cards; cada um só entra onde o
// perfil permite. O card sem acesso avisa "Acesso negado" e a pessoa fica em /areas.

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
    expect(toastError).not.toHaveBeenCalled();
  });

  it("a gestora vê os três cards e entra em Produtos", async () => {
    perfil.role = "manager";
    renderTela();
    fireEvent.click(await screen.findByLabelText("Entrar na Área de Produtos"));
    expect(await screen.findByText("tela produtos")).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("AreaSelect — time de copy", () => {
  beforeEach(() => {
    toastError.mockClear();
    perfil.role = "copy_grup";
  });

  it("vê os três cards, mas Data Analytics e Produtos dão acesso negado", async () => {
    renderTela();
    fireEvent.click(await screen.findByLabelText("Entrar na Data Analytics do Suporte"));
    fireEvent.click(screen.getByLabelText("Entrar na Área de Produtos"));
    expect(toastError).toHaveBeenCalledTimes(2);
    expect(toastError.mock.calls.every((c) => c[0] === "Acesso negado")).toBe(true);
    expect(screen.queryByText("tela analytics")).toBeNull();
    expect(screen.queryByText("tela produtos")).toBeNull();
  });

  it("entra em Copy normalmente", async () => {
    renderTela();
    fireEvent.click(await screen.findByLabelText("Entrar na Área de Copy"));
    expect(await screen.findByText("tela copy")).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
  });
});
