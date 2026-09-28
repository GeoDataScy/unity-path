-- =====================================================================
-- 30-correcao-lya-agentes.sql
-- ESTE ARQUIVO ESCREVE. NÃO faz parte da fase de especificação.
-- Está aqui para o DONO DO PROJETO executar quando decidir — não foi
-- executado por nenhuma trilha.
--
-- Problema (ver 30-banco-estado-real.md, seções 1 e 9):
--   A view public.lya_agentes pertence a `postgres` e NÃO tem
--   security_invoker=true. Views sem essa opção são avaliadas com os
--   privilégios do dono, portanto ela contorna as 4 policies de
--   public.profiles. E `anon` tem SELECT na view.
--
--   Efeito: com a chave publishable e SEM login é possível ler
--   id, full_name, role, support_channel, is_active, is_available,
--   created_at de todos os perfis. Não vaza e-mail nem credencial,
--   vaza o quadro de pessoal.
--
-- Confirmar antes:
--   SELECT relname, reloptions, pg_get_userbyid(relowner)
--     FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='v';
--   -- espera-se: lya_agentes | NULL | postgres
-- =====================================================================

-- Opção A (recomendada) — a view passa a respeitar a RLS de profiles.
-- Quem consulta vê só o que suas policies permitem.
-- ATENÇÃO: isto pode QUEBRAR a Lya se ela depende de ler o quadro todo,
-- porque `lya_sql_ro` NÃO tem policy de leitura em profiles.
ALTER VIEW public.lya_agentes SET (security_invoker = true);

-- Se a opção A for escolhida e a Lya precisar do quadro, conceda
-- explicitamente — é o desenho coerente com as outras tabelas dela:
-- CREATE POLICY "lya_sql_ro read" ON public.profiles
--   FOR SELECT TO lya_sql_ro USING (true);

-- Opção B (mínima) — mantém o comportamento da view e só fecha o anônimo.
-- REVOKE SELECT ON public.lya_agentes FROM anon;

-- Verificar depois:
--   SELECT relname, reloptions FROM pg_class
--    WHERE relnamespace='public'::regnamespace AND relkind='v';
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema='public' AND table_name='lya_agentes';
