import { cn } from "@/lib/utils";

// Logotipo hubi em SVG inline — mesma geometria de `hubi-wordmark.svg` e
// `hubi-mark.svg` do design system. Segue o tema sozinho: o traço é a tinta
// atual (`currentColor`, padrão `ink`) e o ponto do "i" é sempre `signal`.
//
// Regras da marca: nunca recolorir o ponto com outra cor, nunca animar,
// nunca escrever "Hubi" com maiúscula. Largura mínima 56px (logotipo) e
// 16px (símbolo).

interface LogoProps {
  /** Altura em px. A largura sai da proporção do desenho (162×72). */
  height?: number;
  /** `mark` = o símbolo quadrado (favicon, sidebar recolhida). */
  variant?: "wordmark" | "mark";
  /** Uma tinta só: o ponto deixa de ser `signal`. */
  mono?: boolean;
  className?: string;
}

export function Logo({ height = 24, variant = "wordmark", mono = false, className }: LogoProps) {
  if (variant === "mark") {
    return (
      <svg
        className={cn("inline-block shrink-0", className)}
        width={height}
        height={height}
        viewBox="0 0 64 64"
        role="img"
        aria-label="hubi"
      >
        <rect width="64" height="64" rx="14" className="fill-inverse" />
        <path d="M20 12V52M20 37a10.5 10.5 0 0 1 21 0V52" fill="none" strokeWidth="6" className="stroke-ink-inverse" />
        <circle cx="46" cy="16" r="4.5" className={mono ? "fill-ink-inverse" : "fill-signal"} />
      </svg>
    );
  }

  return (
    <svg
      className={cn("inline-block shrink-0 text-ink", className)}
      width={(height * 162) / 72}
      height={height}
      viewBox="0 0 162 72"
      role="img"
      aria-label="hubi"
    >
      <g fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="butt">
        <path d="M4.5 4V68M4.5 46a16 16 0 0 1 32 0V68" />
        <path d="M52.5 25.5V47.5a16 16 0 0 0 32 0V25.5M84.5 25.5V68" />
        <path d="M100.5 4V68" />
        <circle cx="116.75" cy="46.75" r="16.25" />
        <path d="M152.5 25.5V68" />
      </g>
      <circle cx="152.5" cy="9.5" r="6.5" className={mono ? "fill-current" : "fill-signal"} />
    </svg>
  );
}
