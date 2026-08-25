import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { BookOpen, ClipboardList, GraduationCap, HandCoins, LineChart, PackageSearch, Radar, Send } from "lucide-react";

import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useRadarBadgeQuery } from "@/features/radar/useMyRadarQuery";

const items = [
  { title: "Comece por aqui", to: "/workspace/comece-aqui", icon: GraduationCap },
  { title: "Atendimentos", to: "/workspace", icon: ClipboardList },
  { title: "Pedidos em Espera", to: "/workspace/pedidos-espera", icon: PackageSearch },
  { title: "Reembolsos", to: "/workspace/reembolsos", icon: HandCoins },
  { title: "Transferências", to: "/workspace/transferencias", icon: Send },
  { title: "Radar", to: "/workspace/radar", icon: Radar },
  { title: "Minhas métricas", to: "/workspace/metricas", icon: LineChart },
  { title: "Base de Suporte", to: "/workspace/base-suporte", icon: BookOpen },
] as const;

const RADAR_PATH = "/workspace/radar";

export function AgentSidebar() {
  const location = useLocation();
  const { state } = useSidebar();

  const currentPath = location.pathname;
  const collapsed = state === "collapsed";

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

  const activeMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const item of items) {
      map.set(item.to, currentPath === item.to);
    }
    return map;
  }, [currentPath]);

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-white/10 [&_[data-sidebar=sidebar]]:bg-dashboard-sidebar [&_[data-sidebar=sidebar]]:text-dashboard-sidebar-foreground"
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/70">Painel</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const isActive = activeMap.get(item.to) ?? false;
                const Icon = item.icon;
                const showBadge = item.to === RADAR_PATH && needsAttention > 0;

                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={showBadge ? `${item.title} — ${needsAttention} para hoje` : item.title}
                    >
                      <NavLink to={item.to} end>
                        <span className="relative">
                          <Icon />
                          {/* Colapsada, a sidebar esconde o badge numérico; o ponto
                              mantém o alerta visível. */}
                          {showBadge && collapsed && (
                            <span
                              className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-1 ring-dashboard-sidebar ${
                                overdue > 0 ? "bg-destructive" : "bg-status-open"
                              }`}
                            />
                          )}
                        </span>
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                    {showBadge && (
                      <SidebarMenuBadge
                        className={
                          overdue > 0
                            ? "bg-destructive text-destructive-foreground"
                            : "bg-status-open text-status-open-foreground"
                        }
                        aria-label={`${needsAttention} acompanhamentos para hoje`}
                      >
                        {needsAttention}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
