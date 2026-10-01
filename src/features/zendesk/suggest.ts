// Tradução ticket do Zendesk → campos de um atendimento.
//
// Por que mora no front e não na Edge Function: o catálogo de produtos e a lista
// de motivos são nossos, não do Zendesk. `services.product` tem CHECK constraint
// e `services.contact_reason` também — se a função escolhesse o valor, ela
// precisaria de uma quarta cópia do catálogo, em outro runtime, para não sugerir
// produto que o banco recusa. Aqui a fonte é a mesma que alimenta o <Select>,
// então é impossível sugerir opção que o formulário não tenha.
//
// A Edge Function devolve o ticket cru (grupo, tags, topic, canal); estas funções
// decidem o que vira valor de formulário. Tudo puro, sem rede — o teste ao lado
// cobre os casos reais medidos em produção.
import { PRODUCTS } from "@/features/services/products";
import type { ContactReasonCode } from "@/features/services/contact-reasons";

import type { ZendeskTicket, ZendeskTopicConfidence } from "./types";

/**
 * Chave de comparação entre nomes dos dois sistemas: minúsculas, sem acento e
 * sem separador. Existe porque o mesmo produto é escrito de formas diferentes
 * em cada lado — o grupo "Nerve Ease" é o produto "NerveEase", e a tag de
 * auto-routing `mindrecall` é o produto "Mind Recall".
 */
export function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Normalizar o catálogo não gera colisão (conferido contra os 75 valores do
// CHECK services_product_check), então o mapa é 1:1.
const PRODUCT_BY_KEY: ReadonlyMap<string, string> = new Map(
  PRODUCTS.map((p) => [normalizeKey(p), p]),
);

/**
 * Grupos e tags do Zendesk cujo nome não é o do catálogo nem chega perto por
 * normalização — precisam de tradução declarada.
 *
 * Só entra aqui o par confirmado por quem conhece a operação: sugerir produto
 * errado é pior que não sugerir nada, porque o agente aceita sem reler. Grupo
 * que não estiver aqui nem casar por normalização é devolvido em
 * `naoReconhecido`, e o formulário pede que o agente escolha.
 *
 * A chave é a forma normalizada (ver `normalizeKey`).
 */
export const PRODUCT_ALIASES: Readonly<Record<string, string>> = {
  // Ex.: "militaryhoney": "Honeyfil" — a confirmar com a gestora.
};

export type ProductGuess = {
  /** Valor pronto para o <Select>, ou null quando não deu para traduzir. */
  product: string | null;
  /** De onde saiu — o formulário mostra isso para o agente poder discordar. */
  origem: "tag" | "grupo" | "apelido" | null;
  /** Nome do grupo do Zendesk quando nenhuma regra reconheceu o produto. */
  naoReconhecido: string | null;
};

/**
 * Resolve o produto na ordem em que as fontes são confiáveis.
 *
 * A tag de auto-routing vem antes do grupo porque ela é o nome do produto
 * normalizado na origem (`horsefil`, `garaherb`, `mindrecall`), enquanto o nome
 * do grupo é editado à mão no Zendesk e divergiu em 3 dos 5 casos medidos.
 * Tags que não são de produto (`auto-routing`, por exemplo) simplesmente não
 * estão no catálogo e são ignoradas sem regra especial.
 */
export function guessProduct(
  groupName: string | null | undefined,
  tags: readonly string[] | null | undefined,
): ProductGuess {
  for (const tag of tags ?? []) {
    const hit = PRODUCT_BY_KEY.get(normalizeKey(tag));
    if (hit) return { product: hit, origem: "tag", naoReconhecido: null };
  }

  const groupKey = groupName ? normalizeKey(groupName) : "";
  if (groupKey) {
    const direct = PRODUCT_BY_KEY.get(groupKey);
    if (direct) return { product: direct, origem: "grupo", naoReconhecido: null };

    const alias = PRODUCT_ALIASES[groupKey];
    // O apelido é conferido contra o catálogo: entrada errada na tabela acima
    // não consegue produzir produto que o CHECK do banco recusaria.
    if (alias && PRODUCT_BY_KEY.has(normalizeKey(alias))) {
      return { product: alias, origem: "apelido", naoReconhecido: null };
    }
  }

  for (const tag of tags ?? []) {
    const alias = PRODUCT_ALIASES[normalizeKey(tag)];
    if (alias && PRODUCT_BY_KEY.has(normalizeKey(alias))) {
      return { product: alias, origem: "apelido", naoReconhecido: null };
    }
  }

  return { product: null, origem: null, naoReconhecido: groupName ?? null };
}

/**
 * Topic do Intelligent Triage → nosso motivo de contato.
 *
 * A taxonomia do Zendesk é genérica de e-commerce e cobre as intenções
 * transacionais (48,6% dos atendimentos dos últimos 60 dias). Os motivos de
 * suplemento — `duvida_de_uso`, `ingredientes`, `embalagem_danificada` — não
 * têm equivalente e ficam de fora de propósito.
 *
 * `reclamacao_vsl` também fica de fora, embora exista
 * `topic__misc__feedback__complaint`: a nossa exige dizer QUAL promessa do
 * anúncio o cliente cobrou, e a nota é obrigatória por regra de negócio. Um
 * "reclamação genérica" viraria registro sem a informação que a gestora quer.
 *
 * `duvidas_geral` não é mapeado porque é o curinga: sem sugestão, o agente já
 * cai nele por conta própria em 38% dos casos.
 */
export const TOPIC_TO_CONTACT_REASON: Readonly<Record<string, ContactReasonCode>> = {
  // Envio — 4.433 registros/60d
  topic__order__status__what_is_status: "duvida_de_envio",
  topic__order__not_delivered__not_delivered: "duvida_de_envio",
  topic__order__update__request_to_send_again: "duvida_de_envio",
  // Reembolso — 2.874
  topic__billing__refund__request: "reembolso",
  topic__billing__refund__waiting: "reembolso",
  topic__billing__refund__request_refund_channel: "reembolso",
  topic__order__return__want_return: "reembolso",
  // Cancelamentos — 1.097 + 199
  topic__order__cancellation__cancel: "cancelamento_de_compra",
  topic__billing__subscription_cancel__request: "cancelamento_de_assinatura",
  // Endereço — 207
  topic__order__update__ship_address: "troca_de_endereco",
};

/** Confianças do Topic em que vale pré-selecionar o motivo. */
const CONFIDENCE_ACCEPTED: readonly ZendeskTopicConfidence[] = [
  "topic_confidence__high",
  "topic_confidence__medium",
];

export type ContactReasonGuess = {
  /** Código pronto para o <Select>, ou null. */
  code: ContactReasonCode | null;
  /** Topic cru, mostrado ao agente para ele poder discordar com contexto. */
  topic: string | null;
  confidence: ZendeskTopicConfidence | null;
  /** Por que não houve sugestão — o formulário explica em vez de ficar mudo. */
  motivoSemSugestao: "sem_topic" | "confianca_baixa" | "sem_equivalente" | null;
};

export function guessContactReason(
  topic: string | null | undefined,
  confidence: ZendeskTopicConfidence | null | undefined,
): ContactReasonGuess {
  const base = { topic: topic ?? null, confidence: confidence ?? null };

  if (!topic) return { ...base, code: null, motivoSemSugestao: "sem_topic" };

  const code = TOPIC_TO_CONTACT_REASON[topic] ?? null;
  if (!code) return { ...base, code: null, motivoSemSugestao: "sem_equivalente" };

  // Confiança ausente é tratada como baixa: o campo existe em toda a conta, e
  // vir vazio significa que o Triage não classificou com segurança.
  if (!confidence || !CONFIDENCE_ACCEPTED.includes(confidence)) {
    return { ...base, code: null, motivoSemSugestao: "confianca_baixa" };
  }

  return { ...base, code, motivoSemSugestao: null };
}

/** Canais do formulário do agente. "Clickbank" é plataforma, não canal do Zendesk. */
export type AgentChannel = "Clickbank" | "Email" | "SMS";

/**
 * `via.channel` → canal do formulário.
 *
 * Só `email` tem equivalente seguro. Portal (`web`), chat e messaging existem no
 * Zendesk mas não nos três botões do agente, e a conta não tem canal de SMS
 * configurado — então esses casos não recebem sugestão em vez de receber chute.
 */
export function guessChannel(viaChannel: string | null | undefined): AgentChannel | null {
  return viaChannel === "email" ? "Email" : null;
}

/** Tudo que um ticket consegue pré-encher, já traduzido para o formulário. */
export type TicketSuggestion = {
  clientEmail: string | null;
  produto: ProductGuess;
  motivo: ContactReasonGuess;
  canal: AgentChannel | null;
};

export function buildSuggestion(ticket: ZendeskTicket): TicketSuggestion {
  return {
    clientEmail: ticket.requester_email ?? null,
    produto: guessProduct(ticket.group_name, ticket.tags),
    motivo: guessContactReason(ticket.topic, ticket.topic_confidence),
    canal: guessChannel(ticket.channel),
  };
}

/**
 * Campos do atendimento que nenhum ticket do Zendesk consegue preencher —
 * conferido contra os campos customizados da conta, que são só os gerados pelo
 * próprio Zendesk. O formulário mostra esta lista para o agente saber o que
 * continua sendo dele, em vez de achar que a busca preencheu tudo.
 */
export const CAMPOS_SEM_FONTE = ["Plataforma", "Número do pedido", "Cód. Rastreio"] as const;
