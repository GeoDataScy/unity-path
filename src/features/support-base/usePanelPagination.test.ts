import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { paginasVisiveis, usePanelPagination } from "./usePanelPagination";

const lista = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("usePanelPagination", () => {
  it("fatia a página atual e reporta a faixa mostrada", () => {
    const { result } = renderHook(() => usePanelPagination(lista(25), 12, "sem-filtro"));

    expect(result.current.visiveis).toEqual(lista(12));
    expect(result.current.totalPaginas).toBe(3);
    expect([result.current.inicio, result.current.fim]).toEqual([1, 12]);

    act(() => result.current.setPagina(3));

    expect(result.current.visiveis).toEqual([25]);
    expect([result.current.inicio, result.current.fim]).toEqual([25, 25]);
  });

  it("volta para a página 1 quando o filtro muda", () => {
    const { result, rerender } = renderHook(
      ({ itens, chave }: { itens: number[]; chave: string }) =>
        usePanelPagination(itens, 12, chave),
      { initialProps: { itens: lista(40), chave: "" } },
    );

    act(() => result.current.setPagina(3));
    expect(result.current.pagina).toBe(3);

    rerender({ itens: lista(5), chave: "busca" });
    expect(result.current.pagina).toBe(1);
    expect(result.current.visiveis).toEqual(lista(5));
  });

  it("clampa a página quando a lista encolhe sem o filtro mudar", () => {
    const { result, rerender } = renderHook(
      ({ itens }: { itens: number[] }) => usePanelPagination(itens, 12, "fixo"),
      { initialProps: { itens: lista(40) } },
    );

    act(() => result.current.setPagina(4));
    expect(result.current.pagina).toBe(4);

    rerender({ itens: lista(14) });
    expect(result.current.pagina).toBe(2);
    expect(result.current.visiveis).toEqual([13, 14]);
  });

  it("lista vazia continua numa página válida, sem faixa", () => {
    const { result } = renderHook(() => usePanelPagination([], 12, "vazio"));

    expect(result.current.totalPaginas).toBe(1);
    expect(result.current.total).toBe(0);
    expect([result.current.inicio, result.current.fim]).toEqual([0, 0]);
  });
});

describe("paginasVisiveis", () => {
  it("lista tudo sem reticências até 7 páginas", () => {
    expect(paginasVisiveis(1, 1)).toEqual([1]);
    expect(paginasVisiveis(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("mantém primeira, última e a janela ao redor da atual", () => {
    expect(paginasVisiveis(1, 20)).toEqual([1, 2, 3, "gap", 20]);
    expect(paginasVisiveis(10, 20)).toEqual([1, "gap", 8, 9, 10, 11, 12, "gap", 20]);
    expect(paginasVisiveis(20, 20)).toEqual([1, "gap", 18, 19, 20]);
  });

  it("preenche o número em vez de abrir reticências para um vão de uma página", () => {
    // Janela {1,2,3,4,5,6,8} deixaria só a 7 de fora — vira número, não "…".
    expect(paginasVisiveis(4, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
