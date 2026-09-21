import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

import type { LyaEstado, LyaMessage } from "../types";
import { ChartCard } from "./ChartCard";
import { MemoryCard, RevisaoNotas, ThinkingDots, ThinkingIndicator, ToolActivity } from "./ChatActivity";
import { LyaMark } from "./LyaMark";
import { Markdown } from "./Markdown";

// Lista de mensagens de uma conversa com a Lya (compartilhada pelo balão e
// pela tela cheia). Rola para o fim a cada mudança.
//
// Só o símbolo da última resposta anima — os das mensagens anteriores ficam
// congelados. Uma thread de 50 mensagens não pode ter 50 SVGs animando juntos.
export function LyaMessages({
  messages,
  loading,
  loadingHistory,
  compact = false,
  estado = "repouso",
}: {
  messages: LyaMessage[];
  loading: boolean;
  loadingHistory?: boolean;
  compact?: boolean;
  estado?: LyaEstado;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  return (
    <div ref={scrollRef} className={cn("flex-1 overflow-y-auto", compact ? "space-y-4 p-4" : "space-y-6 px-1 py-6")}>
      {loadingHistory && messages.length === 0 && (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {messages.map((m, i) => {
        const ultima = i === messages.length - 1;
        return (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            {m.role === "user" ? (
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground",
                  compact ? "text-sm" : "text-[15px] leading-relaxed",
                )}
              >
                {m.content}
              </div>
            ) : (
              <div className={cn("flex w-full gap-3", compact && "gap-2.5")}>
                {!compact && (
                  <LyaMark
                    size={28}
                    estado={ultima ? estado : "repouso"}
                    congelado={!ultima}
                    label={null}
                    className="mt-0.5"
                  />
                )}
                <div className="min-w-0 flex-1">
                  {m.tools && m.tools.length > 0 && <ToolActivity tools={m.tools} active={!m.content && loading && ultima} />}
                  <div className={cn("text-foreground", compact ? "text-sm leading-relaxed" : "text-[15px] leading-[1.7]")}>
                    {m.content ? (
                      <>
                        <Markdown>{m.content}</Markdown>
                        {loading && ultima && (
                          <span className="mt-1 inline-flex">
                            <ThinkingDots />
                          </span>
                        )}
                      </>
                    ) : m.tools && m.tools.length > 0 ? (
                      <ThinkingIndicator label="Analisando os dados" />
                    ) : (
                      <ThinkingIndicator label="Pensando" />
                    )}
                  </div>
                  {m.charts?.map((c, ci) => <ChartCard key={ci} chart={c} />)}
                  {m.memorias?.map((mem, mi) => <MemoryCard key={mi} memoria={mem} />)}
                  {!loading || !ultima ? <RevisaoNotas revisao={m.revisao} /> : null}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
