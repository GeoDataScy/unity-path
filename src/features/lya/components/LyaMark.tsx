import { cn } from "@/lib/utils";

import type { LyaEstado } from "../types";

// Símbolo "Juba" — a marca da Lya: três arcos concêntricos abertos em três
// níveis de roxo com um ponto rosa no centro. Lê como juba de leão e como onda
// de sinal. É um símbolo abstrato: não tem rosto, não é personagem.
//
// O que faz a Lya parecer viva é o movimento, não a forma parada. Os quatro
// estados moram no CSS global (`src/index.css`, bloco `.lya`) e são trocados
// por um atributo — nunca remontando o SVG.
//
// Regras de aplicação (ver prompt de identidade visual):
//  · abaixo de 24px o símbolo congela — movimento minúsculo é ruído, não charme;
//  · sobre superfície roxa, usar `tone="branco"` (o lilás externo some no roxo);
//  · o símbolo nunca é distorcido, recortado, nem recebe sombra ou gradiente.

interface LyaMarkProps {
  estado?: LyaEstado;
  /** Lado do quadrado, em px. O tamanho vem sempre daqui, nunca do SVG. */
  size?: number;
  /** Monocromática branca, para fundo roxo. */
  tone?: "branco";
  /**
   * Congela a animação mesmo acima de 24px. Usado nos avatares das mensagens
   * antigas: uma thread longa não pode ter dezenas de SVGs animando juntos.
   */
  congelado?: boolean;
  /** `null` marca o símbolo como decorativo (quando já há texto ao lado). */
  label?: string | null;
  className?: string;
}

export function LyaMark({
  estado = "repouso",
  size = 40,
  tone,
  congelado = false,
  label = "Lya",
  className,
}: LyaMarkProps) {
  const estatico = congelado || size < 24;
  return (
    <span
      className={cn("lya shrink-0", className)}
      data-lya-state={estado}
      data-lya-static={estatico ? "true" : undefined}
      data-lya-tone={tone}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <g className="lya-l1">
          <circle className="lya-arc1" cx="50" cy="50" r="40" strokeWidth="6" strokeDasharray="85 166" strokeDashoffset="95" />
        </g>
        <g className="lya-l2">
          <circle className="lya-arc2" cx="50" cy="50" r="30" strokeWidth="7" strokeDasharray="70 119" strokeDashoffset="42" />
        </g>
        <g className="lya-l3">
          <circle className="lya-arc3" cx="50" cy="50" r="20" strokeWidth="8" strokeDasharray="55 71" />
          <circle className="lya-dot" cx="50" cy="50" r="7" />
        </g>
        <circle className="lya-halo" cx="50" cy="50" r="46" />
      </svg>
    </span>
  );
}
