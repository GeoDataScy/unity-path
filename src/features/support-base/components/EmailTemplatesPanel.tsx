import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EMAIL_TEMPLATES, type EmailTemplate } from "../data/emailTemplates";
import { CopyButton } from "./CopyButton";

export function EmailTemplatesPanel() {
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    if (!q) return EMAIL_TEMPLATES;
    return EMAIL_TEMPLATES.filter((t) =>
      `${t.titulo}${t.categoria}${t.corpo}`.toLowerCase().includes(q),
    );
  }, [busca]);

  const categorias = useMemo(() => {
    const mapa = new Map<string, EmailTemplate[]>();
    for (const t of filtrados) {
      const lista = mapa.get(t.categoria);
      if (lista) lista.push(t);
      else mapa.set(t.categoria, [t]);
    }
    return [...mapa.entries()];
  }, [filtrados]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar template ou situação…"
            className="pl-9"
          />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {filtrados.length} {filtrados.length === 1 ? "template" : "templates"}
        </span>
      </div>

      {filtrados.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nenhum template encontrado para essa busca.
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
              <div className="space-y-3">
                {itens.map((t) => (
                  <Card key={t.categoria + t.titulo} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold leading-tight">{t.titulo}</h3>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {t.tag}
                      </Badge>
                    </div>
                    <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                      {t.corpo}
                    </p>
                    <div className="flex justify-end">
                      <CopyButton value={t.corpo} />
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
