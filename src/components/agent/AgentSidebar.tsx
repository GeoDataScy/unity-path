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
import { cn } from "@/lib/utils";

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
          <SidebarGroupLabel className="px-3 text-[10px] font-medium uppercase tracking-[0.12em] text-sidebar-foreground/40">
            Painel
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
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
                      className={cn(
                        "h-9 gap-3 rounded-lg font-normal text-sidebar-foreground/65",
                        "transition-colors duration-150",
                        // `--sidebar-accent` e branco puro: o padrao do shadcn pinta
                        // hover E ativo como uma pilula branca solida, que com oito
                        // itens vira uma parede. A hierarquia aqui e por opacidade.
                        "hover:bg-white/[0.06] hover:text-sidebar-foreground",
                        "data-[active=true]:bg-white/[0.10] data-[active=true]:font-medium",
                        "data-[active=true]:text-sidebar-foreground",
                        // Faixa fina a esquerda: marca o item atual sem tirar o olho
                        // do resto da lista.
                        "relative before:absolute before:left-0 before:top-1/2 before:h-0 before:w-[3px]",
                        "before:-translate-y-1/2 before:rounded-full before:bg-primary",
                        "before:transition-[height] before:duration-200 data-[active=true]:before:h-4",
                      )}
                    >
                      <NavLink to={item.to} end>
                        <span className="relative">
                          {/* strokeWidth 1.5: no padrao (2) um icone de 16px
                              fecha os proprios vaos e vira mancha. */}
                          <Icon
                            strokeWidth={1.5}
                            className={cn(
                              // `size-4` explicito: a regra do shadcn e
                              // `[&>svg]:size-4`, seletor de FILHO DIRETO do
                              // botao. Como o icone vive dentro do <span> que
                              // ancora o ponto de alerta, ela nao casa mais e o
                              // Lucide volta ao padrao de 24px.
                              "size-4 shrink-0 transition-colors",
                              isActive ? "text-primary" : "text-sidebar-foreground/45",
                            )}
                          />
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
                        className={cn(
                          // Menor e um grau abaixo da saturacao cheia: precisa
                          // ser notado, nao gritar em cima do rotulo.
                          "top-1/2 h-4 min-w-4 -translate-y-1/2 px-1 text-[10px] font-semibold",
                          "ring-1 ring-inset ring-white/15",
                          overdue > 0
                            ? "bg-destructive/85 text-destructive-foreground"
                            : "bg-status-open/90 text-status-open-foreground",
                        )}
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
