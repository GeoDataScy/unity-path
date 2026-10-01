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
import { EMAIL_TEMPLATE_CATEGORIES, EMAIL_TEMPLATES } from "../data/emailTemplates";
import { usePanelPagination } from "../usePanelPagination";
import { CopyButton } from "./CopyButton";
import { TODOS } from "./EstruturaFilter";
import { PanelEmpty } from "./PanelStates";
import { PanelPagination } from "./PanelPagination";
import { PanelToolbar } from "./PanelToolbar";

export function EmailTemplatesPanel() {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<string>(TODOS);
  const [porPagina, setPorPagina] = useState(12);

  // Ordem vem do catálogo (EMAIL_TEMPLATE_CATEGORIES), não da ordem de inserção
  // dos templates — assim o select segue a sequência pensada para a tela.
  const categorias = useMemo(() => {
    const presentes = new Set(EMAIL_TEMPLATES.map((t) => t.categoria));
    return EMAIL_TEMPLATE_CATEGORIES.filter((c) => presentes.has(c));
  }, []);

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    return EMAIL_TEMPLATES.filter((t) => {
      const alvo = `${t.titulo}${t.categoria}${t.corpo}`.toLowerCase();
      return (!q || alvo.includes(q)) && (categoria === TODOS || t.categoria === categoria);
    });
  }, [busca, categoria]);

  const paginacao = usePanelPagination(filtrados, porPagina, `${busca}|${categoria}`);

  const temFiltro = Boolean(busca) || categoria !== TODOS;
  const limpar = () => {
    setBusca("");
    setCategoria(TODOS);
  };

  return (
    <div className="space-y-4">
      <PanelToolbar
        busca={busca}
        onBuscaChange={setBusca}
        placeholder="Buscar template ou situação…"
      >
        <Select value={categoria} onValueChange={setCategoria}>
          <SelectTrigger className="h-9 w-full bg-background sm:w-[220px]" aria-label="Categoria">
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
      </PanelToolbar>

      {paginacao.total === 0 ? (
        <PanelEmpty
          titulo="Nenhum template encontrado"
          descricao="Ajuste a busca ou escolha outra categoria."
          onLimpar={temFiltro ? limpar : undefined}
        />
      ) : (
        <>
          <div className="grid items-start gap-3 sm:grid-cols-2">
            {paginacao.visiveis.map((t) => (
              <Card
                key={t.categoria + t.titulo}
                className="flex flex-col gap-3 p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <h3 className="text-sm font-medium leading-tight">{t.titulo}</h3>
                    <Badge variant="secondary" className="text-[10px] font-medium">
                      {t.categoria}
                    </Badge>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {t.tag}
                  </Badge>
                </div>

                {/* Corpo de e-mail é longo — scroll interno mantém a grade alinhada. */}
                <p className="max-h-48 flex-1 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                  {t.corpo}
                </p>

                <div className="flex justify-end">
                  <CopyButton value={t.corpo} />
                </div>
              </Card>
            ))}
          </div>

          <PanelPagination
            estado={paginacao}
            rotulo={["template", "templates"]}
            porPagina={porPagina}
            onPorPaginaChange={setPorPagina}
          />
        </>
      )}
    </div>
  );
}
