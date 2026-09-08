import { describe, expect, it } from "vitest";

import { PRODUCTS } from "@/features/services/products";
import { CONTACT_REASONS, requiresContactReasonNote } from "@/features/services/contact-reasons";

import {
  TOPIC_TO_CONTACT_REASON,
  buildSuggestion,
  guessChannel,
  guessContactReason,
  guessProduct,
  normalizeKey,
} from "./suggest";
import type { ZendeskTicket } from "./types";

describe("normalizeKey", () => {
  it("aproxima as grafias divergentes dos dois sistemas", () => {
    // Grupo "Nerve Ease" no Zendesk é o produto "NerveEase" no catálogo.
    expect(normalizeKey("Nerve Ease")).toBe(normalizeKey("NerveEase"));
    // Tag de auto-routing é o nome do produto normalizado na origem.
    expect(normalizeKey("mindrecall")).toBe(normalizeKey("Mind Recall"));
    expect(normalizeKey("Nad Dermal+")).toBe("naddermal");
    expect(normalizeKey("VIP.Shipping")).toBe("vipshipping");
  });

  it("não colapsa produtos diferentes do catálogo", () => {
    const chaves = PRODUCTS.map(normalizeKey);
    expect(new Set(chaves).size).toBe(PRODUCTS.length);
  });
});

describe("guessProduct", () => {
  it("prefere a tag de auto-routing ao nome do grupo", () => {
    // O grupo foi renomeado à mão no Zendesk; a tag continua canônica.
    const r = guessProduct("Military Honey", ["honeyfil", "auto-routing"]);
    expect(r).toEqual({ product: "Honeyfil", origem: "tag", naoReconhecido: null });
  });

  it("ignora tags que não são de produto", () => {
    const r = guessProduct("Horsefil", ["auto-routing", "urgente", "reembolso"]);
    expect(r.product).toBe("Horsefil");
    expect(r.origem).toBe("grupo");
  });

  it("casa o grupo com espaço contra o produto sem espaço", () => {
    const r = guessProduct("Nerve Ease", ["auto-routing"]);
    expect(r).toEqual({ product: "NerveEase", origem: "grupo", naoReconhecido: null });
  });

  it("devolve o nome do grupo quando não reconhece, em vez de chutar", () => {
    const r = guessProduct("Joint Relax", ["auto-routing"]);
    expect(r.product).toBeNull();
    expect(r.origem).toBeNull();
    expect(r.naoReconhecido).toBe("Joint Relax");
  });

  it("aguenta ticket sem grupo e sem tag", () => {
    expect(guessProduct(null, null)).toEqual({
      product: null,
      origem: null,
      naoReconhecido: null,
    });
  });

  it("só sugere produto que existe no catálogo", () => {
    // Blindagem do CHECK services_product_check: qualquer sugestão precisa ser
    // uma opção do <Select>, senão o INSERT falha no banco.
    const casos: [string | null, string[]][] = [
      ["Horsefil", ["horsefil", "auto-routing"]],
      ["Nerve Ease", []],
      ["Military Honey", ["honeyprotocol"]],
      ["Joint Relax", ["jointrelax"]],
      [null, ["mindrecall"]],
      ["grupo inexistente", ["tag inexistente"]],
    ];
    for (const [grupo, tags] of casos) {
      const { product } = guessProduct(grupo, tags);
      if (product !== null) expect(PRODUCTS).toContain(product);
    }
  });
});

describe("guessContactReason", () => {
  it("pré-seleciona o motivo quando a confiança é alta", () => {
    const r = guessContactReason("topic__billing__refund__request", "topic_confidence__high");
    expect(r.code).toBe("reembolso");
    expect(r.motivoSemSugestao).toBeNull();
  });

  it("aceita confiança média", () => {
    const r = guessContactReason("topic__order__cancellation__cancel", "topic_confidence__medium");
    expect(r.code).toBe("cancelamento_de_compra");
  });

  it("não sugere nada com confiança baixa, mas diz por quê", () => {
    const r = guessContactReason("topic__billing__refund__request", "topic_confidence__low");
    expect(r.code).toBeNull();
    expect(r.motivoSemSugestao).toBe("confianca_baixa");
    // O topic segue exposto para o agente decidir com contexto.
    expect(r.topic).toBe("topic__billing__refund__request");
  });

  it("trata confiança ausente como baixa", () => {
    expect(guessContactReason("topic__billing__refund__request", null).code).toBeNull();
    expect(guessContactReason("topic__billing__refund__request", null).motivoSemSugestao).toBe(
      "confianca_baixa",
    );
  });

  it("separa 'sem topic' de 'topic sem equivalente'", () => {
    expect(guessContactReason(null, null).motivoSemSugestao).toBe("sem_topic");
    expect(
      guessContactReason("topic__software__login_issues__cant_login", "topic_confidence__high")
        .motivoSemSugestao,
    ).toBe("sem_equivalente");
  });

  it("não mapeia reclamação genérica para reclamacao_vsl", () => {
    // A nossa exige dizer qual promessa do anúncio o cliente cobrou; a do
    // Zendesk é reclamação de atendimento. Confundir gera registro vazio.
    const r = guessContactReason("topic__misc__feedback__complaint", "topic_confidence__high");
    expect(r.code).toBeNull();
  });

  it("nunca sugere motivo que exigiria nota obrigatória", () => {
    // O formulário aplica a sugestão sem abrir o campo de texto, então um
    // motivo que pede nota entraria vazio e o CHECK do banco recusaria.
    for (const code of Object.values(TOPIC_TO_CONTACT_REASON)) {
      expect(requiresContactReasonNote(code)).toBe(false);
    }
  });

  it("só mapeia para motivos que existem no <Select>", () => {
    const validos = CONTACT_REASONS.map((r) => r.code);
    for (const code of Object.values(TOPIC_TO_CONTACT_REASON)) {
      expect(validos).toContain(code);
    }
  });
});

describe("guessChannel", () => {
  it("traduz e-mail", () => {
    expect(guessChannel("email")).toBe("Email");
  });

  it("não chuta canal que o formulário não tem", () => {
    // A conta não tem SMS configurado, e portal/chat/messaging não são opção
    // dos três botões do agente.
    for (const c of ["web", "chat", "api", "native_messaging", "sms", null, undefined]) {
      expect(guessChannel(c)).toBeNull();
    }
  });
});

describe("buildSuggestion", () => {
  const ticket = (over: Partial<ZendeskTicket> = {}): ZendeskTicket =>
    ({
      id: 7155,
      subject: "Refund please",
      status: "open",
      priority: null,
      channel: "email",
      received_by: "contact@horsefil.com",
      created_at: "2026-09-09T13:20:46Z",
      updated_at: "2026-09-09T14:02:11Z",
      requester_name: "Jane Doe",
      requester_email: "jane@example.com",
      assignee_name: "Ana",
      group_id: 54202004635027,
      group_name: "Horsefil",
      tags: ["horsefil", "auto-routing"],
      topic: "topic__billing__refund__request",
      topic_confidence: "topic_confidence__high",
      replies: 2,
      reopens: 0,
      assignee_updated_at: null,
      requester_updated_at: null,
      latest_comment_added_at: null,
      solved_at: null,
      first_reply_minutes: null,
      resolution_minutes: null,
      url: "https://xmx-54224.zendesk.com/agent/tickets/7155",
      ...over,
    }) as ZendeskTicket;

  it("monta o preenchimento completo de um ticket típico", () => {
    const s = buildSuggestion(ticket());
    expect(s.clientEmail).toBe("jane@example.com");
    expect(s.produto.product).toBe("Horsefil");
    expect(s.motivo.code).toBe("reembolso");
    expect(s.canal).toBe("Email");
  });

  it("preenche o que dá e deixa o resto nulo", () => {
    const s = buildSuggestion(
      ticket({
        group_name: "Joint Relax",
        tags: ["auto-routing"],
        topic: "topic__misc__feedback__complaint",
        channel: "web",
      }),
    );
    expect(s.clientEmail).toBe("jane@example.com");
    expect(s.produto.product).toBeNull();
    expect(s.produto.naoReconhecido).toBe("Joint Relax");
    expect(s.motivo.code).toBeNull();
    expect(s.canal).toBeNull();
  });
});
