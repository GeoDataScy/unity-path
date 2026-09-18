import { useMemo, useState } from "react";

import { ChartTooltip } from "./RefundVolumeChart";
import { linearTrend, niceMax, teamShare, type Bucket, type Granularity } from "./series";
import { fmtInt, fmtPct } from "./types";

type Props = {
  buckets: Bucket[];
  gran: Granularity;
  /** Fatia do período inteiro, desenhada como linha de referência. */
  overallPct: number | null;
};

const H = 260;
const PAD = { l: 46, r: 14, t: 22, b: 42 };

/**
 * Fatia dos reembolsos que passou pelo time, balde a balde.
 *
 * É o mesmo numerador do % interno oficial (pedidos do arquivo que casaram com
 * a base interna), visto ao longo do tempo em vez de num número só. A linha
 * cheia é a média do período; a tracejada é a tendência por mínimos quadrados —
 * serve para responder "está subindo?", que é a pergunta do gestor.
 */
export function TeamShareChart({ buckets, gran, overallPct }: Props) {
  const [hover, setHover] = useState<{ x: number; y: number; bucket: Bucket } | null>(null);

  const isDay = gran === "dia";
  const slot = isDay ? 26 : gran === "sem" ? 90 : 150;
  const gap = isDay ? 6 : 26;
  const barW = slot - gap;
  const W = PAD.l + PAD.r + buckets.length * slot;
  const plotH = H - PAD.t - PAD.b;

  const pcts = useMemo(() => buckets.map(teamShare), [buckets]);
  const overall = overallPct ?? 0;
  const top = useMemo(() => niceMax(Math.max(overall, ...pcts, 1) * 1.18), [pcts, overall]);
  const y = (v: number) => PAD.t + plotH - (v / top) * plotH;
  const cx = (i: number) => PAD.l + i * slot + gap / 2 + barW / 2;
  const trend = useMemo(() => linearTrend(pcts), [pcts]);

  if (buckets.length === 0) return null;

  return (
    <div className="relative">
      <div className="overflow-x-auto px-1.5" onScroll={() => setHover(null)}>
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Fatia dos reembolsos atendida pela equipe ao longo do tempo"
          className="rf-body mx-auto block"
        >
          {[0, 1, 2, 3, 4].map((t) => {
            const val = (top * t) / 4;
            return (
              <g key={t}>
                <line x1={PAD.l} y1={y(val)} x2={W - PAD.r} y2={y(val)} stroke="var(--rf-line)" strokeWidth={1} />
                <text x={PAD.l - 8} y={y(val) + 3} textAnchor="end" fill="var(--rf-ink-faint)" fontSize={11}>
                  {fmtPct(val, val < 1 ? 1 : 0)}
                </text>
              </g>
            );
          })}

          {overallPct !== null && (
            <>
              <line x1={PAD.l} y1={y(overall)} x2={W - PAD.r} y2={y(overall)} stroke="var(--rf-ink-faint)" strokeWidth={1.2} opacity={0.7} />
              <text x={PAD.l + 6} y={y(overall) - 5} fill="var(--rf-ink-faint)" fontSize={10}>
                média {fmtPct(overall)}
              </text>
            </>
          )}

          {buckets.map((b, i) => {
            const pct = pcts[i];
            const x = PAD.l + i * slot + gap / 2;
            const skipLabel = isDay && buckets.length > 26 && i % 2 !== 0;
            return (
              <g
                key={b.id}
                onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, bucket: b })}
                onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, bucket: b })}
                onMouseLeave={() => setHover(null)}
              >
                <rect x={x} y={PAD.t} width={barW} height={plotH} fill="transparent" />
                {pct > 0 ? (
                  <>
                    <rect x={x} y={y(pct)} width={barW} height={plotH - (y(pct) - PAD.t)} fill="var(--rf-equipe)" rx={3} />
                    {(!isDay || b.matched > 0) && (
                      <text x={x + barW / 2} y={y(pct) - 6} textAnchor="middle" fill="var(--rf-ink-soft)" fontSize={10} fontWeight={600}>
                        {fmtPct(pct)}
                      </text>
                    )}
                  </>
                ) : (
                  // marca de zero: sem ela o dia sem atendimento some do gráfico
                  <rect x={x} y={y(0) - 2} width={barW} height={2} fill="var(--rf-equipe)" opacity={0.25} />
                )}
                {!skipLabel && (
                  <>
                    <text x={x + barW / 2} y={H - PAD.b + 16} textAnchor="middle" fill="var(--rf-ink-soft)" fontSize={isDay ? 10 : 11}>
                      {b.label}
                    </text>
                    <text x={x + barW / 2} y={H - PAD.b + 29} textAnchor="middle" fill="var(--rf-ink-faint)" fontSize={10}>
                      {b.sub}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {buckets.length > 1 && (
            <line
              x1={cx(0)}
              y1={y(Math.max(0, trend.intercept))}
              x2={cx(buckets.length - 1)}
              y2={y(Math.max(0, trend.intercept + trend.slope * (buckets.length - 1)))}
              stroke="var(--rf-trend)"
              strokeWidth={2.4}
              strokeDasharray="6 5"
              strokeLinecap="round"
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
          <div className="flex items-center justify-between gap-6 py-0.5">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--rf-equipe)" }} />
              Nosso time
            </span>
            <span className="tabular-nums font-medium">{fmtInt(hover.bucket.matched)}</span>
          </div>
          <div className="flex items-center justify-between gap-6 py-0.5">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--rf-plat)" }} />
              Só na plataforma
            </span>
            <span className="tabular-nums font-medium">{fmtInt(hover.bucket.orders - hover.bucket.matched)}</span>
          </div>
          <div
            className="mt-1.5 flex items-center justify-between gap-6 border-t pt-1.5 font-semibold"
            style={{ borderColor: "var(--rf-line)" }}
          >
            <span>% interno</span>
            <span className="tabular-nums">{fmtPct(teamShare(hover.bucket))}</span>
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}
