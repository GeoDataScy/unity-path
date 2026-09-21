import type { LyaArquivo, LyaMemory, LyaMemoryType } from "./types";

// Grafo do cérebro da Lya — montado no browser, sem tabela de arestas.
//
// São TRÊS camadas num grafo só, porque o cérebro precisa refletir a realidade
// e não só o que foi treinado à mão:
//   `memoria`  — o que a gestora ensinou (`lya_memories`);
//   `arquivo`  — cada planilha/documento ingerido (`lya_files`);
//   `sistema`  — o alcance real dela (`lya_sistema_nos()`: tabelas e telas).
//
// Arestas:
//   memória↔memória  — [[wikilink]] no corpo e tags em comum;
//   memória↔arquivo  — a memória que a Lya escreveu ao interpretar o arquivo
//                      (`origem = 'arquivo'`, `file_id`);
//   arquivo↔sistema  — o resumo/tags do arquivo citam a tabela (critério em
//                      `termosDoSistema`);
//   sistema↔sistema  — o campo `liga` do catálogo.
//
// Tags em comum ligam os nós em CADEIA por tag (a → b → c), não todos com
// todos: escala linear e evita o "novelo" quando uma tag é muito usada.

export type GraphCamada = "memoria" | "arquivo" | "sistema";

/** Sub-camada do catálogo de sistema: tabela do banco, tela do painel ou base. */
export type LyaSistemaCamada = "tabela" | "tela" | "base";

/**
 * Um nó do catálogo devolvido por `lya_sistema_nos()`. O tipo mora aqui (e não
 * em `sistema.ts`) para o grafo continuar puro: `graph.ts` não importa nada de
 * rede, e é isso que deixa `buildGraph` testável sem mock do Supabase.
 */
export interface LyaSistemaNo {
  /** Id do catálogo, ex.: `tabela:services`. Vira `sistema:tabela:services` no grafo. */
  id: string;
  label: string;
  camada: LyaSistemaCamada;
  /** Onde o catálogo escreve o nome real da tabela/RPC — a base do casamento com arquivos. */
  detalhe: string;
  /** `count(*)` ao vivo, ou null onde não faz sentido. */
  total: number | null;
  liga: string[];
}

/** Envelope da RPC `lya_sistema_nos()`. */
export interface LyaSistemaMapa {
  gerado_em: string | null;
  nos: LyaSistemaNo[];
}

export interface GraphNode {
  id: string;
  label: string;
  camada: GraphCamada;
  /** Tipo da memória — define a cor. `null` nas outras camadas, que não têm tipo. */
  type: LyaMemoryType | null;
  tags: string[];
  /** 1 + grau: nós mais conectados ficam maiores. */
  val: number;
  updated_at: string;
  created_at: string;
  /** Camada `arquivo`: o arquivo que virou o nó (o painel lateral lê daqui). */
  arquivo?: LyaArquivo;
  /** Camada `sistema`: o nó do catálogo. */
  sistema?: LyaSistemaNo;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: "link" | "tag" | "arquivo" | "cita" | "liga";
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

// Ids do grafo. Memória continua usando o `name` puro (é por ele que a tela
// acha a memória de volta). Arquivo e sistema ganham prefixo com `:` — e como
// `name` é sempre um slug e `slugify` remove `:`, nenhuma memória consegue
// colidir com eles, nem mesmo quando o catálogo manda um id solto (`"arquivo"`)
// que por acaso seja igual ao nome de uma memória.
export const idArquivo = (fileId: string) => `arquivo:${fileId}`;
export const idSistema = (noId: string) => `sistema:${noId}`;

const semAcento = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Palavras "de identificador": `services.client_email` vira services + client_email. */
function tokens(texto: string): string[] {
  return semAcento(texto).match(/[a-z0-9_]+/g) ?? [];
}

const TERMO_MIN = 4;

/**
 * Os termos que fazem um arquivo "citar" este nó de sistema.
 *
 * Só identificador de banco entra: token do `detalhe` que tenha `_`
 * (`dashboard_metrics`, `held_orders`) ou que seja igual ao sufixo do `id`
 * (`tabela:services` + detalhe "services — um ticket por linha" → `services`).
 * A prosa do `detalhe` e o rótulo em português ficam de fora de propósito:
 * ligar por palavras como "ticket", "linha" ou "atendimentos" casaria quase
 * todo arquivo com quase toda tela e o grafo viraria novelo.
 */
export function termosDoSistema(no: LyaSistemaNo): string[] {
  const sufixo = no.id.includes(":") ? no.id.slice(no.id.lastIndexOf(":") + 1) : no.id;
  const alvo = semAcento(sufixo);
  const out = new Set<string>();
  for (const t of tokens(no.detalhe || "")) {
    if (t.length < TERMO_MIN) continue;
    if (t.includes("_") || t === alvo) out.add(t);
  }
  return [...out];
}

/** O que o arquivo "diz": tags + resumo escrito pela Lya, quebrados em tokens. */
function tokensDoArquivo(f: LyaArquivo): Set<string> {
  return new Set(tokens(`${(f.tags ?? []).join(" ")} ${f.resumo ?? ""}`));
}

export function buildGraph(
  memorias: LyaMemory[],
  arquivos: LyaArquivo[] = [],
  sistema: LyaSistemaNo[] = [],
): BrainGraph {
  const nomes = new Set(memorias.map((m) => m.name));
  const nodes = new Map<string, GraphNode>();
  for (const m of memorias) {
    nodes.set(m.name, {
      id: m.name,
      label: m.description || m.name,
      camada: "memoria",
      type: m.type,
      tags: m.tags ?? [],
      val: 1,
      updated_at: m.updated_at,
      created_at: m.created_at,
    });
  }
  for (const f of arquivos) {
    const id = idArquivo(f.id);
    if (nodes.has(id)) continue;
    nodes.set(id, {
      id,
      label: f.nome,
      camada: "arquivo",
      type: null,
      tags: f.tags ?? [],
      val: 1,
      updated_at: f.updated_at,
      created_at: f.created_at,
      arquivo: f,
    });
  }
  for (const s of sistema) {
    const id = idSistema(s.id);
    if (nodes.has(id)) continue;
    nodes.set(id, {
      id,
      label: s.label,
      camada: "sistema",
      type: null,
      tags: [],
      val: 1,
      // O catálogo não tem idade por nó — o painel de sistema não mostra "desde".
      updated_at: "",
      created_at: "",
      sistema: s,
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

  // 3) memória ↔ arquivo: a memória que a Lya escreveu ao interpretar o arquivo
  for (const m of memorias) {
    if (m.origem !== "arquivo" || !m.file_id) continue;
    const alvo = idArquivo(m.file_id);
    if (nodes.has(alvo)) addLink(m.name, alvo, "arquivo");
  }

  // 4) arquivo ↔ sistema: o resumo/as tags do arquivo citam a tabela
  if (arquivos.length > 0 && sistema.length > 0) {
    const termos = sistema.map((s) => ({ id: idSistema(s.id), termos: termosDoSistema(s) }));
    for (const f of arquivos) {
      const ditos = tokensDoArquivo(f);
      for (const s of termos) {
        if (s.termos.some((t) => ditos.has(t))) addLink(idArquivo(f.id), s.id, "cita");
      }
    }
  }

  // 5) sistema ↔ sistema: o campo `liga` do catálogo
  for (const s of sistema) {
    for (const alvo of s.liga ?? []) {
      const id = idSistema(alvo);
      if (nodes.has(id)) addLink(idSistema(s.id), id, "liga");
    }
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
