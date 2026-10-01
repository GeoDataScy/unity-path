import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  TRAINING_SECTION_ORDER,
  type TrainingSection,
  type TrainingVideo,
  type TrainingVideoView,
  type TrainingVideoWithProgress,
} from "./types";

export type TrainingCatalog = {
  videos: TrainingVideoWithProgress[];
  bySection: Record<TrainingSection, TrainingVideoWithProgress[]>;
};

function emptyBySection(): Record<TrainingSection, TrainingVideoWithProgress[]> {
  return TRAINING_SECTION_ORDER.reduce(
    (acc, key) => {
      acc[key] = [];
      return acc;
    },
    {} as Record<TrainingSection, TrainingVideoWithProgress[]>,
  );
}

export function useTrainingVideosQuery(userId: string | null) {
  return useQuery({
    queryKey: ["training", "catalog", { userId }],
    enabled: Boolean(userId),
    queryFn: async (): Promise<TrainingCatalog> => {
      const videosRes = await supabase
        .from("training_videos")
        .select(
          "id, section, title, description, video_url, thumbnail_url, duration_seconds, display_order",
        )
        .eq("is_published", true)
        .order("section", { ascending: true })
        .order("display_order", { ascending: true });

      if (videosRes.error) throw videosRes.error;

      let viewsRows: Array<{
        video_id: string;
        watched_seconds: number;
        completed: boolean;
        last_watched_at: string;
      }> = [];

      if (userId) {
        const viewsRes = await supabase
          .from("training_video_views")
          .select("video_id, watched_seconds, completed, last_watched_at")
          .eq("user_id", userId);

        if (viewsRes.error) throw viewsRes.error;
        viewsRows = viewsRes.data ?? [];
      }

      const viewsByVideoId = new Map<string, TrainingVideoView>();
      for (const v of viewsRows) {
        viewsByVideoId.set(v.video_id, {
          videoId: v.video_id,
          watchedSeconds: v.watched_seconds ?? 0,
          completed: Boolean(v.completed),
          lastWatchedAt: v.last_watched_at,
        });
      }

      // O guia mostra só o que existe, por decisão do dono:
      //  - só as seções do guia. "rotinas" (Check-in do agente e Padrão de
      //    horários) saiu em 01/10/2026;
      //  - só vídeo com link. Os cards "Em breve" saíram em 02/10/2026. As
      //    linhas continuam no banco, e cada uma aparece sozinha no dia em que
      //    ganhar o link do vídeo.
      const visiveis = (videosRes.data ?? []).filter(
        (row) =>
          TRAINING_SECTION_ORDER.includes(row.section as TrainingSection) &&
          Boolean(row.video_url?.trim()),
      );

      const videos: TrainingVideoWithProgress[] = visiveis.map((row) => {
        const view = viewsByVideoId.get(row.id);
        const watched = view?.watchedSeconds ?? 0;
        const completed = view?.completed ?? false;

        return {
          id: row.id,
          section: row.section as TrainingSection,
          title: row.title,
          description: row.description,
          videoUrl: row.video_url,
          thumbnailUrl: row.thumbnail_url,
          durationSeconds: row.duration_seconds,
          displayOrder: row.display_order,
          watchedSeconds: watched,
          completed,
        };
      });

      const bySection = emptyBySection();
      for (const video of videos) {
        if (TRAINING_SECTION_ORDER.includes(video.section)) {
          bySection[video.section].push(video);
        }
      }

      return { videos, bySection };
    },
    staleTime: 1000 * 60,
  });
}

const TRAINING_BUCKET = "training-videos";

function isExternalUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

export async function resolveTrainingVideoUrl(rawUrl: string): Promise<string> {
  if (isExternalUrl(rawUrl)) return rawUrl;

  const path = rawUrl.replace(/^\/+/, "");
  const { data, error } = await supabase.storage
    .from(TRAINING_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Não foi possível gerar a URL do vídeo");
  return data.signedUrl;
}

export async function resolveTrainingThumbnailUrl(rawUrl: string | null): Promise<string | null> {
  if (!rawUrl) return null;
  if (isExternalUrl(rawUrl)) return rawUrl;

  const path = rawUrl.replace(/^\/+/, "");
  const { data, error } = await supabase.storage
    .from(TRAINING_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
