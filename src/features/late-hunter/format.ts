// Formatação da aba Late Hunter. Motivos e itens chegam no mesmo texto cru da
// ShipOffers que os Pedidos em Espera já tratam, então os rótulos vêm de lá —
// um motivo tem o mesmo nome nas duas abas.
import { parseItems, parseReasons } from "@/features/held-orders/format";
import type { LateHunterEncerramento, LateHunterEndereco, LateHunterFaixa, LateHunterSync } from "./types";

export { parseItems };

/** Rótulo pt-BR de um motivo da ShipOffers; desconhecido sai como veio. */
export function motivoLabel(motivo: string): string {
  return parseReasons(motivo)[0]?.label ?? motivo;
}

/**
 * Faixas de envelhecimento, na ordem do gráfico. Os cortes seguem a forma da
 * distribuição real (02/10/2026: 1/3 dos pedidos até 3 dias, cauda longa
 * passando de 60) e as janelas que o time usa para cobrar — semana, quinzena,
 * mês.
 */
export const FAIXAS: { key: LateHunterFaixa; label: string; min: number | null; max: number | null }[] = [
  { key: "0-3", label: "0–3 dias", min: 0, max: 3 },
  { key: "4-7", label: "4–7", min: 4, max: 7 },
  { key: "8-14", label: "8–14", min: 8, max: 14 },
  { key: "15-30", label: "15–30", min: 15, max: 30 },
  { key: "31-60", label: "31–60", min: 31, max: 60 },
  { key: "60+", label: "60+", min: 61, max: null },
];

/** Acima disto o pedido é "antigo" (cartão e destaque na tabela). */
export const LIMITE_ANTIGO = 30;

/** 2026-09-22 → 22/09/2026, sem passar por timezone (a string já é o dia). */
export function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** 2026-09-22 → 22/09. */
export function formatShortDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatCount(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("pt-BR");
}

/** Endereço em uma linha, só com as partes que vieram. */
export function enderecoLinha(e: LateHunterEndereco | null): string {
  if (!e) return "";
  const cidade = [e.cidade, e.estado].filter(Boolean).join(", ");
  return [e.logradouro, e.complemento, [cidade, e.cep].filter(Boolean).join(" "), e.pais]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

export const ENCERRAMENTO_LABEL: Record<LateHunterEncerramento, string> = {
  aplicado: "Lote completo — quem saiu do on-hold foi encerrado",
  lote_incompleto: "Lote parcial — nada foi encerrado",
  paginas_pendentes: "Aguardando as demais páginas do lote",
  lote_antigo: "Lote atrasado de um dia anterior — só atualizou",
};

export type SaudeSync = "em_dia" | "atrasado" | "sem_dados";

/**
 * O Late Hunter roda 1x por dia (~02:00 UTC). Sem lote há mais de 30 h, algo
 * parou — a tela avisa em vez de deixar o time trabalhar com a fila de ontem.
 */
export function saudeDoSync(sync: LateHunterSync | null, agora = new Date()): SaudeSync {
  if (!sync) return "sem_dados";
  const recebido = new Date(sync.recebido_em).getTime();
  if (Number.isNaN(recebido)) return "sem_dados";
  return agora.getTime() - recebido > 30 * 3_600_000 ? "atrasado" : "em_dia";
}

/** Nome do país a partir do código ISO que a ShipOffers manda ("US"). */
export function paisLabel(code: string | null): string {
  if (!code) return "Sem país";
  try {
    const nome = new Intl.DisplayNames(["pt-BR"], { type: "region" }).of(code.toUpperCase());
    return nome && nome !== code.toUpperCase() ? `${nome} (${code.toUpperCase()})` : code;
  } catch {
    return code;
  }
}
