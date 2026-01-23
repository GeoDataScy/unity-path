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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SALES_PLATFORMS } from "@/features/refunds/types";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const newRefundSchema = z
  .object({
    customer_email: z.string().trim().email("E-mail inválido").max(255),
    request_date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
    completion_date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
      .optional()
      .or(z.literal("")),
    reason: z.string().trim().min(1, "Informe o motivo").max(1000),
    items_returned: z.boolean(),
    sales_platform: z.enum(SALES_PLATFORMS, { message: "Selecione a plataforma" }),
    order_id: z.string().trim().min(1, "Informe o número do pedido").max(100),
    refund_type: z.string().trim().min(1, "Informe o tipo de reembolso").max(100),
  })
  .transform((v) => ({
    ...v,
    completion_date: v.completion_date ? v.completion_date : undefined,
  }));

export type NewRefundValues = z.infer<typeof newRefundSchema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: NewRefundValues) => Promise<void>;
  submitting?: boolean;
};

export function NewRefundDialog({ open, onOpenChange, onSubmit, submitting }: Props) {
  const defaultValues = useMemo<NewRefundValues>(
    () => ({
      customer_email: "",
      request_date: todayISO(),
      completion_date: "",
      reason: "",
      items_returned: false,
      sales_platform: "Cartpanda",
      order_id: "",
      refund_type: "",
    }),
    [],
  );

  const form = useForm<NewRefundValues>({
    resolver: zodResolver(newRefundSchema),
    defaultValues,
    mode: "onChange",
  });

  useEffect(() => {
    if (!open) form.reset(defaultValues);
  }, [open, form, defaultValues]);

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit(values);
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo reembolso</DialogTitle>
          <DialogDescription>Registre um novo pedido de reembolso.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="refund-email">E-mail</Label>
            <Input id="refund-email" type="email" placeholder="cliente@email.com" {...form.register("customer_email")} />
            {form.formState.errors.customer_email?.message && (
              <p className="text-sm text-destructive">{form.formState.errors.customer_email.message}</p>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="refund-request-date">Data da solicitação</Label>
              <Input id="refund-request-date" type="date" {...form.register("request_date")} />
              {form.formState.errors.request_date?.message && (
                <p className="text-sm text-destructive">{form.formState.errors.request_date.message}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="refund-completion-date">Data de conclusão (opcional)</Label>
              <Input id="refund-completion-date" type="date" {...form.register("completion_date")} />
              {form.formState.errors.completion_date?.message && (
                <p className="text-sm text-destructive">{form.formState.errors.completion_date.message}</p>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Plataforma de venda</Label>
            <Select
              value={form.watch("sales_platform")}
              onValueChange={(v) => form.setValue("sales_platform", v as any, { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {SALES_PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.sales_platform?.message && (
              <p className="text-sm text-destructive">{form.formState.errors.sales_platform.message}</p>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="refund-order-id">Número do pedido</Label>
              <Input id="refund-order-id" placeholder="Ex: 12345" {...form.register("order_id")} />
              {form.formState.errors.order_id?.message && (
                <p className="text-sm text-destructive">{form.formState.errors.order_id.message}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="refund-type">Tipo de reembolso</Label>
              <Input id="refund-type" placeholder="Ex: Total, Parcial 50%" {...form.register("refund_type")} />
              {form.formState.errors.refund_type?.message && (
                <p className="text-sm text-destructive">{form.formState.errors.refund_type.message}</p>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="refund-reason">Motivo</Label>
            <Textarea id="refund-reason" rows={3} placeholder="Descreva o motivo" {...form.register("reason")} />
            {form.formState.errors.reason?.message && (
              <p className="text-sm text-destructive">{form.formState.errors.reason.message}</p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="grid gap-0.5">
              <p className="text-sm font-medium">Itens devolvidos</p>
              <p className="text-sm text-muted-foreground">Marque se o cliente devolveu os itens.</p>
            </div>
            <Switch
              checked={form.watch("items_returned")}
              onCheckedChange={(checked) => form.setValue("items_returned", checked, { shouldValidate: true })}
              aria-label="Itens devolvidos"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!form.formState.isValid || Boolean(submitting)}>
              {submitting ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
