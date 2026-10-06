import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Cada slide fica 8 s na tela — vídeo e imagem. */
const SLIDE_MS = 8_000;
/** Vídeo parado (rede lenta/bloqueada) por mais que isto passa a ser cronometrado. */
const STALL_MS = 2_500;

type Slide = {
  /** Texto curto embaixo da barrinha. */
  label: string;
} & ({ kind: "video"; src: string; poster: string } | { kind: "image"; src: string });

// Os vídeos são 4:5 (864×1080), sem áudio, com 8 s exatos — preparados em public/login.
const LOGIN_SLIDES: Slide[] = [
  {
    kind: "video",
    src: "/login/hubi-marca.mp4",
    poster: "/login/hubi-marca-poster.jpg",
    label: "hubi",
  },
  {
    kind: "image",
    src: "/login/hubi-simbolo.jpg",
    label: "IA Treinada",
  },
  {
    kind: "video",
    src: "/login/hubi-dados.mp4",
    poster: "/login/hubi-dados-poster.jpg",
    label: "Dados & Insights",
  },
];

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

type Props = {
  className?: string;
};

/**
 * Painel de "stories" da tela de login: vídeo/imagem em sequência, cada um com
 * uma barrinha que carrega em 8 s. No vídeo a barra segue o tempo do próprio
 * vídeo; se ele travar sem carregar, o relógio assume. Na imagem, o relógio.
 * Clicar na barrinha pula para aquele slide.
 */
export function LoginStories({ className }: Props) {
  const slides = LOGIN_SLIDES;
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  // Vídeo que não pôde tocar (autoplay bloqueado, erro, travado, movimento
  // reduzido) passa a ser cronometrado como imagem, com o pôster na tela.
  const timedRef = useRef<Set<number>>(new Set());
  const elapsedRef = useRef(0);
  const reduced = useRef(prefersReducedMotion());

  const goTo = useCallback(
    (next: number) => {
      elapsedRef.current = 0;
      setProgress(0);
      setIndex(((next % slides.length) + slides.length) % slides.length);
    },
    [slides.length],
  );

  // Troca de slide: só o vídeo ativo toca, sempre do começo.
  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (v && i !== index) {
        v.pause();
        v.currentTime = 0;
      }
    });
    const slide = slides[index];
    const video = videoRefs.current[index];
    if (slide.kind !== "video" || !video) return;
    if (reduced.current) {
      timedRef.current.add(index);
      return;
    }
    video.currentTime = 0;
    const played = video.play();
    if (played && typeof played.catch === "function") {
      played.catch(() => timedRef.current.add(index));
    }
  }, [index, slides]);

  // Relógio da barrinha. O passo é limitado a 100 ms: com a aba escondida o
  // navegador congela o requestAnimationFrame e a barra para junto.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let stalled = 0;
    let lastVideoTime = -1;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const slide = slides[index];
      const video = videoRefs.current[index];
      let p: number;
      if (slide.kind === "video" && video && !timedRef.current.has(index)) {
        // Vídeo que não anda (sem dados, travado) não pode prender a tela no
        // primeiro slide: depois de STALL_MS parado, o relógio assume de onde estava.
        if (video.currentTime === lastVideoTime) stalled += dt;
        else stalled = 0;
        lastVideoTime = video.currentTime;
        p = video.currentTime / (SLIDE_MS / 1000);
        if (stalled > STALL_MS) {
          timedRef.current.add(index);
          elapsedRef.current = video.currentTime * 1000;
        }
      } else {
        elapsedRef.current += dt;
        p = elapsedRef.current / SLIDE_MS;
      }
      if (p >= 1) {
        goTo(index + 1);
        return;
      }
      setProgress(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index, slides, goTo]);

  return (
    <section
      aria-roledescription="carrossel"
      aria-label="Apresentação da hubi"
      className={cn("relative isolate overflow-hidden rounded-2xl bg-inverse", className)}
    >
      {slides.map((s, i) => {
        const active = i === index;
        const common = cn(
          "absolute inset-0 h-full w-full object-cover transition-opacity duration-700",
          active ? "opacity-100" : "opacity-0",
        );
        return s.kind === "video" ? (
          <video
            key={s.src}
            ref={(el) => (videoRefs.current[i] = el)}
            className={common}
            src={s.src}
            poster={s.poster}
            muted
            playsInline
            preload={active || i === (index + 1) % slides.length ? "auto" : "metadata"}
            onEnded={() => active && goTo(index + 1)}
            onError={() => timedRef.current.add(i)}
            aria-hidden="true"
          />
        ) : (
          <img key={s.src} src={s.src} alt="" className={common} aria-hidden="true" />
        );
      })}

      {/* Degradê para as barrinhas lerem bem até sobre a imagem clara */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/70 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 p-8 text-white">
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${slides.length}, minmax(0, 1fr))` }}>
          {slides.map((s, i) => {
            const fill = i < index ? 1 : i === index ? progress : 0;
            return (
              <button
                key={s.src}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Ver: ${s.label}`}
                aria-current={i === index ? "step" : undefined}
                className="grid gap-2.5 text-left focus-visible:outline-none"
              >
                <span className="h-[3px] overflow-hidden rounded-full bg-white/25">
                  <span
                    data-testid={`story-bar-${i}`}
                    className="block h-full rounded-full bg-white"
                    style={{ width: `${Math.min(100, fill * 100)}%` }}
                  />
                </span>
                <span
                  className={cn(
                    "truncate text-sm transition-colors",
                    i === index ? "font-medium text-white" : "text-white/55 hover:text-white/80",
                  )}
                >
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
