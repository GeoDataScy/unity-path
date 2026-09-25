// Agregação da série de reembolsos externos para os gráficos do comparativo.
//
// A RPC devolve uma linha por (data, produto). Tudo aqui é função pura sobre
// esse array: a tela escolhe dia, semana ou mês e quantidade ou valor, e estas
// funções entregam os baldes prontos. Ficam separadas do componente porque são
// a parte que precisa de teste — o SVG em volta é desenho.

import type { ComparisonSeriesRow, ExternalPlatform } from "./types";

export type Granularity = "dia" | "sem" | "mes";
export type ChartMetric = "qtd" | "valor";

/**
 * Plataformas cujo arquivo traz a data do REEMBOLSO. Só nelas "reembolsos por
 * dia" quer dizer o que está escrito.
 *
 * O export da Cartpanda traz apenas a data da COMPRA: agrupar por dia ali
 * responderia "quantos pedidos comprados neste dia acabaram reembolsados", que é
 * outra pergunta. Por isso a tela oferece só Mensal quando a plataforma não está
 * nesta lista — e o mês, sendo o mês informado na importação, continua honesto.
 */
const PLATFORMS_WITH_REFUND_DATE: ExternalPlatform[] = ["PagAmerican", "Buygoods"];

export function hasRefundDate(platform: ExternalPlatform): boolean {
  return PLATFORMS_WITH_REFUND_DATE.includes(platform);
}

export function granularitiesFor(platform: ExternalPlatform): Granularity[] {
  return hasRefundDate(platform) ? ["dia", "sem", "mes"] : ["mes"];
}

export type Bucket = {
  /** Chave de ordenação e identidade do balde (YYYY-MM-DD ou YYYY-MM). */
  id: string;
  /** Rótulo do eixo x. */
  label: string;
  /** Segunda linha do rótulo (dia da semana, "semana" ou "mês"). */
  sub: string;
  /** Valor por produto, já na métrica escolhida. */
  byProduct: Record<string, number>;
  /** Soma dos produtos visíveis. */
  total: number;
  /** Pedidos do balde que passaram pelo time (sempre contagem, nunca valor). */
  matched: number;
  /** Pedidos do balde (sempre contagem), denominador da fatia do time. */
  orders: number;
};

const DIA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** 'YYYY-MM-DD' → Date local (sem fuso: new Date('2026-08-12') seria UTC). */
export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function ddmm(dt: Date): string {
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}`;
}

/** Segunda-feira da semana da data (semana ISO, que começa na segunda). */
export function mondayOf(dt: Date): Date {
  const d = new Date(dt);
  const wd = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - wd);
  return d;
}

function bucketKey(dateISO: string, gran: Granularity): { id: string; label: string; sub: string } {
  const dt = parseISODate(dateISO);
  if (gran === "dia") return { id: dateISO, label: ddmm(dt), sub: DIA[dt.getDay()] };
  if (gran === "sem") {
    const mon = mondayOf(dt);
    const end = new Date(mon);
    end.setDate(end.getDate() + 6);
    return { id: `${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}`, label: `${ddmm(mon)}–${ddmm(end)}`, sub: "semana" };
  }
  return { id: dateISO.slice(0, 7), label: `${MES[dt.getMonth()]}/${String(dt.getFullYear()).slice(2)}`, sub: "mês" };
}

/**
 * Agrupa a série no balde escolhido.
 *
 * `hidden` tira o produto do total e das barras de volume, como a legenda
 * clicável do painel de referência. Os campos `matched`/`orders`, que alimentam
 * a migração do atendimento, ignoram `hidden` — também como no painel de
 * referência. Para recortar a tela inteira por produto existe o filtro Produto.
 */
export function buildBuckets(
  rows: ComparisonSeriesRow[],
  gran: Granularity,
  metric: ChartMetric,
  hidden: Set<string> = new Set(),
): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const { id, label, sub } = bucketKey(r.date, gran);
    let b = map.get(id);
    if (!b) {
      b = { id, label, sub, byProduct: {}, total: 0, matched: 0, orders: 0 };
      map.set(id, b);
    }
    b.byProduct[r.product] = (b.byProduct[r.product] ?? 0) + (metric === "qtd" ? r.orders : Number(r.amount));
    // A fatia do time é sempre contagem: "que fração dos pedidos passou pelo
    // time" não muda de significado quando o gráfico está medindo dinheiro.
    //
    // E NÃO responde ao `hidden`: esconder um produto na legenda mexe só nas
    // barras de volume; a migração do atendimento continua sobre o período
    // inteiro. É o comportamento do painel de referência, e foi decisão do
    // gestor mantê-lo — ali a legenda é um recorte do gráfico de cima, não um
    // filtro da tela. Quem quiser a fatia de um produto usa o filtro Produto,
    // que recorta tudo de uma vez.
    b.matched += r.matched;
    b.orders += r.orders;
  }
  const out = [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const b of out) {
    b.total = Object.entries(b.byProduct).reduce((s, [p, v]) => (hidden.has(p) ? s : s + v), 0);
  }
  return out;
}

/** Produtos presentes na série, na ordem de maior volume. */
export function productsInSeries(rows: ComparisonSeriesRow[]): string[] {
  const t = new Map<string, number>();
  for (const r of rows) t.set(r.product, (t.get(r.product) ?? 0) + r.orders);
  return [...t.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

/**
 * Média móvel centrada em nada: cada ponto é a média dos `window` baldes até ele,
 * inclusive. Os primeiros pontos usam a janela parcial em vez de ficarem vazios,
 * que é como o painel de referência desenha.
 */
export function movingAverage(values: number[], window = 7): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - window + 1);
    const slice = values.slice(from, i + 1);
    out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return out;
}

/** Reta de tendência por mínimos quadrados sobre o índice do balde. */
export function linearTrend(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  values.forEach((v, i) => {
    sx += i;
    sy += v;
    sxy += i * v;
    sxx += i * i;
  });
  const denom = n * sxx - sx * sx || 1;
  const slope = (n * sxy - sx * sy) / denom;
  return { slope, intercept: (sy - slope * sx) / n };
}

/** Teto "redondo" do eixo y: 1, 2, 5 ou 10 vezes a potência de dez. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

/** Fatia do time no balde, em %. Balde sem pedido visível vale 0. */
export function teamShare(b: Bucket): number {
  return b.orders > 0 ? (b.matched / b.orders) * 100 : 0;
}
