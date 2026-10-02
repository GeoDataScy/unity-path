import {
  BookOpen,
  ClipboardList,
  GraduationCap,
  HandCoins,
  LineChart,
  LogOut,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  Send,
} from "lucide-react";

import { Logo } from "@/components/brand/Logo";
import { SIDEBAR_ICON, SidebarNavItem } from "@/components/layout/SidebarNavItem";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRadarBadgeQuery } from "@/features/radar/useMyRadarQuery";
import { cn } from "@/lib/utils";

// Mesma estrutura das sidebars da gestora e do copy (feitas à mão, sem o
// `Sidebar` do shadcn): topo e rodapé presos, miolo rolável, item único
// `SidebarNavItem`. Antes esta era a única no shadcn, e recolhida ficava com
// outra largura, outro ícone e outro marcador de página ativa.

const NAV_ITEMS: { label: string; to: string; icon: React.ElementType; end?: boolean }[] = [
  { label: "Comece por aqui", to: "/workspace/comece-aqui", icon: GraduationCap },
  { label: "Atendimentos", to: "/workspace", icon: ClipboardList, end: true },
  { label: "Pedidos em Espera", to: "/workspace/pedidos-espera", icon: PackageSearch },
  { label: "Reembolsos", to: "/workspace/reembolsos", icon: HandCoins },
  { label: "Transferências", to: "/workspace/transferencias", icon: Send },
  { label: "Radar", to: "/workspace/radar", icon: Radar },
  { label: "Minhas métricas", to: "/workspace/metricas", icon: LineChart },
  { label: "Base de Suporte", to: "/workspace/base-suporte", icon: BookOpen },
];

const RADAR_PATH = "/workspace/radar";

type Props = {
  collapsed: boolean;
  onToggle: () => void;
  onLogout: () => void;
  fullName: string | null;
};

export function AgentSidebar({ collapsed, onToggle, onLogout, fullName }: Props) {
  // A sidebar fica montada em toda a área do agente, então este badge é o único
  // lugar onde uma pendência atrasada aparece sem o agente ir procurar. A
  // contagem é indexada e barata (my_radar_summary, Index Only Scan) e não tem
  // polling: o número atualiza por invalidação quando o agente registra algo.
  const badgeQuery = useRadarBadgeQuery(true);
  const overdue = badgeQuery.data?.overdue ?? 0;
  const dueToday = badgeQuery.data?.due_today ?? 0;
  // O que precisa de atenção HOJE. O total em aberto não serve de alerta: vira
  // paisagem e o agente para de olhar.
  const needsAttention = overdue + dueToday;
  const badgeTone =
    overdue > 0 ? "bg-destructive text-destructive-foreground" : "bg-status-open text-status-open-foreground";

  // Mesmo desenho do badge de Alertas da gestora: recolhida, bolha sobre o
  // ícone; aberta, pílula no fim da linha.
  const radarBadge =
    needsAttention > 0 ? (
      <span
        className={cn(
          "flex items-center justify-center rounded-full font-medium",
          collapsed
            ? "absolute -right-2 -top-1.5 h-4 min-w-[16px] px-1 text-[10px]"
            : "h-5 min-w-[20px] shrink-0 px-1.5 text-[11px]",
          badgeTone,
        )}
        aria-label={`${needsAttention} acompanhamentos para hoje`}
      >
        {collapsed && needsAttention > 9 ? "9+" : needsAttention}
      </span>
    ) : null;

  return (
    <aside
      className={cn(
        "hubi-sidebar sticky top-0 flex h-screen shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-[width] duration-200 ease-out",
        collapsed ? "w-16" : "w-[248px]",
      )}
    >
      <div className={cn("flex shrink-0 items-center", collapsed ? "flex-col gap-2 p-2" : "justify-between gap-1 p-4")}>
        <div className={cn("flex min-w-0 items-center gap-2", collapsed && "justify-center")}>
          {collapsed ? <Logo variant="mark" height={28} /> : <Logo height={20} />}
          {!collapsed && (
            <div className="leading-tight truncate">
              <div className="text-[13px] font-medium text-ink">Workspace</div>
              <div className="text-xs text-ink-tertiary">Atendimento</div>
            </div>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggle}
              aria-label={collapsed ? "Expandir menu lateral" : "Encolher menu lateral"}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-subtle hover:text-ink"
            >
              {collapsed ? <PanelLeftOpen className={SIDEBAR_ICON} /> : <PanelLeftClose className={SIDEBAR_ICON} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{collapsed ? "Expandir menu" : "Encolher menu"}</TooltipContent>
        </Tooltip>
      </div>

      {/* Miolo rolável: `min-h-0` deixa este flex item encolher em vez de
          empurrar o rodapé para fora numa tela baixa. */}
      <div
        className={cn(
          "sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
          collapsed ? "px-2 pb-3" : "px-4 pb-4",
        )}
      >
        <nav className="space-y-1" aria-label="Menu do workspace">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const showBadge = item.to === RADAR_PATH && needsAttention > 0;
            return (
              <SidebarNavItem
                key={item.to}
                to={item.to}
                end={item.end}
                icon={<Icon className={SIDEBAR_ICON} />}
                label={item.label}
                collapsed={collapsed}
                badge={showBadge ? radarBadge : undefined}
              />
            );
          })}
        </nav>
      </div>

      {/* Rodapé preso: o Sair não depende de o menu caber na tela. */}
      <div className={cn("shrink-0 border-t border-sidebar-border", collapsed ? "space-y-1 p-2" : "space-y-2 p-4")}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onLogout}
                aria-label="Sair"
                className="mx-auto flex h-9 w-9 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-subtle hover:text-ink"
              >
                <LogOut className={SIDEBAR_ICON} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Sair</TooltipContent>
          </Tooltip>
        ) : (
          <>
            <Button onClick={onLogout} variant="outline" className="w-full">
              <LogOut className={SIDEBAR_ICON} />
              Sair
            </Button>
            {fullName && <div className="truncate px-1 text-[11px] text-ink-tertiary">Logado como {fullName}</div>}
          </>
        )}
      </div>
    </aside>
  );
}
