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
  | "duvidas_geral";

export type ContactReason = {
  code: ContactReasonCode;
  label: string;
  dot: string;
};

// Keep `code` values in sync with services_contact_reason_check (migration
// 20260512000000_add_contact_reason_to_services.sql). Adding a new motivo
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
] as const;

export function getContactReason(code: string | null | undefined): ContactReason | null {
  if (!code) return null;
  return CONTACT_REASONS.find((r) => r.code === code) ?? null;
}
