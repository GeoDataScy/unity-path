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
  agent_name: string | null;
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
};

function formatServiceDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function TransferTicketDialog({ open, onOpenChange, ticket, onTransferred }: Props) {
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
        to_user_id: ticket.user_id,
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
        description: `Pedido enviado para ${ticket?.agent_name ?? "o agente responsável"}.`,
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
        if (!createTransfer.isPending) onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cliente já possui ticket aberto</DialogTitle>
          <DialogDescription>
            Esse cliente já está sendo atendido por outro agente. Você não pode registrar um
            novo atendimento, mas pode encaminhar uma mensagem para o agente responsável continuar.
          </DialogDescription>
        </DialogHeader>

        {ticket && (
          <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <span className="text-muted-foreground">Agente</span>
              <span className="col-span-2 font-medium">{ticket.agent_name ?? "—"}</span>
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
            Mensagem para o agente (opcional)
          </label>
          <Textarea
            id="transfer-message"
            placeholder="Ex.: cliente voltou a entrar em contato, pedindo atualização do reembolso."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={createTransfer.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => createTransfer.mutate()}
            disabled={createTransfer.isPending || !ticket}
          >
            {createTransfer.isPending ? "Enviando..." : "Encaminhar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
