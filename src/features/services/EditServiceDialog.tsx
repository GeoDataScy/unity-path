import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { ServiceItem } from "@/features/services/useMyServicesQuery";
import { useProductsQuery } from "@/features/products/useProductsQuery";

type Props = {
  service: ServiceItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (next: { client_email: string; service_date: string; product: string }) => Promise<void>;
};

export function EditServiceDialog({ service, open, onOpenChange, onSave }: Props) {
  const [saving, setSaving] = useState(false);
  const [clientEmail, setClientEmail] = useState(service.client_email);
  const [serviceDate, setServiceDate] = useState(() => {
    // Ensure the <input type="date"> receives YYYY-MM-DD (not an ISO timestamp).
    return service.service_date?.includes("T") ? service.service_date.slice(0, 10) : service.service_date;
  });
  const [product, setProduct] = useState(service.product);

  const { data: products = [], isLoading: productsLoading } = useProductsQuery(open);

  const canSave = useMemo(() => {
    return Boolean(clientEmail) && Boolean(serviceDate) && Boolean(product) && !saving;
  }, [clientEmail, serviceDate, product, saving]);

  const productOptions = useMemo(() => {
    const names = products.map((p) => p.name);
    // If the saved record references a product that is no longer active,
    // keep it selectable so the Select can render the current value.
    if (product && !names.includes(product)) return [product, ...names];
    return names;
  }, [products, product]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ client_email: clientEmail, service_date: serviceDate, product });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar atendimento</DialogTitle>
          <DialogDescription>Atualize os dados do registro e salve.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-client-email">E-mail do Cliente</Label>
            <Input
              id="edit-client-email"
              type="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="cliente@email.com"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit-service-date">Data do Atendimento</Label>
            <Input
              id="edit-service-date"
              type="date"
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label>Produto</Label>
            <Select value={product} onValueChange={setProduct}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
               <SelectContent>
                 {productsLoading ? (
                   <SelectItem value="__loading" disabled>
                     Carregando...
                   </SelectItem>
                 ) : productOptions.length === 0 ? (
                   <SelectItem value="__empty" disabled>
                     Nenhum produto ativo
                   </SelectItem>
                 ) : (
                   productOptions.map((name) => (
                     <SelectItem key={name} value={name}>
                       {name}
                     </SelectItem>
                   ))
                 )}
               </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
