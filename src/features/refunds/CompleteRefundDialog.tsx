import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

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
import { Switch } from "@/components/ui/switch";
import type { RefundItem } from "@/features/refunds/types";

const PERCENT_OPTIONS = Array.from({ length: 20 }, (_, i) => {
  const value = (i + 1) * 5;
  return `${String(value).padStart(2, "0")}%`;
}) as unknown as readonly [string, ...string[]];

const REASON_OPTIONS = [
  "Insatisfação com o produto",
  "Não reconhece a compra",
  "Compra duplicada",
  "Cobrança recorrente",
  "Produto não funcionou como esperado",
  "Atraso na entrega/acesso",
  "Arrependimento de compra",
  "Dificuldade de uso",
  "Problemas técnicos",
  "Compra em excesso",
  "Indicação médica / efeitos colaterais",
  "Risco de chargeback",
  "Reclamação VSL / Propaganda",
  "Follow up (sem motivo declarado)",
  "Outros",
] as const satisfies readonly [string, ...string[]];

function isValidPercentOption(value: string | null | undefined): value is (typeof PERCENT_OPTIONS)[number] {
  if (!value) return false;
  return (PERCENT_OPTIONS as readonly string[]).includes(value);
}

function isValidReasonOption(value: string | null | undefined): value is (typeof REASON_OPTIONS)[number] {
  if (!value) return false;
  return (REASON_OPTIONS as readonly string[]).includes(value);
}

function sanitizeUsdInput(raw: string): string {
  // Allow only digits and a single dot, limit to 2 decimal places.
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const [intPart = "", ...rest] = cleaned.split(".");
  const decPart = rest.join("");
  if (rest.length === 0) return intPart;
  return `${intPart}.${decPart.slice(0, 2)}`;
}

const completeSchema = z.object({
  completion_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de conclusão"),
  refund_value: z
    .string()
    .trim()
    .min(1, "Informe o valor do reembolso")
    .regex(/^\d+(\.\d{1,2})?$/, "Use somente números (ex: 25 ou 25.50)"),
  refund_type: z.enum(PERCENT_OPTIONS, { message: "Selecione um percentual válido" }),
  reason: z.enum(REASON_OPTIONS, { message: "Selecione um motivo" }),
  items_returned: z.boolean(),
});

export type CompleteRefundValues = z.infer<typeof completeSchema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refund: RefundItem;
  onSubmit: (values: CompleteRefundValues) => Promise<void>;
  submitting?: boolean;
};

export function CompleteRefundDialog({ open, onOpenChange, refund, onSubmit, submitting }: Props) {
  const defaultValues = useMemo<CompleteRefundValues>(
    () => ({
      completion_date: refund.completion_date ?? "",
      refund_value: refund.refund_value == null ? "" : refund.refund_value.toFixed(2),
      refund_type: isValidPercentOption(refund.refund_type) ? refund.refund_type : ("" as CompleteRefundValues["refund_type"]),
      reason: isValidReasonOption(refund.reason) ? refund.reason : ("" as CompleteRefundValues["reason"]),
      items_returned: Boolean(refund.items_returned),
    }),
    [refund.completion_date, refund.refund_value, refund.refund_type, refund.reason, refund.items_returned],
  );

  const form = useForm<CompleteRefundValues>({
    resolver: zodResolver(completeSchema),
    defaultValues,
    mode: "onChange",
  });

  useEffect(() => {
    if (open) form.reset(defaultValues);
  }, [open, form, defaultValues]);

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit(values);
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Concluir reembolso</DialogTitle>
          <DialogDescription>Defina a data de conclusão e ajuste o tipo final do reembolso.</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium">Resumo</p>
          <p className="text-muted-foreground">{refund.customer_email} • Pedido {refund.order_id}</p>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="complete-date">Data de conclusão</Label>
            <Input id="complete-date" type="date" {...form.register("completion_date")} />
            {form.formState.errors.completion_date?.message && (
              <p className="text-sm text-destructive">{form.formState.errors.completion_date.message}</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="refund-value">Valor do reembolso</Label>
            <div className="relative">
              <span
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                aria-hidden="true"
              >
                $
              </span>
              <Controller
                control={form.control}
                name="refund_value"
                render={({ field }) => (
                  <Input
                    id="refund-value"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="pl-7"
                    value={field.value}
                    onChange={(e) => {
                      const next = sanitizeUsdInput(e.target.value);
                      field.onChange(next);
                    }}
                  />
                )}
              />
            </div>
            {form.formState.errors.refund_value?.message && (
              <p className="text-sm text-destructive">{form.formState.errors.refund_value.message}</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="complete-type">Tipo final</Label>
            <Controller
              control={form.control}
              name="refund_type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="complete-type" aria-label="Tipo final">
                    <SelectValue placeholder="Selecione (ex: 25%)" />
                  </SelectTrigger>
                  <SelectContent>
                    {PERCENT_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {form.formState.errors.refund_type?.message && (
              <p className="text-sm text-destructive">{form.formState.errors.refund_type.message}</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="complete-reason">Motivo</Label>
            <Controller
              control={form.control}
              name="reason"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="complete-reason" aria-label="Motivo">
                    <SelectValue placeholder="Selecione o motivo" />
                  </SelectTrigger>
                  <SelectContent>
                    {REASON_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {form.formState.errors.reason?.message && (
              <p className="text-sm text-destructive">{form.formState.errors.reason.message}</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div className="grid gap-0.5">
              <p className="text-sm font-medium">Itens</p>
              <p className="text-sm text-muted-foreground">Habilitado = Sim • Desabilitado = Não</p>
            </div>
            <Controller
              control={form.control}
              name="items_returned"
              render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Itens devolvidos" />
              )}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!form.formState.isValid || Boolean(submitting)}>
              {submitting ? "Salvando..." : "Concluir"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
