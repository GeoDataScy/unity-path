export type TrainingSection =
  | "welcome"
  | "atendimentos"
  | "reembolsos"
  | "metricas";

export const TRAINING_SECTION_ORDER: TrainingSection[] = [
  "welcome",
  "atendimentos",
  "reembolsos",
  "metricas",
];

export const TRAINING_SECTION_LABEL: Record<TrainingSection, string> = {
  welcome: "Boas-vindas",
  atendimentos: "Atendimentos",
  reembolsos: "Reembolsos",
  metricas: "Minhas métricas",
};

export type TrainingVideo = {
  id: string;
  section: TrainingSection;
  title: string;
  description: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  displayOrder: number;
};

export type TrainingVideoView = {
  videoId: string;
  watchedSeconds: number;
  completed: boolean;
  lastWatchedAt: string;
};

// `watchedSeconds` e `completed` não aparecem na tela: o player usa os dois
// para retomar o vídeo de onde o agente parou.
export type TrainingVideoWithProgress = TrainingVideo & {
  watchedSeconds: number;
  completed: boolean;
};
