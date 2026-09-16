import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import logo from "@/assets/logo-xmx.png";
import { cn } from "@/lib/utils";
import { canAccessArea, homePathForRole } from "@/lib/roles";
import { AreaSwitcher } from "@/components/layout/AreaSwitcher";
import { getMeStatus, recordAuthEvent, sendHeartbeat } from "@/lib/userSession";
import { LogOut, PackageSearch, PanelLeftClose, PanelLeftOpen } from "lucide-react";

const SIDEBAR_COLLAPSED_KEY = "produtos-sidebar-collapsed";

export type ProdutosOutletContext = {
  userId: string;
  fullName: string | null;
};

const NAV_ITEMS = [
  { to: "/produtos", end: true, icon: PackageSearch, label: "Pedidos em espera" },
] as const;

type NavItemProps = {
  to: string;
  end?: boolean;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
};

function NavItem({ to, end, icon, label, collapsed }: NavItemProps) {
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
      <span className="relative">{icon}</span>
      {!collapsed && <span className="flex-1">{label}</span>}
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

export default function ProdutosLayout() {
  const navigate = useNavigate();

  const [authLoading, setAuthLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });

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

      if (!canAccessArea(profile?.role, "produtos")) {
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

  const outletContext = useMemo<ProdutosOutletContext | null>(() => {
    if (authLoading || !userId) return null;
    return { userId, fullName };
  }, [authLoading, userId, fullName]);

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
                  <div className="text-sm font-semibold">Painel de Produtos</div>
                  <div className="text-xs opacity-80">Produtos</div>
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
                  {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{collapsed ? "Expandir menu" : "Encolher menu"}</TooltipContent>
            </Tooltip>
          </div>

          <AreaSwitcher role={role} currentArea="produtos" collapsed={collapsed} />

          <nav className={cn(collapsed ? "space-y-1" : "space-y-2")}>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <NavItem
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  icon={<Icon className="h-4 w-4" />}
                  label={item.label}
                  collapsed={collapsed}
                />
              );
            })}
          </nav>

          <div className={cn("mt-auto", collapsed ? "space-y-1" : "space-y-2")}>
            {collapsed ? (
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
            ) : (
              <>
                <Button
                  onClick={handleLogout}
                  variant="secondary"
                  className="w-full bg-white/10 text-dashboard-sidebar-foreground hover:bg-white/15"
                >
                  <LogOut className="h-4 w-4" />
                  Sair
                </Button>

                {fullName && <div className="text-[11px] opacity-70 px-1 truncate">Logado como {fullName}</div>}
              </>
            )}
          </div>
        </div>
      </aside>

      <ThemeToggle
        variant="ghost"
        className="fixed top-4 right-4 z-50 h-9 w-9 text-foreground/70 hover:text-foreground hover:bg-foreground/5"
      />

      {/* Sem padding/max-width aqui: cada página de produtos define o seu container. */}
      <main className="min-w-0 flex-1 bg-dashboard-surface">
        <Outlet context={outletContext} />
      </main>
    </div>
  );
}
