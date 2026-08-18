import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type {
  SupportProduct,
  SupportProductInput,
  SupportSmsBrand,
  SupportSmsBrandInput,
  SupportSmsReply,
  SupportSmsReplyInput,
} from "./types";

// As tabelas da Base de Suporte ainda não estão nos tipos gerados do Supabase
// (src/integrations/supabase/types.ts é gerado pela CLI). Mesma saída usada pelas
// RPCs de pedidos em espera: cliente sem schema tipado, tipos vindos de ./types.
const db = supabase as unknown as SupabaseClient;

const PRODUCTS_KEY = ["support-base", "products"] as const;
const BRANDS_KEY = ["support-base", "sms-brands"] as const;
const REPLIES_KEY = ["support-base", "sms-replies"] as const;

// Conteúdo editorial muda raramente — não faz sentido revalidar a cada 30s
// (default global do QueryClient). Toda gravação invalida a chave explicitamente.
const CONTENT_STALE_TIME = 5 * 60_000;

/**
 * `includeInactive` separa os dois consumidores: a tela do agente só enxerga o que
 * está ativo, o admin da gestora precisa ver (e reativar) o que foi desativado.
 * Entra na queryKey para as duas versões não se sobrescreverem no cache.
 */
export function useSupportProductsQuery(includeInactive = false) {
  return useQuery({
    queryKey: [...PRODUCTS_KEY, { includeInactive }],
    staleTime: CONTENT_STALE_TIME,
    queryFn: async (): Promise<SupportProduct[]> => {
      let query = db
        .from("support_products")
        .select(
          "id, nome, funcao, url, estrutura, plataforma, bonus_url, bonus_tipo, nicho, sms_number, links, ativo, sort_order",
        )
        .order("sort_order", { ascending: true })
        .order("nome", { ascending: true });

      if (!includeInactive) query = query.eq("ativo", true);

      const { data, error } = await query;
      if (error) throw error;
      return ((data ?? []) as SupportProduct[]).map((p) => ({
        ...p,
        links: Array.isArray(p.links) ? p.links : [],
      }));
    },
  });
}

export function useSupportSmsBrandsQuery(includeInactive = false) {
  return useQuery({
    queryKey: [...BRANDS_KEY, { includeInactive }],
    staleTime: CONTENT_STALE_TIME,
    queryFn: async (): Promise<SupportSmsBrand[]> => {
      let query = db
        .from("support_sms_brands")
        .select("id, nome, sistema, estrutura, sms_number, ativo, sort_order")
        .order("sort_order", { ascending: true })
        .order("nome", { ascending: true });

      if (!includeInactive) query = query.eq("ativo", true);

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as SupportSmsBrand[];
    },
  });
}

export function useSupportSmsRepliesQuery(includeInactive = false) {
  return useQuery({
    queryKey: [...REPLIES_KEY, { includeInactive }],
    staleTime: CONTENT_STALE_TIME,
    queryFn: async (): Promise<SupportSmsReply[]> => {
      let query = db
        .from("support_sms_replies")
        .select("id, categoria, titulo, texto_en, texto_pt, ativo, sort_order")
        .order("sort_order", { ascending: true })
        .order("titulo", { ascending: true });

      if (!includeInactive) query = query.eq("ativo", true);

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as SupportSmsReply[];
    },
  });
}

// ── Escrita (só gestora; quem barra é a policy de RLS, não a UI) ──────────────

type SaveArgs<TInput> = { id?: string | null; values: TInput };

/**
 * Um único ponto de gravação por tabela: sem id => INSERT, com id => UPDATE.
 * O `select().single()` devolve a linha gravada e, de quebra, faz o erro de RLS
 * aparecer (um UPDATE bloqueado por policy volta sem erro, mas com zero linhas).
 */
function useSaveMutation<TInput extends object>(
  table: string,
  key: readonly unknown[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: SaveArgs<TInput>) => {
      const query = id
        ? db.from(table).update(values).eq("id", id)
        : db.from(table).insert(values);

      const { data, error } = await query.select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}

function useDeleteMutation(table: string, key: readonly unknown[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useSaveSupportProductMutation() {
  return useSaveMutation<SupportProductInput>("support_products", PRODUCTS_KEY);
}
export function useDeleteSupportProductMutation() {
  return useDeleteMutation("support_products", PRODUCTS_KEY);
}

export function useSaveSupportSmsBrandMutation() {
  return useSaveMutation<SupportSmsBrandInput>("support_sms_brands", BRANDS_KEY);
}
export function useDeleteSupportSmsBrandMutation() {
  return useDeleteMutation("support_sms_brands", BRANDS_KEY);
}

export function useSaveSupportSmsReplyMutation() {
  return useSaveMutation<SupportSmsReplyInput>("support_sms_replies", REPLIES_KEY);
}
export function useDeleteSupportSmsReplyMutation() {
  return useDeleteMutation("support_sms_replies", REPLIES_KEY);
}
