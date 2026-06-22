import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { parseHeldOrdersCsv, RETURNS_DYNA_CODE } from "./parseHeldOrdersCsv";

function csvBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function xlsxBytes(aoa: unknown[][]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

describe("parseHeldOrdersCsv", () => {
  it("parseia o formato On Holds Details (CSV) preservando a data e itens com vírgula", () => {
    const csv =
      "dyna_code,order_number,merged_orders,reason,order_date,email,name,City,StreetAddress1,StreetAddress2,StreetAddress3,State,Country,PostalCode,age,items\n" +
      'LSD007,671D96DAEE,671D96DAEE,"address-verification-failed, Held for Bad Address",2026-06-03,a@b.com,Gordon McGown,Somers,587E H H,587E H H,"",NY,US,10589,5 day(s),"X-1 x 6, Y-2 x 6"\n';

    const rows = parseHeldOrdersCsv(csvBytes(csv), "LSD007_On_Holds_Details.csv");
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.dyna_code).toBe("LSD007");
    expect(r.order_number).toBe("671D96DAEE");
    expect(r.order_date).toBe("2026-06-03");
    expect(r.items).toBe("X-1 x 6, Y-2 x 6");
    expect(r.source_file).toBe("LSD007_On_Holds_Details.csv");
  });

  it("parseia o formato de devoluções (CSV) e atribui dyna_code RETURNS", () => {
    const csv =
      "Order Number,Return Date,RMA #,Ship Name,Email,Returned Items,Restocked Items,Damaged,Reason,Comments\n" +
      "2JD7MZGE,2026-06-17,RMA123,Arthur Sarkissian,a@aol.com,Presgera x 3,Presgera x 3,,Return,\n" +
      "S2P7M2ZE,2026-06-17,,Craig Adkins,b@yahoo.com,Presgera x 6,Presgera x 5,Presgera x 1,Return,open\n";

    const rows = parseHeldOrdersCsv(csvBytes(csv), "presgera-returns.xls");
    expect(rows).toHaveLength(2);

    const a = rows[0];
    expect(a.dyna_code).toBe(RETURNS_DYNA_CODE);
    expect(a.order_number).toBe("2JD7MZGE");
    expect(a.order_date).toBe("2026-06-17");
    expect(a.name).toBe("Arthur Sarkissian");
    expect(a.items).toBe("Presgera x 3");
    expect(a.restocked_items).toBe("Presgera x 3");
    expect(a.rma).toBe("RMA123");
    expect(a.reason).toBe("Return");

    const b = rows[1];
    expect(b.damaged_items).toBe("Presgera x 1");
    expect(b.comments).toBe("open");
    expect(b.rma).toBeUndefined();
  });

  it("parseia o formato de devoluções a partir de um arquivo Excel binário", () => {
    const bytes = xlsxBytes([
      ["Order Number", "Return Date", "RMA #", "Ship Name", "Email", "Returned Items", "Restocked Items", "Damaged", "Reason", "Comments"],
      ["2JD7MZGE", "2026-06-17", "", "Arthur Sarkissian", "a@aol.com", "Presgera x 3", "Presgera x 3", "", "Return", ""],
    ]);

    const rows = parseHeldOrdersCsv(bytes, "presgera-returns.xlsx");
    expect(rows).toHaveLength(1);
    expect(rows[0].dyna_code).toBe(RETURNS_DYNA_CODE);
    expect(rows[0].order_number).toBe("2JD7MZGE");
    expect(rows[0].order_date).toBe("2026-06-17");
    expect(rows[0].items).toBe("Presgera x 3");
  });

  it("importa linhas SEM order_number desde que tenham algum dado", () => {
    const csv =
      "Order Number,Return Date,RMA #,Ship Name,Email,Returned Items,Restocked Items,Damaged,Reason,Comments\n" +
      ",2026-06-17,,Sem Numero,x@y.com,Presgera x 2,,,Return,\n" + // sem order_number, mas com dados
      ",,,,,,,,,\n"; // totalmente vazia -> ignorada

    const rows = parseHeldOrdersCsv(csvBytes(csv), "presgera-returns.xls");
    expect(rows).toHaveLength(1);
    expect(rows[0].order_number).toBeUndefined();
    expect(rows[0].dyna_code).toBe(RETURNS_DYNA_CODE);
    expect(rows[0].name).toBe("Sem Numero");
    expect(rows[0].items).toBe("Presgera x 2");
  });

  it("retorna vazio para um arquivo sem cabeçalho reconhecido", () => {
    const rows = parseHeldOrdersCsv(csvBytes("foo,bar\n1,2\n"), "x.csv");
    expect(rows).toHaveLength(0);
  });
});
