import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { GraduationCap } from "lucide-react";

import type { AgentOutletContext } from "@/layouts/AgentLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { TrainingHero } from "@/features/training/TrainingHero";
import { TrainingRow } from "@/features/training/TrainingRow";
import { TrainingVideoDialog } from "@/features/training/TrainingVideoDialog";
import { useTrainingVideosQuery } from "@/features/training/useTrainingVideosQuery";
import {
  TRAINING_SECTION_LABEL,
  TRAINING_SECTION_ORDER,
  type TrainingVideoWithProgress,
} from "@/features/training/types";

const SECTION_SUBTITLES: Record<(typeof TRAINING_SECTION_ORDER)[number], string> = {
  welcome: "Comece por aqui",
  atendimentos: "Tudo sobre o registro de atendimentos",
  reembolsos: "Como tratar reembolsos do começo ao fim",
  metricas: "Entenda o seu desempenho",
};

export default function ComeceAqui() {
  const { userId, fullName } = useOutletContext<AgentOutletContext>();
  const { data, isLoading, isError } = useTrainingVideosQuery(userId);

  const [activeVideo, setActiveVideo] = useState<TrainingVideoWithProgress | null>(null);

  const flatList = data?.videos ?? [];

  const nextVideoFor = (current: TrainingVideoWithProgress | null) => {
    if (!current) return null;
    const idx = flatList.findIndex((v) => v.id === current.id);
    if (idx < 0) return null;
    for (let i = idx + 1; i < flatList.length; i += 1) {
      if (flatList[i].videoUrl) return flatList[i];
    }
    return null;
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 p-4 sm:p-6 lg:p-8">
      {isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-[280px] w-full rounded-2xl" />
          <div className="space-y-8">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-5 w-40" />
                <div className="flex gap-4">
                  {[0, 1, 2, 3].map((j) => (
                    <Skeleton key={j} className="h-[200px] w-[280px] rounded-xl" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/40 bg-coral-soft p-6 text-center text-destructive">
          Não foi possível carregar o guia. Atualize a página em alguns instantes.
        </div>
      ) : (
        <>
          {/* A apresentação do guia fica mesmo sem vídeo publicado: o que entra
              e sai é só o conteúdo (training_videos.is_published). */}
          <TrainingHero agentName={fullName} />

          {!data || data.videos.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface p-10 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-ink-tertiary">
                <GraduationCap className="h-6 w-6" />
              </div>
              <p className="font-medium text-ink">Nenhum vídeo publicado ainda</p>
              <p className="mt-1 text-sm text-ink-tertiary">
                Os vídeos do guia aparecerão aqui assim que forem disponibilizados.
              </p>
            </div>
          ) : (
            <div className="space-y-10">
              {TRAINING_SECTION_ORDER.map((section) => {
                const videos = data.bySection[section];
                if (!videos || videos.length === 0) return null;
                return (
                  <TrainingRow
                    key={section}
                    title={TRAINING_SECTION_LABEL[section]}
                    subtitle={SECTION_SUBTITLES[section]}
                    videos={videos}
                    onPlay={setActiveVideo}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      <TrainingVideoDialog
        userId={userId}
        video={activeVideo}
        nextVideo={nextVideoFor(activeVideo)}
        onClose={() => setActiveVideo(null)}
        onPlayNext={(v) => setActiveVideo(v)}
      />
    </main>
  );
}
