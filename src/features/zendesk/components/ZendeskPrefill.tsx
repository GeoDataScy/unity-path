// Painel de pré-preenchimento do formulário de atendimento a partir do Zendesk.
//
// Regra de ouro desta tela: nada é aplicado sozinho. O agente vê o que veio,
// de qual ticket, e clica para usar. Preencher automático economizaria um
// clique e custaria a autoria do registro — o motivo de contato alimenta os
// gráficos da gestora, e "o que a IA do Zendesk inferiu" não é a mesma coisa
// que "o que o agente classificou".
//
// Também mostra o que NÃO veio: plataforma, número do pedido e cód. rastreio
// não existem em ticket nenhum do Zendesk (a conta não tem campo customizado
// para eles). Sem essa linha o agente acha que a busca preencheu tudo.
import { useState } from "react";
import { AlertCircle, ArrowRight, Check, ExternalLink, Loader2, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getContactReason } from "@/features/services/contact-reasons";
import { cn } from "@/lib/utils";

import { StatusBadge } from "./StatusBadge";
import { formatarDataHora, rotuloCanal, tempoRelativo } from "../format";
import { CAMPOS_SEM_FONTE, buildSuggestion, type TicketSuggestion } from "../suggest";
import { ZENDESK_TOPIC_CONFIDENCE_LABEL, type ZendeskLookup, type ZendeskTicket } from "../types";

const ORIGEM_PRODUTO: Record<string, string> = {
  tag: "pela tag de roteamento",
  grupo: "pelo grupo do ticket",
  apelido: "por tradução cadastrada",
};

const SEM_MOTIVO: Record<string, string> = {
  sem_topic: "o Zendesk não classificou a intenção deste ticket",
  confianca_baixa: "a classificação do Zendesk ficou com confiança baixa",
  sem_equivalente: "a intenção classificada não tem motivo equivalente aqui",
};

/** Uma linha “campo → valor que será preenchido”. */
function LinhaCampo({
  campo,
  valor,
  nota,
  ausente,
}: {
  campo: string;
  valor: string;
  nota?: string;
  ausente?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 py-1 text-sm">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{campo}</span>
      <span className={cn("font-medium", ausente && "font-normal text-muted-foreground")}>
        {valor}
      </span>
      {nota && <span className="text-xs text-muted-foreground">{nota}</span>}
    </div>
  );
}

/**
 * O que o clique vai escrever no formulário — e só isso.
 *
 * Canal fica de fora de propósito: um ticket da ClickBank também chega no
 * Zendesk como `via.channel: email`, então o canal do ticket não desmente a
 * escolha do agente. Ele aparece no cabeçalho, como informação.
 */
function ResumoSugestao({ sugestao }: { sugestao: TicketSuggestion }) {
  const { produto, motivo, clientEmail } = sugestao;
  const motivoLabel = motivo.code ? getContactReason(motivo.code)?.label : null;

  return (
    <div className="divide-y divide-border/60">
      <LinhaCampo campo="E-mail" valor={clientEmail ?? "não veio no ticket"} ausente={!clientEmail} />

      <LinhaCampo
        campo="Produto"
        valor={produto.product ?? "escolha na mão"}
        ausente={!produto.product}
        nota={produto.origem ? ORIGEM_PRODUTO[produto.origem] : undefined}
      />

      <LinhaCampo
        campo="Motivo"
        valor={motivoLabel ?? "escolha na mão"}
        ausente={!motivoLabel}
        nota={
          motivo.code && motivo.confidence
            ? `confiança ${ZENDESK_TOPIC_CONFIDENCE_LABEL[motivo.confidence]}`
            : undefined
        }
      />
    </div>
  );
}

function TicketResumo({ t }: { t: ZendeskTicket }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-mono text-xs text-muted-foreground">#{t.id}</span>
      <StatusBadge status={t.status} />
      <span className="truncate text-sm">{t.subject ?? "(sem assunto)"}</span>
      <span className="text-xs text-muted-foreground">
        {formatarDataHora(t.created_at)} · {tempoRelativo(t.created_at)}
      </span>
    </span>
  );
}

export type ZendeskPrefillProps = {
  /** null enquanto o agente não pediu a busca. */
  lookup: ZendeskLookup | undefined;
  carregando: boolean;
  erro: Error | null;
  /** Aplica os valores no formulário. Só dispara por clique do agente. */
  onUsar: (sugestao: TicketSuggestion) => void;
  onFechar: () => void;
};

export function ZendeskPrefill({ lookup, carregando, erro, onUsar, onFechar }: ZendeskPrefillProps) {
  // Qual dos tickets do cliente vai preencher. O mais recente por padrão, mas
  // um cliente que já falou com a gente antes tem vários — e o atendimento de
  // hoje pode ser sobre o mais antigo.
  const [ticketId, setTicketId] = useState<number | null>(null);
  const [usado, setUsado] = useState(false);

  if (carregando) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Procurando no Zendesk…
      </div>
    );
  }

  if (erro) {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="flex-1">
          <p className="font-medium">Não deu para consultar o Zendesk</p>
          <p className="text-muted-foreground">{erro.message}</p>
          <p className="mt-1 text-muted-foreground">Preencha o atendimento na mão, como sempre.</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onFechar}>
          Fechar
        </Button>
      </div>
    );
  }

  if (!lookup) return null;

  if (lookup.tickets.length === 0) {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-lg border bg-muted/30 p-4 text-sm">
        <SearchX className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <p className="font-medium">Nenhum ticket no Zendesk para {lookup.email}</p>
          <p className="text-muted-foreground">
            Atendimento por SMS não gera ticket, e cliente novo pode ainda não ter escrito por
            e-mail. Preencha na mão.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onFechar}>
          Fechar
        </Button>
      </div>
    );
  }

  const selecionado =
    lookup.tickets.find((t) => t.id === ticketId) ?? lookup.tickets[0];
  const sugestao = buildSuggestion(selecionado);
  const outros = lookup.tickets.filter((t) => t.id !== selecionado.id);

  return (
    <div className="mt-4 rounded-lg border bg-muted/20">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Encontrado no Zendesk
          </p>
          <div className="mt-1">
            <TicketResumo t={selecionado} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {selecionado.group_name ?? "sem grupo"} · {rotuloCanal(selecionado.channel)}
            {selecionado.assignee_name ? ` · ${selecionado.assignee_name}` : ""}
          </p>
        </div>
        <a
          href={selecionado.url}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Abrir no Zendesk
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="px-4 py-3">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Vai preencher
        </p>
        <ResumoSugestao sugestao={sugestao} />

        {sugestao.produto.naoReconhecido && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              O grupo <strong>{sugestao.produto.naoReconhecido}</strong> não corresponde a nenhum
              produto do catálogo. Escolha o produto na mão — e avise para cadastrarmos a tradução.
            </span>
          </p>
        )}

        {!sugestao.motivo.code && sugestao.motivo.motivoSemSugestao && (
          <p className="mt-2 text-xs text-muted-foreground">
            Motivo em branco porque {SEM_MOTIVO[sugestao.motivo.motivoSemSugestao]}.
            {sugestao.motivo.topic && (
              <>
                {" "}
                Intenção do Zendesk: <span className="font-mono">{sugestao.motivo.topic}</span>.
              </>
            )}
          </p>
        )}

        <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
          Continua com você: <strong>{CAMPOS_SEM_FONTE.join(", ")}</strong> — o Zendesk não guarda
          esses campos.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            onUsar(sugestao);
            setUsado(true);
          }}
        >
          {usado ? (
            <>
              <Check className="mr-1.5 h-4 w-4" />
              Preenchido
            </>
          ) : (
            <>
              Usar estes dados
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </>
          )}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onFechar}>
          Fechar
        </Button>
        {lookup.total > lookup.tickets.length && (
          <span className="text-xs text-muted-foreground">
            {lookup.total} tickets deste cliente na conta; mostrando os {lookup.tickets.length} mais
            recentes.
          </span>
        )}
      </div>

      {outros.length > 0 && (
        <div className="border-t px-4 py-2">
          <p className="mb-1 text-xs text-muted-foreground">Outro ticket deste cliente:</p>
          <div className="flex flex-col gap-1">
            {outros.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTicketId(t.id);
                  setUsado(false);
                }}
                className="flex items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <TicketResumo t={t} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
