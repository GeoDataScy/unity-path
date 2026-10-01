// Radar — detalhe do caso + registro de ação.
//
// É aqui que a ferramenta cumpre a função: a cada ação registrada o agente diz o
// que fez, em que pé o caso está e QUANDO volta a olhar. O histórico embaixo é
// append-only — dá para reconstruir o caso inteiro sem perguntar para ninguém.
//
// Regra da data (espelhada no banco, em radar_register_action):
//   status em aberto  -> data do próximo acompanhamento OBRIGATÓRIA
//   resolvido/cancelado -> sem data; o caso sai do radar

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Clock, Mail, Package, Radar, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabaseErrorMessage } from "@/lib/supabaseError";
import { useRadarEventsQuery, useRegisterRadarActionMutation } from "./useMyRadarQuery";
import {
  dueLabel,
  formatBrDate,
  suggestNextFollowUp,
  suggestionHint,
  todayInSaoPaulo,
} from "./nextFollowUp";
import {
  RADAR_STATUSES,
  getRadarKind,
  getRadarStatus,
  isRadarStatusOpen,
  radarStatusLabel,
  type MyRadarItem,
  type RadarStatus,
} from "./types";

function formatBrDateTime(value: string | null): string {
  if (!value) return "";
  // Timestamp "naive" (sem fuso) é tratado como UTC, igual às demais telas.
  const ts = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const dt = new Date(ts);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type Props = {
  item: MyRadarItem | null;
  /** 'hoje' do servidor, para o rótulo de prazo não depender do relógio local. */
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RadarActionDialog({ item, today, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const eventsQuery = useRadarEventsQuery(open ? item?.id ?? null : null);
  const registerMutation = useRegisterRadarActionMutation();

  const [status, setStatus] = useState<RadarStatus>("em_andamento");
  const [action, setAction] = useState("");
  const [nextDate, setNextDate] = useState("");
  const dateTouched = useRef(false);

  useEffect(() => {
    if (!open || !item) return;
    dateTouched.current = false;
    // Um caso fechado que o agente reabre volta como "Em andamento"; um caso
    // aberto parte do status que ele já tem, para o agente só confirmar.
    const initial: RadarStatus = isRadarStatusOpen(item.status) ? item.status : "em_andamento";
    setStatus(initial);
    setAction("");
    setNextDate(suggestNextFollowUp(item.kind));
  }, [open, item]);

  const statusIsOpen = isRadarStatusOpen(status);

  const handleStatusChange = (value: string) => {
    const next = value as RadarStatus;
    setStatus(next);
    if (isRadarStatusOpen(next) && !dateTouched.current && item) {
      setNextDate(suggestNextFollowUp(item.kind));
    }
  };

  const minDate = useMemo(() => todayInSaoPaulo(), []);

  if (!item) return null;

  const kindMeta = getRadarKind(item.kind);
  const currentStatusMeta = getRadarStatus(item.status);
  const events = eventsQuery.data ?? [];
  const canSubmit = action.trim() !== "" && (!statusIsOpen || nextDate !== "");

  const handleSubmit = async () => {
    try {
      await registerMutation.mutateAsync({
        itemId: item.id,
        status,
        action: action.trim(),
        nextFollowUpDate: statusIsOpen ? nextDate : null,
      });
      toast({
        title: "Ação registrada",
        description: statusIsOpen
          ? `Próximo acompanhamento em ${formatBrDate(nextDate)}.`
          : `Caso ${radarStatusLabel(status).toLowerCase()} e fora do radar.`,
      });
      setAction("");
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Erro ao registrar",
        description: supabaseErrorMessage(e, "Não foi possível registrar a ação."),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            {item.order_number ? `Pedido ${item.order_number}` : "Sem número de pedido"}
            {kindMeta && (
              <Badge variant="secondary" className="gap-1.5">
                <span className={`h-2 w-2 rounded-full ${kindMeta.dot}`} />
                {kindMeta.label}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" /> {item.client_email}
            </span>
            {item.product && (
              <span className="inline-flex items-center gap-1">
                <Package className="h-3.5 w-3.5" /> {item.product}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Ação necessária — o motivo de o caso existir. */}
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Ação necessária
          </p>
          <p className="mt-1 text-sm">{item.action_needed}</p>
        </div>

        {/* Dados que o sistema preencheu sozinho. */}
        <div className="grid gap-1.5 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> Criado em {formatBrDateTime(item.created_at)}
            </span>
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" /> {item.agent_name ?? "—"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span>Status:</span>
            <Badge variant={currentStatusMeta?.variant ?? "secondary"}>
              {radarStatusLabel(item.status)}
            </Badge>
            {item.next_follow_up_date ? (
              <span className={item.is_overdue ? "font-medium text-destructive" : ""}>
                Próximo acompanhamento: {formatBrDate(item.next_follow_up_date)} (
                {dueLabel(item.next_follow_up_date, today)})
              </span>
            ) : (
              <span>Fechado em {formatBrDateTime(item.closed_at)}</span>
            )}
          </div>
          {item.notes && <div>Obs.: {item.notes}</div>}
        </div>

        {/* Histórico */}
        <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border p-3">
          <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Histórico ({item.event_count})
          </p>
          {eventsQuery.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : eventsQuery.isError ? (
            <p className="py-2 text-center text-xs text-destructive">
              {supabaseErrorMessage(eventsQuery.error, "Não foi possível carregar o histórico.")}
            </p>
          ) : events.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">Nenhum registro ainda.</p>
          ) : (
            events.map((e) => (
              <div key={e.id} className="border-l-2 border-primary/30 pl-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={getRadarStatus(e.status)?.variant ?? "secondary"}
                    className="px-1.5 py-0 text-[10px]"
                  >
                    {radarStatusLabel(e.status)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatBrDateTime(e.recorded_at)}
                  </span>
                  {e.user_name && (
                    <span className="text-xs text-muted-foreground">· {e.user_name}</span>
                  )}
                </div>
                {e.action && <p className="mt-1 text-xs">{e.action}</p>}
                {e.next_follow_up_date && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Próximo acompanhamento marcado para {formatBrDate(e.next_follow_up_date)}
                  </p>
                )}
              </div>
            ))
          )}
        </div>

        {/* Registrar ação */}
        <div className="grid gap-4 rounded-lg border bg-card p-4">
          <p className="text-sm font-medium">Registrar ação</p>

          <div className="grid gap-2">
            <Label htmlFor="radar-action-status">Status</Label>
            <Select value={status} onValueChange={handleStatusChange}>
              <SelectTrigger id="radar-action-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RADAR_STATUSES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="radar-action-text">O que foi feito *</Label>
            <Textarea
              id="radar-action-text"
              rows={3}
              placeholder="Ex.: cobrei o parceiro pelo status do RMA, sem resposta ainda."
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </div>

          {statusIsOpen ? (
            <div className="grid gap-2">
              <Label htmlFor="radar-action-next" className="flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4" /> Data do próximo acompanhamento *
              </Label>
              <Input
                id="radar-action-next"
                type="date"
                min={minDate}
                value={nextDate}
                onChange={(e) => {
                  dateTouched.current = true;
                  setNextDate(e.target.value);
                }}
              />
              <p className="text-xs text-muted-foreground">
                {dateTouched.current ? "Data definida por você." : suggestionHint(item.kind)}
              </p>
            </div>
          ) : (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Caso {radarStatusLabel(status).toLowerCase()} sai do radar e não pede mais data de
              acompanhamento. Se voltar, basta registrar outra ação com status em aberto.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || registerMutation.isPending}
          >
            {registerMutation.isPending ? "Registrando..." : "Registrar ação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
