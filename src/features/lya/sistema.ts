// As duas camadas do grafo que NÃO vêm de `lya_memories`: o acervo de arquivos
// (`lya_list_files`) e o catálogo do que a Lya alcança de verdade
// (`lya_sistema_nos`).
//
// Vive num arquivo próprio, separado do `arquivos/api.ts` da tela de acervo,
// porque o cérebro só quer LER as duas listas — não depende do upload nem das
// mutations de lá, e assim as duas telas podem evoluir sem se esbarrar.
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabaseError";

import type { LyaSistemaMapa, LyaSistemaNo } from "./graph";
import type { LyaArquivo } from "./types";

// Mesmo expediente do `api.ts`: as RPCs da Lya não estão nos tipos gerados.
const rpc = supabase.rpc.bind(supabase) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

/**
 * A RPC ainda não existe neste banco? O cérebro não pode quebrar por isso: a
 * migration pode não ter subido ainda (ou o ambiente é antigo) e o grafo tem
 * que continuar desenhando as memórias. `PGRST202` é "função não encontrada no
 * schema cache"; a mensagem cobre o caso em que o PostgREST responde só texto.
 */
function ausente(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /could not find the function|does not exist|schema cache/i.test(error.message ?? "");
}

const texto = (v: unknown) => (typeof v === "string" ? v : "");
const lista = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

function normalizarNo(raw: unknown): LyaSistemaNo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = texto(o.id);
  if (!id) return null;
  const camada = o.camada === "tela" || o.camada === "base" ? o.camada : "tabela";
  return {
    id,
    label: texto(o.label) || id,
    camada,
    detalhe: texto(o.detalhe),
    total: typeof o.total === "number" ? o.total : o.total == null ? null : Number(o.total),
    liga: lista(o.liga),
  };
}

/** O alcance real da Lya: tabelas e telas que ela consulta, com número vivo. */
export async function lyaSistemaNos(): Promise<LyaSistemaMapa> {
  const { data, error } = await rpc("lya_sistema_nos");
  if (error) {
    if (ausente(error)) return { gerado_em: null, nos: [] };
    throw new Error(supabaseErrorMessage(error, "Não foi possível ler o alcance da Lya."));
  }
  const envelope = (data ?? {}) as Record<string, unknown>;
  const nos = Array.isArray(envelope.nos) ? envelope.nos : [];
  return {
    gerado_em: texto(envelope.gerado_em) || null,
    nos: nos.map(normalizarNo).filter((n): n is LyaSistemaNo => n !== null),
  };
}

/** O acervo de arquivos ingeridos, só para desenhar a camada `arquivo`. */
export async function lyaArquivosDoGrafo(): Promise<LyaArquivo[]> {
  const { data, error } = await rpc("lya_list_files");
  if (error) {
    if (ausente(error)) return [];
    throw new Error(supabaseErrorMessage(error, "Não foi possível ler os arquivos da Lya."));
  }
  return (Array.isArray(data) ? data : []).map((raw) => {
    const f = raw as LyaArquivo & { tags: unknown; colunas: unknown };
    return {
      ...f,
      tags: Array.isArray(f.tags) ? f.tags.map(String) : [],
      colunas: Array.isArray(f.colunas) ? f.colunas : [],
    } as LyaArquivo;
  });
}

export const LYA_SISTEMA_KEY = ["lya", "sistema"] as const;
export const LYA_ARQUIVOS_GRAFO_KEY = ["lya", "arquivos", "grafo"] as const;

/**
 * `lya_sistema_nos` faz `count(*)` ao vivo: é barato, mas não a ponto de entrar
 * no polling de 4 s do grafo. Um minuto de `staleTime` (mais o refetch ao
 * voltar para a aba) já deixa o número "de hoje" sem castigar o banco.
 */
export function useLyaSistemaQuery(enabled = true) {
  return useQuery({
    queryKey: LYA_SISTEMA_KEY,
    queryFn: lyaSistemaNos,
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useLyaArquivosGrafoQuery(enabled = true) {
  return useQuery({
    queryKey: LYA_ARQUIVOS_GRAFO_KEY,
    queryFn: lyaArquivosDoGrafo,
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}
