export type ContactReasonCode =
  | "duvida_de_uso"
  | "reembolso"
  | "cancelamento_de_compra"
  | "cancelamento_de_assinatura"
  | "reclamacao_vsl"
  | "troca_de_endereco"
  | "embalagem_danificada"
  | "duvida_de_envio"
  | "ingredientes"
  | "duvidas_geral"
  | "outro";

export type ContactReason = {
  code: ContactReasonCode;
  label: string;
  dot: string;
};

/** Motivo curinga: exige descrição livre em services.contact_reason_note. */
export const CONTACT_REASON_OTHER: ContactReasonCode = "outro";

/** Mesmo teto do CHECK services_contact_reason_note_check. */
export const CONTACT_REASON_NOTE_MAX_LENGTH = 200;

// Keep `code` values in sync with services_contact_reason_check (migrations
// 20260512000000_add_contact_reason_to_services.sql e
// 20260818140000_contact_reason_outro_note.sql). Adding a new motivo
// requires updating that CHECK constraint too.
export const CONTACT_REASONS: readonly ContactReason[] = [
  { code: "duvida_de_uso", label: "Dúvida de uso", dot: "bg-blue-500" },
  { code: "reembolso", label: "Reembolso", dot: "bg-red-500" },
  { code: "cancelamento_de_compra", label: "Cancelamento de compra", dot: "bg-orange-500" },
  { code: "cancelamento_de_assinatura", label: "Cancelamento de assinatura", dot: "bg-amber-500" },
  { code: "reclamacao_vsl", label: "Reclamação VSL", dot: "bg-purple-500" },
  { code: "troca_de_endereco", label: "Troca de endereço", dot: "bg-cyan-500" },
  { code: "embalagem_danificada", label: "Embalagem danificada", dot: "bg-rose-500" },
  { code: "duvida_de_envio", label: "Dúvida de envio", dot: "bg-indigo-500" },
  { code: "ingredientes", label: "Ingredientes", dot: "bg-emerald-500" },
  { code: "duvidas_geral", label: "Dúvidas geral", dot: "bg-slate-400" },
  { code: "outro", label: "Outro (descrever)", dot: "bg-lime-500" },
] as const;

export function getContactReason(code: string | null | undefined): ContactReason | null {
  if (!code) return null;
  return CONTACT_REASONS.find((r) => r.code === code) ?? null;
}

export function requiresContactReasonNote(code: string | null | undefined): boolean {
  return code === CONTACT_REASON_OTHER;
}

/** Normaliza o texto livre para gravação: só existe no motivo "Outro". */
export function normalizeContactReasonNote(
  code: string | null | undefined,
  note: string | null | undefined,
): string | null {
  if (!requiresContactReasonNote(code)) return null;
  const trimmed = (note ?? "").trim().slice(0, CONTACT_REASON_NOTE_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/** Rótulo para exibição/relatório: "Outro" sozinho não diz nada, então leva a nota. */
export function formatContactReason(
  code: string | null | undefined,
  note?: string | null,
): string {
  const reason = getContactReason(code);
  if (!reason) return code === "nao_informado" || !code ? "Não informado" : code;
  if (reason.code !== CONTACT_REASON_OTHER) return reason.label;
  const trimmed = (note ?? "").trim();
  return trimmed.length > 0 ? `Outro — ${trimmed}` : "Outro";
}
