import { useMemo, useState } from "react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { useOutletContext } from "react-router-dom";

import type { ManagerOutletContext } from "@/layouts/ManagerLayout";
import { AtendimentosSubNav } from "@/components/dashboard/AtendimentosSubNav";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { TicketsAbertosConcluidos } from "@/features/dashboard/TicketsAbertosConcluidos";
import { useDashboardDailyTicketsQuery } from "@/features/dashboard/useDashboardDailyTicketsQuery";

const toISODate = (d: Date) => format(d, "yyyy-MM-dd");

/** Mesmo default da sidebar: do dia 1º do mês corrente até hoje. */
function periodoPadrao(): DateRange {
  const hoje = new Date();
  return { from: new Date(hoje.getFullYear(), hoje.getMonth(), 1), to: hoje };
}

/**
 * Visão Geral dos Atendimentos — segunda aba da área de Atendimentos.
 * Aqui a unidade é o TICKET (quantos chamados entram e saem por dia), não a
 * interação: a leitura por agente é a outra aba.
 *
 * O período é **desta tela**, não o da sidebar: o seletor fica no cabeçalho e
 * só manda aqui. O que ainda vem da sidebar é o filtro de agente. O primeiro
 * valor é copiado do período da sidebar, para a tela abrir mostrando o que a
 * gestora já tinha escolhido; a partir do primeiro clique aqui, os dois andam
 * separados de propósito.
 */
export default function DashboardAtendimentosVisaoGeral() {
  const { fullName, range: rangeSidebar, agentId } = useOutletContext<ManagerOutletContext>();

  const [range, setRange] = useState<DateRange | undefined>(() => rangeSidebar ?? periodoPadrao());

  // O calendário permite fechar o intervalo em um dia só (`to` vazio enquanto a
  // segunda data não é escolhida): aí o período é esse único dia, e não "até
  // hoje" — senão a consulta muda sozinha entre dois cliques.
  const { fromISO, toISO } = useMemo(() => {
    const padrao = periodoPadrao();
    const from = range?.from ?? padrao.from!;
    const to = range?.to ?? range?.from ?? padrao.to!;
    return { fromISO: toISODate(from), toISO: toISODate(to) };
  }, [range]);

  const dailyQuery = useDashboardDailyTicketsQuery({
    enabled: true,
    from: fromISO,
    to: toISO,
    agentId: agentId === "all" ? undefined : agentId,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-lg font-semibold text-muted-foreground">Olá {fullName ?? ""}!</p>
          <h1 className="text-3xl font-semibold tracking-tight">Atendimentos</h1>
          <AtendimentosSubNav />
          <p className="text-sm text-muted-foreground">
            Agente: {agentId === "all" ? "Todos" : "Selecionado"} (filtro da barra lateral)
          </p>
        </div>

        <div className="w-full space-y-1.5 sm:w-[300px]">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Período desta tela
          </span>
          <DateRangePicker
            value={range}
            onChange={setRange}
            className="border bg-background text-foreground hover:bg-accent"
          />
        </div>
      </header>

      <section>
        <TicketsAbertosConcluidos data={dailyQuery.data} isLoading={dailyQuery.isLoading} />
      </section>
    </div>
  );
}
