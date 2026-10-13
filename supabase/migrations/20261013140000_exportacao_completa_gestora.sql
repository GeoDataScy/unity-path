-- Exportação completa (ajuste 6): quem baixa dados pessoais de clientes é
-- todo usuário com role manager — decisão do dono em 13/10/2026. Substitui a
-- flag individual criada em 20261013120000_exportacao_restrita.sql, que nunca
-- chegou a ser ligada para ninguém.
CREATE OR REPLACE FUNCTION public.can_export_full_client_data()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_manager();
$$;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS can_export_full_client_data;

NOTIFY pgrst, 'reload schema';
