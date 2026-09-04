-- Auditoria (registros) do dashboard de atendimentos passa a listar o MESMO
-- universo que os cards e gráficos: uma linha por interação.
--
-- Sintoma relatado (02/09/2026): filtrando um único dia, o card "Total" mostrava
-- 887 e a tabela de auditoria 421 registros (01/09). Em todos os dias medidos a
-- tabela batia exatamente com a contagem só de aberturas de ticket — ou seja, a
-- diferença era 100% follow-ups.
--
-- Causa: dashboard_metrics (e todo o restante da plataforma) conta pela regra
-- "cada interação = 1" via public._interaction_events (abertura do ticket +
-- cada follow-up, dia em America/Sao_Paulo). dashboard_audit ainda listava só
-- linhas de public.services, com janela de data em UTC.
--
-- Regra nova:
--   total_count = COUNT(*) de public._interaction_events(from, to, agent)
--                 → idêntico ao total_count de dashboard_metrics por construção.
--   rows        = as mesmas interações, com colunas de detalhe:
--                   kind 'service'   → abertura (services.service_date, autor services.user_id)
--                   kind 'follow_up' → follow-up (service_follow_ups.recorded_at, autor
--                                      service_follow_ups.user_id, sem filtro cross-agent,
--                                      como em 20260528000300)
--                 O SELECT de rows espelha o helper linha a linha; se o helper mudar,
--                 este arquivo tem que mudar junto.
--
-- Colunas devolvidas por linha: id, kind, service_id, event_at (timestamptz),
-- day ('YYYY-MM-DD' em SP — o mesmo bucket do gráfico por dia), user_id,
-- client_email, product, platform, channel, status, follow_up_number, profiles.
-- service_date deixou de existir na resposta; o front lê day/event_at.

CREATE OR REPLACE FUNCTION public.dashboard_audit(
  from_date    date,
  to_date      date,
  agent_id     text    DEFAULT NULL::text,
  page_size    integer DEFAULT 25,
  page_offset  integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
  v_rows  jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF page_size  IS NULL OR page_size  < 1 THEN page_size  := 25;  END IF;
  IF page_size  > 200                      THEN page_size  := 200; END IF;
  IF page_offset IS NULL OR page_offset < 0 THEN page_offset := 0; END IF;
  IF agent_id = '' THEN agent_id := NULL; END IF;

  -- Mesmo helper e mesmos argumentos de dashboard_metrics → mesmo número.
  SELECT COUNT(*)::bigint INTO v_total
  FROM public._interaction_events(from_date, to_date, agent_id);

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      ev.id,
      ev.kind,
      ev.service_id,
      ev.event_at,
      to_char(ev.day, 'YYYY-MM-DD') AS day,
      ev.user_id,
      ev.client_email,
      ev.product,
      ev.platform,
      ev.channel,
      ev.status,
      ev.follow_up_number,
      jsonb_build_object('full_name', p.full_name) AS profiles
    FROM (
      -- Espelho de _interaction_events (ramo 'service')
      SELECT
        s.id,
        'service'::text                     AS kind,
        s.id                                AS service_id,
        s.service_date::timestamptz         AS event_at,
        (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day,
        s.user_id::text                     AS user_id,
        s.client_email,
        s.product,
        s.platform,
        s.channel,
        s.status,
        NULL::integer                       AS follow_up_number
      FROM public.services s
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR s.user_id::text = agent_id)

      UNION ALL

      -- Espelho de _interaction_events (ramo 'follow_up')
      SELECT
        f.id,
        'follow_up'::text                   AS kind,
        s.id                                AS service_id,
        f.recorded_at                       AS event_at,
        (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
        f.user_id,
        s.client_email,
        s.product,
        s.platform,
        s.channel,
        f.status,
        f.follow_up_number
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
    ) ev
    LEFT JOIN public.profiles p ON p.id::text = ev.user_id
    ORDER BY ev.event_at DESC, ev.kind ASC, ev.id DESC
    LIMIT page_size OFFSET page_offset
  ) t;

  RETURN jsonb_build_object('total_count', COALESCE(v_total, 0), 'rows', v_rows);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_audit(date, date, text, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
