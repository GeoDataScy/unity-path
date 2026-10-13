import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { useOutletContext } from "react-router-dom";

import type { ManagerOutletContext } from "@/layouts/ManagerLayout";
import { RefundsSubNav } from "@/components/dashboard/RefundsSubNav";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtInt, fmtPct, fmtUsd, fmtUsdCurto, fmtUsdLinha, nomePais, rotuloPeriodo } from "@/features/xmx-vendas/format";
import { BarrasEmpilhadas, BarrasLista, LinhaTaxas, Painel, Rosca } from "@/features/xmx-vendas/graficos";
import { plataforma } from "@/features/xmx-vendas/plataformas";
import { useXmxSistemaQuery, type XmxGroupBy, type XmxSistema } from "@/features/xmx-vendas/useXmxSistemaQuery";

/** Acima disso, "Dias" gera barras finas demais e uma resposta pesada: vale semana ou mês. */
const MAX_DIAS_POR_DIA = 92;

/**
 * Sistema XMX: vendas, reembolsos e chargebacks lidos do banco de vendas da XMX
 * (sincronizados a cada 15 min). Por plataforma, porque o banco de vendas ainda
 * não nos diz o produto de cada pedido.
 * Mora na aba "Sistema XMX" de Reembolsos.
 */
export default function DashboardSistemaXmx() {
  const { fromISO, toISO } = useOutletContext<ManagerOutletContext>();
  const [groupBy, setGroupBy] = useState<XmxGroupBy>("day");
  const [platform, setPlatform] = useState("all");

  const dias = fromISO && toISO ? differenceInCalendarDays(parseISO(toISO), parseISO(fromISO)) + 1 : 0;
  const diaPermitido = dias <= MAX_DIAS_POR_DIA;
  useEffect(() => {
    if (!diaPermitido && groupBy === "day") setGroupBy(dias > 400 ? "month" : "week");
  }, [diaPermitido, dias, groupBy]);

  const query = useXmxSistemaQuery({ from: fromISO, to: toISO, groupBy, platform });
  const data = query.data;
  const periodo = rotuloPeriodo(fromISO, toISO);
  const atualizado = data?.sync?.last_sync_at ? format(parseISO(data.sync.last_sync_at), "dd/MM 'às' HH:mm") : null;

  const agrupar = (
    <ToggleGroup
      type="single"
      size="sm"
      value={groupBy}
      onValueChange={(v) => v && setGroupBy(v as XmxGroupBy)}
      aria-label="Agrupar por"
      className="rounded-md border p-0.5"
    >
      <ToggleGroupItem value="day" disabled={!diaPermitido} className="h-7 px-2.5 text-xs">
        Dias
      </ToggleGroupItem>
      <ToggleGroupItem value="week" className="h-7 px-2.5 text-xs">
        Semanas
      </ToggleGroupItem>
      <ToggleGroupItem value="month" className="h-7 px-2.5 text-xs">
        Meses
      </ToggleGroupItem>
    </ToggleGroup>
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[15px] text-ink-tertiary">Analytics</p>
        <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.025em]">Reembolsos</h1>
        <RefundsSubNav />
      </header>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Vendas, reembolsos e chargebacks do sistema de vendas da XMX · {periodo}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {atualizado && (
            <span className="text-xs text-muted-foreground">
              Atualizado em {atualizado}
              {data?.sync?.last_status === "erro" && " · última tentativa falhou"}
            </span>
          )}
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="h-9 w-[190px]" aria-label="Plataforma">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as plataformas</SelectItem>
              {(data?.platforms ?? []).map((k) => (
                <SelectItem key={k} value={k}>
                  {plataforma(k).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {data?.sync && data.sync.ready === false && (
        <p className="rounded-md bg-subtle px-3 py-2 text-sm text-muted-foreground">
          Carga inicial em andamento: o histórico ainda está chegando e alguns números podem estar incompletos.
        </p>
      )}

      {query.isError ? (
        <div className="rounded-lg border border-dashed bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          Não foi possível carregar os dados do sistema XMX.
        </div>
      ) : query.isLoading || !data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[104px]" />
            ))}
          </div>
          <Skeleton className="h-[380px]" />
        </div>
      ) : (
        <>
          <Indicadores data={data} />

          <Tabs defaultValue="geral" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabsList>
                <TabsTrigger value="geral">Visão geral</TabsTrigger>
                <TabsTrigger value="vendas">Vendas</TabsTrigger>
                <TabsTrigger value="reembolsos">Reembolsos</TabsTrigger>
                <TabsTrigger value="chargebacks">Chargebacks</TabsTrigger>
                <TabsTrigger value="paises">Países</TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Agrupar por</span>
                {agrupar}
              </div>
            </div>

            <TabsContent value="geral" className="mt-0 space-y-6">
              <VisaoGeral data={data} />
            </TabsContent>
            <TabsContent value="vendas" className="mt-0">
              <Vendas data={data} />
            </TabsContent>
            <TabsContent value="reembolsos" className="mt-0 space-y-6">
              <Reembolsos data={data} />
            </TabsContent>
            <TabsContent value="chargebacks" className="mt-0">
              <Chargebacks data={data} />
            </TabsContent>
            <TabsContent value="paises" className="mt-0">
              <Paises data={data} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function Indicador({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{titulo}</p>
        <p className="mt-1 text-[26px] font-semibold leading-8 tracking-tight tabular-nums">{valor}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>
      </CardContent>
    </Card>
  );
}

function Indicadores({ data }: { data: XmxSistema }) {
  const k = data.kpis;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Indicador titulo="Pedidos" valor={fmtInt(k.orders)} detalhe={`Ticket médio ${fmtUsd(k.ticket_usd)}`} />
      <Indicador titulo="Faturamento" valor={fmtUsdCurto(k.gross_usd)} detalhe={`${fmtUsd(k.gross_usd)} brutos`} />
      <Indicador
        titulo="Reembolsos"
        valor={fmtInt(k.refunds)}
        detalhe={`${fmtPct(k.refund_rate)} dos pedidos · ${fmtUsdCurto(k.refunds_usd)}`}
      />
      <Indicador
        titulo="Chargebacks"
        valor={fmtInt(k.chargebacks)}
        detalhe={`${fmtPct(k.chargeback_rate, 2)} dos pedidos · ${fmtUsdCurto(k.chargebacks_usd)}`}
      />
    </div>
  );
}

const NOTA_TAXA =
  "Taxa = dos pedidos vendidos no período, quantos já viraram reembolso ou chargeback. Períodos recentes ainda sobem: o reembolso chega dias ou semanas depois da compra.";

function VisaoGeral({ data }: { data: XmxSistema }) {
  return (
    <>
      <Painel titulo="Por plataforma" descricao="Cartpanda e BuyGoods somam a estrutura antiga e a nova.">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plataforma</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Faturamento</TableHead>
                <TableHead className="text-right">Reembolsos</TableHead>
                <TableHead className="text-right">Taxa</TableHead>
                <TableHead className="text-right">Chargebacks</TableHead>
                <TableHead className="text-right">Taxa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.by_platform.map((p) => (
                <TableRow key={p.key}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: plataforma(p.key).cor }} />
                      {plataforma(p.key).label}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInt(p.orders)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtUsdLinha(p.gross_usd, p.orders)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInt(p.refunds)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmtPct(p.refund_rate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInt(p.chargebacks)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmtPct(p.chargeback_rate, 2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          BuyGoods quase não registra chargeback no sistema de vendas. DigiStore não informa valores.
        </p>
      </Painel>

      <Painel titulo="Taxa de reembolso e chargeback" descricao={NOTA_TAXA}>
        <LinhaTaxas serie={data.rates_series} groupBy={data.group_by} />
      </Painel>
    </>
  );
}

function ordemPorTotal(serie: { key: string; valor: number }[]) {
  const soma = new Map<string, number>();
  for (const s of serie) soma.set(s.key, (soma.get(s.key) ?? 0) + s.valor);
  return [...soma.entries()].sort((a, b) => b[1] - a[1]);
}

function Vendas({ data }: { data: XmxSistema }) {
  const [metrica, setMetrica] = useState<"orders" | "gross_usd">("orders");
  const serie = useMemo(
    () => data.sales_series.map((s) => ({ bucket: s.bucket, key: s.key, valor: s[metrica] })),
    [data.sales_series, metrica],
  );
  const ordem = ordemPorTotal(serie);
  const pedidos = ordemPorTotal(data.sales_series.map((s) => ({ key: s.key, valor: s.orders })));
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Painel titulo="Pedidos por plataforma">
        <Rosca itens={pedidos.map(([key, count]) => ({ key, count }))} rotulo="pedidos" />
      </Painel>
      <Painel
        titulo={metrica === "orders" ? "Pedidos por período" : "Faturamento por período"}
        acao={
          <ToggleGroup
            type="single"
            size="sm"
            value={metrica}
            onValueChange={(v) => v && setMetrica(v as typeof metrica)}
            aria-label="Métrica"
            className="rounded-md border p-0.5"
          >
            <ToggleGroupItem value="orders" className="h-7 px-2.5 text-xs">
              Pedidos
            </ToggleGroupItem>
            <ToggleGroupItem value="gross_usd" className="h-7 px-2.5 text-xs">
              US$
            </ToggleGroupItem>
          </ToggleGroup>
        }
      >
        <BarrasEmpilhadas
          serie={serie}
          chaves={ordem.map(([k]) => k)}
          groupBy={data.group_by}
          formatar={metrica === "orders" ? fmtInt : fmtUsdCurto}
        />
      </Painel>
    </div>
  );
}

function Reembolsos({ data }: { data: XmxSistema }) {
  const k = data.kpis;
  const serie = data.refunds_series.map((s) => ({ bucket: s.bucket, key: s.key, valor: s.count }));
  const ordem = ordemPorTotal(serie);
  const totalMotivos = data.refund_reasons.reduce((s, r) => s + r.count, 0);
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Painel
          titulo="Reembolsos por plataforma"
          descricao={`${fmtInt(k.refunds_total)} integrais · ${fmtInt(k.refunds_parcial)} parciais`}
        >
          <Rosca itens={ordem.map(([key, count]) => ({ key, count }))} rotulo="reembolsos" />
        </Painel>
        <Painel titulo="Reembolsos por período" descricao="Pelo dia em que o reembolso aconteceu.">
          <BarrasEmpilhadas serie={serie} chaves={ordem.map(([key]) => key)} groupBy={data.group_by} />
        </Painel>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Painel
          titulo="Motivos"
          descricao={
            totalMotivos
              ? `Das anotações do sistema de vendas (${fmtInt(totalMotivos)} reembolsos com motivo; ${fmtInt(data.refunds_without_reason)} sem). BuyGoods não registra motivo.`
              : "O sistema de vendas não registrou motivo para os reembolsos do período."
          }
        >
          <BarrasLista itens={data.refund_reasons.map((r) => ({ rotulo: r.reason, valor: r.count, detalhe: fmtPct(r.pct) }))} />
        </Painel>
        <Painel
          titulo="Tempo até o reembolso"
          descricao={
            data.refund_days_median !== null
              ? `Dias entre a compra e o reembolso. Metade acontece em até ${Math.round(data.refund_days_median)} dias.`
              : "Dias entre a compra e o reembolso."
          }
        >
          <BarrasLista itens={data.refund_days.map((d) => ({ rotulo: d.bucket, valor: d.count }))} />
        </Painel>
      </div>
    </>
  );
}

function Chargebacks({ data }: { data: XmxSistema }) {
  const serie = data.chargebacks_series.map((s) => ({ bucket: s.bucket, key: s.key, valor: s.count }));
  const ordem = ordemPorTotal(serie);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Painel titulo="Chargebacks por plataforma" descricao={`${fmtUsd(data.kpis.chargebacks_usd)} contestados`}>
        <Rosca itens={ordem.map(([key, count]) => ({ key, count }))} rotulo="chargebacks" />
      </Painel>
      <Painel titulo="Chargebacks por período" descricao="Pelo dia em que o cliente contestou no cartão.">
        <BarrasEmpilhadas serie={serie} chaves={ordem.map(([key]) => key)} groupBy={data.group_by} />
      </Painel>
    </div>
  );
}

function Paises({ data }: { data: XmxSistema }) {
  const total = data.countries.reduce((s, c) => s + c.orders, 0);
  return (
    <Painel titulo="Por país" descricao={NOTA_TAXA}>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>País</TableHead>
              <TableHead className="text-right">Pedidos</TableHead>
              <TableHead className="text-right">% dos pedidos</TableHead>
              <TableHead className="text-right">Faturamento</TableHead>
              <TableHead className="text-right">Reembolsos</TableHead>
              <TableHead className="text-right">Taxa</TableHead>
              <TableHead className="text-right">Chargebacks</TableHead>
              <TableHead className="text-right">Taxa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.countries.map((c) => (
              <TableRow key={c.country}>
                <TableCell>{nomePais(c.country)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(c.orders)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {total ? fmtPct((100 * c.orders) / total) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtUsdLinha(c.gross_usd, c.orders)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(c.refunds)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{fmtPct(c.refund_rate)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(c.chargebacks)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{fmtPct(c.chargeback_rate, 2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Painel>
  );
}
