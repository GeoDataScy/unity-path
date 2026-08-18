import { useEffect, useState } from "react";

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
import { useToast } from "@/hooks/use-toast";
import { useSaveSupportSmsBrandMutation } from "../useSupportBaseQuery";
import type { Estrutura, SupportSmsBrand } from "../types";

type SmsBrandFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brand: SupportSmsBrand | null;
  nextSortOrder: number;
};

const vazio = {
  nome: "",
  sistema: "",
  estrutura: "nova" as Estrutura,
  sms_number: "",
  ativo: true,
};

export function SmsBrandFormDialog({
  open,
  onOpenChange,
  brand,
  nextSortOrder,
}: SmsBrandFormDialogProps) {
  const { toast } = useToast();
  const save = useSaveSupportSmsBrandMutation();

  const [form, setForm] = useState(vazio);

  useEffect(() => {
    if (!open) return;
    setForm(
      brand
        ? {
            nome: brand.nome,
            sistema: brand.sistema,
            estrutura: brand.estrutura,
            sms_number: brand.sms_number ?? "",
            ativo: brand.ativo,
          }
        : vazio,
    );
  }, [open, brand]);

  const set = <K extends keyof typeof vazio>(key: K, value: (typeof vazio)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    const nome = form.nome.trim();
    const sistema = form.sistema.trim();
    if (!nome || !sistema) {
      toast({
        title: "Nome e nome no sistema são obrigatórios.",
        variant: "destructive",
      });
      return;
    }

    try {
      await save.mutateAsync({
        id: brand?.id,
        values: {
          nome,
          sistema,
          estrutura: form.estrutura,
          sms_number: form.sms_number.trim() || null,
          ativo: form.ativo,
          sort_order: brand?.sort_order ?? nextSortOrder,
        },
      });
      toast({ title: brand ? "Brand atualizada." : "Brand criada." });
      onOpenChange(false);
    } catch (error) {
      const message = (error as { message?: string })?.message ?? "";
      toast({
        title: "Não foi possível salvar.",
        description: message.includes("support_sms_brands_nome_uniq")
          ? "Já existe uma brand com esse nome."
          : message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{brand ? "Editar brand de SMS" : "Nova brand de SMS"}</DialogTitle>
          <DialogDescription>
            Aparece no painel "Produtos (SMS)" da Base de Suporte dos agentes.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="s-nome">Nome *</Label>
            <Input
              id="s-nome"
              value={form.nome}
              onChange={(e) => set("nome", e.target.value)}
              placeholder="Ex: GlucoOff"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s-sistema">Nome no sistema *</Label>
            <Input
              id="s-sistema"
              value={form.sistema}
              onChange={(e) => set("sistema", e.target.value)}
              placeholder="Ex: Integrated Center for Wellbeing & Health"
            />
            <p className="text-xs text-muted-foreground">
              Como a brand aparece no sistema de suporte — é o que o agente confere antes de
              responder.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Estrutura *</Label>
              <Select
                value={form.estrutura}
                onValueChange={(v) => set("estrutura", v as Estrutura)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-50">
                  <SelectItem value="nova">Nova</SelectItem>
                  <SelectItem value="antiga">Antiga</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-numero">Número de SMS</Label>
              <Input
                id="s-numero"
                value={form.sms_number}
                onChange={(e) => set("sms_number", e.target.value)}
                placeholder="Ex: 844-526-1914"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="s-ativo">Visível para os agentes</Label>
              <p className="text-xs text-muted-foreground">
                Desativada, some da Base de Suporte sem ser apagada.
              </p>
            </div>
            <Switch id="s-ativo" checked={form.ativo} onCheckedChange={(v) => set("ativo", v)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
