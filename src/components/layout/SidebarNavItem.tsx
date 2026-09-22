import { NavLink, useMatch } from "react-router-dom";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Item de navegação das barras laterais escuras (gestora, copy e produtos).
// Estava duplicado nos três layouts, com o mesmo bug em cada cópia.

/**
 * Métrica única dos ícones da sidebar. 18px num slot de 20px: 16px ficava
 * pequeno para a largura da barra e 20px pesa demais junto do texto de 14px.
 */
export const SIDEBAR_ICON = "h-[18px] w-[18px]";
export const SIDEBAR_ICON_SLOT = "h-5 w-5";

type Props = {
  to: string;
  end?: boolean;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  badge?: React.ReactNode;
  /**
   * Outra rota que também marca este item — para abas da mesma área que moram
   * fora do caminho do link (ex.: "Atendimentos" aponta para /dashboard com
   * `end`, mas a aba Visão Geral é /dashboard/visao-geral).
   */
  matchAlso?: string;
  /** Extra do chamador — hoje só a Lya usa, para o contorno neon. */
  className?: string;
};

export function SidebarNavItem({ to, end, icon, label, collapsed, badge, matchAlso, className }: Props) {
  // `isActive` sai daqui, e não da forma de função do `className` do NavLink:
  // recolhido, o item entra num `TooltipTrigger asChild`, e o Slot do Radix
  // serializa a função para dentro do atributo `class` — o item ficava
  // literalmente sem estilo, sem centralizar e sem marcar a página atual.
  // Padrão que nunca casa quando não há rota irmã: `useMatch` é hook e precisa
  // ser chamado sempre, na mesma ordem.
  const isAlsoActive = Boolean(useMatch({ path: matchAlso ?? "/__sem_rota_irma__", end: false }));
  const isActive = Boolean(useMatch({ path: to, end: Boolean(end) })) || isAlsoActive;

  const content = (
    <NavLink
      to={to}
      end={end}
      className={cn(
        "flex h-9 items-center rounded-lg text-sm transition-colors hover:bg-white/10",
        collapsed ? "mx-auto w-9 justify-center" : "gap-2.5 px-3",
        isActive && "bg-white/15 font-medium",
        className,
      )}
    >
      {/* O slot precisa ser uma caixa de verdade (inline-flex com tamanho): é
          ele que centraliza o ícone e ancora o badge. Como `span` inline a
          âncora tem largura zero e o badge escapa para a borda da sidebar. */}
      <span className={cn("relative inline-flex shrink-0 items-center justify-center", SIDEBAR_ICON_SLOT)}>
        {icon}
        {collapsed && badge}
      </span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && badge}
    </NavLink>
  );

  if (!collapsed) return content;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
