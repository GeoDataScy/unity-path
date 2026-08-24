import { useEffect, useMemo, useState } from "react";

export type PanelPaginationState<T> = {
  pagina: number;
  setPagina: (p: number) => void;
  totalPaginas: number;
  /** Fatia da página atual — é isso que o painel renderiza. */
  visiveis: T[];
  total: number;
  /** Posição do primeiro/último item da página na lista inteira (1-based, p/ "12–24 de 87"). */
  inicio: number;
  fim: number;
};

/**
 * Paginação client-side dos painéis da Base de Suporte.
 *
 * A lista inteira já vem no cache (conteúdo editorial, poucos KB) — paginar aqui
 * é sobre não jogar 80 cards na tela de uma vez, não sobre tráfego.
 *
 * `resetKey` é a assinatura dos filtros do painel (busca + selects). Quando ela
 * muda a paginação volta para a página 1: sem isso, quem estava na página 4 e
 * digitava uma busca caía num resultado do meio da lista nova.
 */
export function usePanelPagination<T>(
  itens: T[],
  porPagina: number,
  resetKey: string,
): PanelPaginationState<T> {
  const [pagina, setPagina] = useState(1);

  const totalPaginas = Math.max(1, Math.ceil(itens.length / porPagina));

  useEffect(() => {
    setPagina(1);
  }, [resetKey, porPagina]);

  // Rede de segurança para a lista encolher sem o filtro mudar (ex.: a gestora
  // desativou um produto e o refetch chegou): página fora do range vira a última.
  useEffect(() => {
    setPagina((p) => Math.min(p, totalPaginas));
  }, [totalPaginas]);

  const visiveis = useMemo(() => {
    const offset = (pagina - 1) * porPagina;
    return itens.slice(offset, offset + porPagina);
  }, [itens, pagina, porPagina]);

  return {
    pagina,
    setPagina,
    totalPaginas,
    visiveis,
    total: itens.length,
    inicio: itens.length === 0 ? 0 : (pagina - 1) * porPagina + 1,
    fim: Math.min(pagina * porPagina, itens.length),
  };
}

/** Janela de no máximo 5 números ao redor da página atual, com "…" nas pontas. */
export function paginasVisiveis(pagina: number, totalPaginas: number): Array<number | "gap"> {
  if (totalPaginas <= 7) {
    return Array.from({ length: totalPaginas }, (_, i) => i + 1);
  }

  const janela = new Set<number>([1, totalPaginas, pagina]);
  for (const delta of [-2, -1, 1, 2]) {
    const p = pagina + delta;
    if (p > 1 && p < totalPaginas) janela.add(p);
  }

  const ordenadas = [...janela].sort((a, b) => a - b);
  const saida: Array<number | "gap"> = [];
  let anterior = 0;
  for (const p of ordenadas) {
    // Vão de exatamente uma página vira o número, não "…": reticências no lugar
    // de um único botão só escondem para onde dá para clicar.
    if (anterior && p - anterior === 2) saida.push(p - 1);
    else if (anterior && p - anterior > 2) saida.push("gap");
    saida.push(p);
    anterior = p;
  }
  return saida;
}
