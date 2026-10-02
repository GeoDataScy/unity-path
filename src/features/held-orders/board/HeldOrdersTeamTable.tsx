import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatSince } from "../dates";
import type { HeldOrdersTeam } from "./useHeldOrdersBoard";

type Props = {
  team: HeldOrdersTeam | undefined;
  loading: boolean;
  activeAgentId: string | null;
  onSelectAgent: (agentId: string | null) => void;
};

/**
 * Equipe hoje: carga atual de cada agente e o andamento da meta do dia. Clicar
 * no agente filtra a lista por ele.
 */
export function HeldOrdersTeamTable({ team, loading, activeAgentId, onSelectAgent }: Props) {
  const goal = team?.goal ?? 30;
  const agents = team?.agents ?? [];
  const now = Date.now();

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base font-medium">Equipe hoje</CardTitle>
        <span className="text-xs text-ink-tertiary">
          Meta de Pedidos em Espera: {goal} por agente/dia · clique no agente para filtrar a lista
        </span>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {loading ? (
          <div className="space-y-2 px-6 pb-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : agents.length === 0 ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">Nenhum agente com pedidos em espera.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Agente</TableHead>
                  <TableHead className="text-right">Na fila</TableHead>
                  <TableHead className="text-right">Em andamento</TableHead>
                  <TableHead className="text-right">Inativos</TableHead>
                  <TableHead>Concluídos hoje</TableHead>
                  <TableHead className="pr-6">Último registro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((a) => {
                  const isActive = activeAgentId === a.agent_id;
                  const pct = goal > 0 ? Math.min(100, (a.done_today / goal) * 100) : 0;
                  const stale =
                    a.fila + a.andamento > 0 &&
                    (!a.last_event_at || now - new Date(a.last_event_at).getTime() > 2 * 3_600_000);
                  return (
                    <TableRow
                      key={a.agent_id}
                      onClick={() => onSelectAgent(isActive ? null : a.agent_id)}
                      className={cn("cursor-pointer", isActive && "bg-info/10 hover:bg-info/10")}
                      aria-selected={isActive}
                    >
                      <TableCell className="pl-6 font-medium">
                        {a.full_name ?? "Sem nome"}
                        {!a.is_active && <span className="ml-1.5 text-xs font-normal text-ink-tertiary">(desativado)</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{a.fila.toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{a.andamento.toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{a.inativo.toLocaleString("pt-BR")}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="font-mono text-sm tabular-nums">
                            {a.done_today}/{goal}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className={cn("pr-6 text-sm", stale ? "text-warning" : "text-ink-tertiary")}>
                        {formatSince(a.last_event_at, now)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
