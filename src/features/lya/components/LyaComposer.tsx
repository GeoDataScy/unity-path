import { useEffect, useRef, useState } from "react";
import { GraduationCap, Loader2, Mic, Paperclip, Send } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** O que o seletor aceita — o mesmo que `parseLyaFile` sabe ler. */
const ACEITA_ARQUIVO = ".csv,.tsv,.md,.markdown,.txt,.xlsx,.xls,.ods";

// Caixa de envio da Lya (tela cheia e balão). Enter envia, Shift+Enter quebra
// linha. O botão "Treinar" só aparece para a gestora. O microfone é só o
// símbolo por enquanto: o comando de voz ainda não existe, e o clique avisa.
export function LyaComposer({
  onSend,
  disabled,
  loading,
  compact = false,
  autoFocus = true,
  canTrain = false,
  modoTreino = false,
  onToggleTreino,
  onAnexar,
  anexando = false,
  placeholder,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  autoFocus?: boolean;
  canTrain?: boolean;
  modoTreino?: boolean;
  onToggleTreino?: () => void;
  /** Anexa um arquivo à pergunta. Sem o callback, o clipe não aparece. */
  onAnexar?: (file: File) => void;
  /** Anexo em voo: o clipe gira e não aceita outro até terminar. */
  anexando?: boolean;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const avisarVoz = () =>
    toast({
      title: "Comando de voz em construção",
      description: "Em breve você vai poder falar com a Lya. Por enquanto, escreva a pergunta.",
    });

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const autoResize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, compact ? 112 : 200)}px`;
  };

  const enviar = () => {
    const text = input.trim();
    if (!text || disabled || loading) return;
    onSend(text);
    setInput("");
    if (ref.current) ref.current.style.height = "auto";
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border bg-card shadow-sm transition-colors focus-within:border-primary/60",
        modoTreino ? "border-primary shadow-primary/20" : "border-border",
      )}
    >
      <textarea
        ref={ref}
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          autoResize();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            enviar();
          }
        }}
        rows={1}
        disabled={disabled}
        placeholder={
          placeholder ?? (modoTreino ? "Ensine, corrija ou explique algo para a Lya aprender…" : "Pergunte sobre os dados do suporte…")
        }
        className={cn(
          "w-full resize-none bg-transparent text-foreground outline-none placeholder:text-muted-foreground",
          compact ? "max-h-28 px-3.5 pt-3 text-sm" : "max-h-[200px] px-5 pt-4 text-[15px] leading-relaxed",
        )}
      />
      <div className={cn("flex items-center justify-between", compact ? "px-2 pb-2 pt-1" : "px-3 pb-3 pt-1.5")}>
        <div className="flex items-center gap-1.5">
          {canTrain && onAnexar && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept={ACEITA_ARQUIVO}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Zera o input: escolher o MESMO arquivo de novo tem que
                  // disparar o change (depois de um erro, por exemplo).
                  e.target.value = "";
                  if (file) onAnexar(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={disabled || anexando}
                aria-label="Anexar arquivo"
                title="Anexar planilha ou documento para a Lya ler"
                className={cn(
                  "grid shrink-0 place-items-center rounded-full text-muted-foreground transition-colors enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-35",
                  compact ? "h-8 w-8" : "h-9 w-9",
                )}
              >
                {anexando ? (
                  <Loader2 className={cn("animate-spin", compact ? "h-4 w-4" : "h-[18px] w-[18px]")} />
                ) : (
                  <Paperclip className={compact ? "h-4 w-4" : "h-[18px] w-[18px]"} />
                )}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={avisarVoz}
            disabled={disabled}
            aria-label="Comando de voz (em construção)"
            title="Comando de voz — em construção"
            className={cn(
              "grid shrink-0 place-items-center rounded-full text-muted-foreground transition-colors enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-35",
              compact ? "h-8 w-8" : "h-9 w-9",
            )}
          >
            <Mic className={compact ? "h-4 w-4" : "h-[18px] w-[18px]"} />
          </button>
          {canTrain && (
            <button
              type="button"
              onClick={onToggleTreino}
              disabled={loading}
              role="switch"
              aria-checked={modoTreino}
              title="Modo treino: suas mensagens ensinam e corrigem a Lya"
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors disabled:opacity-40",
                modoTreino ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <GraduationCap className="h-4 w-4" />
              Treinar
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={enviar}
          disabled={disabled || loading || !input.trim()}
          aria-label="Enviar"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-35"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
