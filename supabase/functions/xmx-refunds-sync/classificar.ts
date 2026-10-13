// Normalizações usadas pela sincronização com o banco de vendas da XMX.
// Arquivo separado do index.ts para poder ser testado sem subir a função.

// ─── País ───────────────────────────────────────────────────────────────────
// O mesmo país aparece por extenso e em sigla ('US' e 'United States'). Dobramos
// em 5 países principais + 'Outros' (os 5 somam ~99% das vendas).
const PAISES: Record<string, string> = {
  US: "United States",
  USA: "United States",
  "UNITED STATES": "United States",
  "UNITED STATES OF AMERICA": "United States",
  CA: "Canada",
  CANADA: "Canada",
  AU: "Australia",
  AUSTRALIA: "Australia",
  GB: "United Kingdom",
  UK: "United Kingdom",
  "UNITED KINGDOM": "United Kingdom",
  "GREAT BRITAIN": "United Kingdom",
  NZ: "New Zealand",
  "NEW ZEALAND": "New Zealand",
};

export function pais(c: string | null | undefined): string {
  return PAISES[(c ?? "").trim().toUpperCase()] ?? "Outros";
}

// ─── Motivo de reembolso ────────────────────────────────────────────────────
// refunds_orders.note vem em três formatos: ficha do call center
// ("Reason for Contact: …"), formato curto ("reembolso | parcial | motivo | req#")
// e texto livre (pt/en). Viramos uma categoria; a primeira regra que casar vence.
const REGRAS: [string, RegExp][] = [
  ["Golpe ou transação não reconhecida", /unauthori|fraud|n[ãa]o reconhec|suspected|golpe|scam|bank threat/],
  ["Saúde (médico ou efeito colateral)", /m[ée]dic|medical|doctor|colateral|side effect|allerg|alerg|adversa|ingredient/],
  ["Cobrança duplicada ou errada", /duplica|overcharg|billing|charged|cobran|payment_processing/],
  ["Preço, assinatura ou upsell", /price|pre[çc]o|expensive|caro|assinatura|subscription|upsel|upssel/],
  ["Compra por engano ou em excesso", /engano|mistake|excess|incorrect_item|by accident|wrong item/],
  [
    "Sem resultado ou insatisfeito",
    /resultad|result|efeito|expectat|not as described|not_as_advertised|funcion|funcinou|did not work|didn.t work|not working|n[ãa]o sentiu|dissatisf|insatisf|efic[áa]c|vsl/,
  ],
  [
    "Entrega ou rastreio",
    /not received|not shipped|not_delivered|non.?receipt|n[ãa]o recebeu|n[ãa]o entregue|n[ãa]o processado|tracking|rastre|entrega|deliver|missing item|return(ed)? to sender|damaged|vazad/,
  ],
  ["Devolução do produto", /return|devol|rma|sent the product back/],
  ["Acordo de reembolso parcial", /offer|oferta|partial refund|parcial|accept|agreed|aceitou|\d{2}\s*%/],
  ["Cancelamento ou desistência", /cancel|desist|no longer want|buyers_remorse|n[ãa]o quer|changed mind|arrepend|interesse/],
  ["Disputa ou PayPal", /dispute|paypal|cbk|chargeback/],
  ["Iniciativa da empresa", /preventive|requested by seller|auto refund|time de risco/],
  [
    "Pedido do cliente, sem detalhe",
    /requested|refund request|wants refund|^\s*refund\s*$|customer contacted|missing refund|follow.?up|unspecified|without further|other reason/,
  ],
];

function campo(nota: string, nome: string) {
  const m = nota.match(new RegExp(`^\\s*${nome}\\s*:\\s*(.+)$`, "im"));
  return m ? m[1].trim() : "";
}

/** Categoria do motivo, ou null quando a anotação não diz nada. */
export function motivo(nota: string | null | undefined): string | null {
  let t = (nota ?? "").trim();
  if (!t || t === "--") return null;
  if (/Reason for Contact\s*:/i.test(t)) t = `${campo(t, "Other reason")} ${campo(t, "Reason for Contact")}`;
  else if (/^reembolso \|/i.test(t)) t = t.split("|")[2] ?? "";
  t = t.trim().toLowerCase();
  if (!t) return null;
  for (const [nome, rx] of REGRAS) if (rx.test(t)) return nome;
  return "Outros motivos";
}
