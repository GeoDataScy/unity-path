// Radar — tipos e vocabulário da ferramenta de acompanhamento de pendências.
//
// Os códigos (`kind`, `status`) precisam ficar em sincronia com as CHECK
// constraints de radar_items/radar_events na migration
// 20260825120000_radar_pendencias.sql. Adicionar um tipo/status aqui exige
// alterar as constraints lá também.

/** Tipo de acompanhamento — a lista pedida pela operação, na ordem da tela. */
export type RadarKind =
  | "devolucao"
  | "rma"
  | "reenvio"
  | "reenvio_endereco"
  | "correcao_endereco"
  | "novo_rastreio"
  | "on_hold"
  | "logistica"
  | "outros";

export type RadarStatus =
  | "aberto"
  | "em_andamento"
  | "aguardando_cliente"
  | "aguardando_logistica"
  | "resolvido"
  | "cancelado";

export type RadarKindMeta = {
  code: RadarKind;
  label: string;
  /** Cor do ponto na lista/select (mesmo padrão de CONTACT_REASONS). */
  dot: string;
  /**
   * Dias ÚTEIS sugeridos para o próximo acompanhamento deste tipo. É só
   * sugestão: o agente pode trocar a data no diálogo (decisão do produto).
   */
  suggestedBusinessDays: number;
  /** Uma linha explicando quando usar — aparece como dica no formulário. */
  hint: string;
};

export const RADAR_KINDS: readonly RadarKindMeta[] = [
  {
    code: "devolucao",
    label: "Devolução de produto",
    dot: "bg-amber-500",
    suggestedBusinessDays: 5,
    hint: "Cliente vai devolver ou já postou a devolução — acompanhar até chegar.",
  },
  {
    code: "rma",
    label: "Envio/acompanhamento de RMA",
    dot: "bg-orange-500",
    suggestedBusinessDays: 3,
    hint: "RMA solicitado ou emitido — acompanhar até o parceiro processar.",
  },
  {
    code: "reenvio",
    label: "Reenvio de produto",
    dot: "bg-blue-500",
    suggestedBusinessDays: 5,
    hint: "Reenvio prometido ao cliente — acompanhar até postar e entregar.",
  },
  {
    code: "reenvio_endereco",
    label: "Reenvio por endereço incorreto ou incompleto",
    dot: "bg-cyan-500",
    suggestedBusinessDays: 3,
    hint: "Pedido voltou ou parou por endereço ruim — confirmar dados e reenviar.",
  },
  {
    code: "correcao_endereco",
    label: "Alteração/correção de endereço",
    dot: "bg-teal-500",
    suggestedBusinessDays: 2,
    hint: "Endereço a corrigir antes do envio — confirmar com a logística.",
  },
  {
    code: "novo_rastreio",
    label: "Acompanhamento de novo código de rastreio",
    dot: "bg-indigo-500",
    suggestedBusinessDays: 3,
    hint: "Código novo emitido — acompanhar movimentação até a entrega.",
  },
  {
    code: "on_hold",
    label: "Cliente da lista de On Hold",
    dot: "bg-purple-500",
    suggestedBusinessDays: 2,
    hint: "Pedido retido — acompanhar até liberar ou cancelar.",
  },
  {
    code: "logistica",
    label: "Aguardando retorno da logística/parceiros",
    dot: "bg-rose-500",
    suggestedBusinessDays: 2,
    hint: "Bola está com o parceiro — cobrar até a resposta chegar.",
  },
  {
    code: "outros",
    label: "Outra pendência",
    dot: "bg-slate-400",
    suggestedBusinessDays: 3,
    hint: "Qualquer pendência que precise de acompanhamento e não se encaixe acima.",
  },
] as const;

export function getRadarKind(code: string | null | undefined): RadarKindMeta | null {
  if (!code) return null;
  return RADAR_KINDS.find((k) => k.code === code) ?? null;
}

export function radarKindLabel(code: string | null | undefined): string {
  return getRadarKind(code)?.label ?? code ?? "—";
}

type BadgeVariant = "new" | "in-progress" | "open" | "success" | "done" | "secondary";

export type RadarStatusMeta = {
  code: RadarStatus;
  label: string;
  variant: BadgeVariant;
  /** `false` = caso saiu do radar (não pede mais data de acompanhamento). */
  isOpen: boolean;
};

export const RADAR_STATUSES: readonly RadarStatusMeta[] = [
  { code: "aberto", label: "Aberto", variant: "new", isOpen: true },
  { code: "em_andamento", label: "Em andamento", variant: "in-progress", isOpen: true },
  { code: "aguardando_cliente", label: "Aguardando cliente", variant: "open", isOpen: true },
  { code: "aguardando_logistica", label: "Aguardando logística", variant: "open", isOpen: true },
  { code: "resolvido", label: "Resolvido", variant: "success", isOpen: false },
  { code: "cancelado", label: "Cancelado", variant: "secondary", isOpen: false },
] as const;

export function getRadarStatus(code: string | null | undefined): RadarStatusMeta | null {
  if (!code) return null;
  return RADAR_STATUSES.find((s) => s.code === code) ?? null;
}

export function radarStatusLabel(code: string | null | undefined): string {
  return getRadarStatus(code)?.label ?? code ?? "—";
}

export function isRadarStatusOpen(code: string | null | undefined): boolean {
  return getRadarStatus(code)?.isOpen ?? false;
}

/** Um caso, como devolvido por `my_radar_items().items`. */
export type MyRadarItem = {
  id: string;
  client_email: string;
  order_number: string | null;
  product: string | null;
  kind: RadarKind;
  action_needed: string;
  status: RadarStatus;
  /** 'YYYY-MM-DD'; nulo quando o caso está fechado. */
  next_follow_up_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  agent_name: string | null;
  event_count: number;
  last_action: string | null;
  last_action_at: string | null;
  /** Dias de atraso (positivo = atrasado). Nulo em caso fechado. */
  days_overdue: number | null;
  is_overdue: boolean;
  is_due_today: boolean;
};

/** Uma linha da timeline, como devolvida por `radar_item_events`. */
export type RadarEvent = {
  id: string;
  status: RadarStatus;
  action: string;
  next_follow_up_date: string | null;
  recorded_at: string;
  user_name: string | null;
};

/**
 * Contadores prontos do servidor (nada de métrica calculada no cliente).
 *
 * `overdue`, `due_today` e `due_week` são DISJUNTOS — a tela mostra os três em
 * cartões separados e eles precisam fechar sem contar o mesmo caso duas vezes.
 * `resolved`/`cancelled` são dos últimos 30 dias, a mesma janela dos casos
 * fechados que `items` devolve (ver comentário de my_radar_items na migration).
 */
export type RadarSummary = {
  open: number;
  overdue: number;
  due_today: number;
  due_week: number;
  resolved: number;
  cancelled: number;
};

export type MyRadarResult = {
  /** Data de hoje em São Paulo ('YYYY-MM-DD'), como o servidor a enxerga. */
  today: string;
  items: MyRadarItem[];
  summary: RadarSummary;
};

/** Contadores enxutos do badge da sidebar (`my_radar_summary`). */
export type RadarBadgeSummary = {
  open: number;
  overdue: number;
  due_today: number;
};
