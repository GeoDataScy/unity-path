import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Filter, Minus, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MixEvolutionPanels } from "@/features/copy/components/MixEvolutionPanels";
import { ExchangeRateNote } from "@/features/copy/components/ExchangeRateNote";
import { ReasonEvidenceModal } from "@/features/copy/components/ReasonEvidenceModal";
import { ShareBar } from "@/features/copy/components/ShareBar";
import { fmtDays, fmtInt, fmtISODate, fmtMoney, fmtPct, fmtSigned } from "@/features/copy/format";
import { useCopyRefundAnalyticsQuery } from "@/features/copy/useCopyRefundAnalyticsQuery";
import type { CopyOutletContext } from "@/layouts/CopyLayout";
import { supabaseErrorMessage } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";

/** Motivos que são ausência de informação, não motivo — separados nas leituras. */
const NAO_DECLARADOS = new Set(["Outros", "Follow up (sem motivo declarado)"]);

/** Piso de volume para chamar sobre-representação de sinal em vez de ruído. */
const LIFT_MIN_N = 8;
const LIFT_MIN = 1.3;

function DeltaBadge({ value, suffix }: { value: number | null; suffix: string }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }

  const Icon = value > 0.05 ? ArrowUpRight : value < -0.05 ? ArrowDownRight : Minus;
  const tone =
    value > 0.05
      ? "text-[hsl(var(--chart-danger))]"
      : value < -0.05
        ? "text-[hsl(var(--chart-success))]"
        : "text-muted-foreground";

  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums", tone)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {fmtSigned(value, suffix)}
    </span>
  );
}

function KpiCard({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

export default function CopyMotivos() {
  const { fullName, role, fromISO, toISO } = useOutletContext<CopyOutletContext>();

  const [product, setProduct] = useState("all");
  const [platform, setPlatform] = useState("all");
  const [channel, setChannel] = useState("all");
  const [selectedReason, setSelectedReason] = useState<string | null>(null);

  const query = useCopyRefundAnalyticsQuery({ from: fromISO, to: toISO, product, platform, channel });
  const data = query.data;

  // Filtro que ficou sem nenhuma linha no novo período viraria um recorte vazio
  // permanente — some da lista, então volta para "todos".
  useEffect(() => {
    if (!data) return;
    if (product !== "all" && !data.filters.products.includes(product)) setProduct("all");
    if (platform !== "all" && !data.filters.platforms.includes(platform)) setPlatform("all");
    if (channel !== "all" && !data.filters.channels.includes(channel)) setChannel("all");
  }, [data, product, platform, channel]);

  const hasFilter = product !== "all" || platform !== "all" || channel !== "all";

  const reasons = useMemo(() => data?.by_reason ?? [], [data?.by_reason]);
  const maxReasonShare = useMemo(() => Math.max(1, ...reasons.map((r) => r.share ?? 0)), [reasons]);

  const declaredReasons = useMemo(() => reasons.filter((r) => !NAO_DECLARADOS.has(r.category)), [reasons]);

  const topCategories = useMemo(() => declaredReasons.slice(0, 4).map((r) => r.category), [declaredReasons]);

  const topProducts = useMemo(() => (data?.by_product ?? []).slice(0, 12), [data?.by_product]);
  const maxProductN = useMemo(() => Math.max(1, ...topProducts.map((p) => p.n)), [topProducts]);

  // "Sinal de copy": o produto puxa um motivo bem acima da média do período.
  const copySignals = useMemo(() => {
    const rows = (data?.reason_by_product ?? []).filter(
      (row) =>
        row.n >= LIFT_MIN_N &&
        (row.lift ?? 0) >= LIFT_MIN &&
        !NAO_DECLARADOS.has(row.category),
    );
    return rows.sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0)).slice(0, 12);
  }, [data?.reason_by_product]);

  const maxPlatform = useMemo(() => Math.max(1, ...(data?.by_platform ?? []).map((r) => r.n)), [data?.by_platform]);
  const maxChannel = useMemo(() => Math.max(1, ...(data?.by_channel ?? []).map((r) => r.n)), [data?.by_channel]);

  if (query.isError) {
    return (
      <div className="mx-auto max-w-7xl p-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Não foi possível carregar os motivos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>{supabaseErrorMessage(query.error, "Erro ao consultar o banco.")}</p>
            <Button variant="secondary" onClick={() => query.refetch()}>
              Tentar de novo
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Motivos de reembolso
          {fullName ? <span className="ml-2 text-base font-normal text-muted-foreground">Olá, {fullName}</span> : null}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Por que o cliente pediu o dinheiro de volta — e o que isso diz sobre a promessa feita na copy. Só
          reembolsos <strong>concluídos</strong> entre {fmtISODate(fromISO)} e {fmtISODate(toISO)} (o motivo passa a
          existir na baixa). Comparações usam o período anterior de mesma duração
          {data ? `: ${fmtISODate(data.period.prev_from)} a ${fmtISODate(data.period.prev_to)}` : ""}.
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="h-4 w-4" />
            Recorte
          </div>

          <div className="min-w-[180px] space-y-1">
            <label className="text-xs text-muted-foreground">Produto</label>
            <Select value={product} onValueChange={setProduct}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os produtos</SelectItem>
                {(data?.filters.products ?? []).map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[180px] space-y-1">
            <label className="text-xs text-muted-foreground">Plataforma</label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as plataformas</SelectItem>
                {(data?.filters.platforms ?? []).map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[160px] space-y-1">
            <label className="text-xs text-muted-foreground">Canal</label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os canais</SelectItem>
                {(data?.filters.channels ?? []).map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasFilter && (
            <Button
              variant="ghost"
              onClick={() => {
                setProduct("all");
                setPlatform("all");
                setChannel("all");
              }}
            >
              Limpar
            </Button>
          )}
        </CardContent>
      </Card>

      {query.isLoading || !data ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      ) : data.universe.concluidos === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nenhum reembolso concluído neste recorte</CardTitle>
            <CardDescription>
              Amplie o período no menu lateral ou limpe os filtros. Reembolsos ainda em aberto não entram aqui
              porque o motivo só é escolhido na baixa
              {data.universe.em_aberto > 0
                ? ` — hoje há ${fmtInt(data.universe.em_aberto)} em aberto no período.`
                : "."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              label="Reembolsos concluídos"
              value={fmtInt(data.universe.concluidos)}
              hint={`${fmtInt(data.universe.concluidos_periodo_anterior)} no período anterior`}
            >
              <div className="mt-1 text-xs">
                <DeltaBadge value={data.universe.variacao_volume_pct} suffix="%" />
              </div>
            </KpiCard>

            <KpiCard
              label="Valor devolvido"
              value={fmtMoney(data.kpis.valor_devolvido)}
              hint={`${fmtPct(data.kpis.devolvido_pct)} dos ${fmtMoney(data.kpis.valor_pedidos)} em pedidos reembolsados`}
            />

            <KpiCard
              label="Ticket médio do pedido"
              value={fmtMoney(data.kpis.ticket_medio_pedido)}
              hint={`Retenção de ${fmtPct(data.kpis.retencao_pct)} do valor (reembolso parcial)`}
            />

            <KpiCard
              label="Motivo declarado"
              value={fmtPct(data.universe.cobertura_pct)}
              hint={`${fmtInt(data.universe.sem_motivo_declarado)} sem motivo real ("Outros" ou follow up)`}
            />

            <KpiCard
              label="Tempo até a baixa"
              value={fmtDays(data.kpis.dias_mediano)}
              hint={`Mediana. ${fmtInt(data.universe.em_aberto)} pedido(s) de reembolso ainda em aberto no período`}
            />
          </section>

          <ExchangeRateNote
            rate={data.cotacao?.usd_brl ?? null}
            updatedAt={data.cotacao?.atualizada_em ?? null}
            canEdit={role === "manager"}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mix de motivos</CardTitle>
              <CardDescription>
                Participação de cada motivo no período e quanto ela mudou em pontos percentuais contra o período
                anterior. Clique numa linha para ver o texto por trás do motivo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Motivo</TableHead>
                      <TableHead className="w-[140px]">Participação</TableHead>
                      <TableHead className="w-20 text-right">Share</TableHead>
                      <TableHead className="w-24 text-right">Reembolsos</TableHead>
                      <TableHead className="w-28 text-right">Δ vs anterior</TableHead>
                      <TableHead className="w-32 text-right">Valor devolvido</TableHead>
                      <TableHead className="w-24 text-right">% devolvido</TableHead>
                      <TableHead className="w-24 text-right">Até a baixa</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reasons.map((row) => (
                      <TableRow
                        key={row.category}
                        className="cursor-pointer"
                        onClick={() => setSelectedReason(row.category)}
                      >
                        <TableCell className="font-medium">
                          {row.category}
                          {NAO_DECLARADOS.has(row.category) && (
                            <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                              sem motivo declarado
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <ShareBar value={row.share} max={maxReasonShare} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(row.share)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(row.n)}</TableCell>
                        <TableCell className="text-right text-xs">
                          <DeltaBadge value={row.delta_pp} suffix=" p.p." />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(row.refunded_value)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(row.devolvido_pct)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtDays(row.dias_mediano)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {topCategories.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Evolução do mix, mês a mês</CardTitle>
                <CardDescription>
                  Participação dos quatro maiores motivos declarados dentro de cada mês do período. Escala
                  compartilhada entre os painéis.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MixEvolutionPanels rows={data.reason_monthly} categories={topCategories} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Produtos que mais devolvem</CardTitle>
              <CardDescription>
                Volume de reembolso concluído por produto e o motivo dominante de cada um.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="w-[140px]">Volume</TableHead>
                      <TableHead className="w-24 text-right">Reembolsos</TableHead>
                      <TableHead className="w-20 text-right">Share</TableHead>
                      <TableHead className="w-32 text-right">Valor devolvido</TableHead>
                      <TableHead className="w-24 text-right">% devolvido</TableHead>
                      <TableHead>Motivo dominante</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topProducts.map((row) => (
                      <TableRow key={row.product}>
                        <TableCell className="font-medium">{row.product}</TableCell>
                        <TableCell>
                          <ShareBar value={row.n} max={maxProductN} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(row.n)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(row.share)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(row.refunded_value)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(row.devolvido_pct)}</TableCell>
                        <TableCell className="text-sm">
                          {row.top_reason ? (
                            <span className="text-muted-foreground">
                              {row.top_reason}{" "}
                              <span className="tabular-nums">({fmtPct(row.top_reason_share)})</span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-primary" />
                Sinais de copy
              </CardTitle>
              <CardDescription>
                Pares produto × motivo em que o motivo pesa bem mais do que a média do período — é onde a
                promessa da página tende a estar descolada do que o cliente recebe. Só pares com pelo menos{" "}
                {LIFT_MIN_N} reembolsos e índice a partir de {LIFT_MIN.toLocaleString("pt-BR")}× (produtos com ao
                menos 10 reembolsos no período).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {copySignals.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum produto concentra um motivo acima da média neste recorte — o mix de motivos está
                  parecido entre os produtos.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead>Motivo</TableHead>
                        <TableHead className="w-24 text-right">Reembolsos</TableHead>
                        <TableHead className="w-28 text-right">No produto</TableHead>
                        <TableHead className="w-28 text-right">Média geral</TableHead>
                        <TableHead className="w-20 text-right">Índice</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {copySignals.map((row) => (
                        <TableRow
                          key={`${row.product}|${row.category}`}
                          className="cursor-pointer"
                          onClick={() => setSelectedReason(row.category)}
                        >
                          <TableCell className="font-medium">{row.product}</TableCell>
                          <TableCell>{row.category}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtInt(row.n)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtPct(row.share_in_product)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {fmtPct(row.baseline_share)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {row.lift?.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Plataforma de venda</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {data.by_platform.map((row) => (
                    <li key={row.name} className="flex items-center gap-3 text-sm">
                      <span className="w-36 shrink-0 truncate" title={row.name}>
                        {row.name}
                      </span>
                      <ShareBar value={row.n} max={maxPlatform} />
                      <span className="w-24 shrink-0 text-right tabular-nums">
                        {fmtInt(row.n)}{" "}
                        <span className="text-muted-foreground">({fmtPct(row.share)})</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Canal de atendimento</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {data.by_channel.map((row) => (
                    <li key={row.name} className="flex items-center gap-3 text-sm">
                      <span className="w-36 shrink-0 truncate" title={row.name}>
                        {row.name}
                      </span>
                      <ShareBar value={row.n} max={maxChannel} />
                      <span className="w-24 shrink-0 text-right tabular-nums">
                        {fmtInt(row.n)}{" "}
                        <span className="text-muted-foreground">({fmtPct(row.share)})</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <ReasonEvidenceModal
        category={selectedReason}
        onClose={() => setSelectedReason(null)}
        from={fromISO}
        to={toISO}
        product={product}
        platform={platform}
        channel={channel}
      />
    </div>
  );
}
