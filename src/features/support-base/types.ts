/** Base de Suporte — conteúdo de consulta do time, editado pela gestora. */

export type Estrutura = "nova" | "antiga";
export type BonusTipo = "simples" | "super";

/** Uma página de venda extra do produto (VSL, checkout alternativo, etc.). */
export type ProductLink = {
  label: string;
  url: string;
};

/** Card do painel "E-mail". */
export type SupportProduct = {
  id: string;
  nome: string;
  funcao: string | null;
  url: string | null;
  estrutura: Estrutura;
  plataforma: string | null;
  bonus_url: string | null;
  bonus_tipo: BonusTipo | null;
  nicho: string | null;
  sms_number: string | null;
  links: ProductLink[];
  ativo: boolean;
  sort_order: number;
};

/** Card do painel "SMS (Produtos)". */
export type SupportSmsBrand = {
  id: string;
  nome: string;
  /** Como a brand aparece no sistema de suporte — o agente confere antes de responder. */
  sistema: string;
  estrutura: Estrutura;
  sms_number: string | null;
  ativo: boolean;
  sort_order: number;
};

/** Mensagem pronta do painel "Respostas SMS". */
export type SupportSmsReply = {
  id: string;
  categoria: string;
  titulo: string;
  texto_en: string;
  texto_pt: string;
  ativo: boolean;
  sort_order: number;
};

/** Payloads de escrita (id fica de fora — quem edita passa o id separado). */
export type SupportProductInput = Omit<SupportProduct, "id">;
export type SupportSmsBrandInput = Omit<SupportSmsBrand, "id">;
export type SupportSmsReplyInput = Omit<SupportSmsReply, "id">;

export const ESTRUTURA_LABEL: Record<Estrutura, string> = {
  nova: "Nova estrutura",
  antiga: "Estrutura antiga",
};

export const BONUS_TIPO_LABEL: Record<BonusTipo, string> = {
  simples: "Bônus simples",
  super: "Super bônus",
};
