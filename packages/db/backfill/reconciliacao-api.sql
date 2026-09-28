-- =====================================================================
-- reconciliacao-api.sql — a mesma reconciliação, em SQL puro.
--
-- `reconciliacao.sql` usa `\set` e `RAISE NOTICE`, que são do psql: a
-- Management API do Supabase não os entende e recusa o arquivo inteiro.
-- Foi o que aconteceu ao aplicar em produção em 28/09/2026.
--
-- Esta versão devolve uma LINHA por verificação, com ok booleano e
-- detalhe, e funciona nos dois caminhos.
-- =====================================================================
WITH c AS (
  SELECT (SELECT count(*) FROM public.services)                                    AS svc,
         (SELECT count(*) FROM core.tickets WHERE legacy_id IS NOT NULL)           AS tk,
         (SELECT count(DISTINCT legacy_id) FROM core.migration_rejects WHERE source_table='services') AS tk_rej,
         (SELECT count(*) FROM public.service_follow_ups)                          AS fu,
         (SELECT count(*) FROM core.interactions WHERE legacy_id IS NOT NULL)      AS it,
         (SELECT count(DISTINCT legacy_id) FROM core.migration_rejects WHERE source_table='service_follow_ups') AS it_rej
)
SELECT * FROM (
  SELECT 1 ord, 'R1a atendimentos: legado = migrado + rejeitado' chk,
         (svc = tk + tk_rej) ok, format('%s = %s + %s', svc, tk, tk_rej) detalhe FROM c
  UNION ALL SELECT 2, 'R1b interacoes: legado = migrado + rejeitado',
         (fu = it + it_rej), format('%s = %s + %s', fu, it, it_rej) FROM c
  UNION ALL SELECT 3, 'R2a nenhum ticket trocou de id',
         (SELECT count(*) FROM core.tickets WHERE legacy_id IS NOT NULL AND id::text <> legacy_id)=0,
         (SELECT count(*)::text FROM core.tickets WHERE legacy_id IS NOT NULL AND id::text <> legacy_id)
  UNION ALL SELECT 4, 'R2b nenhuma interacao trocou de id',
         (SELECT count(*) FROM core.interactions WHERE legacy_id IS NOT NULL AND id::text <> legacy_id)=0,
         (SELECT count(*)::text FROM core.interactions WHERE legacy_id IS NOT NULL AND id::text <> legacy_id)
  UNION ALL SELECT 5, 'R3a texto original (data/plataforma/canal/status) intacto',
         (SELECT count(*) FROM core.tickets t JOIN public.services s ON s.id=t.legacy_id
           WHERE t.legacy_service_date IS DISTINCT FROM s.service_date
              OR t.legacy_platform IS DISTINCT FROM s.platform
              OR t.legacy_channel IS DISTINCT FROM s.channel
              OR t.legacy_status IS DISTINCT FROM s.status)=0,
         (SELECT count(*)::text FROM core.tickets t JOIN public.services s ON s.id=t.legacy_id
           WHERE t.legacy_service_date IS DISTINCT FROM s.service_date
              OR t.legacy_platform IS DISTINCT FROM s.platform
              OR t.legacy_channel IS DISTINCT FROM s.channel
              OR t.legacy_status IS DISTINCT FROM s.status)
  UNION ALL SELECT 6, 'R3b numero original da interacao preservado',
         (SELECT count(*) FROM core.interactions i JOIN public.service_follow_ups f ON f.id=i.legacy_id
           WHERE i.legacy_follow_up_number IS DISTINCT FROM f.follow_up_number)=0, ''
  UNION ALL SELECT 7, 'R4a "nao se aplica" e "nao preenchido" ambos existem',
         (SELECT count(*) FROM core.tickets t JOIN core.sales_platforms p ON p.id=t.platform_id WHERE p.kind='not_applicable')>0
         AND (SELECT count(*) FROM core.tickets WHERE platform_id IS NULL AND legacy_id IS NOT NULL)>0,
         format('%s nao-se-aplica / %s vazios',
           (SELECT count(*) FROM core.tickets t JOIN core.sales_platforms p ON p.id=t.platform_id WHERE p.kind='not_applicable'),
           (SELECT count(*) FROM core.tickets WHERE platform_id IS NULL AND legacy_id IS NOT NULL))
  UNION ALL SELECT 8, 'R4b "Nenhum" do legado nunca virou vazio',
         NOT EXISTS (SELECT 1 FROM core.tickets WHERE legacy_platform='Nenhum' AND platform_id IS NULL), ''
  UNION ALL SELECT 9, 'R4c vazio do legado nunca virou "Nenhum"',
         NOT EXISTS (SELECT 1 FROM core.tickets WHERE legacy_id IS NOT NULL
                      AND coalesce(btrim(legacy_platform),'')='' AND platform_id IS NOT NULL), ''
  UNION ALL SELECT 10, 'R5 concluido sem interacao NAO reabriu',
         (SELECT count(*) FROM core.tickets t WHERE t.legacy_status='concluido'
           AND NOT EXISTS (SELECT 1 FROM core.interactions i WHERE i.ticket_id=t.id)
           AND t.derived_status<>'concluido')=0,
         format('%s preservados como concluido',
           (SELECT count(*) FROM core.tickets t WHERE t.legacy_status='concluido'
             AND NOT EXISTS (SELECT 1 FROM core.interactions i WHERE i.ticket_id=t.id)))
  UNION ALL SELECT 11, 'R6 duplicatas de numeracao resolvidas sem apagar linha',
         (SELECT count(*) FROM (SELECT ticket_id,seq FROM core.interactions GROUP BY 1,2 HAVING count(*)>1) x)=0,
         format('%s pares duplicados no legado',
           (SELECT count(*) FROM (SELECT service_id,follow_up_number FROM public.service_follow_ups
                                   GROUP BY 1,2 HAVING count(*)>1) y))
  UNION ALL SELECT 12, 'R7 ultima interacao = a que a tela mostra hoje',
         (WITH ul AS (SELECT DISTINCT ON (service_id) service_id,id FROM public.service_follow_ups
                       ORDER BY service_id, recorded_at DESC, id DESC),
               un AS (SELECT DISTINCT ON (ticket_id) ticket_id,legacy_id FROM core.interactions
                       ORDER BY ticket_id, recorded_at DESC, seq DESC)
          SELECT count(*) FROM un JOIN core.tickets t ON t.id=un.ticket_id
            JOIN ul ON ul.service_id=t.legacy_id WHERE ul.id IS DISTINCT FROM un.legacy_id)=0, ''
  UNION ALL SELECT 13, 'R8 contagem por agente confere',
         (SELECT count(*) FROM (
            SELECT s.user_id, count(*) c FROM public.services s
             WHERE NOT EXISTS (SELECT 1 FROM core.migration_rejects r WHERE r.source_table='services' AND r.legacy_id=s.id)
             GROUP BY 1
            EXCEPT
            SELECT u.legacy_id, count(*) FROM core.tickets t JOIN core.users u ON u.id=t.creator_id
             WHERE t.legacy_id IS NOT NULL GROUP BY 1) d)=0, ''
) z ORDER BY ord;
