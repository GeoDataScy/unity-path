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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useSaveSupportSmsReplyMutation } from "../useSupportBaseQuery";
import type { SupportSmsReply } from "../types";

type SmsReplyFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reply: SupportSmsReply | null;
  nextSortOrder: number;
  /** Categorias já existentes, oferecidas como sugestão no datalist. */
  categorias: string[];
};

const vazio = {
  categoria: "",
  titulo: "",
  texto_en: "",
  texto_pt: "",
  ativo: true,
};

export function SmsReplyFormDialog({
  open,
  onOpenChange,
  reply,
  nextSortOrder,
  categorias,
}: SmsReplyFormDialogProps) {
  const { toast } = useToast();
  const save = useSaveSupportSmsReplyMutation();

  const [form, setForm] = useState(vazio);

  useEffect(() => {
    if (!open) return;
    setForm(
      reply
        ? {
            categoria: reply.categoria,
            titulo: reply.titulo,
            texto_en: reply.texto_en,
            texto_pt: reply.texto_pt,
            ativo: reply.ativo,
          }
        : vazio,
    );
  }, [open, reply]);

  const set = <K extends keyof typeof vazio>(key: K, value: (typeof vazio)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    const categoria = form.categoria.trim();
    const titulo = form.titulo.trim();
    const en = form.texto_en.trim();
    const pt = form.texto_pt.trim();

    if (!categoria || !titulo || !en || !pt) {
      toast({
        title: "Preencha categoria, situação e os dois idiomas.",
        description: "O agente alterna entre EN e PT no mesmo card — os dois textos são exigidos.",
        variant: "destructive",
      });
      return;
    }

    try {
      await save.mutateAsync({
        id: reply?.id,
        values: {
          categoria,
          titulo,
          texto_en: en,
          texto_pt: pt,
          ativo: form.ativo,
          sort_order: reply?.sort_order ?? nextSortOrder,
        },
      });
      toast({ title: reply ? "Mensagem atualizada." : "Mensagem criada." });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Não foi possível salvar.",
        description: (error as { message?: string })?.message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{reply ? "Editar mensagem" : "Nova mensagem de SMS"}</DialogTitle>
          <DialogDescription>
            Aparece no painel "Respostas SMS" da Base de Suporte dos agentes.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="r-categoria">Categoria *</Label>
              <Input
                id="r-categoria"
                list="categorias-sms"
                value={form.categoria}
                onChange={(e) => set("categoria", e.target.value)}
                placeholder="Ex: Atendimento Geral"
              />
              <datalist id="categorias-sms">
                {categorias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-titulo">Situação *</Label>
              <Input
                id="r-titulo"
                value={form.titulo}
                onChange={(e) => set("titulo", e.target.value)}
                placeholder="Ex: Localizar pedido / Pedir e-mail"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="r-en">Texto em inglês *</Label>
            <Textarea
              id="r-en"
              rows={4}
              value={form.texto_en}
              onChange={(e) => set("texto_en", e.target.value)}
              placeholder="Hi (cliente), …"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="r-pt">Texto em português *</Label>
            <Textarea
              id="r-pt"
              rows={4}
              value={form.texto_pt}
              onChange={(e) => set("texto_pt", e.target.value)}
              placeholder="Olá (cliente), …"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="r-ativo">Visível para os agentes</Label>
              <p className="text-xs text-muted-foreground">
                Desativada, some da Base de Suporte sem ser apagada.
              </p>
            </div>
            <Switch id="r-ativo" checked={form.ativo} onCheckedChange={(v) => set("ativo", v)} />
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
