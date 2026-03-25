import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SupportChannel = "email" | "sms";

export type AgentOption = {
  id: string;
  label: string;
};

export function useAgentsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard", "agents"],
    enabled,
    queryFn: async (): Promise<AgentOption[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "agent")
        .order("full_name", { ascending: true, nullsFirst: false });

      if (error) throw error;

      return (data ?? []).map((p) => {
        const name = (p.full_name ?? "").trim();
        const email = (p as any).email as string | undefined;
        return {
          id: p.id,
          label: name.length > 0 ? name : email ? `Sem nome (${email})` : "Sem nome",
        };
      });
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
