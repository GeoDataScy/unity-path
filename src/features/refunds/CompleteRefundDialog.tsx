import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
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
import type { RefundItem } from "@/features/refunds/types";

const completeSchema = z.object({
  completion_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de conclusão"),
  refund_type: z.string().trim().min(1, "Informe o tipo final").max(100),
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
      refund_type: refund.refund_type ?? "",
    }),
    [refund.completion_date, refund.refund_type],
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
            <Label htmlFor="complete-type">Tipo final</Label>
            <Input id="complete-type" placeholder="Ex: Total, Parcial 50%" {...form.register("refund_type")} />
            {form.formState.errors.refund_type?.message && (
              <p className="text-sm text-destructive">{form.formState.errors.refund_type.message}</p>
            )}
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
