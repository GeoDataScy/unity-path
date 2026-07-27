 import { useQuery } from "@tanstack/react-query";
 import { supabase } from "@/integrations/supabase/client";
 
 type Params = {
   enabled: boolean;
   from: string; // YYYY-MM-DD
   to: string; // YYYY-MM-DD
   agentId?: string; // optional user_id filter
 };
 
 export type DashboardMetrics = {
   total_count: number;
   by_agent: Array<{ name: string; value: number; user_id: string }>;
   by_product: Array<{ name: string; value: number }>;
   by_day: Array<{ day: string; value: number }>;
   by_platform: Array<{ name: string; value: number }>;
   by_channel: Array<{ name: string; value: number }>;
 };
 
 async function requireSession() {
   const {
     data: { session },
     error,
   } = await supabase.auth.getSession();
 
   if (error) throw error;
   if (!session) throw new Error("Sessão inválida");
   return session;
 }
 
 export function useDashboardMetricsQuery({ enabled, from, to, agentId }: Params) {
   return useQuery({
     queryKey: ["dashboard", "metrics", { from, to, agentId: agentId ?? "all" }],
     enabled,
     queryFn: async (): Promise<DashboardMetrics> => {
       await requireSession();
 
       const { data, error } = await supabase.rpc("dashboard_metrics", {
         from_date: from,
         to_date: to,
         agent_id: agentId || null,
       });
 
       if (error) throw error;
       return data as DashboardMetrics;
     },
     refetchOnWindowFocus: false,
   });
 }