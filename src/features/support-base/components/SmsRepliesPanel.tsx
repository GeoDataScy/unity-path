import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSupportSmsRepliesQuery } from "../useSupportBaseQuery";
import { usePanelPagination } from "../usePanelPagination";
import type { SupportSmsReply } from "../types";
import { CopyButton } from "./CopyButton";
import { TODOS } from "./EstruturaFilter";
import { PanelEmpty, PanelError, PanelSkeleton } from "./PanelStates";
import { PanelPagination } from "./PanelPagination";
import { PanelToolbar } from "./PanelToolbar";

type Idioma = "en" | "pt";

export function SmsRepliesPanel() {
  const { data, isLoading, isError } = useSupportSmsRepliesQuery();
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<string>(TODOS);
  const [porPagina, setPorPagina] = useState(12);
  // Idioma global: o agente costuma trabalhar um atendimento inteiro no mesmo
  // idioma, então o botão do topo troca tudo de uma vez. Cada card ainda pode
  // divergir individualmente (estado próprio, ver ReplyCard).
  const [idiomaGlobal, setIdiomaGlobal] = useState<Idioma>("en");

  const respostas = useMemo(() => data ?? [], [data]);

  const categorias = useMemo(
    () => [...new Set(respostas.map((r) => r.categoria))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [respostas],
  );

  const filtradas = useMemo(() => {
    const q = busca.toLowerCase().trim();
    return respostas.filter((r) => {
      const alvo = `${r.titulo}${r.categoria}${r.texto_en}${r.texto_pt}`.toLowerCase();
      return (!q || alvo.includes(q)) && (categoria === TODOS || r.categoria === categoria);
    });
  }, [respostas, busca, categoria]);

  const paginacao = usePanelPagination(filtradas, porPagina, `${busca}|${categoria}`);

  const temFiltro = Boolean(busca) || categoria !== TODOS;
  const limpar = () => {
    setBusca("");
    setCategoria(TODOS);
  };

  if (isError) return <PanelError recurso="as respostas de SMS" />;

  return (
    <div className="space-y-4">
      <PanelToolbar
        busca={busca}
        onBuscaChange={setBusca}
        placeholder="Buscar mensagem ou situação…"
      >
        <Select value={categoria} onValueChange={setCategoria}>
          <SelectTrigger className="h-9 w-full bg-background sm:w-[200px]" aria-label="Categoria">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent className="z-50">
            <SelectItem value={TODOS}>Todas as categorias</SelectItem>
            {categorias.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ToggleGroup
          type="single"
          value={idiomaGlobal}
          onValueChange={(v) => v && setIdiomaGlobal(v as Idioma)}
          className="rounded-md border bg-background p-0.5"
          aria-label="Idioma das mensagens"
        >
          <ToggleGroupItem value="en" className="h-8 px-4 text-xs">
            EN
          </ToggleGroupItem>
          <ToggleGroupItem value="pt" className="h-8 px-4 text-xs">
            PT
          </ToggleGroupItem>
        </ToggleGroup>
      </PanelToolbar>

      {isLoading ? (
        <PanelSkeleton quantidade={6} altura="h-40" colunas="sm:grid-cols-2" />
      ) : paginacao.total === 0 ? (
        <PanelEmpty
          titulo="Nenhuma mensagem encontrada"
          descricao="Ajuste a busca ou escolha outra categoria."
          onLimpar={temFiltro ? limpar : undefined}
        />
      ) : (
        <>
          <div className="grid items-start gap-3 sm:grid-cols-2">
            {paginacao.visiveis.map((r) => (
              // key inclui o idioma global para o card remontar e voltar a
              // seguir o toggle do topo depois de ter sido trocado sozinho.
              <ReplyCard key={`${r.id}-${idiomaGlobal}`} reply={r} idiomaInicial={idiomaGlobal} />
            ))}
          </div>

          <PanelPagination
            estado={paginacao}
            rotulo={["mensagem", "mensagens"]}
            porPagina={porPagina}
            onPorPaginaChange={setPorPagina}
          />
        </>
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
    <Card className="flex flex-col gap-3 p-4 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-semibold leading-tight">{reply.titulo}</h3>
          <Badge variant="secondary" className="text-[10px] font-medium">
            {reply.categoria}
          </Badge>
        </div>
        <ToggleGroup
          type="single"
          value={idioma}
          onValueChange={(v) => v && setIdioma(v as Idioma)}
          className="shrink-0 rounded-md border p-0.5"
          aria-label="Idioma desta mensagem"
        >
          <ToggleGroupItem value="en" className="h-6 px-2 text-[10px]">
            EN
          </ToggleGroupItem>
          <ToggleGroupItem value="pt" className="h-6 px-2 text-[10px]">
            PT
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* max-h + scroll interno: mensagem longa não estica o card e desalinha a grade. */}
      <p className="max-h-40 flex-1 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
        {texto}
      </p>

      <div className="flex justify-end">
        <CopyButton value={texto} />
      </div>
    </Card>
  );
}
