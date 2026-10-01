import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { resolveTrainingVideoUrl } from "./useTrainingVideosQuery";
import { useTrainingVideoViewMutation } from "./useTrainingVideoViewMutation";
import type { TrainingVideoWithProgress } from "./types";

type Props = {
  userId: string;
  video: TrainingVideoWithProgress | null;
  nextVideo: TrainingVideoWithProgress | null;
  onClose: () => void;
  onPlayNext: (video: TrainingVideoWithProgress) => void;
};

export function TrainingVideoDialog({ userId, video, nextVideo, onClose, onPlayNext }: Props) {
  const open = video !== null;
  const { toast } = useToast();
  const upsert = useTrainingVideoViewMutation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const lastSavedSecond = useRef(0);
  const completedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    completedRef.current = video?.completed ?? false;
    lastSavedSecond.current = video?.watchedSeconds ?? 0;

    if (!video?.videoUrl) {
      setResolvedUrl(null);
      return;
    }

    setResolving(true);
    resolveTrainingVideoUrl(video.videoUrl)
      .then((url) => {
        if (!cancelled) setResolvedUrl(url);
      })
      .catch((err) => {
        if (cancelled) return;
        toast({
          title: "Não foi possível carregar o vídeo",
          description: err instanceof Error ? err.message : "Tente novamente em alguns instantes.",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });

    return () => {
      cancelled = true;
    };
  }, [video, toast]);

  // Resume from last position
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !resolvedUrl || !video) return;
    const resumeAt = video.completed ? 0 : video.watchedSeconds;
    if (resumeAt > 1) {
      const onLoaded = () => {
        try {
          el.currentTime = Math.min(resumeAt, (el.duration || 0) - 1);
        } catch {
          // ignore — some browsers throw before metadata is ready
        }
        el.removeEventListener("loadedmetadata", onLoaded);
      };
      el.addEventListener("loadedmetadata", onLoaded);
    }
  }, [resolvedUrl, video]);

  const persistProgress = (currentTime: number, completed: boolean) => {
    if (!video) return;
    upsert.mutate({
      userId,
      videoId: video.id,
      watchedSeconds: currentTime,
      completed,
    });
  };

  const handleTimeUpdate = () => {
    const el = videoRef.current;
    if (!el || !video) return;
    const current = el.currentTime;
    // throttle: save every ~10s of playback
    if (current - lastSavedSecond.current >= 10) {
      lastSavedSecond.current = current;
      persistProgress(current, completedRef.current);
    }
  };

  const handleEnded = () => {
    const el = videoRef.current;
    if (!el || !video) return;
    completedRef.current = true;
    persistProgress(el.duration || el.currentTime, true);
  };

  const handlePauseOrClose = () => {
    const el = videoRef.current;
    if (!el || !video) return;
    persistProgress(el.currentTime, completedRef.current);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      handlePauseOrClose();
      onClose();
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[96vw] max-w-5xl -translate-x-1/2 -translate-y-1/2",
            "overflow-hidden rounded-2xl border border-white/10 bg-slate-950 text-white shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <DialogPrimitive.Title className="sr-only">{video?.title ?? "Vídeo"}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {video?.description ?? "Reprodutor de vídeo do guia"}
          </DialogPrimitive.Description>

          <DialogPrimitive.Close
            aria-label="Fechar"
            className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white/90 transition hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-white/50"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>

          <div className="aspect-video w-full bg-black">
            {resolving && !resolvedUrl && (
              <div className="flex h-full w-full items-center justify-center">
                <Skeleton className="h-full w-full bg-white/5" />
              </div>
            )}
            {!resolving && !resolvedUrl && video && (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center text-white/70">
                {/* Só se chega aqui quando o link existe e falhou ao carregar: o guia
                    não mostra mais vídeo sem link. */}
                <p className="text-base font-medium text-white">Não foi possível carregar o vídeo</p>
                <p className="text-sm">Tente novamente em alguns instantes.</p>
              </div>
            )}
            {resolvedUrl && (
              <video
                ref={videoRef}
                key={resolvedUrl}
                src={resolvedUrl}
                controls
                autoPlay
                playsInline
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleEnded}
                onPause={handlePauseOrClose}
                className="h-full w-full bg-black"
              />
            )}
          </div>

          <div className="flex flex-col gap-4 border-t border-white/10 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-lg font-medium text-white">{video?.title}</h2>
              </div>
              {video?.description && (
                <p className="mt-1 line-clamp-3 text-sm text-white/70">{video.description}</p>
              )}
            </div>

            {nextVideo && (
              <div className="flex shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-white/55">A seguir</p>
                  <p className="line-clamp-1 max-w-[200px] text-sm font-medium text-white">
                    {nextVideo.title}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="bg-white text-slate-900 hover:bg-white/90"
                  onClick={() => onPlayNext(nextVideo)}
                  disabled={!nextVideo.videoUrl}
                >
                  Próximo
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
