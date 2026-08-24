import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupportProduct, SupportSmsBrand, SupportSmsReply } from "../types";

// A tela é 100% leitura de conteúdo do Supabase; mockar os hooks de query deixa o
// teste sobre o que mudou (navegação, agrupamento das abas e paginação).
const mocks = vi.hoisted(() => ({
  produtos: [] as SupportProduct[],
  brands: [] as SupportSmsBrand[],
  respostas: [] as SupportSmsReply[],
}));

vi.mock("@/features/support-base/useSupportBaseQuery", () => ({
  useSupportProductsQuery: () => ({ data: mocks.produtos, isLoading: false, isError: false }),
  useSupportSmsBrandsQuery: () => ({ data: mocks.brands, isLoading: false, isError: false }),
  useSupportSmsRepliesQuery: () => ({ data: mocks.respostas, isLoading: false, isError: false }),
}));

import { SupportBaseScreen } from "./SupportBaseScreen";

function produto(i: number): SupportProduct {
  return {
    id: `p${i}`,
    nome: `Produto ${i}`,
    funcao: null,
    url: `https://exemplo.com/p${i}`,
    estrutura: i % 2 === 0 ? "nova" : "antiga",
    plataforma: null,
    bonus_url: null,
    bonus_tipo: null,
    nicho: null,
    sms_number: null,
    links: [],
    ativo: true,
    sort_order: i,
  };
}

function renderTela(rota = "/workspace/base-suporte") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[rota]}>
        <SupportBaseScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Base de Suporte — tela de consulta (agente e copy)", () => {
  beforeEach(() => {
    mocks.produtos = Array.from({ length: 20 }, (_, i) => produto(i + 1));
    mocks.brands = [];
    mocks.respostas = [];
  });

  it("abre em Produtos (E-mail) com as abas agrupadas por tipo de conteúdo", () => {
    renderTela();

    expect(screen.getByRole("heading", { level: 1, name: "Base de Suporte" })).toBeInTheDocument();
    for (const grupo of ["Catálogo", "Mensagens prontas", "Procedimento"]) {
      expect(screen.getByText(grupo)).toBeInTheDocument();
    }
    expect(screen.getByRole("tab", { name: /Produtos \(E-mail\)/ })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  it("pagina a lista em 12 por página e navega para a página seguinte", () => {
    renderTela();

    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(12);
    expect(screen.getByText("1–12")).toBeInTheDocument();
    expect(screen.getByText(/de 20 produtos/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Go to next page|Próxima|Next/i }));

    expect(screen.getByText("13–20")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(8);
  });

  it("filtrar por estrutura volta para a primeira página", () => {
    renderTela();

    fireEvent.click(screen.getByRole("link", { name: "2" }));
    expect(screen.getByText("13–20")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /^Nova/ }));

    expect(screen.getByText("1–10")).toBeInTheDocument();
    expect(screen.getByText(/de 10 produtos/)).toBeInTheDocument();
  });

  it("respeita a aba vinda da URL", () => {
    renderTela("/workspace/base-suporte?aba=reembolso");

    expect(screen.getByRole("tab", { name: /Reembolso/ })).toHaveAttribute("data-state", "active");
    // O título aparece duas vezes: no índice "Ir para" e no cabeçalho da seção.
    expect(screen.getByRole("heading", { name: "Funil de reembolso" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Funil de reembolso" })).toBeInTheDocument();
  });

  it("mostra o total de cada aba no rótulo", () => {
    renderTela();

    const aba = screen.getByRole("tab", { name: /Produtos \(E-mail\)/ });
    expect(within(aba).getByText("20")).toBeInTheDocument();
  });
});
