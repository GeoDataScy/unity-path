import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type TrainingViewUpsertInput = {
  userId: string;
  videoId: string;
  watchedSeconds: number;
  completed: boolean;
};

export function useTrainingVideoViewMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: TrainingViewUpsertInput) => {
      const { error } = await supabase.from("training_video_views").upsert(
        {
          user_id: input.userId,
          video_id: input.videoId,
          watched_seconds: Math.max(0, Math.round(input.watchedSeconds)),
          completed: input.completed,
          last_watched_at: new Date().toISOString(),
        },
        { onConflict: "user_id,video_id" },
      );

      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["training", "catalog", { userId: variables.userId }],
      });
    },
  });
}
