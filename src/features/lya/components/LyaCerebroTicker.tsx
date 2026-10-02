import { useMemo, useSyncExternalStore } from "react";
import { Brain, Clock, Hash, Link2, Radar, Sparkles, Star, Table2, type LucideIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { buildGraph, desde, type LyaSistemaNo } from "../graph";
import { TIPO_MEMORIA_MAP, type LyaArquivo, type LyaMemory, type LyaMemoryType } from "../types";

// Faixa de métricas do Cérebro da Lya — o "ticker" do topo (herdado do
// CerebroTicker do Daniel). Tudo é derivado das listas que o grafo já carrega,
// sem endpoint novo: treinar uma memória ou subir um arquivo invalida a query e
// o número sobe aqui. O mouse em cima para a esteira; cada item tem tooltip.
//
// Conta as TRÊS camadas do cérebro (memória, arquivo, sistema) — se contasse só
// memórias, a faixa diria que a Lya sabe menos do que ela alcança.

const MINUTO_MS = 60_000;
const DIA_MS = 86_400_000;

const assinarRelogio = (aoMudar: () => void) => {
  const id = setInterval(aoMudar, MINUTO_MS);
  return () => clearInterval(id);
};
const minutoAgora = () => Math.floor(Date.now() / MINUTO_MS);

const COR_TIPO: Record<LyaMemoryType, string> = {
  feedback: "#f2c46d",
  user: "#9db8ff",
  project: "#7ce3ea",
  reference: "#c6f36b",
  nota: "#d4d4d8",
};

interface Metrica {
  key: string;
  icon: LucideIcon;
  label: string;
  valor: string;
  nota?: string;
  cor: string;
  descricao: string;
}

const corta = (s: string, n = 28) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const numero = (n: number) => n.toLocaleString("pt-BR");

export function LyaCerebroTicker({
  memorias,
  arquivos = [],
  sistema = [],
  carregando,
}: {
  memorias: LyaMemory[];
  arquivos?: LyaArquivo[];
  sistema?: LyaSistemaNo[];
  carregando: boolean;
}) {
  const minuto = useSyncExternalStore(assinarRelogio, minutoAgora, minutoAgora);

  const metricas = useMemo<Metrica[]>(() => {
    const agora = minuto * MINUTO_MS;
    const out: Metrica[] = [];
    if (memorias.length === 0 && arquivos.length === 0 && sistema.length === 0) return out;

    // ── Camada das memórias treinadas ──
    if (memorias.length > 0) {
      const novasSemana = memorias.filter((m) => agora - new Date(m.created_at).getTime() < 7 * DIA_MS).length;
      const hoje = memorias.filter((m) => agora - new Date(m.updated_at).getTime() < DIA_MS).length;
      out.push({
        key: "memorias",
        icon: Brain,
        label: "Memórias",
        valor: String(memorias.length),
        nota: novasSemana > 0 ? `+${novasSemana} na semana` : undefined,
        cor: "#7ce3ea",
        descricao: "Tudo que a Lya já aprendeu com a gestora. Cada memória entra no contexto dela quando a pergunta tem a ver.",
      });
      out.push({
        key: "hoje",
        icon: Sparkles,
        label: "Treinadas hoje",
        valor: String(hoje),
        cor: "#c6f36b",
        descricao: "Memórias criadas ou corrigidas nas últimas 24 horas.",
      });
    }

    // ── As duas camadas novas ──
    if (arquivos.length > 0) {
      const linhas = arquivos.reduce((t, f) => t + (f.total_linhas ?? 0), 0);
      out.push({
        key: "arquivos",
        icon: Table2,
        label: "Arquivos",
        valor: String(arquivos.length),
        nota: linhas > 0 ? `${numero(linhas)} linhas` : undefined,
        cor: "#f4f4f5",
        descricao:
          "Planilhas e documentos que a gestora deu para a Lya. Ela lê as linhas e cruza com os dados da plataforma quando a pergunta pede.",
      });
    }
    if (sistema.length > 0) {
      const alcancados = sistema.reduce((t, n) => t + (n.total ?? 0), 0);
      out.push({
        key: "alcance",
        icon: Radar,
        label: "Alcance",
        valor: String(sistema.length),
        nota: alcancados > 0 ? `${numero(alcancados)} registros` : undefined,
        cor: "#8a8a93",
        descricao:
          "Tabelas e telas que a Lya consegue consultar de verdade neste momento, com o total de registros que elas têm hoje.",
      });
    }

    const grafo = buildGraph(memorias, arquivos, sistema);
    out.push({
      key: "conexoes",
      icon: Link2,
      label: "Conexões",
      valor: String(grafo.links.length),
      cor: "#9db8ff",
      descricao:
        "Ligações do cérebro: [[wikilinks]] e tags entre memórias, a memória que nasceu de cada arquivo, o arquivo que cita uma tabela e as tabelas entre si.",
    });

    const hub = [...grafo.nodes].sort((a, b) => b.val - a.val)[0];
    if (hub && hub.val > 1) {
      out.push({
        key: "hub",
        icon: Star,
        label: "Mais conectada",
        valor: corta(hub.label),
        nota: `${hub.val - 1} conexões`,
        cor: "#f2c46d",
        descricao: "A memória com mais ligações — o assunto que mais aparece junto de outros.",
      });
    }

    // ── Recortes que só fazem sentido sobre as memórias ──
    if (memorias.length > 0) {
      const porTipo = new Map<LyaMemoryType, number>();
      for (const m of memorias) porTipo.set(m.type, (porTipo.get(m.type) ?? 0) + 1);
      for (const [tipo, n] of [...porTipo.entries()].sort((a, b) => b[1] - a[1])) {
        out.push({
          key: `tipo-${tipo}`,
          icon: Hash,
          label: TIPO_MEMORIA_MAP[tipo]?.label ?? tipo,
          valor: String(n),
          cor: COR_TIPO[tipo],
          descricao: TIPO_MEMORIA_MAP[tipo]?.hint ?? "",
        });
      }

      const tags = new Set(memorias.flatMap((m) => m.tags ?? []));
      out.push({
        key: "tags",
        icon: Hash,
        label: "Tags",
        valor: String(tags.size),
        cor: "#d4d4d8",
        descricao: "Palavras-chave distintas. São elas que fazem uma memória ser encontrada quando a pergunta usa outras palavras.",
      });

      const ultima = [...memorias].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      if (ultima) {
        out.push({
          key: "ultima",
          icon: Clock,
          label: "Último treino",
          valor: desde(ultima.updated_at, agora),
          nota: corta(ultima.description || ultima.name, 24),
          cor: "#c6f36b",
          descricao: "Quando a gestora ensinou ou corrigiu algo pela última vez.",
        });
    }
    }
    return out;
  }, [memorias, arquivos, sistema, minuto]);

  const itens = [...metricas, ...metricas]; // duplicado para o loop da esteira ser contínuo

  return (
    <div className="dark h-10 select-none overflow-hidden rounded-lg border border-line bg-canvas text-ink">
      {carregando && metricas.length === 0 ? (
        <div className="flex h-full items-center px-4 text-[12px] text-ink-tertiary">carregando o cérebro…</div>
      ) : metricas.length === 0 ? (
        <div className="flex h-full items-center px-4 text-[12px] text-ink-tertiary">A Lya ainda não tem memórias. Ensine a primeira e a faixa começa a andar.</div>
      ) : (
        <div
          className="lya-ticker-track flex h-full w-max items-center"
          style={{
            animationName: "lyaTickerScroll",
            animationDuration: `${Math.max(20, metricas.length * 6)}s`,
            animationTimingFunction: "linear",
            animationIterationCount: "infinite",
          }}
        >
          {itens.map((m, i) => (
            <Tooltip key={`${m.key}-${i}`}>
              <TooltipTrigger asChild>
                <div className="flex h-full cursor-default items-center gap-2 border-r border-line px-5 text-[12px]">
                  <m.icon className="h-3.5 w-3.5 shrink-0" style={{ color: m.cor }} />
                  <span className="text-ink-tertiary">{m.label}</span>
                  <span className="font-mono font-medium tabular-nums text-ink">{m.valor}</span>
                  {m.nota && <span className="text-[11px] text-ink-tertiary">{m.nota}</span>}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-[12px]">
                {m.descricao}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}
