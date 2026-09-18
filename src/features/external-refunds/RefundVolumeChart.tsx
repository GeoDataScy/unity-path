import { useMemo, useState } from "react";

import { computeSlot, GAP, labelStep, PAD, tickCount, useMeasuredWidth } from "./chartLayout";
import { movingAverage, niceMax, type Bucket, type ChartMetric, type Granularity } from "./series";
import { fmtInt, fmtUsd, fmtUsdCompact } from "./types";

type Props = {
  buckets: Bucket[];
  /** Produtos na ordem da legenda, já com a cor resolvida. */
  products: { key: string; color: string }[];
  metric: ChartMetric;
  gran: Granularity;
  hidden: Set<string>;
};

type Hover = { x: number; y: number; bucket: Bucket } | null;

const H = 360;
const PAD_Y = { t: 18, b: 42 };

/**
 * Barras empilhadas por produto, uma barra por balde de tempo.
 *
 * SVG na mão, e não a biblioteca de gráficos do resto do app, porque o layout de
 * referência define coisas que a biblioteca não dá de graça: largura de barra
 * fixa com rolagem horizontal (para o eixo diário caber sem espremer), rótulo
 * duplo no eixo x, bandeirinha no pico e a linha de média móvel por cima das
 * pilhas. Como todo o cálculo mora em series.ts, o que sobra aqui é desenho.
 */
export function RefundVolumeChart({ buckets, products, metric, gran, hidden }: Props) {
  const [hover, setHover] = useState<Hover>(null);
  const [boxRef, boxW] = useMeasuredWidth<HTMLDivElement>();

  const visible = products.filter((p) => !hidden.has(p.key));
  const isDay = gran === "dia";
  const slot = computeSlot(boxW, buckets.length, gran);
  const gap = GAP[gran];
  const barW = slot - gap;
  const W = Math.max(boxW, PAD.l + PAD.r + buckets.length * slot);
  const plotH = H - PAD_Y.t - PAD_Y.b;

  const top = useMemo(() => niceMax(Math.max(1, ...buckets.map((b) => b.total))), [buckets]);
  const ticks = tickCount(top);
  const y = (v: number) => PAD_Y.t + plotH - (v / top) * plotH;
  const cx = (i: number) => PAD.l + i * slot + gap / 2 + barW / 2;
  // "12/08" ocupa ~32px; semana e mês pedem mais espaço por rótulo.
  const step = labelStep(slot, isDay ? 34 : gran === "sem" ? 76 : 48);

  const ma = useMemo(
    () => (isDay ? movingAverage(buckets.map((b) => b.total), 7) : null),
    [buckets, isDay],
  );
  const peakIdx = buckets.reduce((mi, b, i, a) => (b.total > a[mi].total ? i : mi), 0);
  const fmtV = (v: number) => (metric === "qtd" ? fmtInt(Math.round(v)) : fmtUsd(v));

  if (buckets.length === 0) {
    return (
      <p className="px-4 py-12 text-center text-sm" style={{ color: "var(--rf-ink-faint)" }}>
        Nenhum reembolso externo no recorte selecionado.
      </p>
    );
  }

  return (
    <div className="relative">
      <div ref={boxRef} className="overflow-x-auto px-1.5" onScroll={() => setHover(null)}>
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Volume de reembolsos por período, empilhado por produto"
          className="rf-body mx-auto block"
        >
          {/* grade e eixo y */}
          {Array.from({ length: ticks + 1 }, (_, t) => {
            const val = (top * t) / ticks;
            return (
              <g key={t}>
                <line x1={PAD.l} y1={y(val)} x2={W - PAD.r} y2={y(val)} stroke="var(--rf-line)" strokeWidth={1} />
                <text x={PAD.l - 8} y={y(val) + 3} textAnchor="end" fill="var(--rf-ink-faint)" fontSize={11}>
                  {metric === "qtd" ? fmtInt(Math.round(val)) : fmtUsdCompact(val)}
                </text>
              </g>
            );
          })}

          {buckets.map((b, i) => {
            const x = PAD.l + i * slot + gap / 2;
            let acc = 0;
            const skipLabel = i % step !== 0;
            return (
              <g
                key={b.id}
                onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, bucket: b })}
                onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, bucket: b })}
                onMouseLeave={() => setHover(null)}
              >
                {/* alvo de mouse do balde inteiro, para não piscar entre segmentos */}
                <rect x={x} y={PAD_Y.t} width={barW} height={plotH} fill="transparent" />
                {visible.map((p) => {
                  const v = b.byProduct[p.key] ?? 0;
                  if (v <= 0) return null;
                  const h = (v / top) * plotH;
                  const yy = y(acc + v);
                  acc += v;
                  return <rect key={p.key} x={x} y={yy} width={barW} height={h} fill={p.color} rx={2} />;
                })}
                {i === peakIdx && b.total > 0 && (
                  <text x={x + barW / 2} y={y(b.total) - 6} textAnchor="middle" fill="var(--rf-ink-faint)" fontSize={10} fontWeight={600}>
                    pico
                  </text>
                )}
                {!skipLabel && (
                  <>
                    <text x={x + barW / 2} y={H - PAD_Y.b + 16} textAnchor="middle" fill="var(--rf-ink-soft)" fontSize={isDay ? 10 : 11}>
                      {b.label}
                    </text>
                    <text x={x + barW / 2} y={H - PAD_Y.b + 29} textAnchor="middle" fill="var(--rf-ink-faint)" fontSize={10}>
                      {b.sub}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* média móvel: só no diário, onde ela tem o que suavizar */}
          {ma && ma.length > 1 && (
            <polyline
              points={ma.map((v, i) => `${cx(i)},${y(v)}`).join(" ")}
              fill="none"
              stroke="var(--rf-ma)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.85}
            />
          )}
        </svg>
      </div>

      {hover && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div className="mb-1.5 font-semibold" style={{ color: "var(--rf-ink)" }}>
            {hover.bucket.label}
            {gran === "dia" && <span style={{ color: "var(--rf-ink-faint)" }}> · {hover.bucket.sub}</span>}
          </div>
          {visible
            .filter((p) => (hover.bucket.byProduct[p.key] ?? 0) > 0)
            .map((p) => (
              <div key={p.key} className="flex items-center justify-between gap-6 py-0.5">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
                  {p.key}
                </span>
                <span className="tabular-nums font-medium">{fmtV(hover.bucket.byProduct[p.key] ?? 0)}</span>
              </div>
            ))}
          <div
            className="mt-1.5 flex items-center justify-between gap-6 border-t pt-1.5 font-semibold"
            style={{ borderColor: "var(--rf-line)" }}
          >
            <span>Total</span>
            <span className="tabular-nums">{fmtV(hover.bucket.total)}</span>
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}

/** Balão que segue o cursor, preso na janela. */
export function ChartTooltip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const W_TIP = 220;
  const left = Math.min(Math.max(8, x + 14), (typeof window !== "undefined" ? window.innerWidth : 1200) - W_TIP - 8);
  const topPos = Math.max(8, y - 12);
  return (
    <div
      className="rf-body pointer-events-none fixed z-50 rounded-xl border px-3 py-2 text-xs shadow-lg"
      style={{
        left,
        top: topPos,
        minWidth: W_TIP,
        background: "var(--rf-panel)",
        borderColor: "var(--rf-line)",
        color: "var(--rf-ink-soft)",
        boxShadow: "var(--rf-shadow)",
      }}
    >
      {children}
    </div>
  );
}
