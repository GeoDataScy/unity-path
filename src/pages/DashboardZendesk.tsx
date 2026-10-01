import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Headset,
  HelpCircle,
  Link2,
  RefreshCw,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ManagerOutletContext } from "@/layouts/ManagerLayout";
import { StatusBadge } from "@/features/zendesk/components/StatusBadge";
import { TicketDetailSheet } from "@/features/zendesk/components/TicketDetailSheet";
import { formatarDataHora, rotuloCanal, tempoRelativo } from "@/features/zendesk/format";
import {
  useZendeskGroupsQuery,
  useZendeskStatusQuery,
  useZendeskTicketsQuery,
} from "@/features/zendesk/useZendeskQuery";
import {
  ZENDESK_STATUS_LABEL,
  ZENDESK_TICKET_STATUSES,
  type ZendeskTicketStatus,
} from "@/features/zendesk/types";
import { cn } from "@/lib/utils";

/**
 * Aba "Zendesk" do Painel da Gestora.
 *
 * Tudo aqui vem da Edge Function `zendesk`: o token da conta fica nos secrets
 * do Supabase e nunca chega ao browser. A função só responde para role manager.
 * O período vem do seletor da barra lateral, como nas outras abas.
 */
export default function DashboardZendesk() {
  const { fromISO, toISO } = useOutletContext<ManagerOutletContext>();

  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<ZendeskTicketStatus | "all">("all");
  const [grupoId, setGrupoId] = useState<number | null>(null);
  const [pagina, setPagina] = useState(1);
  const [ticketAberto, setTicketAberto] = useState<number | null>(null);

  // Digitar não dispara chamada a cada tecla: espera 500 ms de pausa.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setBuscaAplicada(busca.trim());
      setPagina(1);
    }, 500);
    return () => window.clearTimeout(id);
  }, [busca]);

  // Mudou o período na sidebar → volta para a primeira página.
  useEffect(() => setPagina(1), [fromISO, toISO]);

  const status = useZendeskStatusQuery({ from: fromISO, to: toISO });
  const conectado = status.data?.connected === true;
  const grupos = useZendeskGroupsQuery(conectado);
  const tickets = useZendeskTicketsQuery(
    { status: filtroStatus, groupId: grupoId, q: buscaAplicada, from: fromISO, to: toISO, page: pagina },
    conectado,
  );

  const erroConexao =
    status.error?.message ?? (status.data && status.data.connected === false ? status.data.error : null);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Headset className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-medium">Zendesk</h1>
          <p className="text-sm text-muted-foreground">
            Tickets do Zendesk lidos ao vivo da API. O período é o mesmo da barra lateral.
          </p>
        </div>
      </header>

      {/* ── Conexão + números do período ── */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">Status da integração</h2>
            </div>
            {status.isLoading ? (
              <Skeleton className="h-4 w-72" />
            ) : status.data?.connected ? (
              <p className="text-sm text-muted-foreground">
                Conectado a{" "}
                <span className="font-medium text-foreground">{status.data.subdomain}.zendesk.com</span> como{" "}
                {status.data.account_name}
                {status.data.account_email ? ` (${status.data.account_email})` : ""}.{" "}
                <span className="text-xs">
                  {status.data.total_tickets.toLocaleString("pt-BR")} tickets na conta inteira.
                </span>
              </p>
            ) : (
              <p className="text-sm text-destructive">{erroConexao ?? "Não foi possível verificar a conexão."}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={conectado ? "secondary" : "outline"}
              className={cn("text-[11px]", conectado && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300")}
            >
              {status.isLoading ? "Verificando…" : conectado ? "Conectado" : "Não conectado"}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Atualizar"
              onClick={() => {
                status.refetch();
                tickets.refetch();
              }}
              disabled={status.isFetching}
            >
              <RefreshCw className={cn("h-4 w-4", status.isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>

        {status.data?.connected && (
          <>
            <div className="mt-5 mb-2 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              Tickets criados no período ({formatarPeriodo(fromISO, toISO)})
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <Tile
                rotulo="No período"
                valor={status.data.period.total}
                destaque
                ativo={filtroStatus === "all"}
                onClick={() => {
                  setFiltroStatus("all");
                  setPagina(1);
                }}
              />
              {ZENDESK_TICKET_STATUSES.map((s) => (
                <Tile
                  key={s}
                  rotulo={ZENDESK_STATUS_LABEL[s]}
                  valor={status.data.connected ? status.data.by_status[s] : 0}
                  ativo={filtroStatus === s}
                  onClick={() => {
                    setFiltroStatus(s);
                    setPagina(1);
                  }}
                />
              ))}
            </div>
          </>
        )}
      </Card>

      {/* ── Filtros + tabela ── */}
      {conectado && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="E-mail do cliente, nº do ticket ou palavra do assunto…"
                className="pl-9"
              />
            </div>
            <Select
              value={filtroStatus}
              onValueChange={(v) => {
                setFiltroStatus(v as ZendeskTicketStatus | "all");
                setPagina(1);
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {ZENDESK_TICKET_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {ZENDESK_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={grupoId === null ? "all" : String(grupoId)}
              onValueChange={(v) => {
                setGrupoId(v === "all" ? null : Number(v));
                setPagina(1);
              }}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Produto" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">Todos os produtos</SelectItem>
                {(grupos.data ?? []).map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {tickets.data
                ? `${tickets.data.total.toLocaleString("pt-BR")} ticket(s) no filtro · página ${tickets.data.page}`
                : "Carregando…"}
            </span>
            <span>Clique numa linha para ver a conversa completa.</span>
          </div>

          <Card>
            {tickets.isLoading ? (
              <TabelaCarregando />
            ) : tickets.error ? (
              <p className="p-6 text-sm text-destructive">{tickets.error.message}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">#</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Assunto</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Canal</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Responsável</TableHead>
                      <TableHead>Criado</TableHead>
                      <TableHead>Atualizado</TableHead>
                      <TableHead>
                        <ComTooltip texto="Última vez que o responsável mexeu no ticket (resposta, nota ou status). A data exata da última resposta pública do time está no detalhe.">
                          Últ. ação do time
                        </ComTooltip>
                      </TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(tickets.data?.tickets ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">
                          Nenhum ticket neste filtro.
                        </TableCell>
                      </TableRow>
                    ) : (
                      tickets.data!.tickets.map((t) => (
                        <TableRow
                          key={t.id}
                          onClick={() => setTicketAberto(t.id)}
                          className={cn("cursor-pointer", tickets.isFetching && "opacity-60")}
                        >
                          <TableCell className="font-mono text-xs">{t.id}</TableCell>
                          <TableCell className="max-w-[200px] text-xs">
                            <div className="truncate font-medium">{t.requester_name ?? "—"}</div>
                            <div className="truncate text-muted-foreground" title={t.requester_email ?? ""}>
                              {t.requester_email ?? "—"}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[260px]">
                            <div className="truncate text-sm" title={t.subject ?? ""}>
                              {t.subject || "(sem assunto)"}
                            </div>
                            {t.tags.length > 0 && (
                              <div className="truncate font-mono text-[10px] text-muted-foreground" title={t.tags.join(", ")}>
                                {t.tags.join(" · ")}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[140px] truncate text-xs" title={t.group_name ?? ""}>
                            {t.group_name ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs">{rotuloCanal(t.channel)}</TableCell>
                          <TableCell>
                            <StatusBadge status={t.status} />
                          </TableCell>
                          <TableCell className="max-w-[120px] truncate text-xs">{t.assignee_name ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{formatarDataHora(t.created_at)}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            <div>{formatarDataHora(t.updated_at)}</div>
                            <div className="text-muted-foreground">{tempoRelativo(t.updated_at)}</div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            <div>{formatarDataHora(t.assignee_updated_at)}</div>
                            <div className="text-muted-foreground">{tempoRelativo(t.assignee_updated_at)}</div>
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <a
                              href={t.url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Abrir ticket ${t.id} no Zendesk`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>

          {tickets.data && (
            <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
              <span>Página {tickets.data.page}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Página anterior"
                disabled={pagina <= 1 || tickets.isFetching}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Próxima página"
                disabled={!tickets.data.has_more || tickets.isFetching}
                onClick={() => setPagina((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </section>
      )}

      {/* ── Explicação ── */}
      <Explicacao />

      <TicketDetailSheet ticketId={ticketAberto} onClose={() => setTicketAberto(null)} />
    </main>
  );
}

function Tile({
  rotulo,
  valor,
  destaque,
  ativo,
  onClick,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
  ativo?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-3 text-left transition-colors hover:bg-muted/60",
        destaque && "bg-primary/5",
        ativo && "border-primary ring-1 ring-primary/40",
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{rotulo}</div>
      <div className="text-lg font-medium font-mono tabular-nums">{valor.toLocaleString("pt-BR")}</div>
    </button>
  );
}

function ComTooltip({ children, texto }: { children: React.ReactNode; texto: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-1 underline decoration-dotted underline-offset-2">
          {children}
          <HelpCircle className="h-3 w-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {texto}
      </TooltipContent>
    </Tooltip>
  );
}

const EXPLICACAO: { termo: string; texto: string }[] = [
  {
    termo: "Cliente",
    texto: "Nome e e-mail do solicitante do ticket (requester). É o mesmo e-mail que o time registra nos atendimentos internos.",
  },
  {
    termo: "Produto",
    texto: "Grupo do Zendesk em que o ticket está (ex.: Horsefil, Thewellnesswize). A conta usa um grupo por produto/loja.",
  },
  {
    termo: "Canal",
    texto: "Por onde o ticket entrou: e-mail, portal, chat, WhatsApp… No detalhe aparece também a caixa de e-mail que recebeu.",
  },
  {
    termo: "Status",
    texto: "Novo, Aberto (aguardando o time), Pendente (aguardando o cliente), Em espera, Resolvido e Fechado.",
  },
  {
    termo: "Tags",
    texto: "Etiquetas aplicadas ao ticket, pelos agentes ou por automações. Aparecem abaixo do assunto e no detalhe.",
  },
  {
    termo: "Criado / Atualizado",
    texto: "Data de abertura e data da última mudança de qualquer tipo (resposta, nota, status, tag). Horário de São Paulo.",
  },
  {
    termo: "Últ. ação do time",
    texto: "Última vez que o responsável mexeu no ticket. Vem das métricas do Zendesk e não distingue resposta pública de nota.",
  },
  {
    termo: "Última resposta do time (detalhe)",
    texto: "Data da última mensagem pública escrita por agente ou admin. Calculada lendo a conversa: autor com papel de time e mensagem visível ao cliente.",
  },
  {
    termo: "Nota interna",
    texto: "Mensagem do time que o cliente não vê (public = false). No detalhe aparece em amarelo e pode ser ocultada.",
  },
  {
    termo: "Busca",
    texto: "E-mail filtra pelo cliente; número puro abre o ticket com esse ID; texto livre procura em assunto, descrição e comentários.",
  },
  {
    termo: "Período",
    texto: "Filtra pela data de criação do ticket usando o seletor da barra lateral. A busca do Zendesk devolve no máximo 1.000 tickets por consulta.",
  },
];

function Explicacao() {
  const [aberto, setAberto] = useState(false);
  return (
    <Collapsible open={aberto} onOpenChange={setAberto}>
      <Card className="p-4">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between text-left">
            <span className="flex items-center gap-2 text-sm font-medium">
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
              Como ler esta tela
            </span>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", aberto && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {EXPLICACAO.map((e) => (
              <div key={e.termo}>
                <dt className="font-medium">{e.termo}</dt>
                <dd className="text-muted-foreground">{e.texto}</dd>
              </div>
            ))}
          </dl>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function formatarPeriodo(fromISO: string, toISO: string) {
  const f = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y.slice(2)}`;
  };
  return `${f(fromISO)} a ${f(toISO)}`;
}

function TabelaCarregando() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
