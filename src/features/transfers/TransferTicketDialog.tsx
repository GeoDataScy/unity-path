import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type DuplicateTicket = {
  id: string;
  user_id: string;
  current_owner_id: string;
  agent_name: string | null;
  current_owner_name: string | null;
  // false = dono operacional está de folga/indisponível → exige aprovação da gestora.
  current_owner_is_available?: boolean;
  client_email: string;
  product: string;
  platform: string | null;
  channel: string | null;
  status: string;
  service_date: string;
  created_at: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: DuplicateTicket | null;
  onTransferred?: () => void;
  // Assume a titularidade do ticket (passa a ser o dono e pode registrar).
  // Recebe o ticket em questão; o caller cuida de abrir o acompanhamento.
  onClaim?: (ticket: DuplicateTicket) => Promise<void>;
  claiming?: boolean;
  // Solicita aprovação da gestora quando o dono está de folga. Recebe o ticket
  // e a mensagem/observação opcional; o caller dispara o RPC.
  onRequestApproval?: (ticket: DuplicateTicket, note: string) => Promise<void>;
  requestingApproval?: boolean;
};

function formatServiceDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function TransferTicketDialog({
  open,
  onOpenChange,
  ticket,
  onTransferred,
  onClaim,
  claiming = false,
  onRequestApproval,
  requestingApproval = false,
}: Props) {
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Dono operacional de folga: em vez de encaminhar (ele não responde), o
  // caminho é pedir aprovação da gestora. current_owner_is_available === false.
  const ownerUnavailable = ticket?.current_owner_is_available === false;

  const createTransfer = useMutation({
    mutationFn: async () => {
      if (!ticket) throw new Error("Ticket inválido");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada");

      const { error } = await supabase.from("ticket_transfers").insert({
        service_id: ticket.id,
        from_user_id: session.user.id,
        // Dono operacional atual (current_owner), não o criador. Cobre o caso de
        // ticket redistribuído pelo gestor: o criador pode ser outro, mas quem
        // deve receber o encaminhamento é quem atende o ticket agora.
        to_user_id: ticket.current_owner_id ?? ticket.user_id,
        message: message.trim() || null,
        status: "pending",
      });

      if (error) {
        // Unique partial index: agent already has a pending request for this ticket.
        if (error.code === "23505") {
          throw new Error("Você já tem um pedido pendente para esse ticket.");
        }
        throw error;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["ticket_transfers"] });
      toast({
        title: "Encaminhado",
        description: `Pedido enviado para ${ticket?.current_owner_name ?? ticket?.agent_name ?? "o agente responsável"}.`,
      });
      setMessage("");
      onTransferred?.();
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      const description = error instanceof Error ? error.message : "Não foi possível encaminhar.";
      toast({ title: "Erro ao encaminhar", description, variant: "destructive" });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!createTransfer.isPending && !requestingApproval) onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cliente já possui ticket aberto</DialogTitle>
          <DialogDescription>
            {ownerUnavailable ? (
              <>
                O responsável por este cliente está <strong>de folga/indisponível</strong>.
                Para assumir o atendimento, solicite a{" "}
                <strong>aprovação da gestora</strong>. Assim que autorizado, o ticket passa a ser seu.
              </>
            ) : (
              <>
                Esse cliente já está sendo atendido por outro agente. Você pode{" "}
                <strong>assumir o atendimento</strong> (passa a ser seu e você registra a
                interação) ou <strong>encaminhar</strong> uma mensagem para o agente responsável continuar.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {ticket && (
          <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <span className="text-muted-foreground">Agente</span>
              <span className="col-span-2 font-medium">
                {ticket.current_owner_name ?? ticket.agent_name ?? "—"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <span className="text-muted-foreground">Cliente</span>
              <span className="col-span-2 break-all">{ticket.client_email}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <span className="text-muted-foreground">Produto</span>
              <span className="col-span-2">{ticket.product}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <span className="text-muted-foreground">Plataforma</span>
              <span className="col-span-2">{ticket.platform ?? "—"}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <span className="text-muted-foreground">Aberto em</span>
              <span className="col-span-2">{formatServiceDate(ticket.service_date)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <span className="text-muted-foreground">Status</span>
              <span className="col-span-2">
                <Badge variant="outline">{ticket.status}</Badge>
              </span>
            </div>
          </div>
        )}

        <div className="grid gap-2">
          <label htmlFor="transfer-message" className="text-sm font-medium">
            {ownerUnavailable ? "Observação para a gestora (opcional)" : "Mensagem para o agente (opcional)"}
          </label>
          <Textarea
            id="transfer-message"
            placeholder={
              ownerUnavailable
                ? "Ex.: cliente aguardando retorno urgente sobre o reembolso."
                : "Ex.: cliente voltou a entrar em contato, pedindo atualização do reembolso."
            }
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            rows={3}
          />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={createTransfer.isPending || claiming || requestingApproval}
          >
            Cancelar
          </Button>
          <div className="flex gap-2">
            {ownerUnavailable ? (
              onRequestApproval && (
                <Button
                  onClick={() => ticket && onRequestApproval(ticket, message)}
                  disabled={requestingApproval || claiming || !ticket}
                >
                  {requestingApproval ? "Enviando..." : "Solicitar aprovação da gestora"}
                </Button>
              )
            ) : (
              <Button
                variant="outline"
                onClick={() => createTransfer.mutate()}
                disabled={createTransfer.isPending || claiming || !ticket}
              >
                {createTransfer.isPending ? "Enviando..." : "Encaminhar"}
              </Button>
            )}
            {onClaim && (
              <Button
                onClick={() => ticket && onClaim(ticket)}
                disabled={createTransfer.isPending || claiming || requestingApproval || !ticket}
              >
                {claiming ? "Assumindo..." : "Assumir atendimento"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
