-- Autovacuum agressivo nas tabelas pequenas e quentes de autorização.
--
-- `profiles` e `user_roles` têm 33 linhas cada, mas são lidas bilhões de vezes
-- porque is_manager()/can_view_all_tickets() as consultam a cada avaliação de
-- policy (ver 20260727120000_rls_initplan_optimization.sql). Estado encontrado
-- em produção em 27/07/2026:
--
--   profiles   : 33 live / 25 dead  — último autovacuum em 2026-03-10
--   user_roles : 33 live / 22 dead  — NUNCA passou por autovacuum
--
-- Com ~43% de tuplas mortas, cada leitura visita páginas inúteis. O default do
-- autovacuum (scale_factor 0.2 = 20% da tabela) exige ~7 linhas alteradas numa
-- tabela de 33 — parece pouco, mas o threshold mínimo (50) nunca é atingido,
-- então tabelas minúsculas ficam anos sem vacuum. Fixamos threshold baixo e
-- scale_factor 0 para que qualquer alteração dispare a limpeza.
--
-- Custo: irrelevante (tabelas de 8 kB). Benefício: as tabelas mais lidas do
-- banco ficam sempre compactas e com estatísticas atualizadas.

ALTER TABLE public.profiles SET (
  autovacuum_vacuum_scale_factor  = 0,
  autovacuum_vacuum_threshold     = 10,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold    = 10
);

ALTER TABLE public.user_roles SET (
  autovacuum_vacuum_scale_factor  = 0,
  autovacuum_vacuum_threshold     = 10,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold    = 10
);

-- Limpeza imediata do backlog acumulado (não espera o próximo ciclo).
-- VACUUM não pode rodar dentro de bloco de transação; o runner de migrations do
-- Supabase CLI envolve cada arquivo numa transação, então usamos apenas ANALYZE
-- aqui e deixamos o VACUUM para o autovacuum recém-configurado.
ANALYZE public.profiles;
ANALYZE public.user_roles;
