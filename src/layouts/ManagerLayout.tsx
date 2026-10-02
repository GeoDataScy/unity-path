import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import type { DateRange } from "react-day-picker";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentsQuery } from "@/features/dashboard/useAgentsQuery";
import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  ClipboardCheck,
  FileSpreadsheet,
  Headset,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCcw,
  Table2,
  Users,
  Brain,
} from "lucide-react";
import { useDashboardRefundAlertsQuery } from "@/features/dashboard/useDashboardRefundAlertsQuery";
import { ManagerRefundNotification } from "@/features/dashboard/ManagerRefundNotification";
import { ManagerApprovalsBell } from "@/features/takeovers/ManagerApprovalsBell";
import { ManagerInactiveAlertsBell } from "@/features/held-orders/ManagerInactiveAlertsBell";
import { exportManagerReport } from "@/lib/reportExport";
import { useToast } from "@/hooks/use-toast";
import { getMeStatus, recordAuthEvent, sendHeartbeat } from "@/lib/userSession";
import { createSessionExit } from "@/lib/sessionExit";
import { canAccessArea, homePathForRole } from "@/lib/roles";
import { AreaSwitcher } from "@/components/layout/AreaSwitcher";
import { TopBar } from "@/components/layout/TopBar";
import { SettingsDialog } from "@/components/layout/SettingsDialog";
import { useSidebarTone } from "@/lib/sidebarTone";
import { SIDEBAR_ICON, SidebarNavItem } from "@/components/layout/SidebarNavItem";
import { LyaMark } from "@/features/lya/components/LyaMark";
import { LyaWidget } from "@/features/lya/components/LyaWidget";
import type { LyaContexto } from "@/features/lya/types";

const SIDEBAR_COLLAPSED_KEY = "manager-sidebar-collapsed";

// Páginas desta área que são de gestão, não de análise: escrevem no banco
// (dar baixa em reembolso, ativar/desativar usuário, editar a Base de Suporte)
// e continuam guardadas por is_manager() no Postgres. Desde 02/10/2026 só a
// gestora entra nesta área (copy e produtos ficam cada um na sua); o corte
// abaixo continua como segunda barreira, caso outra role volte a ler analytics.
const MANAGER_ONLY_PATHS = ["/dashboard/alertas", "/dashboard/usuarios", "/dashboard/base", "/dashboard/lya/cerebro", "/dashboard/lya/arquivos"];

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type ManagerOutletContext = {
  fullName: string | null;
  /** profiles.role de quem está logado (hoje, só manager entra nesta área). */
  role: string | null;
  range: DateRange | undefined;
  setRange: (next: DateRange | undefined) => void;
  agentId: string;
  setAgentId: (next: string) => void;
  fromISO: string;
  toISO: string;
};

export default function ManagerLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const [authLoading, setAuthLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [canApproveTakeovers, setCanApproveTakeovers] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const [sidebarTone, setSidebarTone] = useSidebarTone(userId);

  // Default: 1st of current month → today
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = now;
    return { from, to };
  });
  const [agentId, setAgentId] = useState<string>("all");

  const fromISO = useMemo(() => {
    const d = range?.from;
    if (d) return toISODate(d);
    const now = new Date();
    return toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  }, [range?.from]);

  const toISO = useMemo(() => {
    const d = range?.to ?? range?.from;
    return d ? toISODate(d) : toISODate(new Date());
  }, [range?.to, range?.from]);

  useEffect(() => {
    let active = true;

    const checkAuth = async () => {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error || !session) {
        if (error) await supabase.auth.signOut({ scope: "local" });
        navigate("/login", { replace: true });
        return;
      }

      try {
        const status = await getMeStatus();
        if (!status.is_active) {
          await supabase.auth.signOut({ scope: "local" });
          navigate("/blocked", { replace: true });
          return;
        }
      } catch {
        // me_status failed (network) — fall through; profile check below still gates access.
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, full_name, can_approve_takeovers")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profileError) {
        await supabase.auth.signOut({ scope: "local" });
        navigate("/login", { replace: true });
        return;
      }

      if (!canAccessArea(profile?.role, "analytics")) {
        navigate(homePathForRole(profile?.role), { replace: true });
        return;
      }

      if (!active) return;
      setUserId(session.user.id);
      setRole(profile?.role ?? null);
      setFullName(profile?.full_name ?? null);
      setCanApproveTakeovers(Boolean(profile?.can_approve_takeovers));
      setAuthLoading(false);
    };

    checkAuth();

    // Sai uma vez só; ver src/lib/sessionExit.ts (loop de signOut que congelava a aba).
    const sessionExit = createSessionExit(supabase.auth, (target) =>
      navigate(target === "blocked" ? "/blocked" : "/login", { replace: true }),
    );
    const handleBlockedOrSignedOut = (target: "login" | "blocked") =>
      sessionExit.exit(target, { signOut: true });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "SIGNED_OUT" || !session) {
        // A sessão já foi removida: chamar signOut aqui reemitia SIGNED_OUT em loop.
        sessionExit.exit("login", { signOut: false });
      }
    });

    const revalidate = async () => {
      if (!active) return;
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (!active) return;
      if (error || !user) {
        handleBlockedOrSignedOut("login");
        return;
      }
      try {
        const status = await getMeStatus();
        if (!active) return;
        if (!status.is_active) {
          await recordAuthEvent("force_logout", { reason: status.reason }).catch(() => {});
          handleBlockedOrSignedOut("blocked");
          return;
        }
      } catch {
        // ignore — transient errors should not log the user out
      }
      sendHeartbeat().catch(() => {});
    };

    sendHeartbeat().catch(() => {});

    const intervalId = window.setInterval(revalidate, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", revalidate);

    return () => {
      active = false;
      subscription.unsubscribe();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", revalidate);
    };
  }, [navigate]);

  // Ações de gestão só para a gestora — defesa extra, já que hoje só ela entra.
  const isManager = role === "manager";

  const agentsQuery = useAgentsQuery(!authLoading);
  const alertsQuery = useDashboardRefundAlertsQuery(!authLoading && isManager);

  // Acesso direto por URL a uma rota de gestão sem ser gestora: volta ao topo.
  useEffect(() => {
    if (authLoading || isManager) return;
    if (MANAGER_ONLY_PATHS.some((p) => location.pathname.startsWith(p))) {
      navigate("/dashboard", { replace: true });
    }
  }, [authLoading, isManager, location.pathname, navigate]);

  const outletContext = useMemo<ManagerOutletContext | null>(() => {
    if (authLoading) return null;
    return { fullName, role, range, setRange, agentId, setAgentId, fromISO, toISO };
  }, [authLoading, fullName, role, range, agentId, fromISO, toISO]);

  // Contexto que a Lya recebe junto com cada pergunta feita pelo balão.
  const lyaContexto = useMemo<LyaContexto>(() => {
    const agente = (agentsQuery.data ?? []).find((a) => a.id === agentId);
    return {
      de: fromISO,
      ate: toISO,
      agente_id: agentId === "all" ? null : agentId,
      agente_nome: agente?.label ?? null,
      usuario_nome: fullName,
      usuario_role: role,
      tela: location.pathname,
    };
  }, [agentsQuery.data, agentId, fromISO, toISO, fullName, role, location.pathname]);

  const handleExportReport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const agentName = (agentsQuery.data ?? []).find((a) => a.id === agentId)?.label;
      await exportManagerReport(fromISO, toISO, agentId, agentName);
    } catch (error) {
      console.error("[export-report] failed:", error);
      const message =
        error instanceof Error ? error.message : "Não foi possível gerar o relatório.";
      toast({
        title: "Erro ao extrair relatório",
        description: message,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const handleLogout = async () => {
    await recordAuthEvent("logout").catch(() => {});
    // Limpa tokens do Supabase diretamente — evita 403 se sessão já expirou no servidor
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("sb-")) localStorage.removeItem(key);
    }
    window.location.href = "/login";
  };

  if (authLoading || !outletContext) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  const isOnRefunds = location.pathname.startsWith("/dashboard/reembolsos");
  const isOnAcompanhamento = location.pathname.startsWith("/dashboard/acompanhamento");
  const isOnInteracoes = location.pathname.startsWith("/dashboard/interacoes");
  const isOnAlertas = location.pathname.startsWith("/dashboard/alertas");
  const isOnZendesk = location.pathname.startsWith("/dashboard/zendesk");
  const overdueCount = alertsQuery.data?.total_overdue ?? 0;

  const alertsBadge = overdueCount > 0 ? (
    collapsed ? (
      <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
        {overdueCount > 9 ? "9+" : overdueCount}
      </span>
    ) : (
      <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-medium text-destructive-foreground">
        {overdueCount}
      </span>
    )
  ) : null;

  return (
    <div className="min-h-screen flex">
      {/* A sidebar tem altura fixa de viewport e três zonas: topo e rodapé
          presos, miolo rolável. Antes era uma coluna só, então numa tela baixa
          o Logout simplesmente saía por baixo da janela. */}
      <aside
        data-tone={sidebarTone}
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
                <div className="text-[13px] font-medium text-ink">
                  {isManager ? "Painel da Gestora" : "Data Analytics"}
                </div>
                <div className="text-xs text-ink-tertiary">{isManager ? "Analytics" : "Suporte"}</div>
              </div>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCollapsed((v) => !v)}
                aria-label={collapsed ? "Expandir menu lateral" : "Encolher menu lateral"}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-subtle hover:text-ink"
              >
                {collapsed ? <PanelLeftOpen className={SIDEBAR_ICON} /> : <PanelLeftClose className={SIDEBAR_ICON} />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? "Expandir menu" : "Encolher menu"}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Miolo rolável: são onze itens de menu mais os filtros, e não cabem
            em tela baixa. `min-h-0` é o que deixa este flex item encolher em
            vez de empurrar o rodapé para fora. */}
        <div
          className={cn(
            "sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
            collapsed ? "space-y-3 px-2 pb-3" : "space-y-5 px-4 pb-4",
          )}
        >
          <AreaSwitcher role={role} currentArea="analytics" collapsed={collapsed} />

          <nav className={cn(collapsed ? "space-y-1" : "space-y-1")}>
            <SidebarNavItem
              to="/dashboard"
              end
              matchAlso="/dashboard/visao-geral"
              icon={<BarChart3 className={SIDEBAR_ICON} />}
              label="Atendimentos"
              collapsed={collapsed}
            />
            <SidebarNavItem
              to="/dashboard/reembolsos"
              icon={<RefreshCcw className={SIDEBAR_ICON} />}
              label="Reembolsos"
              collapsed={collapsed}
            />
            <SidebarNavItem
              to="/dashboard/acompanhamento"
              icon={<ClipboardCheck className={SIDEBAR_ICON} />}
              label="Acompanhamento"
              collapsed={collapsed}
            />
            <SidebarNavItem
              to="/dashboard/interacoes"
              icon={<Activity className={SIDEBAR_ICON} />}
              label="Interacoes"
              collapsed={collapsed}
            />
            <SidebarNavItem
              to="/dashboard/lya"
              end
              // A marca da Lya no lugar do ícone genérico. Abaixo de 24px ela
              // congela sozinha: movimento minúsculo na sidebar é ruído.
              icon={<LyaMark size={18} label={null} />}
              label="Lya"
              collapsed={collapsed}
            />
            {isManager && (
              <>
                <SidebarNavItem
                  to="/dashboard/alertas"
                  icon={<AlertTriangle className={SIDEBAR_ICON} />}
                  label="Alertas"
                  collapsed={collapsed}
                  badge={alertsBadge}
                />
                <SidebarNavItem
                  to="/dashboard/usuarios"
                  icon={<Users className={SIDEBAR_ICON} />}
                  label="Usuários"
                  collapsed={collapsed}
                />
                <SidebarNavItem
                  to="/dashboard/base"
                  icon={<BookOpen className={SIDEBAR_ICON} />}
                  label="Base de Suporte"
                  collapsed={collapsed}
                />
                <SidebarNavItem
                  to="/dashboard/zendesk"
                  icon={<Headset className={SIDEBAR_ICON} />}
                  label="Zendesk"
                  collapsed={collapsed}
                />
                <SidebarNavItem
                  to="/dashboard/lya/cerebro"
                  icon={<Brain className={SIDEBAR_ICON} />}
                  label="Cérebro da Lya"
                  collapsed={collapsed}
                />
                <SidebarNavItem
                  to="/dashboard/lya/arquivos"
                  icon={<Table2 className={SIDEBAR_ICON} />}
                  label="Arquivos da Lya"
                  collapsed={collapsed}
                />
              </>
            )}
          </nav>

          {!collapsed && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">Período</div>
                <DateRangePicker value={range} onChange={setRange} className="px-3" />
                <div className="text-[11px] text-ink-tertiary">Default: mês atual até hoje</div>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">Agente</div>
                <Select value={agentId} onValueChange={setAgentId}>
                  <SelectTrigger className="w-full text-ink">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent className="z-50">
                    <SelectItem value="all">Todos</SelectItem>
                    {(agentsQuery.data ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé preso: Extrair Relatório e Logout não podem depender de o
            menu caber na tela. A borda separa do conteúdo que rola por baixo. */}
        <div
          className={cn(
            "shrink-0 border-t border-sidebar-border",
            collapsed ? "space-y-1 p-2" : "space-y-2 p-4",
          )}
        >
          {collapsed ? (
              <>
                {isManager && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={handleExportReport}
                        disabled={exporting}
                        aria-label={exporting ? "Extraindo relatório" : "Extrair relatório"}
                        className="mx-auto flex h-9 w-9 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-subtle hover:text-ink disabled:opacity-60"
                      >
                        <FileSpreadsheet className={cn(SIDEBAR_ICON, exporting && "animate-pulse")} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {exporting ? "Extraindo..." : "Extrair relatório"}
                    </TooltipContent>
                  </Tooltip>
                )}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleLogout}
                      aria-label="Sair"
                      className="mx-auto flex h-9 w-9 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-subtle hover:text-ink"
                    >
                      <LogOut className={SIDEBAR_ICON} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Sair</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <>
                {isManager && (
                  <Button
                    onClick={handleExportReport}
                    disabled={exporting}
                    variant="outline"
                    className="w-full"
                  >
                    <FileSpreadsheet className={cn(SIDEBAR_ICON, exporting && "animate-pulse")} />
                    {exporting ? "Extraindo..." : "Extrair Relatório"}
                  </Button>
                )}

                <Button
                  onClick={handleLogout}
                  variant="outline"
                  className="w-full"
                >
                  Logout
                </Button>

                <div className="text-[11px] text-ink-tertiary px-1">
                  {isOnZendesk ? "Visualizando: Zendesk" : isOnAlertas ? "Visualizando: Alertas" : isOnInteracoes ? "Visualizando: Interacoes" : isOnAcompanhamento ? "Visualizando: Acompanhamento" : isOnRefunds ? "Visualizando: Reembolsos" : "Visualizando: Atendimentos"}
                </div>
              </>
          )}
        </div>
      </aside>

      {isManager && <ManagerRefundNotification />}

      <LyaWidget contexto={lyaContexto} />

      <div className="flex min-w-0 flex-1 flex-col bg-dashboard-surface">
        <TopBar>
          <ManagerApprovalsBell enabled={isManager && canApproveTakeovers} />
          <ManagerInactiveAlertsBell enabled={isManager} />
          <SettingsDialog
            fullName={fullName}
            tone={sidebarTone}
            onToneChange={setSidebarTone}
            className="text-ink-secondary hover:text-ink"
          />
        </TopBar>
        <main className="flex-1 p-8">
          <div className="mx-auto max-w-7xl">
            <Outlet context={outletContext} />
          </div>
        </main>
      </div>
    </div>
  );
}
