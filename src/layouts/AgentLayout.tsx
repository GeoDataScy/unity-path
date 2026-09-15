import { useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/logo-xmx.png";
import { AgentSidebar } from "@/components/agent/AgentSidebar";
import { PendingRefundsAlert } from "@/features/refunds/PendingRefundsAlert";
import { AgentCheckInController } from "@/features/agent/check-in/AgentCheckInController";
import { AgentNotepad } from "@/features/notepad/AgentNotepad";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { NotificationsBell } from "@/features/transfers/NotificationsBell";
import { getMeStatus, recordAuthEvent, sendHeartbeat } from "@/lib/userSession";
import { homePathForRole, isKnownRole } from "@/lib/roles";

export type AgentOutletContext = {
  userId: string;
  fullName: string | null;
  canViewAllTickets: boolean;
  canRegisterDuplicateEmails: boolean;
  canClaimTickets: boolean;
};

export default function AgentLayout() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  // Role que este bundle não conhece (área nova ainda não publicada): em vez de
  // redirecionar, a tela explica o que está acontecendo.
  const [roleSemArea, setRoleSemArea] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [canViewAllTickets, setCanViewAllTickets] = useState(false);
  const [canRegisterDuplicateEmails, setCanRegisterDuplicateEmails] = useState(false);
  const [canClaimTickets, setCanClaimTickets] = useState(false);

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
        .select("role, full_name, can_view_all_tickets, can_register_duplicate_emails, can_claim_tickets")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profileError) {
        await supabase.auth.signOut({ scope: "local" });
        navigate("/login", { replace: true });
        return;
      }

      // Perfil sem role (linha ausente) continua caindo aqui, como antes.
      if (profile?.role && profile.role !== "agent") {
        // Role que existe no banco mas não neste bundle (área nova publicada no
        // banco antes do deploy do front) cai aqui pelo fallback de agente de
        // homePathForRole — o redirect apontaria para /workspace de novo e a
        // tela ficaria em "Carregando..." para sempre. Melhor dizer o que é.
        if (!isKnownRole(profile.role)) {
          if (!active) return;
          setRoleSemArea(profile.role);
          setLoading(false);
          return;
        }
        navigate(homePathForRole(profile?.role), { replace: true });
        return;
      }

      if (!active) return;
      setUserId(session.user.id);
      setFullName(profile?.full_name ?? null);
      setCanViewAllTickets(Boolean(profile?.can_view_all_tickets));
      setCanRegisterDuplicateEmails(Boolean(profile?.can_register_duplicate_emails));
      setCanClaimTickets(Boolean(profile?.can_claim_tickets));
      setLoading(false);
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

    // Fire one heartbeat immediately so the manager sees the user online without
    // waiting 30s for the first tick.
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

  const outletContext = useMemo<AgentOutletContext | null>(() => {
    if (!userId) return null;
    return { userId, fullName, canViewAllTickets, canRegisterDuplicateEmails, canClaimTickets };
  }, [userId, fullName, canViewAllTickets, canRegisterDuplicateEmails, canClaimTickets]);

  const handleLogout = async () => {
    await recordAuthEvent("logout").catch(() => {});
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("sb-")) localStorage.removeItem(key);
    }
    window.location.href = "/login";
  };

  if (roleSemArea) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-3 text-center">
          <img src={logo} alt="XMX" className="mx-auto h-10 w-auto" />
          <h1 className="text-lg font-semibold">Área em construção</h1>
          <p className="text-sm text-muted-foreground">
            Sua conta é do time <span className="font-medium">{roleSemArea}</span>, e a área desse time
            ainda não está publicada nesta versão do app. Assim que ela subir, o login já cai direto lá.
          </p>
          <Button variant="secondary" onClick={handleLogout}>
            Sair
          </Button>
        </div>
      </div>
    );
  }

  if (loading || !outletContext) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  return (
    <SidebarProvider defaultOpen>
      <div className="min-h-screen flex w-full bg-dashboard-surface">
        <AgentSidebar />

        <SidebarInset>
          <header className="border-b border-white/10 bg-dashboard-sidebar text-dashboard-sidebar-foreground">
            <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="-ml-1 text-dashboard-sidebar-foreground hover:bg-white/10" />
                <div className="flex items-center gap-2">
                  <img src={logo} alt="XMX" className="h-6 w-auto" loading="lazy" />
                  <span className="text-sm font-medium tracking-wide">Workspace</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <NotificationsBell enabled={Boolean(userId)} />
                <ThemeToggle className="bg-white/10 text-dashboard-sidebar-foreground hover:bg-white/15" />
                <Button
                  onClick={handleLogout}
                  variant="secondary"
                  className="bg-white/10 text-dashboard-sidebar-foreground hover:bg-white/15"
                >
                  Sair
                </Button>
              </div>
            </div>
          </header>

          <div className="bg-dashboard-surface">
            <Outlet context={outletContext} />
          </div>
        </SidebarInset>
      </div>

      <PendingRefundsAlert enabled={Boolean(userId)} />
      {userId && <AgentCheckInController userId={userId} fullName={fullName} />}

      {/* Caderno pessoal do agente: marcador no canto inferior direito, painel
          de altura inteira à direita. Fica no layout (e não numa página) porque
          a anotação nasce no meio de qualquer tela do workspace. */}
      <AgentNotepad enabled={Boolean(userId)} fullName={fullName} />
    </SidebarProvider>
  );
}
