-- Nível de serviço do pacote, por caso e por mês (doc XMX-2026/IMP-SUP-01-A v2,
-- seção 4 e ajustes 2 e 4). Mede o SERVIÇO, nunca a pessoa por dia: nada aqui
-- devolve meta diária, ranking ou comparação entre prestadores.
--
-- Indicadores (parâmetro em horas úteis — ver 20261007120000_sla_calendario_dias_uteis.sql):
--   reembolso_abertura  24h  início = request_date (00:00 SP, normalizado) → fim = refunds.created_at
--   reembolso_conclusao 48h  início = authorized_at → fim = completed_at (sem authorized_at: fora)
--   radar_envelhecido   48h  máximo entre dois acompanhamentos de um caso aberto do Radar
--
-- Radar: o "caso do Radar" é a linha de radar_items (20260825120000_radar_pendencias.sql).
-- Esses casos não têm ticket; o acompanhamento registrado é radar_events.recorded_at
-- (ou radar_items.created_at quando ainda não há nenhum).
--
-- Volume do mês = mesma contagem do "Total no período" de Minhas métricas
-- (agent_my_metrics → _interaction_events). Não criar contagem nova.
--
-- TODO(v2): portar estas RPCs para o core na virada da arquitetura v2.

-- ── Quem pode ver o quê ─────────────────────────────────────────────────────
-- Sem p_user_id = o próprio chamador. Com p_user_id de outra pessoa = só manager.
CREATE OR REPLACE FUNCTION public._sla_resolve_user(p_user_id text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid text := auth.uid()::text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_user_id = v_uid THEN
    RETURN v_uid;
  END IF;
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._sla_resolve_user(text) FROM PUBLIC, anon, authenticated;

-- ── Núcleo: o mês de um prestador (sem checagem de acesso) ─────────────────
CREATE OR REPLACE FUNCTION public._sla_mes(p_month date, p_user text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first      date := date_trunc('month', p_month)::date;
  v_last       date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_m_start    timestamptz := v_first::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_m_end      timestamptz := (v_last + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_dias_uteis int;
  v_volume     int;
  v_capacidade int;
  v_ab_total   int; v_ab_ok int;
  v_co_total   int; v_co_ok int;
  v_ra_total   int; v_ra_venc int;
BEGIN
  v_dias_uteis := public.business_days_in_month(v_first);
  v_capacidade := v_dias_uteis * public.provider_capacity_per_business_day(p_user);

  SELECT count(*)::int INTO v_volume
    FROM public._interaction_events(v_first, v_last, p_user);

  -- Abertura: o caso pertence ao mês da solicitação do cliente.
  SELECT count(*)::int,
         count(*) FILTER (WHERE public.business_hours_between(
                    public.business_start(r.request_date::date::timestamp AT TIME ZONE 'America/Sao_Paulo'),
                    r.created_at AT TIME ZONE 'UTC') <= 24)::int
    INTO v_ab_total, v_ab_ok
    FROM public.refunds r
   WHERE r.user_id = p_user
     AND r.request_date ~ '^\d{4}-\d{2}-\d{2}$'
     AND r.request_date::date BETWEEN v_first AND v_last;

  -- Conclusão: o caso pertence ao mês da autorização. Em aberto e ainda dentro
  -- do prazo não entra na conta (nem no prazo, nem vencido).
  WITH c AS (
    SELECT r.completed_at,
           public.add_business_hours(r.authorized_at, 48) AS prazo
      FROM public.refunds r
     WHERE r.user_id = p_user
       AND r.authorized_at >= v_m_start
       AND r.authorized_at <  v_m_end
  )
  SELECT count(*) FILTER (WHERE completed_at IS NOT NULL OR prazo < now())::int,
         count(*) FILTER (WHERE completed_at IS NOT NULL AND completed_at <= prazo)::int
    INTO v_co_total, v_co_ok
    FROM c;

  -- Radar: casos abertos em algum momento do mês. Vencido no mês se passou
  -- algum tempo do mês vencido, isto é, se o trecho [prazo, próximo acompanhamento)
  -- de algum intervalo cruza o mês. Caso parado desde o mês anterior conta nos dois.
  WITH itens AS (
    SELECT i.id, i.created_at, i.closed_at
      FROM public.radar_items i
     WHERE i.user_id = p_user
       AND i.created_at < v_m_end
       AND (i.closed_at IS NULL OR i.closed_at >= v_m_start)
  ),
  marcos AS (
    SELECT it.id, it.closed_at, it.created_at AS t FROM itens it
    UNION ALL
    SELECT it.id, it.closed_at, e.recorded_at
      FROM itens it
      JOIN public.radar_events e ON e.item_id = it.id
  ),
  intervalos AS (
    SELECT id,
           t,
           COALESCE(lead(t) OVER (PARTITION BY id ORDER BY t), closed_at, now()) AS proximo
      FROM marcos
  ),
  estouros AS (
    SELECT DISTINCT id
      FROM (SELECT id, proximo, public.add_business_hours(t, 48) AS prazo FROM intervalos) x
     WHERE x.prazo < x.proximo
       AND x.prazo < v_m_end
       AND x.proximo > v_m_start
  )
  SELECT (SELECT count(*) FROM itens)::int, (SELECT count(*) FROM estouros)::int
    INTO v_ra_total, v_ra_venc;

  RETURN jsonb_build_object(
    'mes',        to_char(v_first, 'YYYY-MM'),
    'dias_uteis', v_dias_uteis,
    'volume',     v_volume,
    'capacidade', v_capacidade,
    'indicadores', jsonb_build_array(
      jsonb_build_object(
        'chave', 'reembolso_abertura',
        'rotulo', 'Abertura de reembolso',
        'parametro_horas', 24,
        'casos_total', v_ab_total,
        'casos_no_prazo', v_ab_ok,
        'casos_vencidos', v_ab_total - v_ab_ok,
        'pct_no_prazo', CASE WHEN v_ab_total > 0 THEN round(v_ab_ok * 100.0 / v_ab_total, 1) END),
      jsonb_build_object(
        'chave', 'reembolso_conclusao',
        'rotulo', 'Conclusão de reembolso',
        'parametro_horas', 48,
        'casos_total', v_co_total,
        'casos_no_prazo', v_co_ok,
        'casos_vencidos', v_co_total - v_co_ok,
        'pct_no_prazo', CASE WHEN v_co_total > 0 THEN round(v_co_ok * 100.0 / v_co_total, 1) END),
      jsonb_build_object(
        'chave', 'radar_envelhecido',
        'rotulo', 'Radar sem acompanhamento',
        'parametro_horas', 48,
        'casos_total', v_ra_total,
        'casos_no_prazo', v_ra_total - v_ra_venc,
        'casos_vencidos', v_ra_venc,
        'pct_no_prazo', CASE WHEN v_ra_total > 0 THEN round((v_ra_total - v_ra_venc) * 100.0 / v_ra_total, 1) END)
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._sla_mes(date, text) FROM PUBLIC, anon, authenticated;

-- ── sla_mensal: qualquer mês (inclusive o corrente, parcial) ───────────────
CREATE OR REPLACE FUNCTION public.sla_mensal(p_month date, p_user_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user text := public._sla_resolve_user(p_user_id);
BEGIN
  IF p_month IS NULL OR p_month < DATE '2020-01-01' OR p_month > DATE '2100-01-01' THEN
    RAISE EXCEPTION 'Mês inválido: %', p_month USING ERRCODE = '22023';
  END IF;
  RETURN public._sla_mes(p_month, v_user);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sla_mensal(date, text) TO authenticated;

-- ── sla_relatorio_mensal: só mês fechado ───────────────────────────────────
-- O relatório do mês anterior fica disponível a partir do 3º dia útil do mês
-- corrente (00:00 SP). Antes disso devolve {disponivel:false, disponivel_em}.
CREATE OR REPLACE FUNCTION public.sla_relatorio_mensal(p_month date, p_user_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user          text := public._sla_resolve_user(p_user_id);
  v_first         date := date_trunc('month', p_month)::date;
  v_today         date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_cur_first     date := date_trunc('month', v_today)::date;
  v_release_month date;
  v_disponivel_em date;
BEGIN
  IF p_month IS NULL OR p_month < DATE '2020-01-01' THEN
    RAISE EXCEPTION 'Mês inválido: %', p_month USING ERRCODE = '22023';
  END IF;
  IF v_first >= v_cur_first THEN
    RAISE EXCEPTION 'O relatório só existe para meses fechados.' USING ERRCODE = '22023';
  END IF;

  -- 3º dia útil do mês seguinte ao relatório.
  v_release_month := (v_first + interval '1 month')::date;
  SELECT d INTO v_disponivel_em
    FROM (SELECT g::date AS d
            FROM generate_series(v_release_month, v_release_month + 31, interval '1 day') g) x
   WHERE public.is_business_day(x.d)
   ORDER BY x.d
   OFFSET 2 LIMIT 1;

  IF v_today < v_disponivel_em THEN
    RETURN jsonb_build_object(
      'mes', to_char(v_first, 'YYYY-MM'),
      'disponivel', false,
      'disponivel_em', to_char(v_disponivel_em, 'YYYY-MM-DD'));
  END IF;

  RETURN public._sla_mes(v_first, v_user)
         || jsonb_build_object('disponivel', true,
                               'disponivel_em', to_char(v_disponivel_em, 'YYYY-MM-DD'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.sla_relatorio_mensal(date, text) TO authenticated;

-- ── my_overdue_queue_items: o que está vencido AGORA na fila do chamador ───
-- Só itens ainda abertos. Abertura de reembolso não aparece aqui: o caso só
-- existe no banco depois de aberto (fim = created_at), então não há abertura
-- "em aberto" para vencer.
CREATE OR REPLACE FUNCTION public.my_overdue_queue_items()
RETURNS TABLE (
  caso_id          text,
  tipo             text,
  rotulo_tipo      text,
  prazo_horas      int,
  vencido_ha_horas int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid text := auth.uid()::text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH conclusao AS (
    SELECT r.id::text AS caso_id,
           public.add_business_hours(r.authorized_at, 48) AS prazo
      FROM public.refunds r
     WHERE r.user_id = v_uid
       AND r.authorized_at IS NOT NULL
       AND (r.completion_date IS NULL OR btrim(r.completion_date) = '')
  ),
  radar AS (
    SELECT i.id::text AS caso_id,
           public.add_business_hours(
             GREATEST(i.created_at,
                      COALESCE((SELECT max(e.recorded_at) FROM public.radar_events e WHERE e.item_id = i.id),
                               i.created_at)),
             48) AS prazo
      FROM public.radar_items i
     WHERE i.user_id = v_uid
       AND i.status NOT IN ('resolvido', 'cancelado')
  ),
  todos AS (
    SELECT c.caso_id, 'reembolso_conclusao'::text AS tipo, 'Conclusão de reembolso'::text AS rotulo_tipo, 48 AS prazo_horas, c.prazo
      FROM conclusao c
    UNION ALL
    SELECT r.caso_id, 'radar', 'Radar sem acompanhamento', 48, r.prazo
      FROM radar r
  )
  SELECT t.caso_id, t.tipo, t.rotulo_tipo, t.prazo_horas,
         floor(public.business_hours_between(t.prazo, now()))::int
    FROM todos t
   WHERE t.prazo < now()
   ORDER BY t.prazo ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.my_overdue_queue_items() TO authenticated;
