import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarDays, CheckCircle2, Package, Pencil, Search, X } from "lucide-react";
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
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useToast } from "@/hooks/use-toast";
import { useMyServicesQuery, type ServiceItem } from "@/features/services/useMyServicesQuery";
import { useAgentDailyMetricsQuery } from "@/features/agent/useAgentDailyMetricsQuery";
import { EditServiceDialog } from "@/features/services/EditServiceDialog";
import { DeleteServiceAlert } from "@/features/services/DeleteServiceAlert";
import { StatusTrackingDialog } from "@/features/services/StatusTrackingDialog";
import { useStatusTracking, useFollowUpsQuery } from "@/features/services/useStatusTracking";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  "Gluco Off",
] as const;

const PLATFORMS = [
  "Nenhum",
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

function addOneDayISO(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, m - 1, d + 1).toLocaleDateString("en-CA");
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
  const [channel, setChannel] = useState<"Clickbank" | "Email" | "SMS">("Email");
  const [hasTrackingCode, setHasTrackingCode] = useState(false);

  // Search & filter state
  const [emailSearch, setEmailSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterTrackingCode, setFilterTrackingCode] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  // Edit dialog state
  const [editing, setEditing] = useState<ServiceItem | null>(null);

  // Status tracking
  const [trackingService, setTrackingService] = useState<ServiceItem | null>(null);
  const { getCurrentStatus, getEntries, addEntryMutation, canAddInteraction } = useStatusTracking();

  /** Agent-only: remap "Em Aberto" → "Novo" with premium badge */
  const getAgentStatus = useCallback(
    (serviceId: string, serviceStatus?: string) => {
      const st = getCurrentStatus(serviceId, serviceStatus);
      if (st.variant === "open") {
        return { label: "Novo", variant: "new" as const };
      }
      return st;
    },
    [getCurrentStatus],
  );

  /** Count interactions: ticket creation counts as #1 */
  const getInteractionCount = useCallback(
    (serviceId: string) => getEntries(serviceId).length + 1,
    [getEntries],
  );

  const [concludingId, setConcludingId] = useState<string | null>(null);

  const handleQuickConclude = useCallback(
    async (s: ServiceItem) => {
      const check = canAddInteraction(s.id, s.service_date, s.has_tracking_code);
      if (!check.allowed) {
        toast({ title: "Não permitido", description: check.reason, variant: "destructive" });
        return;
      }

      const now = new Date();
      const parts = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .format(now)
        .replace(" ", "T");
      const recordedAt = `${parts}-03:00`;

      setConcludingId(s.id);
      try {
        await addEntryMutation.mutateAsync({ serviceId: s.id, status: "concluido", recordedAt, observation: "" });
        toast({ title: "Atendimento concluído", description: "Ticket registrado como concluído." });
      } finally {
        setConcludingId(null);
      }
    },
    [canAddInteraction, addEntryMutation, toast],
  );

  const { data: services = [], isLoading: servicesLoading } = useMyServicesQuery(Boolean(userId));
  const { data: dailyMetrics, isLoading: metricsLoading } = useAgentDailyMetricsQuery(Boolean(userId));
  // useStatusTracking already calls this internally; React Query deduplicates it — no extra request.
  const { data: allFollowUps = [] } = useFollowUpsQuery(Boolean(userId));

  // Build a Set of service IDs that had a follow-up recorded within the active date range.
  // Computed synchronously from already-loaded data — no extra network round-trip.
  const followUpServiceIds = useMemo<Set<string>>(() => {
    if (!dateFrom && !dateTo) return new Set();
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00-03:00`).getTime() : -Infinity;
    const toMs   = dateTo   ? new Date(`${addOneDayISO(dateTo)}T00:00:00-03:00`).getTime() : Infinity;
    const set = new Set<string>();
    for (const f of allFollowUps) {
      if (!f.recorded_at) continue;
      const t = new Date(f.recorded_at).getTime();
      if (t >= fromMs && t < toMs) set.add(f.service_id);
    }
    return set;
  }, [allFollowUps, dateFrom, dateTo]);

  const filteredServices = useMemo(() => {
    let result = services;

    if (emailSearch) {
      const term = emailSearch.toLowerCase();
      result = result.filter((s) => s.client_email.toLowerCase().includes(term));
    }

    // Include services where service_date is in range OR a follow-up was recorded in range.
    // Each interaction on a previous ticket counts as +1 attendance on the interaction date.
    if (dateFrom || dateTo) {
      result = result.filter((s) => {
        const d = s.service_date?.slice(0, 10);
        const inDateRange = (!dateFrom || (d && d >= dateFrom)) && (!dateTo || (d && d <= dateTo));
        const hasFollowUpInRange = followUpServiceIds.has(s.id);
        return inDateRange || hasFollowUpInRange;
      });
    }

    if (filterTrackingCode) {
      result = result.filter((s) => s.has_tracking_code === true);
    }

    return result;
  }, [services, emailSearch, dateFrom, dateTo, filterTrackingCode, followUpServiceIds]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [emailSearch, dateFrom, dateTo, filterTrackingCode]);

  /** Total interactions across the filtered services (creation + follow-ups) */
  const totalFilteredInteractions = useMemo(
    () => filteredServices.reduce((sum, s) => sum + getInteractionCount(s.id), 0),
    [filteredServices, getInteractionCount],
  );

  const totalPages = Math.max(1, Math.ceil(filteredServices.length / PAGE_SIZE));
  const paginatedServices = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredServices.slice(start, start + PAGE_SIZE);
  }, [filteredServices, page]);

  // Derive agent's channel from their services: if majority is SMS → 150/day, otherwise 100/day
  const supportChannel = useMemo(() => {
    const smsCount = services.filter((s) => s.channel === "SMS").length;
    const otherCount = services.length - smsCount;
    return smsCount > otherCount ? "sms" : "email";
  }, [services]) as "email" | "sms";
  const dailyGoal = supportChannel === "sms" ? 150 : 100;

  const canSubmit = useMemo(() => {
    return Boolean(clientEmail) && Boolean(serviceDate) && Boolean(product) && Boolean(platform);
  }, [clientEmail, serviceDate, product, platform]);

  const greetingName = useMemo(() => {
    const trimmed = (fullName ?? "").trim();
    return trimmed.length > 0 ? trimmed : "Time";
  }, [fullName]);

  const concludeAfterCreate = useRef(false);

  const createMutation = useMutation({
    mutationFn: async (): Promise<{ existing?: ServiceItem }> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada");

      // Check if email already exists in this agent's base (any date)
      const { data: existingRows } = await supabase
        .from("services")
        .select("id, client_email, service_date, product, platform, channel, status, created_at, has_tracking_code")
        .eq("user_id", session.user.id)
        .ilike("client_email", clientEmail.trim())
        .order("created_at", { ascending: false })
        .limit(1);

      if (existingRows && existingRows.length > 0) {
        return { existing: existingRows[0] as ServiceItem };
      }

      const { error } = await supabase.from("services").insert({
        client_email: clientEmail.trim(),
        service_date: toSaoPauloTimestamptz(serviceDate),
        product,
        platform,
        channel,
        has_tracking_code: hasTrackingCode,
        // "concluido" directly avoids a follow-up insert, preventing double-counting in daily metrics
        status: concludeAfterCreate.current ? "concluido" : "registered",
        user_id: session.user.id,
      });

      if (error) throw error;
      return {};
    },
    onSuccess: async (result) => {
      // If email already exists, open the microgerenciador for the existing ticket
      if (result.existing) {
        concludeAfterCreate.current = false;
        toast({
          title: "E-mail já cadastrado",
          description: "Abrindo o acompanhamento do atendimento existente.",
        });
        setTrackingService(result.existing);
        return;
      }

      const shouldConclude = concludeAfterCreate.current;
      concludeAfterCreate.current = false;

      setClientEmail("");
      setServiceDate("");
      setProduct("");
      setPlatform("");
      setChannel("Email");
      setHasTrackingCode(false);
      await queryClient.invalidateQueries({ queryKey: ["services", "me"] });
      await queryClient.invalidateQueries({ queryKey: ["agent", "daily-metrics"] });

      toast(
        shouldConclude
          ? { title: "Atendimento concluído", description: "Ticket registrado e marcado como concluído." }
          : { title: "Atendimento registrado", description: "Seu registro foi salvo com sucesso." },
      );
    },
    onError: (error: any) => {
      concludeAfterCreate.current = false;
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
    concludeAfterCreate.current = false;
    createMutation.mutate();
  };

  const handleCreateAndConclude = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!canSubmit || createMutation.isPending) return;
    concludeAfterCreate.current = true;
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
    const GOAL = dailyGoal;

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
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-normal tracking-tight md:text-4xl">Vamos lá, {greetingName} 🚀</h1>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${supportChannel === "sms" ? "bg-violet-500/15 text-violet-700 dark:text-violet-400" : "bg-blue-500/15 text-blue-700 dark:text-blue-400"}`}>
            {supportChannel.toUpperCase()}
          </span>
        </div>
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
        goal={dailyGoal}
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
            {(["Clickbank", "Email", "SMS"] as const).map((ch) => (
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
            <div className="ml-4 flex items-center gap-2 border-l pl-4">
              <Label htmlFor="tracking-code-toggle" className="text-sm text-muted-foreground cursor-pointer">
                Cód. Rastreio
              </Label>
              <Switch
                id="tracking-code-toggle"
                checked={hasTrackingCode}
                onCheckedChange={setHasTrackingCode}
              />
            </div>
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

            <div className="flex gap-2 lg:justify-end">
              <Button type="submit" className="flex-1 lg:flex-none" disabled={!canSubmit || createMutation.isPending}>
                {createMutation.isPending && !concludeAfterCreate.current ? "Registrando..." : "Registrar"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1 gap-1.5 border-green-600 text-green-700 hover:bg-green-50 hover:text-green-800 lg:flex-none dark:border-green-500 dark:text-green-400 dark:hover:bg-green-950"
                disabled={!canSubmit || createMutation.isPending}
                onClick={handleCreateAndConclude}
              >
                {createMutation.isPending && concludeAfterCreate.current ? (
                  "Concluindo..."
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Concluir
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">Meus Atendimentos Recentes</h2>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Buscar por e-mail..."
                value={emailSearch}
                onChange={(e) => setEmailSearch(e.target.value)}
                className="h-8 w-56 pl-8 pr-8 text-sm"
              />
              {emailSearch && (
                <button
                  type="button"
                  onClick={() => setEmailSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 w-36 text-sm"
                title="Data inicial"
              />
              <span className="text-xs text-muted-foreground">até</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 w-36 text-sm"
                title="Data final"
              />
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                  className="text-muted-foreground hover:text-foreground"
                  title="Limpar datas"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-xs">
              <span className="text-muted-foreground">Total de interações:</span>
              <span className="font-semibold text-foreground">{totalFilteredInteractions}</span>
            </div>
            <Button
              type="button"
              variant={filterTrackingCode ? "default" : "outline"}
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setFilterTrackingCode((prev) => !prev)}
            >
              <Package className="h-3.5 w-3.5" />
              Cód. Rastreio
              {filterTrackingCode && <X className="h-3 w-3" />}
            </Button>
          </div>
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
                <TableHead>Status</TableHead>
                <TableHead className="w-[96px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedServices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {emailSearch || dateFrom || dateTo
                      ? "Nenhum atendimento encontrado com os filtros aplicados."
                      : "Nenhum atendimento registrado ainda."}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedServices.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      {(() => {
                        const dt = parseServiceDateForDisplay(s.service_date);
                        return dt ? format(dt, "dd/MM/yyyy") : "—";
                      })()}
                    </TableCell>
                    <TableCell className="font-medium">{s.client_email}</TableCell>
                    <TableCell>{s.product}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span>{s.platform ?? "—"}</span>
                        {getAgentStatus(s.id, s.status).variant !== "done" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-green-600 hover:bg-green-50 hover:text-green-700"
                            title="Concluir atendimento"
                            aria-label="Concluir atendimento"
                            disabled={concludingId === s.id}
                            onClick={() => handleQuickConclude(s)}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span>{s.channel ?? "—"}</span>
                        {s.has_tracking_code && (
                          <Package className="h-3.5 w-3.5 text-primary" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const st = getAgentStatus(s.id, s.status);
                        const count = getInteractionCount(s.id);
                        return (
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant={st.variant}
                              className="cursor-pointer transition-transform hover:scale-105 active:scale-95"
                              onClick={() => setTrackingService(s)}
                            >
                              {st.label}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">#{count}</span>
                          </div>
                        );
                      })()}
                    </TableCell>
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

        {filteredServices.length > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Página {page} de {totalPages} • {filteredServices.length} registros
            </p>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setPage((p) => Math.max(1, p - 1));
                    }}
                  />
                </PaginationItem>

                {Array.from({ length: totalPages }).slice(0, 7).map((_, idx) => {
                  const p = idx + 1;
                  return (
                    <PaginationItem key={p}>
                      <PaginationLink
                        href="#"
                        isActive={p === page}
                        onClick={(e) => {
                          e.preventDefault();
                          setPage(p);
                        }}
                      >
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  );
                })}

                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setPage((p) => Math.min(totalPages, p + 1));
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
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

      {trackingService && (
        <StatusTrackingDialog
          serviceId={trackingService.id}
          clientEmail={trackingService.client_email}
          serviceDate={trackingService.service_date}
          serviceStatus={trackingService.status}
          hasTrackingCode={trackingService.has_tracking_code}
          open={Boolean(trackingService)}
          onOpenChange={(open) => {
            if (!open) setTrackingService(null);
          }}
        />
      )}
    </main>
  );
}
