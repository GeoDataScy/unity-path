// Payload das RPCs `copy_refund_reason_analytics` e `copy_refund_reason_evidence`
// (migration 20260817200000_copy_refund_reason_analytics.sql).
//
// Regras do backend que a tela precisa respeitar ao exibir:
// - o universo é sempre reembolso CONCLUÍDO (motivo só existe na baixa);
// - o período é recortado por `completion_date`;
// - o período anterior tem a mesma duração e termina no dia anterior ao `from`;
// - "motivo declarado" exclui 'Outros' e 'Follow up (sem motivo declarado)'.

export type CopyReasonRow = {
  category: string;
  n: number;
  share: number | null;
  prev_n: number;
  prev_share: number | null;
  /** Variação da participação em pontos percentuais vs. período anterior. */
  delta_pp: number | null;
  order_value: number;
  refunded_value: number;
  devolvido_pct: number | null;
  dias_mediano: number | null;
};

export type CopyProductRow = {
  product: string;
  n: number;
  share: number | null;
  order_value: number;
  refunded_value: number;
  devolvido_pct: number | null;
  top_reason: string | null;
  top_reason_n: number | null;
  top_reason_share: number | null;
};

export type CopyReasonByProductRow = {
  product: string;
  category: string;
  n: number;
  /** Participação do motivo DENTRO do produto. */
  share_in_product: number;
  /** Participação do mesmo motivo no período todo. */
  baseline_share: number | null;
  /** share_in_product / baseline_share. >1 = produto puxa o motivo acima da média. */
  lift: number | null;
};

export type CopyRefundAnalytics = {
  period: { from: string; to: string; days: number; prev_from: string; prev_to: string };
  universe: {
    concluidos: number;
    em_aberto: number;
    concluidos_periodo_anterior: number;
    com_motivo_declarado: number;
    sem_motivo_declarado: number;
    cobertura_pct: number | null;
    variacao_volume_pct: number | null;
  };
  kpis: {
    valor_pedidos: number;
    valor_devolvido: number;
    retencao_pct: number | null;
    devolvido_pct: number | null;
    ticket_medio_pedido: number | null;
    dias_mediano: number | null;
  };
  by_reason: CopyReasonRow[];
  reason_monthly: Array<{ month: string; category: string; n: number; share: number | null }>;
  monthly: Array<{ month: string; n: number; order_value: number; refunded_value: number }>;
  by_product: CopyProductRow[];
  reason_by_product: CopyReasonByProductRow[];
  matrix_products: Array<{ product: string; n: number }>;
  by_platform: Array<{ name: string; n: number; share: number | null }>;
  by_channel: Array<{ name: string; n: number; share: number | null }>;
  filters: { products: string[]; platforms: string[]; channels: string[] };
};

export type CopyReasonEvidence = {
  category: string;
  total: number;
  /** Quantos registros têm algum texto no motivo original. */
  com_texto: number;
  /** Quantos têm texto que NÃO é um dos rótulos padrão do menu. */
  texto_livre: number;
  textos: Array<{ texto: string; n: number; share: number | null; padrao: boolean }>;
  termos: Array<{ termo: string; n: number }>;
  por_produto: Array<{
    produto: string;
    n: number;
    /** Reembolsos concluídos do produto no período, de qualquer motivo. */
    total_produto: number | null;
    /** n / total_produto — quanto deste motivo pesa dentro do produto. */
    share_no_produto: number | null;
  }>;
  por_canal: Array<{ canal: string; n: number }>;
};
