import { useCallback, useEffect, useRef, useState } from "react";
import { FileSpreadsheet, FileText, Loader2, UploadCloud } from "lucide-react";

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
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { LYA_MAX_BYTES, LYA_MAX_LINHAS, parseLyaFile } from "./parseLyaFile";
import { useEnviarLyaArquivo } from "./useLyaArquivos";
import type { LyaArquivoParse } from "../types";

// Diálogo de "dar um arquivo para a Lya" (tela Arquivos da Lya).
//
// O parse acontece ANTES de subir: assim o erro de formato aparece de cara, e
// a gestora vê o que a Lya vai receber (linhas e colunas reconhecidas) antes de
// confirmar. Só depois de confirmar é que as linhas viajam.

const ACEITA = ".csv,.tsv,.md,.markdown,.txt,.xlsx,.xls,.ods";

const ETAPA_LABEL: Record<string, string> = {
  criando: "criando o arquivo…",
  enviando: "enviando as linhas…",
  interpretando: "a Lya está lendo o arquivo…",
};

export function LyaUploadDialog({
  open,
  onOpenChange,
  onEnviado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEnviado?: (id: string) => void;
}) {
  const { toast } = useToast();
  const { enviar, enviando, progresso } = useEnviarLyaArquivo();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parse, setParse] = useState<LyaArquivoParse | null>(null);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);

  // Reabrir o diálogo tem que começar limpo, senão a gestora confirma o
  // arquivo anterior sem perceber.
  useEffect(() => {
    if (open) return;
    setParse(null);
    setNome("");
    setErro(null);
    setArrastando(false);
  }, [open]);

  const escolher = useCallback(async (file: File) => {
    setErro(null);
    try {
      const lido = parseLyaFile(await file.arrayBuffer(), file.name);
      setParse(lido);
      setNome((atual) => atual || file.name.replace(/\.[^.]+$/, "") || file.name);
    } catch (err) {
      setParse(null);
      setErro(err instanceof Error ? err.message : "Não consegui ler esse arquivo.");
    }
  }, []);

  const confirmar = async () => {
    if (!parse) return;
    const titulo = nome.trim() || parse.arquivo;
    try {
      const { arquivo, interpretado, aviso } = await enviar(titulo, parse);
      toast(
        interpretado
          ? { title: "Arquivo no acervo", description: `A Lya leu ${arquivo.nome} e já pode consultá-lo.` }
          : {
              title: "Arquivo no acervo, sem a leitura da Lya",
              description: aviso ?? "Ele está consultável, mas sem o resumo automático. Você pode escrever o resumo na lista.",
            },
      );
      onEnviado?.(arquivo.id);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Não consegui subir o arquivo",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const pct = progresso && progresso.total > 0 ? Math.round((progresso.enviadas / progresso.total) * 100) : null;
  const Icone = parse?.tipo === "markdown" ? FileText : FileSpreadsheet;

  return (
    <Dialog open={open} onOpenChange={(v) => (enviando ? undefined : onOpenChange(v))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dar um arquivo para a Lya</DialogTitle>
          <DialogDescription>
            Planilha (.csv, .xlsx, .ods) ou documento (.md, .txt). Ela lê as colunas, escreve o que entendeu e passa a
            cruzar esses dados com os do sistema quando você perguntar.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept={ACEITA}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void escolher(file);
          }}
        />

        <button
          type="button"
          disabled={enviando}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void escolher(file);
          }}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-7 text-center transition-colors",
            arrastando ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-muted/40",
            enviando && "pointer-events-none opacity-60",
          )}
        >
          <UploadCloud className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm font-medium">{parse ? "Escolher outro arquivo" : "Escolher ou arrastar o arquivo"}</span>
          <span className="text-xs text-muted-foreground">
            Até {LYA_MAX_LINHAS.toLocaleString("pt-BR")} linhas e {Math.round(LYA_MAX_BYTES / 1024 / 1024)} MB
          </span>
        </button>

        {erro && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>
        )}

        {parse && (
          <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex items-start gap-2.5">
              <Icone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{parse.arquivo}</p>
                <p className="text-xs text-muted-foreground">
                  {parse.tipo === "markdown"
                    ? `documento · ${parse.conteudo.length.toLocaleString("pt-BR")} caracteres`
                    : `${parse.linhas.length.toLocaleString("pt-BR")} linha(s) · ${parse.colunas.length} coluna(s)`}
                </p>
              </div>
            </div>
            {parse.colunas.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {parse.colunas.slice(0, 14).map((c) => (
                  <span
                    key={c.nome}
                    className="rounded-md bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground"
                    title={`${c.tipo} · ${c.preenchidas.toLocaleString("pt-BR")} preenchidas · ${c.distintos.toLocaleString("pt-BR")} distintos`}
                  >
                    {c.nome}
                  </span>
                ))}
                {parse.colunas.length > 14 && (
                  <span className="px-1 py-0.5 text-[11px] text-muted-foreground">+{parse.colunas.length - 14}</span>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="lya-arquivo-nome" className="text-xs">
                Como a Lya vai chamar este arquivo
              </Label>
              <Input
                id="lya-arquivo-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                disabled={enviando}
                placeholder="Ex.: Reembolsos externos de setembro"
              />
            </div>
          </div>
        )}

        {enviando && (
          <div className="space-y-1.5">
            <Progress value={pct ?? undefined} />
            <p className="text-xs text-muted-foreground">
              {ETAPA_LABEL[progresso?.etapa ?? "criando"]}
              {progresso?.etapa === "enviando" && progresso.total > 0 && (
                <> {progresso.enviadas.toLocaleString("pt-BR")} de {progresso.total.toLocaleString("pt-BR")}</>
              )}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={!parse || enviando}>
            {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Dar para a Lya
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
