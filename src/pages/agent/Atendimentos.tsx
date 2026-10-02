import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarDays, CheckCircle2, Download, Loader2, Package, Pencil, Search, X } from "lucide-react";
import { useOutletContext, useSearchParams } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { isUsableFilterDate } from "@/lib/filterDate";
import { useMyServicesQuery, type ServiceItem } from "@/features/services/useMyServicesQuery";
import { useAgentDailyMetricsQuery } from "@/features/agent/useAgentDailyMetricsQuery";
import { useMyAgentMetricsQuery } from "@/features/agent/useMyAgentMetricsQuery";
import { EditServiceDialog } from "@/features/services/EditServiceDialog";
import { DeleteServiceAlert } from "@/features/services/DeleteServiceAlert";
import { StatusTrackingDialog } from "@/features/services/StatusTrackingDialog";
import { useStatusTracking, useFollowUpsQuery } from "@/features/services/useStatusTracking";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import type { AgentOutletContext } from "@/layouts/AgentLayout";
import { AgentDailyMetricsSection } from "@/features/agent/components/AgentDailyMetricsSection";
import {
  CONTACT_REASONS,
  CONTACT_REASON_NOTE_MAX_LENGTH,
  formatContactReason,
  getContactReason,
  getContactReasonNoteCopy,
  normalizeContactReasonNote,
  requiresContactReasonNote,
  type ContactReasonCode,
} from "@/features/services/contact-reasons";
import { TransferTicketDialog, type DuplicateTicket } from "@/features/transfers/TransferTicketDialog";
import { exportAgentServices } from "@/lib/reportExport";

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
  "Honeyfil",
  "Clear Gaze",
  "PagAmerican",
  "Jellyrock",
  "Blue Horse",
  "Nail Defender",
  "Mind Honey Trick",
  "Nerve Relief Protocol",
  "Lean Leg",
  "Soda Burn",
  "Nerve Stride",
  "Honey Vital",
  "Cardio Honey",
  "Gut Active",
  "Military Honey",
  "Golden Nerves",
] as const;

const PLATFORMS = [
  "Nenhum",
  "Cartpanda",
  "CartCandy",
  "Buygoods",
  "ClickBank",
  "Digistore24",
  "SalesBound",
  "LogiCall",
  "PagAmerican",
] as const;

function todayISO() {
  // Use São Paulo date (avoid UTC date drift around midnight)
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function todayBRDisplay() {
  return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function toSaoPauloTimestamptz(dateOnly: string) {
  // services.service_date is timestamptz; if we send YYYY-MM-DD, Postgres will interpret as 00:00Z,
  // which becomes the previous day in São Paulo. We store midnight São Paulo explicitly.
  // São Paulo has no DST currently, so -03:00 is stable.
  return `${dateOnly}T00:00:00-03:00`;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function isPhoneComplete(v: string) {
  return /^\d{3}-\d{3}-\d{4}$/.test(v);
}

function addOneDayISO(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, m - 1, d + 1).toLocaleDateString("en-CA");
}

function formatCreatedAtTimeSP(value: string | null | undefined): string {
  if (!value) return "—";
  // Backend stores created_at without timezone in some rows (e.g. "2026-03-18T19:14:02.436").
  // Treat naive timestamps as UTC, then convert to São Paulo for display.
  const ts =
    /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const dt = new Date(ts);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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
  const { userId, fullName, canViewAllTickets, canRegisterDuplicateEmails, canClaimTickets } = useOutletContext<AgentOutletContext>();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // DEV-only: simulate the exact “hit 100” celebration without backend changes
  const [debugCelebrateNonce, setDebugCelebrateNonce] = useState(0);
  const [debugOverrideCount, setDebugOverrideCount] = useState<number | null>(null);
  const debugResetTimeoutRef = useRef<number | null>(null);

  // Form state
  const [clientEmail, setClientEmail] = useState("");
  const [serviceDate, setServiceDate] = useState(() => todayISO());
  const [product, setProduct] = useState("");
  const [platform, setPlatform] = useState("");
  const [channel, setChannel] = useState<"Clickbank" | "Email" | "SMS">("Email");
  const [hasTrackingCode, setHasTrackingCode] = useState(false);
  const [contactReason, setContactReason] = useState<ContactReasonCode | "">("");
  // Só é usado (e gravado) quando o motivo é "Outro (descrever)".
  const [contactReasonNote, setContactReasonNote] = useState("");
  // Número do pedido: só aparece (e só é exigido) quando o motivo é Reembolso —
  // é o dado que faltava para o sistema abrir o reembolso sozinho.
  const [orderId, setOrderId] = useState("");

  // Search & filter state. Default to "hoje" so the agent sees only today's
  // activity on opening the page — clean slate at the start of the day,
  // grows as the day progresses. To inspect older tickets they can search by
  // e-mail or change the date range.
  const [emailSearch, setEmailSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(() => todayISO());
  const [dateTo, setDateTo] = useState(() => todayISO());
  const [filterTrackingCode, setFilterTrackingCode] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  // Exportação da planilha (Excel) dos atendimentos do período selecionado.
  const [exporting, setExporting] = useState(false);

  // Edit dialog state
  const [editing, setEditing] = useState<ServiceItem | null>(null);

  // Status tracking
  const [trackingService, setTrackingService] = useState<ServiceItem | null>(null);
  // Cross-agent duplicate: shows TransferTicketDialog when the email belongs to another agent's open ticket
  const [transferTarget, setTransferTarget] = useState<DuplicateTicket | null>(null);
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

      setConcludingId(s.id);
      try {
        await addEntryMutation.mutateAsync({ serviceId: s.id, status: "concluido", observation: "" });
        toast({ title: "Atendimento concluído", description: "Ticket registrado como concluído." });
      } catch (error) {
        // Surface the real failure (network drop, expired session, RLS, etc.)
        // instead of silently swallowing it — a swallowed error is what makes
        // the agent believe the action saved when it didn't.
        console.error("[quick-conclude] failed:", error);
        const message =
          error instanceof Error ? error.message : "Não foi possível concluir o atendimento.";
        toast({
          title: "Erro ao concluir",
          description: message,
          variant: "destructive",
        });
      } finally {
        setConcludingId(null);
      }
    },
    [canAddInteraction, addEntryMutation, toast],
  );

  const handleExport = useCallback(async () => {
    if (!dateFrom || !dateTo) {
      toast({
        title: "Selecione o período",
        description: "Escolha a data inicial e final antes de exportar.",
        variant: "destructive",
      });
      return;
    }
    setExporting(true);
    try {
      const count = await exportAgentServices({ fromISO: dateFrom, toISO: dateTo });
      toast({
        title: "Exportação concluída",
        description: `${count} atendimento(s) exportado(s) para a planilha.`,
      });
    } catch (error) {
      console.error("[export-services] failed:", error);
      const message = error instanceof Error ? error.message : "Não foi possível gerar a planilha.";
      toast({ title: "Erro ao exportar", description: message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }, [dateFrom, dateTo, toast]);

  const { data: services = [], isLoading: servicesLoading } = useMyServicesQuery(Boolean(userId), canViewAllTickets);
  const { data: dailyMetrics, isLoading: metricsLoading } = useAgentDailyMetricsQuery(Boolean(userId));
  // useStatusTracking already calls this internally; React Query deduplicates it — no extra request.
  const {
    data: allFollowUps = [],
    isPending: followUpsPending,
    isError: followUpsError,
  } = useFollowUpsQuery(Boolean(userId));

  // Enquanto os follow-ups não chegaram (primeira carga) ou falharam sem nenhum
  // dado em cache, NÃO podemos calcular status — o mapa vazio faria todo ticket
  // aparecer como "Novo" (era exatamente o bug). Nesses casos mostramos um
  // placeholder no badge em vez de fabricar "Novo". Com dado (mesmo em erro de
  // refetch, quando o cache anterior persiste) o status real é exibido.
  const followUpsUnavailable = allFollowUps.length === 0 && (followUpsPending || followUpsError);

  // Map id -> full_name for displaying ticket owner when supervisor (RLS gates this query for non-supervisors).
  const { data: agentNamesMap = {} } = useQuery<Record<string, string>>({
    queryKey: ["profiles", "agent-names"],
    enabled: Boolean(userId) && canViewAllTickets,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("role", "agent");
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        if (row?.id) map[row.id] = row.full_name ?? "—";
      }
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });

  // When the agent accepts a transfer notification, NotificationsBell redirects here with
  // ?openTicket=<service_id>. Open the tracking dialog for that ticket and clean the URL.
  useEffect(() => {
    const openId = searchParams.get("openTicket");
    if (!openId || services.length === 0) return;
    const target = services.find((s) => s.id === openId);
    if (target) {
      setTrackingService(target);
      searchParams.delete("openTicket");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, services, setSearchParams]);

  // Build a Set of service IDs where THIS agent registered a follow-up within the
  // active date range. Mirrors the manager's dashboard_metrics logic so both screens
  // attribute the attendance to the doer of the action (not the ticket owner).
  // Uses Intl.DateTimeFormat (SP timezone) — same approach as handleQuickConclude.
  // Strips sub-millisecond precision (Supabase returns microseconds which some browsers reject).
  const followUpServiceIds = useMemo<Set<string>>(() => {
    if (!dateFrom && !dateTo) return new Set();
    if (!userId) return new Set();
    const spFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" });
    const set = new Set<string>();
    for (const f of allFollowUps) {
      if (f.user_id !== userId) continue;
      if (!f.recorded_at) continue;
      // Normalize: "2026-04-30T17:30:00.123456+00:00" → "2026-04-30T17:30:00+00:00"
      const d = new Date(f.recorded_at.replace(/\.\d+/, ""));
      if (isNaN(d.getTime())) continue;
      const spDate = spFmt.format(d); // "YYYY-MM-DD" in SP timezone
      if ((!dateFrom || spDate >= dateFrom) && (!dateTo || spDate <= dateTo)) {
        set.add(f.service_id);
      }
    }
    return set;
  }, [allFollowUps, dateFrom, dateTo, userId]);

  const filteredServices = useMemo(() => {
    let result = services;

    if (emailSearch) {
      const term = emailSearch.toLowerCase();
      result = result.filter((s) => s.client_email.toLowerCase().includes(term));
    }

    // Date filter applies only when the agent is NOT searching by e-mail.
    // Searching by e-mail should locate the ticket regardless of how old it is —
    // the date range exists to scope daily activity, not to limit search.
    // Include services where service_date is in range OR a follow-up was recorded in range.
    // Each interaction on a previous ticket counts as +1 attendance on the interaction date.
    if (!emailSearch && (dateFrom || dateTo)) {
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

  /** "Total de atendimentos" do período = número de INTERAÇÕES (criações +
   *  follow-ups), pela mesma fonte de verdade do card de cima e do dashboard do
   *  gestor (agent_my_metrics -> _interaction_events). Assim os dois cards batem.
   *  Quando o agente está buscando por e-mail ou filtrando por cód. de rastreio,
   *  a RPC (que não conhece esses filtros) não se aplica — aí mostramos a
   *  contagem da própria tabela filtrada, como "resultados encontrados". */
  // A RPC só recebe as datas depois que a digitação para e quando o ano é
  // plausível: enquanto se digita o ano, o input emite "0002-…", "0020-…" etc.
  // (ver isUsableFilterDate). A tabela continua filtrando na hora.
  const metricsDateFrom = useDebouncedValue(dateFrom, 400);
  const metricsDateTo = useDebouncedValue(dateTo, 400);
  const metricsDatesUsable =
    (!metricsDateFrom || isUsableFilterDate(metricsDateFrom)) &&
    (!metricsDateTo || isUsableFilterDate(metricsDateTo));
  const rangeMetricsFrom = metricsDateFrom || "2025-01-01";
  const rangeMetricsTo = metricsDateTo || todayISO();
  const isFilteringTable = Boolean(emailSearch) || filterTrackingCode;
  const { data: rangeMetrics } = useMyAgentMetricsQuery({
    enabled: Boolean(userId) && !isFilteringTable && metricsDatesUsable,
    from: rangeMetricsFrom,
    to: rangeMetricsTo,
  });
  const totalFilteredInteractions = isFilteringTable
    ? filteredServices.length
    : rangeMetrics?.total_count ?? 0;

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

  const isRefund = contactReason === "reembolso";
  // Motivos "Outro" e "Reclamação VSL" pedem descrição livre — cada um com seu texto.
  const contactReasonNoteCopy = getContactReasonNoteCopy(contactReason);

  const canSubmit = useMemo(() => {
    const emailOk = channel === "SMS" ? isPhoneComplete(clientEmail) : Boolean(clientEmail);
    const orderOk = !isRefund || orderId.trim().length > 0;
    // Motivo que pede descrição sem texto não registra nada de útil.
    const reasonOk =
      Boolean(contactReason) &&
      (!requiresContactReasonNote(contactReason) || contactReasonNote.trim().length > 0);
    return emailOk && Boolean(serviceDate) && Boolean(product) && Boolean(platform) && reasonOk && orderOk;
  }, [clientEmail, serviceDate, product, platform, channel, contactReason, contactReasonNote, isRefund, orderId]);

  const greetingName = useMemo(() => {
    const trimmed = (fullName ?? "").trim();
    return trimmed.length > 0 ? trimmed : "Time";
  }, [fullName]);

  const concludeAfterCreate = useRef(false);

  const createMutation = useMutation({
    mutationFn: async (): Promise<
      | { kind: "created"; ticket: ServiceItem }
      | { kind: "mine"; serviceId: string }
      | { kind: "other_agent"; ticket: DuplicateTicket }
    > => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada");

      // Cross-agent duplicate check via RPC (SECURITY DEFINER bypasses RLS).
      // Returns the most recent NON-concluded ticket for this client_email, if any.
      const { data: foundRows, error: rpcError } = await supabase.rpc("find_ticket_by_email", {
        p_email: clientEmail.trim(),
      });
      if (rpcError) throw rpcError;

      const found = (foundRows?.[0] ?? null) as DuplicateTicket | null;

      if (found) {
        // "mine" = sou o dono operacional atual (current_owner). Cobre o caso de
        // ticket redistribuído pelo gestor: o criador pode ser outro, mas se eu
        // sou o current_owner agora, abro direto como meu. Supervisor (can_view_all)
        // continua entrando aqui para qualquer ticket.
        if (found.current_owner_id === session.user.id || canViewAllTickets) {
          return { kind: "mine", serviceId: found.id };
        }
        // Agente com permissão de duplicar emails cross-agent: ignora o ticket alheio
        // e segue para criar o ticket próprio, mesmo havendo duplicidade no banco.
        if (!canRegisterDuplicateEmails) {
          return { kind: "other_agent", ticket: found };
        }
      }

      const { data: inserted, error } = await supabase
        .from("services")
        .insert({
          client_email: clientEmail.trim(),
          service_date: toSaoPauloTimestamptz(todayISO()),
          product,
          platform,
          channel,
          has_tracking_code: hasTrackingCode,
          contact_reason: contactReason || null,
          contact_reason_note: normalizeContactReasonNote(contactReason, contactReasonNote),
          // Alimenta o registro automático em Reembolsos (trigger sync_refund_from_service).
          order_id: contactReason === "reembolso" ? orderId.trim() : null,
          // "concluido" directly avoids a follow-up insert, preventing double-counting in daily metrics
          status: concludeAfterCreate.current ? "concluido" : "registered",
          user_id: session.user.id,
        })
        .select("id, client_email, service_date, product, platform, channel, status, created_at, has_tracking_code, contact_reason, contact_reason_note, user_id, current_owner_id")
        .single();

      if (error) throw error;
      return { kind: "created", ticket: inserted as ServiceItem };
    },
    onSuccess: async (result) => {
      if (result.kind === "mine") {
        concludeAfterCreate.current = false;

        // Fallback: pode ser ticket de outro agente que ainda não está no array local
        // (cache da query). Busca direto por id — RLS permite quando canViewAllTickets.
        let mine = services.find((s) => s.id === result.serviceId);
        if (!mine) {
          const { data, error } = await supabase
            .from("services")
            .select("id, client_email, service_date, product, platform, channel, status, created_at, has_tracking_code, contact_reason, contact_reason_note, user_id, current_owner_id")
            .eq("id", result.serviceId)
            .maybeSingle();
          if (error) {
            console.error("[create-service] fetch existing ticket failed:", error);
          } else if (data) {
            mine = data as ServiceItem;
            // Garante que esse ticket apareça na tabela depois que o dialog fechar
            await queryClient.invalidateQueries({ queryKey: ["services", "me"] });
          }
        }

        toast({
          title: "E-mail já cadastrado",
          description: "Abrindo o acompanhamento do atendimento existente.",
        });
        if (mine) setTrackingService(mine);
        return;
      }

      if (result.kind === "other_agent") {
        concludeAfterCreate.current = false;
        setTransferTarget(result.ticket);
        return;
      }

      const shouldConclude = concludeAfterCreate.current;
      concludeAfterCreate.current = false;

      setClientEmail("");
      setServiceDate(todayISO());
      setProduct("");
      setPlatform("");
      setChannel("Email");
      setHasTrackingCode(false);
      setContactReason("");
      setOrderId("");
      setContactReasonNote("");

      // Optimistic update: prepend o ticket recém-criado em todas as variações da
      // query (chave inclui sufixo de cutoff de data). A tabela atualiza instantâneo
      // mesmo se o refetch demorar.
      queryClient.setQueriesData<ServiceItem[]>(
        { queryKey: ["services", "me"] },
        (prev) => (prev ? [result.ticket, ...prev.filter((s) => s.id !== result.ticket.id)] : [result.ticket]),
      );

      await queryClient.invalidateQueries({ queryKey: ["services", "me"] });
      await queryClient.invalidateQueries({ queryKey: ["agent", "daily-metrics"] });

      // Motivo Reembolso: o banco já criou o registro na aba Reembolsos.
      const createdRefund = result.ticket.contact_reason === "reembolso";
      if (createdRefund) {
        await queryClient.invalidateQueries({ queryKey: ["refunds", "me"] });
      }

      toast(
        shouldConclude
          ? {
              title: "Atendimento concluído",
              description: createdRefund
                ? "Ticket registrado e concluído. O reembolso já está na aba Reembolsos, aguardando você assumir."
                : "Ticket registrado e marcado como concluído.",
            }
          : {
              title: "Atendimento registrado",
              description: createdRefund
                ? "Registro salvo. O reembolso já está na aba Reembolsos, aguardando você assumir."
                : "Seu registro foi salvo com sucesso.",
            },
      );
    },
    onError: (error: unknown) => {
      concludeAfterCreate.current = false;
      console.error("[create-service] failed:", error);
      const message = error instanceof Error ? error.message : "Não foi possível registrar o atendimento.";
      toast({
        title: "Erro ao registrar",
        description: message,
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
    onError: (error: unknown) => {
      console.error("[delete-service] failed:", error);
      const message = error instanceof Error ? error.message : "Não foi possível excluir o atendimento.";
      toast({
        title: "Erro ao excluir",
        description: message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: string; client_email: string; product: string; platform: string; channel: string; contact_reason: string | null; contact_reason_note: string | null; order_id: string | null }) => {
      // service_date is frozen by a database trigger; we never send it from the
      // edit flow. Manager corrections go through manager_correct_service_date.
      const { error } = await supabase
        .from("services")
        .update({
          client_email: payload.client_email,
          product: payload.product,
          platform: payload.platform,
          channel: payload.channel,
          contact_reason: payload.contact_reason,
          contact_reason_note: payload.contact_reason_note,
          order_id: payload.order_id,
        })
        .eq("id", payload.id);

      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["services", "me"] });
      // A edição pode ter criado/atualizado o reembolso vinculado.
      await queryClient.invalidateQueries({ queryKey: ["refunds", "me"] });
      toast({
        title: "Atendimento atualizado",
        description: "As alterações foram salvas.",
      });
    },
    onError: (error: unknown) => {
      console.error("[edit-service] failed:", error);
      const message = error instanceof Error ? error.message : "Não foi possível atualizar o atendimento.";
      toast({
        title: "Erro ao atualizar",
        description: message,
        variant: "destructive",
      });
    },
  });

  const claimMutation = useMutation({
    mutationFn: async (t: DuplicateTicket): Promise<ServiceItem> => {
      const { data, error } = await supabase.rpc("claim_ticket", { p_service_id: t.id });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as ServiceItem | undefined;
      if (!row) throw new Error("Não foi possível assumir o atendimento.");
      return row;
    },
    onSuccess: async (row) => {
      // O ticket agora é da agente: aparece na lista dela e ela pode registrar a
      // interação. Fecha o diálogo de duplicidade e abre o acompanhamento.
      await queryClient.invalidateQueries({ queryKey: ["services", "me"] });
      setTransferTarget(null);
      setTrackingService(row);
      toast({
        title: "Atendimento assumido",
        description: "Agora você é o responsável. Registre a interação.",
      });
    },
    onError: (error: unknown) => {
      console.error("[claim-ticket] failed:", error);
      const message = error instanceof Error ? error.message : "Não foi possível assumir o atendimento.";
      toast({ title: "Erro ao assumir", description: message, variant: "destructive" });
    },
  });

  const requestApprovalMutation = useMutation({
    mutationFn: async ({ ticket, note }: { ticket: DuplicateTicket; note: string }) => {
      const { error } = await supabase.rpc("request_ticket_takeover", {
        p_service_id: ticket.id,
        p_note: note.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTransferTarget(null);
      // Limpa o formulário; o ticket só vira do agente após a gestora aprovar.
      setClientEmail("");
      setProduct("");
      setPlatform("");
      setChannel("Email");
      setHasTrackingCode(false);
      setContactReason("");
      setOrderId("");
      setContactReasonNote("");
      toast({
        title: "Pedido enviado",
        description:
          "A gestora foi notificada. Assim que aprovado, o atendimento aparecerá na sua lista.",
      });
    },
    onError: (error: unknown) => {
      console.error("[request-takeover] failed:", error);
      const message = error instanceof Error ? error.message : "Não foi possível enviar o pedido.";
      toast({ title: "Erro ao solicitar", description: message, variant: "destructive" });
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
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${supportChannel === "sms" ? "bg-aqua-soft text-aqua" : "bg-ice-soft text-info"}`}>
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
                onClick={() => {
                  if ((ch === "SMS") !== (channel === "SMS")) setClientEmail("");
                  setChannel(ch);
                }}
              >
                {ch}
              </Button>
            ))}
            <div className="ml-4 flex items-center gap-2 border-l pl-4">
              <Label
                htmlFor="tracking-code-toggle"
                className="text-sm cursor-pointer text-muted-foreground"
              >
                Cód. Rastreio
              </Label>
              <Switch
                id="tracking-code-toggle"
                checked={hasTrackingCode}
                onCheckedChange={setHasTrackingCode}
              />
            </div>
          </div>
          <form onSubmit={handleCreate} className="grid gap-4 lg:grid-cols-6 lg:items-end">
            <div className="grid gap-2">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="clientEmail">E-mail do Cliente</Label>
                {channel === "SMS" && (
                  <span className="text-[11px] text-muted-foreground leading-none">ou número de telefone</span>
                )}
              </div>
              <Input
                id="clientEmail"
                type={channel === "SMS" ? "text" : "email"}
                placeholder={channel === "SMS" ? "954-662-8786" : "cliente@email.com"}
                value={clientEmail}
                onChange={(e) =>
                  setClientEmail(channel === "SMS" ? formatPhone(e.target.value) : e.target.value)
                }
                required
              />
            </div>

            <div className="grid gap-2">
              <Label>Data do Atendimento</Label>
              <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                Hoje ({todayBRDisplay()})
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

            <div className="grid gap-2">
              <Label>Motivo de contato</Label>
              <Select
                value={contactReason}
                onValueChange={(v) => {
                  setContactReason(v as ContactReasonCode);
                  // A nota pertence aos motivos que a pedem; trocar o motivo a
                  // descarta (o CHECK do banco também recusaria nota nos demais).
                  if (!requiresContactReasonNote(v)) setContactReasonNote("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {CONTACT_REASONS.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      <span className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${r.dot}`} />
                        {r.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {contactReasonNoteCopy && (
              <div className="grid gap-2 lg:col-span-3">
                <Label htmlFor="contactReasonNote">{contactReasonNoteCopy.label}</Label>
                <Textarea
                  id="contactReasonNote"
                  value={contactReasonNote}
                  onChange={(e) =>
                    setContactReasonNote(e.target.value.slice(0, CONTACT_REASON_NOTE_MAX_LENGTH))
                  }
                  maxLength={CONTACT_REASON_NOTE_MAX_LENGTH}
                  rows={2}
                  placeholder={contactReasonNoteCopy.placeholder}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {contactReasonNoteCopy.hint}{" "}
                  {contactReasonNote.length}/{CONTACT_REASON_NOTE_MAX_LENGTH}
                </p>
              </div>
            )}

            {isRefund && (
              <div className="grid gap-2">
                <Label htmlFor="order-id">Número do pedido</Label>
                <Input
                  id="order-id"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  placeholder="Ex: 12345"
                />
                <p className="text-xs text-muted-foreground">
                  Com o número do pedido, o reembolso é criado sozinho na aba Reembolsos — não precisa cadastrar de novo.
                </p>
              </div>
            )}

            <div className="flex gap-2 lg:justify-end">
              <Button type="submit" className="flex-1 lg:flex-none" disabled={!canSubmit || createMutation.isPending}>
                {createMutation.isPending && !concludeAfterCreate.current ? "Registrando..." : "Registrar"}
              </Button>
              {channel === "SMS" && (
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 gap-1.5 border-success text-success hover:bg-signal-soft hover:text-ink lg:flex-none"
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
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-medium">Meus Atendimentos Recentes</h2>
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
                  title="Ver tudo (limpar datas)"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {(() => {
                const today = todayISO();
                const isToday = dateFrom === today && dateTo === today;
                if (isToday) return null;
                return (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => { setDateFrom(today); setDateTo(today); }}
                    title="Voltar para o dia de hoje"
                  >
                    Hoje
                  </Button>
                );
              })()}
            </div>
            <div className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-xs">
              <span className="text-muted-foreground">Total de atendimentos:</span>
              <span className="font-medium text-foreground">{totalFilteredInteractions}</span>
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={handleExport}
              disabled={exporting || !dateFrom || !dateTo}
              title={
                !dateFrom || !dateTo
                  ? "Selecione a data inicial e final para exportar"
                  : "Exportar os atendimentos do período para Excel"
              }
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {exporting ? "Exportando..." : "Exportar (Excel)"}
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
                <TableHead>Data de abertura</TableHead>
                <TableHead className="w-[80px]">Hora</TableHead>
                {canViewAllTickets && <TableHead>Agente</TableHead>}
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
                  <TableCell colSpan={canViewAllTickets ? 9 : 8} className="py-10 text-center">
                    {(() => {
                      const today = todayISO();
                      const isTodayDefault =
                        dateFrom === today &&
                        dateTo === today &&
                        !emailSearch &&
                        !filterTrackingCode;
                      if (isTodayDefault) {
                        return (
                          <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                            <span className="text-sm font-medium text-foreground">Pronto para começar o dia 🚀</span>
                            <span className="text-xs">Seu primeiro atendimento de hoje aparecerá aqui assim que registrado.</span>
                          </div>
                        );
                      }
                      return (
                        <span className="text-sm text-muted-foreground">
                          {emailSearch || dateFrom || dateTo || filterTrackingCode
                            ? "Nenhum atendimento encontrado com os filtros aplicados."
                            : "Nenhum atendimento registrado ainda."}
                        </span>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedServices.map((s, idx) => {
                  const reason = getContactReason(s.contact_reason);
                  const reasonTitle = reason
                    ? `Motivo: ${formatContactReason(s.contact_reason, s.contact_reason_note)}`
                    : "Sem motivo registrado";
                  return (
                  <TableRow key={s.id} className={idx % 2 === 1 ? "bg-muted/40" : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block h-2 w-2 shrink-0 rounded-full ${reason ? reason.dot : "bg-transparent ring-1 ring-border"}`}
                          title={reasonTitle}
                          aria-label={reasonTitle}
                        />
                        <span>
                          {(() => {
                            const dt = parseServiceDateForDisplay(s.service_date);
                            return dt ? format(dt, "dd/MM/yyyy") : "—";
                          })()}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums text-muted-foreground">
                      {formatCreatedAtTimeSP(s.created_at)}
                    </TableCell>
                    {canViewAllTickets && (
                      <TableCell className="text-sm">
                        {s.user_id === userId ? (
                          <span className="text-muted-foreground">Você</span>
                        ) : (
                          <span className="font-medium">{agentNamesMap[s.user_id] ?? "—"}</span>
                        )}
                      </TableCell>
                    )}
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
                            className="h-6 w-6 text-success hover:bg-signal-soft hover:text-success"
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
                      {followUpsUnavailable ? (
                        // Follow-ups ainda carregando/indisponíveis: não fabricar "Novo".
                        <Skeleton className="h-5 w-24" />
                      ) : (
                        (() => {
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
                        })()
                      )}
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

                        {s.current_owner_id === userId && (
                          <DeleteServiceAlert
                            disabled={deleteMutation.isPending}
                            onConfirm={async () => {
                              await deleteMutation.mutateAsync(s.id);
                            }}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })
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

      <TransferTicketDialog
        open={Boolean(transferTarget)}
        onOpenChange={(open) => {
          if (!open) setTransferTarget(null);
        }}
        ticket={transferTarget}
        claiming={claimMutation.isPending}
        onClaim={
          canClaimTickets
            ? async (t) => {
                await claimMutation.mutateAsync(t);
              }
            : undefined
        }
        requestingApproval={requestApprovalMutation.isPending}
        onRequestApproval={async (t, note) => {
          await requestApprovalMutation.mutateAsync({ ticket: t, note });
        }}
        onTransferred={() => {
          // Clear the form so the agent can move on; the ticket stays with the original owner.
          setClientEmail("");
          setProduct("");
          setPlatform("");
          setChannel("Email");
          setHasTrackingCode(false);
          setContactReason("");
          setOrderId("");
          setContactReasonNote("");
        }}
      />
    </main>
  );
}
