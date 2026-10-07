import { AlertTriangle, CheckCircle2, CircleDashed, Hourglass, LogIn, LogOut, PackageSearch, Timer } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ENCERRAMENTO_LABEL,
  LIMITE_ANTIGO,
  formatCount,
  formatDateTime,
  saudeDoSync,
} from "../format";
import type { LateHunterOverview, LateHunterSync } from "../types";

/** Faixa no topo: de quando é a fila que está na tela e se o sync está em dia. */
export function SyncStatus({ sync }: { sync: LateHunterSync | null }) {
  const saude = saudeDoSync(sync);
  if (!sync || saude === "sem_dados") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleDashed className="h-4 w-4" aria-hidden />
        Aguardando o primeiro lote do Late Hunter
      </div>
    );
  }

  const atrasado = saude === "atrasado";
  const paginas = sync.total_paginas > 1 ? ` · página ${sync.pagina} de ${sync.total_paginas}` : "";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm",
        atrasado ? "border-warning/50 bg-warning/5" : "border-line bg-surface",
      )}
      role="status"
    >
      <span className={cn("inline-flex items-center gap-1.5 font-medium", atrasado ? "text-warning" : "text-ink")}>
        {atrasado ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />}
        {atrasado ? "Sync atrasado" : "Sync em dia"}
      </span>
      <span className="text-ink-secondary">
        Varredura de <strong className="font-medium text-ink">{formatDateTime(sync.gerado_em)}</strong> · recebida{" "}
        {formatDateTime(sync.recebido_em)}
        {paginas}
      </span>
      <span className="text-ink-tertiary">{ENCERRAMENTO_LABEL[sync.encerramento]}</span>
      {sync.rejeitados.length > 0 && (
        <span className="text-warning">{formatCount(sync.rejeitados.length)} item(ns) recusado(s) no lote</span>
      )}
    </div>
  );
}

type TileProps = {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Cartão que filtra a tabela ao clicar. */
  onClick?: () => void;
  active?: boolean;
};

function Tile({ icon, label, value, hint, onClick, active }: TileProps) {
  const body = (
    <CardContent className="space-y-1 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="font-mono text-[28px] font-normal leading-9 tracking-[-0.03em] tabular-nums">{value}</div>
      {hint && <div className="text-xs text-ink-tertiary">{hint}</div>}
    </CardContent>
  );
  if (!onClick) return <Card>{body}</Card>;
  return (
    <Card
      className={cn(
        "transition-colors hover:border-line-strong",
        active && "border-primary ring-1 ring-primary",
      )}
    >
      <button type="button" onClick={onClick} aria-pressed={active} className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
        {body}
      </button>
    </Card>
  );
}

function dias(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = Math.round(n);
  return `${v} ${v === 1 ? "dia" : "dias"}`;
}

type SummaryProps = {
  overview: LateHunterOverview | undefined;
  loading: boolean;
  /** Filtro "mais de 30 dias" ligado na tabela (o cartão vira atalho dele). */
  antigosAtivo: boolean;
  onToggleAntigos: () => void;
};

export function LateHunterKpis({ overview, loading, antigosAtivo, onToggleAntigos }: SummaryProps) {
  if (loading || !overview) {
    return (
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-busy>
        {Array.from({ length: 5 }, (_, i) => (
          <Card key={i}>
            <CardContent className="space-y-2 p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </section>
    );
  }

  const k = overview.kpis;
  const pctAntigos = k.abertos > 0 ? Math.round((k.mais_30_dias / k.abertos) * 100) : 0;
  const saldo = k.entraram_ultimo - k.sairam_ultimo;

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Tile
        icon={<PackageSearch className="h-4 w-4 text-primary" aria-hidden />}
        label="Em on-hold agora"
        value={formatCount(k.abertos)}
        hint={`${formatCount(k.clientes_abertos)} e-mails distintos · ${formatCount(k.reabertos_abertos)} voltaram ao hold`}
      />
      <Tile
        icon={<LogIn className="h-4 w-4 text-muted-foreground" aria-hidden />}
        label="Entraram no último lote"
        value={formatCount(k.entraram_ultimo)}
        hint={saldo === 0 ? "Fila estável" : saldo > 0 ? `Fila cresceu ${formatCount(saldo)}` : `Fila diminuiu ${formatCount(-saldo)}`}
      />
      <Tile
        icon={<LogOut className="h-4 w-4 text-muted-foreground" aria-hidden />}
        label="Saíram do on-hold"
        value={formatCount(k.sairam_ultimo)}
        hint="Resolvidos sozinhos no último lote"
      />
      <Tile
        icon={<Hourglass className="h-4 w-4 text-warning" aria-hidden />}
        label={`Há mais de ${LIMITE_ANTIGO} dias`}
        value={formatCount(k.mais_30_dias)}
        hint={`${pctAntigos}% da fila · clique para filtrar`}
        onClick={onToggleAntigos}
        active={antigosAtivo}
      />
      <Tile
        icon={<Timer className="h-4 w-4 text-muted-foreground" aria-hidden />}
        label="Tempo típico em espera"
        value={dias(k.mediana_dias)}
        hint={`Mediana da fila · 90% estão há até ${dias(k.p90_dias)}`}
      />
    </section>
  );
}
