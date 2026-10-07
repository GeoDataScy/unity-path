import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Download, FlaskConical, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PanelPagination } from "@/features/support-base/components/PanelPagination";
import { FilterMultiSelect } from "@/features/late-hunter/components/FilterMultiSelect";
import { LateHunterKpis, SyncStatus } from "@/features/late-hunter/components/LateHunterSummary";
import { AgingChart, FlowChart, ReasonsChart, StoresChart } from "@/features/late-hunter/components/LateHunterCharts";
import { LateHunterTable } from "@/features/late-hunter/components/LateHunterTable";
import { LateHunterOrderSheet } from "@/features/late-hunter/components/LateHunterOrderSheet";
import { exportLateHunter } from "@/features/late-hunter/exportLateHunter";
import { FAIXAS, LIMITE_ANTIGO, formatCount, motivoLabel, paisLabel } from "@/features/late-hunter/format";
import { useLateHunterListQuery, useLateHunterOverviewQuery } from "@/features/late-hunter/useLateHunterQueries";
import type {
  LateHunterAmbiente,
  LateHunterFaixa,
  LateHunterFiltros,
  LateHunterOrdem,
  LateHunterOrder,
  LateHunterSituacao,
} from "@/features/late-hunter/types";

// Late Hunter — a aba principal do time de produtos. Os pedidos em on-hold da
// ShipOffers chegam a cada varredura do Late Hunter (Edge Function late-hunter-sync)
// e ficam numa base própria, separada dos Pedidos em Espera dos agentes.
//
// A tela responde, de cima para baixo: o dado é de hoje? (sync) · quanto tem e
// está crescendo? (cartões + fila por dia) · o que está velho? (envelhecimento)
// · por quê e onde? (motivos, lojas) · quais são? (tabela). Todo gráfico é
// também um filtro da tabela, para a pergunta seguinte ser um clique.

type Espera = LateHunterFaixa | "mais30" | "todos";

const ORDEM_LABEL: Record<LateHunterOrdem, string> = {
  dias_desc: "Mais tempo em espera",
  dias_asc: "Menos tempo em espera",
  data_desc: "Pedido mais recente",
  data_asc: "Pedido mais antigo",
  recentes: "Entraram por último",
  encerrados: "Saíram por último",
};

const SITUACOES: { value: LateHunterSituacao | "todos"; label: string }[] = [
  { value: "aberto", label: "Em on-hold" },
  { value: "encerrado", label: "Saíram" },
  { value: "todos", label: "Todos" },
];

const POR_PAGINA = [25, 50, 100];

function faixaDias(espera: Espera): { diasMin: number | null; diasMax: number | null } {
  if (espera === "todos") return { diasMin: null, diasMax: null };
  if (espera === "mais30") return { diasMin: LIMITE_ANTIGO + 1, diasMax: null };
  const f = FAIXAS.find((x) => x.key === espera);
  return { diasMin: f?.min ?? null, diasMax: f?.max ?? null };
}

/**
 * O <input type="date"> entrega o valor a cada tecla: "0002-10-02" enquanto a
 * pessoa digita o ano. Só vale como filtro uma data completa e plausível.
 */
function dataPlausivel(v: string): string | null {
  return /^(19|20)\d{2}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function ProdutosLateHunter() {
  const [ambiente, setAmbiente] = useState<LateHunterAmbiente>("producao");
  const [situacao, setSituacao] = useState<LateHunterSituacao | "todos">("aberto");
  const [motivos, setMotivos] = useState<string[]>([]);
  const [lojas, setLojas] = useState<string[]>([]);
  const [paises, setPaises] = useState<string[]>([]);
  const [espera, setEspera] = useState<Espera>("todos");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [reabertos, setReabertos] = useState(false);
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<LateHunterOrdem>("dias_desc");
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50);
  const [aberto, setAberto] = useState<LateHunterOrder | null>(null);
  const [exportando, setExportando] = useState(false);

  const buscaDebounced = useDebounced(busca, 300);

  const filtros = useMemo<LateHunterFiltros>(
    () => ({
      situacao,
      motivos,
      lojas,
      paises,
      ...faixaDias(espera),
      dataDe: dataPlausivel(dataDe),
      dataAte: dataPlausivel(dataAte),
      reabertos,
      busca: buscaDebounced,
      // "Saíram por último" só faz sentido com quem saiu.
      ordem: ordem === "encerrados" && situacao === "aberto" ? "dias_desc" : ordem,
    }),
    [situacao, motivos, lojas, paises, espera, dataDe, dataAte, reabertos, buscaDebounced, ordem],
  );

  // Qualquer filtro (ou o ambiente) volta para a página 1.
  const assinatura = JSON.stringify([ambiente, filtros, porPagina]);
  useEffect(() => setPagina(1), [assinatura]);

  const overviewQuery = useLateHunterOverviewQuery(ambiente);
  const listQuery = useLateHunterListQuery(ambiente, filtros, pagina, porPagina);
  const overview = overviewQuery.data;
  const semSync = !overviewQuery.isLoading && !overviewQuery.isError && !overview?.ultimo_sync;

  const total = listQuery.data?.total ?? 0;
  const rows = listQuery.data?.rows ?? [];
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

  const motivoOptions = useMemo(
    () => (overview?.motivos ?? []).map((m) => ({ value: m.motivo, label: motivoLabel(m.motivo), count: m.abertos })),
    [overview],
  );
  const lojaOptions = useMemo(
    () =>
      (overview?.lojas ?? []).map((l) => ({
        value: l.loja,
        label: l.loja_nome ? `${l.loja} · ${l.loja_nome}` : l.loja,
        count: l.abertos,
      })),
    [overview],
  );
  const paisOptions = useMemo(
    () => (overview?.paises ?? []).map((p) => ({ value: p.pais, label: paisLabel(p.pais || null), count: p.abertos })),
    [overview],
  );

  const toggleIn = (list: string[], set: (v: string[]) => void) => (key: string) =>
    set(list.includes(key) ? list.filter((v) => v !== key) : [...list, key]);

  const temFiltro =
    situacao !== "aberto" ||
    motivos.length > 0 ||
    lojas.length > 0 ||
    paises.length > 0 ||
    espera !== "todos" ||
    Boolean(dataDe || dataAte) ||
    reabertos ||
    busca.trim() !== "";

  const limparFiltros = () => {
    setSituacao("aberto");
    setMotivos([]);
    setLojas([]);
    setPaises([]);
    setEspera("todos");
    setDataDe("");
    setDataAte("");
    setReabertos(false);
    setBusca("");
  };

  const handleExport = async () => {
    setExportando(true);
    try {
      const n = await exportLateHunter(ambiente, filtros);
      toast.success("Planilha gerada", { description: `${formatCount(n)} pedido(s) — todos os filtrados, de todas as páginas.` });
    } catch (error) {
      console.error("[export-late-hunter] falhou:", error);
      toast.error("Erro ao exportar", {
        description: error instanceof Error ? error.message : "Não foi possível gerar a planilha.",
      });
    } finally {
      setExportando(false);
    }
  };

  const faixaAtiva: LateHunterFaixa | null = espera === "todos" || espera === "mais30" ? null : espera;

  // Os gráficos descrevem a fila ABERTA. Clicar num deles é perguntar pela fila
  // aberta — então volta a situação para "Em on-hold" se estiver em outra.
  const viaGrafico =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      if (situacao !== "aberto") setSituacao("aberto");
      fn(...args);
    };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-medium tracking-tight">Late Hunter</h1>
          <p className="text-sm text-muted-foreground">
            Pedidos em on-hold na ShipOffers, sincronizados pelo Late Hunter a cada 3 horas. Quem sai do hold sai da fila
            sozinho.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ambiente === "homologacao" && (
            <Badge variant="outline" className="gap-1 text-warning">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden /> Dados de teste
            </Badge>
          )}
          <Select value={ambiente} onValueChange={(v) => setAmbiente(v as LateHunterAmbiente)}>
            <SelectTrigger className="h-9 w-40" aria-label="Ambiente">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="producao">Produção</SelectItem>
              <SelectItem value="homologacao">Homologação</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      {overviewQuery.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <AlertCircle className="h-6 w-6" aria-hidden />
            <p>Não foi possível carregar o Late Hunter.</p>
            <Button variant="outline" size="sm" onClick={() => overviewQuery.refetch()}>
              Tentar de novo
            </Button>
          </CardContent>
        </Card>
      ) : semSync ? (
        <Card>
          <CardContent className="space-y-2 py-12 text-center">
            <p className="font-medium">Nenhum lote recebido {ambiente === "homologacao" ? "em homologação" : "ainda"}.</p>
            <p className="mx-auto max-w-lg text-sm text-muted-foreground">
              Assim que o Late Hunter enviar a primeira varredura (ele varre a ShipOffers 7 vezes por dia), os
              pedidos em on-hold aparecem aqui. Nada precisa ser importado à mão.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {overviewQuery.isLoading ? <Skeleton className="h-10 w-full" /> : <SyncStatus sync={overview?.ultimo_sync ?? null} />}

          <LateHunterKpis
            overview={overview}
            loading={overviewQuery.isLoading}
            antigosAtivo={espera === "mais30"}
            onToggleAntigos={viaGrafico(() => setEspera(espera === "mais30" ? "todos" : "mais30"))}
          />

          <section className="grid gap-4 lg:grid-cols-2">
            <AgingChart
              overview={overview}
              loading={overviewQuery.isLoading}
              faixaAtiva={faixaAtiva}
              onFaixa={viaGrafico((f: LateHunterFaixa | null) => setEspera(f ?? "todos"))}
            />
            <FlowChart overview={overview} loading={overviewQuery.isLoading} />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <ReasonsChart
              overview={overview}
              loading={overviewQuery.isLoading}
              selected={motivos}
              onToggle={viaGrafico(toggleIn(motivos, setMotivos))}
            />
            <StoresChart
              overview={overview}
              loading={overviewQuery.isLoading}
              selected={lojas}
              onToggle={viaGrafico(toggleIn(lojas, setLojas))}
            />
          </section>

          <Card>
            <CardHeader className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  Pedidos
                  <span className="font-mono text-sm font-normal tabular-nums text-muted-foreground">
                    {listQuery.isLoading ? "" : formatCount(total)}
                  </span>
                  {listQuery.isFetching && !listQuery.isLoading && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Atualizando" />
                  )}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Situação">
                    {SITUACOES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setSituacao(s.value)}
                        aria-pressed={situacao === s.value}
                        className={cn(
                          "rounded px-3 py-1 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          situacao === s.value ? "bg-inverse text-ink-inverse" : "text-ink-secondary hover:text-ink",
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <Select value={ordem} onValueChange={(v) => setOrdem(v as LateHunterOrdem)}>
                    <SelectTrigger className="h-9 w-52" aria-label="Ordenar por">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ORDEM_LABEL) as LateHunterOrdem[])
                        .filter((o) => o !== "encerrados" || situacao !== "aberto")
                        .map((o) => (
                          <SelectItem key={o} value={o}>
                            {ORDEM_LABEL[o]}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    onClick={handleExport}
                    disabled={exportando || listQuery.isLoading || total === 0}
                    title="Baixar em Excel todos os pedidos filtrados"
                  >
                    {exportando ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-1.5 h-4 w-4" />
                    )}
                    Exportar
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Pedido, cliente, e-mail, SKU..."
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    className="h-9 w-64 pl-8"
                    aria-label="Buscar pedidos"
                  />
                </div>
                <FilterMultiSelect label="Motivo" options={motivoOptions} selected={motivos} onChange={setMotivos} />
                <FilterMultiSelect label="Loja" options={lojaOptions} selected={lojas} onChange={setLojas} />
                <FilterMultiSelect label="País" options={paisOptions} selected={paises} onChange={setPaises} />
                <Select value={espera} onValueChange={(v) => setEspera(v as Espera)}>
                  <SelectTrigger className={cn("h-9 w-44", espera !== "todos" && "bg-secondary")} aria-label="Dias em espera">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Qualquer tempo</SelectItem>
                    <SelectItem value="mais30">Mais de {LIMITE_ANTIGO} dias</SelectItem>
                    {FAIXAS.map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        {f.key === "0-3" ? f.label : `${f.label} dias`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Label htmlFor="lh-data-de" className="text-xs text-muted-foreground">
                    Pedido de
                  </Label>
                  <Input
                    id="lh-data-de"
                    type="date"
                    value={dataDe}
                    onChange={(e) => setDataDe(e.target.value)}
                    className="h-9 w-[140px]"
                  />
                  <Label htmlFor="lh-data-ate" className="text-xs text-muted-foreground">
                    até
                  </Label>
                  <Input
                    id="lh-data-ate"
                    type="date"
                    value={dataAte}
                    onChange={(e) => setDataAte(e.target.value)}
                    className="h-9 w-[140px]"
                  />
                </div>
                <div className="flex items-center gap-2 pl-1">
                  <Switch id="lh-reabertos" checked={reabertos} onCheckedChange={setReabertos} />
                  <Label htmlFor="lh-reabertos" className="text-sm">
                    Só os que voltaram ao hold
                  </Label>
                </div>
                {temFiltro && (
                  <Button variant="ghost" size="sm" onClick={limparFiltros} className="gap-1">
                    <X className="h-3.5 w-3.5" /> Limpar filtros
                  </Button>
                )}
              </div>
            </CardHeader>

            <CardContent>
              {listQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : listQuery.isError ? (
                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                  <AlertCircle className="h-6 w-6" />
                  <p>Não foi possível carregar os pedidos.</p>
                </div>
              ) : rows.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  Nenhum pedido com esses filtros.
                  {temFiltro && (
                    <Button variant="link" onClick={limparFiltros}>
                      Limpar filtros
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <LateHunterTable rows={rows} onOpen={setAberto} showClosed={situacao !== "aberto"} />
                  {/* No celular a fileira de páginas pode passar da largura: rola
                      aqui dentro em vez de empurrar a página para o lado. */}
                  <div className="mt-4 overflow-x-auto">
                    <PanelPagination
                      estado={{
                        pagina,
                        setPagina,
                        totalPaginas,
                        visiveis: rows,
                        total,
                        inicio: total === 0 ? 0 : (pagina - 1) * porPagina + 1,
                        fim: Math.min(pagina * porPagina, total),
                      }}
                      rotulo={["pedido", "pedidos"]}
                      porPagina={porPagina}
                      onPorPaginaChange={setPorPagina}
                      opcoesPorPagina={POR_PAGINA}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <LateHunterOrderSheet order={aberto} onClose={() => setAberto(null)} />
    </div>
  );
}
