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
import { SALES_PLATFORMS, REFUND_PRODUCTS } from "@/features/refunds/types";

function todayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

// No cadastro inicial ("Em aberto"), apenas 4 campos devem ser obrigatórios:
// - E-mail
// - Data da solicitação
// - Número do pedido
// - Produto
// A plataforma continua visível, mas vem pré-selecionada.
const CHANNELS = ["Nenhum", "Clickbank", "Email", "SMS"] as const;

const newRefundSchema = z.object({
  customer_email: z.string().trim().email("E-mail inválido").max(255),
  request_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  order_id: z.string().trim().min(1, "Informe o número do pedido").max(100),
  sales_platform: z.enum(SALES_PLATFORMS, { message: "Selecione a plataforma" }),
  product: z.string().trim().min(1, "Selecione o produto"),
  channel: z.string().default("Nenhum"),
});

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
      sales_platform: "Nenhum",
      order_id: "",
      product: "",
      channel: "Nenhum",
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
          </div>

          <div className="grid gap-2">
            <Label>Produto</Label>
            <Select
              value={form.watch("product")}
              onValueChange={(v) => form.setValue("product", v, { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o produto" />
              </SelectTrigger>
              <SelectContent>
                {REFUND_PRODUCTS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.product?.message && (
              <p className="text-sm text-destructive">{form.formState.errors.product.message}</p>
            )}
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
              <Label>Canal</Label>
              <Select
                value={form.watch("channel")}
                onValueChange={(v) => form.setValue("channel", v, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((ch) => (
                    <SelectItem key={ch} value={ch}>
                      {ch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
