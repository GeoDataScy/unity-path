import { ZENDESK_CHANNEL_LABEL } from "./types";

const TZ = "America/Sao_Paulo";

/** 04/09/26 13:07 (horário de São Paulo). */
export function formatarDataHora(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "há 3 h", "há 2 d", "agora". Complementa a data absoluta, não a substitui. */
export function tempoRelativo(iso: string | null | undefined, agora = Date.now()) {
  if (!iso) return "";
  const diffMin = Math.round((agora - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin} min`;
  const h = Math.round(diffMin / 60);
  if (h < 48) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 60) return `há ${d} d`;
  return `há ${Math.round(d / 30)} m`;
}

/** 142 → "2 h 22 min"; 3000 → "2 d 2 h". */
export function formatarMinutos(min: number | null | undefined) {
  if (min === null || min === undefined) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

export function rotuloCanal(channel: string | null | undefined) {
  if (!channel) return "—";
  return ZENDESK_CHANNEL_LABEL[channel] ?? channel;
}
