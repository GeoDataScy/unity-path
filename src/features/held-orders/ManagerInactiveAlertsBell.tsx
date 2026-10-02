import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Undo2, UserX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { playNotificationSound } from "@/features/transfers/notificationSound";
import { formatHeldOrderDateTime } from "./dates";
import { heldOrderStoreLabel } from "./format";
import { HELD_ORDER_INACTIVE_DAYS, type HeldOrderInactiveAlert } from "./types";

// As RPCs de pedidos em espera ainda não estão nos tipos gerados do Supabase.
const rpc = supabase.rpc.bind(supabase) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

const INACTIVE_ALERTS_KEY = ["held-orders", "inactive-alerts"] as const;

type Props = {
  enabled: boolean;
};

/**
 * Sino da gestora para Inativo marcado cedo demais: o agente tirou o pedido da
 * fila com menos de HELD_ORDER_INACTIVE_DAYS dias desde o último contato. A
 * gestora confirma que está correto ou devolve o pedido para a fila do agente.
 */
export function ManagerInactiveAlertsBell({ enabled }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [returnNote, setReturnNote] = useState("");

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: INACTIVE_ALERTS_KEY,
    enabled,
    queryFn: async (): Promise<HeldOrderInactiveAlert[]> => {
      const { data, error } = await rpc("manager_inactive_alerts");
      if (error) throw error;
      return Array.isArray(data) ? (data as HeldOrderInactiveAlert[]) : [];
    },
    // Mesma cadência dos outros sinos: 30s + no foco, sem Realtime.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const totalCount = alerts.length;

  // Toca um som quando a fila cresce (silencioso no primeiro carregamento).
  const prevCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const prev = prevCountRef.current;
    if (prev !== null && totalCount > prev) playNotificationSound();
    prevCountRef.current = totalCount;
  }, [totalCount, enabled]);

  const review = useMutation({
    mutationFn: async (p: { alert: HeldOrderInactiveAlert; decision: "correto" | "devolvido"; note: string }) => {
      const { error } = await rpc("manager_review_inactive_alert", {
        p_alert_id: p.alert.alert_id,
        p_decision: p.decision,
        p_note: p.note,
      });
      if (error) throw error;
      return p;
    },
    onSuccess: async (p) => {
      await queryClient.invalidateQueries({ queryKey: INACTIVE_ALERTS_KEY });
      // O pedido devolvido muda de status na lista da aba de Pedidos em Espera.
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "held-orders"] });
      setReturningId(null);
      setReturnNote("");
      toast({
        title: p.decision === "correto" ? "Marcação confirmada" : "Pedido devolvido",
        description:
          p.decision === "correto"
            ? `O pedido ${p.alert.order_number ?? ""} segue inativo.`
            : `O pedido ${p.alert.order_number ?? ""} voltou para a fila de ${p.alert.agent_name ?? "o agente"}.`,
      });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Não foi possível registrar.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    },
  });

  if (!enabled) return null;

  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9 text-foreground/70 hover:text-foreground hover:bg-foreground/5"
            aria-label="Alertas de pedidos inativos"
          >
            <UserX className="h-4 w-4" />
            {totalCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-mono text-[10px] font-medium text-destructive-foreground">
                {totalCount > 9 ? "9+" : totalCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 p-0">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-medium">Inativos para revisar</h3>
            <p className="text-xs text-muted-foreground">
              Pedidos em Espera marcados como inativos antes de {HELD_ORDER_INACTIVE_DAYS} dias sem contato
            </p>
          </div>

          <ScrollArea className="max-h-96">
            {isLoading && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Carregando...</p>
            )}
            {!isLoading && alerts.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum alerta pendente.</p>
            )}

            <ul className="divide-y">
              {alerts.map((a) => {
                const isReturning = returningId === a.alert_id;
                return (
                  <li key={a.alert_id} className="grid gap-2 p-3">
                    <div className="text-sm">
                      <p>
                        <span className="font-medium">{a.agent_name ?? "Um agente"}</span>{" "}
                        <span className="text-muted-foreground">marcou inativo o pedido</span>{" "}
                        <span className="font-mono font-medium">{a.order_number ?? "sem número"}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.customer_name ?? "—"} · {heldOrderStoreLabel(a.dyna_code)}
                      </p>
                      <p className="mt-1 text-xs">
                        Marcado em{" "}
                        <span className="font-mono tabular-nums">{formatHeldOrderDateTime(a.marked_at)}</span>
                        {" · "}
                        <span className="font-medium text-warning">
                          {a.days_since_contact} dia(s) desde o último contato
                        </span>
                      </p>
                      {a.agent_status !== "inativo" && (
                        <p className="mt-1 text-xs text-muted-foreground">O agente já reabriu este pedido.</p>
                      )}
                    </div>

                    {a.note && (
                      <p className="rounded-md bg-muted/40 px-2 py-1.5 text-xs italic text-muted-foreground">
                        "{a.note}"
                      </p>
                    )}

                    {isReturning ? (
                      <div className="grid gap-2">
                        <Textarea
                          placeholder="Orientação para o agente (opcional)"
                          value={returnNote}
                          onChange={(e) => setReturnNote(e.target.value)}
                          rows={2}
                          maxLength={300}
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setReturningId(null);
                              setReturnNote("");
                            }}
                            disabled={review.isPending}
                          >
                            Cancelar
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => review.mutate({ alert: a, decision: "devolvido", note: returnNote })}
                            disabled={review.isPending}
                          >
                            {review.isPending ? "Enviando..." : "Confirmar devolução"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setReturningId(a.alert_id);
                            setReturnNote("");
                          }}
                          disabled={review.isPending}
                        >
                          <Undo2 className="mr-1 h-3.5 w-3.5" />
                          Devolver ao agente
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => review.mutate({ alert: a, decision: "correto", note: "" })}
                          disabled={review.isPending}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" />
                          Está correto
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>

          <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            Devolver coloca o pedido de volta na fila do agente, registrado no histórico.
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
