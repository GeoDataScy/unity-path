-- Testes do relógio de prazo (horas úteis, America/Sao_Paulo) com instantes fixos.
-- Rodar depois de aplicar 20261007120000_sla_calendario_dias_uteis.sql: psql -f supabase/tests/sla_calendario_test.sql
-- Só lê: não grava nada. Falha com ASSERT se alguma regra quebrar.
SET TIME ZONE 'UTC';
DO $$
DECLARE r timestamptz; h numeric;
BEGIN
  -- sexta 15h + 24h úteis = segunda 15h
  r := add_business_hours('2026-10-02 15:00-03', 24);
  ASSERT r = '2026-10-05 15:00-03', 'sexta+24h: ' || r;
  -- sábado 10h → início segunda 00h
  r := business_start('2026-10-03 10:00-03');
  ASSERT r = '2026-10-05 00:00-03', 'sabado start: ' || r;
  -- sábado 10h + 24h = terça 00h
  r := add_business_hours('2026-10-03 10:00-03', 24);
  ASSERT r = '2026-10-06 00:00-03', 'sabado+24: ' || r;
  -- feriado no meio: sexta 09/10 15h, segunda 12/10 é feriado → terça 13/10 15h
  r := add_business_hours('2026-10-09 15:00-03', 24);
  ASSERT r = '2026-10-13 15:00-03', 'feriado: ' || r;
  ASSERT business_hours_between('2026-10-09 15:00-03', '2026-10-13 15:00-03') = 24, 'between feriado';
  -- 48h a partir de quarta 10h = sexta 10h
  ASSERT add_business_hours('2026-10-07 10:00-03', 48) = '2026-10-09 10:00-03', 'quarta+48';
  -- fronteira SP x UTC: sexta 23:30 SP já é sábado 02:30 UTC, mas é dia útil em SP
  ASSERT business_start('2026-10-03 02:30+00') = '2026-10-03 02:30+00', 'sexta 23h30 SP é útil';
  ASSERT is_business_day(('2026-10-03 02:30+00'::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date), 'dia SP';
  -- sexta 23h SP → segunda 01h SP = 1h (sexta) + 1h (segunda)
  h := business_hours_between('2026-10-02 23:00-03', '2026-10-05 01:00-03');
  ASSERT h = 2, 'between fronteira: ' || h;
  -- domingo 21h SP (= segunda 00h UTC) não é útil
  ASSERT business_start('2026-10-05 00:00+00') = '2026-10-05 00:00-03', 'domingo 21h SP';
  -- mesmo instante / invertido = 0
  ASSERT business_hours_between('2026-10-07 10:00-03', '2026-10-07 10:00-03') = 0;
  ASSERT business_hours_between('2026-10-08 10:00-03', '2026-10-07 10:00-03') = 0;
  -- add + between são inversos a partir de início útil
  ASSERT business_hours_between('2026-10-07 10:00-03', add_business_hours('2026-10-07 10:00-03', 73.5)) = 73.5, 'inverso';
  -- dias úteis: out/2026 = 22 dias seg-sex - 12/10 = 21; fev/2026 = 20
  ASSERT business_days_in_month('2026-10-15') = 21, 'out: ' || business_days_in_month('2026-10-15');
  ASSERT business_days_in_month('2026-02-01') = 20, 'fev: ' || business_days_in_month('2026-02-01');
  RAISE NOTICE 'calendario OK';
END $$;
