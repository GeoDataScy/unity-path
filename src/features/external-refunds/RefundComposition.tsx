import { fmtInt, fmtPct } from "./types";

type Props = {
  full: number;
  partial: number;
  unspecified: number;
};

/**
 * Barra única com a composição do arquivo: integral, parcial e sem tipo.
 *
 * "Sem tipo" é o pedido que o arquivo confirma como reembolsado mas sem dizer se
 * foi integral ou parcial (na PagAmerican, `Order Status = completed`). Ele conta
 * no total e nas porcentagens — que não olham o tipo —, e só não pode ser
 * chutado para um dos outros dois. Na Cartpanda é sempre zero e o segmento some.
 */
export function RefundComposition({ full, partial, unspecified }: Props) {
  const total = full + partial + unspecified;
  if (total === 0) return null;

  const cats = [
    { key: "partial", lab: "Parciais", n: partial, color: "var(--rf-parcial)" },
    { key: "full", lab: "Integrais", n: full, color: "var(--rf-total)" },
    { key: "unspecified", lab: "Sem tipo no arquivo", n: unspecified, color: "var(--rf-outros)" },
  ].filter((c) => c.n > 0);

  return (
    <div>
      <div className="flex h-11 w-full overflow-hidden rounded-xl" role="img" aria-label="Composição dos reembolsos por tipo">
        {cats.map((c) => {
          const pct = (c.n / total) * 100;
          return (
            <div
              key={c.key}
              className="flex items-center justify-center text-xs font-semibold text-white"
              style={{ background: c.color, flex: `${pct} 1 0` }}
              title={`${c.lab}: ${fmtInt(c.n)} (${fmtPct(pct)})`}
            >
              {pct >= 9 ? fmtPct(pct) : ""}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {cats.map((c) => (
          <div key={c.key} className="flex items-center gap-2 text-sm">
            <span className="h-3 w-3 rounded" style={{ background: c.color }} />
            <span style={{ color: "var(--rf-ink)" }}>{c.lab}</span>
            <span className="tabular-nums" style={{ color: "var(--rf-ink-faint)" }}>
              {fmtInt(c.n)} · {fmtPct((c.n / total) * 100)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
