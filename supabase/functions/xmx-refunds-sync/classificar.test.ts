// deno test supabase/functions/xmx-refunds-sync/classificar.test.ts
import { assertEquals } from "jsr:@std/assert@1";

import { motivo, pais } from "./classificar.ts";

Deno.test("pais junta sigla e nome por extenso", () => {
  assertEquals(pais("US"), "United States");
  assertEquals(pais(" united states "), "United States");
  assertEquals(pais("GB"), "United Kingdom");
  assertEquals(pais("Germany"), "Outros");
  assertEquals(pais(null), "Outros");
});

Deno.test("motivo lê a ficha do call center pelo 'Reason for Contact'", () => {
  const ficha = "Agent: Fulano\nProduct Type: Physical Product\nReason for Contact: Item not shipped: Cancel within 24 hours\nResolution: Full refund";
  assertEquals(motivo(ficha), "Entrega ou rastreio");
  const outra = "Agent: X\nReason for Contact: Other reason\nOther reason: Customer requested a refund because they no longer want the product.";
  assertEquals(motivo(outra), "Cancelamento ou desistência");
});

Deno.test("motivo lê o formato curto do PagAmerican", () => {
  assertEquals(motivo("reembolso | totally_refunded | product_not_delivered | req#28230"), "Entrega ou rastreio");
  assertEquals(motivo("reembolso | partially_refunded | medical_reasons | req#1"), "Saúde (médico ou efeito colateral)");
});

Deno.test("motivo em texto livre, pt e en", () => {
  assertEquals(motivo("Não obteve resultados esperados"), "Sem resultado ou insatisfeito");
  assertEquals(motivo("Comprou por engano"), "Compra por engano ou em excesso");
  assertEquals(motivo("Requested by customer"), "Pedido do cliente, sem detalhe");
  assertEquals(motivo("golpe afiliado"), "Golpe ou transação não reconhecida");
  assertEquals(motivo("xyz"), "Outros motivos");
});

Deno.test("anotação vazia não vira motivo", () => {
  assertEquals(motivo(""), null);
  assertEquals(motivo("--"), null);
  assertEquals(motivo(null), null);
});
