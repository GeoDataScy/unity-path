import { useMemo, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSupportProductsQuery } from "../useSupportBaseQuery";
import { ESTRUTURA_LABEL, type Estrutura, type SupportProduct } from "../types";
import { ProductCard } from "./ProductCard";

const TODOS = "todos";

export function ProductsPanel() {
  const { data, isLoading, isError } = useSupportProductsQuery();
  const [busca, setBusca] = useState("");
  const [estrutura, setEstrutura] = useState<Estrutura | typeof TODOS>(TODOS);
  const [nicho, setNicho] = useState<string>(TODOS);

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

  const porEstrutura = (alvo: Estrutura) => filtrados.filter((p) => p.estrutura === alvo);
  const contar = (alvo: Estrutura) => produtos.filter((p) => p.estrutura === alvo).length;

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Não foi possível carregar os produtos. Recarregue a página e tente de novo.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="text-xs leading-relaxed">
          <strong>Atenção agentes:</strong> as duas estruturas estão ativas. Identifique pelo
          contexto do cliente — <strong>Nova estrutura</strong> (lojas independentes) ou{" "}
          <strong>Estrutura antiga</strong> (CartPanda / ClickBank / Digistore) — antes de enviar
          links.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar produto, função, plataforma ou nicho…"
            className="pl-9"
          />
        </div>

        <ToggleGroup
          type="single"
          value={estrutura}
          onValueChange={(v) => v && setEstrutura(v as Estrutura | typeof TODOS)}
          className="justify-start"
        >
          <ToggleGroupItem value={TODOS} className="h-9 px-3 text-xs">
            Todos ({produtos.length})
          </ToggleGroupItem>
          <ToggleGroupItem value="nova" className="h-9 px-3 text-xs">
            Nova ({contar("nova")})
          </ToggleGroupItem>
          <ToggleGroupItem value="antiga" className="h-9 px-3 text-xs">
            Antiga ({contar("antiga")})
          </ToggleGroupItem>
        </ToggleGroup>

        <Select value={nicho} onValueChange={setNicho}>
          <SelectTrigger className="w-full sm:w-[200px]">
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
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nenhum produto encontrado com esses filtros.
        </p>
      ) : (
        <div className="space-y-8">
          {(["nova", "antiga"] as const).map((alvo) => {
            const grupo = porEstrutura(alvo);
            if (grupo.length === 0) return null;
            return (
              <EstruturaSection key={alvo} estrutura={alvo} produtos={grupo} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function EstruturaSection({
  estrutura,
  produtos,
}: {
  estrutura: Estrutura;
  produtos: SupportProduct[];
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">{ESTRUTURA_LABEL[estrutura]}</h2>
        <span className="text-xs text-muted-foreground">{produtos.length}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {produtos.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
