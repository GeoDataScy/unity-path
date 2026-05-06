import { useCallback, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

export type CheckInSnapshot = {
  /** Last 2 hours window (computed relative to "now" at fetch time) */
  recent: {
    services: number;
    followUps: number;
    refundsCreated: number;
    refundsCompleted: number;
  };
  /** From SP midnight today through "now" */
  today: {
    services: number;
    followUps: number;
    refundsCreated: number;
    refundsCompleted: number;
  };
};

function spTodayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function spStartOfTodayUTC(): string {
  const d = spTodayISO();
  // Midnight São Paulo (-03:00) = 03:00 UTC same day
  return `${d}T03:00:00.000Z`;
}

/**
 * Fetches a fresh snapshot of agent activity. Runs the four counters for both
 * windows in parallel against the same row-level-secured tables the agent
 * already reads elsewhere — no new RPCs required, no manager-visible side
 * effects.
 */
export function useCheckInSnapshot(userId: string | null) {
  const [snapshot, setSnapshot] = useState<CheckInSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);

    try {
      const nowISO = new Date().toISOString();
      const twoHoursAgoISO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const startOfTodayISO = spStartOfTodayUTC();

      const [
        servicesRecent,
        servicesToday,
        followUpsRecent,
        followUpsToday,
        refundsCreatedRecent,
        refundsCreatedToday,
        refundsCompletedRecent,
        refundsCompletedToday,
      ] = await Promise.all([
        supabase.from("services")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("created_at", twoHoursAgoISO)
          .lte("created_at", nowISO),
        supabase.from("services")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("created_at", startOfTodayISO)
          .lte("created_at", nowISO),
        supabase.from("service_follow_ups")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("recorded_at", twoHoursAgoISO)
          .lte("recorded_at", nowISO),
        supabase.from("service_follow_ups")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("recorded_at", startOfTodayISO)
          .lte("recorded_at", nowISO),
        supabase.from("refunds")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("created_at", twoHoursAgoISO)
          .lte("created_at", nowISO),
        supabase.from("refunds")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("created_at", startOfTodayISO)
          .lte("created_at", nowISO),
        supabase.from("refunds")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .not("completion_date", "is", null)
          .gte("completion_date", spTodayISO())
          .lte("completion_date", spTodayISO()),
        supabase.from("refunds")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .not("completion_date", "is", null)
          .eq("completion_date", spTodayISO()),
      ]);

      // refundsCompletedRecent is a best-effort approximation: completion_date
      // is a `date` column (no time component), so we can only know it was
      // completed today, not whether within the last 2 hours specifically.
      // Treat both windows the same for refund completions.
      const completedToday = refundsCompletedToday.count ?? 0;
      const completedRecent = refundsCompletedRecent.count ?? completedToday;

      setSnapshot({
        recent: {
          services: servicesRecent.count ?? 0,
          followUps: followUpsRecent.count ?? 0,
          refundsCreated: refundsCreatedRecent.count ?? 0,
          refundsCompleted: completedRecent,
        },
        today: {
          services: servicesToday.count ?? 0,
          followUps: followUpsToday.count ?? 0,
          refundsCreated: refundsCreatedToday.count ?? 0,
          refundsCompleted: completedToday,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar resumo");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  return { snapshot, loading, error, refresh };
}
