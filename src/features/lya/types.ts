// Lya — agente de IA do Painel da Gestora. Tipos compartilhados entre o chat
// (tela cheia + balão), o histórico e a tela "Cérebro da Lya".
//
// Os blocos ricos da mensagem (tools, charts, memorias, revisao) são o que a
// Edge Function `lya` emite pelo SSE; o histórico guarda exatamente isso para a
// conversa reabrir igual ao que o usuário viu.

export type LyaRole = "user" | "assistant";

/**
 * Estado do símbolo da Lya (ver `LyaMark` e o bloco `.lya` em `index.css`).
 * Cada estado tem um movimento próprio — é por movimento, não por cor, que o
 * usuário sabe em que ponto do turno a Lya está.
 */
export type LyaEstado = "repouso" | "pensando" | "respondendo" | "resolvido";

export interface LyaToolCall {
  name: string;
}

export interface LyaChartSeries {
  nome: string;
  valores: number[];
}

export interface LyaChart {
  tipo: "barras" | "linha" | "area" | "pizza";
  titulo: string;
  subtitulo?: string;
  eixoX?: string;
  eixoY?: string;
  categorias: string[];
  series: LyaChartSeries[];
}

export interface LyaMemoriaSalva {
  name: string;
  description: string;
  type: string;
  tags: string[];
}

export interface LyaRevisao {
  aprovado: boolean;
  ressalvas: { afirmacao: string; motivo: string; gravidade: "alta" | "media" | "baixa" }[];
  divergencias: string[];
}

export interface LyaMessage {
  role: LyaRole;
  content: string;
  tools?: LyaToolCall[];
  charts?: LyaChart[];
  memorias?: LyaMemoriaSalva[];
  revisao?: LyaRevisao | null;
}

/** Item da lista de conversas (sem as mensagens). */
export interface LyaChatSummary {
  id: string;
  titulo: string;
  total_mensagens: number;
  created_at: string;
  updated_at: string;
}

export interface LyaChatDetail extends Omit<LyaChatSummary, "total_mensagens"> {
  mensagens: (LyaMessage & { ordem: number })[];
}

/** O que a tela manda junto com a pergunta: período/agente da barra lateral. */
export interface LyaContexto {
  de?: string;
  ate?: string;
  agente_id?: string | null;
  agente_nome?: string | null;
  usuario_nome?: string | null;
  usuario_role?: string | null;
  tela?: string | null;
}

/** Eventos do SSE da Edge Function. */
export type LyaEvent =
  | { type: "token"; text: string }
  | { type: "tool"; name: string; input?: unknown }
  | { type: "chart"; chart: LyaChart }
  | { type: "memoria"; memoria: LyaMemoriaSalva }
  | { type: "aviso"; codigo?: string; message?: string }
  | { type: "revisao"; revisao: LyaRevisao }
  | { type: "error"; message?: string }
  | { type: "done" };

// ── Cérebro ─────────────────────────────────────────────────────────────────

export type LyaMemoryType = "user" | "feedback" | "project" | "reference" | "nota";

export interface LyaMemory {
  id: number;
  name: string;
  description: string;
  type: LyaMemoryType;
  tags: string[];
  body: string;
  author_id: string | null;
  seed: boolean;
  created_at: string;
  updated_at: string;
}

export interface LyaMemoryInput {
  name?: string;
  description: string;
  body?: string;
  tags?: string[];
  /** null = o treinador classifica. */
  type?: LyaMemoryType | null;
  /** false = grava como está (edição manual com tipo explícito). */
  refinar?: boolean;
}

export const TIPOS_MEMORIA: { value: LyaMemoryType; label: string; hint: string; className: string }[] = [
  { value: "feedback", label: "Preferência", hint: "Como ela deve responder (estilo, formato, o que evitar). Vale em toda resposta.", className: "text-amber-600 dark:text-amber-400 border-amber-500/40" },
  { value: "user", label: "Sobre a Lya", hint: "Quem ela é e para quem responde. Vale em toda resposta.", className: "text-blue-600 dark:text-blue-400 border-blue-500/40" },
  { value: "project", label: "Projeto", hint: "Trabalho em andamento, metas do time, contexto de campanha.", className: "text-primary border-primary/40" },
  { value: "reference", label: "Referência", hint: "Link, planilha ou painel externo de confiança.", className: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40" },
  { value: "nota", label: "Nota", hint: "Um fato do suporte; entra quando tem a ver com a pergunta.", className: "text-muted-foreground border-border" },
];

export const TIPO_MEMORIA_MAP = Object.fromEntries(TIPOS_MEMORIA.map((t) => [t.value, t])) as Record<LyaMemoryType, (typeof TIPOS_MEMORIA)[number]>;
