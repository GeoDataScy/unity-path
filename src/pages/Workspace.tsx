import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

import { Pencil } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/logo-xmx.png";

import { useMyServicesQuery, type ServiceItem } from "@/features/services/useMyServicesQuery";
import { EditServiceDialog } from "@/features/services/EditServiceDialog";
import { DeleteServiceAlert } from "@/features/services/DeleteServiceAlert";

const PRODUCTS = [
  "Arialief",
  "Alphacur",
  "Blinzador",
  "Feilaira",
  "Garaherb",
  "Karylief",
  "Kymezol",
  "Jertaris",
  "Laellium",
  "Memyts",
  "Presgera",
  "Biografa",
  "Cetacondor",
  "Cetadusse",
  "Sciatilief",
  "Goldenfrib",
  "Felaromi",
  "Tenurima",
  "Ariovira",
  "CucuDrops",
  "Zalovira",
  "Xelovita",
  "Cerami",
  "NATHUREX",
  "Mahgryn",
  "Levhyn",
  "Ariomyx",
  "Alitoryn",
  "Athentys",
  "Velynivo",
  "Mioralab",
  "Vergolief",
  "Olisteren",
  "Halegryn",
  "Danmyts",
  "Maizkidor",
  "Basmontex",
  "Fraganief",
  "Ceramiri",
  "Shapeon",
  "Nexburn",
  "Memoryon",
  "Korvizol",
  "Erectozyn",
  "Thewellnesswize",
  "VIP.Shipping",
  "VisualEase",
  "NerveEase",
  "Steelpower",
  "Gluco Off",
  "Cognivex",
  "Nad Dermal+",
  "Alpharock",
  "Hair Bloom",
  "Guardon",
  "Joint Mend",
  "Keskara",
  "Lipolegs",
  "LipoShape",
  "Mind Recall",
  "Mind Wake",
  "Prostate Vital",
  "Quiet Nerves",
  "Quiet Rest",
  "RingSilence",
  "FlowStrong",
  "Youth Within",
  "Thermo Ignite",
  "Glyco Barrier",
  "Gluco Mild",
  "Horsefil",
] as const;

function todayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function parseServiceDateForDisplay(value: string | null | undefined): Date | null {
  if (!value) return null;

  // If backend returns a timestamp (e.g. 2026-01-15T00:00:00.000Z),
  // render the *date portion* to avoid timezone shifting to the previous day.
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    value = value.slice(0, 10);
  }

  // Date-only coming from <input type="date">: keep it in local time.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map((n) => Number(n));
    if (!y || !m || !d) return null;
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // Fallback: attempt to parse other formats.
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}


const Workspace = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);

  // Form state
  const [clientEmail, setClientEmail] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [product, setProduct] = useState("");

  // Edit dialog state
  const [editing, setEditing] = useState<ServiceItem | null>(null);

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

      if (profile?.role === "manager") {
        navigate("/dashboard");
        return;
      }

      // Busca do nome do usuário logado (para saudação no topo)
      const { data: profileName, error: profileNameError } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profileNameError) {
        // Não bloqueia a tela: apenas cai no fallback "Time"
        console.warn("Falha ao buscar full_name:", profileNameError.message);
      }

      setFullName(profileName?.full_name ?? null);
      setUserId(session.user.id);
      setLoading(false);
    };

    checkAuth();
  }, [navigate]);

  const { data: services = [], isLoading: servicesLoading } = useMyServicesQuery(!loading && Boolean(userId));

  const canSubmit = useMemo(() => {
    return Boolean(clientEmail) && Boolean(serviceDate) && Boolean(product);
  }, [clientEmail, serviceDate, product]);

  const greetingName = useMemo(() => {
    const trimmed = (fullName ?? "").trim();
    return trimmed.length > 0 ? trimmed : "Time";
  }, [fullName]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada");

      const { error } = await supabase.from("services").insert({
        client_email: clientEmail,
        service_date: serviceDate,
        product,
        status: "registered",
        user_id: session.user.id,
      });

      if (error) throw error;
    },
    onSuccess: async () => {
      setClientEmail("");
      setServiceDate("");
      setProduct("");
      await queryClient.invalidateQueries({ queryKey: ["services", "me"] });
      toast({
        title: "Atendimento registrado",
        description: "Seu registro foi salvo com sucesso.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao registrar",
        description: error?.message ?? "Não foi possível registrar o atendimento.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("services").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["services", "me"] });
      toast({
        title: "Atendimento excluído",
        description: "O registro foi removido.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao excluir",
        description: error?.message ?? "Não foi possível excluir o atendimento.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: string; client_email: string; product: string }) => {
      // service_date is frozen by a database trigger; manager corrections go
      // through manager_correct_service_date.
      const { error } = await supabase
        .from("services")
        .update({
          client_email: payload.client_email,
          product: payload.product,
        })
        .eq("id", payload.id);

      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["services", "me"] });
      toast({
        title: "Atendimento atualizado",
        description: "As alterações foram salvas.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao atualizar",
        description: error?.message ?? "Não foi possível atualizar o atendimento.",
        variant: "destructive",
      });
    },
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || createMutation.isPending) return;
    createMutation.mutate();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <img src={logo} alt="XMX" className="h-7 w-auto" loading="lazy" />
            <span className="text-sm font-medium tracking-wide">Workspace</span>
          </div>
          <Button onClick={handleLogout} variant="secondary">
            Sair
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="mb-6 text-3xl font-normal tracking-tight md:text-4xl">
          Vamos lá, {greetingName} 🚀
        </h1>

        <Card>
          <CardHeader>
            <CardTitle>Novo registro de atendimento</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-4 lg:grid-cols-4 lg:items-end">
              <div className="grid gap-2">
                <Label htmlFor="clientEmail">E-mail do Cliente</Label>
                <Input
                  id="clientEmail"
                  type="email"
                  placeholder="cliente@email.com"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="serviceDate">Data do Atendimento</Label>
                <div className="flex gap-2">
                  <Input
                    id="serviceDate"
                    type="date"
                    value={serviceDate}
                    onChange={(e) => setServiceDate(e.target.value)}
                    required
                  />
                  <Button type="button" onClick={() => setServiceDate(todayISO())}>
                    Hoje
                  </Button>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Produto</Label>
                <Select value={product} onValueChange={setProduct}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCTS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex lg:justify-end">
                <Button type="submit" className="w-full lg:w-auto" disabled={!canSubmit || createMutation.isPending}>
                  {createMutation.isPending ? "Registrando..." : "Registrar Atendimento"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Meus Atendimentos Recentes</h2>
            {(servicesLoading || createMutation.isPending) && (
              <span className="text-sm text-muted-foreground">Atualizando...</span>
            )}
          </div>

          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>E-mail do Cliente</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="w-[96px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      Nenhum atendimento registrado ainda.
                    </TableCell>
                  </TableRow>
                ) : (
                  services.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        {(() => {
                          const dt = parseServiceDateForDisplay(s.service_date);
                          return dt ? format(dt, "dd/MM/yyyy") : "—";
                        })()}
                      </TableCell>
                      <TableCell className="font-medium">{s.client_email}</TableCell>
                      <TableCell>{s.product}</TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditing(s)}
                            aria-label="Editar atendimento"
                            title="Editar"
                          >
                            <Pencil className="text-muted-foreground" />
                          </Button>

                          <DeleteServiceAlert
                            disabled={deleteMutation.isPending}
                            onConfirm={async () => {
                              await deleteMutation.mutateAsync(s.id);
                            }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        {editing && (
          <EditServiceDialog
            service={editing}
            open={Boolean(editing)}
            onOpenChange={(open) => {
              if (!open) setEditing(null);
            }}
            onSave={async (next) => {
              await updateMutation.mutateAsync({ id: editing.id, ...next });
            }}
          />
        )}
      </main>
    </div>
  );
};

export default Workspace;
