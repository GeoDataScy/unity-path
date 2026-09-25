import { describe, expect, it } from "vitest";

import {
  countOutsideMonth,
  parseExportDate,
  parseBuygoodsRefunds,
  parseEnglishDate,
  parseExternalRefundsCsv,
  parsePagAmericanRefunds,
} from "./parseExternalRefundsCsv";

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

// Export da PagAmerican: layout próprio, uma linha por pedido, valor negativo,
// data do REEMBOLSO e produto dentro do arquivo.
const PA_HEADER =
  "﻿Vendor Email,Order ID,Order Status,Product Name,Customer Name,Customer Email,Customer Phone,Refundamount,first refund date,Reason,chargebackamount,chageback date\n";

describe("parsePagAmericanRefunds", () => {
  const csv =
    PA_HEADER +
    // integral e parcial: tipo vem do Order Status
    "v@x.com,137436,totally_refunded,Jelly Rock,Don Lawson,d@x.com,(724) 944-3057,-642,2026-09-06,preventive_refund,,\n" +
    "v@x.com,137353,partially_refunded,Jelly Rock,Robert Giess,r@x.com,(334) 704-6255,-224.7,2026-09-11,preventive_refund,,\n" +
    // 'completed' COM valor e data: é reembolso, mas o arquivo não diz o tipo
    "v@x.com,134778,completed,Jelly Rock,Ana P,a@x.com,(11) 1,-202.5,2026-08-10,preventive_refund,,\n" +
    // chargeback puro: fica fora
    "v@x.com,137340,chargeback,Honeyfil,Don W,w@x.com,(630) 402-7253,,,chargeback_alert,-294,2026-09-10\n" +
    // 'completed' que na verdade é chargeback: também fora
    "v@x.com,132157,completed,Honeyfil,Joe,j@x.com,(1) 2,,,10.4,-158,2026-09-13\n" +
    // produto novo, grafia do catálogo
    "v@x.com,166787,totally_refunded,Blue Horse,Mark,m@x.com,(407) 362-0645,-207,2026-09-16,item_not_as_advertised,,\n";

  it("separa em lotes por produto e mês do reembolso, com a grafia do catálogo", () => {
    const p = parsePagAmericanRefunds(csvBytes(csv));
    expect(p.recognized).toBe(true);
    expect(p.refunds).toBe(4);

    // "Jelly Rock" do arquivo vira "Jellyrock" do catálogo; ago e set separados.
    expect(p.batches.map((b) => `${b.product}/${b.monthRef}/${b.rows.length}`)).toEqual([
      "Blue Horse/2026-09-01/1",
      "Jellyrock/2026-08-01/1",
      "Jellyrock/2026-09-01/2",
    ]);
    expect(p.batches[1].sourceProduct).toBe("Jelly Rock");
    expect(p.unknownProducts).toEqual([]);
  });

  it("deixa o chargeback de fora e conta separado", () => {
    const p = parsePagAmericanRefunds(csvBytes(csv));
    expect(p.chargebacks).toBe(2);
    const pedidos = p.batches.flatMap((b) => b.rows.map((r) => r.order_name));
    expect(pedidos).not.toContain("137340");
    expect(pedidos).not.toContain("132157");
  });

  it("usa a data do reembolso, valor absoluto e o tipo certo", () => {
    const p = parsePagAmericanRefunds(csvBytes(csv));
    const set = p.batches.find((b) => b.product === "Jellyrock" && b.monthRef === "2026-09-01")!;
    const integral = set.rows.find((r) => r.order_name === "137436")!;
    expect(integral.order_date).toBe("2026-09-06");
    expect(integral.refund_amount).toBe("642"); // o arquivo traz -642
    expect(integral.payment_status).toBe("Refunded");
    expect(integral.full_name).toBe("Don Lawson");
    expect(integral.mobile_no).toBe("(724)944-3057");

    expect(set.rows.find((r) => r.order_name === "137353")!.payment_status).toBe("Partially refunded");

    const ago = p.batches.find((b) => b.monthRef === "2026-08-01")!;
    expect(ago.rows[0].payment_status).toBe("Refunded (unspecified)");
    expect(p.unspecified).toBe(1);
  });

  it("não confunde os dois formatos", () => {
    expect(parsePagAmericanRefunds(csvBytes(HEADER + "2026/31/07,#1,a,,1,c,p,1,1,1,n,1,Free,Open,10,Refunded,,P,V\n")).recognized).toBe(false);
    expect(parseExternalRefundsCsv(csvBytes(csv)).recognized).toBe(false);
  });

  it("denuncia produto fora do catálogo", () => {
    const p = parsePagAmericanRefunds(
      csvBytes(PA_HEADER + "v@x.com,1,totally_refunded,Produto Fantasma,N,e@x.com,1,-10,2026-09-01,r,,\n"),
    );
    expect(p.unknownProducts).toEqual(["Produto Fantasma"]);
    expect(p.batches[0].product).toBe("Produto Fantasma");
  });
});

// Relatório Customer_Refunds da Buygoods: separado por TAB, um arquivo por
// produto, uma linha por ESTORNO (o pedido pode ter vários) e data do reembolso.
const BG_HEADER =
  "Order Date\tRefund Date\tOrder ID\tProduct Codename\tProduct Name\tFirstname\tLastname\tReason\tAmount\tAffiliate ID\r\n";

describe("parseEnglishDate", () => {
  it("lê a data por extenso do relatório", () => {
    expect(parseEnglishDate("September 23, 2026")).toBe("2026-09-23");
    expect(parseEnglishDate("June 02, 2026")).toBe("2026-06-02");
    expect(parseEnglishDate("June 7, 2026, 6:07PM")).toBe("2026-06-07");
    expect(parseEnglishDate("Smarch 1, 2026")).toBe("");
  });
});

describe("parseBuygoodsRefunds", () => {
  const tsv =
    BG_HEADER +
    // dois estornos do mesmo pedido no mesmo dia: soma exata em centavos
    "June 7, 2026, 6:07PM\tSeptember 23, 2026\tA9AZ351H\tcalls_alp6b, calls_ship\tAlphaRock 6 Bottles, Priority Shipping\tMichael L\tBech\tagent_initiated\t311.64\t23\r\n" +
    "June 7, 2026, 6:07PM\tSeptember 23, 2026\tA9AZ351H\tcalls_alp6b, calls_ship\tAlphaRock 6 Bottles, Priority Shipping\tMichael L\tBech\tagent_initiated\t21.15\t23\r\n" +
    // parcial em agosto e o restante em setembro: o pedido fica no mês do 1º estorno
    "July 30, 2026, 9:00AM\tSeptember 01, 2026\tA9AZ2ABC\tcalls_alp2b\tAlphaRock 2 Bottles\tAna\tP\tChargeback alert\t128.49\t0\r\n" +
    "July 30, 2026, 9:00AM\tAugust 24, 2026\tA9AZ2ABC\tcalls_alp2b\tAlphaRock 2 Bottles\tAna\tP\tPartial Refund - Saved Sale\t39.50\t0\r\n" +
    // upsell de outro produto dentro do pedido do funil
    "May 31, 2026, 5:59AM\tJune 01, 2026\tA9AZ307W\talp2b, vir6u\tAlphaRock 2 Bottles\tLarry\tmiller\tNot happy with product\t39.50\t122\r\n" +
    "May 31, 2026, 5:59AM\tJune 01, 2026\tA9AZ307W\tvir6u\tVirilMax 6 Bottles (Upgrade)\tLarry\tmiller\tNot happy with product\t60.00\t122\r\n";

  it("junta os estornos em um pedido e separa lotes pelo mês do reembolso", () => {
    const p = parseBuygoodsRefunds(csvBytes(tsv), "Alpharock");
    expect(p.recognized).toBe(true);
    expect(p.lines).toBe(6);
    expect(p.refunds).toBe(3);
    expect(p.batches.map((b) => [b.monthRef, b.product, b.rows.length])).toEqual([
      ["2026-06-01", "Alpharock", 1],
      ["2026-08-01", "Alpharock", 1],
      ["2026-09-01", "Alpharock", 1],
    ]);

    const rows = p.batches.flatMap((b) => b.rows);
    const set = rows.find((r) => r.order_name === "A9AZ351H")!;
    expect(set.refund_amount).toBe("332.79");
    expect(set.order_date).toBe("2026-09-23");
    expect(set.full_name).toBe("Michael L Bech");

    const dois = rows.find((r) => r.order_name === "A9AZ2ABC")!;
    expect(dois.order_date).toBe("2026-08-24");
    expect(dois.raw_date).toBe("August 24, 2026");
    expect(dois.refund_amount).toBe("167.99");

    const upsell = rows.find((r) => r.order_name === "A9AZ307W")!;
    expect(upsell.product_name).toBe("AlphaRock 2 Bottles | VirilMax 6 Bottles (Upgrade)");
    expect(upsell.refund_amount).toBe("99.50");
  });

  it("não afirma tipo que o arquivo não traz", () => {
    const p = parseBuygoodsRefunds(csvBytes(tsv), "Alpharock");
    expect(new Set(p.batches.flatMap((b) => b.rows).map((r) => r.payment_status))).toEqual(
      new Set(["Refunded (unspecified)"]),
    );
  });

  it("não confunde com os outros formatos", () => {
    expect(parseBuygoodsRefunds(csvBytes(PA_HEADER + "v@x.com,1,completed,X,N,e,1,-1,2026-09-01,r,,\n"), "X").recognized).toBe(false);
    expect(parseBuygoodsRefunds(csvBytes(HEADER + "2026/31/07,#1,a,,1,c,p,1,1,1,n,1,Free,Open,10,Refunded,,P,V\n"), "X").recognized).toBe(false);
    expect(parseExternalRefundsCsv(csvBytes(tsv)).recognized).toBe(false);
    expect(parsePagAmericanRefunds(csvBytes(tsv)).recognized).toBe(false);
  });
});
