/**
 * Eixos vazios no lugar do gráfico: mostra onde a figura vai entrar sem
 * desenhar barra ou linha nenhuma — nada que possa ser lido como número real.
 * O texto fica em HTML (não no SVG) para não escalar junto com a figura.
 */
export function ChartFramePlaceholder() {
  return (
    <figure className="rounded-sm border border-[var(--nb-border)] bg-[var(--nb-sheet)] p-3">
      <div className="relative">
        <svg
          viewBox="0 0 400 130"
          preserveAspectRatio="none"
          className="block h-[150px] w-full sm:h-[190px]"
          aria-hidden="true"
          focusable="false"
        >
          {[30, 60, 90].map((y) => (
            <line
              key={y}
              x1="20"
              x2="392"
              y1={y}
              y2={y}
              stroke="var(--nb-border)"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line x1="20" x2="20" y1="8" y2="120" stroke="var(--nb-border-strong)" vectorEffect="non-scaling-stroke" />
          <line x1="20" x2="392" y1="120" y2="120" stroke="var(--nb-border-strong)" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-sm bg-[var(--nb-sheet)] px-2 text-[13px] text-[var(--nb-ink-3)]">
            O gráfico da análise entra aqui
          </span>
        </span>
      </div>
      <figcaption className="mt-2 text-center text-[12px] text-[var(--nb-ink-3)]">
        Figura gerada no notebook, com título, eixos e fonte dos dados.
      </figcaption>
    </figure>
  );
}
