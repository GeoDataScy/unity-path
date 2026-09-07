import type { LyaMemory, LyaMemoryType } from "./types";

// Grafo do cérebro da Lya — nós = memórias, arestas = [[wikilinks]] no corpo +
// tags em comum. Montado no browser a partir da lista de memórias (mesma
// lógica do _build_graph do Daniel/CBIE): não existe tabela de arestas.
//
// Tags em comum ligam os nós em CADEIA por tag (a → b → c), não todos com
// todos: escala linear e evita o "novelo" quando uma tag é muito usada.

export interface GraphNode {
  id: string;
  label: string;
  type: LyaMemoryType;
  tags: string[];
  /** 1 + grau: nós mais conectados ficam maiores. */
  val: number;
  updated_at: string;
  created_at: string;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: "link" | "tag";
}

export interface BrainGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

const WIKILINK = /\[\[([^\]]+)\]\]/g;

/** Espelha lya_slugify (Postgres) e o slugify da Edge Function. */
export function slugify(s: string, n = 60): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, n);
}

export function buildGraph(memorias: LyaMemory[]): BrainGraph {
  const nomes = new Set(memorias.map((m) => m.name));
  const nodes = new Map<string, GraphNode>();
  for (const m of memorias) {
    nodes.set(m.name, {
      id: m.name,
      label: m.description || m.name,
      type: m.type,
      tags: m.tags ?? [],
      val: 1,
      updated_at: m.updated_at,
      created_at: m.created_at,
    });
  }

  const links: GraphLink[] = [];
  const vistos = new Set<string>();
  const addLink = (a: string, b: string, kind: GraphLink["kind"]) => {
    if (a === b) return;
    const key = [a, b].sort().join("|") + kind;
    if (vistos.has(key)) return;
    vistos.add(key);
    links.push({ source: a, target: b, kind });
  };

  // 1) wikilinks explícitos no corpo
  for (const m of memorias) {
    for (const match of (m.body || "").matchAll(WIKILINK)) {
      const alvo = slugify(match[1]);
      if (nomes.has(alvo)) addLink(m.name, alvo, "link");
    }
  }

  // 2) tags em comum → cadeia por tag
  const porTag = new Map<string, string[]>();
  for (const m of memorias) {
    for (const t of m.tags ?? []) {
      const lista = porTag.get(t) ?? [];
      lista.push(m.name);
      porTag.set(t, lista);
    }
  }
  for (const arr of porTag.values()) {
    for (let i = 0; i < arr.length - 1; i++) addLink(arr[i], arr[i + 1], "tag");
  }

  // val proporcional ao grau
  const grau = new Map<string, number>();
  for (const l of links) {
    grau.set(l.source, (grau.get(l.source) ?? 0) + 1);
    grau.set(l.target, (grau.get(l.target) ?? 0) + 1);
  }
  for (const [id, n] of nodes) n.val = 1 + (grau.get(id) ?? 0);

  return { nodes: [...nodes.values()], links };
}

/** "agora", "há 2 min", "há 3 h", "há 4 d" — para a faixa e o painel do nó. */
export function desde(iso: string, agora = Date.now()): string {
  const ms = agora - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "agora";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d < 30 ? `há ${d} d` : `há ${Math.floor(d / 30)} m`;
}
