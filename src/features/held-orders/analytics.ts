// Pedidos em Espera — leitura analítica da fila (Área de Produtos).
//
// O agregado vem pronto da RPC produtos_held_orders_analytics (CLAUDE.md: métrica
// de gestão não se calcula no cliente). O que fica aqui são as DERIVAÇÕES de
// leitura — as que respondem "e daí?" a partir dos números que o banco entregou:
// a fila está enchendo ou drenando, em quanto tempo ela zera no ritmo atual, e o
// quanto do estoque está na cauda velha.
//
// São funções puras de propósito: é o que dá para testar sem banco.

import type { HeldOrderReason } from "./format";

// ============================================================================
// Tipos do retorno da RPC
// ============================================================================

export type FluxoPonto = {
  dia: string;
  entradas: number;
  saidas: number;
  backlog: number;
};

export type FaixaEnvelhecimento = {
  ordem: number;
  faixa: string;
  total: number;
};

export type MotivoPareto = {
  motivo: string;
  total: number;
  abertos: number;
  idade_media: number | null;
  pct_acumulado: number | null;
};

export type LojaResumo = {
  loja: string;
  loja_nome: string | null;
  abertos: number;
  total: number;
  idade_media: number | null;
};

export type EstadoResumo = { estado: string; abertos: number };

export type SyncStatus = {
  referencia: string;
  gerado_em: string | null;
  processado_em: string;
  completo: boolean;
  recebidos: number;
  criados: number;
  atualizados: number;
  reabertos: number;
  encerrados: number;
  rejeitados: number;
  dias_desde: number;
};

export type HeldOrdersKpis = {
  abertos: number;
  aguardando: number;
  em_andamento: number;
  sem_agente: number;
  concluidos_agente: number;
  encerrados_auto: number;
  reabertos: number;
  legado_fora_do_sync: number;
  idade_media: number | null;
  idade_p50: number | null;
  idade_p90: number | null;
  idade_max: number | null;
  resolucao_media: number | null;
  entradas_janela: number;
  saidas_janela: number;
};

export type ProdutosHeldOrdersAnalytics = {
  gerado_em: string;
  janela_dias: number;
  kpis: HeldOrdersKpis;
  fluxo: FluxoPonto[];
  envelhecimento: FaixaEnvelhecimento[];
  motivos: MotivoPareto[];
  lojas: LojaResumo[];
  estados: EstadoResumo[];
  /** null enquanto o Wall-E nunca tiver enviado um lote. */
  sync: SyncStatus | null;
};

// ============================================================================
// Motivos
// ============================================================================

/**
 * A RPC devolve o motivo já normalizado (minúsculo, sem hífen) — a MESMA chave que
 * parseReasons() produz no cliente. Reusamos o dicionário de rótulos de format.ts
 * para a tela da gestora e a de produtos nunca chamarem o mesmo motivo de nomes
 * diferentes.
 */
export function reasonLabelFromKey(
  key: string,
  parse: (reason: string | null) => HeldOrderReason[],
): string {
  return parse(key)[0]?.label ?? key;
}

// ============================================================================
// Fluxo da fila
// ============================================================================

/** Janela usada para estimar o ritmo atual. Curta o bastante para reagir. */
export const JANELA_RITMO_DIAS = 14;

export type FluxoResumo = {
  /** Média diária de pedidos entrando, na janela de ritmo. */
  mediaEntradas: number;
  /** Média diária de pedidos saindo (concluídos + encerrados). */
  mediaSaidas: number;
  /** entradas - saídas. Positivo = a fila cresce. */
  saldoDiario: number;
  /** Último backlog observado. */
  backlogAtual: number;
  tendencia: "subindo" | "estavel" | "drenando";
  /**
   * Dias para a fila zerar mantendo o ritmo atual. null quando ela não drena —
   * e é justamente esse null que é a informação: no ritmo de hoje, não zera.
   */
  diasParaZerar: number | null;
  /** Quantos dias entraram na conta (pode ser menos que a janela pedida). */
  diasConsiderados: number;
};

/**
 * Ritmo da fila nos últimos `janela` dias.
 *
 * O saldo é comparado contra a própria escala do movimento, não contra zero: numa
 * fila que movimenta 200/dia, saldo de 1 é ruído. A zona morta é 5% do movimento
 * médio (mínimo de meio pedido/dia), o que evita chamar de "subindo" uma variação
 * que some no dia seguinte.
 */
export function resumirFluxo(
  fluxo: FluxoPonto[],
  janela: number = JANELA_RITMO_DIAS,
): FluxoResumo | null {
  if (!fluxo || fluxo.length === 0) return null;

  const ordenado = [...fluxo].sort((a, b) => (a.dia < b.dia ? -1 : 1));
  const recorte = ordenado.slice(-Math.max(1, janela));
  const n = recorte.length;

  const somaEntradas = recorte.reduce((s, p) => s + p.entradas, 0);
  const somaSaidas = recorte.reduce((s, p) => s + p.saidas, 0);

  const mediaEntradas = somaEntradas / n;
  const mediaSaidas = somaSaidas / n;
  const saldoDiario = mediaEntradas - mediaSaidas;
  const backlogAtual = ordenado[ordenado.length - 1].backlog;

  const movimento = (mediaEntradas + mediaSaidas) / 2;
  const zonaMorta = Math.max(0.5, movimento * 0.05);

  const tendencia: FluxoResumo["tendencia"] =
    saldoDiario > zonaMorta ? "subindo" : saldoDiario < -zonaMorta ? "drenando" : "estavel";

  const diasParaZerar =
    tendencia === "drenando" && backlogAtual > 0
      ? Math.ceil(backlogAtual / Math.abs(saldoDiario))
      : null;

  return {
    mediaEntradas,
    mediaSaidas,
    saldoDiario,
    backlogAtual,
    tendencia,
    diasParaZerar,
    diasConsiderados: n,
  };
}

// ============================================================================
// Envelhecimento
// ============================================================================

export type EnvelhecimentoResumo = {
  total: number;
  /** Pedidos com mais de 30 dias de espera. */
  cauda: number;
  /** Fração do estoque aberto que está na cauda (0..1). */
  fracaoCauda: number;
};

/**
 * A cauda começa em 31 dias — é a primeira faixa em que o pedido já passou de um
 * ciclo mensal inteiro sem resolução, e é o número que justifica priorizar a fila
 * por idade em vez de por ordem de chegada.
 */
export function resumirEnvelhecimento(faixas: FaixaEnvelhecimento[]): EnvelhecimentoResumo {
  const total = (faixas ?? []).reduce((s, f) => s + f.total, 0);
  const cauda = (faixas ?? []).filter((f) => f.ordem >= 5).reduce((s, f) => s + f.total, 0);
  return { total, cauda, fracaoCauda: total > 0 ? cauda / total : 0 };
}

// ============================================================================
// Saúde do sync
// ============================================================================

export type SaudeSync = {
  estado: "sem-integracao" | "em-dia" | "atrasado" | "parado";
  /** Frase pronta para a tela. */
  descricao: string;
};

/**
 * O lote é diário. Um dia de atraso ainda é normal (o lote das 02:00 UTC referencia
 * o dia anterior); dois dias já é alguém precisar olhar; três ou mais é integração
 * parada e o número da tela não vale.
 */
export function avaliarSync(sync: SyncStatus | null): SaudeSync {
  if (!sync) {
    return {
      estado: "sem-integracao",
      descricao: "O Wall-E ainda não enviou nenhum lote. Os números vêm do import manual.",
    };
  }
  const dias = sync.dias_desde;
  if (dias <= 1) {
    return { estado: "em-dia", descricao: `Último lote: ${sync.referencia}.` };
  }
  if (dias === 2) {
    return { estado: "atrasado", descricao: `Último lote há 2 dias (${sync.referencia}).` };
  }
  return {
    estado: "parado",
    descricao: `Sem lote há ${dias} dias (último: ${sync.referencia}). A fila na tela pode estar desatualizada.`,
  };
}
