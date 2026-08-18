import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

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
import { useSaveSupportProductMutation } from "../useSupportBaseQuery";
import type { BonusTipo, Estrutura, ProductLink, SupportProduct } from "../types";

const SEM_BONUS = "nenhum";

type ProductFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = criar novo. */
  product: SupportProduct | null;
  /** Ordem dada a um produto novo, para ele cair no fim da lista. */
  nextSortOrder: number;
};

const vazio = {
  nome: "",
  funcao: "",
  url: "",
  estrutura: "nova" as Estrutura,
  plataforma: "",
  bonus_url: "",
  bonus_tipo: SEM_BONUS as BonusTipo | typeof SEM_BONUS,
  nicho: "",
  sms_number: "",
  ativo: true,
};

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  nextSortOrder,
}: ProductFormDialogProps) {
  const { toast } = useToast();
  const save = useSaveSupportProductMutation();

  const [form, setForm] = useState(vazio);
  const [links, setLinks] = useState<ProductLink[]>([]);

  // Recarrega o formulário toda vez que o diálogo abre — sem isso, editar um
  // produto e abrir "Novo" em seguida mostraria os dados do anterior.
  useEffect(() => {
    if (!open) return;
    if (product) {
      setForm({
        nome: product.nome,
        funcao: product.funcao ?? "",
        url: product.url ?? "",
        estrutura: product.estrutura,
        plataforma: product.plataforma ?? "",
        bonus_url: product.bonus_url ?? "",
        bonus_tipo: product.bonus_tipo ?? SEM_BONUS,
        nicho: product.nicho ?? "",
        sms_number: product.sms_number ?? "",
        ativo: product.ativo,
      });
      setLinks(product.links);
    } else {
      setForm(vazio);
      setLinks([]);
    }
  }, [open, product]);

  const set = <K extends keyof typeof vazio>(key: K, value: (typeof vazio)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    const nome = form.nome.trim();
    if (!nome) {
      toast({ title: "O nome do produto é obrigatório.", variant: "destructive" });
      return;
    }

    const limpos = links
      .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => l.url);

    try {
      await save.mutateAsync({
        id: product?.id,
        values: {
          nome,
          funcao: form.funcao.trim() || null,
          url: form.url.trim() || null,
          estrutura: form.estrutura,
          plataforma: form.plataforma.trim() || null,
          bonus_url: form.bonus_url.trim() || null,
          bonus_tipo: form.bonus_tipo === SEM_BONUS ? null : form.bonus_tipo,
          nicho: form.nicho.trim() || null,
          sms_number: form.sms_number.trim() || null,
          links: limpos,
          ativo: form.ativo,
          sort_order: product?.sort_order ?? nextSortOrder,
        },
      });
      toast({ title: product ? "Produto atualizado." : "Produto criado." });
      onOpenChange(false);
    } catch (error) {
      const message = (error as { message?: string })?.message ?? "";
      toast({
        title: "Não foi possível salvar.",
        description: message.includes("support_products_nome_uniq")
          ? "Já existe um produto com esse nome."
          : message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? "Editar produto" : "Novo produto"}</DialogTitle>
          <DialogDescription>
            Aparece no painel "Produtos (E-mail)" da Base de Suporte dos agentes.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-nome">Nome *</Label>
              <Input
                id="p-nome"
                value={form.nome}
                onChange={(e) => set("nome", e.target.value)}
                placeholder="Ex: Presgera"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-funcao">Função</Label>
              <Input
                id="p-funcao"
                value={form.funcao}
                onChange={(e) => set("funcao", e.target.value)}
                placeholder="Ex: Neuropatia"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-url">Página principal</Label>
            <Input
              id="p-url"
              value={form.url}
              onChange={(e) => set("url", e.target.value)}
              placeholder="https://…"
            />
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
                  <SelectItem value="nova">Nova (lojas independentes)</SelectItem>
                  <SelectItem value="antiga">Antiga (CartPanda / ClickBank / Digistore)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-plat">Plataforma</Label>
              <Input
                id="p-plat"
                value={form.plataforma}
                onChange={(e) => set("plataforma", e.target.value)}
                placeholder="Ex: CartPanda · BuyGoods"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-nicho">Nicho</Label>
              <Input
                id="p-nicho"
                value={form.nicho}
                onChange={(e) => set("nicho", e.target.value)}
                placeholder="Ex: Pain Relief"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-sms">Número de SMS</Label>
              <Input
                id="p-sms"
                value={form.sms_number}
                onChange={(e) => set("sms_number", e.target.value)}
                placeholder="Ex: 833-762-2450"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <div className="space-y-1.5">
              <Label htmlFor="p-bonus">Página de bônus</Label>
              <Input
                id="p-bonus"
                value={form.bonus_url}
                onChange={(e) => set("bonus_url", e.target.value)}
                placeholder="https://…/bonus/"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de bônus</Label>
              <Select
                value={form.bonus_tipo}
                onValueChange={(v) => set("bonus_tipo", v as BonusTipo | typeof SEM_BONUS)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-50">
                  <SelectItem value={SEM_BONUS}>Sem bônus</SelectItem>
                  <SelectItem value="simples">Bônus simples</SelectItem>
                  <SelectItem value="super">Super bônus</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <Label>Outras páginas de venda</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLinks((l) => [...l, { label: "", url: "" }])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Adicionar
              </Button>
            </div>
            {links.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma. Use para VSL, checkout alternativo, etc.
              </p>
            ) : (
              <div className="space-y-2">
                {links.map((link, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={link.label}
                      onChange={(e) =>
                        setLinks((l) =>
                          l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                        )
                      }
                      placeholder="Rótulo (ex: BuyGoods VSL)"
                      className="w-[220px] shrink-0"
                    />
                    <Input
                      value={link.url}
                      onChange={(e) =>
                        setLinks((l) =>
                          l.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                        )
                      }
                      placeholder="https://…"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setLinks((l) => l.filter((_, j) => j !== i))}
                      aria-label="Remover link"
                      className="shrink-0"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="p-ativo">Visível para os agentes</Label>
              <p className="text-xs text-muted-foreground">
                Desativado, some da Base de Suporte sem ser apagado.
              </p>
            </div>
            <Switch
              id="p-ativo"
              checked={form.ativo}
              onCheckedChange={(v) => set("ativo", v)}
            />
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
