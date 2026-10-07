-- Calendário de dias úteis para os prazos contratuais (doc XMX-2026/IMP-SUP-01-A v2, seção 4).
--
-- Relógio de prazo: 24h por dia SÓ em dias úteis (seg–sex que não sejam feriado),
-- no fuso America/Sao_Paulo. Evento em fim de semana/feriado começa a contar às
-- 00:00 do próximo dia útil. Ex.: sexta 15h + 24h úteis = segunda 15h.
--
-- É convenção de MEDIÇÃO do serviço, não horário de trabalho: nenhuma função
-- daqui expõe ou infere expediente do prestador.
--
-- TODO(v2): portar para o core na virada da arquitetura v2.

-- ── Feriados ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.business_holidays (
  day  date PRIMARY KEY,
  name text NOT NULL
);

ALTER TABLE public.business_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_holidays_select ON public.business_holidays;
CREATE POLICY business_holidays_select ON public.business_holidays
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS business_holidays_manager_write ON public.business_holidays;
CREATE POLICY business_holidays_manager_write ON public.business_holidays
  FOR ALL TO authenticated
  USING ((SELECT public.is_manager()))
  WITH CHECK ((SELECT public.is_manager()));

-- Feriados nacionais oficiais (Lei 662/1949, Lei 6.802/1980, Lei 14.759/2023).
-- Carnaval e Corpus Christi são ponto facultativo, não feriado nacional: ficam
-- de fora. A gestora pode incluir pela tabela se o contrato disser o contrário.
INSERT INTO public.business_holidays (day, name) VALUES
  ('2026-01-01', 'Confraternização Universal'),
  ('2026-04-03', 'Sexta-feira Santa'),
  ('2026-04-21', 'Tiradentes'),
  ('2026-05-01', 'Dia do Trabalho'),
  ('2026-09-07', 'Independência do Brasil'),
  ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'),
  ('2026-11-15', 'Proclamação da República'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Confraternização Universal'),
  ('2027-03-26', 'Sexta-feira Santa'),
  ('2027-04-21', 'Tiradentes'),
  ('2027-05-01', 'Dia do Trabalho'),
  ('2027-09-07', 'Independência do Brasil'),
  ('2027-10-12', 'Nossa Senhora Aparecida'),
  ('2027-11-02', 'Finados'),
  ('2027-11-15', 'Proclamação da República'),
  ('2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2027-12-25', 'Natal')
ON CONFLICT (day) DO NOTHING;

-- ── Funções ─────────────────────────────────────────────────────────────────
-- STABLE (e não IMMUTABLE) porque leem business_holidays.

CREATE OR REPLACE FUNCTION public.is_business_day(p_day date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT extract(isodow FROM p_day) < 6
     AND NOT EXISTS (SELECT 1 FROM public.business_holidays h WHERE h.day = p_day);
$$;

-- Normaliza um instante para o próximo instante "útil": se cai em dia útil,
-- fica como está; senão vira 00:00 (SP) do próximo dia útil.
CREATE OR REPLACE FUNCTION public.business_start(p_at timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_day date;
BEGIN
  IF p_at IS NULL THEN RETURN NULL; END IF;
  v_day := (p_at AT TIME ZONE 'America/Sao_Paulo')::date;
  IF public.is_business_day(v_day) THEN
    RETURN p_at;
  END IF;
  LOOP
    v_day := v_day + 1;
    EXIT WHEN public.is_business_day(v_day);
  END LOOP;
  RETURN v_day::timestamp AT TIME ZONE 'America/Sao_Paulo';
END;
$$;

-- Horas úteis entre a e b (0 se b <= a). Soma, dia a dia em SP, só a parte de
-- [a, b) que cai em dia útil.
CREATE OR REPLACE FUNCTION public.business_hours_between(a timestamptz, b timestamptz)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN a IS NULL OR b IS NULL OR b <= a THEN 0::numeric
    ELSE COALESCE((
      SELECT round(sum(
               extract(epoch FROM
                 LEAST(b, (d + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
                 - GREATEST(a, d::timestamp AT TIME ZONE 'America/Sao_Paulo'))
             )::numeric / 3600, 4)
        FROM generate_series((a AT TIME ZONE 'America/Sao_Paulo')::date,
                             (b AT TIME ZONE 'America/Sao_Paulo')::date,
                             interval '1 day') AS g(dd)
        CROSS JOIN LATERAL (SELECT g.dd::date AS d) x
       WHERE public.is_business_day(x.d)
    ), 0)
  END;
$$;

-- Soma h horas úteis a partir de a. O ponto de partida é normalizado com
-- business_start; o resultado sempre cai dentro de um dia útil.
CREATE OR REPLACE FUNCTION public.add_business_hours(a timestamptz, h numeric)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cur       timestamptz;
  v_day       date;
  v_day_end   timestamptz;
  v_left      numeric;
  v_available numeric;
BEGIN
  IF a IS NULL OR h IS NULL THEN RETURN NULL; END IF;
  v_cur  := public.business_start(a);
  v_left := h;
  LOOP
    v_day     := (v_cur AT TIME ZONE 'America/Sao_Paulo')::date;
    v_day_end := (v_day + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
    v_available := extract(epoch FROM v_day_end - v_cur)::numeric / 3600;
    IF v_left <= v_available THEN
      RETURN v_cur + make_interval(secs => (v_left * 3600)::double precision);
    END IF;
    v_left := v_left - v_available;
    v_cur  := public.business_start(v_day_end);
  END LOOP;
END;
$$;

-- Dias úteis do mês que contém p_month.
CREATE OR REPLACE FUNCTION public.business_days_in_month(p_month date)
RETURNS int
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT count(*)::int
    FROM generate_series(date_trunc('month', p_month)::date,
                         (date_trunc('month', p_month) + interval '1 month - 1 day')::date,
                         interval '1 day') AS g(d)
   WHERE public.is_business_day(g.d::date);
$$;

GRANT EXECUTE ON FUNCTION public.is_business_day(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.business_start(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.business_hours_between(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_business_hours(timestamptz, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.business_days_in_month(date) TO authenticated;
