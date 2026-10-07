import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

import { formatMesPorExtenso, saoPauloMonthStart } from "./format";
import { useSlaMensalQuery } from "./useSlaMensalQuery";

/**
 * Ajuste 2 do doc XMX-2026/IMP-SUP-01-A v2: volume do mês contra a capacidade
 * contratada. A barra é só informativa — sem cor de alerta e sem "faltam".
 */
export function PackageServiceLevelCard({ enabled }: { enabled: boolean }) {
  const month = saoPauloMonthStart();
  const { data, isLoading, isError } = useSlaMensalQuery({ enabled, month });

  const pct = data && data.capacidade > 0 ? Math.min(100, (data.volume / data.capacidade) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">
          Nível de serviço do pacote — {formatMesPorExtenso(month.slice(0, 7))}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-10 w-40" />
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">Não foi possível carregar o nível de serviço agora.</p>
        ) : (
          <>
            <div className="text-4xl font-normal font-mono tabular-nums tracking-[-0.03em]">
              {data.volume.toLocaleString("pt-BR")}
              <span className="text-muted-foreground"> / {data.capacidade.toLocaleString("pt-BR")}</span>
            </div>
            <Progress
              value={pct}
              className="mt-3 h-2"
              indicatorClassName="bg-muted-foreground/60"
              aria-label="Volume do mês em relação à capacidade contratada"
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
