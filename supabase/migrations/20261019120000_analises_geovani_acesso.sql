-- Área "Análises Geovani" (/analises): flag de acesso + helper.
--
-- Nesta fase a tela fica "Em construção" e não há dado nenhum: esta migration
-- só cria a capacidade de ENXERGAR a área. As tabelas (relatórios/notebooks,
-- dúvidas, mapeamento do banco XMX) vêm numa migration própria — o desenho está
-- em docs/analises-geovani/ARQUITETURA-BANCO.md.
--
-- Segue o vocabulário de capacidades do projeto (uma boolean por capacidade,
-- nomeada pelo que ela permite), igual a can_access_analytics (20261006120000)
-- e can_claim_tickets (20260716130000). Nada é ligado aqui: quem recebe a flag
-- está em docs/analises-geovani/LIBERAR-ACESSO.sql, rodado à parte.
--
-- Quem pode mudar a flag: só SQL (Management API / service_role). profiles não
-- tem policy de UPDATE para authenticated em nenhuma migration do repo — com
-- RLS ligada, isso significa que nenhum usuário consegue dar UPDATE nem no
-- próprio perfil (é assim que can_view_all_tickets e can_access_analytics já
-- ficam protegidas). O bloco no fim desta migration confere isso no banco em
-- que ela rodar e avisa se alguém criou uma policy de UPDATE fora do repo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Coluna
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_view_geovani_analyses boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.can_view_geovani_analyses IS
  'Pode entrar na área Análises Geovani (/analises): mapeamento do banco de vendas XMX, dúvidas e relatórios. Ligada só por SQL; conta desativada perde o acesso mesmo com a flag ligada.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Helper lido server-side (RLS das tabelas futuras e guards de RPC)
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER para não depender da RLS de profiles de quem chama.
-- profiles.id é text: compara com auth.uid()::text. (SELECT auth.uid()) deixa o
-- Postgres avaliar o uid uma vez só (ver 20260727120000_rls_initplan_optimization).
-- Conta desativada (is_active = false) não passa, mesmo com a flag ligada.
CREATE OR REPLACE FUNCTION public.can_view_geovani_analyses()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())::text
      AND p.can_view_geovani_analyses
      AND p.is_active
  );
$$;

COMMENT ON FUNCTION public.can_view_geovani_analyses() IS
  'true se o usuário logado tem profiles.can_view_geovani_analyses e a conta está ativa. Usar nas policies como (SELECT public.can_view_geovani_analyses()).';

REVOKE ALL ON FUNCTION public.can_view_geovani_analyses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_geovani_analyses() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Conferência: ninguém pode ligar a própria flag
-- ─────────────────────────────────────────────────────────────────────────────
-- Não muda nada; só avisa. Se aparecer o WARNING, existe uma policy de
-- UPDATE/ALL em profiles criada fora das migrations (painel do Supabase/Lovable)
-- e o usuário conseguiria se dar esta flag — e também role = 'manager', que é
-- um buraco bem maior. Nesse caso, corrigir a policy antes de liberar a área.
DO $$
DECLARE
  v_policies text;
BEGIN
  SELECT string_agg(format('%I (%s)', pol.polname,
           CASE pol.polcmd WHEN 'w' THEN 'UPDATE' ELSE 'ALL' END), ', ')
    INTO v_policies
    FROM pg_policy pol
   WHERE pol.polrelid = 'public.profiles'::regclass
     AND pol.polcmd IN ('w', '*');

  IF v_policies IS NOT NULL THEN
    RAISE WARNING 'profiles tem policy de UPDATE/ALL: %. Conferir se um usuário consegue alterar can_view_geovani_analyses no próprio perfil.', v_policies;
  END IF;
END $$;
