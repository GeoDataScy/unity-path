// Registry de TOOLS da Lya.
//
// Quatro famílias (ver prompt.ts):
//   painel_* / listar_* → os MESMOS RPCs que alimentam as telas da gestora,
//                          chamados com o JWT do usuário (os guards do banco —
//                          is_manager / can_view_support_analytics — valem
//                          igual ao que vale na tela);
//   consultar_banco      → SELECT livre no sandbox lya_exec_sql;
//   buscar_base_suporte  → conteúdo editorial da Base de Suporte;
//   gerar_grafico        → artefato para a UI (não volta ao modelo);
//   salvar_memoria       → só no modo treino (cérebro da Lya).
//
// Cada tool devolve uma STRING (o tool_result) e declara a `origem` da
// evidência que ela produz para o verificador anti-fakenews.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { CATALOGO_SQL } from "./prompt.ts";
import { refinarMemoria, TIPOS_VALIDOS } from "./treinador.ts";
import type { Evidencia } from "./verificador.ts";

// Limite do resultado devolvido ao modelo (contexto) — o excedente é cortado
// com aviso para o modelo refinar o recorte.
const MAX_RESULT_CHARS = 36_000;

export interface ChartSeries {
  nome: string;
  valores: number[];
}

export interface ChartSpec {
  tipo: "barras" | "linha" | "area" | "pizza";
  titulo: string;
  subtitulo?: string;
  eixoX?: string;
  eixoY?: string;
  categorias: string[];
  series: ChartSeries[];
}

export interface MemoriaArtifact {
  name: string;
  description: string;
  type: string;
  tags: string[];
}

export interface ToolContext {
  supabase: SupabaseClient;
  onChart?: (chart: ChartSpec) => void;
  onMemory?: (memoria: MemoriaArtifact) => void;
  signal?: AbortSignal;
}

export interface AgentTool {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  origem: Evidencia["origem"] | null; // null = tool de ENTREGA (não é fonte de fato)
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

// ── Utilitários ─────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dataISO(v: unknown, campo: string): string {
  const s = String(v ?? "").trim();
  if (!ISO_DATE.test(s)) throw new Error(`'${campo}' precisa estar no formato YYYY-MM-DD (recebi "${s}").`);
  return s;
}

function agenteId(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s && s !== "all" && s.toLowerCase() !== "todos" ? s : null;
}

function texto(v: unknown, fallback = ""): string {
  const s = String(v ?? "").trim();
  return s || fallback;
}

// Serializa e trunca. Arrays grandes são cortados mantendo um prefixo e um
// aviso; objetos são cortados no bruto.
export function clip(data: unknown, max = MAX_RESULT_CHARS): string {
  let json = JSON.stringify(data);
  if (json.length <= max) return json;
  if (Array.isArray(data)) {
    let kept = data as unknown[];
    while (kept.length > 1 && JSON.stringify(kept).length > max) {
      kept = kept.slice(0, Math.floor(kept.length * 0.7));
    }
    json = JSON.stringify({
      _aviso: `Resultado truncado: mostrando ${kept.length} de ${data.length} registros. Refine o recorte (período, agente, filtros) ou agregue no SQL.`,
      registros: kept,
    });
    return json;
  }
  return json.slice(0, max) + "…(truncado — refine o recorte)";
}

// Chama um RPC com o client do usuário. Erro de guard/negócio volta como
// mensagem para o modelo se adaptar (ex.: "forbidden" para o time de copy).
async function rpc(ctx: ToolContext, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await ctx.supabase.rpc(fn, args);
  if (error) {
    const msg = String(error.message || "");
    if (/forbidden|permission denied|42501/i.test(msg)) {
      throw new Error(`Acesso negado a ${fn}: este conteúdo é restrito à gestora (o perfil atual não pode vê-lo).`);
    }
    throw new Error(`${fn} falhou: ${msg.slice(0, 300)}`);
  }
  return data;
}

function cabecalho(fonte: string, recorte: Record<string, unknown>): string {
  const partes = Object.entries(recorte)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}`);
  return `Fonte: ${fonte}${partes.length ? ` (${partes.join(", ")})` : ""}\n`;
}

// Parâmetros repetidos nas tools de painel.
const P_DE = { type: "string", description: "Início do período, YYYY-MM-DD (use o período da tela se a pergunta não definir)." };
const P_ATE = { type: "string", description: "Fim do período, YYYY-MM-DD." };
const P_AGENTE = {
  type: "string",
  description: "Opcional. Id do agente (profiles.id) para filtrar; omita ou passe 'all' para todos. Use listar_agentes para achar o id pelo nome.",
};
const P_STATUS_REEMBOLSO = {
  type: "string",
  enum: ["all", "open", "done"],
  description: "Opcional. 'open' = em aberto, 'done' = concluídos, 'all' = todos (default).",
};
const P_TIPO_REEMBOLSO = {
  type: "string",
  description: "Opcional. Filtro por tipo: '100%' (integral), outro valor exato (parcial), 'null' (não informado) ou 'all'.",
};
const P_PRODUTO = { type: "string", description: "Opcional. Nome exato do produto (confira com SELECT DISTINCT), 'null' ou 'all'." };

// ── Tools de PAINEL (mesmos RPCs das telas) ─────────────────────────────────

const painelAtendimentos: AgentTool = {
  name: "painel_atendimentos",
  origem: "painel",
  description:
    "Tela ATENDIMENTOS (RPC dashboard_metrics): total de eventos do período (tickets abertos + follow-ups, cada um vale 1), " +
    "e a quebra por agente (by_agent: user_id, name, value), por produto (top 10), por dia (by_day), por plataforma e por canal. " +
    "É o número dos cards e gráficos da tela. Use para 'quantos atendimentos', 'quem mais atendeu', 'evolução por dia', 'mix de produto/canal'.",
  input_schema: { type: "object", properties: { de: P_DE, ate: P_ATE, agente_id: P_AGENTE }, required: ["de", "ate"] },
  async execute(input, ctx) {
    const de = dataISO(input.de, "de"), ate = dataISO(input.ate, "ate"), ag = agenteId(input.agente_id);
    const data = await rpc(ctx, "dashboard_metrics", { from_date: de, to_date: ate, agent_id: ag });
    return cabecalho("tela Atendimentos — dashboard_metrics", { de, ate, agente_id: ag }) + clip(data);
  },
};

const painelStatusTickets: AgentTool = {
  name: "painel_status_tickets",
  origem: "painel",
  description:
    "Tela ATENDIMENTOS, card de status (RPC dashboard_status_summary; só gestora): quantos tickets do período estão Novo, " +
    "Em andamento e Concluído, pela regra do último follow-up. Universo = tickets abertos no período + tickets com interação no período.",
  input_schema: { type: "object", properties: { de: P_DE, ate: P_ATE, agente_id: P_AGENTE }, required: ["de", "ate"] },
  async execute(input, ctx) {
    const de = dataISO(input.de, "de"), ate = dataISO(input.ate, "ate"), ag = agenteId(input.agente_id);
    const data = await rpc(ctx, "dashboard_status_summary", { from_date: de, to_date: ate, agent_id: ag });
    return cabecalho("tela Atendimentos — dashboard_status_summary", { de, ate, agente_id: ag }) + clip(data);
  },
};

const painelCanais: AgentTool = {
  name: "painel_canais",
  origem: "painel",
  description:
    "Modal 'detalhe por canal' da tela Atendimentos (RPC dashboard_channel_detail): por canal × agente, tickets novos " +
    "(new_tickets), concluídos (done_count), interações (interactions) e total. Use para 'como está o SMS vs Email por agente'.",
  input_schema: { type: "object", properties: { de: P_DE, ate: P_ATE, agente_id: P_AGENTE }, required: ["de", "ate"] },
  async execute(input, ctx) {
    const de = dataISO(input.de, "de"), ate = dataISO(input.ate, "ate"), ag = agenteId(input.agente_id);
    const data = await rpc(ctx, "dashboard_channel_detail", { p_from_date: de, p_to_date: ate, p_agent_id: ag });
    return cabecalho("tela Atendimentos — dashboard_channel_detail", { de, ate, agente_id: ag }) + clip(data);
  },
};

const painelInteracoes: AgentTool = {
  name: "painel_interacoes",
  origem: "painel",
  description:
    "Tela INTERAÇÕES (RPC dashboard_follow_up_detail): KPIs do período (total_services, new_tickets_count, interactions_count, " +
    "done_count), tabela por agente (tickets novos, interações, concluídos, média de interações até concluir, completion_rate %), " +
    "insights (top_performer, most_open, most_productive) e as 20 interações mais recentes. Não aceita filtro por agente (a tela também não).",
  input_schema: { type: "object", properties: { de: P_DE, ate: P_ATE }, required: ["de", "ate"] },
  async execute(input, ctx) {
    const de = dataISO(input.de, "de"), ate = dataISO(input.ate, "ate");
    const data = (await rpc(ctx, "dashboard_follow_up_detail", { p_from_date: de, p_to_date: ate })) as Record<string, unknown>;
    const recent = Array.isArray(data?.recent_follow_ups) ? (data.recent_follow_ups as unknown[]).slice(0, 20) : [];
    return cabecalho("tela Interações — dashboard_follow_up_detail", { de, ate }) + clip({ ...data, recent_follow_ups: recent });
  },
};

const painelPadraoHorarios: AgentTool = {
  name: "painel_padrao_horarios",
  origem: "painel",
  description:
    "Tela ATENDIMENTOS, bloco 'padrão de horários' (RPC dashboard_hourly_pattern): total de atividades, dias ativos, pico " +
    "(hora/dia da semana), horário mediano de início e fim, participação por turno (manhã/tarde/noite/madrugada) e a que " +
    "horas a meta diária costuma ser batida (goal_hit). by_dow_hour vem só com as células > 0 (dow 0=domingo).",
  input_schema: { type: "object", properties: { de: P_DE, ate: P_ATE, agente_id: P_AGENTE }, required: ["de", "ate"] },
  async execute(input, ctx) {
    const de = dataISO(input.de, "de"), ate = dataISO(input.ate, "ate"), ag = agenteId(input.agente_id);
    const data = (await rpc(ctx, "dashboard_hourly_pattern", { from_date: de, to_date: ate, agent_id: ag })) as Record<string, unknown>;
    const cells = Array.isArray(data?.by_dow_hour)
      ? (data.by_dow_hour as { dow: number; hour: number; count: number }[]).filter((c) => c.count > 0)
      : [];
    return cabecalho("tela Atendimentos — dashboard_hourly_pattern", { de, ate, agente_id: ag }) + clip({ ...data, by_dow_hour: cells });
  },
};

const painelRepeticoes: AgentTool = {
  name: "painel_repeticoes_mesmo_dia",
  origem: "painel",
  description:
    "Tela INTERAÇÕES, bloco 'repetições no mesmo dia' (RPC dashboard_same_day_repeats): follow-ups registrados no mesmo dia " +
    "da interação anterior (violação da regra das 18h): rule_violations, same_day_extra, quebra por agente (repeat_count, " +
    "total_count, pct) e até 30 casos detalhados.",
  input_schema: { type: "object", properties: { de: P_DE, ate: P_ATE, agente_id: P_AGENTE }, required: ["de", "ate"] },
  async execute(input, ctx) {
    const de = dataISO(input.de, "de"), ate = dataISO(input.ate, "ate"), ag = agenteId(input.agente_id);
    const data = (await rpc(ctx, "dashboard_same_day_repeats", { from_date: de, to_date: ate, agent_id: ag })) as Record<string, unknown>;
    const detail = Array.isArray(data?.detail) ? (data.detail as unknown[]).slice(0, 30) : [];
    return cabecalho("tela Interações — dashboard_same_day_repeats", { de, ate, agente_id: ag }) + clip({ ...data, detail });
  },
};

const painelReembolsos: AgentTool = {
  name: "painel_reembolsos",
  origem: "painel",
  description:
    "Tela REEMBOLSOS (RPC dashboard_refund_metrics): total_count, open_count, done_count e quebras por agente, status, tipo " +
    "(by_refund_type, só concluídos), produto, canal, plataforma, motivo classificado (by_reason) e eficiência por canal " +
    "(by_channel_efficiency: % de parciais entre os concluídos). Regra do período: abertos pela request_date, concluídos pela completion_date.",
  input_schema: {
    type: "object",
    properties: { de: P_DE, ate: P_ATE, agente_id: P_AGENTE, status: P_STATUS_REEMBOLSO, tipo_reembolso: P_TIPO_REEMBOLSO, produto: P_PRODUTO },
    required: ["de", "ate"],
  },
  async execute(input, ctx) {
    const de = dataISO(input.de, "de"), ate = dataISO(input.ate, "ate"), ag = agenteId(input.agente_id);
    const status = texto(input.status, "all"), tipo = texto(input.tipo_reembolso, "all"), produto = texto(input.produto, "all");
    const data = await rpc(ctx, "dashboard_refund_metrics", {
      from_date: de, to_date: ate, agent_id: ag, status_filter: status, refund_type_filter: tipo, product_filter: produto,
    });
    return cabecalho("tela Reembolsos — dashboard_refund_metrics", { de, ate, agente_id: ag, status, tipo, produto }) + clip(data);
  },
};

const painelReembolsosMotivo: AgentTool = {
  name: "painel_reembolsos_motivo",
  origem: "painel",
  description:
    "Drill-down de um MOTIVO na tela Reembolsos (RPC dashboard_refund_reason_detail): os reembolsos de uma categoria de motivo " +
    "(ex.: 'Arrependimento de compra'), com agente, cliente, pedido, produto, canal, tipo, valor e o texto original do motivo. Até 50 por página.",
  input_schema: {
    type: "object",
    properties: {
      de: P_DE, ate: P_ATE,
      categoria: { type: "string", description: "Categoria exata do motivo (use by_reason de painel_reembolsos para ver as existentes)." },
      agente_id: P_AGENTE, status: P_STATUS_REEMBOLSO, tipo_reembolso: P_TIPO_REEMBOLSO, produto: P_PRODUTO,
      pagina: { type: "integer", description: "Página (1 = primeira)." },
    },
    required: ["de", "ate", "categoria"],
  },
  async execute(input, ctx) {
    const de = dataISO(input.de, "de"), ate = dataISO(input.ate, "ate"), ag = agenteId(input.agente_id);
    const categoria = texto(input.categoria);
    if (!categoria) throw new Error("'categoria' é obrigatória.");
    const pagina = Math.max(1, Number(input.pagina ?? 1) || 1);
    const data = await rpc(ctx, "dashboard_refund_reason_detail", {
      from_date: de, to_date: ate, reason_category: categoria, agent_id: ag,
      status_filter: texto(input.status, "all"), refund_type_filter: texto(input.tipo_reembolso, "all"),
      product_filter: texto(input.produto, "all"), page_size: 50, page_offset: (pagina - 1) * 50,
    });
    return cabecalho("tela Reembolsos — dashboard_refund_reason_detail", { de, ate, categoria, agente_id: ag, pagina }) + clip(data);
  },
};

const painelAlertas: AgentTool = {
  name: "painel_alertas_reembolso",
  origem: "painel",
  description:
    "Tela ALERTAS (RPC manager_refund_alerts; só gestora): reembolsos EM ATRASO agora (em aberto com pedido antes de hoje): " +
    "total_overdue, agents_affected e a lista por agente com cliente, pedido, produto, canal e days_overdue. Não tem período — é a foto de hoje.",
  input_schema: { type: "object", properties: {} },
  async execute(_input, ctx) {
    const data = await rpc(ctx, "manager_refund_alerts", {});
    return cabecalho("tela Alertas — manager_refund_alerts", { referencia: "hoje" }) + clip(data);
  },
};

const painelUsuarios: AgentTool = {
  name: "painel_usuarios",
  origem: "painel",
  description:
    "Tela USUÁRIOS (RPC manager_list_users; só gestora): todos os perfis com role, canal principal, ativo/inativo, disponível " +
    "(folga), online agora, último login/logout, tickets em aberto (open_tickets_count) e quantos foram autorizados por tomada.",
  input_schema: { type: "object", properties: {} },
  async execute(_input, ctx) {
    const data = await rpc(ctx, "manager_list_users", {});
    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const enxuto = rows.map((r) => ({
      id: r.id, full_name: r.full_name, role: r.role, support_channel: r.support_channel, is_active: r.is_active,
      is_available: r.is_available, is_online: r.is_online, last_sign_in_at: r.last_sign_in_at, last_logout_at: r.last_logout_at,
      last_seen_at: r.last_seen_at, open_tickets_count: r.open_tickets_count, authorized_open_count: r.authorized_open_count,
      deactivated_at: r.deactivated_at, created_at: r.created_at,
    }));
    return cabecalho("tela Usuários — manager_list_users", { referencia: "agora" }) + clip(enxuto);
  },
};

const painelPedidosEspera: AgentTool = {
  name: "painel_pedidos_espera",
  origem: "painel",
  description:
    "Tela ACOMPANHAMENTO / Pedidos em espera (RPC manager_list_held_orders; só gestora): total, duplicados, resumo por agente " +
    "(pending, in_progress, confirmed) e até 60 pedidos (sem endereço). Filtros: status 'all' | 'pending' | 'confirmed' | " +
    "'aguardando' | 'em_andamento'; agente responsável; período pela order_date (opcional).",
  input_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["all", "pending", "confirmed", "aguardando", "em_andamento"], description: "Filtro de status (default all)." },
      agente_id: P_AGENTE,
      de: { type: "string", description: "Opcional. Início pela data do pedido, YYYY-MM-DD." },
      ate: { type: "string", description: "Opcional. Fim pela data do pedido, YYYY-MM-DD." },
    },
  },
  async execute(input, ctx) {
    const status = texto(input.status, "all"), ag = agenteId(input.agente_id);
    const de = input.de ? dataISO(input.de, "de") : null, ate = input.ate ? dataISO(input.ate, "ate") : null;
    const data = (await rpc(ctx, "manager_list_held_orders", { from_date: de, to_date: ate, agent_id: ag, status_filter: status })) as Record<string, unknown>;
    const rows = Array.isArray(data?.rows) ? (data.rows as Record<string, unknown>[]) : [];
    const enxuto = rows.slice(0, 60).map((r) => ({
      id: r.id, order_number: r.order_number, dyna_code: r.dyna_code, reason: r.reason, order_date: r.order_date, email: r.email,
      customer_name: r.customer_name, items: r.items, status: r.status, agent_status: r.agent_status, pending_tag: r.pending_tag,
      assigned_to: r.assigned_to, assigned_to_name: r.assigned_to_name, assign_count: r.assign_count, confirmed_at: r.confirmed_at,
      imported_at: r.imported_at, duplicate_of: r.duplicate_of,
    }));
    return cabecalho("tela Acompanhamento — manager_list_held_orders", { status, agente_id: ag, de, ate }) +
      clip({ total: data?.total, duplicates: data?.duplicates, summary_by_agent: data?.summary_by_agent, rows_mostradas: enxuto.length, rows: enxuto });
  },
};

const listarAtendimentos: AgentTool = {
  name: "listar_atendimentos",
  origem: "painel",
  description:
    "Tabela de auditoria da tela Atendimentos (RPC dashboard_audit): os tickets abertos no período, um por linha (id, data, " +
    "cliente, produto, plataforma, canal, status gravado, agente), 50 por página, mais recentes primeiro. Para contagens use painel_atendimentos; " +
    "para recortes complexos use consultar_banco.",
  input_schema: {
    type: "object",
    properties: { de: P_DE, ate: P_ATE, agente_id: P_AGENTE, pagina: { type: "integer", description: "Página (1 = primeira)." } },
    required: ["de", "ate"],
  },
  async execute(input, ctx) {
    const de = dataISO(input.de, "de"), ate = dataISO(input.ate, "ate"), ag = agenteId(input.agente_id);
    const pagina = Math.max(1, Number(input.pagina ?? 1) || 1);
    const data = await rpc(ctx, "dashboard_audit", { from_date: de, to_date: ate, agent_id: ag, page_size: 50, page_offset: (pagina - 1) * 50 });
    return cabecalho("tela Atendimentos — dashboard_audit", { de, ate, agente_id: ag, pagina }) + clip(data);
  },
};

const listarReembolsos: AgentTool = {
  name: "listar_reembolsos",
  origem: "painel",
  description:
    "Tabela de auditoria da tela Reembolsos (RPC dashboard_refund_audit): reembolsos com pedido no período (request_date), um por " +
    "linha (cliente, pedido, plataforma, produto, canal, tipo, motivo, datas, agente), 50 por página.",
  input_schema: {
    type: "object",
    properties: {
      de: P_DE, ate: P_ATE, agente_id: P_AGENTE, status: P_STATUS_REEMBOLSO, tipo_reembolso: P_TIPO_REEMBOLSO, produto: P_PRODUTO,
      pagina: { type: "integer", description: "Página (1 = primeira)." },
    },
    required: ["de", "ate"],
  },
  async execute(input, ctx) {
    const de = dataISO(input.de, "de"), ate = dataISO(input.ate, "ate"), ag = agenteId(input.agente_id);
    const pagina = Math.max(1, Number(input.pagina ?? 1) || 1);
    const data = await rpc(ctx, "dashboard_refund_audit", {
      from_date: de, to_date: ate, agent_id: ag, status_filter: texto(input.status, "all"),
      refund_type_filter: texto(input.tipo_reembolso, "all"), product_filter: texto(input.produto, "all"),
      page_size: 50, page_offset: (pagina - 1) * 50,
    });
    return cabecalho("tela Reembolsos — dashboard_refund_audit", { de, ate, agente_id: ag, pagina }) + clip(data);
  },
};

// ── Sandbox de SQL ──────────────────────────────────────────────────────────

const consultarBanco: AgentTool = {
  name: "consultar_banco",
  origem: "banco",
  description:
    "Executa um SELECT (PostgreSQL) no banco do XMX Suporte e devolve as linhas em JSON. Use para o que as tools de painel não " +
    "respondem (cliente/e-mail/pedido específico, cruzamentos, comparação entre períodos, séries por semana/mês, tickets parados) e " +
    "para CALCULAR no banco (percentual, média, ranking, variação). Sandbox somente-leitura: apenas SELECT/WITH, uma instrução sem ';', " +
    "timeout curto, máx. 200 linhas.\n\n" + CATALOGO_SQL,
  input_schema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "A consulta SELECT/WITH (dialeto PostgreSQL), sem ';'." },
      limite: { type: "integer", description: "Máximo de linhas (default 200, teto 500)." },
    },
    required: ["sql"],
  },
  async execute(input, ctx) {
    const sql = texto(input.sql);
    if (!sql) throw new Error("Consulta vazia.");
    if (!/^\s*(select|with)\b/i.test(sql)) throw new Error("Apenas consultas SELECT/WITH são permitidas.");
    if (sql.includes(";")) throw new Error("Envie UMA instrução, sem ';'.");
    if (/\b(profiles|lya_memories|lya_chats|lya_chat_messages|auth_events|agent_heartbeats|auth\.|storage\.|vault\.|pg_catalog|information_schema)\b/i.test(sql)) {
      throw new Error("A consulta referencia uma tabela fora do catálogo liberado. Use apenas as tabelas listadas (para agentes, use lya_agentes).");
    }
    const limite = Math.min(500, Math.max(1, Number(input.limite ?? 200) || 200));
    const { data, error } = await ctx.supabase.rpc("lya_exec_sql", { p_sql: sql, p_limit: limite });
    if (error) {
      const msg = String(error.message || "").slice(0, 400);
      if (/forbidden|42501/i.test(msg)) throw new Error("Acesso negado ao sandbox de SQL para este perfil.");
      return `Fonte: banco de dados (SQL) — a consulta FALHOU. Corrija e tente de novo.\nSQL:\n${sql}\nErro: ${msg}`;
    }
    const rows = Array.isArray(data) ? data : [];
    const corpo = rows.length === 0 ? "[] (sem linhas para esse filtro — confira valores com SELECT DISTINCT)" : clip(rows);
    return `Fonte: banco de dados XMX Suporte — SQL executado:\n${sql}\n\nResultado (${rows.length} linha(s)):\n${corpo}`;
  },
};

const listarAgentes: AgentTool = {
  name: "listar_agentes",
  origem: "banco",
  description:
    "Lista as pessoas do time (id, nome, role, canal principal, ativo, disponível). Use para traduzir nome -> id antes de filtrar " +
    "as tools de painel por agente, ou para saber quem está de folga/inativo.",
  input_schema: { type: "object", properties: {} },
  async execute(_input, ctx) {
    const sql = "SELECT id, full_name, role, support_channel, is_active, is_available FROM lya_agentes ORDER BY is_active DESC, full_name";
    const { data, error } = await ctx.supabase.rpc("lya_exec_sql", { p_sql: sql, p_limit: 300 });
    if (error) throw new Error(`Não consegui listar os agentes: ${String(error.message || "").slice(0, 200)}`);
    return `Fonte: banco de dados (lya_agentes)\n${clip(data ?? [])}`;
  },
};

// ── Base de Suporte ─────────────────────────────────────────────────────────

const buscarBaseSuporte: AgentTool = {
  name: "buscar_base_suporte",
  origem: "base",
  description:
    "Busca na BASE DE SUPORTE (conteúdo editado pela gestora): produtos do painel E-mail (nome, função, URL, estrutura, plataforma, " +
    "bônus, nicho, número de SMS, links), brands do painel SMS (nome, como aparece no sistema, número) e respostas prontas de SMS " +
    "(categoria, título, texto EN/PT). Passe um termo (nome do produto, brand, palavra da resposta). Até 10 itens por painel.",
  input_schema: {
    type: "object",
    properties: { termo: { type: "string", description: "Termo de busca (nome do produto/brand, categoria ou palavra do texto)." } },
    required: ["termo"],
  },
  async execute(input, ctx) {
    const termo = texto(input.termo).replace(/[%,()]/g, " ").trim();
    if (!termo) throw new Error("'termo' é obrigatório.");
    const like = `%${termo}%`;
    const [produtos, brands, respostas] = await Promise.all([
      ctx.supabase.from("support_products")
        .select("nome, funcao, url, estrutura, plataforma, bonus_url, bonus_tipo, nicho, sms_number, links, ativo")
        .or(`nome.ilike.${like},funcao.ilike.${like},plataforma.ilike.${like},nicho.ilike.${like}`)
        .order("nome").limit(10),
      ctx.supabase.from("support_sms_brands")
        .select("nome, sistema, estrutura, sms_number, ativo")
        .or(`nome.ilike.${like},sistema.ilike.${like}`)
        .order("nome").limit(10),
      ctx.supabase.from("support_sms_replies")
        .select("categoria, titulo, texto_en, texto_pt, ativo")
        .or(`titulo.ilike.${like},categoria.ilike.${like},texto_pt.ilike.${like},texto_en.ilike.${like}`)
        .order("categoria").limit(10),
    ]);
    const erro = produtos.error || brands.error || respostas.error;
    if (erro) throw new Error(`Base de Suporte indisponível: ${String(erro.message || "").slice(0, 200)}`);
    const total = (produtos.data?.length ?? 0) + (brands.data?.length ?? 0) + (respostas.data?.length ?? 0);
    if (total === 0) return `Fonte: Base de Suporte — nenhum item contém "${termo}". Tente um termo mais curto ou outra grafia.`;
    return `Fonte: Base de Suporte (busca por "${termo}")\n` +
      clip({ produtos_email: produtos.data ?? [], brands_sms: brands.data ?? [], respostas_sms: respostas.data ?? [] });
  },
};

// ── Gráfico (artefato para a UI) ────────────────────────────────────────────

const CHART_PROPERTIES = {
  tipo: {
    type: "string",
    enum: ["barras", "linha", "area", "pizza"],
    description: "'linha'/'area' para evolução no tempo, 'barras' para comparar categorias, 'pizza' para participação em um total (UMA série).",
  },
  titulo: { type: "string", description: "Título do gráfico." },
  subtitulo: { type: "string", description: "Opcional. Período/recorte/unidade abaixo do título." },
  eixo_x: { type: "string", description: "Opcional. Rótulo do eixo X." },
  eixo_y: { type: "string", description: "Opcional. Rótulo/unidade do eixo Y." },
  categorias: { type: "array", items: { type: "string" }, description: "Rótulos do eixo X em ordem (dias, agentes, produtos, canais). Para pizza, as fatias." },
  series: {
    type: "array",
    description: "Uma ou mais séries; cada 'valores' com o mesmo tamanho e ordem de 'categorias'. Pizza: exatamente UMA série.",
    items: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome da série (legenda)." },
        valores: { type: "array", items: { type: "number" }, description: "Valores numéricos alinhados a 'categorias'." },
      },
      required: ["nome", "valores"],
    },
  },
};

export function normalizeChart(raw: unknown): ChartSpec {
  const o = (raw ?? {}) as Record<string, unknown>;
  const tipo = String(o.tipo || "").trim();
  if (!["barras", "linha", "area", "pizza"].includes(tipo)) throw new Error(`tipo inválido: "${tipo}". Use barras, linha, area ou pizza.`);
  const titulo = String(o.titulo || "").trim();
  if (!titulo) throw new Error("'titulo' é obrigatório.");
  const categorias = Array.isArray(o.categorias) ? o.categorias.map((c) => String(c)) : [];
  if (categorias.length === 0) throw new Error("'categorias' não pode ser vazio.");
  const series = (Array.isArray(o.series) ? o.series : [])
    .map((s) => {
      const so = (s ?? {}) as Record<string, unknown>;
      const valores = (Array.isArray(so.valores) ? so.valores : []).map((v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      });
      return { nome: String(so.nome || "Série").trim(), valores: categorias.map((_, i) => valores[i] ?? 0) };
    })
    .filter((s) => s.nome);
  if (series.length === 0) throw new Error("'series' precisa de ao menos uma série com valores.");
  return {
    tipo: tipo as ChartSpec["tipo"],
    titulo,
    subtitulo: o.subtitulo ? String(o.subtitulo).trim() : undefined,
    eixoX: o.eixo_x ? String(o.eixo_x).trim() : undefined,
    eixoY: o.eixo_y ? String(o.eixo_y).trim() : undefined,
    categorias,
    series: tipo === "pizza" ? series.slice(0, 1) : series,
  };
}

const gerarGrafico: AgentTool = {
  name: "gerar_grafico",
  origem: null,
  description:
    "Renderiza um gráfico (barras, linha, área ou pizza) na conversa a partir de séries numéricas. Seja PROATIVA: use sempre que a " +
    "resposta tiver números comparáveis, mesmo sem pedirem. Primeiro obtenha os valores com as tools de painel/banco (nunca invente) " +
    "e então chame esta tool. Continue explicando em texto — comente só os destaques, não repita todos os números.",
  input_schema: { type: "object", properties: CHART_PROPERTIES, required: ["tipo", "titulo", "categorias", "series"] },
  async execute(input, ctx) {
    let chart: ChartSpec;
    try {
      chart = normalizeChart(input);
    } catch (err) {
      return `Erro ao montar o gráfico: ${err instanceof Error ? err.message : "dados inválidos"}.`;
    }
    ctx.onChart?.(chart);
    return `Gráfico "${chart.titulo}" (${chart.tipo}) renderizado na conversa. Comente os destaques em texto.`;
  },
};

// ── Modo treino: gravar memória ─────────────────────────────────────────────

// Vocabulário da gestora (enum da tool) -> taxonomia do cérebro. Correção e
// preferência são REGRA de comportamento e só feedback/user entram em todas as
// respostas — por isso as duas caem em feedback.
const TIPO_MEMORIA: Record<string, string | undefined> = {
  correcao: "feedback",
  preferencia: "feedback",
  fato: "nota",
  nota: "nota",
};

export function slugify(s: string, n = 60): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, n);
}

// Refina (treinador) e grava pelo RPC — usado pela tool e pela ação
// `memoria_salvar` da tela Cérebro. O guard is_manager() fica no banco.
export async function salvarMemoriaNoCerebro(
  ctx: ToolContext,
  entrada: { name?: string; description: string; body: string; tags?: string[]; type?: string | null; refinar?: boolean },
): Promise<MemoriaArtifact & { body: string }> {
  let type = entrada.type && (TIPOS_VALIDOS as readonly string[]).includes(entrada.type) ? entrada.type : null;
  let description = entrada.description.trim();
  let body = (entrada.body || "").trim();
  let tags = (entrada.tags || []).map((t) => String(t).trim()).filter(Boolean);

  if (entrada.refinar !== false || !type) {
    const refinada = await refinarMemoria(description, body, tags, type, ctx.signal);
    if (refinada) {
      type = refinada.type;
      description = refinada.description;
      body = refinada.body;
      tags = refinada.tags;
    }
  }

  const { data, error } = await ctx.supabase.rpc("lya_upsert_memory", {
    p_name: entrada.name ? slugify(entrada.name) : "",
    p_description: description,
    p_type: type || "nota",
    p_tags: tags,
    p_body: body,
  });
  if (error) {
    const msg = String(error.message || "");
    if (/forbidden|42501/i.test(msg)) throw new Error("Só a gestora pode treinar a Lya.");
    throw new Error(`Falha ao gravar a memória: ${msg.slice(0, 200)}`);
  }
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    name: String(row.name ?? ""),
    description: String(row.description ?? description),
    type: String(row.type ?? type ?? "nota"),
    tags: Array.isArray(row.tags) ? (row.tags as unknown[]).map(String) : tags,
    body: String(row.body ?? body),
  };
}

const salvarMemoria: AgentTool = {
  name: "salvar_memoria",
  origem: null,
  description:
    "MODO TREINO: grava um ensinamento, correção ou preferência da gestora no cérebro da Lya, para ela lembrar em conversas " +
    "futuras. Extraia da mensagem uma 'descricao' curta (título) e o 'corpo' completo (a regra/correção/fato, com o porquê e como " +
    "aplicar). Não invente além do que a gestora disse. Depois de salvar, confirme em 1 frase o que foi aprendido.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Opcional. Slug EXATO de uma memória existente que esta mensagem corrige/refina (veja 'MEMÓRIAS QUE VOCÊ JÁ TEM'). Omita para conhecimento novo.",
      },
      descricao: { type: "string", description: "Resumo em uma linha do que aprender (vira o título)." },
      corpo: { type: "string", description: "Conteúdo completo: a regra/correção/fato, com contexto, o porquê e como aplicar." },
      tipo: {
        type: "string",
        enum: ["correcao", "preferencia", "fato", "nota"],
        description: "Opcional. correcao=corrige um erro; preferencia=regra de como responder (inclui formato de relatório); fato=informação do suporte; nota=avulso.",
      },
      tags: { type: "array", items: { type: "string" }, description: "Opcional. Palavras-chave para recuperar a memória depois." },
    },
    required: ["descricao", "corpo"],
  },
  async execute(input, ctx) {
    const descricao = texto(input.descricao), corpo = texto(input.corpo);
    if (!descricao || !corpo) return "Erro: 'descricao' e 'corpo' são obrigatórios para gravar a memória.";
    const row = await salvarMemoriaNoCerebro(ctx, {
      name: input.name ? String(input.name) : undefined,
      description: descricao,
      body: corpo,
      tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
      type: TIPO_MEMORIA[String(input.tipo ?? "")] ?? null,
      refinar: true,
    });
    ctx.onMemory?.({ name: row.name, description: row.description, type: row.type, tags: row.tags });
    return `Memória "${row.name}" (tipo: ${row.type}) gravada no cérebro da Lya. Confirme à gestora em uma frase curta o que foi aprendido.`;
  },
};

// ── Exports ─────────────────────────────────────────────────────────────────

export const TOOLS: AgentTool[] = [
  painelAtendimentos, painelStatusTickets, painelCanais, painelInteracoes, painelPadraoHorarios, painelRepeticoes,
  painelReembolsos, painelReembolsosMotivo, painelAlertas, painelUsuarios, painelPedidosEspera,
  listarAtendimentos, listarReembolsos, listarAgentes, consultarBanco, buscarBaseSuporte, gerarGrafico,
];

const TOOL_MAP = new Map([...TOOLS, salvarMemoria].map((t) => [t.name, t]));

export function getTool(name: string): AgentTool | undefined {
  return TOOL_MAP.get(name);
}

export function anthropicToolDefs() {
  return TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}

export function anthropicTrainingToolDefs() {
  return [salvarMemoria].map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}
