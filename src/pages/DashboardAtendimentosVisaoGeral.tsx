import { format, parseISO } from "date-fns";
import { useOutletContext } from "react-router-dom";

import type { ManagerOutletContext } from "@/layouts/ManagerLayout";
import { AtendimentosSubNav } from "@/components/dashboard/AtendimentosSubNav";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Visão Geral dos Atendimentos — segunda aba da área de Atendimentos.
 * Nasce sem gráficos: a página existe para a gestora já alternar entre as duas
 * visões enquanto os indicadores desta são definidos.
 */
export default function DashboardAtendimentosVisaoGeral() {
  const { fullName, fromISO, toISO, agentId } = useOutletContext<ManagerOutletContext>();

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-lg font-semibold text-muted-foreground">Olá {fullName ?? ""}!</p>
          <h1 className="text-3xl font-semibold tracking-tight">Atendimentos</h1>
          <AtendimentosSubNav />
          <p className="text-sm text-muted-foreground">
            Período: {format(parseISO(fromISO), "dd/MM/yyyy")} — {format(parseISO(toISO), "dd/MM/yyyy")} • Agente: {agentId === "all" ? "Todos" : "Selecionado"}
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          Em breve os indicadores da visão geral dos atendimentos.
        </CardContent>
      </Card>
    </div>
  );
}
