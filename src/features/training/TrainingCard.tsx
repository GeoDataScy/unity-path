import { CheckCircle2, Clock, Lock, Play } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TrainingVideoWithProgress } from "./types";

type Props = {
  video: TrainingVideoWithProgress;
  onPlay: (video: TrainingVideoWithProgress) => void;
};

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m} min`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TrainingCard({ video, onPlay }: Props) {
  const available = Boolean(video.videoUrl);
  const duration = formatDuration(video.durationSeconds);
  const progress = video.progressPct;

  return (
    <button
      type="button"
      onClick={() => available && onPlay(video)}
      disabled={!available}
      aria-label={available ? `Assistir: ${video.title}` : `${video.title} — em breve`}
      className={cn(
        "group relative flex w-[260px] shrink-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-white text-left shadow-sm outline-none transition-all sm:w-[280px]",
        "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        available
          ? "cursor-pointer hover:-translate-y-1 hover:shadow-xl hover:ring-2 hover:ring-primary/40"
          : "cursor-not-allowed opacity-90",
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-slate-800 via-slate-700 to-slate-900">
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(120% 80% at 0% 0%, rgba(99,102,241,0.45), transparent 60%), radial-gradient(120% 80% at 100% 100%, rgba(236,72,153,0.35), transparent 55%)",
            }}
            aria-hidden
          />
        )}

        {/* Dark overlay for legibility */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />

        {/* Play / Lock indicator */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-full backdrop-blur transition-all",
              available
                ? "bg-white/90 text-slate-900 shadow-lg group-hover:scale-110 group-hover:bg-white"
                : "bg-black/55 text-white/80",
            )}
          >
            {available ? <Play className="h-6 w-6 translate-x-[1px] fill-current" /> : <Lock className="h-5 w-5" />}
          </div>
        </div>

        {/* Top-right badges */}
        <div className="absolute right-2 top-2 flex items-center gap-1">
          {video.completed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow">
              <CheckCircle2 className="h-3 w-3" />
              Visto
            </span>
          )}
          {!available && (
            <span className="inline-flex items-center rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90">
              Em breve
            </span>
          )}
        </div>

        {/* Duration */}
        {duration && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
            <Clock className="h-3 w-3" />
            {duration}
          </span>
        )}

        {/* Progress bar */}
        {progress > 0 && progress < 100 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
            <div
              className="h-full bg-primary"
              style={{ width: `${progress}%` }}
              aria-hidden
            />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{video.title}</h3>
        {video.description && (
          <p className="line-clamp-2 text-xs leading-snug text-slate-500">{video.description}</p>
        )}
      </div>
    </button>
  );
}
