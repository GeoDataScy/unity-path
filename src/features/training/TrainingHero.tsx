import logo from "@/assets/logo-xmx.png";

type Props = {
  totalVideos: number;
  watchedCount: number;
  agentName?: string | null;
};

export function TrainingHero({ totalVideos, watchedCount, agentName }: Props) {
  const greeting = agentName ? `Olá, ${agentName.split(" ")[0]}!` : "Olá!";
  const pct = totalVideos > 0 ? Math.round((watchedCount / totalVideos) * 100) : 0;

  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-slate-900 text-white shadow-lg"
      style={{ minHeight: 280 }}
    >
      {/* Cover image placeholder — substitua adicionando uma <img> aqui depois */}
      <div
        className="absolute inset-0"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(80% 60% at 0% 0%, rgba(99,102,241,0.55), transparent 60%), radial-gradient(70% 60% at 100% 100%, rgba(236,72,153,0.40), transparent 60%), linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)",
        }}
      />
      {/* Subtle grid texture */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        aria-hidden
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent" aria-hidden />

      <div className="relative flex flex-col gap-6 p-6 sm:p-10">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 backdrop-blur ring-1 ring-white/15">
            <img src={logo} alt="XMX" className="h-7 w-auto" />
          </div>
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/70">
            Treinamento • XMX Suporte
          </span>
        </div>

        <div className="max-w-2xl space-y-3">
          <p className="text-sm text-white/70">{greeting}</p>
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">Comece por aqui</h1>
          <p className="text-sm text-white/80 sm:text-base">
            Vídeos curtos para você dominar a plataforma — atendimento, reembolsos e métricas. Assista no
            seu ritmo: cada card abre direto no player.
          </p>
        </div>

        {totalVideos > 0 && (
          <div className="flex w-full max-w-md flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-white/80">
              <span>Seu progresso</span>
              <span className="font-semibold text-white">
                {watchedCount} de {totalVideos} ({pct}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
