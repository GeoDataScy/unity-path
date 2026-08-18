import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CopyButtonProps = {
  value: string;
  /** Sem label o botão vira só o ícone (usado nas linhas de link do card). */
  label?: string;
  className?: string;
  size?: "sm" | "icon";
};

/**
 * Copiar é a ação mais repetida da Base de Suporte — o agente copia link, número
 * e mensagem pronta o dia inteiro. O retorno fica no próprio botão (vira "Copiado"
 * por 2s) em vez de toast: com dezenas de botões na tela, toast empilharia.
 */
export function CopyButton({ value, label = "Copiar", className, size = "sm" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number>();

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // navigator.clipboard falha em contexto não-seguro; cai no fallback textarea.
      const el = document.createElement("textarea");
      el.value = value;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  const Icon = copied ? Check : Copy;

  if (size === "icon") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleCopy}
        aria-label={copied ? "Copiado" : label}
        className={cn("h-7 w-7 shrink-0", copied && "text-emerald-600", className)}
      >
        <Icon className="h-3.5 w-3.5" />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopy}
      className={cn("h-8 gap-1.5 text-xs", copied && "border-emerald-500 text-emerald-600", className)}
    >
      <Icon className="h-3.5 w-3.5" />
      {copied ? "Copiado" : label}
    </Button>
  );
}
