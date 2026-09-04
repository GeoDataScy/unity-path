// Edge Function `zendesk` — ponte entre o Painel da Gestora e a API do Zendesk.
//
// Por que existe: o app roda 100% no browser e a API do Zendesk exige o token
// da conta em toda chamada. Colocar esse token no bundle o entregaria para
// qualquer pessoa logada. Aqui ele fica nos secrets do projeto Supabase
// (ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN) e só sai do servidor.
//
// Guarda: só perfis com role `manager` passam. O JWT do usuário chega no header
// Authorization (o gateway já validou a assinatura; aqui conferimos o perfil).
//
// Ações (body JSON `{ action, ... }`):
//   status  → conta conectada, total na conta e contagem por status no período
//   tickets → página de tickets (mais recentes primeiro) já com e-mail do
//             cliente, produto (grupo), canal, tags, datas e métricas
//   ticket  → um ticket com a conversa inteira, cada mensagem marcada como
//             cliente / time / nota interna
//   groups  → produtos (grupos) da conta, para o filtro
//   agents  → agentes e admins da conta
//
// Limite do Zendesk: 400 chamadas/min por conta. `tickets` gasta 2 chamadas
// por página (busca + show_many com sideload), `ticket` 2, `status` 9.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TICKET_STATUSES = ["new", "open", "pending", "hold", "solved", "closed"] as const;
type TicketStatus = (typeof TICKET_STATUSES)[number];

// A busca do Zendesk devolve no máximo 1.000 resultados por consulta.
const SEARCH_MAX_RESULTS = 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type ZendeskUser = { id: number; name: string; email: string | null; role: string };
type ZendeskGroup = { id: number; name: string };
type ZendeskMetricSet = {
  ticket_id: number;
  replies: number;
  reopens: number;
  assignee_updated_at: string | null;
  requester_updated_at: string | null;
  latest_comment_added_at: string | null;
  solved_at: string | null;
  reply_time_in_minutes: { calendar: number | null };
  full_resolution_time_in_minutes: { calendar: number | null };
};
type ZendeskTicket = {
  id: number;
  subject: string | null;
  status: TicketStatus;
  priority: string | null;
  created_at: string;
  updated_at: string;
  requester_id: number | null;
  assignee_id: number | null;
  group_id: number | null;
  tags: string[];
  via?: {
    channel?: string;
    source?: { from?: { address?: string; name?: string }; to?: { address?: string; name?: string } };
  };
};
type ZendeskComment = {
  id: number;
  type: string;
  public: boolean;
  author_id: number;
  created_at: string;
  plain_body?: string;
  body?: string;
  via?: { channel?: string };
  attachments?: { file_name: string; content_url: string; content_type: string; size: number }[];
};
type ZendeskConfig = { subdomain: string; email: string; token: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function zendeskConfig(): ZendeskConfig | null {
  const subdomain = Deno.env.get("ZENDESK_SUBDOMAIN");
  const email = Deno.env.get("ZENDESK_EMAIL");
  const token = Deno.env.get("ZENDESK_API_TOKEN");
  if (!subdomain || !email || !token) return null;
  return { subdomain, email, token };
}

async function zendesk<T>(cfg: ZendeskConfig, path: string): Promise<T> {
  const res = await fetch(`https://${cfg.subdomain}.zendesk.com/api/v2/${path}`, {
    headers: {
      Authorization: `Basic ${btoa(`${cfg.email}/token:${cfg.token}`)}`,
      Accept: "application/json",
    },
  });
  if (res.status === 429) {
    throw new Error("O Zendesk limitou as chamadas por um instante. Tente de novo em alguns segundos.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zendesk respondeu ${res.status} em ${path.split("?")[0]}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** `plain_body` do Zendesk ainda traz entidades HTML (&nbsp;, &amp;…). */
function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type SearchFilters = {
  status: TicketStatus | null;
  from: string | null;
  to: string | null;
  groupId: number | null;
  q: string;
};

/** Monta a query da busca do Zendesk (mesma sintaxe da caixa de busca do agente). */
function buildSearchQuery(f: SearchFilters) {
  const parts = ["type:ticket"];
  if (f.status) parts.push(`status:${f.status}`);
  if (f.from) parts.push(`created>=${f.from}`);
  if (f.to) parts.push(`created<=${f.to}`);
  if (f.groupId) parts.push(`group:${f.groupId}`);
  if (f.q) {
    // E-mail → filtra pelo solicitante; qualquer outra coisa → texto livre
    // (assunto, descrição, comentários, tags).
    parts.push(f.q.includes("@") ? `requester:${f.q}` : f.q.replace(/["']/g, ""));
  }
  return parts.join(" ");
}

function shapeTicket(
  t: ZendeskTicket,
  cfg: ZendeskConfig,
  users: Map<number, ZendeskUser>,
  groups: Map<number, ZendeskGroup>,
  metrics: Map<number, ZendeskMetricSet>,
) {
  const requester = t.requester_id ? users.get(t.requester_id) : undefined;
  const assignee = t.assignee_id ? users.get(t.assignee_id) : undefined;
  const m = metrics.get(t.id);
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    channel: t.via?.channel ?? null,
    // Caixa de e-mail que recebeu o ticket (ex.: contact@thewellnesswize.com).
    received_by: t.via?.source?.to?.address ?? null,
    created_at: t.created_at,
    updated_at: t.updated_at,
    requester_name: requester?.name ?? t.via?.source?.from?.name ?? null,
    requester_email: requester?.email ?? t.via?.source?.from?.address ?? null,
    assignee_name: assignee?.name ?? null,
    group_id: t.group_id,
    group_name: t.group_id ? groups.get(t.group_id)?.name ?? null : null,
    tags: t.tags ?? [],
    replies: m?.replies ?? null,
    reopens: m?.reopens ?? null,
    // Última vez que o responsável mexeu no ticket (resposta, status, nota…).
    assignee_updated_at: m?.assignee_updated_at ?? null,
    // Última vez que o cliente mexeu no ticket.
    requester_updated_at: m?.requester_updated_at ?? null,
    latest_comment_added_at: m?.latest_comment_added_at ?? null,
    solved_at: m?.solved_at ?? null,
    first_reply_minutes: m?.reply_time_in_minutes?.calendar ?? null,
    resolution_minutes: m?.full_resolution_time_in_minutes?.calendar ?? null,
    url: `https://${cfg.subdomain}.zendesk.com/agent/tickets/${t.id}`,
  };
}

type ShowManyResponse = {
  tickets: ZendeskTicket[];
  users?: ZendeskUser[];
  groups?: ZendeskGroup[];
  metric_sets?: ZendeskMetricSet[];
};

function indexSideloads(r: ShowManyResponse) {
  return {
    users: new Map((r.users ?? []).map((u) => [u.id, u])),
    groups: new Map((r.groups ?? []).map((g) => [g.id, g])),
    metrics: new Map((r.metric_sets ?? []).map((m) => [m.ticket_id, m])),
  };
}

async function fetchTicketsByIds(cfg: ZendeskConfig, ids: number[]) {
  if (ids.length === 0) return [];
  const r = await zendesk<ShowManyResponse>(
    cfg,
    `tickets/show_many.json?ids=${ids.join(",")}&include=users,groups,metric_sets`,
  );
  const side = indexSideloads(r);
  // show_many não garante ordem; devolve na ordem pedida (mais recente primeiro).
  const byId = new Map(r.tickets.map((t) => [t.id, t]));
  return ids
    .map((id) => byId.get(id))
    .filter((t): t is ZendeskTicket => Boolean(t))
    .map((t) => shapeTicket(t, cfg, side.users, side.groups, side.metrics));
}

async function countTickets(cfg: ZendeskConfig, query: string) {
  const r = await zendesk<{ count: number }>(cfg, `search/count.json?query=${encodeURIComponent(query)}`);
  return r.count;
}

async function allGroups(cfg: ZendeskConfig) {
  const groups: ZendeskGroup[] = [];
  let page = 1;
  // 123 grupos hoje; o laço protege se passarem de 100 por página.
  while (page <= 10) {
    const r = await zendesk<{ groups: ZendeskGroup[]; next_page: string | null }>(
      cfg,
      `groups.json?per_page=100&page=${page}`,
    );
    groups.push(...r.groups);
    if (!r.next_page) break;
    page += 1;
  }
  return groups
    .map((g) => ({ id: g.id, name: g.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

async function allComments(cfg: ZendeskConfig, ticketId: number) {
  const comments: ZendeskComment[] = [];
  const users = new Map<number, ZendeskUser>();
  let page = 1;
  while (page <= 5) {
    const r = await zendesk<{ comments: ZendeskComment[]; users?: ZendeskUser[]; next_page: string | null }>(
      cfg,
      `tickets/${ticketId}/comments.json?include=users&sort_order=desc&per_page=100&page=${page}`,
    );
    comments.push(...r.comments);
    for (const u of r.users ?? []) users.set(u.id, u);
    if (!r.next_page) break;
    page += 1;
  }
  return { comments, users };
}

function parseDate(v: unknown) {
  return typeof v === "string" && ISO_DATE.test(v) ? v : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Não autenticado." }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "Não autenticado." }, 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "manager") return json({ error: "Somente a gestora acessa o Zendesk." }, 403);

  const cfg = zendeskConfig();
  if (!cfg) return json({ connected: false, error: "Credenciais do Zendesk não configuradas." }, 200);

  let body: Record<string, unknown> = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "status");
  const from = parseDate(body.from);
  const to = parseDate(body.to);

  try {
    if (action === "status") {
      const periodBase = `type:ticket${from ? ` created>=${from}` : ""}${to ? ` created<=${to}` : ""}`;
      const [me, total, periodTotal, ...perStatus] = await Promise.all([
        zendesk<{ user: ZendeskUser }>(cfg, "users/me.json"),
        zendesk<{ count: { value: number; refreshed_at: string } }>(cfg, "tickets/count.json"),
        countTickets(cfg, periodBase),
        ...TICKET_STATUSES.map((s) => countTickets(cfg, `${periodBase} status:${s}`)),
      ]);
      return json({
        connected: true,
        subdomain: cfg.subdomain,
        account_name: me.user.name,
        account_email: me.user.email,
        total_tickets: total.count.value,
        refreshed_at: total.count.refreshed_at,
        period: { from, to, total: periodTotal },
        by_status: Object.fromEntries(TICKET_STATUSES.map((s, i) => [s, perStatus[i]])),
      });
    }

    if (action === "tickets") {
      const page = Math.max(1, Number(body.page ?? 1) || 1);
      const perPage = Math.min(100, Math.max(1, Number(body.per_page ?? 25) || 25));
      const q = String(body.q ?? "").trim().slice(0, 200);

      // Número puro = ID do ticket: vai direto, sem passar pela busca.
      if (/^\d+$/.test(q)) {
        const tickets = await fetchTicketsByIds(cfg, [Number(q)]).catch(() => []);
        return json({ page: 1, per_page: perPage, total: tickets.length, has_more: false, tickets });
      }

      if (page * perPage > SEARCH_MAX_RESULTS) {
        return json(
          { error: `A busca do Zendesk só devolve os primeiros ${SEARCH_MAX_RESULTS} resultados. Refine o filtro.` },
          400,
        );
      }

      const filters: SearchFilters = {
        status: TICKET_STATUSES.includes(body.status as TicketStatus) ? (body.status as TicketStatus) : null,
        from,
        to,
        groupId: Number(body.group_id) > 0 ? Number(body.group_id) : null,
        q,
      };
      const query = buildSearchQuery(filters);
      const search = await zendesk<{ results: { id: number }[]; count: number; next_page: string | null }>(
        cfg,
        `search.json?query=${encodeURIComponent(query)}&sort_by=created_at&sort_order=desc&per_page=${perPage}&page=${page}`,
      );
      const tickets = await fetchTicketsByIds(cfg, search.results.map((r) => r.id));
      return json({
        page,
        per_page: perPage,
        total: search.count,
        has_more: Boolean(search.next_page) && page * perPage < SEARCH_MAX_RESULTS,
        query,
        tickets,
      });
    }

    if (action === "ticket") {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return json({ error: "Informe o número do ticket." }, 400);

      const [tickets, conversation] = await Promise.all([
        fetchTicketsByIds(cfg, [id]),
        allComments(cfg, id),
      ]);
      const ticket = tickets[0];
      if (!ticket) return json({ error: `Ticket ${id} não encontrado no Zendesk.` }, 404);

      const comments = conversation.comments.map((c) => {
        const author = conversation.users.get(c.author_id);
        const fromTeam = author ? author.role !== "end-user" : false;
        return {
          id: c.id,
          created_at: c.created_at,
          // "cliente" = end-user; "time" = agent/admin. Nota interna = time e não pública.
          author_kind: fromTeam ? ("time" as const) : ("cliente" as const),
          author_name: author?.name ?? null,
          author_email: author?.email ?? null,
          public: c.public,
          internal_note: fromTeam && !c.public,
          channel: c.via?.channel ?? null,
          body: decodeEntities(c.plain_body ?? c.body ?? ""),
          attachments: (c.attachments ?? []).map((a) => ({
            file_name: a.file_name,
            content_type: a.content_type,
            size: a.size,
            url: a.content_url,
          })),
        };
      });

      const latest = (pred: (c: (typeof comments)[number]) => boolean) =>
        comments.find(pred)?.created_at ?? null; // já vem em ordem decrescente

      return json({
        ticket,
        summary: {
          total_comments: comments.length,
          team_public_replies: comments.filter((c) => c.author_kind === "time" && c.public).length,
          client_messages: comments.filter((c) => c.author_kind === "cliente").length,
          internal_notes: comments.filter((c) => c.internal_note).length,
          last_team_public_reply_at: latest((c) => c.author_kind === "time" && c.public),
          last_client_message_at: latest((c) => c.author_kind === "cliente"),
          last_internal_note_at: latest((c) => c.internal_note),
        },
        comments,
      });
    }

    if (action === "groups") {
      return json({ groups: await allGroups(cfg) });
    }

    if (action === "agents") {
      const r = await zendesk<{ users: ZendeskUser[] }>(cfg, "users.json?role[]=agent&role[]=admin&per_page=100");
      return json({ agents: r.users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })) });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
});
