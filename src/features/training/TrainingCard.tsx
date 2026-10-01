import { Clock, Play } from "lucide-react";

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
  // Todo card do guia tem vídeo: a consulta já descarta o que não tem link.
  const duration = formatDuration(video.durationSeconds);

  return (
    <button
      type="button"
      onClick={() => onPlay(video)}
      aria-label={`Assistir: ${video.title}`}
      className={cn(
        "group relative flex w-[260px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-surface text-left outline-none transition-all sm:w-[280px]",
        "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        "cursor-pointer hover:-translate-y-0.5 hover:border-line-strong hover:shadow-sm",
      )}
    >
      <div className="dark relative aspect-video w-full overflow-hidden bg-raised">
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
                "radial-gradient(120% 80% at 100% 100%, hsl(var(--signal) / 0.16), transparent 55%)",
            }}
            aria-hidden
          />
        )}

        {/* Dark overlay for legibility */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas/70 via-canvas/15 to-transparent" />

        {/* Play indicator */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink/90 text-ink-inverse shadow-md backdrop-blur transition-all group-hover:scale-110 group-hover:bg-ink">
            <Play className="h-6 w-6 translate-x-[1px] fill-current" />
          </div>
        </div>

        {/* Duration */}
        {duration && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-canvas/80 px-2 py-0.5 font-mono text-[11px] font-medium text-ink">
            <Clock className="h-3 w-3" />
            {duration}
          </span>
        )}

      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="line-clamp-2 text-sm font-medium text-ink">{video.title}</h3>
        {video.description && (
          <p className="line-clamp-2 text-xs leading-snug text-ink-tertiary">{video.description}</p>
        )}
      </div>
    </button>
  );
}
