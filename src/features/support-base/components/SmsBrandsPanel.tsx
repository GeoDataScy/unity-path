import { useMemo, useState } from "react";
import { AlertTriangle, Info, MessageSquare, Search } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSupportSmsBrandsQuery } from "../useSupportBaseQuery";
import { ESTRUTURA_LABEL, type Estrutura, type SupportSmsBrand } from "../types";
import { CopyButton } from "./CopyButton";

const TODOS = "todos";

export function SmsBrandsPanel() {
  const { data, isLoading, isError } = useSupportSmsBrandsQuery();
  const [busca, setBusca] = useState("");
  const [estrutura, setEstrutura] = useState<Estrutura | typeof TODOS>(TODOS);

  const brands = useMemo(() => data ?? [], [data]);

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    return brands.filter((b) => {
      const alvo = `${b.nome}${b.sistema}${b.sms_number ?? ""}`.toLowerCase();
      return (!q || alvo.includes(q)) && (estrutura === TODOS || b.estrutura === estrutura);
    });
  }, [brands, busca, estrutura]);

  const contar = (alvo: Estrutura) => brands.filter((b) => b.estrutura === alvo).length;

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Não foi possível carregar as brands de SMS. Recarregue a página e tente de novo.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <Alert className="border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs leading-relaxed">
          O campo <strong>"Nome no sistema"</strong> é como a brand aparece no sistema de suporte.
          Sempre confira antes de responder.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar brand, nome no sistema ou número…"
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
            Todos ({brands.length})
          </ToggleGroupItem>
          <ToggleGroupItem value="nova" className="h-9 px-3 text-xs">
            Nova ({contar("nova")})
          </ToggleGroupItem>
          <ToggleGroupItem value="antiga" className="h-9 px-3 text-xs">
            Antiga ({contar("antiga")})
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nenhuma brand encontrada com esses filtros.
        </p>
      ) : (
        <div className="space-y-8">
          {(["nova", "antiga"] as const).map((alvo) => {
            const grupo = filtrados.filter((b) => b.estrutura === alvo);
            if (grupo.length === 0) return null;
            return (
              <section key={alvo} className="space-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold">{ESTRUTURA_LABEL[alvo]}</h2>
                  <span className="text-xs text-muted-foreground">{grupo.length}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {grupo.map((b) => (
                    <SmsBrandCard key={b.id} brand={b} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SmsBrandCard({ brand }: { brand: SupportSmsBrand }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold leading-tight">{brand.nome}</h3>

      <div className="rounded-md bg-muted/60 p-2.5">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Nome no sistema
        </div>
        <div className="flex items-start gap-1">
          <span className="min-w-0 flex-1 break-words text-xs font-medium">{brand.sistema}</span>
          <CopyButton value={brand.sistema} size="icon" />
        </div>
      </div>

      {brand.sms_number && (
        <div className="flex items-center gap-1 border-t border-dashed pt-2">
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
