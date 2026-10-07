import type { TransferHistoryItem } from "./useTransferHistoryQuery";

/** Rótulo de quem encaminhou quando a origem é a gestora: nunca o nome de uma pessoa. */
export const ENCAMINHADO_PELA_GESTAO = "Imperium (área de suporte)";

/**
 * Coluna "Encaminhado por" de Transferências (ajuste 5 do doc XMX-2026/IMP-SUP-01-A v2):
 * gestora → "Imperium (área de suporte)"; outro prestador → o nome dele.
 */
export function encaminhadoPor(t: Pick<TransferHistoryItem, "assigned_by_manager_id" | "other_agent_name">): string {
  if (t.assigned_by_manager_id) return ENCAMINHADO_PELA_GESTAO;
  return t.other_agent_name?.trim() || "—";
}
