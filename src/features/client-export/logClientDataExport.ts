import type { Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

// Ajuste 6 do Jurídico: toda exportação com dado pessoal de cliente deixa
// registro de quem exportou, quando e qual período/filtros. Chamar ANTES de
// gerar o arquivo: se o registro falhar (ou o perfil não puder exportar), a
// planilha não é baixada. Nunca mandar aqui o termo buscado, que pode ser um
// e-mail de cliente — só se houve busca.
export type ClientExportScreen =
  | "atendimentos"
  | "radar"
  | "relatorio_gestora"
  | "motivo_reembolso"
  | "pedidos_espera";

type Params = {
  screen: ClientExportScreen;
  rowCount: number;
  filters?: Record<string, Json>;
  fromISO?: string | null;
  toISO?: string | null;
};

export async function logClientDataExport({ screen, rowCount, filters = {}, fromISO, toISO }: Params) {
  const { error } = await supabase.rpc("log_client_data_export", {
    p_screen: screen,
    p_row_count: rowCount,
    p_filters: filters,
    p_from: fromISO ?? undefined,
    p_to: toISO ?? undefined,
  });
  if (error) throw error;
}
