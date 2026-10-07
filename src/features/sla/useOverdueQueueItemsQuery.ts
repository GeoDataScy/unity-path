import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { parseOverdueQueueItems, type OverdueQueueItem } from "./types";

/** Itens da fila do próprio prestador com prazo contratual vencido agora. */
export function useOverdueQueueItemsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["sla", "overdue-queue"],
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<OverdueQueueItem[]> => {
      const { data, error } = await supabase.rpc("my_overdue_queue_items");
      if (error) throw error;
      return parseOverdueQueueItems(data);
    },
  });
}
