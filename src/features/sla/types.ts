/**
 * Nível de serviço do pacote (doc XMX-2026/IMP-SUP-01-A v2).
 * Mede o serviço por caso e por mês — nunca a pessoa por dia.
 * Espelha o JSON das RPCs `sla_mensal`, `sla_relatorio_mensal` e `my_overdue_queue_items`.
 */

export type SlaIndicadorChave = "reembolso_abertura" | "reembolso_conclusao" | "radar_envelhecido";

export type SlaIndicador = {
  chave: SlaIndicadorChave;
  rotulo: string;
  parametro_horas: number;
  casos_total: number;
  casos_no_prazo: number;
  casos_vencidos: number;
  /** null quando não houve caso no mês. */
  pct_no_prazo: number | null;
};

export type SlaMensal = {
  /** YYYY-MM */
  mes: string;
  dias_uteis: number;
  volume: number;
  capacidade: number;
  indicadores: SlaIndicador[];
};

export type SlaRelatorio =
  | ({ disponivel: true; disponivel_em: string } & SlaMensal)
  | { disponivel: false; mes: string; disponivel_em: string };

export type OverdueQueueTipo = "reembolso_abertura" | "reembolso_conclusao" | "radar";

export type OverdueQueueItem = {
  caso_id: string;
  tipo: OverdueQueueTipo;
  rotulo_tipo: string;
  prazo_horas: number;
  vencido_ha_horas: number;
};

const toNumber = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

const toNullableNumber = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : toNumber(v);

export function parseSlaMensal(raw: unknown): SlaMensal {
  const r = (raw ?? {}) as Record<string, unknown>;
  const indicadores = Array.isArray(r.indicadores) ? r.indicadores : [];
  return {
    mes: String(r.mes ?? ""),
    dias_uteis: toNumber(r.dias_uteis),
    volume: toNumber(r.volume),
    capacidade: toNumber(r.capacidade),
    indicadores: indicadores.map((i) => {
      const it = (i ?? {}) as Record<string, unknown>;
      return {
        chave: it.chave as SlaIndicadorChave,
        rotulo: String(it.rotulo ?? ""),
        parametro_horas: toNumber(it.parametro_horas),
        casos_total: toNumber(it.casos_total),
        casos_no_prazo: toNumber(it.casos_no_prazo),
        casos_vencidos: toNumber(it.casos_vencidos),
        pct_no_prazo: toNullableNumber(it.pct_no_prazo),
      };
    }),
  };
}

export function parseSlaRelatorio(raw: unknown): SlaRelatorio {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.disponivel !== true) {
    return { disponivel: false, mes: String(r.mes ?? ""), disponivel_em: String(r.disponivel_em ?? "") };
  }
  return { ...parseSlaMensal(r), disponivel: true, disponivel_em: String(r.disponivel_em ?? "") };
}

export function parseOverdueQueueItems(raw: unknown): OverdueQueueItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const it = (row ?? {}) as Record<string, unknown>;
    return {
      caso_id: String(it.caso_id ?? ""),
      tipo: it.tipo as OverdueQueueTipo,
      rotulo_tipo: String(it.rotulo_tipo ?? ""),
      prazo_horas: toNumber(it.prazo_horas),
      vencido_ha_horas: toNumber(it.vencido_ha_horas),
    };
  });
}
