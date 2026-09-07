import { useMemo, useSyncExternalStore } from "react";
import { Brain, Clock, Hash, Link2, Sparkles, Star, type LucideIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { buildGraph, desde } from "../graph";
import { TIPO_MEMORIA_MAP, type LyaMemory, type LyaMemoryType } from "../types";

// Faixa de métricas do Cérebro da Lya — o "ticker" do topo (herdado do
// CerebroTicker do Daniel). Tudo é derivado da própria lista de memórias, sem
// endpoint novo: treinar uma memória invalida a query e o número sobe aqui.
// O mouse em cima para a esteira; cada item tem tooltip com o que significa.

const MINUTO_MS = 60_000;
const DIA_MS = 86_400_000;

const assinarRelogio = (aoMudar: () => void) => {
  const id = setInterval(aoMudar, MINUTO_MS);
  return () => clearInterval(id);
};
const minutoAgora = () => Math.floor(Date.now() / MINUTO_MS);

const COR_TIPO: Record<LyaMemoryType, string> = {
  feedback: "#fbbf24",
  user: "#60a5fa",
  project: "#a78bfa",
  reference: "#34d399",
  nota: "#cbd5e1",
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

export function LyaCerebroTicker({ memorias, carregando }: { memorias: LyaMemory[]; carregando: boolean }) {
  const minuto = useSyncExternalStore(assinarRelogio, minutoAgora, minutoAgora);

  const metricas = useMemo<Metrica[]>(() => {
    const agora = minuto * MINUTO_MS;
    const out: Metrica[] = [];
    if (memorias.length === 0) return out;

    const novasSemana = memorias.filter((m) => agora - new Date(m.created_at).getTime() < 7 * DIA_MS).length;
    const hoje = memorias.filter((m) => agora - new Date(m.updated_at).getTime() < DIA_MS).length;
    out.push({
      key: "memorias",
      icon: Brain,
      label: "Memórias",
      valor: String(memorias.length),
      nota: novasSemana > 0 ? `+${novasSemana} na semana` : undefined,
      cor: "#a78bfa",
      descricao: "Tudo que a Lya já aprendeu com a gestora. Cada memória entra no contexto dela quando a pergunta tem a ver.",
    });
    out.push({
      key: "hoje",
      icon: Sparkles,
      label: "Treinadas hoje",
      valor: String(hoje),
      cor: "#34d399",
      descricao: "Memórias criadas ou corrigidas nas últimas 24 horas.",
    });

    const grafo = buildGraph(memorias);
    out.push({
      key: "conexoes",
      icon: Link2,
      label: "Conexões",
      valor: String(grafo.links.length),
      cor: "#60a5fa",
      descricao: "Ligações entre memórias: [[wikilinks]] no texto e tags em comum. Quanto mais conectado, mais contexto a Lya puxa junto.",
    });

    const hub = [...grafo.nodes].sort((a, b) => b.val - a.val)[0];
    if (hub && hub.val > 1) {
      out.push({
        key: "hub",
        icon: Star,
        label: "Mais conectada",
        valor: corta(hub.label),
        nota: `${hub.val - 1} conexões`,
        cor: "#fbbf24",
        descricao: "A memória com mais ligações — o assunto que mais aparece junto de outros.",
      });
    }

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
      cor: "#cbd5e1",
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
        cor: "#34d399",
        descricao: "Quando a gestora ensinou ou corrigiu algo pela última vez.",
      });
    }
    return out;
  }, [memorias, minuto]);

  const itens = [...metricas, ...metricas]; // duplicado para o loop da esteira ser contínuo

  return (
    <div className="h-10 select-none overflow-hidden rounded-xl border border-white/10 bg-[#0b0d1f] text-slate-200">
      {carregando && metricas.length === 0 ? (
        <div className="flex h-full items-center px-4 text-[12px] text-slate-500">carregando o cérebro…</div>
      ) : metricas.length === 0 ? (
        <div className="flex h-full items-center px-4 text-[12px] text-slate-500">A Lya ainda não tem memórias. Ensine a primeira e a faixa começa a andar.</div>
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
                <div className="flex h-full cursor-default items-center gap-2 border-r border-white/10 px-5 text-[12px]">
                  <m.icon className="h-3.5 w-3.5 shrink-0" style={{ color: m.cor }} />
                  <span className="text-slate-400">{m.label}</span>
                  <span className="font-semibold text-slate-100">{m.valor}</span>
                  {m.nota && <span className="text-[11px] text-slate-500">{m.nota}</span>}
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
