import { supabase } from "@/integrations/supabase/client";

// Lê a flag profiles.can_view_geovani_analyses numa consulta SEPARADA do select
// principal de profiles dos layouts. De propósito: a migration da coluna pode
// chegar em prod depois do front, e uma coluna inexistente no select principal
// faz o PostgREST responder erro — que os layouts tratam com signOut de todo
// mundo. Aqui qualquer erro (coluna ausente, rede, RLS) vira simplesmente
// "sem acesso".

const COLUMN = "can_view_geovani_analyses";

export async function fetchGeovaniAnalysesGrant(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    // Cast: a coluna pode ainda não estar nos tipos gerados do Supabase.
    const { data, error } = await supabase
      .from("profiles")
      .select(COLUMN as "id")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return false;
    return Boolean((data as unknown as Record<string, unknown>)[COLUMN]);
  } catch {
    return false;
  }
}
