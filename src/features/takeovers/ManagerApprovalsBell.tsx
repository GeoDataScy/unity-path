import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, X, UserCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  TAKEOVER_NOTIFICATIONS_KEY,
  useTakeoverNotificationsQuery,
  type TakeoverNotification,
} from "@/features/takeovers/useTakeoverNotificationsQuery";
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
  /** Só monta o sino para a gestora aprovadora (can_approve_takeovers). */
  enabled: boolean;
};

/**
 * Sino exclusivo da gestora responsável: mostra os pedidos de agentes que
 * pegaram um atendimento cujo dono está DE FOLGA e precisam de autorização.
 * Aprovar move o ticket para quem pediu e marca como autorizado.
 */
export function ManagerApprovalsBell({ enabled }: Props) {
  const { data: notifications = [], isLoading } = useTakeoverNotificationsQuery(enabled);
  const [open, setOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const totalCount = notifications.length;

  // Toca um som quando a fila cresce (silencioso no primeiro carregamento).
  const prevCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const prev = prevCountRef.current;
    if (prev !== null && totalCount > prev) {
      playNotificationSound();
    }
    prevCountRef.current = totalCount;
  }, [totalCount, enabled]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: TAKEOVER_NOTIFICATIONS_KEY });
    // O ticket muda de dono e ganha marcador de autorizado → atualiza a aba Usuários.
    await queryClient.invalidateQueries({ queryKey: ["dashboard", "users"] });
  };

  const approve = useMutation({
    mutationFn: async (n: TakeoverNotification) => {
      const { error } = await supabase.rpc("approve_ticket_takeover", {
        p_request_id: n.request_id,
      });
      if (error) throw error;
      return n;
    },
    onSuccess: async (n) => {
      await invalidate();
      toast({
        title: "Autorizado",
        description: `${n.requester_name ?? "O agente"} agora atende o ticket de ${n.client_email}.`,
      });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Não foi possível autorizar.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    },
  });

  const reject = useMutation({
    mutationFn: async ({ n, note }: { n: TakeoverNotification; note: string }) => {
      const { error } = await supabase.rpc("reject_ticket_takeover", {
        p_request_id: n.request_id,
        p_note: note.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await invalidate();
      setRejectingId(null);
      setRejectNote("");
      toast({ title: "Recusado", description: "O pedido foi recusado." });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Não foi possível recusar.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    },
  });

  if (!enabled) return null;

  return (
    <div className="fixed top-4 right-16 z-50">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9 text-foreground/70 hover:text-foreground hover:bg-foreground/5"
            aria-label="Aprovações de atendimento"
          >
            <BellRing className="h-4 w-4" />
            {totalCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-mono text-[10px] font-medium text-destructive-foreground">
                {totalCount > 9 ? "9+" : totalCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 p-0">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-medium">Aprovações pendentes</h3>
            <p className="text-xs text-muted-foreground">
              Atendimentos de clientes cujo responsável está de folga
            </p>
          </div>

          <ScrollArea className="max-h-96">
            {isLoading && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Carregando...</p>
            )}
            {!isLoading && notifications.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Nenhum pedido pendente.
              </p>
            )}

            <ul className="divide-y">
              {notifications.map((n) => {
                const isRejecting = rejectingId === n.request_id;
                return (
                  <li key={n.request_id} className="grid gap-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm">
                        <p>
                          <span className="font-medium">{n.requester_name ?? "Um agente"}</span>{" "}
                          <span className="text-muted-foreground">quer assumir um ticket de</span>{" "}
                          <span className="font-medium">{n.owner_name ?? "colega de folga"}</span>
                        </p>
                        <p className="break-all text-xs text-muted-foreground">
                          {n.client_email} · {n.product}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatRelativeTime(n.created_at)}
                      </span>
                    </div>

                    {n.note && (
                      <p className="rounded-md bg-muted/40 px-2 py-1.5 text-xs italic text-muted-foreground">
                        "{n.note}"
                      </p>
                    )}

                    {isRejecting ? (
                      <div className="grid gap-2">
                        <Textarea
                          placeholder="Motivo (opcional)"
                          value={rejectNote}
                          onChange={(e) => setRejectNote(e.target.value)}
                          rows={2}
                          maxLength={300}
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setRejectingId(null);
                              setRejectNote("");
                            }}
                            disabled={reject.isPending}
                          >
                            Cancelar
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => reject.mutate({ n, note: rejectNote })}
                            disabled={reject.isPending}
                          >
                            {reject.isPending ? "Enviando..." : "Confirmar recusa"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRejectingId(n.request_id);
                            setRejectNote("");
                          }}
                          disabled={approve.isPending}
                        >
                          <X className="mr-1 h-3.5 w-3.5" />
                          Recusar
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => approve.mutate(n)}
                          disabled={approve.isPending}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" />
                          {approve.isPending ? "Autorizando..." : "Autorizar"}
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>

          <div className="flex items-center gap-1.5 border-t px-4 py-2 text-[11px] text-muted-foreground">
            <UserCog className="h-3 w-3" />
            Autorizar transfere o atendimento para o agente que solicitou.
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
