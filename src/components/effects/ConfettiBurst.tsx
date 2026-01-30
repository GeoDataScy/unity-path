import { useMemo } from "react";

type Piece = {
  leftPct: number;
  delayMs: number;
  durationMs: number;
  rotateDeg: number;
  driftPx: number;
  color: string;
};

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--status-success))",
  "hsl(var(--muted-foreground))",
];

export function ConfettiBurst({ pieces = 22 }: { pieces?: number }) {
  const data = useMemo<Piece[]>(() => {
    return Array.from({ length: pieces }, () => {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]!;
      return {
        leftPct: Math.random() * 100,
        delayMs: Math.floor(Math.random() * 220),
        durationMs: 1100 + Math.floor(Math.random() * 600),
        rotateDeg: Math.floor(Math.random() * 360),
        driftPx: -40 + Math.floor(Math.random() * 80),
        color,
      };
    });
  }, [pieces]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <style>
        {`
          @keyframes confetti-burst {
            0% {
              transform: translate3d(var(--drift), 0, 0) rotate(var(--rot));
              opacity: 0;
            }
            10% { opacity: 1; }
            100% {
              transform: translate3d(calc(var(--drift) * -1), 160px, 0) rotate(calc(var(--rot) + 260deg));
              opacity: 0;
            }
          }
        `}
      </style>

      {data.map((p, idx) => (
        <span
          key={idx}
          className="absolute top-0 h-2 w-1.5 rounded-sm"
          style={{
            left: `${p.leftPct}%`,
            background: p.color,
            animation: `confetti-burst ${p.durationMs}ms cubic-bezier(0.2, 0.7, 0.2, 1) ${p.delayMs}ms both`,
            // CSS vars for keyframes
            ...( {
              "--drift": `${p.driftPx}px`,
              "--rot": `${p.rotateDeg}deg`,
            } as React.CSSProperties & Record<string, string> ),
          }}
        />
      ))}
    </div>
  );
}
