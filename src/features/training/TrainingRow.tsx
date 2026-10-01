import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { TrainingCard } from "./TrainingCard";
import type { TrainingVideoWithProgress } from "./types";

type Props = {
  title: string;
  subtitle?: string;
  videos: TrainingVideoWithProgress[];
  onPlay: (video: TrainingVideoWithProgress) => void;
};

export function TrainingRow({ title, subtitle, videos, onPlay }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const epsilon = 4;
    setCanPrev(el.scrollLeft > epsilon);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - epsilon);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [updateArrows, videos.length]);

  const scrollBy = (direction: "prev" | "next") => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = Math.max(280, Math.round(el.clientWidth * 0.85));
    el.scrollBy({ left: direction === "next" ? step : -step, behavior: "smooth" });
  };

  if (videos.length === 0) return null;

  return (
    <section className="group/row relative">
      <div className="mb-3 flex items-baseline gap-3 px-1">
        <h2 className="text-lg font-medium text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-ink-tertiary">{subtitle}</p>}
      </div>

      <div className="relative">
        {canPrev && (
          <button
            type="button"
            onClick={() => scrollBy("prev")}
            aria-label="Anterior"
            className="absolute -left-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-raised text-ink-secondary shadow-md ring-1 ring-line opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-subtle md:flex"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {canNext && (
          <button
            type="button"
            onClick={() => scrollBy("next")}
            aria-label="Próximo"
            className="absolute -right-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-raised text-ink-secondary shadow-md ring-1 ring-line opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-subtle md:flex"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}

        <div
          ref={scrollerRef}
          className={cn(
            "flex gap-4 overflow-x-auto pb-4 pt-1",
            "scroll-smooth snap-x snap-mandatory",
            "[scrollbar-width:none] [-ms-overflow-style:none]",
            "[&::-webkit-scrollbar]:hidden",
          )}
        >
          {videos.map((video) => (
            <div key={video.id} className="snap-start">
              <TrainingCard video={video} onPlay={onPlay} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
