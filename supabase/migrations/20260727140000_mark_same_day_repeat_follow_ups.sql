-- Registrar (sem bloquear) interações que furam a regra das 18h.
--
-- PROBLEMA
-- A regra "a próxima interação com este atendimento só pode ser registrada no
-- dia seguinte" existe SÓ no navegador (canAddInteraction em
-- src/features/services/useStatusTracking.ts). O banco não impede nada. Duas
-- abas abertas, cache velho, ou o atalho "Reabrir Ticket" furam a regra.
--
-- Medido em produção em 27/07/2026, últimos 30 dias (19.460 interações):
--     382 follow-ups extras (mesmo ticket, mesmo dia, SEM código de rastreio)
--       7 extras COM código de rastreio  <- exceção legítima, a regra os libera
--       2 tickets duplicados (mesmo e-mail + agente + dia)
--     => 1,97% de inflação nos números do gestor
--
-- DECISÃO: registrar, não bloquear.
-- Bloquear no servidor travaria o agente que tem motivo legítimo para reabrir no
-- mesmo dia. Em vez disso marcamos a ocorrência e damos visibilidade ao gestor,
-- que decide caso a caso. Nenhum registro é impedido, nenhum é apagado.
--
-- REVERSÍVEL E ADITIVO
-- Só adiciona: uma coluna (default false), um trigger e uma RPC de leitura.
-- Reverter = DROP TRIGGER + DROP FUNCTION + DROP COLUMN. A coluna é derivada
-- (recomputável pelo backfill abaixo), então nada de dado original se perde.

-- ============================================================================
-- 1) Coluna: marca se ESTE follow-up teria sido bloqueado pela regra
-- ============================================================================
ALTER TABLE public.service_follow_ups
  ADD COLUMN IF NOT EXISTS is_same_day_repeat boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.service_follow_ups.is_same_day_repeat IS
  'true = este follow-up foi registrado antes das 18:00 (SP) do dia da interação anterior no mesmo ticket, ou seja, furou a regra do "dia seguinte". Tickets com has_tracking_code nunca são marcados (a regra os isenta). Preenchido por trigger no INSERT; nunca bloqueia.';

-- ============================================================================
-- 2) Trigger BEFORE INSERT — marca a ocorrência
-- ============================================================================
-- Usa now() em vez de NEW.recorded_at para não depender da ordem de disparo
-- entre triggers BEFORE INSERT (trg_follow_up_force_now também mexe na linha).
-- O resultado é o mesmo: force_now fixa recorded_at := now().
CREATE OR REPLACE FUNCTION public._tg_follow_up_mark_same_day_repeat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_has_tracking boolean;
  v_last_at      timestamptz;
  v_block_until  timestamptz;
BEGIN
  SELECT s.has_tracking_code INTO v_has_tracking
  FROM public.services s WHERE s.id = NEW.service_id;

  -- Código de rastreio: a regra isenta explicitamente. Nunca é "repeat".
  IF COALESCE(v_has_tracking, false) THEN
    NEW.is_same_day_repeat := false;
    RETURN NEW;
  END IF;

  SELECT max(f.recorded_at) INTO v_last_at
  FROM public.service_follow_ups f WHERE f.service_id = NEW.service_id;

  -- Primeira interação do ticket é sempre permitida (a criação não conta).
  IF v_last_at IS NULL THEN
    NEW.is_same_day_repeat := false;
    RETURN NEW;
  END IF;

  -- 18:00 São Paulo do dia da interação anterior.
  v_block_until := (((v_last_at AT TIME ZONE 'America/Sao_Paulo')::date
                     + time '18:00') AT TIME ZONE 'America/Sao_Paulo');

  NEW.is_same_day_repeat := (now() < v_block_until);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_follow_up_mark_same_day_repeat ON public.service_follow_ups;
CREATE TRIGGER trg_follow_up_mark_same_day_repeat
  BEFORE INSERT ON public.service_follow_ups
  FOR EACH ROW
  EXECUTE FUNCTION public._tg_follow_up_mark_same_day_repeat();

-- ============================================================================
-- 3) Backfill do histórico
-- ============================================================================
-- Aplica a MESMA regra aos registros que já existem, usando recorded_at da
-- própria linha no lugar de now(). Coluna nova => não sobrescreve nada.
WITH ordenado AS (
  SELECT f.id,
         f.service_id,
         f.recorded_at,
         lag(f.recorded_at) OVER (PARTITION BY f.service_id
                                  ORDER BY f.recorded_at, f.id) AS anterior_at
  FROM public.service_follow_ups f
)
UPDATE public.service_follow_ups t
SET is_same_day_repeat = true
FROM ordenado o
JOIN public.services s ON s.id = o.service_id
WHERE t.id = o.id
  AND o.anterior_at IS NOT NULL
  AND NOT COALESCE(s.has_tracking_code, false)
  AND o.recorded_at < (((o.anterior_at AT TIME ZONE 'America/Sao_Paulo')::date
                        + time '18:00') AT TIME ZONE 'America/Sao_Paulo');

-- Índice parcial: só as linhas marcadas (minoria), para a RPC do gestor.
CREATE INDEX IF NOT EXISTS idx_follow_ups_same_day_repeat
  ON public.service_follow_ups (recorded_at, user_id)
  WHERE is_same_day_repeat;

-- ============================================================================
-- 4) RPC do gestor — dashboard_same_day_repeats(from, to, agent_id)
-- ============================================================================
-- Devolve DOIS números, porque são coisas diferentes:
--
--   same_day_extra  = interações além da primeira no mesmo ticket no mesmo
--                     dia-calendário (SP). É ISTO que infla a contagem diária
--                     do gestor: 2 eventos para 1 atendimento no mesmo dia.
--   rule_violations = subconjunto que furou a regra das 18h (a que a UI diz
--                     aplicar). Um follow-up às 19h no mesmo dia é PERMITIDO
--                     pela regra, mas ainda conta 2x no número do dia — daí a
--                     diferença entre os dois totais.
--
-- Medido em 27/07/2026 nos últimos 30 dias: 382 same_day_extra, 340 violações.
--
-- A quebra por agente traz % sobre o total de interações do PRÓPRIO agente —
-- volume absoluto pune injustamente quem trabalha mais.
CREATE OR REPLACE FUNCTION public.dashboard_same_day_repeats(
  from_date date,
  to_date   date,
  agent_id  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_violations int := 0;
  v_same_day   int := 0;
  v_by_agent   jsonb;
  v_detail     jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*)::int INTO v_violations
  FROM public.service_follow_ups f
  WHERE f.is_same_day_repeat
    AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
    AND (agent_id IS NULL OR f.user_id = agent_id);

  -- Interações extras por (ticket, dia): o que realmente duplica na métrica.
  SELECT COALESCE(sum(n - 1), 0)::int INTO v_same_day
  FROM (
    SELECT count(*) AS n
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      AND NOT COALESCE(s.has_tracking_code, false)
      AND (agent_id IS NULL OR f.user_id = agent_id)
    GROUP BY f.service_id, (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
    HAVING count(*) > 1
  ) t;

  -- Por agente, com o total de interações do agente no período como denominador.
  WITH repeats AS (
    SELECT f.user_id, count(*)::int AS n
    FROM public.service_follow_ups f
    WHERE f.is_same_day_repeat
      AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR f.user_id = agent_id)
    GROUP BY f.user_id
  ),
  totais AS (
    SELECT e.user_id, count(*)::int AS total
    FROM public._interaction_events(from_date, to_date, agent_id) e
    GROUP BY e.user_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'agent_id',    r.user_id,
           'agent_name',  COALESCE(p.full_name, 'Sem nome'),
           'repeat_count', r.n,
           'total_count',  COALESCE(t.total, 0),
           'pct',          CASE WHEN COALESCE(t.total,0) > 0
                                THEN ROUND(100.0 * r.n / t.total, 1) ELSE 0 END
         ) ORDER BY r.n DESC, COALESCE(p.full_name,'')), '[]'::jsonb)
    INTO v_by_agent
  FROM repeats r
  LEFT JOIN totais t   ON t.user_id = r.user_id
  LEFT JOIN public.profiles p ON p.id = r.user_id;

  -- Detalhe: qual ticket, qual cliente, quantas horas depois da anterior.
  WITH marcados AS (
    SELECT f.id, f.service_id, f.user_id, f.recorded_at, f.observation,
           lag(f.recorded_at) OVER (PARTITION BY f.service_id
                                    ORDER BY f.recorded_at, f.id) AS anterior_at,
           f.is_same_day_repeat
    FROM public.service_follow_ups f
    WHERE f.service_id IN (
      SELECT service_id FROM public.service_follow_ups
      WHERE is_same_day_repeat
        AND (recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR user_id = agent_id)
    )
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'service_id',   m.service_id,
           'client_email', s.client_email,
           'product',      s.product,
           'agent_name',   COALESCE(p.full_name, 'Sem nome'),
           'recorded_at',  m.recorded_at,
           'previous_at',  m.anterior_at,
           'hours_apart',  ROUND((EXTRACT(epoch FROM m.recorded_at - m.anterior_at)/3600)::numeric, 1),
           'observation',  NULLIF(m.observation, '')
         ) ORDER BY m.recorded_at DESC), '[]'::jsonb)
    INTO v_detail
  FROM marcados m
  JOIN public.services s ON s.id = m.service_id
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.is_same_day_repeat
    AND (m.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
    AND (agent_id IS NULL OR m.user_id = agent_id);

  RETURN jsonb_build_object(
    'same_day_extra',  v_same_day,   -- infla a contagem diária do gestor
    'rule_violations', v_violations, -- subconjunto que furou a regra das 18h
    'by_agent',        v_by_agent,
    'detail',          v_detail
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_same_day_repeats(date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_same_day_repeats(date, date, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
