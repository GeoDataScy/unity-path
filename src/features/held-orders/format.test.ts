import { describe, expect, it } from "vitest";

import { parseAddress, parseItems, parseReasons, totalUnits } from "./format";
import type { MyHeldOrder } from "./types";

function order(partial: Partial<MyHeldOrder>): MyHeldOrder {
  return {
    id: "1",
    dyna_code: "LSD011",
    order_number: "8AVZ3FW3",
    merged_orders: null,
    reason: null,
    return_date: null,
    order_date: null,
    email: null,
    customer_name: null,
    city: null,
    state: null,
    country: null,
    postal_code: null,
    street1: null,
    street2: null,
    street3: null,
    age: null,
    items: null,
    rma: null,
    restocked_items: null,
    damaged_items: null,
    comments: null,
    status: "pending",
    agent_status: "novo",
    pending_tag: null,
    confirmed_at: null,
    imported_at: null,
    status_changed_at: null,
    event_count: 0,
    ...partial,
  };
}

describe("parseReasons", () => {
  it("quebra a lista e traduz os motivos conhecidos", () => {
    expect(parseReasons("address-verification-failed, Held for Bad Address")).toEqual([
      { key: "address verification failed", label: "Falha na verificação de endereço" },
      { key: "held for bad address", label: "Endereço inválido" },
    ]);
  });

  it("mantém motivo desconhecido como veio no arquivo", () => {
    expect(parseReasons("Order Hold For QTY Greater Than 60")).toEqual([
      { key: "order hold for qty greater than 60", label: "Order Hold For QTY Greater Than 60" },
    ]);
  });

  it("descarta duplicados e vazios", () => {
    expect(parseReasons("Return, , return")).toHaveLength(1);
    expect(parseReasons(null)).toEqual([]);
  });
});

describe("parseAddress", () => {
  it("separa logradouro, localidade e país", () => {
    const a = parseAddress(
      order({
        street1: "4801 E 5TH ST",
        street2: "APT C108",
        city: "VANCOUVER",
        state: "WA",
        postal_code: "98661",
        country: "US",
      }),
    );
    expect(a.street).toEqual(["4801 E 5TH ST", "APT C108"]);
    expect(a.locality).toBe("VANCOUVER, WA 98661");
    expect(a.country).toBe("US");
  });

  it("não repete street1 quando o CSV duplica em street2", () => {
    const a = parseAddress(
      order({ street1: "632 rockhouse road Bx 507", street2: "632 rockhouse road Bx 507" }),
    );
    expect(a.street).toEqual(["632 rockhouse road Bx 507"]);
  });
});

describe("parseItems", () => {
  it("extrai SKU, produto e quantidade de cada item", () => {
    const items = parseItems("127-MVIT-277 x 1, 6294-NRVEBLND-363 x 12");
    expect(items).toEqual([
      { sku: "127-MVIT-277", product: "MVIT", qty: 1 },
      { sku: "6294-NRVEBLND-363", product: "NRVEBLND", qty: 12 },
    ]);
    expect(totalUnits(items)).toBe(13);
  });

  it("assume quantidade 1 quando o arquivo não informa", () => {
    expect(parseItems("504-PRST60-179")).toEqual([
      { sku: "504-PRST60-179", product: "PRST60", qty: 1 },
    ]);
  });

  it("devolve o SKU inteiro quando ele não segue o padrão de três partes", () => {
    expect(parseItems("VIP-SHIPPING x 2")).toEqual([
      { sku: "VIP-SHIPPING", product: "SHIPPING", qty: 2 },
    ]);
    expect(parseItems("FRETE x 3")).toEqual([{ sku: "FRETE", product: "FRETE", qty: 3 }]);
  });

  it("ignora campo vazio", () => {
    expect(parseItems(null)).toEqual([]);
    expect(parseItems("  ")).toEqual([]);
  });
});
