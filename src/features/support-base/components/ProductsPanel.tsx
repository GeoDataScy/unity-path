import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSupportProductsQuery } from "../useSupportBaseQuery";
import { usePanelPagination } from "../usePanelPagination";
import type { Estrutura } from "../types";
import { EstruturaFilter, TODOS, type EstruturaFiltro } from "./EstruturaFilter";
import { PanelEmpty, PanelError, PanelSkeleton } from "./PanelStates";
import { PanelPagination } from "./PanelPagination";
import { PanelToolbar } from "./PanelToolbar";
import { ProductCard } from "./ProductCard";

export function ProductsPanel() {
  const { data, isLoading, isError } = useSupportProductsQuery();
  const [busca, setBusca] = useState("");
  const [estrutura, setEstrutura] = useState<EstruturaFiltro>(TODOS);
  const [nicho, setNicho] = useState<string>(TODOS);
  const [porPagina, setPorPagina] = useState(12);

  // `?? []` dentro do useMemo: uma nova referência a cada render invalidaria os
  // memos de filtro abaixo sem que nada tenha mudado.
  const produtos = useMemo(() => data ?? [], [data]);

  const nichos = useMemo(
    () => [...new Set(produtos.map((p) => p.nicho).filter(Boolean))].sort() as string[],
    [produtos],
  );

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    return produtos.filter((p) => {
      const alvo = `${p.nome}${p.funcao ?? ""}${p.plataforma ?? ""}${p.nicho ?? ""}`.toLowerCase();
      return (
        (!q || alvo.includes(q)) &&
        (estrutura === TODOS || p.estrutura === estrutura) &&
        (nicho === TODOS || p.nicho === nicho)
      );
    });
  }, [produtos, busca, estrutura, nicho]);

  // Estrutura primeiro, nome depois: a lista paginada continua lendo agrupada
  // (nova antes de antiga) mesmo sem os cabeçalhos de seção.
  const ordenados = useMemo(
    () =>
      [...filtrados].sort(
        (a, b) =>
          Number(a.estrutura === "antiga") - Number(b.estrutura === "antiga") ||
          a.sort_order - b.sort_order ||
          a.nome.localeCompare(b.nome, "pt-BR"),
      ),
    [filtrados],
  );

  const paginacao = usePanelPagination(ordenados, porPagina, `${busca}|${estrutura}|${nicho}`);

  const contar = (alvo: Estrutura) => produtos.filter((p) => p.estrutura === alvo).length;
  const temFiltro = Boolean(busca) || estrutura !== TODOS || nicho !== TODOS;
  const limpar = () => {
    setBusca("");
    setEstrutura(TODOS);
    setNicho(TODOS);
  };

  if (isError) return <PanelError recurso="os produtos" />;

  return (
    <div className="space-y-4">
      <Alert className="border-warning/40 bg-warning-soft py-2.5 text-ink">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="text-xs leading-relaxed">
          <strong>Confira a estrutura antes de enviar links:</strong>{" "}
          <span className="font-medium">Nova</span> (lojas independentes) ou{" "}
          <span className="font-medium">Antiga</span> (CartPanda / ClickBank / Digistore). O selo
          aparece em cada card.
        </AlertDescription>
      </Alert>

      <PanelToolbar
        busca={busca}
        onBuscaChange={setBusca}
        placeholder="Buscar produto, função, plataforma ou nicho…"
      >
        <EstruturaFilter
          value={estrutura}
          onChange={setEstrutura}
          contagem={{ todos: produtos.length, nova: contar("nova"), antiga: contar("antiga") }}
        />

        <Select value={nicho} onValueChange={setNicho}>
          <SelectTrigger className="h-9 w-full bg-background sm:w-[180px]" aria-label="Nicho">
            <SelectValue placeholder="Nicho" />
          </SelectTrigger>
          <SelectContent className="z-50">
            <SelectItem value={TODOS}>Todos os nichos</SelectItem>
            {nichos.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelToolbar>

      {isLoading ? (
        <PanelSkeleton quantidade={6} />
      ) : paginacao.total === 0 ? (
        <PanelEmpty
          titulo="Nenhum produto encontrado"
          descricao="Ajuste a busca ou os filtros de estrutura e nicho."
          onLimpar={temFiltro ? limpar : undefined}
        />
      ) : (
        <>
          <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {paginacao.visiveis.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>

          <PanelPagination
            estado={paginacao}
            rotulo={["produto", "produtos"]}
            porPagina={porPagina}
            onPorPaginaChange={setPorPagina}
          />
        </>
      )}
    </div>
  );
}
