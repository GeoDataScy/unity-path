import * as XLSX from "xlsx";

import type { HeldOrderImportRow } from "./types";

// Mapeia os cabeçalhos do CSV "On Holds Details" para as chaves do RPC de import.
// O parse usa xlsx (já instalado), que lida corretamente com campos entre aspas
// contendo vírgulas (ex.: a coluna `items`).
const HEADER_MAP: Record<string, keyof HeldOrderImportRow> = {
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

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Parseia o conteúdo de um CSV de pedidos em espera em linhas prontas para o
 * RPC manager_import_held_orders. `sourceFile` vira o campo source_file de cada linha.
 */
export function parseHeldOrdersCsv(text: string, sourceFile: string): HeldOrderImportRow[] {
  const workbook = XLSX.read(text, { type: "string", raw: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];

  const matrix: string[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  });
  if (matrix.length < 2) return [];

  const headers = matrix[0].map(normalizeHeader);
  const rows: HeldOrderImportRow[] = [];

  for (let i = 1; i < matrix.length; i++) {
    const cols = matrix[i];
    if (!cols || cols.every((c) => String(c ?? "").trim() === "")) continue;

    const row: Partial<HeldOrderImportRow> = { source_file: sourceFile };
    headers.forEach((h, idx) => {
      const key = HEADER_MAP[h];
      if (!key) return;
      const value = String(cols[idx] ?? "").trim();
      if (value) row[key] = value;
    });

    if (row.dyna_code && row.order_number) {
      rows.push(row as HeldOrderImportRow);
    }
  }

  return rows;
}
