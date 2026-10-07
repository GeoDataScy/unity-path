import { useMemo, useState } from "react";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useOutletContext } from "react-router-dom";
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  Circle,
  Coffee,
  FileText,
  Inbox,
  LogIn,
  LogOut,
  Search,
  ShieldOff,
  Trash2,
  UserCheck,
  UserCog,
  Users,
  UserX,
} from "lucide-react";

import type { ManagerOutletContext } from "@/layouts/ManagerLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { roleLabel } from "@/lib/roles";
import {
  type ManagerUser,
  useDeleteAuthUserMutation,
  useManagerUsersQuery,
  useSetAgentAvailabilityMutation,
  useSetUserActiveMutation,
} from "@/features/dashboard/useManagerUsersQuery";
import { ReassignTicketsDialog } from "@/features/dashboard/ReassignTicketsDialog";
import { ProviderContractDialog } from "@/features/sla/ProviderContractDialog";

type StatusFilter = "all" | "active" | "inactive" | "online" | "deleted";

function safeParseISO(value: string | null | undefined): Date | null {
  if (!value) return null;
  try {
    const dt = parseISO(value);
    return isNaN(dt.getTime()) ? null : dt;
  } catch {
    return null;
  }
}

function formatRelative(value: string | null | undefined): string {
  const dt = safeParseISO(value);
  if (!dt) return "—";
  return formatDistanceToNowStrict(dt, { addSuffix: true, locale: ptBR });
}

function formatAbsolute(value: string | null | undefined): string {
  const dt = safeParseISO(value);
  if (!dt) return "—";
  return dt.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusDot({ user }: { user: ManagerUser }) {
  if (user.auth_account_deleted) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldOff className="h-3 w-3" />
            Conta excluída
          </span>
        </TooltipTrigger>
        <TooltipContent>Login removido. Histórico preservado.</TooltipContent>
      </Tooltip>
    );
  }
  if (!user.is_active) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1.5 text-xs text-warning">
            <Circle className="h-2.5 w-2.5 fill-current" />
            Inativo
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {user.deactivated_at
            ? `Desde ${formatAbsolute(user.deactivated_at)}${user.deactivated_by_email ? ` • por ${user.deactivated_by_email}` : ""}`
            : "Acesso bloqueado"}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (user.is_online) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-success">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
        Online
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Circle className="h-2.5 w-2.5" />
          Offline
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {user.last_seen_at ? `Visto ${formatRelative(user.last_seen_at)}` : "Nunca visto"}
      </TooltipContent>
    </Tooltip>
  );
}

export default function DashboardUsers() {
  // useOutletContext is invoked so the page is consistent with the others, but
  // the global filters (period/agent) don't apply here.
  useOutletContext<ManagerOutletContext>();

  const { toast } = useToast();
  const usersQuery = useManagerUsersQuery();
  const setActive = useSetUserActiveMutation();
  const setAvailability = useSetAgentAvailabilityMutation();
  const deleteAuth = useDeleteAuthUserMutation();

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ManagerUser | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [reassignTarget, setReassignTarget] = useState<ManagerUser | null>(null);
  const [contractTarget, setContractTarget] = useState<ManagerUser | null>(null);

  const users = usersQuery.data ?? [];

  const counts = useMemo(() => {
    return {
      total: users.length,
      active: users.filter((u) => u.is_active && !u.auth_account_deleted).length,
      inactive: users.filter((u) => !u.is_active && !u.auth_account_deleted).length,
      online: users.filter((u) => u.is_online && u.is_active).length,
      deleted: users.filter((u) => u.auth_account_deleted).length,
    };
  }, [users]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((u) => {
      if (filter === "active" && (!u.is_active || u.auth_account_deleted)) return false;
      if (filter === "inactive" && (u.is_active || u.auth_account_deleted)) return false;
      if (filter === "online" && !u.is_online) return false;
      if (filter === "deleted" && !u.auth_account_deleted) return false;
      if (!term) return true;
      const hay = `${u.full_name ?? ""} ${u.email}`.toLowerCase();
      return hay.includes(term);
    });
  }, [users, filter, search]);

  const handleToggleActive = async (user: ManagerUser) => {
    try {
      await setActive.mutateAsync({ userId: user.id, active: !user.is_active });
      toast({
        title: user.is_active ? "Usuário inativado" : "Usuário reativado",
        description: user.full_name ?? user.email,
      });
    } catch (e) {
      toast({
        title: "Erro",
        description: e instanceof Error ? e.message : "Não foi possível atualizar.",
        variant: "destructive",
      });
    }
  };

  const handleToggleAvailability = async (user: ManagerUser) => {
    try {
      await setAvailability.mutateAsync({ userId: user.id, available: !user.is_available });
      toast({
        title: user.is_available ? "Marcado como de folga" : "Marcado como disponível",
        description: user.full_name ?? user.email,
      });
    } catch (e) {
      toast({
        title: "Erro",
        description: e instanceof Error ? e.message : "Não foi possível atualizar.",
        variant: "destructive",
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteAuth.mutateAsync({
        userId: deleteTarget.id,
        confirmEmail: confirmEmail.trim(),
      });
      toast({
        title: "Conta excluída",
        description: `${deleteTarget.email} foi removido do login. Histórico preservado.`,
      });
      setDeleteTarget(null);
      setConfirmEmail("");
    } catch (e) {
      toast({
        title: "Erro ao excluir",
        description: e instanceof Error ? e.message : "Não foi possível excluir.",
        variant: "destructive",
      });
    }
  };

  const emailMatches =
    deleteTarget !== null &&
    confirmEmail.trim().toLowerCase() === deleteTarget.email.toLowerCase();

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[15px] text-ink-tertiary">Administração</p>
            <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.025em]">Usuários</h1>
            <p className="text-sm text-muted-foreground">
              Gerencie acesso, inative ou exclua contas. O histórico (atendimentos, reembolsos) é sempre preservado.
            </p>
          </div>
        </header>

        {/* Pedidos em Espera saiu daqui: tem página própria em /dashboard/pedidos-espera. */}
        <div className="space-y-6">
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-ink-tertiary flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" /> Total de usuários
              </CardTitle>
            </CardHeader>
            <CardContent>
              {usersQuery.isLoading ? <Skeleton className="h-8 w-16" /> : <div className="font-mono text-[32px] font-normal leading-9 tracking-[-0.03em] tabular-nums">{counts.total}</div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-ink-tertiary flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" /> Ativos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {usersQuery.isLoading ? <Skeleton className="h-8 w-16" /> : <div className="font-mono text-[32px] font-normal leading-9 tracking-[-0.03em] tabular-nums">{counts.active}</div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-ink-tertiary flex items-center gap-2">
                <UserX className="h-4 w-4 text-warning" /> Inativos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {usersQuery.isLoading ? <Skeleton className="h-8 w-16" /> : <div className="font-mono text-[32px] font-normal leading-9 tracking-[-0.03em] tabular-nums">{counts.inactive}</div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-ink-tertiary flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-success" />
                </span>
                Online agora
              </CardTitle>
            </CardHeader>
            <CardContent>
              {usersQuery.isLoading ? <Skeleton className="h-8 w-16" /> : <div className="font-mono text-[32px] font-normal leading-9 tracking-[-0.03em] tabular-nums">{counts.online}</div>}
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Lista de usuários</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nome ou e-mail..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-64 pl-8"
                  />
                </div>
                <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="active">Ativos</SelectItem>
                    <SelectItem value="online">Online agora</SelectItem>
                    <SelectItem value="inactive">Inativos</SelectItem>
                    <SelectItem value="deleted">Conta excluída</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {usersQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : usersQuery.isError ? (
              <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                <AlertCircle className="h-6 w-6" />
                <p>Não foi possível carregar os usuários.</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">Nenhum usuário encontrado.</div>
            ) : (
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">Status</TableHead>
                      <TableHead>Usuário</TableHead>
                      <TableHead>Papel</TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          <Inbox className="h-3.5 w-3.5" /> Em aberto
                        </span>
                      </TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          <LogIn className="h-3.5 w-3.5" /> Último login
                        </span>
                      </TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          <LogOut className="h-3.5 w-3.5" /> Última saída
                        </span>
                      </TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((user) => {
                      const isManager = user.role === "manager";
                      const isAgent = user.role === "agent";
                      const isDeleted = user.auth_account_deleted;
                      // Redistribuir vale para qualquer agente com tickets em aberto,
                      // inclusive contas já excluídas no auth (ex.: Aguida, Maria) —
                      // só assim esses tickets "presos" voltam a ter um dono ativo.
                      const reassignButton =
                        isAgent && user.open_tickets_count > 0 ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setReassignTarget(user)}
                            title="Redistribuir tickets em aberto"
                          >
                            <Inbox className="mr-1.5 h-3.5 w-3.5" /> Redistribuir
                          </Button>
                        ) : null;
                      return (
                        <TableRow key={user.id} className={isDeleted ? "opacity-60" : ""}>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <StatusDot user={user} />
                              {isAgent && !isDeleted && !user.is_available && (
                                <span className="inline-flex w-fit items-center gap-1 rounded-full bg-ice-soft px-1.5 py-0.5 text-[10px] font-medium text-info">
                                  <Coffee className="h-2.5 w-2.5" />
                                  De folga
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{user.full_name ?? "Sem nome"}</span>
                              <span className="text-xs text-muted-foreground">{user.email}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={isManager ? "default" : "secondary"} className="capitalize">
                              {roleLabel(user.role)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {!isAgent ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-col items-start gap-1">
                                {user.open_tickets_count > 0 ? (
                                  <Badge
                                    variant={user.is_active ? "outline" : "destructive"}
                                    className="font-mono tabular-nums"
                                  >
                                    {user.open_tickets_count}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">0</span>
                                )}
                                {user.authorized_open_count > 0 && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-signal-soft px-1.5 py-0.5 text-[10px] font-medium text-success">
                                        <BadgeCheck className="h-2.5 w-2.5" />
                                        {user.authorized_open_count} autorizado{user.authorized_open_count > 1 ? "s" : ""}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      Tickets assumidos com autorização da gestora (dono estava de folga).
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-sm">{formatRelative(user.last_sign_in_at)}</span>
                              </TooltipTrigger>
                              <TooltipContent>{formatAbsolute(user.last_sign_in_at)}</TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-sm">{formatRelative(user.last_logout_at)}</span>
                              </TooltipTrigger>
                              <TooltipContent>{formatAbsolute(user.last_logout_at)}</TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="text-right">
                            {isDeleted ? (
                              reassignButton ?? (
                                <span className="text-xs text-muted-foreground italic">Sem ações disponíveis</span>
                              )
                            ) : (
                              <div className="inline-flex items-center gap-2">
                                {reassignButton}
                                {isAgent && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setContractTarget(user)}
                                    title="Pacote, capacidade e aderência do prestador"
                                  >
                                    <FileText className="mr-1.5 h-3.5 w-3.5" />
                                    Contrato
                                  </Button>
                                )}
                                {isAgent && (
                                  <Button
                                    variant={user.is_available ? "ghost" : "secondary"}
                                    size="sm"
                                    onClick={() => handleToggleAvailability(user)}
                                    disabled={setAvailability.isPending}
                                    title={
                                      user.is_available
                                        ? "Marcar como de folga/indisponível"
                                        : "Marcar como disponível"
                                    }
                                    className={user.is_available ? "" : "text-info"}
                                  >
                                    <Coffee className="mr-1.5 h-3.5 w-3.5" />
                                    {user.is_available ? "De folga" : "Disponível"}
                                  </Button>
                                )}
                                <Button
                                  variant={user.is_active ? "outline" : "default"}
                                  size="sm"
                                  onClick={() => handleToggleActive(user)}
                                  disabled={setActive.isPending || isManager}
                                  title={isManager ? "Managers não podem ser inativados aqui." : ""}
                                >
                                  {user.is_active ? (
                                    <>
                                      <UserX className="mr-1.5 h-3.5 w-3.5" /> Inativar
                                    </>
                                  ) : (
                                    <>
                                      <UserCheck className="mr-1.5 h-3.5 w-3.5" /> Reativar
                                    </>
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => {
                                    setDeleteTarget(user);
                                    setConfirmEmail("");
                                  }}
                                  disabled={isManager}
                                  title={isManager ? "Managers não podem ser excluídos aqui." : ""}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        </div>

        <ReassignTicketsDialog
          open={reassignTarget !== null}
          onOpenChange={(open) => {
            if (!open) setReassignTarget(null);
          }}
          sourceAgent={reassignTarget}
          allUsers={users}
        />

        <ProviderContractDialog
          open={contractTarget !== null}
          onOpenChange={(open) => {
            if (!open) setContractTarget(null);
          }}
          provider={contractTarget}
        />

        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteTarget(null);
              setConfirmEmail("");
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <UserCog className="h-5 w-5 text-destructive" />
                Excluir conta de login
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm">
                  <p>
                    Esta ação remove o acesso de <span className="font-medium">{deleteTarget?.full_name ?? deleteTarget?.email}</span> ao sistema.
                  </p>
                  <p className="rounded-md border border-success/40 bg-signal-soft px-3 py-2 text-success">
                    O histórico (atendimentos, reembolsos, transferências) será <strong>preservado</strong>. Apenas a conta de login é removida.
                  </p>
                  <p>Para confirmar, digite o e-mail do usuário abaixo:</p>
                  <code className="block rounded bg-muted px-2 py-1 text-xs">{deleteTarget?.email}</code>
                  <Input
                    autoFocus
                    placeholder="Digite o e-mail aqui"
                    value={confirmEmail}
                    onChange={(e) => setConfirmEmail(e.target.value)}
                  />
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteAuth.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={!emailMatches || deleteAuth.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  handleConfirmDelete();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteAuth.isPending ? "Excluindo..." : "Excluir definitivamente"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
