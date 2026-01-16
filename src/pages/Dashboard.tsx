import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useDashboardServicesQuery } from "@/features/dashboard/useDashboardServicesQuery";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfMonthISO() {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return first.toISOString().slice(0, 10);
}

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  // Filters (por enquanto só data; agente vem no próximo passo)
  const [from, setFrom] = useState(firstDayOfMonthISO());
  const [to, setTo] = useState(todayISO());

  useEffect(() => {
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
        .select("role")
        .eq("id", session.user.id)
        .single();

      if (profile?.role !== "manager") {
        navigate("/workspace");
        return;
      }

      setLoading(false);
    };

    checkAuth();
  }, [navigate]);

  const { data: services = [], isLoading: isLoadingServices, error } = useDashboardServicesQuery({
    enabled: !loading,
    from,
    to,
  });

  const rowsPreview = useMemo(() => services.slice(0, 25), [services]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Carregando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Dashboard - Manager</h1>
          <Button onClick={handleLogout} variant="outline">
            Sair
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Fonte de dados (services + profiles)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="from">Início</Label>
                <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="to">Fim</Label>
                <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => {
                    // refetch acontece automaticamente quando from/to mudam;
                    // botão será útil quando adicionarmos selects/filtros mais complexos.
                    setFrom((v) => v);
                  }}
                >
                  Atualizar
                </Button>
              </div>
            </div>

            {error ? (
              <p className="text-sm text-destructive">{(error as any)?.message ?? "Erro ao carregar dados."}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Query: <code>.select('id, ..., profiles(full_name)')</code>
              </p>
            )}

            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Agente</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Cliente</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingServices ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        Carregando atendimentos...
                      </TableCell>
                    </TableRow>
                  ) : rowsPreview.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        Nenhum atendimento no período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rowsPreview.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{format(new Date(row.service_date), "dd/MM/yyyy")}</TableCell>
                        <TableCell className="font-medium">{row.profiles?.full_name ?? "—"}</TableCell>
                        <TableCell>{row.product}</TableCell>
                        <TableCell className="text-muted-foreground">{row.client_email}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;

