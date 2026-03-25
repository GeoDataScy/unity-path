import { useEffect, useMemo, useRef, useState } from "react";
import { Trophy } from "lucide-react";

import type { AgentDailyMetrics } from "@/features/agent/useAgentDailyMetricsQuery";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfettiBurst } from "@/components/effects/ConfettiBurst";
import { cn } from "@/lib/utils";

function saoPauloDateKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

type Props = {
  userId: string | null;
  metricsLoading: boolean;
  dailyMetrics: AgentDailyMetrics | undefined;
  goal?: number;
  /** DEV only: bump this number to force the celebration (ignores localStorage) */
  debugCelebrateNonce?: number;
  /** DEV only: overrides the UI count temporarily (does not affect backend) */
  debugOverrideCount?: number | null;
};

export function AgentDailyMetricsSection({
  userId,
  metricsLoading,
  dailyMetrics,
  goal = 100,
  debugCelebrateNonce,
  debugOverrideCount,
}: Props) {
  const CELEBRATION_MS = 9600;
  const myCount = dailyMetrics?.my_count ?? 0;
  const effectiveCount = debugOverrideCount ?? myCount;
  const remainingToGoal = Math.max(0, goal - effectiveCount);

  const clapRef = useRef<HTMLAudioElement | null>(null);
  const clapUnlockedRef = useRef(false);

  const ensureClapAudio = () => {
    if (!clapRef.current) {
      const audio = new Audio("/sounds/clap.mp3");
      audio.preload = "auto";
      audio.volume = 0.7;
      clapRef.current = audio;
    }
    return clapRef.current;
  };

  const playClap = () => {
    try {
      const audio = ensureClapAudio();
      audio.currentTime = 0;
      void audio.play().catch(() => {
        // Autoplay may be blocked when celebration is triggered by background refetch.
      });
    } catch {
      // Fail silently
    }
  };

  const progress = useMemo(() => {
    if (goal <= 0) return 0;
    return Math.min(100, Math.max(0, (effectiveCount / goal) * 100));
  }, [goal, effectiveCount]);

  const indicatorClassName = useMemo(() => {
    const pct = goal > 0 ? effectiveCount / goal : 0;
    if (pct < 0.6) return "bg-destructive";
    if (pct < 0.9) return "bg-status-open";
    return "bg-status-success";
  }, [effectiveCount, goal]);

  const [celebrate, setCelebrate] = useState(false);
  const [pulse, setPulse] = useState(false);
  const prevCount = useRef(myCount);

  useEffect(() => {
    if (!userId) return;

    const dateKey = saoPauloDateKey();
    const storageKey = `goalHit:${userId}:${dateKey}`;

    if (prevCount.current < goal && myCount >= goal) {
      const already = localStorage.getItem(storageKey);
      if (!already) {
        localStorage.setItem(storageKey, "1");
        setCelebrate(true);
        setPulse(true);
        playClap();

        const t1 = window.setTimeout(() => setCelebrate(false), CELEBRATION_MS);
        const t2 = window.setTimeout(() => setPulse(false), CELEBRATION_MS);
        return () => {
          window.clearTimeout(t1);
          window.clearTimeout(t2);
        };
      }
    }

    prevCount.current = myCount;
  }, [goal, myCount, userId]);

  // Try to "unlock" audio on the first user interaction to maximize chance of playing later.
  useEffect(() => {
    const onFirstPointerDown = () => {
      if (clapUnlockedRef.current) return;
      clapUnlockedRef.current = true;

      try {
        const audio = ensureClapAudio();
        audio.load();
        // Some browsers allow a muted/paused play inside a user gesture to unlock.
        void audio
          .play()
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
          })
          .catch(() => {
            // Ignore
          });
      } catch {
        // Ignore
      }
    };

    window.addEventListener("pointerdown", onFirstPointerDown, { once: true });
    return () => window.removeEventListener("pointerdown", onFirstPointerDown);
  }, []);

  useEffect(() => {
    prevCount.current = myCount;
  }, [myCount]);

  useEffect(() => {
    if (!userId) return;
    if (!debugCelebrateNonce) return;

    setCelebrate(true);
    setPulse(true);
    playClap();

    const t1 = window.setTimeout(() => setCelebrate(false), CELEBRATION_MS);
    const t2 = window.setTimeout(() => setPulse(false), CELEBRATION_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [CELEBRATION_MS, debugCelebrateNonce, userId]);

  const glowClass = effectiveCount >= goal ? "shadow-[0_0_0_3px_hsl(var(--status-success)/0.22)]" : "";

  return (
    <div className="relative">
      {celebrate && <ConfettiBurst pieces={64} />}

      <section className="mb-2 grid gap-4 md:grid-cols-3" aria-label="Métricas do dia">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base font-semibold">Total de atendimentos hoje</CardTitle>
              {!metricsLoading && effectiveCount >= goal && <Badge variant="success">🏆 Meta Batida!</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <Skeleton className="h-10 w-24" />
            ) : (
              <div
                className={cn("text-4xl font-semibold tabular-nums", pulse && effectiveCount >= goal && "pulse")}
              >
                {effectiveCount.toLocaleString("pt-BR")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Distância do líder</CardTitle>
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <div className="grid gap-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-4 w-40" />
              </div>
            ) : dailyMetrics?.leader_count ? (
              dailyMetrics.is_leader ? (
                <div className="flex items-start gap-3">
                  <Trophy className="mt-0.5 h-5 w-5 text-primary" />
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Parabéns! Você está na liderança</span>
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Você está{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {Math.max(0, (dailyMetrics.leader_count ?? 0) - effectiveCount).toLocaleString("pt-BR")}
                  </span>{" "}
                  atendimentos atrás de{" "}
                  <span className="font-medium text-foreground">{dailyMetrics.leader_name || "Sem nome"}</span>.
                </p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">Ainda não há atendimentos registrados hoje.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Atendimentos para alcançar a meta</CardTitle>
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <Skeleton className="h-10 w-24" />
            ) : (
              <div className="text-4xl font-semibold tabular-nums">{remainingToGoal.toLocaleString("pt-BR")}</div>
            )}
            <p className="mt-2 text-sm text-muted-foreground">Meta diária: {goal}</p>
          </CardContent>
        </Card>
      </section>

      <div className="mb-8">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Progresso da meta</p>
          {!metricsLoading && (
            <p className="text-sm tabular-nums text-muted-foreground">
              {effectiveCount.toLocaleString("pt-BR")}/{goal}
            </p>
          )}
        </div>

        {metricsLoading ? (
          <Skeleton className="h-4 w-full" />
        ) : (
          <Progress
            value={progress}
            className={cn("h-4", glowClass)}
            indicatorClassName={cn(
              indicatorClassName,
              effectiveCount >= goal && "shadow-[0_0_10px_hsl(var(--status-success)/0.35)]",
            )}
          />
        )}
      </div>
    </div>
  );
}
