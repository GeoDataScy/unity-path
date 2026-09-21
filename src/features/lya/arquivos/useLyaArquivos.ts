import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  lyaAtualizarArquivo,
  lyaDeleteFile,
  lyaEnviarArquivo,
  lyaGetFile,
  lyaListFiles,
  type LyaUploadProgresso,
  type LyaUploadResultado,
} from "./api";
import type { LyaArquivoParse } from "../types";

// Estado de servidor do acervo de arquivos da Lya. A lista é barata (não traz
// o conteúdo); o detalhe, que traz a amostra de linhas, é por arquivo aberto.

export const LYA_ARQUIVOS_KEY = ["lya", "arquivos"] as const;
export const lyaArquivoKey = (id: string, amostra: number) => ["lya", "arquivo", id, amostra] as const;

export function useLyaArquivosQuery(enabled = true) {
  return useQuery({
    queryKey: LYA_ARQUIVOS_KEY,
    queryFn: lyaListFiles,
    enabled,
    staleTime: 30_000,
  });
}

export function useLyaArquivoQuery(id: string | null, amostra = 20) {
  return useQuery({
    queryKey: lyaArquivoKey(id ?? "none", amostra),
    queryFn: () => lyaGetFile(id as string, amostra),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

/**
 * Upload de um arquivo já parseado. O progresso sai por estado próprio (e não
 * pela mutation): subir 50.000 linhas leva dezenas de lotes, e sem barra o
 * usuário acha que travou.
 */
export function useEnviarLyaArquivo() {
  const qc = useQueryClient();
  const [progresso, setProgresso] = useState<LyaUploadProgresso | null>(null);

  const mutation = useMutation({
    mutationFn: ({ nome, parse }: { nome: string; parse: LyaArquivoParse }) =>
      lyaEnviarArquivo(nome, parse, setProgresso),
    onSettled: () => {
      setProgresso(null);
      void qc.invalidateQueries({ queryKey: LYA_ARQUIVOS_KEY });
    },
  });

  const enviar = useCallback(
    (nome: string, parse: LyaArquivoParse): Promise<LyaUploadResultado> => mutation.mutateAsync({ nome, parse }),
    [mutation],
  );

  return { enviar, enviando: mutation.isPending, progresso };
}

export function useAtualizarLyaArquivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...campos }: { id: string; nome?: string; resumo?: string; tags?: string[] }) =>
      lyaAtualizarArquivo(id, campos),
    onSuccess: () => qc.invalidateQueries({ queryKey: LYA_ARQUIVOS_KEY }),
  });
}

export function useApagarLyaArquivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => lyaDeleteFile(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: LYA_ARQUIVOS_KEY }),
  });
}
