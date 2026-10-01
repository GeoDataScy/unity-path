import { useState } from "react";
import { Brain, GraduationCap, Network, type LucideIcon } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { LyaBrainGraph } from "@/features/lya/components/LyaBrainGraph";
import { LyaCerebroTicker } from "@/features/lya/components/LyaCerebroTicker";
import { LyaTreinar } from "@/features/lya/components/LyaTreinar";
import { useLyaArquivosGrafoQuery, useLyaSistemaQuery } from "@/features/lya/sistema";
import type { LyaMemory } from "@/features/lya/types";
import { useDeleteLyaMemory, useDeleteSeedMemories, useLyaMemoriesQuery } from "@/features/lya/useLyaMemories";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type Aba = "grafo" | "treinar";

/**
 * Cérebro da Lya (/dashboard/lya/cerebro) — só gestora.
 * Aba Grafo: o cérebro como um grafo ao vivo (estilo Obsidian), em três
 * camadas — as memórias treinadas, os arquivos que ela ingeriu e o alcance
 * real dela (as tabelas e telas que consegue consultar). Aba Treinar: o
 * console de treino. As duas leem a MESMA query de memórias: treinar na
 * segunda faz o nó nascer na primeira.
 *
 * As três camadas vêm de queries separadas de propósito: o polling curto do
 * "ao vivo" é só das memórias (é o que muda a cada treino); arquivos e catálogo
 * mudam devagar e têm staleTime próprio, para não bater no banco a cada 4 s.
 */
export default function DashboardLyaCerebro() {
  const { toast } = useToast();
  const [aba, setAba] = useState<Aba>("grafo");
  const [editando, setEditando] = useState<LyaMemory | null>(null);
  const [treinando, setTreinando] = useState(false);

  // Polling curto na aba do grafo: é o "ao vivo" — memórias ensinadas pelo
  // chat (modo treino) ou por outra gestora aparecem nascendo aqui.
  const memorias = useLyaMemoriesQuery(true, aba === "grafo" ? 4000 : false);
  const arquivos = useLyaArquivosGrafoQuery(true);
  const sistema = useLyaSistemaQuery(true);
  const apagar = useDeleteLyaMemory();
  const apagarExemplos = useDeleteSeedMemories();
  const [confirmarExemplos, setConfirmarExemplos] = useState(false);

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
            <h1 className="text-xl font-medium">Cérebro da Lya</h1>
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

      <LyaCerebroTicker
        memorias={memorias.data ?? []}
        arquivos={arquivos.data ?? []}
        sistema={sistema.data?.nos ?? []}
        carregando={memorias.isLoading}
      />

      {aba === "grafo" ? (
        <LyaBrainGraph
          memorias={memorias.data ?? []}
          arquivos={arquivos.data ?? []}
          sistema={sistema.data?.nos ?? []}
          carregando={memorias.isLoading}
          treinando={treinando}
          onEditar={editarNoTreino}
          onApagar={apagarMemoria}
          onEnsinar={() => {
            setEditando(null);
            setAba("treinar");
          }}
          onRemoverExemplos={() => setConfirmarExemplos(true)}
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
      <AlertDialog open={confirmarExemplos} onOpenChange={setConfirmarExemplos}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover as memórias de exemplo?</AlertDialogTitle>
            <AlertDialogDescription>
              Apaga só o que veio marcado como exemplo. Tudo que você ensinou à Lya continua. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  const n = await apagarExemplos.mutateAsync();
                  toast({ title: `${n} memória${n === 1 ? "" : "s"} de exemplo removida${n === 1 ? "" : "s"}.` });
                } catch (err) {
                  toast({ title: "Não consegui remover.", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
                }
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
