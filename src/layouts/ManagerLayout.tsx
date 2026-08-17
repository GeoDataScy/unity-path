import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { DateRange } from "react-day-picker";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentsQuery } from "@/features/dashboard/useAgentsQuery";
import logo from "@/assets/logo-xmx.png";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  FileSpreadsheet,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCcw,
  Users,
} from "lucide-react";
import { useDashboardRefundAlertsQuery } from "@/features/dashboard/useDashboardRefundAlertsQuery";
import { ManagerRefundNotification } from "@/features/dashboard/ManagerRefundNotification";
import { ManagerApprovalsBell } from "@/features/takeovers/ManagerApprovalsBell";
import { exportManagerReport } from "@/lib/reportExport";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useToast } from "@/hooks/use-toast";
import { getMeStatus, recordAuthEvent, sendHeartbeat } from "@/lib/userSession";
import { homePathForRole } from "@/lib/roles";

const SIDEBAR_COLLAPSED_KEY = "manager-sidebar-collapsed";

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type ManagerOutletContext = {
  fullName: string | null;
  range: DateRange | undefined;
  setRange: (next: DateRange | undefined) => void;
  agentId: string;
  setAgentId: (next: string) => void;
  fromISO: string;
  toISO: string;
};

type NavItemProps = {
  to: string;
  end?: boolean;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  badge?: React.ReactNode;
};

function NavItem({ to, end, icon, label, collapsed, badge }: NavItemProps) {
  const content = (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-md text-sm bg-white/0 hover:bg-white/10 transition",
          collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
          isActive && "bg-white/15",
        )
      }
    >
      <span className="relative">
        {icon}
        {collapsed && badge}
      </span>
      {!collapsed && <span className="flex-1">{label}</span>}
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

export default function ManagerLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const [authLoading, setAuthLoading] = useState(true);
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

      if (profile?.role !== "manager") {
        navigate(homePathForRole(profile?.role), { replace: true });
        return;
      }

      if (!active) return;
      setFullName(profile?.role === "manager" ? "Ester" : (profile?.full_name ?? null));
      setCanApproveTakeovers(Boolean(profile?.can_approve_takeovers));
      setAuthLoading(false);
    };

    checkAuth();

    const handleBlockedOrSignedOut = async (target: "login" | "blocked") => {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("sb-")) localStorage.removeItem(key);
      }
      navigate(target === "blocked" ? "/blocked" : "/login", { replace: true });
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "SIGNED_OUT" || !session) {
        handleBlockedOrSignedOut("login");
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

  const agentsQuery = useAgentsQuery(!authLoading);
  const alertsQuery = useDashboardRefundAlertsQuery();

  const outletContext = useMemo<ManagerOutletContext | null>(() => {
    if (authLoading) return null;
    return { fullName, range, setRange, agentId, setAgentId, fromISO, toISO };
  }, [authLoading, fullName, range, agentId, fromISO, toISO]);

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
  const overdueCount = alertsQuery.data?.total_overdue ?? 0;

  const alertsBadge = overdueCount > 0 ? (
    collapsed ? (
      <span className="absolute -right-1 -top-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold min-w-[16px] h-4 flex items-center justify-center px-1">
        {overdueCount > 9 ? "9+" : overdueCount}
      </span>
    ) : (
      <span className="rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold min-w-[20px] h-5 flex items-center justify-center px-1.5">
        {overdueCount}
      </span>
    )
  ) : null;

  return (
    <div className="min-h-screen flex">
      <aside
        className={cn(
          "shrink-0 sticky top-0 h-screen bg-dashboard-sidebar text-dashboard-sidebar-foreground border-r border-white/10 transition-[width] duration-200 ease-out",
          collapsed ? "w-16" : "w-[260px]",
        )}
      >
        <div className={cn("h-full flex flex-col gap-6", collapsed ? "p-2" : "p-4")}>
          <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "justify-between gap-2")}>
            <div className={cn("flex items-center gap-3 min-w-0", collapsed && "justify-center")}>
              <img src={logo} alt="Logo da empresa" className="h-8 w-auto shrink-0" loading="lazy" />
              {!collapsed && (
                <div className="leading-tight truncate">
                  <div className="text-sm font-semibold">Painel da Gestora</div>
                  <div className="text-xs opacity-80">Analytics</div>
                </div>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCollapsed((v) => !v)}
                  aria-label={collapsed ? "Expandir menu lateral" : "Encolher menu lateral"}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/0 hover:bg-white/10 transition shrink-0"
                >
                  {collapsed ? (
                    <PanelLeftOpen className="h-4 w-4" />
                  ) : (
                    <PanelLeftClose className="h-4 w-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {collapsed ? "Expandir menu" : "Encolher menu"}
              </TooltipContent>
            </Tooltip>
          </div>

          <nav className={cn(collapsed ? "space-y-1" : "space-y-2")}>
            <NavItem
              to="/dashboard"
              end
              icon={<BarChart3 className="h-4 w-4" />}
              label="Atendimentos"
              collapsed={collapsed}
            />
            <NavItem
              to="/dashboard/reembolsos"
              icon={<RefreshCcw className="h-4 w-4" />}
              label="Reembolsos"
              collapsed={collapsed}
            />
            <NavItem
              to="/dashboard/acompanhamento"
              icon={<ClipboardCheck className="h-4 w-4" />}
              label="Acompanhamento"
              collapsed={collapsed}
            />
            <NavItem
              to="/dashboard/interacoes"
              icon={<Activity className="h-4 w-4" />}
              label="Interacoes"
              collapsed={collapsed}
            />
            <NavItem
              to="/dashboard/alertas"
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Alertas"
              collapsed={collapsed}
              badge={alertsBadge}
            />
            <NavItem
              to="/dashboard/usuarios"
              icon={<Users className="h-4 w-4" />}
              label="Usuários"
              collapsed={collapsed}
            />
          </nav>

          {!collapsed && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide opacity-80">Período</div>
                <DateRangePicker value={range} onChange={setRange} />
                <div className="text-[11px] opacity-75">Default: mês atual até hoje</div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide opacity-80">Agente</div>
                <Select value={agentId} onValueChange={setAgentId}>
                  <SelectTrigger className="w-full bg-white/10 border-white/15 text-dashboard-sidebar-foreground">
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

          <div className={cn("mt-auto", collapsed ? "space-y-1" : "space-y-2")}>
            {collapsed ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleExportReport}
                      disabled={exporting}
                      aria-label={exporting ? "Extraindo relatório" : "Extrair relatório"}
                      className="inline-flex h-9 w-full items-center justify-center rounded-md bg-white/10 text-dashboard-sidebar-foreground hover:bg-white/15 transition disabled:opacity-60"
                    >
                      <FileSpreadsheet className={cn("h-4 w-4", exporting && "animate-pulse")} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {exporting ? "Extraindo..." : "Extrair relatório"}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleLogout}
                      aria-label="Sair"
                      className="inline-flex h-9 w-full items-center justify-center rounded-md bg-white/10 text-dashboard-sidebar-foreground hover:bg-white/15 transition"
                    >
                      <LogOut className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Sair</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <>
                <Button
                  onClick={handleExportReport}
                  disabled={exporting}
                  variant="secondary"
                  className="w-full bg-white/10 text-dashboard-sidebar-foreground hover:bg-white/15"
                >
                  <FileSpreadsheet className={cn("h-4 w-4", exporting && "animate-pulse")} />
                  {exporting ? "Extraindo..." : "Extrair Relatório"}
                </Button>

                <Button
                  onClick={handleLogout}
                  variant="secondary"
                  className="w-full bg-white/10 text-dashboard-sidebar-foreground hover:bg-white/15"
                >
                  Logout
                </Button>

                <div className="text-[11px] opacity-70 px-1">
                  {isOnAlertas ? "Visualizando: Alertas" : isOnInteracoes ? "Visualizando: Interacoes" : isOnAcompanhamento ? "Visualizando: Acompanhamento" : isOnRefunds ? "Visualizando: Reembolsos" : "Visualizando: Atendimentos"}
                </div>
              </>
            )}
          </div>
        </div>
      </aside>

      <ManagerRefundNotification />

      <ManagerApprovalsBell enabled={canApproveTakeovers} />

      <ThemeToggle
        variant="ghost"
        className="fixed top-4 right-4 z-50 h-9 w-9 text-foreground/70 hover:text-foreground hover:bg-foreground/5"
      />

      <main className="flex-1 bg-dashboard-surface p-8">
        <div className="mx-auto max-w-7xl">
          <Outlet context={outletContext} />
        </div>
      </main>
    </div>
  );
}
