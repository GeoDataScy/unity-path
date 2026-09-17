import * as XLSX from "xlsx";

import { PRODUCTS } from "@/features/services/products";
import { REFUND_TYPE_FULL, REFUND_TYPE_PARTIAL, REFUND_TYPE_UNSPECIFIED } from "./types";
import type { ExternalRefundImportRow } from "./types";

// Export "orders_export.csv" das lojas (uma linha por item do pedido). Cabeçalho:
//   Date, order_name, Address, address2, ZIP, City, province, product_count,
//   product_id, variant_id, Full name, mobile_no, Shipping method, Status,
//   Refund, Payment status, Tracking code, Product name, Variant name
// Particularidades vistas nos arquivos reais: BOM UTF-8 no primeiro cabeçalho,
// `Date` no formato YYYY/DD/MM (2026/31/07 = 31 de julho) e TAB no fim do
// telefone. O parser usa xlsx (já instalado) e aceita também .xlsx/.xls.

const HEADER_MAP: Record<string, keyof ExternalRefundImportRow> = {
  date: "raw_date",
  order_name: "order_name",
  ordername: "order_name",
  address: "address",
  address2: "address2",
  zip: "zip",
  city: "city",
  province: "province",
  product_count: "product_count",
  productcount: "product_count",
  product_id: "product_id",
  productid: "product_id",
  variant_id: "variant_id",
  variantid: "variant_id",
  fullname: "full_name",
  mobile_no: "mobile_no",
  mobileno: "mobile_no",
  shippingmethod: "shipping_method",
  status: "status",
  refund: "refund_amount",
  paymentstatus: "payment_status",
  trackingcode: "tracking_code",
  productname: "product_name",
  variantname: "variant_name",
};

function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Converte a coluna Date para YYYY-MM-DD.
 * - 'YYYY/DD/MM' (formato do export) → invertendo dia e mês;
 * - 'YYYY-MM-DD' → mantém;
 * - Date / serial do Excel (planilha binária) → componentes UTC;
 * - qualquer outra coisa → '' (o RPC ignora a linha e conta em skipped).
 */
export function parseExportDate(v: unknown): string {
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : "";
  }
  const s = String(v ?? "").trim();
  let m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) {
    const [, y, dd, mm] = m;
    const month = Number(mm);
    const day = Number(dd);
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    return `${y}-${pad(month)}-${pad(day)}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

function cellToText(v: unknown): string {
  if (v instanceof Date) return parseExportDate(v);
  return String(v ?? "").trim();
}

// ZIP (xlsx/ods) começa com "PK"; OLE2 (xls) começa com 0xD0 0xCF.
function looksBinary(bytes: Uint8Array): boolean {
  return (bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf);
}

function readMatrix(data: ArrayBuffer | Uint8Array): unknown[][] {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const workbook = looksBinary(bytes)
    ? XLSX.read(bytes, { type: "array", cellDates: true })
    : XLSX.read(new TextDecoder("utf-8").decode(bytes), { type: "string", raw: true });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    blankrows: false,
    defval: "",
    raw: true,
  });
}

export type ParsedExternalRefunds = {
  rows: ExternalRefundImportRow[];
  /** Pedidos distintos (order_name) — o CSV repete o pedido por item. */
  orders: number;
  /** Linhas cuja data não pôde ser lida. */
  invalidDates: number;
  /** Cabeçalho reconhecido? Falso quando o arquivo não é um orders_export. */
  recognized: boolean;
};

/**
 * Parseia o export de pedidos reembolsados de uma loja (CSV ou Excel) em linhas
 * prontas para o RPC manager_import_external_refunds. Cada linha do arquivo vira
 * uma linha (o RPC deduplica por pedido + variante).
 */
export function parseExternalRefundsCsv(data: ArrayBuffer | Uint8Array): ParsedExternalRefunds {
  const matrix = readMatrix(data);
  if (matrix.length < 2) return { rows: [], orders: 0, invalidDates: 0, recognized: false };

  const headers = matrix[0].map(normalizeHeader);
  const recognized = headers.includes("order_name") && headers.includes("paymentstatus");
  if (!recognized) return { rows: [], orders: 0, invalidDates: 0, recognized: false };

  const rows: ExternalRefundImportRow[] = [];
  const orders = new Set<string>();
  let invalidDates = 0;

  for (let i = 1; i < matrix.length; i++) {
    const cols = matrix[i];
    if (!cols || cols.every((c) => cellToText(c) === "")) continue;

    const row: Partial<ExternalRefundImportRow> = {};
    headers.forEach((h, idx) => {
      const key = HEADER_MAP[h];
      if (!key) return;
      const value = cellToText(cols[idx]);
      if (value) row[key] = value;
    });

    if (!row.order_name) continue;

    const rawDateCell = cols[headers.indexOf("date")];
    row.order_date = parseExportDate(rawDateCell);
    if (!row.order_date) invalidDates++;
    if (row.mobile_no) row.mobile_no = row.mobile_no.replace(/\s+/g, "");

    orders.add(row.order_name);
    rows.push(row as ExternalRefundImportRow);
  }

  return { rows, orders: orders.size, invalidDates, recognized: true };
}

/** Quantas linhas caem fora do mês de referência (YYYY-MM-DD do dia 1). */
export function countOutsideMonth(rows: ExternalRefundImportRow[], monthRef: string): number {
  const prefix = monthRef.slice(0, 7);
  return rows.filter((r) => r.order_date && !r.order_date.startsWith(prefix)).length;
}

// ---------------------------------------------------------------------------
// PagAmerican
// ---------------------------------------------------------------------------
// Layout próprio, 12 colunas, UMA LINHA POR PEDIDO (a Cartpanda repete por item):
//   Vendor Email, Order ID, Order Status, Product Name, Customer Name,
//   Customer Email, Customer Phone, Refundamount, first refund date, Reason,
//   chargebackamount, chageback date            <- "chageback" é typo da origem
//
// Diferenças que importam, e o que se faz com cada uma:
//
// * `first refund date` é a data do REEMBOLSO, não da compra. A Cartpanda só dá
//   a data da compra, o que obriga a tela a comparar réguas diferentes. Aqui os
//   dois lados podem ser datados pelo mesmo evento — é a data que define o mês
//   do lote.
// * `Refundamount` vem NEGATIVO (-198). Vira valor absoluto.
// * `Order Status` é o status do PEDIDO, não do reembolso. Quem decide se houve
//   reembolso é o par valor + data; o status só diz o tipo.
// * Chargeback (valor/data em chargebackamount/chageback date, sem reembolso)
//   fica FORA: é contestação no cartão, não passou pelo time.
// * `Product Name` vem dentro do arquivo e misturado, então um arquivo vira
//   vários lotes (produto × mês do reembolso).

/** Um lote de importação: o RPC recebe um produto e um mês por chamada. */
export type ExternalRefundBatch = {
  /** Grafia do catálogo (o arquivo escreve "Jelly Rock", o catálogo "Jellyrock"). */
  product: string;
  /** Nome exatamente como veio no arquivo, para a prévia denunciar troca de produto. */
  sourceProduct: string;
  /** Primeiro dia do mês do reembolso, YYYY-MM-DD. */
  monthRef: string;
  rows: ExternalRefundImportRow[];
};

export type ParsedPagAmericanRefunds = {
  recognized: boolean;
  batches: ExternalRefundBatch[];
  /** Reembolsos lidos (soma das linhas dos lotes). */
  refunds: number;
  /** Linhas de chargeback, deixadas de fora de propósito. */
  chargebacks: number;
  /** Reembolsos sem tipo no arquivo (Order Status fora dos dois conhecidos). */
  unspecified: number;
  /** Produtos do arquivo que não existem no catálogo. */
  unknownProducts: string[];
};

/**
 * Canoniza o nome do produto pela grafia do catálogo, ignorando espaços e caixa:
 * "Jelly Rock" → "Jellyrock", "blue horse" → "Blue Horse". Produto fora do
 * catálogo passa como veio — a prévia da importação mostra para a gestora.
 */
export function canonicalProduct(raw: string): string {
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return PRODUCTS.find((p) => p.toLowerCase().replace(/[^a-z0-9]/g, "") === key) ?? raw.trim();
}

const PAGAMERICAN_TYPE: Record<string, string> = {
  totally_refunded: REFUND_TYPE_FULL,
  partially_refunded: REFUND_TYPE_PARTIAL,
};

function col(headers: string[], name: string): number {
  return headers.indexOf(name);
}

/** O arquivo é um export da PagAmerican? */
export function isPagAmericanHeader(headers: string[]): boolean {
  return headers.includes("orderid") && headers.includes("orderstatus") && headers.includes("firstrefunddate");
}

export function parsePagAmericanRefunds(data: ArrayBuffer | Uint8Array): ParsedPagAmericanRefunds {
  const vazio: ParsedPagAmericanRefunds = {
    recognized: false, batches: [], refunds: 0, chargebacks: 0, unspecified: 0, unknownProducts: [],
  };
  const matrix = readMatrix(data);
  if (matrix.length < 2) return vazio;

  const headers = matrix[0].map(normalizeHeader);
  if (!isPagAmericanHeader(headers)) return vazio;

  const iOrder = col(headers, "orderid");
  const iStatus = col(headers, "orderstatus");
  const iProduct = col(headers, "productname");
  const iName = col(headers, "customername");
  const iPhone = col(headers, "customerphone");
  const iAmount = col(headers, "refundamount");
  const iDate = col(headers, "firstrefunddate");
  // "chageback date" é como a origem escreve; aceita a grafia corrigida também.
  const iCbDate = col(headers, "chagebackdate") >= 0 ? col(headers, "chagebackdate") : col(headers, "chargebackdate");
  const iCbAmount = col(headers, "chargebackamount");

  const porLote = new Map<string, ExternalRefundBatch>();
  const desconhecidos = new Set<string>();
  let chargebacks = 0;
  let unspecified = 0;
  let refunds = 0;

  for (let i = 1; i < matrix.length; i++) {
    const cols = matrix[i];
    if (!cols || cols.every((c) => cellToText(c) === "")) continue;

    const orderName = cellToText(cols[iOrder]);
    const rawDate = cellToText(cols[iDate]);
    const rawAmount = cellToText(cols[iAmount]);
    const refundDate = parseExportDate(rawDate);

    // Reembolso é valor + data. Sem os dois, ou é chargeback ou é linha sem uso.
    if (!orderName || !refundDate || !rawAmount) {
      const temCb = iCbAmount >= 0 && cellToText(cols[iCbAmount]) !== "" && iCbDate >= 0 && cellToText(cols[iCbDate]) !== "";
      if (temCb) chargebacks++;
      continue;
    }

    const rawProduct = cellToText(cols[iProduct]);
    const product = canonicalProduct(rawProduct);
    if (!PRODUCTS.includes(product as (typeof PRODUCTS)[number])) desconhecidos.add(rawProduct);

    const status = cellToText(cols[iStatus]).toLowerCase();
    const tipo = PAGAMERICAN_TYPE[status] ?? REFUND_TYPE_UNSPECIFIED;
    if (tipo === REFUND_TYPE_UNSPECIFIED) unspecified++;

    const valor = Number(rawAmount.replace(/[^0-9.-]/g, ""));
    const monthRef = `${refundDate.slice(0, 7)}-01`;

    const row: ExternalRefundImportRow = {
      order_name: orderName,
      order_date: refundDate,
      refund_amount: Number.isFinite(valor) ? String(Math.abs(valor)) : "0",
      payment_status: tipo,
      raw_date: rawDate,
      product_name: rawProduct || undefined,
    };
    const fullName = iName >= 0 ? cellToText(cols[iName]) : "";
    if (fullName) row.full_name = fullName;
    const phone = iPhone >= 0 ? cellToText(cols[iPhone]).replace(/\s+/g, "") : "";
    if (phone) row.mobile_no = phone;

    const chave = `${product}\u0000${monthRef}`;
    const lote = porLote.get(chave) ?? { product, sourceProduct: rawProduct, monthRef, rows: [] };
    lote.rows.push(row);
    porLote.set(chave, lote);
    refunds++;
  }

  const batches = Array.from(porLote.values()).sort(
    (a, b) => a.product.localeCompare(b.product) || a.monthRef.localeCompare(b.monthRef),
  );
  return { recognized: true, batches, refunds, chargebacks, unspecified, unknownProducts: Array.from(desconhecidos) };
}
