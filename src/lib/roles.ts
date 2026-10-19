// Roles do app (enum public."AppRole" no banco) e a quais ÁREAS cada uma dá
// acesso. Centralizado aqui para que login, "/", a tela de escolha de área e os
// três layouts concordem sobre o destino e a permissão de cada perfil.
//
// Áreas != roles. Hoje existem cinco áreas de produto:
//   workspace  -> /workspace  (o agente trabalhando os tickets)
//   analytics  -> /dashboard  (Data Analytics do Suporte)
//   copy       -> /copy       (time de copy)
//   produtos   -> /produtos   (time de produtos)
//   analises   -> /analises   (Análises Geovani: notebooks, relatórios e dúvidas)
//
// A área "analises" é a única que NÃO vem de role — nem a gestora entra por ser
// manager. Só a flag individual profiles.can_view_geovani_analyses libera, para
// qualquer role (ver AreaGrants). Lida à parte por
// src/features/analises/geovaniAnalysesGrant.ts, tolerante à coluna ainda não
// existir no banco.
//
// Gestão (gestora, copy e produtos) cai em /areas depois do login e vê os quatro
// cards — Data Analytics, Copy, Produtos e Análises Geovani —, mas só entra nos
// que o perfil permite; os demais respondem "Acesso negado" (ver areaCardsForRole). O agente
// vai direto para o workspace. A ordem do array de áreas é significativa — a
// primeira é a "casa" do perfil e é o destino quando não há escolha a fazer.

export type AppRole = "agent" | "manager" | "copy_grup" | "produto";

export type AppArea = "workspace" | "analytics" | "copy" | "produtos" | "analises";

/** Tela de escolha de área, para quem tem acesso a mais de uma. */
export const AREA_CHOICE_PATH = "/areas";

export const AREA_PATH: Record<AppArea, string> = {
  workspace: "/workspace",
  analytics: "/dashboard",
  copy: "/copy",
  produtos: "/produtos",
  analises: "/analises",
};

/** Nome da área como o usuário fala dela. */
export const AREA_LABEL: Record<AppArea, string> = {
  workspace: "Meus Atendimentos",
  analytics: "Data Analytics do Suporte",
  copy: "Área de Copy",
  produtos: "Área de Produtos",
  analises: "Análises Geovani",
};

/** Versão curta, para caber na sidebar. */
export const AREA_SHORT_LABEL: Record<AppArea, string> = {
  workspace: "Atendimentos",
  analytics: "Data Analytics",
  copy: "Copy",
  produtos: "Produtos",
  analises: "Análises",
};

// Acesso por perfil (decisão do dono, 02/10/2026): a gestora entra em tudo; copy
// e produtos, cada um só na sua área.
const ROLE_AREAS: Record<AppRole, readonly AppArea[]> = {
  manager: ["analytics", "copy", "produtos"],
  copy_grup: ["copy"],
  produto: ["produtos"],
  agent: ["workspace"],
};

// Os quatro cards de /areas aparecem para todos os perfis de gestão, tenham ou não
// acesso — o card sem acesso responde "Acesso negado". Mostrar um card NÃO dá
// acesso: quem decide é canAccessArea, e os layouts continuam barrando. O
// agente não passa por /areas: vai direto para o workspace.
const TODOS_OS_CARDS: readonly AppArea[] = ["analytics", "copy", "produtos", "analises"];
const ROLE_AREA_CARDS: Partial<Record<AppRole, readonly AppArea[]>> = {
  manager: TODOS_OS_CARDS,
  copy_grup: TODOS_OS_CARDS,
  produto: TODOS_OS_CARDS,
};

/** Como cada role aparece na tela de Usuários da gestora. */
const ROLE_LABEL: Record<AppRole, string> = {
  manager: "Manager",
  agent: "Agente",
  copy_grup: "Copy",
  produto: "Produtos",
};

/** Rótulo da role; role desconhecida cai em "Agente", igual ao mapa de áreas. */
export function roleLabel(role: string | null | undefined): string {
  return ROLE_LABEL[role as AppRole] ?? ROLE_LABEL.agent;
}

/** Última área escolhida (só conveniência de UI — não é permissão). */
export const LAST_AREA_KEY = "xmx-last-area";

/**
 * Liberações individuais por cima da role (colunas boolean em profiles):
 * - `can_access_analytics`: alguém do copy que, sozinho, também entra no Data
 *   Analytics — o resto do time continua só no Copy.
 * - `can_view_geovani_analyses`: única porta da área Análises Geovani, para
 *   qualquer role (inclusive manager — a role sozinha não basta).
 */
export type AreaGrants = { canAccessAnalytics?: boolean; canViewGeovaniAnalyses?: boolean };

export function areasForRole(
  role: string | null | undefined,
  grants?: AreaGrants,
): readonly AppArea[] {
  let areas: readonly AppArea[] = ROLE_AREAS[role as AppRole] ?? ROLE_AREAS.agent;
  if (grants?.canAccessAnalytics && !areas.includes("analytics")) {
    areas = [...areas, "analytics"];
  }
  // Sempre no fim: não muda a "casa" (primeira área) de ninguém.
  if (grants?.canViewGeovaniAnalyses && !areas.includes("analises")) {
    areas = [...areas, "analises"];
  }
  return areas;
}

/**
 * true quando a role existe no mapa deste bundle. Serve para separar "role de
 * outra área" de "role que o front ainda não conhece" — o banco pode ganhar uma
 * role nova (enum) antes do deploy do front, e nesse intervalo o fallback para
 * agente faria o guard do AgentLayout redirecionar para /workspace em loop.
 */
export function isKnownRole(role: string | null | undefined): boolean {
  return role != null && Object.prototype.hasOwnProperty.call(ROLE_AREAS, role);
}

export function canAccessArea(
  role: string | null | undefined,
  area: AppArea,
  grants?: AreaGrants,
): boolean {
  return areasForRole(role, grants).includes(area);
}

/** Cards da tela /areas. Por padrão, as próprias áreas do perfil. */
export function areaCardsForRole(role: string | null | undefined): readonly AppArea[] {
  return ROLE_AREA_CARDS[role as AppRole] ?? areasForRole(role);
}

/** true quando o perfil passa pela tela /areas depois do login. */
export function hasAreaChoice(role: string | null | undefined): boolean {
  return areaCardsForRole(role).length > 1;
}

/** Área "casa" do perfil — usada como destino quando não há escolha. */
export function defaultAreaForRole(role: string | null | undefined): AppArea {
  return areasForRole(role)[0];
}

/** Para onde o perfil vai depois do login (ou ao ser barrado em outra área). */
export function homePathForRole(role: string | null | undefined): string {
  if (hasAreaChoice(role)) return AREA_CHOICE_PATH;
  return AREA_PATH[defaultAreaForRole(role)];
}

export function isValidArea(value: string | null | undefined): value is AppArea {
  return (
    value === "workspace" ||
    value === "analytics" ||
    value === "copy" ||
    value === "produtos" ||
    value === "analises"
  );
}
