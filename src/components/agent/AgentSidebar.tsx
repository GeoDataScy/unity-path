import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { BookOpen, ClipboardList, GraduationCap, HandCoins, LineChart, PackageSearch, Send } from "lucide-react";

import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { title: "Comece por aqui", to: "/workspace/comece-aqui", icon: GraduationCap },
  { title: "Atendimentos", to: "/workspace", icon: ClipboardList },
  { title: "Pedidos em Espera", to: "/workspace/pedidos-espera", icon: PackageSearch },
  { title: "Reembolsos", to: "/workspace/reembolsos", icon: HandCoins },
  { title: "Transferências", to: "/workspace/transferencias", icon: Send },
  { title: "Minhas métricas", to: "/workspace/metricas", icon: LineChart },
  { title: "Base de Suporte", to: "/workspace/base-suporte", icon: BookOpen },
] as const;

export function AgentSidebar() {
  const location = useLocation();
  const { state } = useSidebar();

  const currentPath = location.pathname;
  const collapsed = state === "collapsed";

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

                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                      <NavLink to={item.to} end>
                        <Icon />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
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
