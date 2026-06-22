import * as XLSX from "xlsx";

import type { HeldOrderImportRow } from "./types";

// Dois formatos de arquivo são aceitos (detectados pelo cabeçalho):
//
// 1) "On Holds Details" (LSD###_AAAA-MM-DD_On_Holds_Details.csv) — tem coluna
//    `dyna_code` (loja). Identidade = (dyna_code, order_number).
// 2) "Returned Shipments" (presgera-...-returns.xls) — devoluções, sem loja.
//    Identidade = order_number; preenchemos dyna_code com a constante RETURNS_DYNA_CODE
//    para que a deduplicação por (dyna_code, order_number) continue valendo.
//
// O parse usa xlsx (já instalado), que lê tanto planilhas binárias (.xlsx/.xls/.ods)
// quanto CSV, e lida corretamente com campos entre aspas contendo vírgulas (ex.: `items`).

/** dyna_code sintético atribuído a todo pedido vindo de um arquivo de devoluções. */
export const RETURNS_DYNA_CODE = "RETURNS";

// Cabeçalhos do CSV "On Holds Details" -> chaves do RPC de import.
const ON_HOLDS_MAP: Record<string, keyof HeldOrderImportRow> = {
  dyna_code: "dyna_code",
  order_number: "order_number",
  merged_orders: "merged_orders",
  reason: "reason",
  order_date: "order_date",
  email: "email",
  name: "name",
  city: "city",
  streetaddress1: "street1",
  streetaddress2: "street2",
  streetaddress3: "street3",
  state: "state",
  country: "country",
  postalcode: "postal_code",
  age: "age",
  items: "items",
};

// Cabeçalhos do arquivo "Returned Shipments" -> chaves do RPC de import.
const RETURNS_MAP: Record<string, keyof HeldOrderImportRow> = {
  ordernumber: "order_number",
  returndate: "order_date",
  "rma#": "rma",
  rma: "rma",
  shipname: "name",
  email: "email",
  returneditems: "items",
  restockeditems: "restocked_items",
  damaged: "damaged_items",
  reason: "reason",
  comments: "comments",
};

// Chaves cujo valor é uma data e precisa sair normalizado como YYYY-MM-DD.
const DATE_KEYS = new Set<keyof HeldOrderImportRow>(["order_date"]);

function normalizeHeader(h: string): string {
  return String(h ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Normaliza um valor de célula de data para YYYY-MM-DD.
 * - Date (planilhas binárias com cellDates) -> usa componentes UTC para evitar
 *   deslocamento de fuso (a célula representa meia-noite local da origem).
 * - número (serial do Excel) -> converte via SSF.
 * - string -> mantém como veio (o RPC valida o formato e ignora o que não casar).
 */
function cellToDate(v: unknown): string {
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  }
  return String(v ?? "").trim();
}

function cellToText(v: unknown): string {
  if (v instanceof Date) return cellToDate(v);
  return String(v ?? "").trim();
}

// ZIP (xlsx/ods) começa com "PK" (0x50 0x4B); OLE2 (xls) começa com 0xD0 0xCF.
function looksBinary(bytes: Uint8Array): boolean {
  return (
    (bytes[0] === 0x50 && bytes[1] === 0x4b) ||
    (bytes[0] === 0xd0 && bytes[1] === 0xcf)
  );
}

function readMatrix(data: ArrayBuffer | Uint8Array): unknown[][] {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // Binário (xlsx/xls/ods): deixa o xlsx materializar datas como objetos Date.
  // Texto (csv): lê como string com raw para não coagir/reformatar datas e números.
  const workbook = looksBinary(bytes)
    ? XLSX.read(bytes, { type: "array", cellDates: true })
    : XLSX.read(new TextDecoder("utf-8").decode(bytes), { type: "string", raw: true });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: true,
  });
}

/**
 * Parseia o conteúdo bruto de um arquivo de pedidos em espera (CSV ou Excel) em
 * linhas prontas para o RPC manager_import_held_orders. Detecta automaticamente o
 * formato (On Holds Details ou Returned Shipments). `sourceFile` vira o campo
 * source_file de cada linha.
 */
export function parseHeldOrdersCsv(
  data: ArrayBuffer | Uint8Array,
  sourceFile: string,
): HeldOrderImportRow[] {
  const matrix = readMatrix(data);
  if (matrix.length < 2) return [];

  const headers = matrix[0].map(normalizeHeader);

  // Detecta o formato: On Holds tem a coluna dyna_code; Returns tem "Order Number".
  const isOnHolds = headers.includes("dyna_code");
  const isReturns = !isOnHolds && headers.includes("ordernumber");
  if (!isOnHolds && !isReturns) return [];

  const map = isOnHolds ? ON_HOLDS_MAP : RETURNS_MAP;
  const rows: HeldOrderImportRow[] = [];

  for (let i = 1; i < matrix.length; i++) {
    const cols = matrix[i];
    if (!cols || cols.every((c) => cellToText(c) === "")) continue;

    const row: Partial<HeldOrderImportRow> = { source_file: sourceFile };
    // Devoluções não têm loja: usa uma constante para manter a chave de dedupe.
    if (isReturns) row.dyna_code = RETURNS_DYNA_CODE;

    // Importa qualquer linha que tenha ALGUM dado de qualquer coluna mapeada;
    // colunas vazias simplesmente não entram (ficam NULL no banco). O número do
    // pedido (order_number) deixa de ser obrigatório.
    let hasData = false;
    headers.forEach((h, idx) => {
      const key = map[h];
      if (!key) return;
      const value = DATE_KEYS.has(key) ? cellToDate(cols[idx]) : cellToText(cols[idx]);
      if (value) {
        row[key] = value;
        hasData = true;
      }
    });

    if (hasData) {
      rows.push(row as HeldOrderImportRow);
    }
  }

  return rows;
}
