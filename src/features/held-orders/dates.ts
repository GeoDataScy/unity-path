// Pedidos em Espera — formato único das datas da feature.
//
// Cada pedido tem datas distintas, e nenhuma substitui a outra:
//   order_date        Data do pedido (compra), como veio na planilha.
//   return_date       Data da devolução (só no arquivo de devoluções).
//   imported_at       Data de entrada no sistema (gravada no import, imutável).
//   status_changed_at Última mudança de status registrada pelo agente.
//
// Datas de calendário saem como dd/MM/aaaa; momentos (timestamp) como
// dd/MM/aaaa, HH:mm no horário de São Paulo (o mesmo das demais exportações
// do sistema, src/lib/reportExport.ts). Todas as telas e a planilha
// exportada usam estas duas funções.

export const HELD_ORDER_DATE_LABEL = {
  order_date: "Data do pedido",
  return_date: "Data da devolução",
  imported_at: "Entrada no sistema",
  status_changed_at: "Última mudança de status",
} as const;

/** 'YYYY-MM-DD' (ou ISO completo) -> 'dd/MM/aaaa'. Sem valor -> `empty`. */
export function formatHeldOrderDate(value: string | null | undefined, empty = "—"): string {
  if (!value) return empty;
  const [y, m, d] = value.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

/**
 * Timestamp -> 'dd/MM/aaaa, HH:mm' em São Paulo. Timestamps "naive" (sem fuso)
 * são tratados como UTC — mesmo tratamento das demais exportações do sistema.
 */
export function formatHeldOrderDateTime(value: string | null | undefined, empty = "—"): string {
  if (!value) return empty;
  const ts = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const dt = new Date(ts);
  if (Number.isNaN(dt.getTime())) return empty;
  return dt.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "há 4 min", "há 2 h", "há 3 d" — sem registro: "sem registro". */
export function formatSince(value: string | null, now: number = Date.now()): string {
  if (!value) return "sem registro";
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return "sem registro";
  const minutes = Math.max(0, Math.floor((now - t) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}
