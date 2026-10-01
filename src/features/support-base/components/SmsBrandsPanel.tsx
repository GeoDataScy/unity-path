import { useMemo, useState } from "react";
import { Info, MessageSquare } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { useSupportSmsBrandsQuery } from "../useSupportBaseQuery";
import { usePanelPagination } from "../usePanelPagination";
import type { Estrutura, SupportSmsBrand } from "../types";
import { CopyButton } from "./CopyButton";
import { EstruturaBadge } from "./EstruturaBadge";
import { EstruturaFilter, TODOS, type EstruturaFiltro } from "./EstruturaFilter";
import { PanelEmpty, PanelError, PanelSkeleton } from "./PanelStates";
import { PanelPagination } from "./PanelPagination";
import { PanelToolbar } from "./PanelToolbar";

export function SmsBrandsPanel() {
  const { data, isLoading, isError } = useSupportSmsBrandsQuery();
  const [busca, setBusca] = useState("");
  const [estrutura, setEstrutura] = useState<EstruturaFiltro>(TODOS);
  const [porPagina, setPorPagina] = useState(12);

  const brands = useMemo(() => data ?? [], [data]);

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    return brands.filter((b) => {
      const alvo = `${b.nome}${b.sistema}${b.sms_number ?? ""}`.toLowerCase();
      return (!q || alvo.includes(q)) && (estrutura === TODOS || b.estrutura === estrutura);
    });
  }, [brands, busca, estrutura]);

  // Mesma ordem da aba de produtos: nova antes de antiga, depois sort_order/nome.
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

  const paginacao = usePanelPagination(ordenados, porPagina, `${busca}|${estrutura}`);

  const contar = (alvo: Estrutura) => brands.filter((b) => b.estrutura === alvo).length;
  const temFiltro = Boolean(busca) || estrutura !== TODOS;
  const limpar = () => {
    setBusca("");
    setEstrutura(TODOS);
  };

  if (isError) return <PanelError recurso="as brands de SMS" />;

  return (
    <div className="space-y-4">
      <Alert className="border-blue-300 bg-blue-50 py-2.5 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs leading-relaxed">
          <strong>Nome no sistema</strong> é como a brand aparece no sistema de suporte. Sempre
          confira antes de responder.
        </AlertDescription>
      </Alert>

      <PanelToolbar
        busca={busca}
        onBuscaChange={setBusca}
        placeholder="Buscar brand, nome no sistema ou número…"
      >
        <EstruturaFilter
          value={estrutura}
          onChange={setEstrutura}
          contagem={{ todos: brands.length, nova: contar("nova"), antiga: contar("antiga") }}
        />
      </PanelToolbar>

      {isLoading ? (
        <PanelSkeleton quantidade={6} altura="h-32" />
      ) : paginacao.total === 0 ? (
        <PanelEmpty
          titulo="Nenhuma brand encontrada"
          descricao="Ajuste a busca ou o filtro de estrutura."
          onLimpar={temFiltro ? limpar : undefined}
        />
      ) : (
        <>
          <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {paginacao.visiveis.map((b) => (
              <SmsBrandCard key={b.id} brand={b} />
            ))}
          </div>

          <PanelPagination
            estado={paginacao}
            rotulo={["brand", "brands"]}
            porPagina={porPagina}
            onPorPaginaChange={setPorPagina}
          />
        </>
      )}
    </div>
  );
}

function SmsBrandCard({ brand }: { brand: SupportSmsBrand }) {
  return (
    <Card className="flex flex-col gap-3 p-4 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-medium leading-tight">{brand.nome}</h3>
        <EstruturaBadge estrutura={brand.estrutura} curto />
      </div>

      <div className="rounded-md bg-muted/60 p-2.5">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          Nome no sistema
        </div>
        <div className="flex items-start gap-1">
          <span className="min-w-0 flex-1 break-words text-xs font-medium">{brand.sistema}</span>
          <CopyButton value={brand.sistema} size="icon" />
        </div>
      </div>

      {brand.sms_number && (
        <div className="mt-auto flex items-center gap-1 border-t border-dashed pt-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground">
            <MessageSquare className="h-3 w-3 shrink-0" />
            <span className="truncate font-mono">{brand.sms_number}</span>
          </span>
          <CopyButton value={brand.sms_number} size="icon" />
        </div>
      )}
    </Card>
  );
}
