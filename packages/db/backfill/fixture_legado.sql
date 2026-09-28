-- =====================================================================
-- Réplica do schema legado `public`, com os casos difíceis que o
-- levantamento mediu em produção.
--
-- Serve para ensaiar o backfill sem tocar em produção. Cada linha aqui
-- existe porque um número real a justificou — não é dado inventado para
-- o teste passar.
-- =====================================================================

CREATE TABLE public.profiles (
  id text PRIMARY KEY, email text, full_name text, role text,
  created_at timestamp, support_channel text,
  is_active boolean DEFAULT true, deactivated_at timestamptz, deactivated_by text,
  can_view_all_tickets boolean DEFAULT false,
  can_register_duplicate_emails boolean DEFAULT false,
  can_claim_tickets boolean DEFAULT false,
  is_available boolean DEFAULT true,
  can_approve_takeovers boolean DEFAULT false
);

CREATE TABLE public.services (
  id text PRIMARY KEY, user_id text, client_email text, product text,
  service_date text, status text, created_at timestamp,
  platform text, channel text, has_tracking_code boolean DEFAULT false,
  contact_reason text, current_owner_id text,
  takeover_approved_at timestamptz, takeover_approved_by text,
  order_id text, contact_reason_note text
);

CREATE TABLE public.service_follow_ups (
  id text PRIMARY KEY, service_id text, user_id text,
  follow_up_number integer, status text,
  recorded_at timestamptz, observation text, created_at timestamptz,
  is_same_day_repeat boolean DEFAULT false
);

-- ---------------------------------------------------------------------
INSERT INTO public.profiles (id, email, full_name, role, created_at, is_active) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001','ana@x.test','Ana','agent','2026-03-01 12:00:00', true),
  ('aaaaaaaa-0000-4000-8000-000000000002','bia@x.test','Bia','agent','2026-03-01 12:00:00', true),
  -- Agente desativado cujo login foi apagado no auth: o perfil sobrevive
  -- porque a FK foi perdida, e com ele os tickets. Precisa atravessar.
  ('aaaaaaaa-0000-4000-8000-000000000003','ex@x.test','Ex-agente','agent','2026-02-01 12:00:00', false);

-- Casos normais -------------------------------------------------------
INSERT INTO public.services
  (id, user_id, client_email, product, service_date, status, created_at,
   platform, channel, contact_reason, current_owner_id) VALUES
  ('11111111-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',
   'cliente1@x.test','Arialief','2026-09-20T00:00:00-03:00','registered','2026-09-20 14:00:00',
   'Cartpanda','Email','duvida_de_uso','aaaaaaaa-0000-4000-8000-000000000001'),

  -- Formato ANTIGO de data (+00:00). São 22.320 linhas em produção, e
  -- 6.778 mudariam de dia se convertidas com recorte de string.
  ('11111111-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001',
   'cliente2@x.test','Arialief','2026-02-10T02:00:00+00:00','registered','2026-02-10 02:00:00',
   'Buygoods','SMS','duvida_de_envio','aaaaaaaa-0000-4000-8000-000000000001'),

  -- "Nenhum" e vazio: 10.686 e 26.764 em produção. Têm de continuar distintos.
  ('11111111-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000001',
   'cliente3@x.test','Arialief','2026-09-21T00:00:00-03:00','registered','2026-09-21 10:00:00',
   'Nenhum','Nenhum','duvidas_geral','aaaaaaaa-0000-4000-8000-000000000001'),
  ('11111111-0000-4000-8000-000000000004','aaaaaaaa-0000-4000-8000-000000000001',
   'cliente4@x.test','Arialief','2026-09-21T00:00:00-03:00','registered','2026-09-21 11:00:00',
   NULL,NULL,'duvidas_geral','aaaaaaaa-0000-4000-8000-000000000001'),

  -- Erro de digitação: 1 linha contra 997 de 'LogiCall'.
  ('11111111-0000-4000-8000-000000000005','aaaaaaaa-0000-4000-8000-000000000001',
   'cliente5@x.test','Arialief','2026-09-22T00:00:00-03:00','registered','2026-09-22 09:00:00',
   'Logicall','Email','duvida_de_uso','aaaaaaaa-0000-4000-8000-000000000001'),

  -- 'Clickbank' como CANAL: 3.710 linhas. Uso deliberado, não engano.
  ('11111111-0000-4000-8000-000000000006','aaaaaaaa-0000-4000-8000-000000000001',
   'cliente6@x.test','Arialief','2026-09-22T00:00:00-03:00','registered','2026-09-22 10:00:00',
   'ClickBank','Clickbank','duvida_de_uso','aaaaaaaa-0000-4000-8000-000000000001'),

  -- [C8] Concluído na coluna e SEM follow-up: 1.220 em produção.
  -- Se o fallback falhar, este reabre como "novo".
  ('11111111-0000-4000-8000-000000000007','aaaaaaaa-0000-4000-8000-000000000001',
   'cliente7@x.test','Arialief','2026-05-10T00:00:00-03:00','concluido','2026-05-10 09:00:00',
   'Cartpanda','Email','duvida_de_uso','aaaaaaaa-0000-4000-8000-000000000001'),

  -- Ticket do agente desativado: 5.665 linhas em produção dependem disso.
  ('11111111-0000-4000-8000-000000000008','aaaaaaaa-0000-4000-8000-000000000003',
   'cliente8@x.test','Arialief','2026-02-15T00:00:00-03:00','registered','2026-02-15 09:00:00',
   'Cartpanda','Email','duvida_de_uso','aaaaaaaa-0000-4000-8000-000000000003'),

  -- Telefone no campo de e-mail: 22.446 linhas, todas no canal SMS.
  ('11111111-0000-4000-8000-000000000009','aaaaaaaa-0000-4000-8000-000000000001',
   '+5511999998888','Arialief','2026-09-23T00:00:00-03:00','registered','2026-09-23 09:00:00',
   'Cartpanda','SMS','duvida_de_envio','aaaaaaaa-0000-4000-8000-000000000001'),

  -- Reembolso SEM número de pedido: 4.985 em produção. A restrição é
  -- NOT VALID, então o histórico entra e a regra vale só para escrita nova.
  ('11111111-0000-4000-8000-000000000010','aaaaaaaa-0000-4000-8000-000000000001',
   'cliente10@x.test','Arialief','2026-09-24T00:00:00-03:00','registered','2026-09-24 09:00:00',
   'Cartpanda','Email','reembolso','aaaaaaaa-0000-4000-8000-000000000001');

-- Casos que DEVEM virar rejeito ---------------------------------------
INSERT INTO public.services
  (id, user_id, client_email, product, service_date, status, created_at, contact_reason) VALUES
  -- Ano 1997 e ano 0025: 6 linhas em produção.
  ('22222222-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',
   'antigo@x.test','Arialief','1997-05-10T00:00:00-03:00','registered','2026-01-01 09:00:00','duvida_de_uso'),
  ('22222222-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001',
   'absurdo@x.test','Arialief','0025-01-01T00:00:00-03:00','registered','2026-01-01 09:00:00','duvida_de_uso'),
  -- Produto vazio.
  ('22222222-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000001',
   'semproduto@x.test',NULL,'2026-09-01T00:00:00-03:00','registered','2026-09-01 09:00:00','duvida_de_uso'),
  -- Motivo que não existe no enum.
  ('22222222-0000-4000-8000-000000000004','aaaaaaaa-0000-4000-8000-000000000001',
   'motivo@x.test','Arialief','2026-09-01T00:00:00-03:00','registered','2026-09-01 09:00:00','motivo_inventado'),
  -- Agente que não existe em profiles.
  ('22222222-0000-4000-8000-000000000005','ffffffff-0000-4000-8000-00000000ffff',
   'semagente@x.test','Arialief','2026-09-01T00:00:00-03:00','registered','2026-09-01 09:00:00','duvida_de_uso');

-- Interações ----------------------------------------------------------
INSERT INTO public.service_follow_ups
  (id, service_id, user_id, follow_up_number, status, recorded_at, observation) VALUES
  ('33333333-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001',1,'em_andamento','2026-09-20 15:00:00-03','primeiro'),
  -- Número REPETIDO: 12.753 linhas em produção, 98% no número 1.
  ('33333333-0000-4000-8000-000000000002','11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001',1,'em_andamento','2026-09-20 16:00:00-03','duplicado'),
  ('33333333-0000-4000-8000-000000000003','11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001',1,'concluido','2026-09-20 17:00:00-03','conclui'),
  -- Ticket 2: uma interação em andamento.
  ('33333333-0000-4000-8000-000000000004','11111111-0000-4000-8000-000000000002',
   'aaaaaaaa-0000-4000-8000-000000000001',1,'em_andamento','2026-02-10 10:00:00-03','andamento'),
  -- Órfã: aponta para ticket que virou rejeito.
  ('33333333-0000-4000-8000-000000000005','22222222-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001',1,'em_andamento','2026-01-02 10:00:00-03','orfa');
