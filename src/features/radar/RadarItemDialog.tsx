// Radar — cadastro do caso (abrir novo ou corrigir os dados de um existente).
//
// O que o formulário NÃO pede, de propósito, porque o sistema já sabe:
//   * Data de criação    -> created_at, gravado pelo banco
//   * Agente responsável -> auth.uid() no RPC; ninguém registra caso no nome de outro
//   * Status             -> nasce "Aberto"; daqui em diante só muda registrando ação
//
// A data do próximo acompanhamento vem sugerida pela régua do tipo escolhido e
// segue editável (ver nextFollowUp.ts). Trocar o tipo re-sugere a data, desde que
// o agente ainda não tenha mexido nela à mão.

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Radar } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { PRODUCTS } from "@/features/services/products";
import { supabaseErrorMessage } from "@/lib/supabaseError";
import {
  useCreateRadarItemMutation,
  useUpdateRadarItemMutation,
  type RadarItemInput,
} from "./useMyRadarQuery";
import {
  formatBrDate,
  suggestNextFollowUp,
  suggestionHint,
  todayInSaoPaulo,
} from "./nextFollowUp";
import { RADAR_KINDS, getRadarKind, type MyRadarItem, type RadarKind } from "./types";

const DEFAULT_KIND: RadarKind = "logistica";

/** Pedido é obrigatório em tudo que nasce de um pedido — só "Outra pendência" dispensa. */
function requiresOrderNumber(kind: RadarKind): boolean {
  return kind !== "outros";
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nulo = abrir caso novo. Preenchido = corrigir o cadastro deste caso. */
  item: MyRadarItem | null;
};

export function RadarItemDialog({ open, onOpenChange, item }: Props) {
  const { toast } = useToast();
  const createMutation = useCreateRadarItemMutation();
  const updateMutation = useUpdateRadarItemMutation();

  const isEdit = Boolean(item);

  const [clientEmail, setClientEmail] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [product, setProduct] = useState("");
  const [kind, setKind] = useState<RadarKind>(DEFAULT_KIND);
  const [actionNeeded, setActionNeeded] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [notes, setNotes] = useState("");

  // Enquanto o agente não editar a data, trocar o tipo re-sugere a data. Depois
  // que ele encosta no campo, a escolha dele manda.
  const dateTouched = useRef(false);

  useEffect(() => {
    if (!open) return;
    dateTouched.current = false;
    if (item) {
      setClientEmail(item.client_email);
      setOrderNumber(item.order_number ?? "");
      setProduct(item.product ?? "");
      setKind(item.kind);
      setActionNeeded(item.action_needed);
      setNextDate(item.next_follow_up_date ?? "");
      setNotes(item.notes ?? "");
    } else {
      setClientEmail("");
      setOrderNumber("");
      setProduct("");
      setKind(DEFAULT_KIND);
      setActionNeeded("");
      setNextDate(suggestNextFollowUp(DEFAULT_KIND));
      setNotes("");
    }
  }, [open, item]);

  const handleKindChange = (value: string) => {
    const next = value as RadarKind;
    setKind(next);
    if (!isEdit && !dateTouched.current) setNextDate(suggestNextFollowUp(next));
  };

  const today = useMemo(() => todayInSaoPaulo(), []);

  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail.trim());
  const missingOrder = requiresOrderNumber(kind) && orderNumber.trim() === "";
  const canSave =
    emailLooksValid &&
    !missingOrder &&
    actionNeeded.trim() !== "" &&
    (isEdit || nextDate !== "");

  const saving = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async () => {
    const input: RadarItemInput = {
      clientEmail: clientEmail.trim(),
      orderNumber: orderNumber.trim(),
      product: product.trim(),
      kind,
      actionNeeded: actionNeeded.trim(),
      nextFollowUpDate: nextDate,
      notes: notes.trim(),
    };

    try {
      if (item) {
        await updateMutation.mutateAsync({ itemId: item.id, input });
        toast({ title: "Caso atualizado", description: "Os dados do cadastro foram salvos." });
      } else {
        await createMutation.mutateAsync(input);
        toast({
          title: "Caso no Radar",
          description: `Próximo acompanhamento em ${formatBrDate(nextDate)}.`,
        });
      }
      onOpenChange(false);
    } catch (e) {
      toast({
        title: item ? "Erro ao salvar" : "Erro ao registrar",
        description: supabaseErrorMessage(e, "Não foi possível concluir a operação."),
        variant: "destructive",
      });
    }
  };

  const kindMeta = getRadarKind(kind);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            {isEdit ? "Editar caso" : "Novo caso no Radar"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Corrija os dados do cliente e do pedido. Para mudar o status ou a data, registre uma ação."
              : "Registre o cliente que depende de uma ação sua. Data de criação, prestador e status saem do sistema."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="radar-email">E-mail do cliente *</Label>
            <Input
              id="radar-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="cliente@email.com"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
            />
            {clientEmail.trim() !== "" && !emailLooksValid && (
              <p className="text-xs text-destructive">E-mail inválido.</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="radar-order">
                Número do pedido {requiresOrderNumber(kind) ? "*" : "(opcional)"}
              </Label>
              <Input
                id="radar-order"
                autoComplete="off"
                placeholder="Ex.: 1234567"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="radar-product">Produto</Label>
              <Select value={product} onValueChange={setProduct}>
                <SelectTrigger id="radar-product">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {PRODUCTS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="radar-kind">Tipo de acompanhamento *</Label>
            <Select value={kind} onValueChange={handleKindChange}>
              <SelectTrigger id="radar-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RADAR_KINDS.map((k) => (
                  <SelectItem key={k.code} value={k.code}>
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${k.dot}`} />
                      {k.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {kindMeta && <p className="text-xs text-muted-foreground">{kindMeta.hint}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="radar-action">Ação necessária *</Label>
            <Textarea
              id="radar-action"
              rows={2}
              placeholder="O que precisa ser feito para fechar este caso?"
              value={actionNeeded}
              onChange={(e) => setActionNeeded(e.target.value)}
            />
          </div>

          {/* Na edição a data não aparece: ela pertence ao registro de ação, para
              que toda mudança de prazo deixe rastro no histórico. */}
          {!isEdit && (
            <div className="grid gap-2">
              <Label htmlFor="radar-next" className="flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4" /> Data do próximo acompanhamento *
              </Label>
              <Input
                id="radar-next"
                type="date"
                min={today}
                value={nextDate}
                onChange={(e) => {
                  dateTouched.current = true;
                  setNextDate(e.target.value);
                }}
              />
              <p className="text-xs text-muted-foreground">
                {dateTouched.current ? "Data definida por você." : suggestionHint(kind)}
              </p>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="radar-notes">Observações</Label>
            <Textarea
              id="radar-notes"
              rows={2}
              placeholder="Contexto que o próximo acompanhamento precisa saber (opcional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSave || saving}>
            {saving ? "Salvando..." : isEdit ? "Salvar" : "Registrar no Radar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
