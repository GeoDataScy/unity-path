import { Brain } from "lucide-react";

import { LyaTreinar } from "@/features/lya/components/LyaTreinar";

/** Cérebro da Lya (/dashboard/lya/cerebro) — só gestora: treinar e revisar memórias. */
export default function DashboardLyaCerebro() {
  return (
    <main className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Brain className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Cérebro da Lya</h1>
          <p className="text-sm text-muted-foreground">
            Tudo que a Lya aprendeu com a gestora. Cada memória vale para todas as conversas, na próxima pergunta.
          </p>
        </div>
      </header>
      <LyaTreinar />
    </main>
  );
}
