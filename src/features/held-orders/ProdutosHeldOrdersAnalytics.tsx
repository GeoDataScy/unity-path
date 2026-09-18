import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Hourglass,
  Inbox,
  Minus,
  PackageSearch,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { parseReasons } from "./format";
import {
  avaliarSync,
  reasonLabelFromKey,
  resumirEnvelhecimento,
  resumirFluxo,
  type ProdutosHeldOrdersAnalytics as Analytics,
} from "./analytics";
import {
  JANELAS_DISPONIVEIS,
  useProdutosAnalyticsQuery,
  type JanelaDias,
} from "./useProdutosAnalyticsQuery";

// ── Formatação ────────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat("pt-BR");
const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const num = (v: number | null | undefined) => (v == null ? "—" : nf.format(v));
/** Milhar no eixo vira "3,9 mil": rótulo de 4 dígitos não cabe sem roubar o gráfico. */
const eixoNum = (v: number) => (Math.abs(v) >= 1000 ? `${nf1.format(v / 1000)} mil` : nf.format(v));
const dec = (v: number | null | undefined) => (v == null ? "—" : nf1.format(v));
const dia = (iso: string) => format(parseISO(iso), "dd/MM");

// Eixos e grade são recessivos de propósito: quem tem que saltar é a série.
const EIXO = { fontSize: 11, fill: "hsl(var(--chart-axis))" } as const;
const GRADE = "hsl(var(--chart-grid))";

// ── Peças de UI ───────────────────────────────────────────────────────────────

type TileProps = {
  icone: React.ReactNode;
  titulo: string;
  valor: string;
  apoio?: React.ReactNode;
  carregando: boolean;
};

function Tile({ icone, titulo, valor, apoio, carregando }: TileProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {icone} {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {carregando ? (
          <Skeleton className="h-9 w-20" />
        ) : (
          <>
            <div className="text-3xl font-semibold tabular-nums">{valor}</div>
            {apoio && <div className="mt-1 text-xs text-muted-foreground">{apoio}</div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Tooltip padrão: os valores usam tokens de texto, nunca a cor da série. */
function DicaGrafico({
  active,
  payload,
  label,
  rotulos,
  formatarLabel,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; name?: string; value?: number; color?: string }>;
  label?: string;
  rotulos?: Record<string, string>;
  formatarLabel?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      {label != null && (
        <div className="mb-1 font-medium text-popover-foreground">
          {formatarLabel ? formatarLabel(String(label)) : String(label)}
        </div>
      )}
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-muted-foreground">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={{ background: p.color }}
          />
          <span>{rotulos?.[String(p.dataKey)] ?? p.name}</span>
          <span className="ml-auto font-medium tabular-nums text-popover-foreground">
            {num(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {texto}
    </div>
  );
}

// ── Componente ────────────────────────────────────────────────────────────────

export function ProdutosHeldOrdersAnalytics() {
  const [janela, setJanela] = useState<JanelaDias>(90);
  const query = useProdutosAnalyticsQuery(janela);
  const carregando = query.isLoading;
  const dados = query.data as Analytics | undefined;

  const kpis = dados?.kpis;
  const fluxo = useMemo(() => dados?.fluxo ?? [], [dados]);
  const ritmo = useMemo(() => resumirFluxo(fluxo), [fluxo]);
  const envelhecimento = useMemo(
    () => resumirEnvelhecimento(dados?.envelhecimento ?? []),
    [dados],
  );
  const saude = useMemo(() => avaliarSync(dados?.sync ?? null), [dados]);

  const serieFluxo = useMemo(
    () => fluxo.map((p) => ({ ...p, label: dia(p.dia) })),
    [fluxo],
  );

  const motivos = useMemo(
    () =>
      (dados?.motivos ?? []).map((m) => ({
        ...m,
        rotulo: reasonLabelFromKey(m.motivo, parseReasons),
      })),
    [dados],
  );

  const lojas = useMemo(
    () =>
      (dados?.lojas ?? []).slice(0, 10).map((l) => ({
        ...l,
        rotulo: l.loja_nome ? `${l.loja} · ${l.loja_nome}` : l.loja,
      })),
    [dados],
  );

  const faixas = dados?.envelhecimento ?? [];

  if (query.isError) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Não foi possível carregar a análise da fila.
        </CardContent>
      </Card>
    );
  }

  const IconeTendencia =
    ritmo?.tendencia === "subindo" ? TrendingUp
    : ritmo?.tendencia === "drenando" ? TrendingDown
    : Minus;

  const corTendencia =
    ritmo?.tendencia === "subindo" ? "text-rose-600 dark:text-rose-400"
    : ritmo?.tendencia === "drenando" ? "text-emerald-600 dark:text-emerald-400"
    : "text-muted-foreground";

  const frasesTendencia: Record<string, string> = {
    subindo: "entra mais do que sai",
    drenando: "sai mais do que entra",
    estavel: "entradas e saídas se equilibram",
  };

  return (
    <div className="space-y-6">
      {/* Controles + saúde da integração, numa linha só acima dos gráficos */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Período</span>
          <Select value={String(janela)} onValueChange={(v) => setJanela(Number(v) as JanelaDias)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {JANELAS_DISPONIVEIS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  Últimos {d} dias
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs",
            saude.estado === "em-dia" && "text-emerald-700 dark:text-emerald-400",
            saude.estado === "atrasado" && "text-amber-700 dark:text-amber-400",
            (saude.estado === "parado" || saude.estado === "sem-integracao") &&
              "text-rose-700 dark:text-rose-400",
          )}
        >
          {saude.estado === "em-dia" ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden />
          ) : (
            <AlertTriangle className="h-4 w-4" aria-hidden />
          )}
          <span>{saude.descricao}</span>
        </div>
      </div>

      {/* Números-cabeça */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          carregando={carregando}
          icone={<PackageSearch className="h-4 w-4 text-primary" aria-hidden />}
          titulo="Fila aberta"
          valor={num(kpis?.abertos)}
          apoio={
            ritmo && (
              <span className={cn("inline-flex items-center gap-1", corTendencia)}>
                <IconeTendencia className="h-3.5 w-3.5" aria-hidden />
                {ritmo.saldoDiario >= 0 ? "+" : ""}
                {dec(ritmo.saldoDiario)}/dia — {frasesTendencia[ritmo.tendencia]}
              </span>
            )
          }
        />
        <Tile
          carregando={carregando}
          icone={<Clock className="h-4 w-4 text-amber-500" aria-hidden />}
          titulo="Idade da fila (mediana)"
          valor={`${dec(kpis?.idade_p50)} d`}
          apoio={`p90 ${dec(kpis?.idade_p90)} d · máx ${num(kpis?.idade_max)} d`}
        />
        <Tile
          carregando={carregando}
          icone={<Hourglass className="h-4 w-4 text-orange-600" aria-hidden />}
          titulo="Parados há mais de 30 dias"
          valor={num(envelhecimento.cauda)}
          apoio={`${dec(envelhecimento.fracaoCauda * 100)}% da fila aberta`}
        />
        <Tile
          carregando={carregando}
          icone={<Inbox className="h-4 w-4 text-muted-foreground" aria-hidden />}
          titulo="Sem agente"
          valor={num(kpis?.sem_agente)}
          apoio={
            kpis && kpis.abertos > 0
              ? `${dec((kpis.sem_agente / kpis.abertos) * 100)}% da fila aberta`
              : undefined
          }
        />
      </section>

      {/* Fluxo: entradas x saídas. Duas séries na MESMA escala (pedidos/dia).
          O backlog fica no gráfico de baixo, e não como segundo eixo aqui —
          dois eixos y no mesmo gráfico deixam qualquer comparação arbitrária. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Entradas e saídas por dia</CardTitle>
          <p className="text-xs text-muted-foreground">
            Entrada = pedido novo na fila. Saída = concluído pelo agente ou encerrado pelo sync
            porque saiu do on-hold.
          </p>
        </CardHeader>
        <CardContent>
          <div className="h-[260px]">
            {carregando ? (
              <Skeleton className="h-full w-full" />
            ) : serieFluxo.length === 0 ? (
              <Vazio texto="Sem movimento no período" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={serieFluxo} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={GRADE} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={EIXO}
                    tickLine={false}
                    axisLine={{ stroke: GRADE }}
                    minTickGap={28}
                  />
                  <YAxis tick={EIXO} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
                  <Tooltip
                    cursor={{ stroke: GRADE, strokeWidth: 1 }}
                    content={
                      <DicaGrafico rotulos={{ entradas: "Entradas", saidas: "Saídas" }} />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="entradas"
                    name="Entradas"
                    stroke="hsl(var(--ho-in))"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--background))" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="saidas"
                    name="Saídas"
                    stroke="hsl(var(--ho-out))"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--background))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          {/* Legenda sempre presente com 2+ séries: identidade nunca é só a cor. */}
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-0.5 w-4 rounded-full"
                style={{ background: "hsl(var(--ho-in))" }}
              />
              Entradas
              {ritmo && <span className="tabular-nums">· {dec(ritmo.mediaEntradas)}/dia</span>}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-0.5 w-4 rounded-full"
                style={{ background: "hsl(var(--ho-out))" }}
              />
              Saídas
              {ritmo && <span className="tabular-nums">· {dec(ritmo.mediaSaidas)}/dia</span>}
            </span>
            {ritmo && <span>Médias dos últimos {ritmo.diasConsiderados} dias</span>}
          </div>
        </CardContent>
      </Card>

      {/* Backlog acumulado — a curva que responde "está empilhando?" */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Fila acumulada</CardTitle>
          <p className="text-xs text-muted-foreground">
            Estoque de pedidos em aberto ao fim de cada dia, já partindo do que existia antes do
            período.
          </p>
        </CardHeader>
        <CardContent>
          <div className="h-[220px]">
            {carregando ? (
              <Skeleton className="h-full w-full" />
            ) : serieFluxo.length === 0 ? (
              <Vazio texto="Sem histórico no período" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={serieFluxo} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="hoBacklog" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--ho-backlog))" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(var(--ho-backlog))" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRADE} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={EIXO}
                    tickLine={false}
                    axisLine={{ stroke: GRADE }}
                    minTickGap={28}
                  />
                  <YAxis
                    tick={EIXO}
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tickFormatter={eixoNum}
                  />
                  <Tooltip
                    cursor={{ stroke: GRADE, strokeWidth: 1 }}
                    content={<DicaGrafico rotulos={{ backlog: "Fila aberta" }} />}
                  />
                  <Area
                    type="monotone"
                    dataKey="backlog"
                    name="Fila aberta"
                    stroke="hsl(var(--ho-backlog))"
                    strokeWidth={2}
                    fill="url(#hoBacklog)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          {ritmo && (
            <p className="mt-2 text-xs text-muted-foreground">
              {ritmo.diasParaZerar != null
                ? `Mantido o ritmo dos últimos ${ritmo.diasConsiderados} dias, a fila zera em ~${num(ritmo.diasParaZerar)} dias.`
                : `Mantido o ritmo dos últimos ${ritmo.diasConsiderados} dias, a fila não zera: entram ${dec(ritmo.mediaEntradas)}/dia e saem ${dec(ritmo.mediaSaidas)}/dia.`}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        {/* Envelhecimento — rampa sequencial: quanto mais velho, mais escuro (claro)
            ou mais claro (escuro). A ordem das faixas carrega a magnitude. */}
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Envelhecimento da fila</CardTitle>
            <p className="text-xs text-muted-foreground">
              Quantos pedidos abertos em cada faixa de espera. A média esconde a cauda; aqui ela
              aparece.
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {carregando ? (
                <Skeleton className="h-full w-full" />
              ) : envelhecimento.total === 0 ? (
                <Vazio texto="Nenhum pedido aberto" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={faixas}
                    layout="vertical"
                    margin={{ top: 4, right: 40, left: 8, bottom: 0 }}
                    barCategoryGap={6}
                  >
                    <CartesianGrid stroke={GRADE} strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={EIXO} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="faixa"
                      tick={EIXO}
                      tickLine={false}
                      axisLine={false}
                      width={92}
                    />
                    <Tooltip
                      cursor={{ fill: GRADE, fillOpacity: 0.3 }}
                      content={<DicaGrafico rotulos={{ total: "Pedidos" }} />}
                    />
                    <Bar dataKey="total" name="Pedidos" radius={[0, 4, 4, 0]} maxBarSize={22}>
                      {faixas.map((f) => (
                        <Cell key={f.ordem} fill={`hsl(var(--ho-age-${f.ordem}))`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            {!carregando && envelhecimento.total > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {num(envelhecimento.cauda)} pedido(s) — {dec(envelhecimento.fracaoCauda * 100)}% da
                fila — já passaram de 30 dias de espera.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Pareto de motivos — barras ordenadas + % acumulado como rótulo direto.
            O Pareto clássico põe o acumulado num segundo eixo y; aqui ele vira
            texto, porque dois eixos tornam a leitura do cruzamento arbitrária. */}
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Motivos do on-hold</CardTitle>
            <p className="text-xs text-muted-foreground">
              Um pedido pode ter mais de um motivo, então a soma passa do total de pedidos. O % é
              acumulado da maior para a menor causa.
            </p>
          </CardHeader>
          <CardContent>
            {carregando ? (
              <Skeleton className="h-[260px] w-full" />
            ) : motivos.length === 0 ? (
              <div className="h-[260px]">
                <Vazio texto="Sem motivos registrados" />
              </div>
            ) : (
              <ol className="space-y-2">
                {motivos.slice(0, 8).map((m, i) => {
                  const maior = motivos[0].total || 1;
                  return (
                    <li key={m.motivo} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="truncate" title={m.rotulo}>
                          {m.rotulo}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {num(m.total)}
                          {m.pct_acumulado != null && (
                            <span className="ml-2 text-xs">{dec(m.pct_acumulado)}% acum.</span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(2, (m.total / maior) * 100)}%`,
                            // Rampa sequencial: a posição no Pareto é a magnitude.
                            background: `hsl(var(--ho-age-${Math.min(6, i + 1)}))`,
                          }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {num(m.abertos)} em aberto
                        {m.idade_media != null && ` · ${dec(m.idade_media)} d de espera em média`}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Concentração por loja */}
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Onde a fila se concentra</CardTitle>
            <p className="text-xs text-muted-foreground">
              Pedidos abertos por loja (dyna code). O nome do produto aparece quando o lote do
              Wall-E o traz.
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {carregando ? (
                <Skeleton className="h-full w-full" />
              ) : lojas.length === 0 ? (
                <Vazio texto="Nenhuma loja com pedidos abertos" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={lojas}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                    barCategoryGap={6}
                  >
                    <CartesianGrid stroke={GRADE} strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={EIXO} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="rotulo"
                      tick={EIXO}
                      tickLine={false}
                      axisLine={false}
                      width={190}
                    />
                    <Tooltip
                      cursor={{ fill: GRADE, fillOpacity: 0.3 }}
                      content={
                        <DicaGrafico rotulos={{ abertos: "Em aberto", total: "Total histórico" }} />
                      }
                    />
                    <Bar
                      dataKey="abertos"
                      name="Em aberto"
                      fill="hsl(var(--ho-backlog))"
                      radius={[0, 4, 4, 0]}
                      maxBarSize={20}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Geografia — "endereço inválido" é o motivo campeão, então onde ele bate importa */}
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Estados com mais retenção</CardTitle>
            <p className="text-xs text-muted-foreground">
              Pedidos abertos por estado de entrega.
            </p>
          </CardHeader>
          <CardContent>
            {carregando ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (dados?.estados ?? []).length === 0 ? (
              <div className="h-[300px]">
                <Vazio texto="Sem estado informado" />
              </div>
            ) : (
              <ol className="space-y-2">
                {(dados?.estados ?? []).map((e, i) => {
                  const maior = dados!.estados[0].abertos || 1;
                  return (
                    <li key={e.estado} className="flex items-center gap-3 text-sm">
                      <span className="w-10 shrink-0 font-medium">{e.estado}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.max(2, (e.abertos / maior) * 100)}%`,
                            background: `hsl(var(--ho-age-${Math.min(6, i + 1)}))`,
                          }}
                        />
                      </span>
                      <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                        {num(e.abertos)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Rodapé de procedência: de onde vieram estes números */}
      {dados?.sync && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <RefreshCw className="h-4 w-4" aria-hidden /> Último lote do Wall-E
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Referência", dados.sync.referencia],
                ["Recebidos", num(dados.sync.recebidos)],
                ["Criados", num(dados.sync.criados)],
                ["Atualizados", num(dados.sync.atualizados)],
                ["Reabertos", num(dados.sync.reabertos)],
                ["Encerrados", num(dados.sync.encerrados)],
              ].map(([rotulo, valor]) => (
                <div key={rotulo}>
                  <dt className="text-xs text-muted-foreground">{rotulo}</dt>
                  <dd className="tabular-nums font-medium">{valor}</dd>
                </div>
              ))}
            </dl>
            {dados.sync.rejeitados > 0 && (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
                {num(dados.sync.rejeitados)} item(ns) do lote foram recusados por dado faltando.
              </p>
            )}
            {(kpis?.legado_fora_do_sync ?? 0) > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {num(kpis?.legado_fora_do_sync)} pedido(s) abertos ainda não apareceram em nenhum
                lote — vieram do import manual e o encerramento automático não os alcança.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
