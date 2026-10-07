import type { AgentDailyMetrics } from "@/features/agent/useAgentDailyMetricsQuery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PackageServiceLevelCard } from "@/features/sla/PackageServiceLevelCard";

type Props = {
  userId: string | null;
  metricsLoading: boolean;
  dailyMetrics: AgentDailyMetrics | undefined;
  /** Replaces the backend my_count with a value computed on the client (e.g. unique tickets today). */
  myCountOverride?: number | null;
};

/**
 * Doc XMX-2026/IMP-SUP-01-A v2: o serviço é medido por caso e por mês, nunca a
 * pessoa por dia. O número de hoje é só contagem — sem meta, progresso ou
 * comemoração do dia.
 */
export function AgentDailyMetricsSection({ userId, metricsLoading, dailyMetrics, myCountOverride }: Props) {
  const myCount = myCountOverride ?? dailyMetrics?.my_count ?? 0;

  return (
    <section className="mb-8 grid gap-4 md:grid-cols-2" aria-label="Métricas">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Atendimentos registrados hoje</CardTitle>
        </CardHeader>
        <CardContent>
          {metricsLoading ? (
            <Skeleton className="h-10 w-24" />
          ) : (
            <div className="text-4xl font-normal font-mono tabular-nums tracking-[-0.03em]">
              {myCount.toLocaleString("pt-BR")}
            </div>
          )}
        </CardContent>
      </Card>

      <PackageServiceLevelCard enabled={Boolean(userId)} />
    </section>
  );
}
