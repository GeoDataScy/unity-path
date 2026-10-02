import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { AlertTriangle, Upload } from "lucide-react";
import type { DateRange } from "react-day-picker";

import type { ManagerOutletContext } from "@/layouts/ManagerLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { RefundsSubNav } from "@/components/dashboard/RefundsSubNav";
import { DivergencesTable } from "@/features/external-refunds/DivergencesTable";
import { ImportExternalRefundsDialog } from "@/features/external-refunds/ImportExternalRefundsDialog";
import { ProductBreakdownCards } from "@/features/external-refunds/ProductBreakdownCards";
import { RefundPeriodPicker } from "@/features/external-refunds/RefundPeriodPicker";
import { RefundComposition } from "@/features/external-refunds/RefundComposition";
import { RefundVolumeChart } from "@/features/external-refunds/RefundVolumeChart";
import { TeamShareChart } from "@/features/external-refunds/TeamShareChart";
import { TeamShareKpis } from "@/features/external-refunds/TeamShareKpis";
import { assignProductColors } from "@/features/external-refunds/productColors";
import {
  buildBuckets,
  granularitiesFor,
  hasRefundDate,
  productsInSeries,
  type ChartMetric,
  type Granularity,
} from "@/features/external-refunds/series";
import {
  useDeleteExternalRefundsMutation,
  useExternalRefundComparisonQuery,
} from "@/features/external-refunds/useExternalRefundComparisonQuery";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DEFAULT_PLATFORM,
  EXTERNAL_PLATFORMS,
  fmtDate,
  fmtInt,
  fmtMonth,
  fmtPct,
  fmtUsd,
  type DivergenceFilter,
  type ExternalPlatform,
} from "@/features/external-refunds/types";

const PAGE_SIZE = 25;

// "Todos os meses" = do primeiro export importado até hoje. O intervalo largo
// não pesa: a RPC só olha external_refunds e os refunds dos produtos dela.
const ALL_FROM = "2026-01-01";

const GRAN_LABEL: Record<Granularity, string> = { dia: "Diário", sem: "Semanal", mes: "Mensal" };

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Controle segmentado do layout de referência. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium" style={{ color: "var(--rf-ink-faint)" }}>
        {label}
      </span>
      <div
        className="inline-flex gap-0.5 rounded-xl border p-1"
        role="group"
        aria-label={label}
        style={{ background: "var(--rf-panel-2)", borderColor: "var(--rf-line)" }}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className="rounded-lg px-4 py-2 text-[13.5px] font-medium transition-colors"
              style={{
                background: on ? "var(--rf-panel)" : "transparent",
                color: on ? "var(--rf-ink)" : "var(--rf-ink-soft)",
                boxShadow: on ? "var(--rf-shadow)" : undefined,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border ${className}`}
      style={{ background: "var(--rf-panel)", borderColor: "var(--rf-line)", boxShadow: "var(--rf-shadow)" }}
    >
      {children}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Panel className="px-[18px] py-4">
      <div className="text-xs font-medium" style={{ color: "var(--rf-ink-faint)" }}>
        {label}
      </div>
      <div
        className="rf-display mt-1 text-[clamp(19px,2.2vw,22px)] font-medium leading-tight font-mono tabular-nums"
        style={{ color: "var(--rf-ink)" }}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs" style={{ color: "var(--rf-ink-soft)" }}>
          {sub}
        </div>
      )}
    </Panel>
  );
}

export default function DashboardRefundsComparativo() {
  const { role } = useOutletContext<ManagerOutletContext>();
  const isManager = role === "manager";

  // undefined = todo o período importado. O gestor escolhe um intervalo de dias
  // para reproduzir exatamente a janela de um relatório.
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [product, setProduct] = useState<string>("all");
  const [platform, setPlatform] = useState<ExternalPlatform>(DEFAULT_PLATFORM);
  const [kind, setKind] = useState<DivergenceFilter>("all");
  // Nasce no mais fino que a plataforma permite, como o painel de referência:
  // "Diário" onde existe data de reembolso, "Mensal" onde só existe a da compra.
  const [gran, setGran] = useState<Granularity>("dia");
  const [metric, setMetric] = useState<ChartMetric>("qtd");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const { toast } = useToast();
  const deleteMutation = useDeleteExternalRefundsMutation();

  useEffect(() => {
    setPage(1);
  }, [range, product, platform, kind]);

  // Plataforma sem data de reembolso no arquivo só pode ser lida por mês: ali
  // "por dia" seria a data da COMPRA, outra pergunta. Ao trocar de plataforma o
  // controle se ajusta sozinho em vez de oferecer uma opção que mente.
  const grans = useMemo(() => granularitiesFor(platform), [platform]);
  useEffect(() => {
    if (!grans.includes(gran)) setGran(grans[grans.length - 1]);
  }, [grans, gran]);

  // Enquanto só o primeiro dia foi clicado o intervalo fica incompleto: mantém
  // o período inteiro em vez de consultar com meia escolha.
  const { from, to } = useMemo(() => {
    if (range?.from && range.to) return { from: toISO(range.from), to: toISO(range.to) };
    return { from: ALL_FROM, to: todayISO() };
  }, [range]);

  const query = useExternalRefundComparisonQuery({
    from,
    to,
    product,
    platform,
    divergenceFilter: kind,
    page,
    pageSize: PAGE_SIZE,
  });
  const data = query.data;
  const isLoading = query.isLoading;
  const summary = data?.summary;
  const series = useMemo(() => data?.series ?? [], [data?.series]);

  const products = useMemo(() => assignProductColors(productsInSeries(series)), [series]);
  const buckets = useMemo(() => buildBuckets(series, gran, metric, hidden), [series, gran, metric, hidden]);

  const monthOptions = useMemo(() => {
    const set = new Set((data?.imports ?? []).map((b) => b.month_ref.slice(0, 7)));
    return Array.from(set).sort();
  }, [data?.imports]);

  const productOptions = useMemo(() => (data?.products ?? []).map((p) => p.product), [data?.products]);
  const hasImports = (data?.imports?.length ?? 0) > 0;
  const totalPages = Math.max(1, Math.ceil((data?.divergences.total_count ?? 0) / PAGE_SIZE));

  // KPIs do topo, na mesma decomposição do painel de referência.
  const kpis = useMemo(() => {
    const totOrders = series.reduce((s, r) => s + r.orders, 0);
    const totAmount = series.reduce((s, r) => s + Number(r.amount), 0);
    // O pico e a contagem de períodos seguem a régua do arquivo: por DIA onde
    // existe data de reembolso, por MÊS onde só existe a data da compra. Somar
    // por dia e rotular "meses" diria que a Cartpanda teve 60 meses com
    // reembolso.
    const porDia = hasRefundDate(platform);
    const perDate = new Map<string, number>();
    for (const r of series) {
      const k = porDia ? r.date : r.date.slice(0, 7);
      perDate.set(k, (perDate.get(k) ?? 0) + r.orders);
    }
    let peakDate: string | null = null;
    let peak = 0;
    for (const [d, n] of perDate) if (n > peak) [peak, peakDate] = [n, d];
    const perProduct = new Map<string, number>();
    for (const r of series) perProduct.set(r.product, (perProduct.get(r.product) ?? 0) + r.orders);
    let leader: string | null = null;
    let leaderN = 0;
    for (const [p, n] of perProduct) if (n > leaderN) [leaderN, leader] = [n, p];
    const dates = [...new Set(series.map((r) => r.date))].sort();
    return {
      totOrders,
      totAmount,
      peak,
      peakDate,
      leader,
      leaderN,
      days: perDate.size,
      first: dates[0],
      last: dates[dates.length - 1],
    };
  }, [series, platform]);

  const periodLabel = kpis.first ? `${fmtDate(kpis.first)} – ${fmtDate(kpis.last)}` : "sem dados importados";

  const handleDelete = async () => {
    if (!productToDelete) return;
    try {
      const r = await deleteMutation.mutateAsync({ product: productToDelete, platform });
      toast({
        title: "Reembolsos externos apagados",
        description: `${productToDelete} (${platform}): ${fmtInt(r.deleted)} linha(s) removida(s).`,
      });
      if (product === productToDelete) setProduct("all");
    } catch (e) {
      toast({
        title: "Erro ao apagar",
        description: e instanceof Error ? e.message : "Não foi possível apagar.",
        variant: "destructive",
      });
    } finally {
      setProductToDelete(null);
    }
  };

  const toggleProduct = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filtros: { lab: string; node: React.ReactNode }[] = [
    {
      lab: "Plataforma",
      node: (
        <Select value={platform} onValueChange={(v) => setPlatform(v as ExternalPlatform)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXTERNAL_PLATFORMS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      lab: "Produto",
      node: (
        <Select value={product} onValueChange={setProduct}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos com reembolso externo</SelectItem>
            {productOptions.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      lab: "Lista de pedidos",
      node: (
        <Select value={kind} onValueChange={(v) => setKind(v as DivergenceFilter)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os pedidos</SelectItem>
            <SelectItem value="ambos">Nos dois lados</SelectItem>
            <SelectItem value="externo">Só externo</SelectItem>
            <SelectItem value="interno">Só interno</SelectItem>
            <SelectItem value="tipo">Parcial × integral divergem</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
  ];

  return (
    <div
      className="refunds-visual rf-body -m-4 min-h-full p-4 sm:-m-6 sm:p-6"
      style={{ background: "var(--rf-bg)", color: "var(--rf-ink)" }}
    >
      <div className="mx-auto max-w-[1080px] space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <RefundsSubNav />
            <h1 className="rf-display text-[clamp(24px,4.5vw,34px)] font-medium leading-none" style={{ color: "var(--rf-ink)" }}>
              Volume de reembolsos
            </h1>
            <p className="max-w-[52ch] text-sm" style={{ color: "var(--rf-ink-soft)" }}>
              Reembolsos executados pela plataforma, segmentados por produto.{" "}
              {hasRefundDate(platform)
                ? "Alterne entre visão diária, semanal e mensal, e entre quantidade e valor."
                : "O arquivo desta plataforma traz a data da compra, não a do reembolso — por isso só a visão mensal."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RefundPeriodPicker
              value={range}
              onChange={setRange}
              months={monthOptions}
              fallbackLabel={periodLabel}
              firstDate={kpis.first}
            />
            {isManager && (
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" /> Importar
              </Button>
            )}
          </div>
        </header>

        {query.isError && (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Não foi possível carregar: {(query.error as Error)?.message ?? "erro desconhecido"}.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {filtros.map((f) => (
            <div key={f.lab} className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-[0.06em]" style={{ color: "var(--rf-ink-faint)" }}>
                {f.lab}
              </div>
              {f.node}
            </div>
          ))}
        </div>

        {!isLoading && !hasImports && (
          <Panel className="px-6 py-10 text-center text-sm">
            <span style={{ color: "var(--rf-ink-soft)" }}>
              Nenhum reembolso externo de {platform} foi importado ainda.
              {isManager ? " Use o botão “Importar” para começar." : ""}
            </span>
          </Panel>
        )}

        <section className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
          {isLoading ? (
            [...Array(5)].map((_, i) => <Skeleton key={i} className="h-[104px] rounded-2xl" />)
          ) : (
            <>
              <Kpi
                label="Reembolsos no período"
                value={fmtInt(kpis.totOrders)}
                sub={`${fmtInt(kpis.days)} ${hasRefundDate(platform) ? "dias" : "meses"} com reembolso`}
              />
              <Kpi
                label="Valor total reembolsado"
                value={fmtUsd(kpis.totAmount)}
                sub={kpis.totOrders > 0 ? `média ${fmtUsd(kpis.totAmount / kpis.totOrders)}/reemb.` : undefined}
              />
              <Kpi
                label="% interno"
                value={summary?.internal_pct === null || summary?.internal_pct === undefined ? "—" : fmtPct(summary.internal_pct)}
                sub={
                  summary?.external_pct === null || summary?.external_pct === undefined
                    ? "sem arquivo no período"
                    : `${fmtPct(summary.external_pct)} externo · ${fmtInt(summary.matched_count)} de ${fmtInt(summary.external_count)} pedidos`
                }
              />
              <Kpi
                label={hasRefundDate(platform) ? "Pico em um único dia" : "Pico em um único mês"}
                value={fmtInt(kpis.peak)}
                sub={kpis.peakDate ? (hasRefundDate(platform) ? fmtDate(kpis.peakDate) : fmtMonth(kpis.peakDate)) : undefined}
              />
              <Kpi
                label="Produto líder"
                value={<span className="text-[22px]">{kpis.leader ?? "—"}</span>}
                sub={kpis.leader ? `${fmtInt(kpis.leaderN)} reembolsos` : undefined}
              />
            </>
          )}
        </section>

        {summary?.inconsistent && (
          <p
            className="flex items-start gap-2 rounded-xl border px-3 py-2 text-xs"
            style={{ borderColor: "var(--rf-trend)", color: "var(--rf-ink-soft)", background: "var(--rf-panel)" }}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--rf-trend)" }} />
            O volume interno do período é maior que o arquivo importado. Não quebra a conta — casados nunca passam do
            total —, mas indica arquivo velho ou faltando para esse recorte.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="agrupar por"
            value={gran}
            onChange={(v) => setGran(v)}
            options={grans.map((g) => ({ value: g, label: GRAN_LABEL[g] }))}
          />
          <Segmented
            label="medir"
            value={metric}
            onChange={(v) => setMetric(v)}
            options={[
              { value: "qtd" as ChartMetric, label: "Quantidade" },
              { value: "valor" as ChartMetric, label: "Valor (US$)" },
            ]}
          />
        </div>

        <Panel className="px-2 pb-3 pt-5">
          <div className="flex items-baseline justify-between gap-3 px-3.5 pb-1.5">
            <span className="rf-display text-[15px] font-medium" style={{ color: "var(--rf-ink)" }}>
              Reembolsos por {gran === "dia" ? "dia" : gran === "sem" ? "semana" : "mês"}
            </span>
            {gran === "dia" && (
              <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--rf-ink-faint)" }}>
                <span className="inline-block h-0.5 w-5 rounded" style={{ background: "var(--rf-ma)" }} />
                média móvel 7 dias
              </span>
            )}
          </div>
          {isLoading ? (
            <Skeleton className="mx-3 h-[320px]" />
          ) : (
            <RefundVolumeChart buckets={buckets} products={products} metric={metric} gran={gran} hidden={hidden} />
          )}
          <div className="flex flex-wrap gap-2 px-4 pb-1 pt-3.5">
            {products.map((p) => {
              const on = !hidden.has(p.key);
              const tot = series
                .filter((r) => r.product === p.key)
                .reduce((s, r) => s + (metric === "qtd" ? r.orders : Number(r.amount)), 0);
              return (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleProduct(p.key)}
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-opacity"
                  style={{
                    background: "var(--rf-panel-2)",
                    borderColor: "var(--rf-line)",
                    color: "var(--rf-ink)",
                    opacity: on ? 1 : 0.42,
                  }}
                >
                  <span className="h-3 w-3 rounded" style={{ background: p.color }} />
                  {p.key}
                  <span className="font-mono tabular-nums" style={{ color: "var(--rf-ink-faint)" }}>
                    {metric === "qtd" ? fmtInt(tot) : fmtUsd(tot)}
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>

        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="rf-display text-lg font-medium" style={{ color: "var(--rf-ink)" }}>
              Migração do atendimento: sua equipe × plataforma
            </h2>
            <span className="text-xs" style={{ color: "var(--rf-ink-faint)" }}>
              acompanha a granularidade escolhida acima
            </span>
          </div>
          <Panel className="px-2 pb-4 pt-4">
            {isLoading ? (
              <>
                <div className="mb-[18px] grid gap-3.5 px-3 sm:grid-cols-3">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-[92px] rounded-[14px]" />
                  ))}
                </div>
                <Skeleton className="mx-3 h-[220px]" />
              </>
            ) : (
              <>
                <TeamShareKpis series={series} />
                <TeamShareChart buckets={buckets} gran={gran} overallPct={summary?.internal_pct ?? null} />
              </>
            )}
            <div className="flex flex-wrap gap-4 px-4 pt-3 text-xs" style={{ color: "var(--rf-ink-soft)" }}>
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded" style={{ background: "var(--rf-equipe)" }} /> % atendido pela sua equipe
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-0 w-5 border-t-2 border-dashed" style={{ borderColor: "var(--rf-trend)" }} />{" "}
                tendência
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-0 w-5 border-t" style={{ borderColor: "var(--rf-ink-faint)" }} /> média do
                período
              </span>
            </div>
          </Panel>
        </section>

        <section className="space-y-3">
          <h2 className="rf-display text-lg font-medium" style={{ color: "var(--rf-ink)" }}>
            Composição: parciais × integrais
          </h2>
          <Panel className="p-4">
            {isLoading || !summary ? (
              <Skeleton className="h-11 rounded-xl" />
            ) : (
              <>
                <RefundComposition
                  full={summary.external_full}
                  partial={summary.external_partial}
                  unspecified={Math.max(summary.external_count - summary.external_full - summary.external_partial, 0)}
                />
                <p className="mt-3 text-xs" style={{ color: "var(--rf-ink-faint)" }}>
                  “Sem tipo no arquivo” é o pedido que a plataforma confirma como reembolsado sem dizer se foi integral ou
                  parcial. Conta no total e nas porcentagens, que não usam o tipo. Chargeback sem reembolso não entra na
                  base.
                </p>
              </>
            )}
          </Panel>
        </section>

        <section className="space-y-3">
          <h2 className="rf-display text-lg font-medium" style={{ color: "var(--rf-ink)" }}>
            Por produto no período
          </h2>
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-[190px] rounded-2xl" />
              ))}
            </div>
          ) : (
            <ProductBreakdownCards series={series} products={products} metric={metric} />
          )}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="rf-display text-lg font-medium" style={{ color: "var(--rf-ink)" }}>
              Pedido a pedido
            </h2>
            <span className="text-xs" style={{ color: "var(--rf-ink-faint)" }}>
              {fmtInt(data?.divergences.total_count ?? 0)} pedido(s) no filtro escolhido
            </span>
          </div>
          <Panel className="overflow-hidden">
            <DivergencesTable rows={data?.divergences.rows ?? []} isLoading={isLoading} />
          </Panel>
          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setPage((p) => Math.max(1, p - 1));
                    }}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#" isActive>
                    {page}
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setPage((p) => Math.min(totalPages, p + 1));
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </section>

        {hasImports && (
          <section className="space-y-3">
            <h2 className="rf-display text-lg font-medium" style={{ color: "var(--rf-ink)" }}>
              Arquivos importados
            </h2>
            <Panel>
              {(data?.imports ?? []).map((b, i) => (
                <div
                  key={`${b.platform}-${b.product}-${b.month_ref}-${b.source_file}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                  style={{ borderTop: i === 0 ? undefined : "1px solid var(--rf-line)" }}
                >
                  <span style={{ color: "var(--rf-ink)" }}>
                    {b.product} · {fmtMonth(b.month_ref.slice(0, 7))}
                  </span>
                  <span className="font-mono tabular-nums" style={{ color: "var(--rf-ink-faint)" }}>
                    {fmtInt(b.orders)} pedido(s) · importado em {fmtDate(b.imported_at)}
                  </span>
                  {isManager && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setProductToDelete(b.product)}
                      aria-label={`Apagar reembolsos externos de ${b.product}`}
                    >
                      Apagar
                    </Button>
                  )}
                </div>
              ))}
            </Panel>
          </section>
        )}

        <footer className="pb-6 text-xs leading-relaxed" style={{ color: "var(--rf-ink-faint)" }}>
          <b>Base:</b> reembolsos executados pela plataforma, do arquivo importado, sem os chargebacks. Data usada:{" "}
          {hasRefundDate(platform) ? "a do reembolso" : "a da compra, única que o arquivo desta plataforma traz"}.
          <br />
          <b>% interno:</b> dos pedidos que a plataforma reembolsou, quantos passaram pelo nosso time — casamento pelo
          número do pedido contra a base interna. <b>% externo</b> é o restante; os dois somam 100%.
          <br />
          <b>Leitura:</b> passe o cursor nas barras para ver o detalhe; clique num produto na legenda para tirá-lo da
          conta.
        </footer>
      </div>

      <ImportExternalRefundsDialog open={importOpen} onOpenChange={setImportOpen} />

      <AlertDialog open={Boolean(productToDelete)} onOpenChange={(o) => !o && setProductToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar reembolsos externos de {productToDelete}?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove todas as linhas importadas desse produto na plataforma {platform}. Você pode importar o arquivo de
              novo depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
