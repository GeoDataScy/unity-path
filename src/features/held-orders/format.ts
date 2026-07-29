// Pedidos em Espera — normalização dos campos crus que vêm do CSV da operação.
//
// O arquivo importado despeja tudo em três campos-texto que o agente não
// consegue ler de relance:
//   reason -> "address-verification-failed, Held for Bad Address, Held for Order Age"
//   items  -> "127-MVIT-277 x 1, 6298-VISBLND-107 x 1, 6294-NRVEBLND-114 x 1"
//   street1/2/3 + city/state/postal/country, às vezes com street1 == street2.
// Aqui quebramos cada um em partes exibíveis.

import type { MyHeldOrder } from "./types";

// ============================================================================
// Motivos do On Hold
// ============================================================================

/**
 * Rótulos amigáveis para os motivos conhecidos. A chave é o motivo normalizado
 * (minúsculo, sem hífen). Motivo desconhecido é exibido como veio no arquivo —
 * nada é escondido do agente.
 */
const REASON_LABELS: Record<string, string> = {
  "address verification failed": "Falha na verificação de endereço",
  "held for bad address": "Endereço inválido",
  "held for order age": "Pedido antigo",
  "no ship country": "País sem envio",
  "do not ship to country": "País bloqueado para envio",
  "hold for validation": "Aguardando validação",
  return: "Devolução",
};

function normalizeReason(raw: string): string {
  return raw.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

export type HeldOrderReason = {
  /** Chave normalizada — usada para agrupar/filtrar. */
  key: string;
  /** Texto exibido ao agente. */
  label: string;
};

/** Quebra o campo `reason` (lista separada por vírgula) em motivos individuais. */
export function parseReasons(reason: string | null): HeldOrderReason[] {
  if (!reason) return [];
  const seen = new Set<string>();
  const out: HeldOrderReason[] = [];
  for (const part of reason.split(",")) {
    const raw = part.trim();
    if (!raw) continue;
    const key = normalizeReason(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: REASON_LABELS[key] ?? raw });
  }
  return out;
}

// ============================================================================
// Endereço
// ============================================================================

export type HeldOrderAddress = {
  /** Linhas de logradouro (street1/2/3), sem repetições nem vazios. */
  street: string[];
  /** "Cidade, Estado CEP". */
  locality: string;
  /** País. */
  country: string;
  /** Tudo em uma linha — para copiar. */
  oneLine: string;
};

/** Monta o endereço em blocos legíveis a partir dos campos soltos do pedido. */
export function parseAddress(o: MyHeldOrder): HeldOrderAddress {
  const seen = new Set<string>();
  const street: string[] = [];
  for (const raw of [o.street1, o.street2, o.street3]) {
    const line = (raw ?? "").trim();
    if (!line) continue;
    // O CSV às vezes repete street1 em street2 — não mostrar duas vezes.
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    street.push(line);
  }

  const city = (o.city ?? "").trim();
  const state = (o.state ?? "").trim();
  const postal = (o.postal_code ?? "").trim();
  const country = (o.country ?? "").trim();

  const cityState = [city, state].filter(Boolean).join(", ");
  const locality = [cityState, postal].filter(Boolean).join(" ");
  const oneLine = [...street, locality, country].filter(Boolean).join(", ");

  return { street, locality, country, oneLine };
}

// ============================================================================
// Produtos (items)
// ============================================================================

export type HeldOrderItem = {
  /** SKU completo, ex.: "6294-NRVEBLND-114". */
  sku: string;
  /** Miolo do SKU, que identifica o produto, ex.: "NRVEBLND". */
  product: string;
  /** Quantidade; 1 quando o arquivo não informa. */
  qty: number;
};

// "6294-NRVEBLND-114 x 2" -> sku 6294-NRVEBLND-114, qty 2
const ITEM_RE = /^(.*?)(?:\s*[x×]\s*(\d+))?$/i;

/**
 * Extrai o miolo do SKU (parte que identifica o produto). SKUs seguem o padrão
 * `<numero>-<PRODUTO>-<numero>`; se não seguir, devolve o SKU inteiro.
 */
function productFromSku(sku: string): string {
  const parts = sku.split("-").filter(Boolean);
  if (parts.length >= 3) return parts.slice(1, -1).join("-");
  if (parts.length === 2) return parts[1];
  return sku;
}

/** Quebra o campo `items` em produtos individuais com quantidade. */
export function parseItems(items: string | null): HeldOrderItem[] {
  if (!items) return [];
  const out: HeldOrderItem[] = [];
  for (const part of items.split(",")) {
    const raw = part.trim();
    if (!raw) continue;
    const m = ITEM_RE.exec(raw);
    const sku = (m?.[1] ?? raw).trim();
    if (!sku) continue;
    const qty = Number(m?.[2] ?? 1);
    out.push({ sku, product: productFromSku(sku), qty: Number.isFinite(qty) && qty > 0 ? qty : 1 });
  }
  return out;
}

/** Total de unidades do pedido — o número que o agente confere na etiqueta. */
export function totalUnits(items: HeldOrderItem[]): number {
  return items.reduce((sum, i) => sum + i.qty, 0);
}
