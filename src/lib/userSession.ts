import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type MeStatus = {
  is_active: boolean;
  reason: string | null;
};

export async function getMeStatus(): Promise<MeStatus> {
  const { data, error } = await supabase.rpc("me_status");
  if (error) throw error;
  return data as unknown as MeStatus;
}

export async function sendHeartbeat(): Promise<void> {
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : null;
  const { error } = await supabase.rpc("agent_heartbeat", { p_user_agent: userAgent });
  if (error) throw error;
}

export async function recordAuthEvent(
  eventType: "logout" | "force_logout" | "login",
  metadata?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.rpc("record_auth_event", {
    p_event_type: eventType,
    p_target_user_id: null,
    // p_metadata é jsonb; o tipo gerado é `Json`, que não aceita
    // Record<string, unknown> direto.
    p_metadata: (metadata ?? null) as Json,
  });
  if (error) throw error;
}
