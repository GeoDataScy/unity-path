import { useState } from "react";
import { Clock, FileText, Hash, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  useStatusTracking,
  type ServiceStatus,
} from "@/features/services/useStatusTracking";

type Props = {
  serviceId: string;
  clientEmail: string;
  serviceDate: string;
  serviceStatus?: string;
  hasTrackingCode: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function StatusTrackingDialog({ serviceId, clientEmail, serviceDate, serviceStatus, hasTrackingCode, open, onOpenChange }: Props) {
  const { getEntries, getCurrentStatus, addEntryMutation, canAddInteraction } = useStatusTracking();
  const { toast } = useToast();

  const entries = getEntries(serviceId);
  const currentStatus = getCurrentStatus(serviceId, serviceStatus);
  const isConcluded = currentStatus.variant === "done";
  const interactionCheck = canAddInteraction(serviceId, serviceDate, hasTrackingCode);

  // Form state — recorded_at is pinned to now() by the database, so no date/time inputs.
  const [isReopening, setIsReopening] = useState(false);
  const [status, setStatus] = useState<ServiceStatus>("em_andamento");
  const [observation, setObservation] = useState("");

  const handleSubmit = async () => {
    if (!interactionCheck.allowed && status !== "concluido") {
      toast({
        title: "Interação bloqueada",
        description: interactionCheck.reason ?? "A próxima interação com este atendimento só pode ser registrada no dia seguinte.",
        variant: "destructive",
      });
      return;
    }

    try {
      await addEntryMutation.mutateAsync({
        serviceId,
        status,
        observation,
      });

      toast({
        title: "Acompanhamento registrado",
        description: status === "concluido"
          ? "Atendimento marcado como concluído."
          : "Nova interação registrada com sucesso.",
      });

      setStatus("em_andamento");
      setObservation("");
      setIsReopening(false);
      onOpenChange(false);
    } catch (error) {
      console.error("[status-tracking-dialog] insert failed:", error);
      const message = error instanceof Error
        ? error.message
        : "Não foi possível registrar o acompanhamento.";
      toast({
        title: "Erro ao registrar",
        description: message,
        variant: "destructive",
      });
    }
  };

  const canSubmit = !addEntryMutation.isPending &&
    (status === "concluido" || interactionCheck.allowed || isReopening);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Acompanhamento do Atendimento
          </DialogTitle>
          <DialogDescription>
            Cliente: <span className="font-medium text-foreground">{clientEmail}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Current status */}
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
          <span className="text-sm text-muted-foreground">Status atual:</span>
          <Badge variant={currentStatus.variant}>{currentStatus.label}</Badge>
          {entries.length > 0 && (
            <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <Hash className="h-3 w-3" />
              {entries.length} {entries.length === 1 ? "interação" : "interações"}
            </span>
          )}
        </div>

        {/* History */}
        {entries.length > 0 && (
          <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Histórico</p>
            {entries.map((e) => {
              const dt = new Date(e.recorded_at);
              const dateStr = dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
              const timeStr = dt.toLocaleTimeString("pt-BR", {
                timeZone: "America/Sao_Paulo",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              });

              return (
                <div key={e.id} className="flex items-start gap-2 border-l-2 border-primary/30 pl-3 text-sm">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={e.status === "concluido" ? "done" : "in-progress"}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {e.status === "concluido"
                          ? "Concluído"
                          : e.follow_up_number <= 1
                            ? "Em Andamento"
                            : `Em Andamento ${e.follow_up_number}`}
                      </Badge>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {dateStr} {timeStr}
                      </span>
                    </div>
                    {e.observation && (
                      <p className="mt-1 text-xs text-muted-foreground">{e.observation}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Interaction block warning — only when trying to add Em Andamento, not when concluding */}
        {(!isConcluded || isReopening) && !interactionCheck.allowed && status !== "concluido" && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="font-medium">Interação bloqueada</p>
            <p className="mt-1 text-xs">A próxima interação com este atendimento só pode ser registrada no dia seguinte. Você ainda pode concluir o ticket.</p>
          </div>
        )}

        {/* New entry form — always visible for non-concluded tickets so user can conclude */}
        {(!isConcluded || isReopening) && (
          <div className="grid gap-4 rounded-lg border bg-card p-4">
            <p className="text-sm font-medium">Novo registro de acompanhamento</p>

            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ServiceStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="em_andamento">Em Andamento</SelectItem>
                  <SelectItem value="concluido">Concluído</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Observação</Label>
              <Textarea
                placeholder="Descreva o que foi feito nesta interação..."
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        )}

        {isConcluded && !isReopening && (
          <div className="rounded-lg border border-status-done/30 bg-status-done/10 p-4 text-sm text-muted-foreground">
            <p className="text-center">
              Este atendimento foi concluído com <strong>{entries.length}</strong>{" "}
              {entries.length === 1 ? "interação" : "interações"}.
            </p>
            <p className="mt-2 text-center text-xs">
              Reabra o ticket para registrar uma nova interação.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          {isConcluded && !isReopening && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsReopening(true)}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reabrir Ticket
            </Button>
          )}
          {(!isConcluded || isReopening) && (
            <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
              {addEntryMutation.isPending ? "Registrando..." : "Registrar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
