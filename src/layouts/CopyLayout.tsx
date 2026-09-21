import { useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import type { DateRange } from "react-day-picker";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import logo from "@/assets/logo-xmx.png";
import { cn } from "@/lib/utils";
import { canAccessArea, homePathForRole } from "@/lib/roles";
import { AreaSwitcher } from "@/components/layout/AreaSwitcher";
import { SIDEBAR_ICON, SidebarNavItem } from "@/components/layout/SidebarNavItem";
import { getMeStatus, recordAuthEvent, sendHeartbeat } from "@/lib/userSession";
import { LogOut, MessageSquareQuote, PanelLeftClose, PanelLeftOpen } from "lucide-react";

const SIDEBAR_COLLAPSED_KEY = "copy-sidebar-collapsed";

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type CopyOutletContext = {
  userId: string;
  fullName: string | null;
  range: DateRange | undefined;
  setRange: (next: DateRange | undefined) => void;
  fromISO: string;
  toISO: string;
};

const NAV_ITEMS = [
  { to: "/copy", end: true, icon: MessageSquareQuote, label: "Motivos de reembolso" },
] as const;

export default function CopyLayout() {
  const navigate = useNavigate();

  const [authLoading, setAuthLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });

  // Padrão: últimos 90 dias. Diferente do painel da gestora (que abre no mês
  // corrente) de propósito — a leitura do copy é de tendência de motivo, e um
  // mês recém-começado deixaria a evolução mês a mês com um único ponto.
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 89);
    return { from, to };
  });

  const fromISO = useMemo(() => {
    const d = range?.from;
    if (d) return toISODate(d);
    const now = new Date();
    return toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89));
  }, [range?.from]);

  const toISO = useMemo(() => {
    const d = range?.to ?? range?.from;
    return d ? toISODate(d) : toISODate(new Date());
  }, [range?.to, range?.from]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

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
        // me_status falhou (rede) — segue; o perfil abaixo ainda barra o acesso.
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profileError) {
        await supabase.auth.signOut({ scope: "local" });
        navigate("/login", { replace: true });
        return;
      }

      if (!canAccessArea(profile?.role, "copy")) {
        navigate(homePathForRole(profile?.role), { replace: true });
        return;
      }

      if (!active) return;
      setUserId(session.user.id);
      setRole(profile?.role ?? null);
      setFullName(profile?.full_name ?? null);
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
        // ignora — erro transitório não pode deslogar o usuário
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

  const outletContext = useMemo<CopyOutletContext | null>(() => {
    if (authLoading || !userId) return null;
    return { userId, fullName, range, setRange, fromISO, toISO };
  }, [authLoading, userId, fullName, range, fromISO, toISO]);

  const handleLogout = async () => {
    await recordAuthEvent("logout").catch(() => {});
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

  return (
    <div className="min-h-screen flex">
      <aside
        className={cn(
          "sticky top-0 flex h-screen shrink-0 flex-col bg-dashboard-sidebar text-dashboard-sidebar-foreground border-r border-white/10 transition-[width] duration-200 ease-out",
          collapsed ? "w-16" : "w-[260px]",
        )}
      >
        <div className={cn("flex shrink-0 items-center", collapsed ? "flex-col gap-2 p-2" : "justify-between gap-1 p-4")}>
          <div className={cn("flex min-w-0 items-center gap-2", collapsed && "justify-center")}>
            <img src={logo} alt="Logo da empresa" className="h-7 w-auto shrink-0" loading="lazy" />
              {!collapsed && (
                <div className="leading-tight truncate">
                  <div className="text-[13px] font-semibold">Painel do Copy</div>
                  <div className="text-xs opacity-80">Conteúdo</div>
                </div>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCollapsed((v) => !v)}
                  aria-label={collapsed ? "Expandir menu lateral" : "Encolher menu lateral"}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                >
                  {collapsed ? <PanelLeftOpen className={SIDEBAR_ICON} /> : <PanelLeftClose className={SIDEBAR_ICON} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{collapsed ? "Expandir menu" : "Encolher menu"}</TooltipContent>
            </Tooltip>
        </div>

        {/* Miolo rolável: o menu e os filtros não podem empurrar o rodapé para
            fora da janela numa tela baixa. `min-h-0` é o que deixa este flex
            item encolher em vez de estourar. */}
        <div
          className={cn(
            "sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
            collapsed ? "space-y-3 px-2 pb-3" : "space-y-5 px-4 pb-4",
          )}
        >
          <AreaSwitcher role={role} currentArea="copy" collapsed={collapsed} />

          {!collapsed && (
            <div className="space-y-1.5">
              <p className="px-1 text-[11px] uppercase tracking-wide opacity-70">Período</p>
              <DateRangePicker value={range} onChange={setRange} className="px-3" />
            </div>
          )}

          <nav className={cn(collapsed ? "space-y-1" : "space-y-2")}>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <SidebarNavItem
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  icon={<Icon className={SIDEBAR_ICON} />}
                  label={item.label}
                  collapsed={collapsed}
                />
              );
            })}
          </nav>

        </div>

        {/* Rodapé preso: o Sair não depende de o menu caber na tela. */}
        <div className={cn("shrink-0 border-t border-white/10", collapsed ? "space-y-1 p-2" : "space-y-2 p-4")}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleLogout}
                    aria-label="Sair"
                    className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-dashboard-sidebar-foreground transition-colors hover:bg-white/15"
                  >
                    <LogOut className={SIDEBAR_ICON} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Sair</TooltipContent>
              </Tooltip>
            ) : (
              <>
                <Button
                  onClick={handleLogout}
                  variant="secondary"
                  className="w-full bg-white/10 text-dashboard-sidebar-foreground hover:bg-white/15"
                >
                  <LogOut className={SIDEBAR_ICON} />
                  Sair
                </Button>

                {fullName && <div className="text-[11px] opacity-70 px-1 truncate">Logado como {fullName}</div>}
              </>
          )}
        </div>
      </aside>

      <ThemeToggle
        variant="ghost"
        className="fixed top-4 right-4 z-50 h-9 w-9 text-foreground/70 hover:text-foreground hover:bg-foreground/5"
      />

      {/* Sem padding/max-width aqui: cada página do copy define o seu container. */}
      <main className="min-w-0 flex-1 bg-dashboard-surface">
        <Outlet context={outletContext} />
      </main>
    </div>
  );
}
