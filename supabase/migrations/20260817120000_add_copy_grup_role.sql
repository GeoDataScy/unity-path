-- Nova role para o time de copy.
--
-- Perfis com role = 'copy_grup' caem em /copy (CopyLayout) logo após o login e
-- não têm acesso às telas de agente (/workspace) nem às da gestora (/dashboard).
-- Como todas as RPCs de métricas filtram explicitamente `p.role = 'agent'`, o
-- novo valor não entra em nenhum número de atendimento/reembolso.
--
-- Atenção: o banco tem DOIS enums de role. `public.app_role` é o da migration
-- original (20260115171248) e hoje está órfão — nenhuma coluna o usa. O tipo
-- que vale é `public."AppRole"` (camelCase, com aspas), usado por
-- profiles.role, user_roles.role e has_role(). Os dois são alterados aqui para
-- não deixar a divergência crescer.
--
-- ALTER TYPE ... ADD VALUE precisa ficar sozinho na migration: o novo rótulo só
-- pode ser usado por outras instruções depois que a transação que o criou
-- comita.
ALTER TYPE public."AppRole" ADD VALUE IF NOT EXISTS 'copy_grup';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'copy_grup';
