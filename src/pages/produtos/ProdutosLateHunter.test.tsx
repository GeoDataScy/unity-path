import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import ProdutosLateHunter from "./ProdutosLateHunter";
import type { LateHunterFiltros, LateHunterOrder, LateHunterOverview } from "@/features/late-hunter/types";

// A tela é testada pelo que ela PEDE ao banco: cada filtro, gráfico e página
// vira argumento da RPC late_hunter_list. As RPCs têm teste próprio em SQL.

const overviewResult = vi.hoisted(() => ({ current: undefined as unknown }));
const listCalls = vi.hoisted(() => [] as { ambiente: string; filtros: LateHunterFiltros; pagina: number; porPagina: number }[]);
const listResult = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("@/features/late-hunter/useLateHunterQueries", () => ({
  useLateHunterOverviewQuery: () => overviewResult.current,
  useLateHunterListQuery: (ambiente: string, filtros: LateHunterFiltros, pagina: number, porPagina: number) => {
    listCalls.push({ ambiente, filtros, pagina, porPagina });
    return listResult.current;
  },
  useLateHunterHistoryQuery: () => ({ data: [{ evento: "criado", referencia: "2026-09-16", ocorrido_em: "" }], isLoading: false }),
  fetchLateHunterList: vi.fn(),
  listArgs: vi.fn(),
}));

vi.mock("@/features/late-hunter/exportLateHunter", () => ({ exportLateHunter: vi.fn(async () => 3) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// recharts mede o container (0×0 no jsdom); o gráfico de fila não é o alvo aqui.
vi.mock("recharts", async (orig) => {
  const mod = await orig<typeof import("recharts")>();
  return { ...mod, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

function order(o: Partial<LateHunterOrder> = {}): LateHunterOrder {
  return {
    id: 1,
    pedido: "B10Z3955",
    loja: "DSA044",
    loja_nome: "Feilaira",
    motivo: "address-verification-failed, Held for Bad Address",
    motivos: ["address-verification-failed", "Held for Bad Address"],
    cliente_nome: "David stookey",
    cliente_email: "drlstookey@comcast.net",
    data_pedido: "2026-09-16",
    dias_em_espera: 45,
    itens: "6299-VRTYBLND-104 x 2",
    endereco: { logradouro: "SE Green Mountain Rd", cidade: "Brothers", estado: "OR", pais: "US", cep: "97712" },
    pais: "US",
    situacao: "aberto",
    motivo_encerramento: null,
    encerrado_em: null,
    encerrado_referencia: null,
    primeira_referencia: "2026-09-16",
    ultima_referencia: "2026-10-01",
    vezes_reaberto: 1,
    atualizado_em: "2026-10-02T02:00:00Z",
    ...o,
  };
}

const OVERVIEW: LateHunterOverview = {
  ultimo_sync: {
    ambiente: "producao",
    fonte: "walle",
    referencia: "2026-10-01",
    gerado_em: "2026-10-02T02:00:00Z",
    completo: true,
    pagina: 1,
    total_paginas: 1,
    recebidos: 547,
    criados: 40,
    atualizados: 500,
    reabertos: 2,
    inalterados: 5,
    encerrados: 30,
    rejeitados: [],
    encerramento: "aplicado",
    abertos_apos: 547,
    recebido_em: new Date().toISOString(),
  },
  kpis: {
    abertos: 547,
    encerrados: 120,
    mais_30_dias: 80,
    reabertos_abertos: 6,
    mediana_dias: 5,
    p90_dias: 41,
    entraram_ultimo: 42,
    sairam_ultimo: 30,
    clientes_abertos: 530,
  },
  envelhecimento: { "0-3": 200, "4-7": 150, "8-14": 70, "15-30": 47, "31-60": 50, "60+": 30 },
  fluxo: [
    { referencia: "2026-09-30", abertos: 535, entraram: 30, sairam: 25 },
    { referencia: "2026-10-01", abertos: 547, entraram: 42, sairam: 30 },
  ],
  motivos: [
    { motivo: "Held for Bad Address", abertos: 460, total: 560 },
    { motivo: "Held for Order Age", abertos: 40, total: 50 },
  ],
  lojas: [
    { loja: "DSA024", loja_nome: "Feilaira", abertos: 70, total: 90, mais_30_dias: 12 },
    { loja: "DSA044", loja_nome: null, abertos: 20, total: 25, mais_30_dias: 0 },
  ],
  paises: [{ pais: "US", abertos: 460, total: 560 }],
};

const ultimaChamada = () => listCalls[listCalls.length - 1];

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
  proto.scrollIntoView = () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  listCalls.length = 0;
  overviewResult.current = { data: OVERVIEW, isLoading: false, isError: false };
  listResult.current = {
    data: { total: 120, rows: [order(), order({ id: 2, pedido: "1066", loja: "DSA023", dias_em_espera: 3, vezes_reaberto: 0 })] },
    isLoading: false,
    isError: false,
    isFetching: false,
  };
});

describe("ProdutosLateHunter", () => {
  it("abre na fila em on-hold, mais antigos primeiro, em produção", () => {
    render(<ProdutosLateHunter />);
    const c = ultimaChamada();
    expect(c.ambiente).toBe("producao");
    expect(c.filtros.situacao).toBe("aberto");
    expect(c.filtros.ordem).toBe("dias_desc");
    expect(c.pagina).toBe(1);
    expect(screen.getByText("Sync em dia")).toBeInTheDocument();
    expect(screen.getByText("547", { selector: "div" })).toBeInTheDocument();
  });

  it("clicar numa faixa do envelhecimento filtra a tabela por aqueles dias", () => {
    render(<ProdutosLateHunter />);
    fireEvent.click(screen.getByRole("listitem", { name: /31–60: 50 pedidos/ }));
    expect(ultimaChamada().filtros).toMatchObject({ diasMin: 31, diasMax: 60 });
    // segundo clique desliga
    fireEvent.click(screen.getByRole("listitem", { name: /31–60/ }));
    expect(ultimaChamada().filtros).toMatchObject({ diasMin: null, diasMax: null });
  });

  it("o cartão 'há mais de 30 dias' é atalho do mesmo filtro", () => {
    render(<ProdutosLateHunter />);
    fireEvent.click(screen.getByRole("button", { name: /Há mais de 30 dias/ }));
    expect(ultimaChamada().filtros).toMatchObject({ diasMin: 31, diasMax: null });
  });

  it("clicar num motivo ou numa loja filtra a tabela", () => {
    render(<ProdutosLateHunter />);
    fireEvent.click(within(screen.getByRole("list", { name: "Motivos do on-hold" })).getByRole("button", { name: /Endereço inválido/ }));
    fireEvent.click(within(screen.getByRole("list", { name: "Lojas" })).getByRole("button", { name: /DSA024/ }));
    expect(ultimaChamada().filtros.motivos).toEqual(["Held for Bad Address"]);
    expect(ultimaChamada().filtros.lojas).toEqual(["DSA024"]);
  });

  it("gráfico clicado com 'Saíram' selecionado volta para a fila em on-hold", () => {
    render(<ProdutosLateHunter />);
    fireEvent.click(screen.getByRole("button", { name: "Saíram" }));
    expect(ultimaChamada().filtros.situacao).toBe("encerrado");
    fireEvent.click(within(screen.getByRole("list", { name: "Lojas" })).getByRole("button", { name: /DSA024/ }));
    expect(ultimaChamada().filtros.situacao).toBe("aberto");
  });

  it("trocar de página pede a página nova; mudar filtro volta para a 1", () => {
    render(<ProdutosLateHunter />);
    fireEvent.click(screen.getByRole("link", { name: "2" }));
    expect(ultimaChamada().pagina).toBe(2);
    fireEvent.click(screen.getByRole("switch"));
    expect(ultimaChamada().filtros.reabertos).toBe(true);
    expect(ultimaChamada().pagina).toBe(1);
  });

  it("data digitada pela metade não vira filtro", () => {
    render(<ProdutosLateHunter />);
    fireEvent.change(screen.getByLabelText("Pedido de"), { target: { value: "0002-10-02" } });
    expect(ultimaChamada().filtros.dataDe).toBeNull();
    fireEvent.change(screen.getByLabelText("Pedido de"), { target: { value: "2026-09-01" } });
    expect(ultimaChamada().filtros.dataDe).toBe("2026-09-01");
  });

  it("destaca quem está há mais de 30 dias e quem voltou ao hold", () => {
    render(<ProdutosLateHunter />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("voltou 1×")).toBeInTheDocument();
    expect(within(table).getByText("45").className).toMatch(/text-warning/);
    expect(within(table).getByText("3").className).not.toMatch(/text-warning/);
  });

  it("clicar no pedido abre o detalhe com endereço, itens e linha do tempo", () => {
    render(<ProdutosLateHunter />);
    fireEvent.click(screen.getByRole("row", { name: /Abrir pedido B10Z3955/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("SE Green Mountain Rd · Brothers, OR 97712 · US")).toBeInTheDocument();
    expect(within(dialog).getByText("VRTYBLND")).toBeInTheDocument();
    expect(within(dialog).getByText("Entrou no on-hold")).toBeInTheDocument();
  });

  it("sem nenhum lote, explica que está esperando o Late Hunter", () => {
    overviewResult.current = { data: { ...OVERVIEW, ultimo_sync: null }, isLoading: false, isError: false };
    render(<ProdutosLateHunter />);
    expect(screen.getByText(/Nenhum lote recebido/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("sync parado há mais de 30 h avisa que está atrasado", () => {
    overviewResult.current = {
      data: { ...OVERVIEW, ultimo_sync: { ...OVERVIEW.ultimo_sync!, recebido_em: "2026-01-01T02:00:00Z" } },
      isLoading: false,
      isError: false,
    };
    render(<ProdutosLateHunter />);
    expect(screen.getByText("Sync atrasado")).toBeInTheDocument();
  });
});
