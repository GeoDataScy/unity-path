import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { lyaDeleteMemory, lyaListMemories, lyaSalvarMemoria } from "./api";
import type { LyaMemoryInput } from "./types";

export const LYA_MEMORIES_KEY = ["lya", "memories"] as const;

export function useLyaMemoriesQuery(enabled = true) {
  return useQuery({ queryKey: LYA_MEMORIES_KEY, queryFn: lyaListMemories, enabled, staleTime: 30_000 });
}

/** Gravar passa pela Edge Function (treinador classifica/enriquece + RPC). */
export function useSaveLyaMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LyaMemoryInput) => lyaSalvarMemoria(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: LYA_MEMORIES_KEY }),
  });
}

export function useDeleteLyaMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => lyaDeleteMemory(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: LYA_MEMORIES_KEY }),
  });
}
