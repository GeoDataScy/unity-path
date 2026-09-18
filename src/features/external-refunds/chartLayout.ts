// Largura das barras, passo dos rótulos e divisão do eixo y.
//
// O layout de referência usa largura de barra FIXA (26px no diário) e centraliza
// o SVG. Isso funciona com os 35 dias que ele tinha — enche o painel — mas com
// 15 dias o gráfico vira uma ilha estreita no meio e os rótulos "02/09" se
// sobrepõem, porque o rótulo é mais largo que a fatia de 26px.
//
// Aqui a fatia passa a se esticar até ocupar a largura disponível, com a fatia do
// original como PISO: com muitos dias o comportamento é o mesmo (piso + rolagem
// horizontal), com poucos o gráfico enche o painel. E o passo dos rótulos sai da
// largura real da fatia, não de uma contagem fixa.

import { useEffect, useRef, useState } from "react";

import type { Granularity } from "./series";

/** Fatia mínima por balde, a mesma do layout de referência. */
const SLOT_MIN: Record<Granularity, number> = { dia: 26, sem: 90, mes: 150 };
/** Teto para não virar tarja gigante quando há dois ou três baldes. */
const SLOT_MAX: Record<Granularity, number> = { dia: 64, sem: 160, mes: 260 };
/** Espaço entre barras. */
export const GAP: Record<Granularity, number> = { dia: 6, sem: 26, mes: 26 };

export const PAD = { l: 46, r: 14 };

/**
 * Fatia por balde para a largura disponível. Abaixo do piso o gráfico passa a
 * rolar na horizontal, que é o comportamento do original com muitos dias.
 */
export function computeSlot(available: number, count: number, gran: Granularity): number {
  if (count <= 0) return SLOT_MIN[gran];
  const livre = Math.max(0, available - PAD.l - PAD.r);
  const ideal = Math.floor(livre / count);
  return Math.min(SLOT_MAX[gran], Math.max(SLOT_MIN[gran], ideal));
}

/**
 * De quantos em quantos baldes desenhar o rótulo do eixo x, para que dois
 * rótulos nunca encostem. `labelWidth` é a largura do rótulo mais largo.
 */
export function labelStep(slot: number, labelWidth: number): number {
  return Math.max(1, Math.ceil(labelWidth / Math.max(1, slot)));
}

/**
 * Número de divisões do eixo y que faz o rótulo cair em valor redondo.
 *
 * Com 4 divisões fixas, um teto de 50 vira "0 · 13 · 25 · 38 · 50", que parece
 * erro de conta. Aqui a divisão é escolhida para o passo sempre cair inteiro.
 */
export function tickCount(top: number): number {
  if (!(top > 0)) return 4;
  // niceMax devolve 1, 2, 5 ou 10 vezes uma potência de dez, então 5 divisões
  // resolvem quase tudo em passo redondo (10 -> 2, 50 -> 10, 500 -> 100). Os
  // tetos 1 e 2, de eixo minúsculo, caem nas divisões menores.
  return [5, 4, 2, 1].find((n) => top % n === 0) ?? 1;
}

/**
 * Mede o elemento e devolve a largura. Sem ResizeObserver (jsdom, por exemplo)
 * fica no fallback, e o gráfico desenha no piso — nunca quebra.
 */
export function useMeasuredWidth<T extends HTMLElement>(fallback = 900) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width] as const;
}
