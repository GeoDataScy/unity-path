// Ponte do browser com o acervo de arquivos da Lya: as RPCs `lya_*_arquivo` /
// `lya_*_file` (com o JWT do usuário — os guards ficam no banco) e a ação
// `arquivo_interpretar` da Edge Function, que é quem lê o arquivo e escreve o
// resumo.
import { supabase } from "@/integrations/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabaseError";

import type { LyaArquivo, LyaArquivoDetalhe, LyaArquivoParse, LyaColuna } from "../types";

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lya`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/** Quantas linhas por chamada de `lya_inserir_linhas`. */
const LOTE = 500;

// As RPCs da Lya ainda não estão nos tipos gerados do Supabase: chamada sem
// tipagem, com o retorno tipado aqui (mesmo expediente de `../api.ts`).
const rpc = supabase.rpc.bind(supabase) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

async function callFunction(body: Record<string, unknown>): Promise<Response> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error("Sessão inválida. Entre de novo.");
  return fetch(FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: ANON_KEY },
    body: JSON.stringify(body),
  });
}

/**
 * O banco devolve o arquivo como jsonb cru. Normalizar aqui evita que cada
 * tela tenha que se defender de `colunas`/`tags` chegando como null.
 */
function normalizar(row: unknown): LyaArquivo {
  const r = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id ?? ""),
    nome: String(r.nome ?? ""),
    arquivo: String(r.arquivo ?? ""),
    tipo: r.tipo === "markdown" ? "markdown" : "csv",
    status: r.status === "pronto" || r.status === "erro" ? r.status : "processando",
    colunas: Array.isArray(r.colunas) ? (r.colunas as LyaColuna[]) : [],
    total_linhas: Number(r.total_linhas ?? 0),
    resumo: String(r.resumo ?? ""),
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    erro: r.erro == null ? null : String(r.erro),
    bytes: Number(r.bytes ?? 0),
    uploaded_by: r.uploaded_by == null ? null : String(r.uploaded_by),
    uploaded_by_nome: r.uploaded_by_nome == null ? null : String(r.uploaded_by_nome),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

// ── Leitura (gestora e time de copy) ────────────────────────────────────────

export async function lyaListFiles(): Promise<LyaArquivo[]> {
  const { data, error } = await rpc("lya_list_files");
  if (error) throw new Error(supabaseErrorMessage(error, "Não foi possível carregar os arquivos da Lya."));
  return (Array.isArray(data) ? data : []).map(normalizar);
}

export async function lyaGetFile(id: string, amostra = 20): Promise<LyaArquivoDetalhe | null> {
  const { data, error } = await rpc("lya_get_file", { p_file_id: id, p_amostra: amostra });
  if (error) throw new Error(supabaseErrorMessage(error, "Não foi possível abrir o arquivo."));
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  return {
    ...normalizar(r),
    conteudo: String(r.conteudo ?? ""),
    amostra: Array.isArray(r.amostra)
      ? (r.amostra as { linha: number; data: Record<string, unknown> }[])
      : [],
  };
}

// ── Escrita (só gestora; o guard é `is_manager()` no banco) ─────────────────

export async function lyaAtualizarArquivo(
  id: string,
  campos: { nome?: string; resumo?: string; tags?: string[] },
): Promise<LyaArquivo> {
  const { data, error } = await rpc("lya_atualizar_arquivo", {
    p_file_id: id,
    p_nome: campos.nome ?? null,
    p_resumo: campos.resumo ?? null,
    p_tags: campos.tags ?? null,
  });
  if (error) throw new Error(supabaseErrorMessage(error, "Não foi possível salvar o arquivo."));
  return normalizar(data);
}

export async function lyaDeleteFile(id: string): Promise<number> {
  const { data, error } = await rpc("lya_delete_file", { p_file_id: id });
  if (error) throw new Error(supabaseErrorMessage(error, "Não foi possível apagar o arquivo."));
  return Number(data ?? 0);
}

// ── Upload ──────────────────────────────────────────────────────────────────

export type LyaUploadEtapa = "criando" | "enviando" | "interpretando";

export interface LyaUploadProgresso {
  etapa: LyaUploadEtapa;
  /** Linhas já gravadas (0 nas etapas que não enviam linha). */
  enviadas: number;
  total: number;
}

export interface LyaUploadResultado {
  arquivo: LyaArquivo;
  /** false = subiu, mas a Lya não conseguiu ler (a tela avisa). */
  interpretado: boolean;
  aviso?: string;
}

async function criarArquivo(nome: string, parse: LyaArquivoParse): Promise<string> {
  const { data, error } = await rpc("lya_criar_arquivo", {
    p_nome: nome,
    p_arquivo: parse.arquivo,
    p_tipo: parse.tipo,
    p_bytes: parse.bytes,
    p_conteudo: parse.conteudo,
  });
  if (error) throw new Error(supabaseErrorMessage(error, "Não foi possível criar o arquivo."));
  const id = typeof data === "string" ? data : String((data as { id?: unknown })?.id ?? "");
  if (!id) throw new Error("O banco não devolveu o id do arquivo.");
  return id;
}

async function finalizar(
  id: string,
  campos: { colunas?: LyaColuna[]; total?: number; resumo?: string; tags?: string[]; erro?: string | null },
): Promise<LyaArquivo> {
  const { data, error } = await rpc("lya_finalizar_arquivo", {
    p_file_id: id,
    p_colunas: campos.colunas ?? [],
    p_total: campos.total ?? 0,
    p_resumo: campos.resumo ?? "",
    p_tags: campos.tags ?? [],
    p_erro: campos.erro ?? null,
  });
  if (error) throw new Error(supabaseErrorMessage(error, "Não foi possível finalizar o arquivo."));
  return normalizar(data);
}

/**
 * Sobe um arquivo já parseado e devolve o que ficou no banco.
 *
 * A ordem importa: cria a linha (status `processando`), manda as linhas em
 * lotes de 500 (um insert de 50.000 linhas estoura o payload e trava a aba) e
 * só então pede a interpretação à Edge Function, que finaliza o arquivo e cria
 * o nó de cognição. Se a interpretação falhar — a ação pode estar fora do ar —
 * finalizamos aqui mesmo com o perfil de colunas: o arquivo fica consultável,
 * só sem o resumo da Lya. Arquivo preso em `processando` é o que não pode
 * acontecer.
 */
export async function lyaEnviarArquivo(
  nome: string,
  parse: LyaArquivoParse,
  onProgress?: (p: LyaUploadProgresso) => void,
): Promise<LyaUploadResultado> {
  const total = parse.linhas.length;
  onProgress?.({ etapa: "criando", enviadas: 0, total });

  const id = await criarArquivo(nome, parse);

  try {
    for (let i = 0; i < total; i += LOTE) {
      const lote = parse.linhas.slice(i, i + LOTE);
      const { error } = await rpc("lya_inserir_linhas", { p_file_id: id, p_linhas: lote, p_offset: i });
      if (error) throw new Error(supabaseErrorMessage(error, "Não foi possível gravar as linhas do arquivo."));
      onProgress?.({ etapa: "enviando", enviadas: Math.min(i + LOTE, total), total });
    }
  } catch (err) {
    // Grava o motivo na própria linha para a tela mostrar por que falhou.
    const motivo = err instanceof Error ? err.message : "Falha ao gravar as linhas.";
    await finalizar(id, { colunas: parse.colunas, total: 0, erro: motivo }).catch(() => undefined);
    throw err instanceof Error ? err : new Error(motivo);
  }

  onProgress?.({ etapa: "interpretando", enviadas: total, total });

  try {
    const res = await callFunction({ action: "arquivo_interpretar", file_id: id });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      const msg = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : "";
      throw new Error(msg || `A Lya não conseguiu ler o arquivo (HTTP ${res.status}).`);
    }
    const payload = (await res.json()) as { arquivo?: unknown };
    const arquivo = payload?.arquivo && typeof payload.arquivo === "object"
      ? normalizar(payload.arquivo)
      : (await lyaGetFile(id, 0)) ?? (await finalizar(id, { colunas: parse.colunas, total }));
    return { arquivo, interpretado: true };
  } catch (err) {
    const arquivo = await finalizar(id, { colunas: parse.colunas, total });
    return {
      arquivo,
      interpretado: false,
      aviso: err instanceof Error ? err.message : "A Lya não conseguiu ler o arquivo.",
    };
  }
}
