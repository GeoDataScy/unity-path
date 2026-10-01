import { Logo } from "@/components/brand/Logo";

type Props = {
  agentName?: string | null;
};

export function TrainingHero({ agentName }: Props) {
  const greeting = agentName ? `Olá, ${agentName.split(" ")[0]}!` : "Olá!";

  return (
    <div
      className="dark relative overflow-hidden rounded-lg bg-surface text-ink ring-1 ring-line"
      style={{ minHeight: 280 }}
    >
      {/* Cover image placeholder — substitua adicionando uma <img> aqui depois */}
      <div
        className="absolute inset-0"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(60% 70% at 100% 100%, hsl(var(--signal) / 0.14), transparent 60%)",
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
      <div className="absolute inset-0 bg-gradient-to-t from-canvas/60 via-transparent" aria-hidden />

      <div className="relative flex flex-col gap-6 p-6 sm:p-10">
        <div className="flex items-center gap-3">
          <Logo variant="mark" height={44} />
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">
            Guia da plataforma • hubi
          </span>
        </div>

        <div className="max-w-2xl space-y-3">
          <p className="text-sm text-ink-tertiary">{greeting}</p>
          <h1 className="text-[32px] font-medium leading-9 tracking-[-0.03em] sm:text-[48px] sm:leading-[52px] sm:tracking-[-0.035em]">Comece por aqui</h1>
          <p className="text-sm text-ink-secondary sm:text-base">
            Vídeos curtos para você dominar a plataforma — atendimento, reembolsos e métricas. Assista no
            seu ritmo: cada card abre direto no player.
          </p>
        </div>

      </div>
    </div>
  );
}
