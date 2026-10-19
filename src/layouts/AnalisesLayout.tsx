import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { ArrowLeftRight, BarChart3, Database, LogOut, MessagesSquare } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";
import {
  AREA_CHOICE_PATH,
  AREA_PATH,
  AREA_SHORT_LABEL,
  LAST_AREA_KEY,
  areasForRole,
  canAccessArea,
  hasAreaChoice,
  homePathForRole,
  type AreaGrants,
} from "@/lib/roles";
import { getMeStatus, recordAuthEvent, sendHeartbeat } from "@/lib/userSession";
import { createSessionExit } from "@/lib/sessionExit";
import { fetchGeovaniAnalysesGrant } from "@/features/analises/geovaniAnalysesGrant";
import { JupyterMark } from "@/features/analises/components/JupyterMark";
import "@/features/analises/notebook.css";

// Área "Análises Geovani": notebooks do Geovani refletidos para leitura.
// A plumbing de sessão é a mesma de ProdutosLayout/CopyLayout (getSession,
// me_status a cada 30s + focus/visibilitychange, heartbeat). A diferença é o
// guard: o acesso não vem da role, só da flag can_view_geovani_analyses, lida
// numa consulta separada e tolerante (ver geovaniAnalysesGrant.ts).
// A casca troca a sidebar escura das outras áreas por abas de arquivo aberto,
// como no Jupyter — são só três seções, e a navegação cabe numa linha.

export type AnalisesOutletContext = {
  userId: string;
  fullName: string | null;
};

const TABS = [
  { to: "/analises/relatorios", icon: BarChart3, label: "Relatórios" },
  { to: "/analises/duvidas", icon: MessagesSquare, label: "Dúvidas" },
  { to: "/analises/banco", icon: Database, label: "Banco de dados" },
] as const;

export default function AnalisesLayout() {
  const navigate = useNavigate();

  const [authLoading, setAuthLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [grants, setGrants] = useState<AreaGrants>({});

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

      // Select principal SEM a coluna nova: se a migration ainda não chegou, um
      // select com ela falharia e deslogaria a pessoa.
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, full_name, can_access_analytics")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profileError) {
        await supabase.auth.signOut({ scope: "local" });
        navigate("/login", { replace: true });
        return;
      }

      const canViewGeovaniAnalyses = await fetchGeovaniAnalysesGrant(session.user.id);
      const nextGrants: AreaGrants = {
        canAccessAnalytics: Boolean(profile?.can_access_analytics),
        canViewGeovaniAnalyses,
      };

      if (!canAccessArea(profile?.role, "analises", nextGrants)) {
        // homePathForRole nunca aponta para /analises: não há loop.
        toast.error("Acesso negado", {
          description: "Seu perfil não tem acesso às Análises Geovani.",
        });
        navigate(homePathForRole(profile?.role), { replace: true });
        return;
      }

      if (!active) return;
      setUserId(session.user.id);
      setRole(profile?.role ?? null);
      setFullName(profile?.full_name ?? null);
      setGrants(nextGrants);
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

  const outletContext = useMemo<AnalisesOutletContext | null>(() => {
    if (authLoading || !userId) return null;
    return { userId, fullName };
  }, [authLoading, userId, fullName]);

  // Para onde o botão "trocar área" leva: quem tem cards vai para /areas; quem
  // tem só uma outra área (ex.: agente liberado) vai direto para ela.
  const switchTarget = useMemo(() => {
    if (hasAreaChoice(role)) return { to: AREA_CHOICE_PATH, label: "Trocar área", area: null };
    const other = areasForRole(role, grants).find((a) => a !== "analises");
    return other ? { to: AREA_PATH[other], label: AREA_SHORT_LABEL[other], area: other } : null;
  }, [role, grants]);

  const handleLogout = async () => {
    await recordAuthEvent("logout").catch(() => {});
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("sb-")) localStorage.removeItem(key);
    }
    window.location.href = "/login";
  };

  if (authLoading || !outletContext) {
    return (
      <div className="analises-notebook flex min-h-screen items-center justify-center">
        <p className="text-[var(--nb-ink-3)]">Carregando...</p>
      </div>
    );
  }

  const firstName = (fullName ?? "").trim().split(/\s+/)[0];
  const iconButton =
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-2.5 text-[13px] text-[var(--nb-ink-2)] transition-colors hover:bg-[var(--nb-tab)] hover:text-[var(--nb-ink)]";

  return (
    <div className="analises-notebook flex min-h-screen flex-col">
      <header className="border-b border-[var(--nb-border)] bg-[var(--nb-sheet)]">
        <div className="mx-auto flex h-14 max-w-[980px] items-center gap-3 px-3 sm:px-4">
          <JupyterMark className="h-9 w-9 shrink-0 text-[var(--nb-ink-2)]" />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--nb-ink)]">
              Análises Geovani
            </div>
            <div className="truncate text-[12px] text-[var(--nb-ink-3)]">
              Notebooks, relatórios e dúvidas de dados
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {firstName && (
              <span className="mr-2 hidden text-[12px] text-[var(--nb-ink-3)] md:inline">{firstName}</span>
            )}
            {switchTarget && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to={switchTarget.to}
                    onClick={() => {
                      if (switchTarget.area) window.localStorage.setItem(LAST_AREA_KEY, switchTarget.area);
                    }}
                    aria-label={switchTarget.area ? `Ir para ${switchTarget.label}` : switchTarget.label}
                    className={iconButton}
                  >
                    <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">{switchTarget.label}</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent className="sm:hidden">{switchTarget.label}</TooltipContent>
              </Tooltip>
            )}
            <ThemeToggle variant="ghost" className="text-[var(--nb-ink-2)] hover:bg-[var(--nb-tab)] hover:text-[var(--nb-ink)]" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={handleLogout} aria-label="Sair" className={iconButton}>
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Sair</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      {/* Abas de arquivo aberto: a ativa "encosta" na folha logo abaixo. */}
      <nav aria-label="Seções das Análises Geovani" className="mx-auto w-full max-w-[980px] pt-3 sm:px-4 sm:pt-5">
        <ul className="flex gap-1 overflow-x-auto px-2 sm:px-0">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <li key={tab.to} className="shrink-0">
                <NavLink
                  to={tab.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-t-md border border-b-0 px-3 py-2 text-[13.5px] transition-colors sm:px-4",
                      isActive
                        ? "border-[var(--nb-border)] bg-[var(--nb-chrome)] font-medium text-[var(--nb-ink)] shadow-[inset_0_2px_0_var(--nb-accent)]"
                        : "border-transparent bg-[var(--nb-tab)] text-[var(--nb-ink-2)] hover:bg-[var(--nb-tab-hover)] hover:text-[var(--nb-ink)]",
                    )
                  }
                >
                  <Icon className="hidden h-4 w-4 sm:block" aria-hidden="true" />
                  {tab.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <main className="mx-auto w-full max-w-[980px] flex-1 pb-12 sm:px-4">
        <Outlet context={outletContext} />
      </main>
    </div>
  );
}
