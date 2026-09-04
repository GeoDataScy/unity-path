import { useState } from "react";
import { ExternalLink, Lock, MessageSquare, Paperclip, User, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useZendeskTicketQuery } from "../useZendeskQuery";
import { formatarDataHora, formatarMinutos, rotuloCanal, tempoRelativo } from "../format";
import { ZENDESK_STATUS_LABEL, type ZendeskComment } from "../types";
import { StatusBadge } from "./StatusBadge";

type Props = {
  ticketId: number | null;
  onClose: () => void;
};

/**
 * Conversa completa de um ticket do Zendesk. Cada mensagem é marcada como
 * cliente, time ou nota interna (time + não pública) a partir do papel do autor
 * e do campo `public` do comentário.
 */
export function TicketDetailSheet({ ticketId, onClose }: Props) {
  const detail = useZendeskTicketQuery(ticketId);
  const [mostrarNotas, setMostrarNotas] = useState(true);

  const t = detail.data?.ticket;
  const s = detail.data?.summary;
  const comentarios = (detail.data?.comments ?? []).filter((c) => mostrarNotas || !c.internal_note);

  return (
    <Sheet open={ticketId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="text-left">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">#{ticketId}</span>
            {t ? <StatusBadge status={t.status} /> : null}
            {t ? (
              <a
                href={t.url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
              >
                Abrir no Zendesk <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </SheetTitle>
          <SheetDescription className="text-base text-foreground">
            {detail.isLoading ? <Skeleton className="h-5 w-3/4" /> : t?.subject || "(sem assunto)"}
          </SheetDescription>
        </SheetHeader>

        {detail.error ? (
          <p className="mt-6 text-sm text-destructive">{detail.error.message}</p>
        ) : detail.isLoading || !t || !s ? (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {/* ── Ficha do ticket ── */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <Fato rotulo="Cliente" valor={t.requester_name ?? "—"} detalhe={t.requester_email ?? undefined} />
              <Fato rotulo="Produto (grupo)" valor={t.group_name ?? "—"} />
              <Fato rotulo="Canal" valor={rotuloCanal(t.channel)} detalhe={t.received_by ?? undefined} />
              <Fato rotulo="Responsável" valor={t.assignee_name ?? "Sem responsável"} />
              <Fato rotulo="Criado em" valor={formatarDataHora(t.created_at)} detalhe={tempoRelativo(t.created_at)} />
              <Fato
                rotulo="Última atualização"
                valor={formatarDataHora(t.updated_at)}
                detalhe={tempoRelativo(t.updated_at)}
              />
              <Fato
                rotulo="Última resposta do time"
                valor={formatarDataHora(s.last_team_public_reply_at)}
                detalhe={s.last_team_public_reply_at ? tempoRelativo(s.last_team_public_reply_at) : "nenhuma resposta pública"}
                destaque
              />
              <Fato
                rotulo="Última mensagem do cliente"
                valor={formatarDataHora(s.last_client_message_at)}
                detalhe={s.last_client_message_at ? tempoRelativo(s.last_client_message_at) : undefined}
              />
              <Fato
                rotulo="Última nota interna"
                valor={formatarDataHora(s.last_internal_note_at)}
                detalhe={s.last_internal_note_at ? tempoRelativo(s.last_internal_note_at) : "nenhuma"}
              />
              <Fato rotulo="1ª resposta em" valor={formatarMinutos(t.first_reply_minutes)} />
              <Fato rotulo="Resolvido em" valor={formatarMinutos(t.resolution_minutes)} detalhe={t.solved_at ? formatarDataHora(t.solved_at) : undefined} />
              <Fato
                rotulo="Mensagens"
                valor={`${s.total_comments}`}
                detalhe={`${s.client_messages} do cliente · ${s.team_public_replies} do time · ${s.internal_notes} nota(s) interna(s)`}
              />
            </dl>

            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Tags</div>
              {t.tags.length === 0 ? (
                <span className="text-sm text-muted-foreground">Nenhuma tag.</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {t.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="font-mono text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* ── Conversa ── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  Conversa
                  <span className="font-normal text-muted-foreground">mais recente primeiro</span>
                </h3>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch checked={mostrarNotas} onCheckedChange={setMostrarNotas} aria-label="Mostrar notas internas" />
                  Notas internas ({s.internal_notes})
                </label>
              </div>

              {comentarios.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma mensagem neste filtro.</p>
              ) : (
                <ol className="space-y-3">
                  {comentarios.map((c) => (
                    <li key={c.id}>
                      <Mensagem c={c} />
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Fato({
  rotulo,
  valor,
  detalhe,
  destaque,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  destaque?: boolean;
}) {
  return (
    <div className={cn("min-w-0 rounded-md border p-2.5", destaque && "border-primary/40 bg-primary/5")}>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="truncate font-medium" title={valor}>
        {valor}
      </dd>
      {detalhe ? (
        <dd className="truncate text-xs text-muted-foreground" title={detalhe}>
          {detalhe}
        </dd>
      ) : null}
    </div>
  );
}

function Mensagem({ c }: { c: ZendeskComment }) {
  const doCliente = c.author_kind === "cliente";
  return (
    <article
      className={cn(
        "rounded-lg border-l-4 bg-card p-3 shadow-sm",
        doCliente && "border-l-sky-500",
        !doCliente && c.public && "border-l-emerald-500",
        c.internal_note && "border-l-amber-500 border-dashed bg-amber-500/5",
      )}
    >
      <header className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
        {doCliente ? (
          <Badge variant="secondary" className="gap-1 bg-sky-500/15 text-[10px] text-sky-700 dark:text-sky-300">
            <User className="h-3 w-3" /> Cliente
          </Badge>
        ) : c.internal_note ? (
          <Badge variant="secondary" className="gap-1 bg-amber-500/15 text-[10px] text-amber-700 dark:text-amber-300">
            <Lock className="h-3 w-3" /> Nota interna
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1 bg-emerald-500/15 text-[10px] text-emerald-700 dark:text-emerald-300">
            <Users className="h-3 w-3" /> Time
          </Badge>
        )}
        <span className="font-medium">{c.author_name ?? "—"}</span>
        {c.author_email && doCliente ? <span className="text-muted-foreground">{c.author_email}</span> : null}
        <span className="ml-auto whitespace-nowrap text-muted-foreground" title={c.created_at}>
          {formatarDataHora(c.created_at)} · {tempoRelativo(c.created_at)}
        </span>
        {c.channel ? <span className="text-muted-foreground">via {rotuloCanal(c.channel)}</span> : null}
      </header>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{c.body || "(sem texto)"}</p>
      {c.attachments.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {c.attachments.map((a) => (
            <li key={a.url}>
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Paperclip className="h-3 w-3" /> {a.file_name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export { ZENDESK_STATUS_LABEL };
