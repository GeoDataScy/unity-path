import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, CopyCheck, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSameDayRepeatsQuery } from "@/features/dashboard/useSameDayRepeatsQuery";

function formatDateTimeSP(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type Props = {
  fromISO: string;
  toISO: string;
  agentId?: string;
};

/**
 * Interações repetidas no mesmo ticket no mesmo dia.
 *
 * Por decisão de produto o sistema NÃO bloqueia esses registros — o agente pode
 * ter motivo legítimo para voltar ao mesmo cliente no mesmo dia. O que fazemos é
 * dar visibilidade ao gestor, que julga caso a caso.
 *
 * Dois números, porque são coisas diferentes:
 *   same_day_extra  -> o que infla a contagem diária (2 eventos, 1 atendimento)
 *   rule_violations -> subconjunto que furou a regra das 18h anunciada na UI
 */
export function SameDayRepeatsSection({ fromISO, toISO, agentId }: Props) {
  const query = useSameDayRepeatsQuery({ fromISO, toISO, agentId });
  const data = query.data;
  const isLoading = query.isLoading;
  const [expanded, setExpanded] = useState(false);

  const worst = data?.by_agent?.[0];
  const hasAny = (data?.same_day_extra ?? 0) > 0;

  const detailShown = useMemo(() => (data?.detail ?? []).slice(0, 50), [data?.detail]);
  const detailHidden = Math.max(0, (data?.detail?.length ?? 0) - detailShown.length);

  return (
    <section className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-amber-500/15 p-2.5">
          <CopyCheck className="h-6 w-6 text-amber-600 dark:text-amber-500" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Interações repetidas no mesmo dia</h2>
          <p className="text-sm text-muted-foreground">
            Mais de uma interação no mesmo ticket no mesmo dia. Não é bloqueado — cada caso pode ter
            motivo legítimo. Serve para você conferir o número.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className={hasAny ? "border-amber-500/40" : undefined}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Contagens duplicadas no período
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-9 w-16" />
            ) : (
              <>
                <div
                  className={`text-3xl font-semibold ${hasAny ? "text-amber-600 dark:text-amber-500" : "text-green-600"}`}
                >
                  {data?.same_day_extra ?? 0}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  interações a mais do que atendimentos-dia
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Furaram a regra das 18h
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-9 w-16" />
            ) : (
              <>
                <div className="text-3xl font-semibold">{data?.rule_violations ?? 0}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  registradas antes das 18h do dia da interação anterior
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Maior proporção</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-9 w-40" />
            ) : worst ? (
              <div>
                <div className="text-lg font-semibold leading-tight">{worst.agent_name}</div>
                <div className="text-sm text-muted-foreground">
                  {worst.repeat_count} de {worst.total_count} ({worst.pct}%)
                </div>
              </div>
            ) : (
              <div className="text-lg font-semibold text-green-600">Nenhum</div>
            )}
          </CardContent>
        </Card>
      </div>

      {!isLoading && !hasAny && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Info className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Nenhuma interação repetida no mesmo dia neste período.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !!data?.by_agent?.length && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Por agente</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agente</TableHead>
                    <TableHead className="text-right">Repetidas</TableHead>
                    <TableHead className="text-right">Total de interações</TableHead>
                    <TableHead className="text-right">Proporção</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.by_agent.map((a) => (
                    <TableRow key={a.agent_id}>
                      <TableCell className="font-medium">{a.agent_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.repeat_count}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {a.total_count}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={a.pct >= 5 ? "destructive" : "outline"}>{a.pct}%</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-3 gap-1.5 text-muted-foreground"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {expanded ? "Ocultar detalhe" : `Ver detalhe (${data.detail.length})`}
            </Button>

            {expanded && (
              <div className="mt-3 overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Agente</TableHead>
                      <TableHead>Anterior</TableHead>
                      <TableHead>Esta</TableHead>
                      <TableHead className="text-right">Intervalo</TableHead>
                      <TableHead>Observação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailShown.map((d, i) => (
                      <TableRow key={`${d.service_id}-${d.recorded_at}-${i}`}>
                        <TableCell className="break-all font-medium">{d.client_email}</TableCell>
                        <TableCell>{d.product ?? "—"}</TableCell>
                        <TableCell>{d.agent_name}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {formatDateTimeSP(d.previous_at)}
                        </TableCell>
                        <TableCell className="tabular-nums">{formatDateTimeSP(d.recorded_at)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {d.hours_apart == null ? "—" : `${d.hours_apart}h`}
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate text-muted-foreground">
                          {d.observation ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {detailHidden > 0 && (
                  <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                    Mostrando as 50 mais recentes de {data.detail.length}. Reduza o período para ver o resto.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {query.error && (
        <p className="rounded-md bg-destructive/60 px-3 py-2 text-xs text-destructive-foreground/90">
          {(query.error as Error).message || "Erro ao carregar interações repetidas."}
        </p>
      )}
    </section>
  );
}
