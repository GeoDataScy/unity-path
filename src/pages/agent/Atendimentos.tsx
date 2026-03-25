import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Pencil } from "lucide-react";
import { useOutletContext } from "react-router-dom";

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
import { useMyServicesQuery, type ServiceItem } from "@/features/services/useMyServicesQuery";
import { useAgentDailyMetricsQuery } from "@/features/agent/useAgentDailyMetricsQuery";
import { EditServiceDialog } from "@/features/services/EditServiceDialog";
import { DeleteServiceAlert } from "@/features/services/DeleteServiceAlert";
import type { AgentOutletContext } from "@/layouts/AgentLayout";
import { AgentDailyMetricsSection } from "@/features/agent/components/AgentDailyMetricsSection";

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
] as const;

const PLATFORMS = [
  "Cartpanda",
  "Buygoods",
  "ClickBank",
  "Digistore24",
  "SalesBound",
  "LogiCall",
] as const;

function todayISO() {
  // Use São Paulo date (avoid UTC date drift around midnight)
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function toSaoPauloTimestamptz(dateOnly: string) {
  // services.service_date is timestamptz; if we send YYYY-MM-DD, Postgres will interpret as 00:00Z,
  // which becomes the previous day in São Paulo. We store midnight São Paulo explicitly.
  // São Paulo has no DST currently, so -03:00 is stable.
  return `${dateOnly}T00:00:00-03:00`;
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

export default function Atendimentos() {
  const { userId, fullName } = useOutletContext<AgentOutletContext>();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // DEV-only: simulate the exact “hit 100” celebration without backend changes
  const [debugCelebrateNonce, setDebugCelebrateNonce] = useState(0);
  const [debugOverrideCount, setDebugOverrideCount] = useState<number | null>(null);
  const debugResetTimeoutRef = useRef<number | null>(null);

  // Form state
  const [clientEmail, setClientEmail] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [product, setProduct] = useState("");
  const [platform, setPlatform] = useState("");
  const [channel, setChannel] = useState<"Nenhum" | "Clickbank" | "Email" | "SMS">("Nenhum");

  // Edit dialog state
  const [editing, setEditing] = useState<ServiceItem | null>(null);

  const { data: services = [], isLoading: servicesLoading } = useMyServicesQuery(Boolean(userId));
  const { data: dailyMetrics, isLoading: metricsLoading } = useAgentDailyMetricsQuery(Boolean(userId));

  const canSubmit = useMemo(() => {
    return Boolean(clientEmail) && Boolean(serviceDate) && Boolean(product) && Boolean(platform);
  }, [clientEmail, serviceDate, product, platform]);

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

      // Check if same email was already registered today by this agent
      const dayStart = toSaoPauloTimestamptz(serviceDate);
      const nextDay = new Date(new Date(serviceDate + "T00:00:00").getTime() + 86400000)
        .toISOString()
        .slice(0, 10);
      const dayEnd = toSaoPauloTimestamptz(nextDay);

      const { data: existing } = await supabase
        .from("services")
        .select("id")
        .eq("user_id", session.user.id)
        .ilike("client_email", clientEmail.trim())
        .gte("service_date", dayStart)
        .lt("service_date", dayEnd)
        .limit(1);

      if (existing && existing.length > 0) {
        throw new Error("Este e-mail já foi registrado nesta data. Você só pode registrar o mesmo e-mail novamente no dia seguinte.");
      }

      const { error } = await supabase.from("services").insert({
        client_email: clientEmail.trim(),
        service_date: toSaoPauloTimestamptz(serviceDate),
        product,
        platform,
        channel,
        status: "registered",
        user_id: session.user.id,
      });

      if (error) throw error;
    },
    onSuccess: async () => {
      setClientEmail("");
      setServiceDate("");
      setProduct("");
      setPlatform("");
      setChannel("Nenhum");
      await queryClient.invalidateQueries({ queryKey: ["services", "me"] });
      await queryClient.invalidateQueries({ queryKey: ["agent", "daily-metrics"] });
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
      await queryClient.invalidateQueries({ queryKey: ["agent", "daily-metrics"] });
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
    mutationFn: async (payload: { id: string; client_email: string; service_date: string; product: string; platform: string; channel: string }) => {
      const { error } = await supabase
        .from("services")
        .update({
          client_email: payload.client_email,
          service_date: toSaoPauloTimestamptz(payload.service_date),
          product: payload.product,
          platform: payload.platform,
          channel: payload.channel,
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

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || createMutation.isPending) return;
    createMutation.mutate();
  };

  useEffect(() => {
    return () => {
      if (debugResetTimeoutRef.current != null) {
        window.clearTimeout(debugResetTimeoutRef.current);
      }
    };
  }, []);

  const handleDebugSimulateGoalHit = () => {
    const CELEBRATION_MS = 9600;
    const GOAL = 100;

    setDebugOverrideCount(GOAL);
    setDebugCelebrateNonce((n) => n + 1);

    if (debugResetTimeoutRef.current != null) {
      window.clearTimeout(debugResetTimeoutRef.current);
    }
    debugResetTimeoutRef.current = window.setTimeout(() => setDebugOverrideCount(null), CELEBRATION_MS);
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-normal tracking-tight md:text-4xl">Vamos lá, {greetingName} 🚀</h1>
        {import.meta.env.DEV && (
          <Button type="button" variant="outline" size="sm" onClick={handleDebugSimulateGoalHit}>
            Simular meta batida (DEV)
          </Button>
        )}
      </div>

      <AgentDailyMetricsSection
        userId={userId}
        metricsLoading={metricsLoading}
        dailyMetrics={dailyMetrics}
        debugCelebrateNonce={debugCelebrateNonce}
        debugOverrideCount={debugOverrideCount}
      />

      <Card>
        <CardHeader>
          <CardTitle>Novo registro de atendimento</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-2">
            <Label className="mr-1 text-sm text-muted-foreground">Canal</Label>
            {(["Nenhum", "Clickbank", "Email", "SMS"] as const).map((ch) => (
              <Button
                key={ch}
                type="button"
                size="sm"
                variant={channel === ch ? "default" : "outline"}
                onClick={() => setChannel(ch)}
              >
                {ch}
              </Button>
            ))}
          </div>
          <form onSubmit={handleCreate} className="grid gap-4 lg:grid-cols-5 lg:items-end">
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

            <div className="grid gap-2">
              <Label>Plataforma</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
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
                <TableHead>Plataforma</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead className="w-[96px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
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
                    <TableCell>{s.platform ?? "—"}</TableCell>
                    <TableCell>{s.channel ?? "—"}</TableCell>
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
  );
}
