import { useRef } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  EXCECOES,
  FRASES_APOIO,
  FUNIL_STEPS,
  PERFIS_CLIENTE,
  REGRA_OBRIGATORIA,
  TYPEFORM_URL,
} from "../data/refundPlaybook";

const TOM_BORDA = {
  verde: "border-t-emerald-500",
  roxo: "border-t-violet-500",
  ambar: "border-t-amber-500",
} as const;

const TOM_TEXTO = {
  verde: "text-emerald-700 dark:text-emerald-400",
  roxo: "text-violet-700 dark:text-violet-400",
  ambar: "text-amber-700 dark:text-amber-400",
} as const;

/**
 * O playbook é procedimento corrido — não pagina (a sequência 30/40/50 só faz
 * sentido inteira). O que faltava era navegação: o índice abaixo leva direto à
 * seção em vez de obrigar a rolar a página toda.
 */
const SECOES = [
  { id: "funil", titulo: "Funil de reembolso" },
  { id: "excecoes", titulo: "Exceções" },
  { id: "perfis", titulo: "Perfis de cliente" },
  { id: "frases", titulo: "Frases de apoio" },
] as const;

type SecaoId = (typeof SECOES)[number]["id"];

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-sm font-medium">{children}</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export function RefundPlaybookPanel() {
  const refs = useRef<Partial<Record<SecaoId, HTMLElement | null>>>({});

  const irPara = (id: SecaoId) => {
    refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 border-b bg-dashboard-surface/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-dashboard-surface/80">
        <span className="text-xs font-medium text-muted-foreground">Ir para:</span>
        {SECOES.map((s) => (
          <Button
            key={s.id}
            variant="outline"
            size="sm"
            className="h-8 bg-background text-xs"
            onClick={() => irPara(s.id)}
          >
            {s.titulo}
          </Button>
        ))}
      </div>

      <Alert className="border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-200">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="text-xs leading-relaxed">
          <strong className="mb-1 block">Regra obrigatória</strong>
          {REGRA_OBRIGATORIA}
        </AlertDescription>
      </Alert>

      <section
        ref={(el) => {
          refs.current.funil = el;
        }}
        className="scroll-mt-20 space-y-3"
      >
        <SectionHead>Funil de reembolso</SectionHead>
        <div className="space-y-3">
          {FUNIL_STEPS.map((step) => (
            <Card key={step.numero} className="p-4">
              <div className="flex gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                  {step.numero}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium">{step.titulo}</h3>
                    <Badge variant="secondary" className="text-[11px] font-medium">
                      {step.selo}
                    </Badge>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{step.descricao}</p>
                  {step.frase && (
                    <p className="border-l-2 border-primary/40 pl-3 text-xs italic leading-relaxed">
                      "{step.frase}"
                    </p>
                  )}
                  {step.typeform && (
                    <a
                      href={TYPEFORM_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Abrir Typeform
                    </a>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {step.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[10px] font-normal">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section
        ref={(el) => {
          refs.current.excecoes = el;
        }}
        className="scroll-mt-20 space-y-3"
      >
        <SectionHead>Exceções — pular escada de retenção</SectionHead>
        <div className="grid items-start gap-3 sm:grid-cols-2">
          {EXCECOES.map((ex) => (
            <Card
              key={ex.titulo}
              className={cn(
                "space-y-2 border-t-[3px] p-4",
                TOM_BORDA[ex.tom],
                ex.larguraTotal && "sm:col-span-2",
              )}
            >
              <h3 className={cn("text-sm font-medium", TOM_TEXTO[ex.tom])}>{ex.titulo}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{ex.quando}</p>
              {ex.detalhe && (
                <div className="rounded-md bg-muted/60 p-3 text-xs leading-relaxed">
                  <strong className="mb-1 block">✅ Abordagem correta</strong>
                  {ex.detalhe}
                </div>
              )}
              <p
                className={cn(
                  "rounded-md border px-3 py-2 text-xs leading-relaxed",
                  TOM_TEXTO[ex.tom],
                )}
              >
                {ex.comoAgir}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section
        ref={(el) => {
          refs.current.perfis = el;
        }}
        className="scroll-mt-20 space-y-3"
      >
        <SectionHead>Perfis de cliente</SectionHead>
        <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PERFIS_CLIENTE.map((p) => (
            <Card key={p.titulo} className="space-y-2 p-4">
              <h3 className="text-sm font-medium">{p.titulo}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{p.comoIdentificar}</p>
              <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed">
                {p.comoResponder}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section
        ref={(el) => {
          refs.current.frases = el;
        }}
        className="scroll-mt-20 space-y-3"
      >
        <SectionHead>Frases de apoio</SectionHead>
        <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FRASES_APOIO.map((f) => (
            <Card key={f.tipo} className="space-y-1 p-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {f.tipo}
              </div>
              <p className="text-xs leading-relaxed">"{f.frase}"</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
