import { useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/logo-xmx.png";
import { AgentSidebar } from "@/components/agent/AgentSidebar";

export type AgentOutletContext = {
  userId: string;
  fullName: string | null;
};

export default function AgentLayout() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);

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

      if (profile?.role === "manager") {
        navigate("/dashboard", { replace: true });
        return;
      }

      if (!active) return;
      setUserId(session.user.id);
      setFullName(profile?.full_name ?? null);
      setLoading(false);
    };

    checkAuth();
    return () => {
      active = false;
    };
  }, [navigate]);

  const outletContext = useMemo<AgentOutletContext | null>(() => {
    if (!userId) return null;
    return { userId, fullName };
  }, [userId, fullName]);

  const handleLogout = () => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("sb-")) localStorage.removeItem(key);
    }
    window.location.href = "/login";
  };

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

              <Button
                onClick={handleLogout}
                variant="secondary"
                className="bg-white/10 text-dashboard-sidebar-foreground hover:bg-white/15"
              >
                Sair
              </Button>
            </div>
          </header>

          <div className="bg-dashboard-surface">
            <Outlet context={outletContext} />
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
