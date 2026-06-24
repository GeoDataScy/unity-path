import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { emitAgentInteraction } from "@/features/agent/check-in/agent-events";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ServiceStatus = "em_andamento" | "concluido";

export interface FollowUpRow {
  id: string;
  service_id: string;
  user_id: string;
  follow_up_number: number;
  status: string;
  recorded_at: string;
  observation: string;
  created_at: string;
}

// ── Query hook: fetch all follow-ups for the current agent ─────────────────────

export function useFollowUpsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["service-follow-ups"],
    enabled,
    queryFn: async (): Promise<FollowUpRow[]> => {
      const PAGE = 1000;
      const all: FollowUpRow[] = [];
      let from = 0;
      while (true) {
        // Ordenação DETERMINÍSTICA para paginação estável: recorded_at sozinho
        // não é único (e follow_up_number repete em milhares de linhas), então
        // o OFFSET pulava/duplicava registros na fronteira das páginas a partir
        // de 1000 follow-ups — fazendo o histórico de alguns tickets sumir.
        // O desempate por `id` (único) garante páginas estáveis. A ordem
        // cronológica é preservada (consumidores usam o último item = mais recente).
        const { data, error } = await supabase
          .from("service_follow_ups")
          .select("*")
          .order("recorded_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as FollowUpRow[];
        all.push(...rows);
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      return all;
    },
    // Esta query pagina TODO o histórico de follow-ups do agente (vários
    // requests sequenciais). Com staleTime > 0 ela não é re-baixada inteira a
    // cada foco da janela — só quando "velha" (>60s). Mutações de follow-up
    // invalidam a query e forçam o recarregamento imediato quando necessário.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

// ── Helper: group follow-ups by service_id ─────────────────────────────────────

function groupByService(rows: FollowUpRow[]): Record<string, FollowUpRow[]> {
  const map: Record<string, FollowUpRow[]> = {};
  for (const row of rows) {
    if (!map[row.service_id]) map[row.service_id] = [];
    map[row.service_id].push(row);
  }
  return map;
}

// ── Main hook ──────────────────────────────────────────────────────────────────

export function useStatusTracking() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: allFollowUps = [] } = useFollowUpsQuery(true);
  // Memoizado: sem isto, o mapa de TODOS os follow-ups do agente era
  // reconstruído a cada render (pesado em contas com milhares de interações).
  const grouped = useMemo(() => groupByService(allFollowUps), [allFollowUps]);

  /** Get all follow-up entries for a service */
  const getEntries = useCallback(
    (serviceId: string): FollowUpRow[] => {
      return grouped[serviceId] ?? [];
    },
    [grouped],
  );

  /** Get the current display status for a service */
  const getCurrentStatus = useCallback(
    (serviceId: string, serviceStatus?: string): { label: string; variant: "open" | "in-progress" | "done" } => {
      const entries = grouped[serviceId];

      // Service concluded directly (no follow-ups), set via status field
      if (serviceStatus === "concluido" && (!entries || entries.length === 0)) {
        return { label: "Concluído", variant: "done" };
      }

      if (!entries || entries.length === 0) {
        return { label: "Em Aberto", variant: "open" };
      }

      const last = entries[entries.length - 1];
      if (last.status === "concluido") {
        return { label: "Concluído", variant: "done" };
      }

      const inProgressCount = entries.filter((e) => e.status === "em_andamento").length;
      if (inProgressCount <= 1) {
        return { label: "Em Andamento", variant: "in-progress" };
      }
      return { label: `Em Andamento ${inProgressCount}`, variant: "in-progress" };
    },
    [grouped],
  );

  /**
   * Rule: after a follow-up interaction, service stays blocked until 18:00 (São Paulo tz)
   * of the same day. First follow-up is always allowed (ticket creation is not an interaction).
   */
  const canAddInteraction = useCallback(
    (serviceId: string, serviceDate: string | null, hasTrackingCode: boolean = false): { allowed: boolean; nextAllowedAt?: Date; reason?: string } => {
      const entries = grouped[serviceId] ?? [];

      // No follow-ups yet → first interaction is always allowed
      if (entries.length === 0) {
        return { allowed: true };
      }

      let lastTime: Date | null = null;
      {
        const last = entries[entries.length - 1];
        lastTime = new Date(last.recorded_at);
      }

      if (!lastTime || isNaN(lastTime.getTime())) {
        return { allowed: true };
      }

      if (hasTrackingCode) {
        return { allowed: true };
      }

      const spDateFmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const spDate = spDateFmt.format(lastTime);
      const blockUntil = new Date(`${spDate}T18:00:00-03:00`);
      const now = new Date();

      if (now < blockUntil) {
        return {
          allowed: false,
          nextAllowedAt: blockUntil,
          reason: "A próxima interação com este atendimento só pode ser registrada no dia seguinte.",
        };
      }

      return { allowed: true };
    },
    [grouped],
  );

  /** Mutation to insert a new follow-up */
  const addEntryMutation = useMutation({
    mutationFn: async (params: {
      serviceId: string;
      status: ServiceStatus;
      observation: string;
    }) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada");

      const existing = grouped[params.serviceId] ?? [];
      const followUpNumber = existing.length + 1;

      // recorded_at is pinned to now() by a BEFORE INSERT trigger on the server,
      // so the past stays immutable regardless of what we send from the client.
      const { error } = await supabase.from("service_follow_ups").insert({
        service_id: params.serviceId,
        user_id: session.user.id,
        follow_up_number: followUpNumber,
        status: params.status,
        observation: params.observation,
      });

      if (error) throw error;
    },
    // Atualização otimista: insere o follow-up no cache imediatamente, para o
    // status e o contador (#N) na tabela "Meus Atendimentos" mudarem na hora —
    // sem esperar o recarregamento de TODOS os follow-ups do agente (que, com
    // milhares de registros, levava alguns segundos e dava a impressão de "não
    // salvou / não mudou o status").
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: ["service-follow-ups"] });
      const previous = queryClient.getQueryData<FollowUpRow[]>(["service-follow-ups"]);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const existing = grouped[params.serviceId] ?? [];
      const nowISO = new Date().toISOString();
      const optimisticRow: FollowUpRow = {
        id: `optimistic-${params.serviceId}-${nowISO}`,
        service_id: params.serviceId,
        user_id: session?.user.id ?? "",
        follow_up_number: existing.length + 1,
        status: params.status,
        recorded_at: nowISO,
        observation: params.observation,
        created_at: nowISO,
      };
      queryClient.setQueryData<FollowUpRow[]>(["service-follow-ups"], (old) =>
        old ? [...old, optimisticRow] : [optimisticRow],
      );
      return { previous };
    },
    onSuccess: () => {
      emitAgentInteraction();
    },
    onError: (error: unknown, _params, context) => {
      // Desfaz a atualização otimista e mostra a causa real (rede, sessão, RLS…).
      const ctx = context as { previous?: FollowUpRow[] } | undefined;
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(["service-follow-ups"], ctx.previous);
      }
      const message =
        error instanceof Error ? error.message : "Não foi possível registrar a interação.";
      console.error("[follow-up] insert failed:", error);
      toast({
        title: "Erro ao registrar interação",
        description: message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      // Reconcilia com o servidor (troca a linha otimista pela real) e atualiza
      // métricas + a lista de atendimentos recentes.
      queryClient.invalidateQueries({ queryKey: ["service-follow-ups"] });
      queryClient.invalidateQueries({ queryKey: ["agent", "daily-metrics"] });
      queryClient.invalidateQueries({ queryKey: ["services", "me"] });
    },
  });

  return { getEntries, getCurrentStatus, addEntryMutation, canAddInteraction };
}
