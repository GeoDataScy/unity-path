-- Item 3 do documento jurídico: tirar das telas do agente rankings, líder,
-- posições, "quanto falta para alcançar o time" e rótulos de julgamento.
-- O front já não mostra nada disso; aqui o dado deixa de sair do banco, para
-- que nome/volume de outro prestador não fique visível nem no DevTools.
-- Consumidores: só src/features/agent (useAgentDailyMetricsQuery, useMyAgentMetricsQuery).

CREATE OR REPLACE FUNCTION public.agent_daily_metrics(target_date date DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      uuid;
  v_my_count int := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT COUNT(*)::int INTO v_my_count
  FROM public._interaction_events(target_date, target_date, v_uid::text);

  -- Sem líder: nome, id e volume de outro prestador não saem mais para o agente
  -- (item 3 do documento jurídico). Também some a varredura do time inteiro.
  RETURN jsonb_build_object('my_count', COALESCE(v_my_count, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_my_metrics(from_date date, to_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid               text;
  v_today             date;
  v_days              int;
  v_total             int     := 0;
  v_new_services      int     := 0;
  v_follow_ups        int     := 0;
  v_avg_daily         numeric := 0;
  v_active_days       int     := 0;
  v_my_rate           numeric := 0;
  v_best_day          text    := NULL;
  v_best_day_count    int     := 0;
  v_trend_end         date;
  v_mid               date;
  v_first_sum         numeric := 0;
  v_second_sum        numeric := 0;
  v_first_days        int     := 0;
  v_second_days       int     := 0;
  v_first_avg         numeric := 0;
  v_second_avg        numeric := 0;
  v_trend_pct         numeric := 0;
  v_trend_reliable    boolean := false;
  v_by_day            jsonb;
  v_by_channel        jsonb;
  v_by_platform       jsonb;
  v_by_product        jsonb;
  v_refunds_open      int     := 0;
  v_refunds_done      int     := 0;
  v_refunds_value     numeric := 0;
  v_team_median_total numeric := 0;
  v_team_size         int     := 0;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  -- Teto de período: o <input type="date"> do Chrome emite o ano parcial a cada
  -- dígito ("0002-…", "0020-…", "0202-…"). Sem teto, by_day gerava ~740 mil
  -- dias (~49 MB de JSON) e prendia o banco até o statement_timeout de 8 s,
  -- uma vez por tecla, por agente. Nenhum filtro legítimo chega perto disso.
  IF from_date < DATE '2020-01-01' OR to_date - from_date > 3660 THEN
    RAISE EXCEPTION 'Período inválido: % a %', from_date, to_date
      USING ERRCODE = '22023';
  END IF;

  v_today := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_days  := (to_date - from_date)::int + 1;

  -- ── Totais + dias trabalhados ─────────────────────────────────────────────
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE kind = 'service')::int,
    COUNT(*) FILTER (WHERE kind = 'follow_up')::int,
    COUNT(DISTINCT day)::int
  INTO v_total, v_new_services, v_follow_ups, v_active_days
  FROM public._interaction_events(from_date, to_date, v_uid);

  -- Média por dia de CALENDÁRIO (legado, mantida para não quebrar consumidor).
  v_avg_daily := CASE WHEN v_days > 0 THEN ROUND(v_total::numeric / v_days, 2) ELSE 0 END;

  -- Ritmo: por dia efetivamente TRABALHADO. É esta a métrica comparável.
  v_my_rate := CASE WHEN v_active_days > 0
                    THEN ROUND(v_total::numeric / v_active_days, 2)
                    ELSE 0 END;

  -- ── By day ────────────────────────────────────────────────────────────────
  WITH ds AS (
    SELECT generate_series(from_date, to_date, '1 day'::interval)::date AS day
  ),
  ev AS (
    SELECT day, kind FROM public._interaction_events(from_date, to_date, v_uid)
  ),
  per_day AS (
    SELECT
      day,
      COUNT(*)::int                                   AS total,
      COUNT(*) FILTER (WHERE kind = 'service')::int   AS services,
      COUNT(*) FILTER (WHERE kind = 'follow_up')::int AS followups
    FROM ev
    GROUP BY day
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'day',       to_char(ds.day, 'YYYY-MM-DD'),
        'value',     COALESCE(per_day.total, 0),
        'services',  COALESCE(per_day.services, 0),
        'followups', COALESCE(per_day.followups, 0)
      ) ORDER BY ds.day
    ),
    '[]'::jsonb
  )
  INTO v_by_day
  FROM ds
  LEFT JOIN per_day ON per_day.day = ds.day;

  -- ── Melhor dia ────────────────────────────────────────────────────────────
  SELECT d->>'day', (d->>'value')::int
  INTO v_best_day, v_best_day_count
  FROM jsonb_array_elements(v_by_day) AS d
  WHERE (d->>'value')::int > 0
  ORDER BY (d->>'value')::int DESC, d->>'day' ASC
  LIMIT 1;

  -- ── Tendência: ritmo da 2ª metade vs ritmo da 1ª metade ───────────────────
  -- Divide pelos dias ATIVOS de cada metade (não por dias de calendário) e
  -- ignora datas futuras, para que folga e fim de semana não virem "queda".
  v_trend_end := LEAST(to_date, v_today);

  IF v_trend_end >= from_date THEN
    v_mid := from_date + ((v_trend_end - from_date) / 2)::int;

    SELECT COALESCE(SUM((d->>'value')::int), 0),
           COUNT(*) FILTER (WHERE (d->>'value')::int > 0)::int
    INTO v_first_sum, v_first_days
    FROM jsonb_array_elements(v_by_day) AS d
    WHERE (d->>'day')::date <= v_mid;

    SELECT COALESCE(SUM((d->>'value')::int), 0),
           COUNT(*) FILTER (WHERE (d->>'value')::int > 0)::int
    INTO v_second_sum, v_second_days
    FROM jsonb_array_elements(v_by_day) AS d
    WHERE (d->>'day')::date > v_mid
      AND (d->>'day')::date <= v_trend_end;

    v_first_avg  := CASE WHEN v_first_days  > 0 THEN v_first_sum  / v_first_days  ELSE 0 END;
    v_second_avg := CASE WHEN v_second_days > 0 THEN v_second_sum / v_second_days ELSE 0 END;
  END IF;

  -- Amostra mínima: sem pelo menos 2 dias trabalhados em CADA metade não há
  -- tendência nenhuma para ler, só ruído. A UI esconde o card nesse caso.
  v_trend_reliable := (v_first_days >= 2 AND v_second_days >= 2 AND v_first_avg > 0);

  -- Só o número: rótulo de julgamento ("Regredindo") saiu por exigência jurídica.
  v_trend_pct := CASE WHEN v_trend_reliable
                      THEN ROUND(((v_second_avg - v_first_avg) / v_first_avg) * 100, 0)
                      ELSE 0 END;

  -- ── By channel / platform / product ───────────────────────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'value', value)
           ORDER BY value DESC, name ASC), '[]'::jsonb)
  INTO v_by_channel
  FROM (
    SELECT COALESCE(channel, 'Não informado') AS name, COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, v_uid)
    GROUP BY 1
  ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'value', value)
           ORDER BY value DESC, name ASC), '[]'::jsonb)
  INTO v_by_platform
  FROM (
    SELECT COALESCE(platform, 'Não informado') AS name, COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, v_uid)
    GROUP BY 1
  ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'value', value)
           ORDER BY value DESC, name ASC), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT COALESCE(product, 'Não informado') AS name, COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, v_uid)
    GROUP BY 1
  ) t;

  -- ── Reembolsos (só os próprios) — inalterado ──────────────────────────────
  SELECT COUNT(*)::int INTO v_refunds_open
  FROM public.refunds r
  WHERE r.user_id = v_uid
    AND r.completion_date IS NULL
    AND r.request_date::date BETWEEN from_date AND to_date;

  SELECT COUNT(*)::int, COALESCE(SUM(r.refund_value), 0)
  INTO v_refunds_done, v_refunds_value
  FROM public.refunds r
  WHERE r.user_id = v_uid
    AND r.completion_date IS NOT NULL
    AND r.completion_date::date BETWEEN from_date AND to_date;

  -- ── Referência da operação (mediana anônima) ──────────────────────────────
  -- Item 3 do documento jurídico: o agente não pode ver líder, posição, nome de
  -- outro prestador nem "quanto falta para alcançar o time". A única comparação
  -- é a mediana do VOLUME de todos os prestadores ativos no período (inclui o
  -- próprio). Abaixo de 4 prestadores a mediana deixa de ser anônima (com 2 ela
  -- é a média de dois volumes conhecidos), então volta 0 e a UI esconde.
  -- Agentes sem evento no período não entram — férias não puxam a mediana.
  WITH per_agent AS MATERIALIZED (
    SELECT e.user_id, COUNT(*)::int AS total
    FROM public._interaction_events(from_date, to_date, NULL) e
    GROUP BY e.user_id
  )
  SELECT COUNT(*)::int,
         COALESCE(ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY total)::numeric, 0), 0)
  INTO v_team_size, v_team_median_total
  FROM per_agent;

  IF v_team_size < 4 THEN
    v_team_median_total := 0;
  END IF;

  RETURN jsonb_build_object(
    'total_count',             v_total,
    'new_services',            v_new_services,
    'follow_ups',              v_follow_ups,
    'total_interactions',      v_total,  -- legacy alias
    'avg_daily',               v_avg_daily,
    'best_day',                v_best_day,
    'best_day_count',          v_best_day_count,
    'trend_pct',               v_trend_pct,
    'trend_reliable',          v_trend_reliable,
    'by_day',                  v_by_day,
    'by_channel',              v_by_channel,
    'by_platform',             v_by_platform,
    'by_product',              v_by_product,
    'refunds_open',            v_refunds_open,
    'refunds_done',            v_refunds_done,
    'refunds_total_value',     v_refunds_value,
    'period_days',             v_days,
    'active_days',             v_active_days,
    'my_rate',                 v_my_rate,
    'team_median_total',       v_team_median_total,
    'team_size',               v_team_size
  );
END;
$function$;
