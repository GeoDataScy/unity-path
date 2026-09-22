import { format, parseISO } from "date-fns";
import { useOutletContext } from "react-router-dom";

import type { ManagerOutletContext } from "@/layouts/ManagerLayout";
import { AtendimentosSubNav } from "@/components/dashboard/AtendimentosSubNav";
import { TicketsAbertosConcluidos } from "@/features/dashboard/TicketsAbertosConcluidos";
import { useDashboardDailyTicketsQuery } from "@/features/dashboard/useDashboardDailyTicketsQuery";

/**
 * Visão Geral dos Atendimentos — segunda aba da área de Atendimentos.
 * Aqui a unidade é o TICKET (quantos chamados entram e saem por dia), não a
 * interação: a leitura por agente é a outra aba.
 */
export default function DashboardAtendimentosVisaoGeral() {
  const { fullName, fromISO, toISO, agentId } = useOutletContext<ManagerOutletContext>();

  const dailyQuery = useDashboardDailyTicketsQuery({
    enabled: true,
    from: fromISO,
    to: toISO,
    agentId: agentId === "all" ? undefined : agentId,
  });

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

      <section>
        <TicketsAbertosConcluidos data={dailyQuery.data} isLoading={dailyQuery.isLoading} />
      </section>
    </div>
  );
}
