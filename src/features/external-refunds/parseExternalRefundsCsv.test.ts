import { describe, expect, it } from "vitest";

import { countOutsideMonth, parseExportDate, parseExternalRefundsCsv } from "./parseExternalRefundsCsv";

function csvBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const HEADER =
  '﻿Date,order_name,Address,address2,ZIP,City,province,product_count,product_id,variant_id,"Full name",mobile_no,"Shipping method",Status,Refund,"Payment status","Tracking code","Product name","Variant name"\n';

describe("parseExportDate", () => {
  it("lê o formato YYYY/DD/MM do export da loja", () => {
    expect(parseExportDate("2026/31/07")).toBe("2026-07-31");
    expect(parseExportDate("2026/01/08")).toBe("2026-08-01");
  });

  it("mantém ISO e rejeita lixo", () => {
    expect(parseExportDate("2026-07-31")).toBe("2026-07-31");
    expect(parseExportDate("2026/07/31")).toBe(""); // mês 31 não existe
    expect(parseExportDate("")).toBe("");
    expect(parseExportDate("undefined")).toBe("");
  });
});

describe("parseExternalRefundsCsv", () => {
  it("parseia o export com BOM, uma linha por item, e limpa o TAB do telefone", () => {
    const csv =
      HEADER +
      '2026/31/07,#1896,"804 Bay Drive,  - ",,21666,Stevensville,Maryland,1,29686814,211204089,"Kevin Horsey","+17036223132\t",Free,Fulfilled,418.08,"Partially refunded",382951922768,Honeyfil,"6 Bottles"\n' +
      '2026/31/07,#1896,"804 Bay Drive,  - ",,21666,Stevensville,Maryland,1,29718852,211469478,"Kevin Horsey","+17036223132\t",Free,Fulfilled,418.08,"Partially refunded",,"Vip Priority Acess",Default\n' +
      '2026/30/07,#1006,"11995 U.S. 278,  - ",,71701,Camden,Arkansas,1,29512771,209693434,"Michael Leo Franzen","+18702313449\t",Free,Open,325.61,Refunded,,AlphaRock,"6 Bottles"\n';

    const parsed = parseExternalRefundsCsv(csvBytes(csv));
    expect(parsed.recognized).toBe(true);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.orders).toBe(2);
    expect(parsed.invalidDates).toBe(0);

    const first = parsed.rows[0];
    expect(first.order_name).toBe("#1896");
    expect(first.order_date).toBe("2026-07-31");
    expect(first.raw_date).toBe("2026/31/07");
    expect(first.address).toBe("804 Bay Drive,  -");
    expect(first.mobile_no).toBe("+17036223132");
    expect(first.refund_amount).toBe("418.08");
    expect(first.payment_status).toBe("Partially refunded");
    expect(first.tracking_code).toBe("382951922768");
    expect(first.product_name).toBe("Honeyfil");
    expect(first.variant_name).toBe("6 Bottles");

    // Linha VIP: sem tracking, mesmo pedido.
    expect(parsed.rows[1].order_name).toBe("#1896");
    expect(parsed.rows[1].tracking_code).toBeUndefined();
    expect(parsed.rows[1].variant_id).toBe("211469478");

    expect(parsed.rows[2].status).toBe("Open");
    expect(parsed.rows[2].payment_status).toBe("Refunded");
  });

  it("conta datas inválidas e linhas fora do mês de referência", () => {
    const csv =
      HEADER +
      "2026/31/07,#1,a,,1,c,p,1,1,1,n,1,Free,Open,10,Refunded,,P,V\n" +
      "2026/02/08,#2,a,,1,c,p,1,1,1,n,1,Free,Open,10,Refunded,,P,V\n" +
      "xx,#3,a,,1,c,p,1,1,1,n,1,Free,Open,10,Refunded,,P,V\n";

    const parsed = parseExternalRefundsCsv(csvBytes(csv));
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.invalidDates).toBe(1);
    expect(countOutsideMonth(parsed.rows, "2026-07-01")).toBe(1);
  });

  it("não reconhece arquivo com outro cabeçalho", () => {
    const parsed = parseExternalRefundsCsv(csvBytes("dyna_code,order_number\nLSD1,123\n"));
    expect(parsed.recognized).toBe(false);
    expect(parsed.rows).toHaveLength(0);
  });
});
