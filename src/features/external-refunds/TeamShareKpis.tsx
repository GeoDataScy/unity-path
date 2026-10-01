import { useMemo } from "react";

import type { ComparisonSeriesRow } from "./types";
import { fmtInt, fmtMonth, fmtPct } from "./types";

type Props = { series: ComparisonSeriesRow[] };

/**
 * Os três cartões do painel de migração do atendimento.
 *
 * A evolução é sempre medida ENTRE MESES, mesmo quando o gráfico está em dia ou
 * semana: a pergunta é se a fatia do time está crescendo, e dia a dia isso é
 * ruído. É o que o painel de referência faz.
 *
 * Como os demais números desta seção, não respondem ao clique na legenda — ela
 * recorta só o gráfico de volume.
 */
export function TeamShareKpis({ series }: Props) {
  const dados = useMemo(() => {
    const total = series.reduce((s, r) => s + r.orders, 0);
    if (total === 0) return null;
    const equipe = series.reduce((s, r) => s + r.matched, 0);

    const porMes = new Map<string, { t: number; p: number }>();
    for (const r of series) {
      const k = r.date.slice(0, 7);
      const cur = porMes.get(k) ?? { t: 0, p: 0 };
      cur.t += r.orders;
      cur.p += r.matched;
      porMes.set(k, cur);
    }
    const meses = [...porMes.keys()].sort();
    const primeiro = porMes.get(meses[0])!;
    const ultimo = porMes.get(meses[meses.length - 1])!;
    const pctPrimeiro = (primeiro.p / primeiro.t) * 100;
    const pctUltimo = (ultimo.p / ultimo.t) * 100;

    return {
      total,
      equipe,
      plataforma: total - equipe,
      pctEquipe: (equipe / total) * 100,
      pctPlataforma: ((total - equipe) / total) * 100,
      pctPrimeiro,
      pctUltimo,
      mesPrimeiro: meses[0],
      mesUltimo: meses[meses.length - 1],
      umMesSo: meses.length < 2,
      subiu: pctUltimo > pctPrimeiro,
      caiu: pctUltimo < pctPrimeiro,
    };
  }, [series]);

  if (!dados) return null;

  const corEvolucao = dados.subiu ? "var(--rf-up)" : "var(--rf-ink)";
  const seta = dados.subiu ? "▲" : dados.caiu ? "▼" : "▬";

  const cartoes = [
    {
      lab: "Atendidos pela sua equipe",
      val: fmtInt(dados.equipe),
      cor: "var(--rf-ink)",
      sub: `${fmtPct(dados.pctEquipe)} do total`,
    },
    {
      lab: "Atendidos pela plataforma",
      val: fmtInt(dados.plataforma),
      cor: "var(--rf-ink)",
      sub: `${fmtPct(dados.pctPlataforma)} do total`,
    },
    {
      lab: "Evolução da sua fatia",
      val: fmtPct(dados.pctUltimo),
      cor: corEvolucao,
      // Com um mês só no recorte não há evolução para mostrar; comparar o mês
      // consigo mesmo renderizaria "set/26 3,2% ▬ set/26".
      sub: dados.umMesSo ? (
        `${fmtMonth(dados.mesUltimo)}, único mês do período`
      ) : (
        <>
          {fmtMonth(dados.mesPrimeiro)} {fmtPct(dados.pctPrimeiro)}{" "}
          <span style={{ color: corEvolucao, fontWeight: 700 }}>{seta}</span> {fmtMonth(dados.mesUltimo)}
        </>
      ),
    },
  ];

  return (
    <div className="mb-[18px] grid gap-3.5 px-3 sm:grid-cols-3">
      {cartoes.map((c) => (
        <div
          key={c.lab}
          className="rounded-[14px] border px-4 py-3.5"
          style={{ background: "var(--rf-panel-2)", borderColor: "var(--rf-line)" }}
        >
          <div className="text-xs font-medium" style={{ color: "var(--rf-ink-faint)" }}>
            {c.lab}
          </div>
          <div
            className="rf-display mt-[3px] text-[clamp(20px,3vw,26px)] font-medium font-mono tabular-nums"
            style={{ color: c.cor }}
          >
            {c.val}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs" style={{ color: "var(--rf-ink-soft)" }}>
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}
