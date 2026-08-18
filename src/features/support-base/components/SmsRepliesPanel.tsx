import { useMemo, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSupportSmsRepliesQuery } from "../useSupportBaseQuery";
import type { SupportSmsReply } from "../types";
import { CopyButton } from "./CopyButton";

type Idioma = "en" | "pt";

export function SmsRepliesPanel() {
  const { data, isLoading, isError } = useSupportSmsRepliesQuery();
  const [busca, setBusca] = useState("");
  // Idioma global: o agente costuma trabalhar um atendimento inteiro no mesmo
  // idioma, então o botão do topo troca tudo de uma vez. Cada card ainda pode
  // divergir individualmente (estado próprio, ver ReplyCard).
  const [idiomaGlobal, setIdiomaGlobal] = useState<Idioma>("en");

  const respostas = useMemo(() => data ?? [], [data]);

  const filtradas = useMemo(() => {
    const q = busca.toLowerCase().trim();
    if (!q) return respostas;
    return respostas.filter((r) =>
      `${r.titulo}${r.categoria}${r.texto_en}${r.texto_pt}`.toLowerCase().includes(q),
    );
  }, [respostas, busca]);

  // Agrupa preservando a ordem de sort_order (a query já vem ordenada).
  const categorias = useMemo(() => {
    const mapa = new Map<string, SupportSmsReply[]>();
    for (const r of filtradas) {
      const lista = mapa.get(r.categoria);
      if (lista) lista.push(r);
      else mapa.set(r.categoria, [r]);
    }
    return [...mapa.entries()];
  }, [filtradas]);

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Não foi possível carregar as respostas de SMS. Recarregue a página e tente de novo.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar mensagem ou situação…"
            className="pl-9"
          />
        </div>

        <ToggleGroup
          type="single"
          value={idiomaGlobal}
          onValueChange={(v) => v && setIdiomaGlobal(v as Idioma)}
        >
          <ToggleGroupItem value="en" className="h-9 px-4 text-xs">
            EN
          </ToggleGroupItem>
          <ToggleGroupItem value="pt" className="h-9 px-4 text-xs">
            PT
          </ToggleGroupItem>
        </ToggleGroup>

        <span className="shrink-0 text-xs text-muted-foreground">
          {filtradas.length} {filtradas.length === 1 ? "mensagem" : "mensagens"}
        </span>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : filtradas.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nenhuma mensagem encontrada para essa busca.
        </p>
      ) : (
        <div className="space-y-8">
          {categorias.map(([categoria, itens]) => (
            <section key={categoria} className="space-y-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold">{categoria}</h2>
                <span className="text-xs text-muted-foreground">{itens.length}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {itens.map((r) => (
                  // key inclui o idioma global para o card remontar e voltar a
                  // seguir o toggle do topo depois de ter sido trocado sozinho.
                  <ReplyCard key={`${r.id}-${idiomaGlobal}`} reply={r} idiomaInicial={idiomaGlobal} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ReplyCard({
  reply,
  idiomaInicial,
}: {
  reply: SupportSmsReply;
  idiomaInicial: Idioma;
}) {
  const [idioma, setIdioma] = useState<Idioma>(idiomaInicial);
  const texto = idioma === "en" ? reply.texto_en : reply.texto_pt;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-tight">{reply.titulo}</h3>
        <ToggleGroup
          type="single"
          value={idioma}
          onValueChange={(v) => v && setIdioma(v as Idioma)}
          className="shrink-0"
        >
          <ToggleGroupItem value="en" className="h-6 px-2 text-[10px]">
            EN
          </ToggleGroupItem>
          <ToggleGroupItem value="pt" className="h-6 px-2 text-[10px]">
            PT
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <p className="flex-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
        {texto}
      </p>

      <div className="flex justify-end">
        <CopyButton value={texto} />
      </div>
    </Card>
  );
}
