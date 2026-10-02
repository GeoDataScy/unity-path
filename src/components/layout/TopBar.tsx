import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/ui/theme-toggle";

type Props = {
  /** Controles extras à esquerda do tema (ex.: sinos de notificação). */
  children?: ReactNode;
};

/**
 * Faixa de topo das quatro áreas, com os controles de canto de tela (tema e
 * notificações). Eles moravam soltos com `fixed top-4 right-4` e flutuavam por
 * cima do conteúdo — o seletor de ambiente do Late Hunter, botões no canto dos
 * cabeçalhos das páginas. Numa faixa própria, ocupam um lugar no fluxo e nada
 * na página pode ficar embaixo deles.
 */
export function TopBar({ children }: Props) {
  return (
    <header className="border-b border-line bg-canvas text-ink">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-end gap-2 px-4">
        {children}
        <ThemeToggle variant="ghost" className="text-ink-secondary hover:text-ink" />
      </div>
    </header>
  );
}
