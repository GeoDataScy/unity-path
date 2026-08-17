// Roles do app (enum public.app_role no banco) e para onde cada uma entra
// depois do login. Centralizado aqui para que login, "/" e os três layouts
// concordem sobre o destino de cada perfil.

export type AppRole = "agent" | "manager" | "copy_grup";

export const ROLE_HOME: Record<AppRole, string> = {
  manager: "/dashboard",
  copy_grup: "/copy",
  agent: "/workspace",
};

export function homePathForRole(role: string | null | undefined): string {
  return ROLE_HOME[role as AppRole] ?? ROLE_HOME.agent;
}
