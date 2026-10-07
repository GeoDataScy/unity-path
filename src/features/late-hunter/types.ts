// Tipos da aba Late Hunter (Área de Produtos). Espelham o que as RPCs
// late_hunter_overview / late_hunter_list / late_hunter_order_history devolvem.

export type LateHunterAmbiente = "producao" | "homologacao";

export type LateHunterSituacao = "aberto" | "encerrado";

export type LateHunterEndereco = {
  logradouro?: string | null;
  complemento?: string | null;
  cidade?: string | null;
  estado?: string | null;
  pais?: string | null;
  cep?: string | null;
};

export type LateHunterOrder = {
  id: number;
  pedido: string;
  loja: string;
  loja_nome: string | null;
  motivo: string;
  motivos: string[];
  cliente_nome: string;
  cliente_email: string;
  data_pedido: string;
  dias_em_espera: number | null;
  itens: string | null;
  endereco: LateHunterEndereco | null;
  pais: string | null;
  situacao: LateHunterSituacao;
  motivo_encerramento: string | null;
  encerrado_em: string | null;
  encerrado_referencia: string | null;
  primeira_referencia: string;
  ultima_referencia: string;
  /** Instante (geradoEm) da última varredura que trouxe o pedido. */
  ultimo_lote: string;
  vezes_reaberto: number;
  atualizado_em: string;
};

/** Por que a regra de encerramento rodou (ou não) naquele lote. */
export type LateHunterEncerramento = "aplicado" | "lote_incompleto" | "paginas_pendentes" | "lote_antigo";

export type LateHunterSync = {
  ambiente: LateHunterAmbiente;
  fonte: string;
  referencia: string;
  gerado_em: string;
  completo: boolean;
  pagina: number;
  total_paginas: number;
  recebidos: number;
  criados: number;
  atualizados: number;
  reabertos: number;
  inalterados: number;
  encerrados: number;
  rejeitados: { pedido: string | null; loja: string | null; erro: string }[];
  encerramento: LateHunterEncerramento;
  abertos_apos: number;
  recebido_em: string;
};

export type LateHunterFaixa = "0-3" | "4-7" | "8-14" | "15-30" | "31-60" | "60+" | "sem_dado";

export type LateHunterOverview = {
  ultimo_sync: LateHunterSync | null;
  kpis: {
    abertos: number;
    encerrados: number;
    mais_30_dias: number;
    reabertos_abertos: number;
    mediana_dias: number | null;
    p90_dias: number | null;
    entraram_ultimo: number;
    sairam_ultimo: number;
    clientes_abertos: number;
  };
  envelhecimento: Partial<Record<LateHunterFaixa, number>>;
  fluxo: { referencia: string; abertos: number | null; entraram: number; sairam: number }[];
  motivos: { motivo: string; abertos: number; total: number }[];
  lojas: { loja: string; loja_nome: string | null; abertos: number; total: number; mais_30_dias: number }[];
  paises: { pais: string; abertos: number; total: number }[];
};

export type LateHunterOrdem = "dias_desc" | "dias_asc" | "data_desc" | "data_asc" | "recentes" | "encerrados";

export type LateHunterFiltros = {
  situacao: LateHunterSituacao | "todos";
  motivos: string[];
  lojas: string[];
  paises: string[];
  /** Faixa de dias em espera; null = sem limite daquele lado. */
  diasMin: number | null;
  diasMax: number | null;
  dataDe: string | null;
  dataAte: string | null;
  reabertos: boolean;
  busca: string;
  ordem: LateHunterOrdem;
};

export type LateHunterListResult = { total: number; rows: LateHunterOrder[] };

export type LateHunterEvento = {
  evento: "criado" | "reaberto" | "encerrado";
  referencia: string;
  /** Instante (geradoEm) da varredura em que aconteceu. */
  lote: string;
  ocorrido_em: string;
};
