// Roles do app (enum public."AppRole" no banco) e a quais ÁREAS cada uma dá
// acesso. Centralizado aqui para que login, "/", a tela de escolha de área e os
// três layouts concordem sobre o destino e a permissão de cada perfil.
//
// Áreas != roles. Hoje existem três áreas de produto:
//   workspace  -> /workspace  (o agente trabalhando os tickets)
//   analytics  -> /dashboard  (Data Analytics do Suporte)
//   copy       -> /copy       (time de copy)
//
// Gestora e copy enxergam DUAS áreas cada. Quem tem mais de uma área não cai
// direto numa delas depois do login: cai em /areas e escolhe (ver AreaSelect).
// A ordem do array é significativa — a primeira área é a "casa" do perfil e é
// o destino quando não há escolha a fazer.

export type AppRole = "agent" | "manager" | "copy_grup";

export type AppArea = "workspace" | "analytics" | "copy";

/** Tela de escolha de área, para quem tem acesso a mais de uma. */
export const AREA_CHOICE_PATH = "/areas";

export const AREA_PATH: Record<AppArea, string> = {
  workspace: "/workspace",
  analytics: "/dashboard",
  copy: "/copy",
};

/** Nome da área como o usuário fala dela. */
export const AREA_LABEL: Record<AppArea, string> = {
  workspace: "Meus Atendimentos",
  analytics: "Data Analytics do Suporte",
  copy: "Área de Copy",
};

/** Versão curta, para caber na sidebar. */
export const AREA_SHORT_LABEL: Record<AppArea, string> = {
  workspace: "Atendimentos",
  analytics: "Data Analytics",
  copy: "Copy",
};

const ROLE_AREAS: Record<AppRole, readonly AppArea[]> = {
  manager: ["analytics", "copy"],
  copy_grup: ["copy", "analytics"],
  agent: ["workspace"],
};

/** Última área escolhida (só conveniência de UI — não é permissão). */
export const LAST_AREA_KEY = "xmx-last-area";

export function areasForRole(role: string | null | undefined): readonly AppArea[] {
  return ROLE_AREAS[role as AppRole] ?? ROLE_AREAS.agent;
}

export function canAccessArea(role: string | null | undefined, area: AppArea): boolean {
  return areasForRole(role).includes(area);
}

/** true quando o perfil tem mais de uma área e portanto precisa escolher. */
export function hasAreaChoice(role: string | null | undefined): boolean {
  return areasForRole(role).length > 1;
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
  return value === "workspace" || value === "analytics" || value === "copy";
}
