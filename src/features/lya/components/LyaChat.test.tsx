import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { LyaContexto } from "../types";
import { LyaChat } from "./LyaChat";

const pedidos: string[] = [];

vi.mock("../api", () => ({
  streamLyaChat: vi.fn(async () => {}),
  lyaSaveChat: vi.fn(async (id: string) => ({ id, titulo: "t", criado_em: "", atualizado_em: "", mensagens: 0 })),
  lyaListChats: vi.fn(async () => [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", titulo: "Vinda do balão", criado_em: "", atualizado_em: new Date().toISOString(), mensagens: 2 },
  ]),
  lyaGetChat: vi.fn(async (id: string) => {
    pedidos.push(id);
    return {
      id,
      titulo: "Vinda do balão",
      criado_em: "",
      atualizado_em: "",
      mensagens: [
        { ordem: 0, role: "user", content: "Quantos atendimentos tivemos?" },
        { ordem: 1, role: "assistant", content: "Tivemos 42 atendimentos." },
      ],
    };
  }),
  lyaDeleteChat: vi.fn(async () => undefined),
}));

describe("LyaChat recebendo a conversa do balão", () => {
  it("abre a conversa que veio no ?chat= e mostra o que já foi dito", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <MemoryRouter>
            <LyaChat contexto={{} as LyaContexto} canTrain firstName="Geovani" initialChatId={id} />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(pedidos).toContain(id));
    expect(await screen.findByText("Tivemos 42 atendimentos.")).toBeInTheDocument();
  });
});
