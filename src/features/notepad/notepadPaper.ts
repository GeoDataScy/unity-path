// Bloco de notas — as constantes do "papel".
//
// A pauta do caderno é um gradiente que se repete a cada RULE_HEIGHT pixels. Para
// o texto pousar SOBRE a linha (e não atravessá-la), duas regras valem em todo
// componente que escreve dentro do papel:
//
//   1) todo texto usa `leading-7` — 1.75rem = 28px = RULE_HEIGHT;
//   2) toda linha/bloco tem altura múltipla de RULE_HEIGHT (sem padding vertical
//      "solto"; use h-7, h-14, py-0...).
//
// Quebrar (1) ou (2) em qualquer filho desalinha a pauta de tudo que vem abaixo.

import type { CSSProperties } from "react";

/** Altura da entrelinha, em px. Espelha o `leading-7` do Tailwind. */
export const RULE_HEIGHT = 28;

/** Distância da borda esquerda até a linha vermelha da margem, em px. */
export const MARGIN_LEFT = 40;

/** Fundo pautado. `local` faz a pauta rolar junto com o conteúdo. */
export const paperStyle: CSSProperties = {
  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${
    RULE_HEIGHT - 1
  }px, hsl(var(--notepad-rule)) ${RULE_HEIGHT - 1}px ${RULE_HEIGHT}px)`,
  backgroundAttachment: "local",
};

/**
 * Ajusta a altura de um textarea para o próximo múltiplo da entrelinha — é o que
 * mantém o campo de escrita alinhado à pauta enquanto o texto cresce.
 */
export function fitToRules(el: HTMLTextAreaElement | null, minLines = 1): void {
  if (!el) return;
  el.style.height = "0px";
  const lines = Math.max(minLines, Math.ceil(el.scrollHeight / RULE_HEIGHT));
  el.style.height = `${lines * RULE_HEIGHT}px`;
}
