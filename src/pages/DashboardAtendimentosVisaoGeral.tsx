import { useMemo, useState } from "react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { useOutletContext } from "react-router-dom";

import type { ManagerOutletContext } from "@/layouts/ManagerLayout";
import { AtendimentosSubNav } from "@/components/dashboard/AtendimentosSubNav";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { FiltroVisaoGeral, TODOS } from "@/features/dashboard/FiltroVisaoGeral";
import { TicketsAbertosConcluidos } from "@/features/dashboard/TicketsAbertosConcluidos";
import { CANAIS, useDashboardDailyTicketsQuery } from "@/features/dashboard/useDashboardDailyTicketsQuery";

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
 *
 * Plataforma e produto seguem o mesmo modelo do período: estado local, só
 * desta tela. O recorte é feito na RPC, pelo que está gravado no ticket.
 *
 * O canal (Email / SMS) é o da abertura do ticket: a tela continua contando só
 * aberturas e conclusões, nunca interação.
 */
export default function DashboardAtendimentosVisaoGeral() {
  const { fullName, range: rangeSidebar, agentId } = useOutletContext<ManagerOutletContext>();

  const [range, setRange] = useState<DateRange | undefined>(() => rangeSidebar ?? periodoPadrao());
  const [platform, setPlatform] = useState<string>(TODOS);
  const [product, setProduct] = useState<string>(TODOS);
  const [channel, setChannel] = useState<string>(TODOS);

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
    platform: platform === TODOS ? undefined : platform,
    product: product === TODOS ? undefined : product,
    channel: channel === TODOS ? undefined : channel,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-[15px] text-ink-tertiary">Olá {fullName ?? ""}!</p>
          <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.025em]">Atendimentos</h1>
          <AtendimentosSubNav />
          <p className="text-sm text-muted-foreground">
            Agente: {agentId === "all" ? "Todos" : "Selecionado"} (filtro da barra lateral)
          </p>
        </div>

        <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-auto lg:grid-cols-[140px_180px_220px_300px]">
          <FiltroVisaoGeral
            label="Por canal"
            semValorLabel="Sem canal"
            value={channel}
            onChange={setChannel}
            options={CANAIS}
            disabled={dailyQuery.isLoading}
          />
          <FiltroVisaoGeral
            label="Plataforma"
            semValorLabel="Sem plataforma"
            value={platform}
            onChange={setPlatform}
            options={dailyQuery.data?.platforms}
            disabled={dailyQuery.isLoading}
          />
          <FiltroVisaoGeral
            label="Produto"
            semValorLabel="Sem produto"
            value={product}
            onChange={setProduct}
            options={dailyQuery.data?.products}
            disabled={dailyQuery.isLoading}
          />
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <span className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Período desta tela
            </span>
            <DateRangePicker
              value={range}
              onChange={setRange}
              className="border bg-background text-foreground hover:bg-accent"
            />
          </div>
        </div>
      </header>

      <section>
        <TicketsAbertosConcluidos data={dailyQuery.data} isLoading={dailyQuery.isLoading} />
      </section>
    </div>
  );
}
