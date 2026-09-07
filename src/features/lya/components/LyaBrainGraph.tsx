import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods, LinkObject, NodeObject } from "react-force-graph-2d";
import { Brain, Pencil, Search, Sparkles, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { buildGraph, desde, type BrainGraph, type GraphLink, type GraphNode } from "../graph";
import { TIPO_MEMORIA_MAP, type LyaMemory, type LyaMemoryType } from "../types";

// LyaBrainGraph — o cérebro da Lya como um GRAFO ao estilo Obsidian: fundo
// escuro profundo, cada memória é um nó (cor por tipo, tamanho pelo número de
// conexões), arestas finas; passar o mouse acende a vizinhança, clicar abre o
// painel da memória. AO VIVO: a lista de memórias é repuxada de tempos em
// tempos e memórias novas NASCEM com um flash + ondas (é o que faz "parecer
// que está sendo treinada" — porque está).
//
// Herdado do BrainGraph do Daniel (CBIE) com duas mudanças: cor por tipo em
// vez de estrelas monocromáticas (legenda como os "groups" do Obsidian) e o
// grafo é montado no browser (graph.ts) a partir das memórias.

const ForceGraph2D = lazy(() => import("react-force-graph-2d"));

const NASC_MS = 2400;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// Cores dos "groups" (Obsidian-like), legíveis sobre o fundo escuro.
const COR_TIPO: Record<LyaMemoryType, string> = {
  feedback: "#fbbf24", // âmbar — preferências
  user: "#60a5fa", // azul — sobre a Lya
  project: "#a78bfa", // roxo — projetos
  reference: "#34d399", // verde — referências
  nota: "#cbd5e1", // cinza claro — notas
};
const HALO = "#a78bfa";

type NodeExtra = GraphNode & { _born?: number };
type NodeRuntime = NodeObject<NodeExtra>;
type LinkRuntime = LinkObject<NodeExtra, GraphLink>;
type FgRef = ForceGraphMethods<NodeRuntime, LinkRuntime>;

type Endpoint = string | number | NodeRuntime | undefined;
const idOf = (v: Endpoint) => (typeof v === "object" && v ? String(v.id ?? "") : String(v ?? ""));

function hexToRgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function LyaBrainGraph({
  memorias,
  carregando,
  treinando,
  onEditar,
  onApagar,
  onEnsinar,
}: {
  memorias: LyaMemory[];
  carregando: boolean;
  /** true enquanto o treinador está classificando uma memória nova. */
  treinando: boolean;
  onEditar: (m: LyaMemory) => void;
  onApagar: (name: string) => void;
  onEnsinar: () => void;
}) {
  const [graph, setGraph] = useState<BrainGraph>({ nodes: [], links: [] });
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [novaMemoria, setNovaMemoria] = useState<string | null>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<FgRef | undefined>(undefined);
  const graphRef = useRef<BrainGraph>({ nodes: [], links: [] });
  const fitDoneRef = useRef(false);
  const primeiraRef = useRef(true);

  const porNome = useMemo(() => new Map(memorias.map((m) => [m.name, m])), [memorias]);

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  // Funde o grafo fresco no atual PRESERVANDO as posições dos nós já
  // simulados — só nós/arestas realmente novos entram (novos ganham _born).
  useEffect(() => {
    if (carregando && memorias.length === 0) return;
    const fresh = buildGraph(memorias);
    const prev = graphRef.current;
    if (primeiraRef.current || prev.nodes.length === 0) {
      primeiraRef.current = false;
      setGraph(fresh);
      return;
    }
    const conhecidos = new Map((prev.nodes as NodeRuntime[]).map((n) => [n.id, n]));
    const freshIds = new Set(fresh.nodes.map((n) => n.id));
    const nodes: NodeRuntime[] = (prev.nodes as NodeRuntime[]).filter((n) => freshIds.has(n.id));
    const nascidos: GraphNode[] = [];
    const agora = performance.now();
    for (const fn of fresh.nodes) {
      const velho = conhecidos.get(fn.id);
      if (velho) {
        velho.val = fn.val;
        velho.label = fn.label;
        velho.tags = fn.tags;
        velho.type = fn.type;
        velho.updated_at = fn.updated_at;
      } else {
        const novo: NodeRuntime = { ...fn, _born: agora };
        nodes.push(novo);
        nascidos.push(fn);
      }
    }
    const chave = (l: LinkRuntime) => [idOf(l.source), idOf(l.target)].sort().join("|") + l.kind;
    const frescas = new Set(fresh.links.map((l) => chave(l as LinkRuntime)));
    const links = (prev.links as LinkRuntime[]).filter((l) => frescas.has(chave(l)));
    const conhecidas = new Set(links.map(chave));
    for (const l of fresh.links) if (!conhecidas.has(chave(l as LinkRuntime))) links.push(l);
    const mudou = nascidos.length > 0 || links.length !== prev.links.length || nodes.length !== prev.nodes.length;
    if (!mudou) return;
    setGraph({ nodes, links });
    if (nascidos.length) {
      setNovaMemoria(nascidos[nascidos.length - 1].label);
      try {
        fgRef.current?.d3ReheatSimulation();
      } catch {
        /* noop */
      }
    }
  }, [memorias, carregando]);

  useEffect(() => {
    if (!novaMemoria) return;
    const t = setTimeout(() => setNovaMemoria(null), 4200);
    return () => clearTimeout(t);
  }, [novaMemoria]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => setDims({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // O canvas nasce com o tamanho padrão e só depois recebe o real (ResizeObserver);
  // o centro do grafo ficaria deslocado. Reenquadra quando as dimensões mudam.
  useEffect(() => {
    if (!fitDoneRef.current) return;
    const t = window.setTimeout(() => fgRef.current?.zoomToFit(400, 90), 50);
    return () => window.clearTimeout(t);
  }, [dims]);

  // afrouxa as forças para o grafo "respirar" como no Obsidian
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !graph.nodes.length) return;
    try {
      fg.d3Force("charge")?.strength(-170).distanceMax(700);
      (fg.d3Force("link") as { distance?: (fn: (l: LinkRuntime) => number) => unknown } | undefined)?.distance?.((l) => (l.kind === "link" ? 70 : 42));
    } catch {
      /* noop */
    }
  }, [graph]);

  const focoId = sel ?? hover;

  const vizinhos = useMemo(() => {
    if (!focoId) return new Set<string>();
    const s = new Set<string>([focoId]);
    for (const l of graph.links as LinkRuntime[]) {
      const src = idOf(l.source), tgt = idOf(l.target);
      if (src === focoId) s.add(tgt);
      if (tgt === focoId) s.add(src);
    }
    return s;
  }, [focoId, graph.links]);

  // busca: nós cujo rótulo/tags casam ficam acesos, o resto apaga
  const buscados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return null;
    return new Set(graph.nodes.filter((n) => `${n.label} ${n.tags.join(" ")}`.toLowerCase().includes(q)).map((n) => n.id));
  }, [busca, graph.nodes]);

  const desenharNo = useCallback(
    (node: NodeRuntime, ctx: CanvasRenderingContext2D, scale: number) => {
      const n = node;
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return;
      const x = n.x as number, y = n.y as number;
      const cor = COR_TIPO[n.type] ?? COR_TIPO.nota;
      const apagadoPelaBusca = buscados ? !buscados.has(n.id) : false;
      const emFoco = (!focoId || vizinhos.has(n.id)) && !apagadoPelaBusca;
      const r = 2 + Math.sqrt(n.val) * 1.6;

      let bp = -1;
      if (n._born != null) {
        bp = (performance.now() - n._born) / NASC_MS;
        if (bp >= 1) {
          n._born = undefined;
          bp = -1;
        }
      }
      const nascendo = bp >= 0;
      const q = nascendo ? 1 - bp : 0;

      if (nascendo) {
        const bloomR = r + easeOutCubic(clamp01(bp / 0.8)) * (26 + n.val * 2.5);
        const fade = Math.pow(q, 1.4);
        ctx.save();
        const grad = ctx.createRadialGradient(x, y, 0, x, y, bloomR);
        grad.addColorStop(0, hexToRgba(cor, 0.5 * fade));
        grad.addColorStop(0.4, hexToRgba(HALO, 0.25 * fade));
        grad.addColorStop(1, hexToRgba(HALO, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, bloomR, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();

        ctx.save();
        for (let i = 0; i < 3; i++) {
          const start = i * 0.16;
          const rp = clamp01((bp - start) / (1 - start));
          if (rp <= 0 || rp >= 1) continue;
          const rr = r + easeOutCubic(rp) * (34 + i * 12);
          const a = Math.pow(1 - rp, 2) * (0.6 - i * 0.14);
          ctx.beginPath();
          ctx.strokeStyle = hexToRgba(cor, a);
          ctx.lineWidth = (1.4 - i * 0.35) / Math.max(0.6, scale);
          ctx.shadowColor = cor;
          ctx.shadowBlur = 10 * (1 - rp);
          ctx.arc(x, y, rr, 0, 2 * Math.PI);
          ctx.stroke();
        }
        ctx.restore();
      }

      const escala = nascendo ? Math.max(0.12, easeOutBack(clamp01(bp / 0.55))) : 1;
      const rEff = r * escala;
      const brilho = (focoId === n.id ? 22 : emFoco ? 10 : 2) + q * 24;

      ctx.save();
      ctx.globalAlpha = emFoco ? 1 : 0.18;
      ctx.shadowColor = nascendo ? "#ffffff" : cor;
      ctx.shadowBlur = brilho;
      ctx.beginPath();
      ctx.arc(x, y, rEff, 0, 2 * Math.PI);
      ctx.fillStyle = cor;
      ctx.fill();
      if (focoId === n.id) {
        ctx.shadowBlur = brilho * 1.6;
        ctx.fill();
        ctx.lineWidth = 1.2 / scale;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
      ctx.restore();

      // rótulo: sempre quando o zoom está próximo (como o Obsidian), senão só na vizinhança em foco
      const mostrarRotulo = scale > 1.3 || (focoId != null && vizinhos.has(n.id)) || (buscados?.has(n.id) ?? false);
      if (mostrarRotulo && emFoco) {
        // 12 px de TELA sempre: em unidades do canvas é 12/scale (sem piso —
        // o piso fazia o rótulo crescer junto com o zoom e cobrir o grafo).
        const fonte = 12 / scale;
        ctx.font = `${focoId === n.id ? 600 : 400} ${fonte}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 4;
        ctx.fillStyle = focoId === n.id ? "#ffffff" : "#c7d2fe";
        ctx.globalAlpha = scale > 1.3 && focoId == null && !buscados ? Math.min(1, (scale - 1.3) / 1.2 + 0.4) : 1;
        ctx.fillText(n.label.length > 34 ? n.label.slice(0, 33) + "…" : n.label, x, y + r + 4 / scale);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    },
    [focoId, vizinhos, buscados],
  );

  const linkEmFoco = useCallback(
    (l: LinkRuntime) => focoId != null && (idOf(l.source) === focoId || idOf(l.target) === focoId),
    [focoId],
  );
  const linkNascendo = useCallback((l: LinkRuntime) => {
    const nasc = (x: Endpoint) => typeof x === "object" && x != null && x._born != null;
    return nasc(l.source) || nasc(l.target);
  }, []);

  const selecionada = sel ? porNome.get(sel) ?? null : null;
  const selNode = sel ? (graph.nodes.find((n) => n.id === sel) ?? null) : null;
  const recentes = useMemo(
    () => [...memorias].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6),
    [memorias],
  );

  return (
    <div
      className="relative h-[calc(100dvh-13.5rem)] min-h-[520px] w-full overflow-hidden rounded-2xl ring-1 ring-white/10"
      style={{ background: "radial-gradient(ellipse at 50% 30%, #161a33 0%, #0b0d1f 55%, #05060f 100%)" }}
    >
      {/* legenda / status */}
      <div className="absolute left-4 top-4 z-10 flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs text-slate-300 shadow-2xl backdrop-blur-md">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-tight text-slate-100">
          <Brain className="h-4 w-4" style={{ color: HALO }} />
          Cérebro da Lya
        </span>
        <span className="flex items-center gap-2 text-[11px] text-slate-400">
          {carregando && graph.nodes.length === 0 ? (
            "carregando…"
          ) : (
            <>
              {graph.nodes.length} memórias · {graph.links.length} conexões
            </>
          )}
          <span className="flex items-center gap-1 text-emerald-400/90">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            ao vivo
          </span>
        </span>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {(Object.keys(COR_TIPO) as LyaMemoryType[]).map((t) => (
            <span key={t} className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: COR_TIPO[t], boxShadow: `0 0 6px ${COR_TIPO[t]}` }} />
              {TIPO_MEMORIA_MAP[t].label}
            </span>
          ))}
        </div>
      </div>

      {/* busca */}
      <div className="absolute left-1/2 top-4 z-10 hidden -translate-x-1/2 md:block">
        <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-slate-200 shadow-2xl backdrop-blur-md focus-within:border-white/30">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar no cérebro…"
            className="w-44 bg-transparent outline-none placeholder:text-slate-500"
          />
          {busca && (
            <button type="button" onClick={() => setBusca("")} className="text-slate-400 hover:text-white" aria-label="Limpar busca">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
      </div>

      {/* treinando */}
      {treinando && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex items-center gap-3 rounded-full border border-white/15 bg-black/40 px-5 py-2.5 text-sm text-slate-100 shadow-2xl backdrop-blur-xl">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: HALO }} />
              <span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: HALO }} />
            </span>
            A Lya está aprendendo…
          </div>
        </div>
      )}

      {/* toast: nasceu uma memória */}
      {novaMemoria && !treinando && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-4 py-2 text-xs text-slate-100 shadow-2xl backdrop-blur-xl">
            <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: HALO }} />
            <span className="text-slate-400">nova memória:</span>
            <span className="max-w-[280px] truncate font-medium">{novaMemoria}</span>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-4 left-4 z-10 text-[11px] text-slate-500">
        passe o mouse para acender · scroll para zoom · arraste para mover · clique para abrir
      </div>

      <button
        type="button"
        onClick={onEnsinar}
        className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-4 py-2 text-xs font-medium text-slate-100 shadow-2xl backdrop-blur-xl transition-colors hover:bg-white/[0.14]"
      >
        <Sparkles className="h-3.5 w-3.5" style={{ color: HALO }} />
        Ensinar algo novo
      </button>

      {/* painel lateral: memória selecionada ou últimos treinos */}
      <div className="absolute right-4 top-4 z-10 w-80 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-slate-200 shadow-2xl backdrop-blur-xl">
        {selecionada && selNode ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                style={{ background: hexToRgba(COR_TIPO[selecionada.type], 0.18), color: COR_TIPO[selecionada.type] }}
              >
                {TIPO_MEMORIA_MAP[selecionada.type]?.label ?? selecionada.type}
              </span>
              <button type="button" onClick={() => setSel(null)} className="text-slate-400 hover:text-white" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <h3 className="text-sm font-semibold leading-snug">{selecionada.description || selecionada.name}</h3>
            {selecionada.body && (
              <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-slate-300">{selecionada.body}</p>
            )}
            {selecionada.tags.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1">
                {selecionada.tags.map((tg) => (
                  <button
                    key={tg}
                    type="button"
                    onClick={() => setBusca(tg)}
                    className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400 hover:bg-white/10 hover:text-slate-200"
                  >
                    #{tg}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-3 border-t border-white/10 pt-2 text-[11px] text-slate-500">
              {Math.max(0, vizinhos.size - 1)} conexõe(s) · atualizada {desde(selecionada.updated_at)}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onEditar(selecionada)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1 text-[12px] hover:bg-white/10"
              >
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
              <button
                type="button"
                onClick={() => {
                  setSel(null);
                  onApagar(selecionada.name);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1 text-[12px] text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" /> Apagar
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Últimos treinos</p>
            {recentes.length === 0 ? (
              <p className="mt-2 text-[12px] text-slate-400">A Lya ainda não tem memórias. Ensine a primeira.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {recentes.map((m) => (
                  <li key={m.name}>
                    <button
                      type="button"
                      onClick={() => setSel(m.name)}
                      onMouseEnter={() => setHover(m.name)}
                      onMouseLeave={() => setHover(null)}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                    >
                      <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: COR_TIPO[m.type], boxShadow: `0 0 6px ${COR_TIPO[m.type]}` }} />
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] text-slate-100">{m.description || m.name}</span>
                        <span className="block text-[10.5px] text-slate-500">
                          {TIPO_MEMORIA_MAP[m.type]?.label ?? m.type} · {desde(m.updated_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div ref={wrapRef} className={cn("h-full w-full", carregando && graph.nodes.length === 0 && "opacity-0")}>
        <Suspense fallback={null}>
          <ForceGraph2D
            ref={fgRef}
            graphData={graph}
            width={dims.w}
            height={dims.h}
            backgroundColor="rgba(0,0,0,0)"
            onEngineStop={() => {
              if (fitDoneRef.current) return;
              fitDoneRef.current = true;
              const fg = fgRef.current;
              fg?.zoomToFit(600, 90);
              // Com poucas memórias o fit aproxima demais (pontos viram bolas).
              window.setTimeout(() => {
                try {
                  if (fg && fg.zoom() > 2.2) fg.zoom(2.2, 400);
                } catch {
                  /* noop */
                }
              }, 650);
            }}
            nodeCanvasObject={desenharNo}
            nodePointerAreaPaint={(n: NodeRuntime, color: string, ctx: CanvasRenderingContext2D) => {
              if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return;
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(n.x as number, n.y as number, 6 + Math.sqrt(n.val) * 1.6, 0, 2 * Math.PI);
              ctx.fill();
            }}
            linkColor={(l: LinkRuntime) =>
              linkNascendo(l) ? "rgba(233,241,255,0.85)" : linkEmFoco(l) ? "rgba(199,210,254,0.9)" : "rgba(167,139,250,0.14)"
            }
            linkWidth={(l: LinkRuntime) => (linkNascendo(l) ? 1.6 : linkEmFoco(l) ? 1.4 : 0.6)}
            linkCurvature={0}
            linkDirectionalParticles={(l: LinkRuntime) => (linkNascendo(l) ? 5 : linkEmFoco(l) ? 3 : 0)}
            linkDirectionalParticleWidth={(l: LinkRuntime) => (linkNascendo(l) ? 2.6 : 1.8)}
            linkDirectionalParticleColor={(l: LinkRuntime) => (linkNascendo(l) ? "#eaf1ff" : HALO)}
            linkDirectionalParticleSpeed={(l: LinkRuntime) => (linkNascendo(l) ? 0.012 : 0.006)}
            onNodeHover={(node: NodeRuntime | null) => setHover(node ? String(node.id) : null)}
            onNodeClick={(node: NodeRuntime) => setSel(String(node.id))}
            onBackgroundClick={() => setSel(null)}
            cooldownTicks={200}
          />
        </Suspense>
      </div>
    </div>
  );
}
