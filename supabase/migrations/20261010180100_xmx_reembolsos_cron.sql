-- Agenda a Edge Function xmx-refunds-sync a cada 15 minutos (pg_cron + pg_net).
--
-- O token NÃO fica aqui: o job lê do Vault o segredo 'xmx_refunds_sync_token',
-- que precisa ser criado UMA vez, com o mesmo valor do secret
-- XMX_REFUNDS_SYNC_TOKEN da função:
--   SELECT vault.create_secret('<token>', 'xmx_refunds_sync_token');
-- Sem o segredo, o job roda e a função responde 401 (nada é gravado).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'xmx-refunds-sync';

SELECT cron.schedule(
  'xmx-refunds-sync',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kjkyyqxqrqsdozjyyuon.supabase.co/functions/v1/xmx-refunds-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'xmx_refunds_sync_token'), '')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
