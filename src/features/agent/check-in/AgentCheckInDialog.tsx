import { useEffect } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CheckCircle2, FolderOpen, Loader2, MessageSquareText, Receipt, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type { CheckInSnapshot } from "./useCheckInSnapshot";
import { playWhoosh } from "./playWhoosh";

type Props = {
  open: boolean;
  agentName: string | null;
  snapshot: CheckInSnapshot | null;
  loading: boolean;
  onAcknowledge: () => void;
};

/**
 * Non-dismissable check-in dialog. Renders Radix primitives directly (instead
 * of the project's shadcn DialogContent) so we can suppress the close button,
 * the outside-click and the Escape key — the agent must acknowledge.
 */
export function AgentCheckInDialog({
  open,
  agentName,
  snapshot,
  loading,
  onAcknowledge,
}: Props) {
  useEffect(() => {
    if (open) {
      // Slight delay so the fade-in animation starts before the sound,
      // pairing visual + audio "rise" together.
      const t = window.setTimeout(() => playWhoosh(), 80);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const recent = snapshot?.recent;
  const today = snapshot?.today;

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/85 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 w-[92vw] max-w-lg translate-x-[-50%] translate-y-[-50%]",
            "data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[state=open]:fade-in-0 data-[state=open]:duration-300",
            "data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=closed]:fade-out-0",
          )}
        >
          {/* Outer neon glow */}
          <div className="rounded-2xl bg-gradient-to-br from-cyan-400/40 via-fuchsia-500/30 to-violet-500/40 p-[1.5px] shadow-[0_0_60px_rgba(34,211,238,0.45),0_0_120px_rgba(168,85,247,0.25)]">
            {/* Inner card */}
            <div className="relative overflow-hidden rounded-[14px] bg-slate-950 px-7 py-7 text-slate-100">
              {/* Subtle grid backdrop */}
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.08]"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(34,211,238,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.6) 1px, transparent 1px)",
                  backgroundSize: "32px 32px",
                }}
              />

              {/* Pulsing corner accents */}
              <span className="pointer-events-none absolute -left-12 -top-12 h-32 w-32 rounded-full bg-cyan-400/40 blur-3xl animate-pulse" />
              <span className="pointer-events-none absolute -right-12 -bottom-12 h-32 w-32 rounded-full bg-fuchsia-500/30 blur-3xl animate-pulse" />

              {/* Header */}
              <div className="relative flex items-center gap-2.5">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400/20 ring-1 ring-cyan-300/40">
                  <Sparkles className="h-4 w-4 text-cyan-300" />
                </span>
                <div>
                  <DialogPrimitive.Title className="text-[11px] font-medium uppercase tracking-[0.3em] text-cyan-300/90">
                    Check-in
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="text-[15px] font-medium text-slate-100">
                    Olá {agentName ?? "agente"} 👋
                  </DialogPrimitive.Description>
                </div>
              </div>

              <p className="relative mt-3 text-sm text-slate-300">
                Aqui está seu progresso recente. Confirme para continuar.
              </p>

              {/* Recent grid (last 2h) */}
              <div className="relative mt-5">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300/80">
                  Últimas 2 horas
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Stat
                    icon={<FolderOpen className="h-3.5 w-3.5" />}
                    label="Atendimentos"
                    value={recent?.services}
                    loading={loading}
                  />
                  <Stat
                    icon={<MessageSquareText className="h-3.5 w-3.5" />}
                    label="Interações"
                    value={recent?.followUps}
                    loading={loading}
                  />
                  <Stat
                    icon={<Receipt className="h-3.5 w-3.5" />}
                    label="Reembolsos"
                    value={recent?.refundsCreated}
                    loading={loading}
                  />
                  <Stat
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    label="Concluídos"
                    value={recent?.refundsCompleted}
                    loading={loading}
                  />
                </div>
              </div>

              {/* Today summary */}
              <div className="relative mt-4 rounded-lg border border-cyan-400/15 bg-cyan-400/5 px-3.5 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-fuchsia-300/80">
                  No dia inteiro
                </p>
                <p className="mt-1 text-xs text-slate-300">
                  {loading || !today ? (
                    <Skeleton className="inline-block h-3 w-56 bg-slate-700/60" />
                  ) : (
                    <>
                      <span className="font-semibold text-slate-100">{today.services}</span> atendimentos •{" "}
                      <span className="font-semibold text-slate-100">{today.followUps}</span> interações •{" "}
                      <span className="font-semibold text-slate-100">{today.refundsCreated}</span> reembolsos •{" "}
                      <span className="font-semibold text-slate-100">{today.refundsCompleted}</span> concluídos
                    </>
                  )}
                </p>
              </div>

              {/* CTA */}
              <Button
                type="button"
                onClick={onAcknowledge}
                disabled={loading}
                className={cn(
                  "relative mt-6 h-11 w-full rounded-lg border-0 text-sm font-semibold",
                  "bg-gradient-to-r from-cyan-400 via-cyan-300 to-fuchsia-400 text-slate-950",
                  "shadow-[0_0_20px_rgba(34,211,238,0.5)]",
                  "transition-all hover:shadow-[0_0_30px_rgba(34,211,238,0.7)]",
                  "active:translate-y-px",
                  "disabled:opacity-60",
                )}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                  </span>
                ) : (
                  "Os dados estão corretos, vamos prosseguir"
                )}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Stat({
  icon,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border border-cyan-400/20 bg-slate-900/70 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-cyan-300/80">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-50">
        {loading || value === undefined ? (
          <Skeleton className="h-7 w-10 bg-slate-700/60" />
        ) : (
          value
        )}
      </div>
    </div>
  );
}
