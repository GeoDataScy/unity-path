import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, X, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  useTransferNotificationsQuery,
  type TransferNotification,
} from "@/features/transfers/useTransferNotificationsQuery";
import { playNotificationSound } from "@/features/transfers/notificationSound";

function formatRelativeTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

type Props = {
  enabled: boolean;
};

export function NotificationsBell({ enabled }: Props) {
  const { data: notifications = [], isLoading } = useTransferNotificationsQuery(enabled);
  const [open, setOpen] = useState(false);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const totalCount = notifications.length;

  // Play a chime when the count increases. First load (prev = null) stays silent
  // so we don't ding for items that already existed when the agent opened the app.
  const prevCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const prev = prevCountRef.current;
    if (prev !== null && totalCount > prev) {
      playNotificationSound();
    }
    prevCountRef.current = totalCount;
  }, [totalCount, enabled]);

  const accept = useMutation({
    mutationFn: async (n: TransferNotification) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("ticket_transfers")
        .update({
          status: "accepted",
          responded_at: now,
          recipient_seen_at: now,
        })
        .eq("id", n.transfer_id);
      if (error) throw error;
      return n;
    },
    onSuccess: async (n) => {
      await queryClient.invalidateQueries({ queryKey: ["transfer_notifications"] });
      setOpen(false);
      toast({
        title: "Aceito",
        description: `Abrindo o atendimento do cliente ${n.client_email}.`,
      });
      // Redirect to Atendimentos with the ticket auto-opened in the tracking dialog.
      navigate(`/workspace?openTicket=${encodeURIComponent(n.service_id)}`);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Não foi possível aceitar.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    },
  });

  const decline = useMutation({
    mutationFn: async ({ n, note }: { n: TransferNotification; note: string }) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("ticket_transfers")
        .update({
          status: "declined",
          responded_at: now,
          recipient_seen_at: now,
          response_note: note.trim() || null,
        })
        .eq("id", n.transfer_id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transfer_notifications"] });
      setDecliningId(null);
      setDeclineNote("");
      toast({ title: "Recusado", description: "Pedido marcado como recusado." });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Não foi possível recusar.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    },
  });

  const markSeen = useMutation({
    mutationFn: async (n: TransferNotification) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("ticket_transfers")
        .update({ requester_seen_at: now })
        .eq("id", n.transfer_id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transfer_notifications"] });
    },
  });

  if (!enabled) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          className="relative bg-white/10 text-dashboard-sidebar-foreground hover:bg-white/15"
          aria-label="Notificações"
        >
          <Bell className="h-4 w-4" />
          {totalCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {totalCount > 9 ? "9+" : totalCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Notificações</h3>
          <p className="text-xs text-muted-foreground">
            Encaminhamentos de tickets dos seus colegas
          </p>
        </div>

        <ScrollArea className="max-h-96">
          {isLoading && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Carregando...</p>
          )}
          {!isLoading && notifications.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nada por aqui.
            </p>
          )}

          <ul className="divide-y">
            {notifications.map((n) => (
              <li key={n.transfer_id} className="p-3">
                {n.role === "inbox" ? (
                  <InboxItem
                    n={n}
                    isDeclining={decliningId === n.transfer_id}
                    declineNote={declineNote}
                    onDeclineNoteChange={setDeclineNote}
                    onStartDecline={() => {
                      setDecliningId(n.transfer_id);
                      setDeclineNote("");
                    }}
                    onCancelDecline={() => {
                      setDecliningId(null);
                      setDeclineNote("");
                    }}
                    onAccept={() => accept.mutate(n)}
                    onConfirmDecline={() => decline.mutate({ n, note: declineNote })}
                    acceptPending={accept.isPending}
                    declinePending={decline.isPending}
                  />
                ) : (
                  <ResponseItem
                    n={n}
                    onMarkSeen={() => markSeen.mutate(n)}
                    markSeenPending={markSeen.isPending}
                  />
                )}
              </li>
            ))}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

type InboxItemProps = {
  n: TransferNotification;
  isDeclining: boolean;
  declineNote: string;
  onDeclineNoteChange: (v: string) => void;
  onStartDecline: () => void;
  onCancelDecline: () => void;
  onAccept: () => void;
  onConfirmDecline: () => void;
  acceptPending: boolean;
  declinePending: boolean;
};

function InboxItem({
  n,
  isDeclining,
  declineNote,
  onDeclineNoteChange,
  onStartDecline,
  onCancelDecline,
  onAccept,
  onConfirmDecline,
  acceptPending,
  declinePending,
}: InboxItemProps) {
  return (
    <div className="grid gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm">
          <p>
            <span className="font-medium">{n.other_agent_name ?? "Outro agente"}</span>{" "}
            <span className="text-muted-foreground">pediu pra continuar o ticket</span>
          </p>
          <p className="break-all text-xs text-muted-foreground">
            {n.client_email} · {n.product}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatRelativeTime(n.created_at)}
        </span>
      </div>

      {n.message && (
        <p className="rounded-md bg-muted/40 px-2 py-1.5 text-xs italic text-muted-foreground">
          "{n.message}"
        </p>
      )}

      {isDeclining ? (
        <div className="grid gap-2">
          <Textarea
            placeholder="Motivo (opcional)"
            value={declineNote}
            onChange={(e) => onDeclineNoteChange(e.target.value)}
            rows={2}
            maxLength={300}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancelDecline} disabled={declinePending}>
              Cancelar
            </Button>
            <Button size="sm" onClick={onConfirmDecline} disabled={declinePending}>
              {declinePending ? "Enviando..." : "Confirmar recusa"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onStartDecline}
            disabled={acceptPending}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Recusar
          </Button>
          <Button size="sm" onClick={onAccept} disabled={acceptPending}>
            <Check className="mr-1 h-3.5 w-3.5" />
            {acceptPending ? "Abrindo..." : "Aceitar"}
          </Button>
        </div>
      )}
    </div>
  );
}

type ResponseItemProps = {
  n: TransferNotification;
  onMarkSeen: () => void;
  markSeenPending: boolean;
};

function ResponseItem({ n, onMarkSeen, markSeenPending }: ResponseItemProps) {
  const isAccepted = n.transfer_status === "accepted";
  return (
    <div className="grid gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm">
          <p>
            <span className="font-medium">{n.other_agent_name ?? "Outro agente"}</span>{" "}
            <span className="text-muted-foreground">
              {isAccepted ? "aceitou seu encaminhamento" : "recusou seu encaminhamento"}
            </span>
          </p>
          <p className="break-all text-xs text-muted-foreground">
            {n.client_email} · {n.product}
          </p>
        </div>
        <Badge variant={isAccepted ? "default" : "outline"} className="shrink-0">
          {isAccepted ? "Aceito" : "Recusado"}
        </Badge>
      </div>

      {n.response_note && (
        <p className="rounded-md bg-muted/40 px-2 py-1.5 text-xs italic text-muted-foreground">
          "{n.response_note}"
        </p>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {formatRelativeTime(n.responded_at ?? n.created_at)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onMarkSeen}
          disabled={markSeenPending}
        >
          <ArrowRight className="mr-1 h-3.5 w-3.5" />
          Marcar como lido
        </Button>
      </div>
    </div>
  );
}
