-- =====================================================================
-- 30-levantamento.sql — extração do schema REAL de produção
-- Projeto: kjkyyqxqrqsdozjyyuon
-- SOMENTE LEITURA. Nenhuma instrução aqui escreve.
-- Rode uma consulta por requisição (o endpoint devolve só a última).
-- =====================================================================

-- 1. Tabelas: tamanho, RLS, contagem estimada (reltuples, NÃO count(*))
SELECT c.relname AS tbl, c.relkind, c.relrowsecurity AS rls,
       c.reltuples::bigint AS est_rows,
       pg_total_relation_size(c.oid) AS total_bytes,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_pretty
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p','f')
ORDER BY pg_total_relation_size(c.oid) DESC;

-- 2. Colunas (agregadas por tabela para caber na resposta)
SELECT c.table_name,
  string_agg(
    c.ordinal_position || '|' || c.column_name || '|' || c.data_type
    || coalesce('('||c.character_maximum_length||')','')
    || '|' || (CASE WHEN c.is_nullable='YES' THEN 'NULL' ELSE 'NOTNULL' END)
    || '|def=' || coalesce(replace(c.column_default, chr(10),' '),'-')
    || '|id='  || coalesce(c.identity_generation,'-')
    || '|gen=' || coalesce(c.generation_expression,'-')
  , E'\n' ORDER BY c.ordinal_position) AS cols
FROM information_schema.columns c
JOIN pg_class pc ON pc.relname = c.table_name
JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
WHERE c.table_schema = 'public'
GROUP BY c.table_name ORDER BY c.table_name;

-- 3. Constraints (p=PK, f=FK, u=UNIQUE, c=CHECK)
SELECT rel.relname AS tbl, con.conname, con.contype,
       pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
ORDER BY rel.relname, con.contype, con.conname;

-- 4. Índices
SELECT tablename AS tbl, indexname, indexdef
FROM pg_indexes WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 5. Triggers (tgenabled 'O' = habilitada)
SELECT rel.relname AS tbl, t.tgname, t.tgenabled,
       pg_get_triggerdef(t.oid) AS def
FROM pg_trigger t
JOIN pg_class rel ON rel.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal
ORDER BY rel.relname, t.tgname;

-- 6. Funções
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS result,
       p.prosecdef AS secdef,
       CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE'
                          WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END AS vol,
       coalesce(array_to_string(p.proconfig,','),'-') AS cfg,
       l.lanname AS lang
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
ORDER BY p.proname, args;

-- 6b. Corpo de uma função específica
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'lya_exec_sql';

-- 7. Policies RLS
SELECT tablename AS tbl, policyname, cmd, array_to_string(roles,',') AS roles,
       coalesce(qual,'-') AS using_expr,
       coalesce(with_check,'-') AS check_expr, permissive
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- 8. GRANTs de tabela por role + nº de policies
SELECT c.relname AS tbl,
  string_agg(DISTINCT g.grantee||':'||g.privilege_type, ' '
             ORDER BY g.grantee||':'||g.privilege_type) AS grants,
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname='public' AND p.tablename=c.relname) AS n_pol
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
LEFT JOIN information_schema.role_table_grants g
  ON g.table_schema='public' AND g.table_name=c.relname
 AND g.grantee IN ('anon','authenticated','service_role','lya_sql_ro','PUBLIC')
WHERE c.relkind IN ('r','v')
GROUP BY c.relname ORDER BY c.relname;

-- 8b. ACL de funções sensíveis
SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS fn,
       coalesce(array_to_string(p.proacl,' '),'DEFAULT(PUBLIC)') AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('lya_exec_sql','manager_delete_auth_user','has_role','is_manager',
                    '_interaction_events','refresh_agent_daily_service_count')
ORDER BY p.proname;

-- 9. Enums
SELECT t.typname, n.nspname,
       string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS labels,
       (SELECT count(*) FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
         WHERE a.atttypid = t.oid AND NOT a.attisdropped
           AND a.attnum > 0 AND c.relkind = 'r') AS used_by_cols
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE n.nspname IN ('public','auth')
GROUP BY t.typname, n.nspname, t.oid ORDER BY n.nspname, t.typname;

-- 10. Roles do banco
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit,
  (SELECT string_agg(m.rolname,',') FROM pg_auth_members am
     JOIN pg_roles m ON m.oid = am.roleid WHERE am.member = r.oid) AS memberof
FROM pg_roles r
WHERE rolname IN ('anon','authenticated','service_role','lya_sql_ro','postgres','authenticator')
ORDER BY rolname;

-- 11. Views: security_invoker?  (reloptions NULL = roda como o dono, contorna RLS)
SELECT c.relname, coalesce(array_to_string(c.reloptions,','),'-') AS opts,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v';

-- 12. Registro de migrations aplicadas
SELECT version, coalesce(name,'-') AS name
FROM supabase_migrations.schema_migrations ORDER BY version;

-- 13. Frescor da tabela derivada (única leitura de tabela de negócio; 1.949 linhas)
SELECT max(updated_at) AS max_updated, min(updated_at) AS min_updated, count(*) AS rows,
       max(day) AS max_day, min(day) AS min_day,
       count(*) FILTER (WHERE updated_at > now() - interval '7 days') AS touched_7d,
       count(*) FILTER (WHERE updated_at > now() - interval '1 day')  AS touched_1d
FROM agent_daily_service_counts;
