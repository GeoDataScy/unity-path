import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
      const { data, error } = await supabase
        .from("service_follow_ups")
        .select("*")
        .order("follow_up_number", { ascending: true })
        .limit(10000);

      if (error) throw error;
      return (data ?? []) as FollowUpRow[];
    },
    staleTime: 0,
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
  const { data: allFollowUps = [] } = useFollowUpsQuery(true);
  const grouped = groupByService(allFollowUps);

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
      recordedAt: string; // ISO timestamptz
      observation: string;
    }) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada");

      // Calculate follow_up_number
      const existing = grouped[params.serviceId] ?? [];
      const followUpNumber = existing.length + 1;

      const { error } = await supabase.from("service_follow_ups").insert({
        service_id: params.serviceId,
        user_id: session.user.id,
        follow_up_number: followUpNumber,
        status: params.status,
        recorded_at: params.recordedAt,
        observation: params.observation,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-follow-ups"] });
      queryClient.invalidateQueries({ queryKey: ["agent", "daily-metrics"] });
    },
  });

  return { getEntries, getCurrentStatus, addEntryMutation, canAddInteraction };
}
