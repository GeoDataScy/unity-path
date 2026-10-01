import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type {
  ZendeskGroup,
  ZendeskLookup,
  ZendeskStatus,
  ZendeskTicketDetail,
  ZendeskTicketFilters,
  ZendeskTicketsPage,
} from "./types";

/**
 * Chama a Edge Function `zendesk`. O token do Zendesk nunca chega ao browser:
 * a função autentica a gestora pelo JWT do Supabase e fala com o Zendesk por
 * conta própria.
 */
async function callZendesk<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("zendesk", { body });
  if (error) {
    // FunctionsHttpError carrega a Response; o corpo tem a mensagem em pt-BR.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const payload = await ctx.json().catch(() => null);
      if (payload?.error) throw new Error(payload.error);
    }
    throw new Error(error.message ?? "Falha ao falar com o Zendesk.");
  }
  if (data && typeof data === "object" && "error" in data && !("connected" in data)) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as T;
}

export function useZendeskStatusQuery(period: { from: string; to: string }) {
  return useQuery({
    queryKey: ["zendesk", "status", period.from, period.to],
    queryFn: () => callZendesk<ZendeskStatus>({ action: "status", from: period.from, to: period.to }),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useZendeskTicketsQuery(f: ZendeskTicketFilters, enabled = true) {
  return useQuery({
    queryKey: ["zendesk", "tickets", f.status, f.groupId, f.q, f.from, f.to, f.page],
    queryFn: () =>
      callZendesk<ZendeskTicketsPage>({
        action: "tickets",
        status: f.status === "all" ? undefined : f.status,
        group_id: f.groupId ?? undefined,
        q: f.q || undefined,
        from: f.from,
        to: f.to,
        page: f.page,
        per_page: 25,
      }),
    enabled,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useZendeskTicketQuery(id: number | null) {
  return useQuery({
    queryKey: ["zendesk", "ticket", id],
    queryFn: () => callZendesk<ZendeskTicketDetail>({ action: "ticket", id }),
    enabled: id !== null,
    staleTime: 30_000,
  });
}

export function useZendeskGroupsQuery(enabled = true) {
  return useQuery({
    queryKey: ["zendesk", "groups"],
    queryFn: async () => (await callZendesk<{ groups: ZendeskGroup[] }>({ action: "groups" })).groups,
    enabled,
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
  });
}

/**
 * Tickets recentes de um e-mail, para o agente pré-encher o atendimento.
 *
 * Não dispara enquanto o agente digita: `email` só muda quando ele clica em
 * buscar. Cada chamada gasta 2 das 400 chamadas/min da conta no Zendesk, e um
 * e-mail meio digitado não devolveria nada útil.
 *
 * `retry: false` porque as falhas aqui não são transitórias — 403 de permissão,
 * credencial ausente, ou o próprio limite de chamadas do Zendesk. Repetir três
 * vezes só piora o limite e faz o agente esperar.
 */
export function useZendeskLookupQuery(email: string | null) {
  return useQuery({
    queryKey: ["zendesk", "lookup", email],
    queryFn: () => callZendesk<ZendeskLookup>({ action: "lookup", email }),
    enabled: Boolean(email),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
