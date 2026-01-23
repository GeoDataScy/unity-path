import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { DateRange } from "react-day-picker";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAgentsQuery } from "@/features/dashboard/useAgentsQuery";
import logo from "@/assets/logo-xmx.png";
import { cn } from "@/lib/utils";
import { BarChart3, RefreshCcw } from "lucide-react";

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

export default function ManagerLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const [authLoading, setAuthLoading] = useState(true);
  const [fullName, setFullName] = useState<string | null>(null);

  // Defaults requested: 01/01/2026 -> 31/01/2026
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 0, 31);
    return { from, to };
  });
  const [agentId, setAgentId] = useState<string>("all");

  const fromISO = useMemo(() => {
    const d = range?.from;
    return d ? toISODate(d) : "2026-01-01";
  }, [range?.from]);

  const toISO = useMemo(() => {
    const d = range?.to ?? range?.from;
    return d ? toISODate(d) : "2026-01-31";
  }, [range?.to, range?.from]);

  useEffect(() => {
    let active = true;

    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        navigate("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profile?.role !== "manager") {
        navigate("/workspace");
        return;
      }

      if (!active) return;
      setFullName(profile?.full_name ?? null);
      setAuthLoading(false);
    };

    checkAuth();
    return () => {
      active = false;
    };
  }, [navigate]);

  const agentsQuery = useAgentsQuery(!authLoading);

  const outletContext = useMemo<ManagerOutletContext | null>(() => {
    if (authLoading) return null;
    return { fullName, range, setRange, agentId, setAgentId, fromISO, toISO };
  }, [authLoading, fullName, range, agentId, fromISO, toISO]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (authLoading || !outletContext) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  const isOnRefunds = location.pathname.startsWith("/dashboard/reembolsos");

  return (
    <div className="min-h-screen flex">
      <aside className="w-[260px] shrink-0 sticky top-0 h-screen bg-dashboard-sidebar text-dashboard-sidebar-foreground border-r border-white/10">
        <div className="h-full flex flex-col p-4 gap-6">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Logo da empresa" className="h-8 w-auto" loading="lazy" />
            <div className="leading-tight">
              <div className="text-sm font-semibold">Painel da Gestora</div>
              <div className="text-xs opacity-80">Analytics</div>
            </div>
          </div>

          <nav className="space-y-2">
            <NavLink
              to="/dashboard"
              end
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm bg-white/0 hover:bg-white/10 transition",
                  isActive && "bg-white/15",
                )
              }
            >
              <BarChart3 className="h-4 w-4" />
              <span>Dashboard</span>
            </NavLink>

            <NavLink
              to="/dashboard/reembolsos"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm bg-white/0 hover:bg-white/10 transition",
                  isActive && "bg-white/15",
                )
              }
            >
              <RefreshCcw className="h-4 w-4" />
              <span>Reembolsos</span>
            </NavLink>
          </nav>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide opacity-80">Período</div>
              <DateRangePicker value={range} onChange={setRange} />
              <div className="text-[11px] opacity-75">Default: 01/01/2026 — 31/01/2026</div>
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

          <div className="mt-auto space-y-2">
            <Button
              onClick={handleLogout}
              variant="secondary"
              className="w-full bg-white/10 text-dashboard-sidebar-foreground hover:bg-white/15"
            >
              Logout
            </Button>

            <div className="text-[11px] opacity-70 px-1">
              {isOnRefunds ? "Visualizando: Reembolsos" : "Visualizando: Atendimentos"}
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 bg-dashboard-surface p-8">
        <div className="mx-auto max-w-7xl">
          <Outlet context={outletContext} />
        </div>
      </main>
    </div>
  );
}
