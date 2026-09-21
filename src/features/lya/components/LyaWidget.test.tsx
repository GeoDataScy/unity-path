import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { LyaContexto } from "../types";
import { LyaWidget } from "./LyaWidget";

// O balão fala com a Edge Function e com os RPCs do histórico; aqui só
// interessa o que ele faz com o id da conversa.
const salvos: { id: string; n: number }[] = [];

vi.mock("../api", () => ({
  streamLyaChat: vi.fn(async ({ onEvent }: { onEvent: (e: unknown) => void }) => {
    onEvent({ type: "token", text: "Tivemos 42 atendimentos." });
    onEvent({ type: "done" });
  }),
  lyaSaveChat: vi.fn(async (id: string, mensagens: unknown[]) => {
    salvos.push({ id, n: mensagens.length });
    return { id, titulo: "t", criado_em: "", atualizado_em: "", mensagens: mensagens.length };
  }),
  lyaListChats: vi.fn(async () => []),
  lyaGetChat: vi.fn(async () => null),
  lyaDeleteChat: vi.fn(async () => undefined),
}));

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/dashboard/atendimentos"]}>
          <LyaWidget contexto={{} as LyaContexto} />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const UUID = /^\/dashboard\/lya\?chat=[0-9a-f-]{36}$/;

describe("LyaWidget", () => {
  beforeEach(() => {
    salvos.length = 0;
  });

  it("sem conversa, expandir abre a tela cheia limpa", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Perguntar à Lya" }));
    expect(screen.getByTitle("Abrir em tela cheia")).toHaveAttribute("href", "/dashboard/lya");
  });

  it("depois de perguntar, expandir leva a conversa junto", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Perguntar à Lya" }));
    fireEvent.click(screen.getByRole("button", { name: /Quantos atendimentos/ }));

    await waitFor(() => expect(salvos.length).toBeGreaterThan(0));
    // O link só serve se apontar para a MESMA conversa que foi gravada.
    await waitFor(() => {
      const href = screen.getByTitle("Abrir em tela cheia").getAttribute("href") ?? "";
      expect(href).toMatch(UUID);
      expect(href).toContain(salvos[0].id);
    });
  });

  it("a conversa do balão vai para o histórico, não só para a sessão", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Perguntar à Lya" }));
    fireEvent.click(screen.getByRole("button", { name: /Quantos atendimentos/ }));
    await waitFor(() => expect(salvos.length).toBeGreaterThan(0));
    expect(salvos[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
