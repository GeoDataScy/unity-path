import { useEffect, useMemo, useState } from "react";
import { Ban, Check, GraduationCap, RotateCcw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { TIPO_MEMORIA_MAP, TIPOS_MEMORIA, type LyaMemory, type LyaMemoryType } from "../types";
import { useDeleteLyaMemory, useLyaMemoriesQuery, useSaveLyaMemory } from "../useLyaMemories";

// Console de treino do cérebro da Lya: ensinar algo novo (compositor), ver
// tudo que ela já sabe, buscar/filtrar por tipo, editar e apagar. O treinador
// (na Edge Function) classifica e enriquece o que a gestora escreve.

const parseTags = (s: string) =>
  Array.from(new Set(s.split(/[,\n]/).flatMap((p) => p.trim().split(/\s+/)).map((t) => t.replace(/^#/, "").trim()).filter(Boolean)));

type FormState = {
  editing: string | null;
  type: LyaMemoryType | "auto";
  description: string;
  tags: string;
  body: string;
};

const FORM_VAZIO: FormState = { editing: null, type: "auto", description: "", tags: "", body: "" };

const EXEMPLOS = [
  { tipo: "Preferência", texto: "Responda em no máximo 5 linhas, com a conclusão na primeira frase." },
  { tipo: "Preferência", texto: "Sempre que mostrar ranking de agentes, inclua a meta diária de cada um." },
  { tipo: "Sobre a Lya", texto: "Você responde para a gestora do suporte; priorize os números da tela Atendimentos." },
  { tipo: "Nota", texto: "A Ana Vidotti atende só por e-mail; os SMS ficam com a Giovanna." },
];

export function LyaGuia() {
  const [aberto, setAberto] = useState(false);
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-medium">
            <GraduationCap className="h-4 w-4 text-primary" /> Como treinar a Lya
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Treinar é ensinar coisas à Lya por esta tela ou pelo botão "Treinar" no chat. Ela guarda e passa a seguir na{" "}
            <b className="text-foreground">próxima pergunta</b>.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAberto((v) => !v)}>
          {aberto ? "Ocultar guia" : "Mostrar guia"}
        </Button>
      </div>
      {aberto && (
        <div className="mt-5 grid gap-5">
          <div className="grid gap-2 sm:grid-cols-2">
            {TIPOS_MEMORIA.map((tp) => (
              <div key={tp.value} className="rounded-xl border border-border bg-muted/40 p-3">
                <span className={cn("mb-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", tp.className)}>{tp.label}</span>
                <p className="text-[12px] leading-relaxed text-muted-foreground">{tp.hint}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-[13px] font-medium">Como escrever uma boa memória</h3>
              <ul className="space-y-1.5 text-[12.5px] text-muted-foreground">
                {["Um assunto por memória, curto e claro.", "Ao corrigir, escreva a regra: “sempre separar X de Y”.", "Diga de onde vem a informação quando houver."].map((t, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> {t}
                  </li>
                ))}
                {["Não misture vários assuntos na mesma memória.", "Não use a memória para “colar” um número: os números vêm do painel e do banco."].map((t, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" /> {t}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-[13px] font-medium">O passo a passo</h3>
              <ol className="space-y-1.5 text-[12.5px] text-muted-foreground">
                <li><b className="text-foreground">1.</b> Pergunte à Lya no chat.</li>
                <li><b className="text-foreground">2.</b> Ela responde citando a tela ou a consulta usada.</li>
                <li><b className="text-foreground">3.</b> Errou ou foi longa? Corrija aqui (tipo Preferência) ou ligue "Treinar" no chat.</li>
                <li className="flex items-center gap-1.5"><b className="text-foreground">4.</b> A próxima resposta já vem certa. <RotateCcw className="h-3.5 w-3.5 text-primary" /></li>
              </ol>
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-[13px] font-medium">Exemplos prontos para adaptar</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {EXEMPLOS.map((ex, i) => (
                <div key={i} className="rounded-xl border border-border bg-muted/40 p-3">
                  <div className="mb-1 text-[11px] text-muted-foreground">Tipo: <b className="text-foreground">{ex.tipo}</b></div>
                  <div className="text-[12.5px] font-medium">“{ex.texto}”</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 text-[12px] leading-relaxed text-muted-foreground">
            <b className="text-foreground">Importante:</b> as memórias ensinam a Lya a <i>como</i> responder e dão contexto do time, mas os
            números vêm sempre do painel e do banco. Se um dado não estiver em nenhuma fonte, ela avisa que não encontrou — e isso é o certo.
          </div>
        </div>
      )}
    </Card>
  );
}

function formDe(m?: LyaMemory): FormState {
  if (!m) return FORM_VAZIO;
  return { editing: m.name, description: m.description ?? "", type: m.type, tags: (m.tags ?? []).join(", "), body: m.body ?? "" };
}

export function LyaTreinar({
  editar: memoriaInicial,
  onTreinandoChange,
  onSaved,
}: {
  /** Memória escolhida no grafo para editar (lida só na montagem — use `key`). */
  editar?: LyaMemory;
  /** true enquanto o treinador está classificando/gravando. */
  onTreinandoChange?: (treinando: boolean) => void;
  onSaved?: (memoria: LyaMemory) => void;
} = {}) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => formDe(memoriaInicial));
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<LyaMemoryType | "all">("all");
  const [apagando, setApagando] = useState<string | null>(null);

  const memorias = useLyaMemoriesQuery();
  const salvar = useSaveLyaMemory();
  const apagar = useDeleteLyaMemory();

  useEffect(() => {
    onTreinandoChange?.(salvar.isPending);
  }, [salvar.isPending, onTreinandoChange]);

  const lista = useMemo(() => memorias.data ?? [], [memorias.data]);
  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of lista) c[m.type] = (c[m.type] ?? 0) + 1;
    return c;
  }, [lista]);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lista
      .filter((m) => (filtro === "all" ? true : m.type === filtro))
      .filter((m) => (!q ? true : [m.description, m.body, ...(m.tags ?? [])].join(" ").toLowerCase().includes(q)));
  }, [lista, busca, filtro]);

  const editar = (m: LyaMemory) => {
    setForm({ editing: m.name, description: m.description ?? "", type: m.type, tags: (m.tags ?? []).join(", "), body: m.body ?? "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submeter = async () => {
    if (!form.description.trim() || salvar.isPending) return;
    try {
      const mem = await salvar.mutateAsync({
        name: form.editing ?? undefined,
        description: form.description.trim(),
        type: form.type === "auto" ? null : form.type,
        tags: parseTags(form.tags),
        body: form.body.trim(),
        // enriquece ao criar ou quando o tipo é automático; edição manual com tipo explícito é respeitada
        refinar: form.type === "auto" || !form.editing,
      });
      const rotulo = TIPO_MEMORIA_MAP[mem.type]?.label ?? mem.type;
      toast({ title: form.editing ? `Memória atualizada · ${rotulo}` : `A Lya aprendeu: “${mem.description}” · ${rotulo}` });
      setForm(FORM_VAZIO);
      onSaved?.(mem);
    } catch (err) {
      toast({ title: "Não consegui salvar.", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };

  const remover = async (name: string) => {
    try {
      await apagar.mutateAsync(name);
      if (form.editing === name) setForm(FORM_VAZIO);
      toast({ title: "Memória removida." });
    } catch (err) {
      toast({ title: "Não consegui remover.", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setApagando(null);
    }
  };

  const podeSalvar = form.description.trim().length > 0 && !salvar.isPending;

  return (
    <div className="space-y-6">
      <LyaGuia />

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-medium">{form.editing ? "Editar memória" : "Ensinar algo novo à Lya"}</h2>
            <p className="text-[12.5px] text-muted-foreground">
              {form.editing
                ? "Ajuste o conteúdo e salve — a Lya atualiza na hora."
                : "Escreva uma regra, preferência ou contexto. Use [[nome-da-memória]] para conectar a outra."}
            </p>
          </div>
          {form.editing && (
            <Button variant="outline" size="sm" onClick={() => setForm(FORM_VAZIO)}>
              Cancelar edição
            </Button>
          )}
        </div>

        <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">O que a Lya deve saber?</label>
        <Input
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Ex.: Ao falar de reembolso, sempre separar integral (100%) de parcial"
          className="mb-4"
        />

        <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Tipo</label>
        <div className="mb-4 flex flex-wrap gap-2">
          {[{ value: "auto" as const, label: "Automático", hint: "A Lya classifica o tipo e melhora o texto sozinha", className: "text-primary border-primary/40" }, ...TIPOS_MEMORIA].map((tp) => {
            const on = form.type === tp.value;
            return (
              <button
                key={tp.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, type: tp.value }))}
                title={tp.hint}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  on ? cn("bg-primary/10", tp.className) : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {tp.value === "auto" && <Sparkles className="h-3.5 w-3.5" />}
                {tp.label}
              </button>
            );
          })}
        </div>

        <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
          Detalhe <span className="opacity-60">(opcional)</span>
        </label>
        <Textarea
          value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          rows={4}
          placeholder="Contexto completo, exemplos, o porquê… Suporta [[links]] para outras memórias."
          className="mb-4"
        />

        <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
          Tags <span className="opacity-60">(separe por vírgula — ajudam a Lya a achar a memória)</span>
        </label>
        <Input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="reembolso, parcial, formato" className="mb-5" />

        <div className="flex items-center gap-3">
          <Button onClick={submeter} disabled={!podeSalvar}>
            {salvar.isPending ? (form.type === "auto" ? "A Lya está aprendendo…" : "Salvando…") : form.editing ? "Salvar alterações" : "Ensinar à Lya"}
          </Button>
          {!form.editing && (
            <span className="text-[12px] text-muted-foreground">
              {lista.length} memória{lista.length === 1 ? "" : "s"} no cérebro
            </span>
          )}
        </div>
      </Card>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[14px] font-medium">O que a Lya já sabe</h3>
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar memórias…" className="max-w-xs" />
        </div>
        <div className="mb-5 flex flex-wrap gap-2">
          <FiltroChip label={`Tudo (${lista.length})`} on={filtro === "all"} onClick={() => setFiltro("all")} className="text-foreground border-border" />
          {TIPOS_MEMORIA.map((tp) => (
            <FiltroChip key={tp.value} label={`${tp.label} (${contagem[tp.value] ?? 0})`} on={filtro === tp.value} onClick={() => setFiltro(tp.value)} className={tp.className} />
          ))}
        </div>

        {memorias.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
          </div>
        ) : memorias.isError ? (
          <p className="py-10 text-center text-[13px] text-destructive">Não consegui carregar o cérebro: {memorias.error.message}</p>
        ) : visiveis.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">
            {lista.length === 0 ? "A Lya ainda não tem memórias. Ensine a primeira acima." : "Nenhuma memória bate com esse filtro."}
          </p>
        ) : (
          <div className="grid max-h-[640px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
            {visiveis.map((m) => {
              const tp = TIPO_MEMORIA_MAP[m.type] ?? TIPO_MEMORIA_MAP.nota;
              const emEdicao = form.editing === m.name;
              return (
                <article key={m.name} className={cn("group flex flex-col rounded-xl border bg-card p-4", emEdicao ? "border-primary" : "border-border")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", tp.className)}>{tp.label}</span>
                    <span className="font-mono text-[10.5px] text-muted-foreground">{m.name}</span>
                  </div>
                  <h4 className="text-[13.5px] font-medium leading-snug">{m.description || m.name}</h4>
                  {m.body && <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground">{m.body}</p>}
                  {m.tags?.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1">
                      {m.tags.map((tg) => (
                        <span key={tg} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">#{tg}</span>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-2 border-t border-border pt-2.5 text-[12px]">
                    <button type="button" onClick={() => editar(m)} className="font-medium text-primary">Editar</button>
                    {apagando === m.name ? (
                      <>
                        <span className="text-muted-foreground">Apagar?</span>
                        <button type="button" onClick={() => remover(m.name)} disabled={apagar.isPending} className="font-medium text-destructive">Sim</button>
                        <button type="button" onClick={() => setApagando(null)} className="text-muted-foreground">Não</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setApagando(m.name)} className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100">
                        Apagar
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function FiltroChip({ label, on, onClick, className }: { label: string; on: boolean; onClick: () => void; className: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors", on ? cn("bg-primary/10", className) : "border-border text-muted-foreground hover:text-foreground")}
    >
      {label}
    </button>
  );
}
