-- Teto de período em agent_my_metrics.
--
-- Investigação de 02/10/2026 ("o sistema trava quando aplico filtros"): no
-- filtro de data de Meus Atendimentos, cada dígito do ano disparava a RPC com
-- datas como 0002-10-02. O by_day faz generate_series(from_date, to_date), e
-- de 0002 até hoje são 739.251 dias. Medido em prod, só essa série levou 42 s,
-- sendo cortada pelo statement_timeout de 8 s depois de ocupar o banco (micro).
--
-- O front passou a esperar a digitação e a validar o ano (src/lib/filterDate.ts);
-- esta guarda garante o mesmo no servidor para qualquer cliente.
--
-- Corpo copiado da definição AO VIVO em produção (pg_get_functiondef em
-- 02/10/2026), não da última migration, para não desfazer ajuste feito por
-- fora. Única mudança: o bloco IF logo após a checagem de auth.uid().
-- CREATE OR REPLACE preserva os GRANTs existentes. Nada é apagado.

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
  v_days_remaining    int     := 0;
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
  v_trend_label       text    := 'Estável';
  v_trend_reliable    boolean := false;
  v_by_day            jsonb;
  v_by_channel        jsonb;
  v_by_platform       jsonb;
  v_by_product        jsonb;
  v_refunds_open      int     := 0;
  v_refunds_done      int     := 0;
  v_refunds_value     numeric := 0;
  v_team_avg          numeric := 0;
  v_team_median_rate  numeric := 0;
  v_team_median_total numeric := 0;
  v_team_size         int     := 0;
  v_leader_uid        text;
  v_leader_count      int     := 0;
  v_leader_rate       numeric := 0;
  v_leader_name       text    := '';
  v_is_leader         boolean := false;
  v_gap_pct           numeric := 0;
  v_gap_per_day       numeric := 0;
  v_gap_to_median_pct numeric := 0;
  v_is_below_20       boolean := false;
  v_is_below_rate     boolean := false;
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

  -- Dias de calendário que ainda restam no período (contando hoje).
  -- Usado para transformar o gap em algo contável: "faltam N até dia X".
  v_days_remaining := CASE
    WHEN to_date >= v_today THEN (to_date - GREATEST(from_date, v_today))::int + 1
    ELSE 0
  END;

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

  IF NOT v_trend_reliable THEN
    v_trend_pct := 0;
    v_trend_label := 'Estável';
  ELSE
    v_trend_pct := ROUND(((v_second_avg - v_first_avg) / v_first_avg) * 100, 0);
    v_trend_label := CASE
      WHEN v_trend_pct >=  10 THEN 'Evoluindo'
      WHEN v_trend_pct <= -10 THEN 'Regredindo'
      ELSE 'Estável'
    END;
  END IF;

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

  -- ── Benchmark do time ─────────────────────────────────────────────────────
  -- Uma única varredura do time (agent_id NULL é a chamada cara). Agentes sem
  -- nenhum evento no período não aparecem aqui — quem estava de férias não
  -- entra na mediana puxando ela para baixo.
  WITH per_agent AS MATERIALIZED (
    SELECT e.user_id,
           COUNT(*)::int              AS total,
           COUNT(DISTINCT e.day)::int AS active_days
    FROM public._interaction_events(from_date, to_date, NULL) e
    GROUP BY e.user_id
  ),
  rated AS (
    SELECT user_id,
           total,
           active_days,
           ROUND(total::numeric / NULLIF(active_days, 0), 2) AS rate
    FROM per_agent
  )
  SELECT
    -- legado: média do TOTAL dos outros agentes
    COALESCE((SELECT ROUND(AVG(total)::numeric, 2)
                FROM rated WHERE user_id <> v_uid), 0),
    -- novo: mediana do RITMO dos outros agentes
    COALESCE((SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY rate)::numeric, 2)
                FROM rated WHERE user_id <> v_uid AND rate IS NOT NULL), 0),
    -- novo: mediana do TOTAL dos outros agentes
    COALESCE((SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY total)::numeric, 2)
                FROM rated WHERE user_id <> v_uid), 0),
    -- quantos agentes tiveram atividade no período (inclui o próprio)
    (SELECT COUNT(*)::int FROM rated),
    -- líder continua sendo quem mais ATENDEU no período (pergunta diferente)
    (SELECT user_id FROM rated ORDER BY total DESC, user_id ASC LIMIT 1),
    COALESCE((SELECT total FROM rated ORDER BY total DESC, user_id ASC LIMIT 1), 0),
    COALESCE((SELECT rate  FROM rated ORDER BY total DESC, user_id ASC LIMIT 1), 0)
  INTO v_team_avg, v_team_median_rate, v_team_median_total, v_team_size,
       v_leader_uid, v_leader_count, v_leader_rate;

  IF v_leader_uid IS NOT NULL THEN
    SELECT COALESCE(p.full_name, 'Sem nome') INTO v_leader_name
    FROM public.profiles p WHERE p.id::text = v_leader_uid;
  END IF;

  v_is_leader := (v_total > 0 AND v_total >= v_leader_count);

  -- Gap acionável: quantos a mais POR DIA TRABALHADO para alcançar a mediana.
  v_gap_per_day := CASE
    WHEN v_team_median_rate > v_my_rate THEN ROUND(v_team_median_rate - v_my_rate, 2)
    ELSE 0
  END;

  v_gap_to_median_pct := CASE
    WHEN v_my_rate <= 0 OR v_team_median_rate <= v_my_rate THEN 0
    ELSE ROUND((v_team_median_rate / v_my_rate - 1) * 100, 0)
  END;

  v_is_below_rate := (v_total > 0 AND v_team_median_rate > 0
                      AND v_my_rate < v_team_median_rate * 0.8);

  -- legado (volume vs média) — mantido só para compatibilidade
  v_is_below_20 := (v_total > 0 AND v_team_avg > 0 AND v_total::numeric < v_team_avg * 0.8);
  v_gap_pct     := CASE
    WHEN v_total = 0 OR v_team_avg <= v_total THEN 0
    ELSE ROUND((v_team_avg / v_total::numeric - 1) * 100, 0)
  END;

  RETURN jsonb_build_object(
    'total_count',             v_total,
    'new_services',            v_new_services,
    'follow_ups',              v_follow_ups,
    'total_interactions',      v_total,  -- legacy alias
    'avg_daily',               v_avg_daily,
    'best_day',                v_best_day,
    'best_day_count',          v_best_day_count,
    'trend_pct',               v_trend_pct,
    'trend_label',             v_trend_label,
    'trend_reliable',          v_trend_reliable,
    'by_day',                  v_by_day,
    'by_channel',              v_by_channel,
    'by_platform',             v_by_platform,
    'by_product',              v_by_product,
    'refunds_open',            v_refunds_open,
    'refunds_done',            v_refunds_done,
    'refunds_total_value',     v_refunds_value,
    -- ritmo (novo)
    'period_days',             v_days,
    'active_days',             v_active_days,
    'days_remaining',          v_days_remaining,
    'my_rate',                 v_my_rate,
    'team_median_rate',        v_team_median_rate,
    'team_median_total',       v_team_median_total,
    'team_size',               v_team_size,
    'team_leader_rate',        v_leader_rate,
    'gap_per_day',             v_gap_per_day,
    'gap_to_median_pct',       v_gap_to_median_pct,
    'is_below_team_rate',      v_is_below_rate,
    -- time (existente)
    'team_average',            v_team_avg,
    'team_leader_name',        COALESCE(NULLIF(v_leader_name, ''), 'Sem nome'),
    'team_leader_count',       v_leader_count,
    'is_leader',               v_is_leader,
    'gap_to_avg_pct',          v_gap_pct,
    'is_below_team_avg_20pct', v_is_below_20,
    'benchmark_name',          COALESCE(NULLIF(v_leader_name, ''), 'Sem nome'),
    'benchmark_count',         v_leader_count
  );
END;
$function$;
