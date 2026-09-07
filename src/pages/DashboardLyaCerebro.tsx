import { useState } from "react";
import { Brain, GraduationCap, Network, type LucideIcon } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { LyaBrainGraph } from "@/features/lya/components/LyaBrainGraph";
import { LyaCerebroTicker } from "@/features/lya/components/LyaCerebroTicker";
import { LyaTreinar } from "@/features/lya/components/LyaTreinar";
import type { LyaMemory } from "@/features/lya/types";
import { useDeleteLyaMemory, useLyaMemoriesQuery } from "@/features/lya/useLyaMemories";
import { cn } from "@/lib/utils";

type Aba = "grafo" | "treinar";

/**
 * Cérebro da Lya (/dashboard/lya/cerebro) — só gestora.
 * Aba Grafo: a memória como um grafo ao vivo (estilo Obsidian). Aba Treinar:
 * o console de treino. As duas leem a MESMA query de memórias: treinar na
 * segunda faz o nó nascer na primeira.
 */
export default function DashboardLyaCerebro() {
  const { toast } = useToast();
  const [aba, setAba] = useState<Aba>("grafo");
  const [editando, setEditando] = useState<LyaMemory | null>(null);
  const [treinando, setTreinando] = useState(false);

  // Polling curto na aba do grafo: é o "ao vivo" — memórias ensinadas pelo
  // chat (modo treino) ou por outra gestora aparecem nascendo aqui.
  const memorias = useLyaMemoriesQuery(true, aba === "grafo" ? 4000 : false);
  const apagar = useDeleteLyaMemory();

  const editarNoTreino = (m: LyaMemory) => {
    setEditando(m);
    setAba("treinar");
  };

  const apagarMemoria = async (name: string) => {
    try {
      await apagar.mutateAsync(name);
      toast({ title: "Memória removida." });
    } catch (err) {
      toast({ title: "Não consegui remover.", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };

  return (
    <main className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Brain className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Cérebro da Lya</h1>
            <p className="text-sm text-muted-foreground">
              Cada nó é uma memória, cada linha uma conexão. Vale para todas as conversas, na próxima pergunta.
            </p>
          </div>
        </div>
        <div className="inline-flex gap-1 rounded-xl border border-border bg-card p-1">
          <TabButton on={aba === "grafo"} onClick={() => setAba("grafo")} label="Grafo" icon={Network} />
          <TabButton
            on={aba === "treinar"}
            onClick={() => {
              setEditando(null);
              setAba("treinar");
            }}
            label="Treinar"
            icon={GraduationCap}
          />
        </div>
      </header>

      <LyaCerebroTicker memorias={memorias.data ?? []} carregando={memorias.isLoading} />

      {aba === "grafo" ? (
        <LyaBrainGraph
          memorias={memorias.data ?? []}
          carregando={memorias.isLoading}
          treinando={treinando}
          onEditar={editarNoTreino}
          onApagar={apagarMemoria}
          onEnsinar={() => {
            setEditando(null);
            setAba("treinar");
          }}
        />
      ) : (
        // `key`: escolher outra memória no grafo precisa RESEMEAR o formulário.
        <LyaTreinar
          key={editando?.name ?? "nova"}
          editar={editando ?? undefined}
          onTreinandoChange={setTreinando}
          onSaved={() => {
            setEditando(null);
            setAba("grafo");
          }}
        />
      )}
    </main>
  );
}

function TabButton({ on, onClick, label, icon: Icon }: { on: boolean; onClick: () => void; label: string; icon: LucideIcon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg px-4 py-2 text-[13.5px] font-medium transition-colors",
        on ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}
