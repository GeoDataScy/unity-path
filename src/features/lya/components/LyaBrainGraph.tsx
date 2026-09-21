import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ForceGraphMethods, LinkObject, NodeObject } from "react-force-graph-2d";
import { Brain, Eraser, ExternalLink, Maximize2, Pencil, RotateCcw, Search, Settings2, Sparkles, Trash2, X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { buildGraph, desde, type BrainGraph, type GraphCamada, type GraphLink, type GraphNode, type LyaSistemaNo } from "../graph";
import { TIPO_MEMORIA_MAP, TIPOS_MEMORIA, type LyaArquivo, type LyaMemory, type LyaMemoryType } from "../types";

// LyaBrainGraph — o cérebro da Lya como um GRAFO ao estilo Obsidian: fundo
// escuro profundo, cada nó é uma coisa que ela sabe ou alcança (tamanho pelo
// número de conexões), arestas finas; passar o mouse acende a vizinhança,
// clicar abre o painel do nó. AO VIVO: as listas são repuxadas de tempos em
// tempos e o que é novo NASCE com um flash + ondas.
//
// TRÊS CAMADAS (ver graph.ts): memória treinada, arquivo ingerido e nó de
// sistema. Elas se distinguem pela FORMA, não por mais uma cor — círculo cheio
// (memória, cor pelo tipo), quadrado arredondado (arquivo) e anel vazado
// (sistema). O grafo já gasta 5 cores nos tipos de memória e roxo/azul são
// indistinguíveis em protanopia: mais uma escala de cor aqui não seria lida.
//
// Manipulável como o grafo do Obsidian: arrastar nós (ficam onde soltar, ou
// não — ajuste), painel de forças (repulsão, distância das ligações, força
// central), filtros por camada e por tipo, órfãos, rótulos, tamanho dos nós e
// espessura das linhas. Os ajustes ficam no navegador (localStorage).
//
// Herdado do BrainGraph do Daniel (CBIE); o grafo é montado no browser
// (graph.ts) a partir das três listas.

const ForceGraph2D = lazy(() => import("react-force-graph-2d"));

const NASC_MS = 2400;
const AJUSTES_KEY = "lya-grafo-ajustes";

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

// Arquivo e sistema são NEUTROS de propósito: quem separa as camadas é a forma
// (ver o comentário do topo), então uma cor a mais só competiria com os tipos.
const COR_ARQUIVO = "#e2e8f0";
const COR_SISTEMA = "#94a3b8";
const CAMADAS: { value: GraphCamada; label: string; cor: string }[] = [
  { value: "memoria", label: "Memórias", cor: COR_TIPO.project },
  { value: "arquivo", label: "Arquivos", cor: COR_ARQUIVO },
  { value: "sistema", label: "Sistema", cor: COR_SISTEMA },
];
const SISTEMA_CAMADA_LABEL: Record<LyaSistemaNo["camada"], string> = {
  tabela: "Tabela do banco",
  tela: "Tela do painel",
  base: "Base de conhecimento",
};
const numero = (n: number) => n.toLocaleString("pt-BR");

// O que a faixa anuncia quando um nó nasce, por camada.
const NASCIMENTO_LABEL: Record<GraphCamada, string> = {
  memoria: "nova memória:",
  arquivo: "novo arquivo:",
  sistema: "novo alcance:",
};

const corDoNo = (n: GraphNode) =>
  n.camada === "arquivo" ? COR_ARQUIVO : n.camada === "sistema" ? COR_SISTEMA : COR_TIPO[n.type ?? "nota"] ?? COR_TIPO.nota;

// A FORMA é o que separa as três camadas (ver o comentário do topo): círculo
// para memória, quadrado arredondado para arquivo — lê como folha de planilha —
// e o nó de sistema, que também é círculo, sai vazado no desenho. Aqui só se
// traça o caminho; quem decide preencher ou contornar é `desenharNo`.
function tracarForma(ctx: CanvasRenderingContext2D, n: GraphNode, x: number, y: number, r: number) {
  ctx.beginPath();
  if (n.camada === "arquivo") {
    const lado = r * 1.7;
    const canto = Math.min(lado / 3, 2.2);
    // roundRect é recente; onde não existir, o quadrado reto ainda distingue.
    if (typeof ctx.roundRect === "function") ctx.roundRect(x - lado / 2, y - lado / 2, lado, lado, canto);
    else ctx.rect(x - lado / 2, y - lado / 2, lado, lado);
    return;
  }
  ctx.arc(x, y, r, 0, 2 * Math.PI);
}

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

// ── Ajustes (as "Forces" e "Display" do Obsidian) ───────────────────────────
interface Ajustes {
  repulsao: number; // força de repulsão entre nós
  distancia: number; // distância das ligações
  centro: number; // força central (puxa tudo para o meio)
  tamanho: number; // multiplicador do tamanho do nó
  espessura: number; // multiplicador da espessura da linha
  rotulos: "auto" | "sempre" | "nunca";
  fixar: boolean; // nó arrastado fica onde soltar
  orfaos: boolean; // mostrar nós sem conexão
  tipos: Record<LyaMemoryType, boolean>;
  camadas: Record<GraphCamada, boolean>;
}

const AJUSTES_PADRAO: Ajustes = {
  repulsao: 170,
  distancia: 60,
  centro: 0.06,
  tamanho: 1,
  espessura: 1,
  rotulos: "auto",
  fixar: true,
  orfaos: true,
  tipos: { feedback: true, user: true, project: true, reference: true, nota: true },
  camadas: { memoria: true, arquivo: true, sistema: true },
};

// Quem já usa a tela tem ajustes salvos sem os campos novos: o merge com o
// padrão (raso + um nível nos mapas) é o que faz `camadas` nascer ligada em vez
// de `undefined` — sem ele o grafo abriria vazio para essas pessoas.
function lerAjustes(): Ajustes {
  try {
    const raw = window.localStorage.getItem(AJUSTES_KEY);
    if (!raw) return AJUSTES_PADRAO;
    const p = JSON.parse(raw) as Partial<Ajustes>;
    return {
      ...AJUSTES_PADRAO,
      ...p,
      tipos: { ...AJUSTES_PADRAO.tipos, ...(p.tipos ?? {}) },
      camadas: { ...AJUSTES_PADRAO.camadas, ...(p.camadas ?? {}) },
    };
  } catch {
    return AJUSTES_PADRAO;
  }
}

export function LyaBrainGraph({
  memorias,
  arquivos = [],
  sistema = [],
  carregando,
  treinando,
  onEditar,
  onApagar,
  onEnsinar,
  onRemoverExemplos,
}: {
  memorias: LyaMemory[];
  /** Acervo de arquivos ingeridos — a camada `arquivo`. */
  arquivos?: LyaArquivo[];
  /** Catálogo do que a Lya alcança — a camada `sistema`. */
  sistema?: LyaSistemaNo[];
  carregando: boolean;
  /** true enquanto o treinador está classificando uma memória nova. */
  treinando: boolean;
  onEditar: (m: LyaMemory) => void;
  onApagar: (name: string) => void;
  onEnsinar: () => void;
  /** Remove as memórias de exemplo (seed). Só aparece quando há alguma. */
  onRemoverExemplos?: () => void;
}) {
  const [graph, setGraph] = useState<BrainGraph>({ nodes: [], links: [] });
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [novoNo, setNovoNo] = useState<{ label: string; camada: GraphCamada } | null>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [ajustes, setAjustes] = useState<Ajustes>(lerAjustes);
  const [painelAjustes, setPainelAjustes] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<FgRef | undefined>(undefined);
  const graphRef = useRef<BrainGraph>({ nodes: [], links: [] });
  const fitDoneRef = useRef(false);
  const primeiraRef = useRef(true);

  const porNome = useMemo(() => new Map(memorias.map((m) => [m.name, m])), [memorias]);
  const temExemplos = useMemo(() => memorias.some((m) => m.seed), [memorias]);

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  useEffect(() => {
    try {
      window.localStorage.setItem(AJUSTES_KEY, JSON.stringify(ajustes));
    } catch {
      /* noop */
    }
  }, [ajustes]);

  const setAjuste = <K extends keyof Ajustes>(k: K, v: Ajustes[K]) => setAjustes((a) => ({ ...a, [k]: v }));

  // Funde o grafo fresco no atual PRESERVANDO as posições dos nós já
  // simulados — só nós/arestas realmente novos entram (novos ganham _born).
  useEffect(() => {
    if (carregando && memorias.length === 0) return;
    const fresh = buildGraph(memorias, arquivos, sistema);
    const prev = graphRef.current;
    if (primeiraRef.current || prev.nodes.length === 0) {
      primeiraRef.current = false;
      setGraph(fresh);
      return;
    }
    // Uma camada só "nasce" com flash depois que ela já existia no grafo. As
    // três listas chegam de queries diferentes: sem isso, os ~20 nós de sistema
    // (e o acervo inteiro) piscariam de uma vez toda vez que a tela abre.
    const camadasConhecidas = new Set((prev.nodes as NodeRuntime[]).map((n) => n.camada));
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
        // payloads das outras camadas mudam sozinhos (resumo da Lya, total ao
        // vivo): o painel lateral lê deles, então têm que acompanhar
        velho.arquivo = fn.arquivo;
        velho.sistema = fn.sistema;
      } else {
        const estreia = !camadasConhecidas.has(fn.camada);
        nodes.push(estreia ? { ...fn } : { ...fn, _born: agora });
        if (!estreia) nascidos.push(fn);
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
      const ultimo = nascidos[nascidos.length - 1];
      setNovoNo({ label: ultimo.label, camada: ultimo.camada });
      try {
        fgRef.current?.d3ReheatSimulation();
      } catch {
        /* noop */
      }
    }
  }, [memorias, arquivos, sistema, carregando]);

  useEffect(() => {
    if (!novoNo) return;
    const t = setTimeout(() => setNovoNo(null), 4200);
    return () => clearTimeout(t);
  }, [novoNo]);

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

  // ── Filtro por camada / tipo / órfãos: mesmos objetos de nó (posições preservadas) ──
  // O filtro por TIPO só se aplica a memória: arquivo e sistema não têm tipo, e
  // deixá-los presos a ele sumiria com as duas camadas novas sem explicação.
  const visivel = useMemo<BrainGraph>(() => {
    const ok = new Set(
      (graph.nodes as NodeRuntime[])
        .filter((n) => ajustes.camadas[n.camada] && (n.camada !== "memoria" || ajustes.tipos[n.type ?? "nota"]))
        .map((n) => String(n.id)),
    );
    const links = (graph.links as LinkRuntime[]).filter((l) => ok.has(idOf(l.source)) && ok.has(idOf(l.target)));
    let nodes = (graph.nodes as NodeRuntime[]).filter((n) => ok.has(String(n.id)));
    if (!ajustes.orfaos) {
      const comLigacao = new Set<string>();
      for (const l of links) {
        comLigacao.add(idOf(l.source));
        comLigacao.add(idOf(l.target));
      }
      nodes = nodes.filter((n) => comLigacao.has(String(n.id)));
    }
    return { nodes, links };
  }, [graph, ajustes.camadas, ajustes.tipos, ajustes.orfaos]);

  // ── Forças (as "Forces" do Obsidian) ─────────────────────────────────────
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !visivel.nodes.length) return;
    try {
      const charge = fg.d3Force("charge") as { strength?: (v: number) => unknown; distanceMax?: (v: number) => unknown } | undefined;
      charge?.strength?.(-ajustes.repulsao);
      charge?.distanceMax?.(800);
      const link = fg.d3Force("link") as { distance?: (fn: (l: LinkRuntime) => number) => unknown } | undefined;
      link?.distance?.((l) => (l.kind === "link" ? ajustes.distancia * 1.15 : ajustes.distancia * 0.7));
      const center = fg.d3Force("center") as { strength?: (v: number) => unknown } | undefined;
      center?.strength?.(ajustes.centro);
      fg.d3ReheatSimulation();
    } catch {
      /* noop */
    }
  }, [visivel, ajustes.repulsao, ajustes.distancia, ajustes.centro]);

  const focoId = sel ?? hover;

  const vizinhos = useMemo(() => {
    if (!focoId) return new Set<string>();
    const s = new Set<string>([focoId]);
    for (const l of visivel.links as LinkRuntime[]) {
      const src = idOf(l.source), tgt = idOf(l.target);
      if (src === focoId) s.add(tgt);
      if (tgt === focoId) s.add(src);
    }
    return s;
  }, [focoId, visivel.links]);

  // busca: nós cujo rótulo/tags casam ficam acesos, o resto apaga
  const buscados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return null;
    return new Set(visivel.nodes.filter((n) => `${n.label} ${n.tags.join(" ")}`.toLowerCase().includes(q)).map((n) => n.id));
  }, [busca, visivel.nodes]);

  const raio = useCallback((n: NodeRuntime) => (2 + Math.sqrt(n.val) * 1.6) * ajustes.tamanho, [ajustes.tamanho]);


  const desenharNo = useCallback(
    (node: NodeRuntime, ctx: CanvasRenderingContext2D, scale: number) => {
      const n = node;
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return;
      const x = n.x as number, y = n.y as number;
      const cor = corDoNo(n);
      const apagadoPelaBusca = buscados ? !buscados.has(n.id) : false;
      const emFoco = (!focoId || vizinhos.has(n.id)) && !apagadoPelaBusca;
      const r = raio(n);

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
      tracarForma(ctx, n, x, y, rEff);
      if (n.camada === "sistema") {
        // Anel vazado: o nó de sistema não é algo que a Lya sabe, é um lugar
        // onde ela chega. O miolo aberto marca essa diferença já de longe.
        ctx.lineWidth = Math.max(1.1 / scale, rEff * 0.45);
        ctx.strokeStyle = cor;
        ctx.stroke();
      } else {
        ctx.fillStyle = cor;
        ctx.fill();
      }
      if (focoId === n.id) {
        ctx.shadowBlur = brilho * 1.6;
        if (n.camada === "sistema") ctx.stroke();
        else ctx.fill();
        tracarForma(ctx, n, x, y, rEff + 1.5 / scale);
        ctx.lineWidth = 1.2 / scale;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
      // nó fixado (arrastado): anel discreto, como o Obsidian marca nó "preso"
      if (n.fx != null && !nascendo) {
        tracarForma(ctx, n, x, y, rEff + 2 / scale);
        ctx.lineWidth = 0.8 / scale;
        ctx.strokeStyle = hexToRgba(cor, 0.6);
        ctx.shadowBlur = 0;
        ctx.stroke();
      }
      ctx.restore();

      // rótulo: modo auto = quando o zoom está próximo (como o Obsidian) ou na vizinhança em foco
      const mostrarRotulo =
        ajustes.rotulos === "sempre" ||
        (ajustes.rotulos === "auto" && (scale > 1.3 || (focoId != null && vizinhos.has(n.id)) || (buscados?.has(n.id) ?? false)));
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
        ctx.globalAlpha =
          ajustes.rotulos === "auto" && scale > 1.3 && focoId == null && !buscados ? Math.min(1, (scale - 1.3) / 1.2 + 0.4) : 1;
        ctx.fillText(n.label.length > 34 ? n.label.slice(0, 33) + "…" : n.label, x, y + r + 4 / scale);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    },
    [focoId, vizinhos, buscados, raio, ajustes.rotulos],
  );

  const linkEmFoco = useCallback(
    (l: LinkRuntime) => focoId != null && (idOf(l.source) === focoId || idOf(l.target) === focoId),
    [focoId],
  );
  const linkNascendo = useCallback((l: LinkRuntime) => {
    const nasc = (x: Endpoint) => typeof x === "object" && x != null && x._born != null;
    return nasc(l.source) || nasc(l.target);
  }, []);

  const reiniciarLayout = () => {
    for (const n of graph.nodes as NodeRuntime[]) {
      n.fx = undefined;
      n.fy = undefined;
    }
    fitDoneRef.current = false;
    try {
      fgRef.current?.d3ReheatSimulation();
    } catch {
      /* noop */
    }
  };

  const enquadrar = () => {
    const fg = fgRef.current;
    fg?.zoomToFit(500, 90);
    window.setTimeout(() => {
      try {
        if (fg && fg.zoom() > 2.2) fg.zoom(2.2, 400);
      } catch {
        /* noop */
      }
    }, 550);
  };

  const selecionada = sel ? porNome.get(sel) ?? null : null;
  // O nó selecionado pode ser de qualquer camada; `selecionada` só resolve
  // memória (é ela que tem editar/apagar). Arquivo e sistema saem daqui.
  const noSelecionado = useMemo(
    () => (sel ? (graph.nodes as NodeRuntime[]).find((n) => String(n.id) === sel) ?? null : null),
    [sel, graph.nodes],
  );
  const arquivoSel = noSelecionado?.camada === "arquivo" ? noSelecionado.arquivo ?? null : null;
  const sistemaSel = noSelecionado?.camada === "sistema" ? noSelecionado.sistema ?? null : null;
  const recentes = useMemo(
    () => [...memorias].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6),
    [memorias],
  );
  const ocultos = graph.nodes.length - visivel.nodes.length;

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
              {visivel.nodes.length} nós · {visivel.links.length} conexões
              {ocultos > 0 && <span className="text-slate-500"> · {ocultos} ocultos</span>}
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
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {CAMADAS.map((cm) => {
            const on = ajustes.camadas[cm.value];
            return (
              <button
                key={cm.value}
                type="button"
                onClick={() => setAjuste("camadas", { ...ajustes.camadas, [cm.value]: !on })}
                title={on ? `Ocultar ${cm.label}` : `Mostrar ${cm.label}`}
                className={cn(
                  "flex items-center gap-1.5 text-[11px] font-medium transition-opacity",
                  on ? "text-slate-200" : "text-slate-500 opacity-50 line-through",
                )}
              >
                {/* a marca repete a FORMA do nó, não só a cor */}
                <span
                  className={cn(
                    "inline-block h-2.5 w-2.5 shrink-0",
                    cm.value === "arquivo" ? "rounded-[3px]" : "rounded-full",
                    cm.value === "sistema" && "border-2 bg-transparent",
                  )}
                  style={cm.value === "sistema" ? { borderColor: cm.cor } : { background: cm.cor }}
                />
                {cm.label}
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {TIPOS_MEMORIA.map((tp) => {
            const on = ajustes.tipos[tp.value];
            return (
              <button
                key={tp.value}
                type="button"
                onClick={() => setAjuste("tipos", { ...ajustes.tipos, [tp.value]: !on })}
                title={on ? `Ocultar ${tp.label}` : `Mostrar ${tp.label}`}
                className={cn("flex items-center gap-1.5 text-[11px] transition-opacity", on ? "text-slate-300" : "text-slate-500 opacity-50 line-through")}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: COR_TIPO[tp.value], boxShadow: on ? `0 0 6px ${COR_TIPO[tp.value]}` : "none" }} />
                {tp.label}
              </button>
            );
          })}
        </div>
        {temExemplos && onRemoverExemplos && (
          <button
            type="button"
            onClick={onRemoverExemplos}
            className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10"
            title="Apaga só as memórias de exemplo, sem tocar no que a gestora ensinou"
          >
            <Eraser className="h-3 w-3" /> Remover exemplos
          </button>
        )}
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

      {/* toast: nasceu um nó (o rótulo diz de que camada, porque agora são três) */}
      {novoNo && !treinando && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-4 py-2 text-xs text-slate-100 shadow-2xl backdrop-blur-xl">
            <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: HALO }} />
            <span className="text-slate-400">{NASCIMENTO_LABEL[novoNo.camada]}</span>
            <span className="max-w-[280px] truncate font-medium">{novoNo.label}</span>
          </div>
        </div>
      )}

      {/* barra inferior: ajustes + ações */}
      <div className="absolute bottom-4 left-4 z-10 flex items-end gap-2">
        <div className="flex flex-col items-start gap-2">
          {painelAjustes && (
            <div className="w-64 rounded-2xl border border-white/10 bg-white/[0.05] p-3.5 text-xs text-slate-200 shadow-2xl backdrop-blur-xl">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Forças</p>
              <Controle label="Repulsão" valor={ajustes.repulsao} min={30} max={500} step={10} onChange={(v) => setAjuste("repulsao", v)} />
              <Controle label="Distância das ligações" valor={ajustes.distancia} min={15} max={200} step={5} onChange={(v) => setAjuste("distancia", v)} />
              <Controle label="Força central" valor={ajustes.centro} min={0} max={0.5} step={0.01} onChange={(v) => setAjuste("centro", v)} fmt={(v) => v.toFixed(2)} />
              <p className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Exibição</p>
              <Controle label="Tamanho dos nós" valor={ajustes.tamanho} min={0.5} max={2.5} step={0.1} onChange={(v) => setAjuste("tamanho", v)} fmt={(v) => `${v.toFixed(1)}×`} />
              <Controle label="Espessura das linhas" valor={ajustes.espessura} min={0.3} max={3} step={0.1} onChange={(v) => setAjuste("espessura", v)} fmt={(v) => `${v.toFixed(1)}×`} />
              <div className="mt-2 flex items-center justify-between">
                <span>Rótulos</span>
                <div className="inline-flex rounded-md border border-white/10 p-0.5">
                  {(["auto", "sempre", "nunca"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setAjuste("rotulos", r)}
                      className={cn("rounded px-2 py-0.5 text-[11px] capitalize", ajustes.rotulos === r ? "bg-white/15 text-white" : "text-slate-400 hover:text-slate-200")}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <label className="mt-2 flex items-center justify-between">
                <span>Fixar nó ao arrastar</span>
                <Switch checked={ajustes.fixar} onCheckedChange={(v) => setAjuste("fixar", v)} className="scale-75" />
              </label>
              <label className="mt-1 flex items-center justify-between">
                <span>Mostrar órfãos</span>
                <Checkbox checked={ajustes.orfaos} onCheckedChange={(v) => setAjuste("orfaos", v === true)} className="border-white/40" />
              </label>
              <button
                type="button"
                onClick={() => setAjustes(AJUSTES_PADRAO)}
                className="mt-3 w-full rounded-md border border-white/10 py-1 text-[11px] text-slate-300 hover:bg-white/10"
              >
                Restaurar padrão
              </button>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <BotaoFlutuante on={painelAjustes} onClick={() => setPainelAjustes((v) => !v)} title="Ajustes do grafo">
              <Settings2 className="h-3.5 w-3.5" /> Ajustes
            </BotaoFlutuante>
            <BotaoFlutuante onClick={enquadrar} title="Enquadrar tudo">
              <Maximize2 className="h-3.5 w-3.5" />
            </BotaoFlutuante>
            <BotaoFlutuante onClick={reiniciarLayout} title="Soltar os nós fixados e reorganizar">
              <RotateCcw className="h-3.5 w-3.5" />
            </BotaoFlutuante>
            <span className="ml-2 hidden text-[11px] text-slate-500 lg:inline">
              arraste os nós · scroll para zoom · clique para abrir
            </span>
          </div>
        </div>
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
        {selecionada ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span
                  className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                  style={{ background: hexToRgba(COR_TIPO[selecionada.type], 0.18), color: COR_TIPO[selecionada.type] }}
                >
                  {TIPO_MEMORIA_MAP[selecionada.type]?.label ?? selecionada.type}
                </span>
                {selecionada.seed && <span className="text-[10px] uppercase tracking-wide text-slate-500">exemplo</span>}
              </span>
              <button type="button" onClick={() => setSel(null)} className="text-slate-400 hover:text-white" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <h3 className="text-sm font-semibold leading-snug">{selecionada.description || selecionada.name}</h3>
            {selecionada.body && (
              <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-slate-300">
                {selecionada.body.split(/(\[\[[^\]]+\]\])/g).map((parte, i) => {
                  const m = /^\[\[([^\]]+)\]\]$/.exec(parte);
                  if (!m) return <span key={i}>{parte}</span>;
                  const alvo = graph.nodes.find((n) => n.label === m[1] || n.id === m[1]);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => alvo && setSel(String(alvo.id))}
                      className="text-violet-300 underline decoration-violet-500/50 underline-offset-2 hover:text-white"
                    >
                      {m[1]}
                    </button>
                  );
                })}
              </p>
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
        ) : arquivoSel ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span
                  className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                  style={{ background: hexToRgba(COR_ARQUIVO, 0.16), color: COR_ARQUIVO }}
                >
                  {arquivoSel.tipo === "csv" ? "Planilha" : "Documento"}
                </span>
                {arquivoSel.status !== "pronto" && (
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">
                    {arquivoSel.status === "processando" ? "lendo…" : "com erro"}
                  </span>
                )}
              </span>
              <button type="button" onClick={() => setSel(null)} className="text-slate-400 hover:text-white" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <h3 className="text-sm font-semibold leading-snug">{arquivoSel.nome}</h3>
            <p className="mt-0.5 truncate text-[11px] text-slate-500" title={arquivoSel.arquivo}>
              {arquivoSel.arquivo}
            </p>
            {arquivoSel.resumo && (
              <p className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-slate-300">
                {arquivoSel.resumo}
              </p>
            )}
            {arquivoSel.colunas.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1">
                {arquivoSel.colunas.slice(0, 12).map((c) => (
                  <span key={c.nome} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10.5px] text-slate-400" title={`${c.tipo} · ${numero(c.preenchidas)} preenchidas`}>
                    {c.nome}
                  </span>
                ))}
                {arquivoSel.colunas.length > 12 && (
                  <span className="px-1 py-0.5 text-[10.5px] text-slate-500">+{arquivoSel.colunas.length - 12}</span>
                )}
              </div>
            )}
            {arquivoSel.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {arquivoSel.tags.map((tg) => (
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
              {numero(arquivoSel.total_linhas)} linha(s) · {arquivoSel.colunas.length} coluna(s) · {desde(arquivoSel.updated_at)}
            </p>
            <Link
              to="/dashboard/lya/arquivos"
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1 text-[12px] hover:bg-white/10"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Abrir no acervo
            </Link>
          </>
        ) : sistemaSel ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                style={{ background: hexToRgba(COR_SISTEMA, 0.16), color: COR_SISTEMA }}
              >
                {SISTEMA_CAMADA_LABEL[sistemaSel.camada]}
              </span>
              <button type="button" onClick={() => setSel(null)} className="text-slate-400 hover:text-white" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <h3 className="text-sm font-semibold leading-snug">{sistemaSel.label}</h3>
            {sistemaSel.detalhe && (
              <p className="mt-2 text-[12px] leading-relaxed text-slate-300">{sistemaSel.detalhe}</p>
            )}
            {sistemaSel.total != null && (
              <p className="mt-2.5 text-[12px] text-slate-200">
                <span className="text-lg font-semibold">{numero(sistemaSel.total)}</span>{" "}
                <span className="text-slate-400">registro(s) agora</span>
              </p>
            )}
            <p className="mt-3 border-t border-white/10 pt-2 text-[11px] text-slate-500">
              {Math.max(0, vizinhos.size - 1)} conexõe(s) · a Lya consulta isto ao responder
            </p>
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
            graphData={visivel}
            width={dims.w}
            height={dims.h}
            backgroundColor="rgba(0,0,0,0)"
            enableNodeDrag
            onNodeDragEnd={(node: NodeRuntime) => {
              if (!ajustes.fixar) {
                node.fx = undefined;
                node.fy = undefined;
              }
            }}
            onEngineStop={() => {
              if (fitDoneRef.current) return;
              fitDoneRef.current = true;
              enquadrar();
            }}
            nodeCanvasObject={desenharNo}
            nodePointerAreaPaint={(n: NodeRuntime, color: string, ctx: CanvasRenderingContext2D) => {
              if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return;
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(n.x as number, n.y as number, 4 + raio(n), 0, 2 * Math.PI);
              ctx.fill();
            }}
            linkColor={(l: LinkRuntime) =>
              linkNascendo(l) ? "rgba(233,241,255,0.85)" : linkEmFoco(l) ? "rgba(199,210,254,0.9)" : "rgba(167,139,250,0.14)"
            }
            linkWidth={(l: LinkRuntime) => (linkNascendo(l) ? 1.6 : linkEmFoco(l) ? 1.4 : 0.6) * ajustes.espessura}
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

function Controle({
  label,
  valor,
  min,
  max,
  step,
  onChange,
  fmt = (v) => String(Math.round(v)),
}: {
  label: string;
  valor: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between">
        <span>{label}</span>
        <span className="font-mono text-[10.5px] text-slate-400">{fmt(valor)}</span>
      </div>
      <Slider value={[valor]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} className="[&_[role=slider]]:h-3.5 [&_[role=slider]]:w-3.5" />
    </div>
  );
}

function BotaoFlutuante({ on, onClick, title, children }: { on?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-medium shadow-2xl backdrop-blur-xl transition-colors",
        on ? "border-white/30 bg-white/[0.16] text-white" : "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.12]",
      )}
    >
      {children}
    </button>
  );
}
