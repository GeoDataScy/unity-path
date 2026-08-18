-- Base de Suporte — conteúdo de consulta do time de suporte.
--
-- Substitui o arquivo HTML solto ("Base de Produtos · XMX Corp") que rodava com
-- senha fixa no JS e guardava as edições da gestora em localStorage — ou seja, o
-- que ela cadastrava vivia só no navegador dela. Agora o conteúdo mora no banco:
-- a gestora edita em /dashboard/base e todo agente enxerga o mesmo em /workspace/base-suporte.
--
-- Três tabelas, todas conteúdo editorial (sem dado de cliente):
--   support_products    — produtos do painel E-mail (nome, URL, bônus, nicho, links)
--   support_sms_brands  — produtos do painel SMS (nome no sistema, número)
--   support_sms_replies — mensagens prontas de SMS, EN + PT, por categoria
--
-- Convenções seguidas:
--   * profiles.id é TEXT -> updated_by é TEXT comparado com auth.uid()::text.
--   * Leitura: qualquer usuário autenticado. Escrita: só is_manager().
--   * Aqui a escrita é CRUD puro, sem regra de negócio, então usa policy de RLS
--     direta em vez de RPC SECURITY DEFINER — a garantia é a mesma (is_manager()),
--     com muito menos superfície de código. Migrations com lógica de verdade
--     (ex.: held_orders) seguem usando RPC.

-- ============================================================================
-- 0) Trigger de updated_at / updated_by (próprio da feature)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.support_base_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid()::text;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 1) support_products — painel "E-mail"
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.support_products (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL,
  funcao     text,
  url        text,
  estrutura  text NOT NULL,
  plataforma text,
  bonus_url  text,
  bonus_tipo text,
  nicho      text,
  sms_number text,
  -- [{"label": "VSL", "url": "https://..."}] — outras páginas de venda do produto
  links      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ativo      boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT support_products_estrutura_chk CHECK (estrutura IN ('nova', 'antiga')),
  CONSTRAINT support_products_bonus_tipo_chk CHECK (bonus_tipo IS NULL OR bonus_tipo IN ('simples', 'super')),
  CONSTRAINT support_products_links_chk CHECK (jsonb_typeof(links) = 'array')
);

-- Nome é a identidade do card para quem usa a tela: barra duplicata ignorando caixa.
CREATE UNIQUE INDEX IF NOT EXISTS support_products_nome_uniq
  ON public.support_products (lower(nome));
CREATE INDEX IF NOT EXISTS idx_support_products_ordem
  ON public.support_products (estrutura, sort_order, nome);

-- ============================================================================
-- 2) support_sms_brands — painel "SMS (Produtos)"
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.support_sms_brands (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL,
  -- Como a brand aparece no sistema de suporte (o agente confere antes de responder).
  sistema    text NOT NULL,
  estrutura  text NOT NULL,
  sms_number text,
  ativo      boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT support_sms_brands_estrutura_chk CHECK (estrutura IN ('nova', 'antiga'))
);

CREATE UNIQUE INDEX IF NOT EXISTS support_sms_brands_nome_uniq
  ON public.support_sms_brands (lower(nome));
CREATE INDEX IF NOT EXISTS idx_support_sms_brands_ordem
  ON public.support_sms_brands (estrutura, sort_order, nome);

-- ============================================================================
-- 3) support_sms_replies — painel "Respostas SMS"
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.support_sms_replies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria  text NOT NULL,
  titulo     text NOT NULL,
  texto_en   text NOT NULL,
  texto_pt   text NOT NULL,
  ativo      boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_support_sms_replies_ordem
  ON public.support_sms_replies (sort_order, categoria, titulo);

-- ============================================================================
-- 4) Triggers de touch
-- ============================================================================
DROP TRIGGER IF EXISTS trg_support_products_touch ON public.support_products;
CREATE TRIGGER trg_support_products_touch
  BEFORE UPDATE ON public.support_products
  FOR EACH ROW EXECUTE FUNCTION public.support_base_touch();

DROP TRIGGER IF EXISTS trg_support_sms_brands_touch ON public.support_sms_brands;
CREATE TRIGGER trg_support_sms_brands_touch
  BEFORE UPDATE ON public.support_sms_brands
  FOR EACH ROW EXECUTE FUNCTION public.support_base_touch();

DROP TRIGGER IF EXISTS trg_support_sms_replies_touch ON public.support_sms_replies;
CREATE TRIGGER trg_support_sms_replies_touch
  BEFORE UPDATE ON public.support_sms_replies
  FOR EACH ROW EXECUTE FUNCTION public.support_base_touch();

-- ============================================================================
-- 5) RLS — todo autenticado lê; só gestora escreve.
--    (SELECT sem filtro de ativo: o admin precisa enxergar os desativados; quem
--     esconde inativo do agente é a query da tela.)
-- ============================================================================
ALTER TABLE public.support_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_sms_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_sms_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_products_select ON public.support_products;
CREATE POLICY support_products_select ON public.support_products
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS support_products_write ON public.support_products;
CREATE POLICY support_products_write ON public.support_products
  FOR ALL USING ((SELECT public.is_manager())) WITH CHECK ((SELECT public.is_manager()));

DROP POLICY IF EXISTS support_sms_brands_select ON public.support_sms_brands;
CREATE POLICY support_sms_brands_select ON public.support_sms_brands
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS support_sms_brands_write ON public.support_sms_brands;
CREATE POLICY support_sms_brands_write ON public.support_sms_brands
  FOR ALL USING ((SELECT public.is_manager())) WITH CHECK ((SELECT public.is_manager()));

DROP POLICY IF EXISTS support_sms_replies_select ON public.support_sms_replies;
CREATE POLICY support_sms_replies_select ON public.support_sms_replies
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS support_sms_replies_write ON public.support_sms_replies;
CREATE POLICY support_sms_replies_write ON public.support_sms_replies
  FOR ALL USING ((SELECT public.is_manager())) WITH CHECK ((SELECT public.is_manager()));

-- ============================================================================
-- 6) Seed — conteúdo que estava fixo no HTML.
--    ON CONFLICT DO NOTHING: reaplicar a migration não sobrescreve edição da gestora.
-- ============================================================================

INSERT INTO public.support_products
  (nome, funcao, url, estrutura, plataforma, bonus_url, bonus_tipo, nicho, sms_number, links, sort_order)
VALUES
  ('Alpha Rock', 'Vitalidade', 'https://alpharock.store/', 'nova', 'CartPanda · Digistore · BuyGoods', 'https://alpharock.store/bonus/', 'super', 'Adulto', NULL, '[]'::jsonb, 0),
  ('Quiet Nerves', 'Nervos / Ansiedade', 'https://quietnerves.com/', 'nova', NULL, NULL, NULL, 'Pain Relief', NULL, '[{"label":"Principal","url":"https://pa.quietnerves.com"},{"label":"VSL","url":"https://pa.quietnerves.com/vsl"}]'::jsonb, 1),
  ('Flow Strong', 'Próstata', 'https://flowstrong.store/', 'nova', 'CartPanda', 'https://flowstrong.store/bonus', NULL, 'Próstata', NULL, '[]'::jsonb, 2),
  ('Mind Wake', 'Memória', 'https://bg.mindwake.store/', 'nova', 'BuyGoods', 'https://bg.mindwake.store/bonus/', NULL, 'Memory', NULL, '[{"label":"CartCandy","url":"https://cc.mindwake.store/"},{"label":"BuyGoods VSL","url":"https://bg.mindwake.store/vsl/"}]'::jsonb, 3),
  ('Mind Recall', 'Memória', 'https://mindrecall.store/', 'nova', 'CartPanda', NULL, NULL, 'Memory', NULL, '[{"label":"BuyGoods","url":"https://bg.mindrecall.store/"},{"label":"BuyGoods VSL","url":"https://bg.mindrecall.store/vsl"}]'::jsonb, 4),
  ('Lipo Shape', 'Emagrecimento', 'https://liposhape.store/', 'nova', NULL, 'https://liposhape.store/bonus/', 'super', 'Emagrecimento', NULL, '[{"label":"CartCandy","url":"https://hml.liposhape.store/"},{"label":"CartCandy VSL","url":"https://hml.liposhape.store/vsl"}]'::jsonb, 5),
  ('Ring Silence', 'Zumbido / Tinnitus', 'https://ringsilence.com/', 'nova', NULL, NULL, NULL, 'Tinnitus', NULL, '[]'::jsonb, 6),
  ('Alitoryn', 'Mau Hálito', 'https://alitoryn.com/', 'antiga', 'CartPanda', NULL, NULL, 'Pain Relief', NULL, '[]'::jsonb, 7),
  ('Alphacur', 'Neuropatia', 'https://alphacur.com/', 'antiga', 'CartPanda', 'https://alphacur.com/bonus/', 'simples', 'Pain Relief', NULL, '[]'::jsonb, 8),
  ('Arialief', 'Neuropatia', 'https://arialief.com/', 'antiga', 'CartPanda', 'https://arialief.com/bonus/', 'super', 'Pain Relief', NULL, '[]'::jsonb, 9),
  ('Basmontex', 'Articulação', 'https://basmontex.com/', 'antiga', 'CartPanda', NULL, NULL, 'Joint', NULL, '[]'::jsonb, 10),
  ('Blinzador', 'Fungos', 'https://blinzador.com/', 'antiga', 'CartPanda', 'https://blinzador.com/bonus/', 'super', 'Fungos', '855-603-5786', '[]'::jsonb, 11),
  ('Ceramiri', 'Saúde Ocular', 'https://ceramiri.com/', 'antiga', 'CartPanda', 'https://ceramiri.com/bonus/', 'simples', 'Visão', NULL, '[]'::jsonb, 12),
  ('Cognivex', 'Memória', 'https://cognivex.store/', 'antiga', 'CartPanda', 'https://cognivex.store/bonus/', 'super', 'Memory', NULL, '[]'::jsonb, 13),
  ('Curve Reset', 'Perda de Peso', 'https://cc.curvereset.com/', 'antiga', 'CartCandy', 'https://cc.curvereset.com/bonus/', NULL, 'Emagrecimento', NULL, '[]'::jsonb, 14),
  ('Feilaira', 'Articulação', 'https://feilaira.com/', 'antiga', 'CartPanda', 'https://feilaira.com/bonus/', 'super', 'Joint', NULL, '[]'::jsonb, 15),
  ('Garaherb', 'Vitalidade', 'https://garaherb.com/', 'antiga', 'CartPanda', 'https://garaherb.com/bonus/', 'super', 'Adulto', NULL, '[]'::jsonb, 16),
  ('GlucoMid', 'Glicose', 'https://glucomild.com/', 'antiga', 'CartPanda', NULL, NULL, 'Blood Pressure', NULL, '[]'::jsonb, 17),
  ('Gluco Off', 'Glicose', 'https://glucooff.com/', 'antiga', 'CartPanda', 'https://glucooff.com/bonus/', 'super', 'Blood Sugar', NULL, '[]'::jsonb, 18),
  ('Goldenfrib', 'Digestivo', 'https://goldenfrib.com/', 'antiga', 'CartPanda', 'https://goldenfrib.com/bonus/', 'simples', 'Constipação', NULL, '[]'::jsonb, 19),
  ('Jertaris', 'Próstata', 'https://jertaris.store/', 'antiga', 'CartPanda', 'https://www.jertaris.store/bonus/', 'super', 'Próstata', NULL, '[]'::jsonb, 20),
  ('Karylief', 'Saúde Auditiva', 'https://karylief.com/', 'antiga', 'CartPanda', 'https://www.karylief.com/bonus/', 'super', 'Tinnitus', NULL, '[]'::jsonb, 21),
  ('Keskara', 'Articulação', 'https://cp.keskara.online/', 'antiga', 'CartPanda', NULL, NULL, 'Adulto', NULL, '[]'::jsonb, 22),
  ('Korvizol', 'Articulação', 'https://korvizol.com/', 'antiga', 'CartPanda', 'https://www.korvizol.com/bonus/', 'simples', 'Pain Relief', NULL, '[]'::jsonb, 23),
  ('Kymezol', 'Articulação', 'https://kymezol.com/', 'antiga', 'CartPanda', 'https://www.kymezol.com/bonus/', 'simples', 'Tinnitus', NULL, '[]'::jsonb, 24),
  ('Laellium', 'Perda de Peso', 'https://laellium.com/', 'antiga', 'CartPanda', 'https://laellium.com/bonus/', 'super', 'Emagrecimento', NULL, '[]'::jsonb, 25),
  ('LipoLegs', 'Circulação', 'https://lipolegs.com/', 'antiga', 'CartPanda', 'https://lipolegs.com/bonus/', 'super', 'Lipedema', NULL, '[]'::jsonb, 26),
  ('Mahgryn', 'Perda de Peso', 'https://mahgryn.com/', 'antiga', 'CartPanda', 'https://www.mahgryn.com/bonus/', 'super', 'Emagrecimento', NULL, '[]'::jsonb, 27),
  ('Memoryon', 'Memória', 'https://memoryon.store/', 'antiga', 'CartPanda', 'https://www.memoryon.store/bonus/', 'super', 'Memory', NULL, '[{"label":"BuyGoods DTC","url":"https://bg.memoryon.store/dtc-b/"},{"label":"BuyGoods VSL","url":"https://bg.memoryon.store/vsl/"}]'::jsonb, 28),
  ('Memyts', 'Memória', 'https://memyts.com/', 'antiga', 'CartPanda', 'https://memyts.com/bonus/', 'super', 'Memory', NULL, '[]'::jsonb, 29),
  ('Nad Dermal+', 'Rejuvenescimento', 'https://naddermalplus.com/', 'antiga', 'CartPanda', 'https://naddermalplus.com/bonus/', 'super', 'Skin', NULL, '[]'::jsonb, 30),
  ('Nerve Ease', 'Alívio dos Nervos', 'https://nerveease.info/', 'antiga', 'CartPanda · ClickBank', 'https://nerveease.info/bonus/', 'super', 'Pain Relief', '888-611-4025', '[{"label":"Principal","url":"https://nerveease.info/"},{"label":"VSL","url":"https://nerveease.info/vsl"}]'::jsonb, 31),
  ('Nexburn', 'Perda de Peso', 'https://nexburn.store/', 'antiga', 'CartPanda', 'https://nexburn.store/bonus/', 'super', 'Emagrecimento', NULL, '[]'::jsonb, 32),
  ('Presgera', 'Neuropatia', 'https://presgera.com/', 'antiga', 'CartPanda', 'https://presgera.com/bonus/', 'super', 'Pain Relief', '833-762-2450', '[{"label":"BuyGoods","url":"https://bg.presgera.com/"},{"label":"BuyGoods VSL","url":"https://bg.en.presgera.com/vsl/"},{"label":"CartCandy","url":"https://cc.presgera.com/"},{"label":"CartCandy VSL","url":"https://cc.presgera.com/vsl/"},{"label":"CartPanda","url":"https://cp.en.presgera.com/"},{"label":"CartPanda VSL","url":"https://cp.en.presgera.com/vsl/"},{"label":"ClickBank","url":"https://cb.en.presgera.com/"},{"label":"ClickBank VSL","url":"https://cb.en.presgera.com/vsl"}]'::jsonb, 33),
  ('Sciatilief', 'Nervo Ciático', 'https://sciatilief.com/', 'antiga', 'CartPanda', 'https://sciatilief.com/bonus/', 'super', 'Pain Relief', NULL, '[{"label":"BuyGoods","url":"https://bg.sciatilief.com/"},{"label":"BuyGoods VSL","url":"https://bg.sciatilief.com/vsl/"}]'::jsonb, 34),
  ('Shape-On', 'Emagrecimento', 'https://shapeon.shop/', 'antiga', 'CartPanda', 'https://shapeon.shop/bonus/', 'super', 'Emagrecimento', NULL, '[]'::jsonb, 35),
  ('SteelPower', 'Vitalidade', 'https://steelpower.shop/', 'antiga', 'CartPanda', 'https://steelpower.shop/bonus/', 'super', 'Adulto', '877-837-8418', '[{"label":"Principal","url":"https://steelpower.shop/"},{"label":"VSL","url":"https://steelpower.shop/vsl/"}]'::jsonb, 36),
  ('Tenurima', 'Pressão Arterial', 'https://tenurima.com/', 'antiga', 'CartPanda', 'https://tenurima.com/bonus/', 'simples', 'Blood Pressure', NULL, '[]'::jsonb, 37),
  ('VisualEase', 'Visão', 'https://visualease.store/', 'antiga', 'CartPanda', 'https://visualease.store/bonus/', 'super', 'Visão', NULL, '[{"label":"VSL","url":"https://visualease.store/vsl"}]'::jsonb, 38),
  ('Velynivo', 'Rejuvenescimento', 'https://velynivo.com/', 'antiga', 'CartPanda', NULL, NULL, 'Skin', NULL, '[]'::jsonb, 39),
  ('Skin Fortify', 'Pele / Rejuvenescimento', 'https://bg.skinfortify.shop/', 'nova', 'BuyGoods', NULL, NULL, 'Skin', NULL, '[{"label":"BuyGoods","url":"https://bg.skinfortify.shop/"},{"label":"BuyGoods VSL","url":"https://bg.skinfortify.shop/vsl/"}]'::jsonb, 40),
  ('Zerevest', 'Articulação', 'https://zerevest.com/', 'antiga', 'CartPanda', 'https://zerevest.com/bonus', 'simples', 'Fungos', NULL, '[]'::jsonb, 41),
  ('Ariovira', 'Alívio da Dor', 'https://ariovira.com/', 'antiga', 'CartPanda', NULL, NULL, 'Pain Relief', NULL, '[]'::jsonb, 42),
  ('Cetacondor', 'Alívio da Dor', 'https://cetacondor.com/', 'antiga', 'CartPanda', NULL, NULL, 'Pain Relief', NULL, '[]'::jsonb, 43),
  ('Nerve Revive', 'Alívio da Dor', 'https://nerverevive.com/', 'nova', NULL, NULL, NULL, 'Pain Relief', NULL, '[]'::jsonb, 44),
  ('Deep Ease', 'Alívio da Dor', 'https://deepease.com/', 'nova', NULL, NULL, NULL, 'Pain Relief', NULL, '[]'::jsonb, 45),
  ('Kedafila', 'Vitalidade / Masculino', 'https://kedafila.com/', 'antiga', 'CartPanda', NULL, NULL, 'Adulto', NULL, '[]'::jsonb, 46),
  ('Erectozyn', 'Vitalidade / Masculino', 'https://erectozyn.com/', 'antiga', 'CartPanda', NULL, NULL, 'Adulto', NULL, '[]'::jsonb, 47),
  ('Virilemax', 'Vitalidade / Masculino', 'https://virilemax.com/', 'nova', NULL, NULL, NULL, 'Adulto', NULL, '[]'::jsonb, 48),
  ('Peakrise', 'Vitalidade / Masculino', 'https://peakrises.com/', 'nova', NULL, NULL, NULL, 'Adulto', NULL, '[]'::jsonb, 49),
  ('Firm Flow', 'Vitalidade / Masculino', 'https://firmflow.com/', 'nova', NULL, NULL, NULL, 'Adulto', NULL, '[]'::jsonb, 50),
  ('Cucu Drops', 'Emagrecimento', 'https://cucudrops.com/', 'antiga', 'CartPanda', NULL, NULL, 'Emagrecimento', NULL, '[]'::jsonb, 51),
  ('Lipozen', 'Emagrecimento', 'https://lipozen.com/', 'antiga', 'CartPanda', NULL, NULL, 'Emagrecimento', NULL, '[]'::jsonb, 52),
  ('Levhyn', 'Emagrecimento', 'https://levhyn.com/', 'antiga', 'CartPanda', NULL, NULL, 'Emagrecimento', NULL, '[]'::jsonb, 53),
  ('Laellium Gut', 'Digestivo', 'https://laellium.com/', 'antiga', 'CartPanda', NULL, NULL, 'Constipação', NULL, '[]'::jsonb, 54),
  ('Gut Active', 'Digestivo', 'https://gutactive.com/', 'nova', NULL, NULL, NULL, 'Constipação', NULL, '[]'::jsonb, 55),
  ('Prostate Vital', 'Próstata', 'https://prostatevital.com/', 'antiga', 'CartPanda', NULL, NULL, 'Próstata', NULL, '[]'::jsonb, 56),
  ('Cetadusse', 'Glicose', 'https://cetadusse.com/', 'antiga', 'CartPanda', NULL, NULL, 'Blood Sugar', NULL, '[]'::jsonb, 57),
  ('Gluco Quiet', 'Glicose', 'https://glucoquiet.com/', 'nova', NULL, NULL, NULL, 'Blood Sugar', NULL, '[]'::jsonb, 58),
  ('Gluco Mild', 'Glicose', 'https://glucomild.com/', 'antiga', 'CartPanda', NULL, NULL, 'Blood Sugar', NULL, '[]'::jsonb, 59),
  ('Gluco Serene', 'Glicose', 'https://glucoserene.com/', 'nova', NULL, NULL, NULL, 'Blood Sugar', NULL, '[]'::jsonb, 60),
  ('Gluco Poise', 'Glicose', 'https://glucopoise.com/', 'nova', NULL, NULL, NULL, 'Blood Sugar', NULL, '[]'::jsonb, 61),
  ('Joint Relax', 'Articulação', 'https://jointrelax.com/', 'antiga', 'CartPanda', NULL, NULL, 'Joint', NULL, '[]'::jsonb, 62),
  ('Joint Mend', 'Articulação', 'https://jointmend.com/', 'nova', NULL, NULL, NULL, 'Joint', NULL, '[]'::jsonb, 63),
  ('Halegryn', 'Memória', 'https://halegryn.com/', 'antiga', 'CartPanda', NULL, NULL, 'Memory', NULL, '[]'::jsonb, 64),
  ('Brain Ignition', 'Memória', 'https://brainignition.com/', 'nova', NULL, NULL, NULL, 'Memory', NULL, '[]'::jsonb, 65),
  ('Ariomyx', 'Pele', 'https://ariomyx.com/', 'antiga', 'CartPanda', NULL, NULL, 'Skin', NULL, '[]'::jsonb, 66),
  ('Nathurex', 'Pele', 'https://nathurex.com/', 'antiga', 'CartPanda', NULL, NULL, 'Skin', NULL, '[]'::jsonb, 67),
  ('Maizkidor', 'Pele', 'https://maizkidor.com/', 'antiga', 'CartPanda', NULL, NULL, 'Skin', NULL, '[]'::jsonb, 68),
  ('Trace Eraser', 'Pele', 'https://traceeraser.com/', 'nova', NULL, NULL, NULL, 'Skin', NULL, '[]'::jsonb, 69),
  ('Velvet Lift', 'Pele', 'https://velvetlift.com/', 'nova', NULL, NULL, NULL, 'Skin', NULL, '[]'::jsonb, 70),
  ('Youth Within', 'Pele', 'https://youthinwithin.com/', 'nova', NULL, NULL, NULL, 'Skin', NULL, '[]'::jsonb, 71),
  ('Beauty Cell', 'Pele', 'https://beautycell.com/', 'antiga', 'CartPanda', NULL, NULL, 'Skin', NULL, '[]'::jsonb, 72),
  ('Clear Gaze', 'Visão', 'https://cleargaze.com/', 'nova', NULL, NULL, NULL, 'Visão', NULL, '[]'::jsonb, 73),
  ('Xelovita', 'Sono', 'https://xelovita.com/', 'antiga', 'CartPanda', NULL, NULL, 'Sleep', NULL, '[]'::jsonb, 74),
  ('Memyts Dream', 'Sono', 'https://memyts.com/', 'antiga', 'CartPanda', NULL, NULL, 'Sleep', NULL, '[]'::jsonb, 75),
  ('Quiet Rest', 'Sono', 'https://quietrest.com/', 'nova', NULL, NULL, NULL, 'Sleep', NULL, '[]'::jsonb, 76),
  ('Artery Balance', 'Colesterol', 'https://arterybala.com/', 'nova', NULL, NULL, NULL, 'Colesterol', NULL, '[]'::jsonb, 77),
  ('Zalovira', 'Imunidade', 'https://zalovira.com/', 'antiga', 'CartPanda', NULL, NULL, 'Immune Support', NULL, '[]'::jsonb, 78),
  ('Guard On', 'Imunidade', 'https://guardon.com/', 'nova', NULL, NULL, NULL, 'Immune Support', NULL, '[]'::jsonb, 79),
  ('Immush', 'Imunidade', 'https://immush.com/', 'nova', NULL, NULL, NULL, 'Immune Support', NULL, '[]'::jsonb, 80),
  ('Resverador', 'Energia / Boost', 'https://resverador.com/', 'antiga', NULL, NULL, NULL, 'Boost', NULL, '[]'::jsonb, 81),
  ('Effect Plus', 'Energia / Boost', 'https://effectplus.com/', 'nova', NULL, NULL, NULL, 'Boost', NULL, '[]'::jsonb, 82),
  ('Olisteren', 'Zumbido', 'https://olisteren.com/', 'antiga', NULL, NULL, NULL, 'Tinnitus', NULL, '[]'::jsonb, 83),
  ('Vita Hear', 'Zumbido', 'https://vitahear.com/', 'nova', NULL, NULL, NULL, 'Tinnitus', NULL, '[]'::jsonb, 84),
  ('Vergolief', 'Vertigem', 'https://vergolief.com/', 'antiga', NULL, NULL, NULL, 'Vertigem', NULL, '[]'::jsonb, 85),
  ('Balance Max', 'Vertigem', 'https://balancemax.com/', 'nova', NULL, NULL, NULL, 'Vertigem', NULL, '[]'::jsonb, 86),
  ('Farulena', 'Intestino', 'https://farulena.com/', 'antiga', NULL, NULL, NULL, 'Gut', NULL, '[]'::jsonb, 87),
  ('Flora Harmony', 'Intestino', 'https://floraharmony.com/', 'nova', NULL, NULL, NULL, 'Gut', NULL, '[]'::jsonb, 88),
  ('Felaromi', 'Vegetais', 'https://felaromi.com/', 'antiga', NULL, NULL, NULL, 'Greens', NULL, '[]'::jsonb, 89),
  ('Prime Greens', 'Vegetais', 'https://primegreens.com/', 'nova', NULL, NULL, NULL, 'Greens', NULL, '[]'::jsonb, 90),
  ('Artery Guard', 'Pressão Arterial', 'https://arteryguard.com/', 'nova', NULL, NULL, NULL, 'Blood Pressure', NULL, '[]'::jsonb, 91),
  ('Danmyts', 'Energia', 'https://danmyts.com/', 'antiga', NULL, NULL, NULL, 'Energy', NULL, '[]'::jsonb, 92),
  ('Cogni Shift', 'Energia', 'https://cognishift.com/', 'nova', NULL, NULL, NULL, 'Energy', NULL, '[]'::jsonb, 93),
  ('Magnesium Uni5', 'Energia', 'https://magnesiumuni5.com/', 'nova', NULL, NULL, NULL, 'Energy', NULL, '[]'::jsonb, 94),
  ('Athentys', 'Concentração', 'https://athentys.com/', 'antiga', NULL, NULL, NULL, 'Concentração', NULL, '[]'::jsonb, 95),
  ('Sharp Focus', 'Concentração', 'https://sharpfocus.com/', 'nova', NULL, NULL, NULL, 'Concentração', NULL, '[]'::jsonb, 96),
  ('Hairbllom', 'Cabelo', 'https://hairbloom.com/', 'antiga', NULL, NULL, NULL, 'Hair', NULL, '[]'::jsonb, 97),
  ('Nerve Relief Protocol', 'Alívio dos Nervos', NULL, 'nova', NULL, NULL, NULL, 'Pain Relief', NULL, '[]'::jsonb, 98),
  ('Nail Defender', 'Fungos', NULL, 'nova', NULL, NULL, NULL, 'Fungos', NULL, '[]'::jsonb, 99),
  ('Honeyfil', 'Vitalidade / Masculino', NULL, 'nova', NULL, NULL, NULL, 'Adulto', NULL, '[]'::jsonb, 100),
  ('Horsefil', 'Vitalidade / Masculino', NULL, 'nova', NULL, NULL, NULL, 'Adulto', NULL, '[]'::jsonb, 101),
  ('Vigor Jelly', 'Vitalidade / Masculino', NULL, 'nova', NULL, NULL, NULL, 'Adulto', NULL, '[]'::jsonb, 102),
  ('Military Honey', 'Vitalidade / Masculino', NULL, 'nova', NULL, NULL, NULL, 'Adulto', NULL, '[]'::jsonb, 103),
  ('Thermo Ignite', 'Emagrecimento', NULL, 'nova', NULL, NULL, NULL, 'Emagrecimento', NULL, '[]'::jsonb, 104),
  ('Lipo Jelly', 'Emagrecimento', NULL, 'nova', NULL, NULL, NULL, 'Emagrecimento', NULL, '[]'::jsonb, 105),
  ('Glyco Barrier', 'Glicose', NULL, 'nova', NULL, NULL, NULL, 'Blood Sugar', NULL, '[]'::jsonb, 106),
  ('Mind Honey Trick', 'Memória', NULL, 'nova', NULL, NULL, NULL, 'Memory', NULL, '[]'::jsonb, 107),
  ('Honey Protocol', 'Memória', NULL, 'nova', NULL, NULL, NULL, 'Memory', NULL, '[]'::jsonb, 108)
ON CONFLICT DO NOTHING;

INSERT INTO public.support_sms_brands (nome, sistema, estrutura, sms_number, sort_order)
VALUES
  ('AlphaRock', 'Path to Optimal Health and Life', 'nova', '888-771-6273', 0),
  ('Alitoryn', 'Advanced Network for Health and Wellness', 'antiga', NULL, 1),
  ('Alphacur', 'Alphacur', 'antiga', NULL, 2),
  ('Arialief', 'Arialief', 'antiga', NULL, 3),
  ('Blinzador', 'Blinzador', 'antiga', NULL, 4),
  ('Cognivex', 'Health Focus Journal', 'antiga', NULL, 5),
  ('Feilaira', 'Feilaira', 'antiga', NULL, 6),
  ('Garaherb', 'Garaherb', 'antiga', NULL, 7),
  ('GlucoOff', 'Integrated Center for Wellbeing & Health', 'antiga', '844-526-1914', 8),
  ('GoldenFrib', 'Evidence Based Health Review', 'antiga', NULL, 9),
  ('Jertaris', 'Jertaris', 'antiga', NULL, 10),
  ('Karylief', 'Karylief', 'antiga', NULL, 11),
  ('Korvizol', 'Korvizol', 'antiga', NULL, 12),
  ('Kymezol', 'Goldenfrib', 'antiga', NULL, 13),
  ('Laellium', 'Laellium', 'antiga', NULL, 14),
  ('Mahgryn', 'Mahgryn', 'antiga', NULL, 15),
  ('MemoryOn', 'MemoryOn', 'antiga', NULL, 16),
  ('Memyts', 'Memyts', 'antiga', NULL, 17),
  ('NadDermal', 'Nad Dermal', 'antiga', '833-432-8037', 18),
  ('Nerve Ease', 'Natural Health & Wellness Consulting', 'antiga', NULL, 19),
  ('NexBurn', 'NexBurn', 'antiga', '833-717-0451', 20),
  ('Presgera', 'Presgera', 'antiga', NULL, 21),
  ('ShapeOn', 'ShapeOn', 'antiga', '833-712-6476', 22),
  ('SteelPower', 'Virilis Science', 'antiga', NULL, 23),
  ('Tenurima', 'Tenurima', 'antiga', NULL, 24),
  ('Velynivo', 'Velynivo', 'antiga', NULL, 25),
  ('Visual Ease', 'Lifelong Health Review', 'antiga', '833-775-0653', 26)
ON CONFLICT DO NOTHING;

-- Respostas SMS não têm chave natural (o mesmo título pode existir em categorias
-- diferentes), então o seed só roda se a tabela estiver vazia.
INSERT INTO public.support_sms_replies (categoria, titulo, texto_en, texto_pt, sort_order)
SELECT * FROM (VALUES
  ('Atendimento Geral', 'Abertura', 'Hi (cliente), thank you for reaching out to our support team. How can I assist you today?', 'Olá (cliente)! Obrigado por entrar em contato com o nosso suporte. Como posso te ajudar hoje?', 0),
  ('Atendimento Geral', 'Cliente satisfeito / Boas-vindas', 'Thank you for your trust! Remember that great results come with time, and we''re right here to support you.', 'Obrigado pela confiança! Lembre-se de que grandes resultados vêm com o tempo e estamos aqui para te apoiar!', 1),
  ('Atendimento Geral', 'Localizar pedido / Pedir e-mail', 'Hi (cliente). To help me locate your order and see what happened, could you please confirm the email address used for the purchase?', 'Olá (cliente). Para eu localizar seu pedido e entender o que houve, você poderia confirmar o e-mail que usou na compra?', 2),
  ('Atendimento Geral', 'Pedido não encontrado', 'We couldn''t locate your order with the email you provided. Could you please check if you used a different email for the purchase?', 'Não encontramos seu pedido com o e-mail informado. Poderia verificar se usou outro endereço de e-mail na compra?', 3),
  ('Atendimento Geral', 'Cliente quer ligar', 'We handle all of our customer care exclusively via SMS. It helps us keep track of everything and help you faster! What can I do for you?', 'Realizamos nosso atendimento exclusivamente por SMS. Isso nos ajuda a registrar seu histórico e ajudar você mais rápido! Como posso ajudar hoje?', 4),
  ('Atendimento Geral', 'Cliente irritado', 'I completely understand your frustration. Please be assured that I want to resolve this fairly for you.', 'Compreendo perfeitamente sua insatisfação. Tenha certeza de que estou aqui para resolver essa situação da melhor forma possível para você.', 5),
  ('Atendimento Geral', 'Cliente desconfiado', 'I understand your concern. Please be assured that we follow strict, legitimate policies and are fully committed to supporting you securely.', 'Entendo sua preocupação. Garantimos que seguimos políticas rigorosas e legítimas para oferecer um suporte totalmente seguro a você.', 6),
  ('Atendimento Geral', 'Cobrança desconhecida', 'Please be assured that we do not authorize unapproved charges. I am checking our system right now to see exactly what happened here.', 'Fique tranquilo, pois não autorizamos cobranças sem o seu consentimento. Já estou verificando nosso sistema para entender o que aconteceu.', 7),
  ('Atendimento Geral', 'VIP questionado', 'Our VIP membership is designed to provide exclusive savings and premium benefits. May I briefly explain the advantages to see if it fits your needs?', 'Nossa assinatura VIP oferece economias exclusivas e vantagens premium. Posso explicar brevemente os benefícios para ver se atende às suas necessidades?', 8),
  ('Atendimento Geral', 'Início de atendimento', 'Hello, this is official support. I''m here to assist you in the best way possible today.', 'Olá, aqui é do suporte oficial. Estou à disposição para ajudar você da melhor forma possível hoje.', 9),
  ('Atendimento Geral', 'Confirmação de dados', 'We could not locate the order with the information provided so far. So I can verify it correctly, please send the full name used during the purchase.', 'Não localizamos o pedido com os dados enviados até o momento. Para que eu possa verificar corretamente, envie o nome completo utilizado na compra.', 10),
  ('Atendimento Geral', 'Atualização de canal', 'Dear Customer, due to an issue with our previous channel, Steel Support is continuing assistance through this number. Please provide your request, purchase email, and order number.', 'Prezado(a), devido a uma instabilidade em nosso canal anterior, o Suporte Steel está dando continuidade ao atendimento por este número. Informe sua solicitação, e-mail da compra e nº do pedido.', 11),
  ('Atendimento Geral', 'Desconfiança', 'I understand your concern. We work with clear policies, active support, and full order tracking.', 'Entendo sua preocupação. Trabalhamos com políticas claras, suporte ativo e total acompanhamento dos pedidos.', 12),
  ('Resultados e Uso', 'Sem resultados (Geral)', 'We''re here to help you get the best results. To support you better, could you share your daily routine and how many capsules you''re taking?', 'Queremos te ajudar a ter o melhor resultado. Para te apoiar melhor, poderia nos contar como está sua rotina e quantas cápsulas toma por dia?', 13),
  ('Resultados e Uso', '2 semanas de uso', 'Two weeks is just the beginning! Adjusting the timing often makes a big difference. How many capsules are you currently taking each day?', 'Duas semanas é só o começo! Ajustar o horário de uso costuma fazer uma grande diferença. Quantas cápsulas você está tomando por dia atualmente?', 14),
  ('Resultados e Uso', '30–45 dias sem resultado', 'Thank you for your consistency (cliente). To help us optimize your results at this stage, could you please confirm if you are taking 2 daily?', 'Obrigado pela constância (cliente). Para nos ajudar a otimizar seus resultados nesta etapa, você poderia confirmar se está tomando 2 cápsulas por dia?', 15),
  ('Resultados e Uso', 'Ajuste de dose', 'For the best results, we recommend taking 2 daily before your meals. Would you be open to trying this adjustment to see how it works?', 'Para melhores resultados, nós recomendamos tomar 2 por dia antes das refeições. Toparia tentar esse ajuste para ver como seu corpo reage?', 16),
  ('Resultados e Uso', 'Tempo e constância', 'Great results come with consistency. Most of our customers notice a positive difference within 4 to 8 weeks of regular daily use!', 'Grandes resultados vêm com constância. A maioria dos clientes nota uma diferença positiva entre 4 a 8 semanas de uso diário e regular.', 17),
  ('Resultados e Uso', 'Suplemento natural', 'The product is natural, made with plant-based ingredients and has no known contraindications. You may use it with confidence.', 'O produto é natural, com ingredientes de origem vegetal e sem contraindicações conhecidas. Pode utilizar com tranquilidade.', 18),
  ('Ingredientes e Saúde', 'Ingredientes / Segurança', 'Hi (cliente)! Rest assured, our supplement is made with natural, plant-based ingredients and has no known contraindications. We''re here if you need anything!', 'Olá (cliente)! Fique tranquilo, nosso suplemento é natural, feito com ingredientes à base de plantas e sem contraindicações. Estamos aqui se precisar!', 19),
  ('Ingredientes e Saúde', 'Interação com medicação', 'Hi (cliente)! For best absorption, we recommend a 30-minute gap between our supplement and other medications. Let us know if you have any questions.', 'Olá (cliente)! Para melhor absorção, sugerimos um intervalo de 30 minutos entre o nosso suplemento e outros medicamentos. Qualquer dúvida conte conosco!', 20),
  ('Ingredientes e Saúde', 'Médico suspendeu o uso', 'We fully respect that. Could you please let us know how long you used the product? We may recover part of the value.', 'Nós respeitamos totalmente isso. Poderia nos informar por quanto tempo usou o produto? Nós podemos recuperar parte do valor.', 21),
  ('Ingredientes e Saúde', 'Orientação médica — cliente hesitante', 'We respect your doctor''s view. Our product is natural and drug-free, but your comfort matters. I can authorize a 50% refund right now if you prefer.', 'Respeitamos a visão do seu médico. Nosso produto é natural, mas o seu bem-estar vem primeiro. Posso autorizar 50% de reembolso agora se preferir.', 22),
  ('Reembolso — Abertura', 'Reembolso solicitado', 'Before processing the refund, I''d love to help improve your results. Could you please share how you''ve been using the product?', 'Antes do reembolso, eu gostaria muito de ajudar a melhorar seus resultados. Você poderia me contar como tem usado o produto atualmente?', 23),
  ('Reembolso — Abertura', 'Motivo do reembolso', 'To help me assist you properly with the next steps, could you please share the reason for the refund?', 'Para que eu possa te ajudar da melhor forma com os próximos passos, você poderia me informar o motivo do reembolso?', 24),
  ('Reembolso — Abertura', 'Efeitos colaterais', 'I''m so sorry to hear that. Your safety is our priority. Could you tell me how you took it and if it was combined with any other medication?', 'Sinto muito por isso. Sua segurança é nossa prioridade. Poderia me contar como foi o uso e se tomou junto com algum outro medicamento?', 25),
  ('Reembolso — Abertura', 'Reembolso +60 dias', 'Unfortunately, the 60-day refund period has passed, so we''re unable to process it. Let us know if we can assist you with anything else.', 'Infelizmente, o prazo de 60 dias para reembolso já expirou e não conseguimos prosseguir. Conte conosco se precisar de outra ajuda.', 26),
  ('Reembolso — Abertura', 'Quero reembolso', 'I understand you. Before you lose your full investment, I''d like to help in the best way possible. Many situations can be resolved with simple adjustments or special conditions. What exactly happened?', 'Entendo você. Antes de perder totalmente seu investimento, quero tentar ajudar da melhor forma possível. Muitas situações conseguimos resolver com ajustes simples ou condições especiais. O que aconteceu exatamente?', 27),
  ('Reembolso — Abertura', 'Garantia expirada', 'We understand your request, however the order has already exceeded the 60-day guarantee period. For this reason, unfortunately, it is no longer possible to issue a refund for this purchase.', 'Entendemos sua solicitação, porém o pedido já ultrapassou o período de garantia de 60 dias. Por esse motivo, infelizmente não é mais possível emitir um reembolso para esta compra.', 28),
  ('Reembolso — Ofertas Parciais', 'Oferta 20%', 'Your experience means everything to us. To help out, I can issue a 20% refund right now so you save money and stay with us. Can we apply it?', 'Sua experiência é muito importante para nós. Para ajudar, posso liberar um reembolso de 20% agora mesmo para você economizar e continuar conosco. Podemos aplicar?', 29),
  ('Reembolso — Ofertas Parciais', 'Oferta 30%', 'I checked internally and got you a 30% refund. You keep the product (no return needed) and cut your costs. Sound good?', 'Verifiquei internamente e consegui 30% de reembolso para você. Não precisa devolver o produto e você reduz seu custo. O que acha?', 30),
  ('Reembolso — Ofertas Parciais', 'Oferta 40%', 'I checked internally and can increase our offer to a 40% refund, with no need to return anything. You save money and keep the item. Deal?', 'Verifiquei internamente e posso aumentar nossa oferta para 40% de reembolso, sem necessidade de devolução. Você economiza e fica com o produto. Combinado?', 31),
  ('Reembolso — Ofertas Parciais', 'Oferta 50%', 'I just got a 50% refund approved for you! No need to return anything — you recover half your money and keep using the product. Can I apply this?', 'Acabo de aprovar 50% de reembolso para você! Não precisa devolver nada — você recupera metade do dinheiro e continua usando o produto. Posso aplicar?', 32),
  ('Reembolso — Ofertas Parciais', 'Oferta 60%', 'I managed to secure a 60% refund for you as a special exception! No need to return anything — you keep the product and get most of your money back.', 'Consegui garantir 60% de reembolso como uma exceção especial! Não precisa devolver nada — você fica com o produto e recebe a maior parte do dinheiro de volta.', 33),
  ('Reembolso — Ofertas Parciais', 'Oferta 70%', 'I just got a 70% refund approved as a final internal adjustment! No return needed — you keep the product and save most of the cost.', 'Aprovei um reembolso de 70% como ajuste interno final! Sem necessidade de devolução — você fica com o produto e economiza a maior parte do custo.', 34),
  ('Reembolso — Ofertas Parciais', 'Oferta 75%', 'I just got a 75% refund approved as our final adjustment today! No need to return anything — you keep the product and save big. Shall I apply it?', 'Consegui 75% de reembolso como nosso ajuste final de hoje! Não precisa devolver nada — você fica com o produto e economiza muito. Posso aplicar?', 35),
  ('Reembolso — Ofertas Parciais', 'Clickbank 80% / 100%', 'I can release an 80% refund now with no return needed! Or, get a 100% refund if you return it (shipping at your cost). Which one works best for you?', 'Posso liberar 80% de reembolso agora sem devolução! Ou 100% de reembolso se você devolver o produto (frete por sua conta). Qual opção funciona melhor para você?', 36),
  ('Reembolso — Ofertas Parciais', 'Política — Taxa de 20%', 'Our policy includes a 20% admin fee on returns. To make things easier for you, I can offer a _% refund right now without needing a return.', 'Nossa política prevê uma taxa de 20% na devolução. Para facilitar, posso te oferecer _% de reembolso agora mesmo, sem precisar de devolução.', 37),
  ('Reembolso — Ofertas Parciais', 'Reembolso efetuado', 'Your refund has been processed and is on its way to your original payment method. The exact timing will just depend on your bank.', 'Seu reembolso já foi processado e está a caminho da sua forma de pagamento original. O prazo exato agora depende do seu banco.', 38),
  ('Reembolso — Ofertas Parciais', 'Reembolso máximo + devolução', 'To proceed with the maximum refund, please fill out the form and return the bottles. Note that shipping is not covered and a 20% admin fee applies.', 'Para prosseguir com o reembolso máximo, basta preencher o formulário e enviar os frascos. Lembrando que o frete é por conta do cliente e há uma taxa de 20%.', 39),
  ('Reembolso — Ofertas Parciais', 'Oferta 20% (alternativa)', 'To improve your experience, I can release 20% immediately with no return required.', 'Para melhorar sua experiência, consigo liberar 20% imediato sem necessidade de devolução.', 40),
  ('Reembolso — Ofertas Parciais', 'Oferta 30% (alternativa)', 'I spoke with the responsible department and secured 30% immediately with no return required.', 'Conversei com o setor responsável e consegui liberar 30% imediato sem devolução.', 41),
  ('Reembolso — Ofertas Parciais', 'Oferta 40% (alternativa)', 'I secured an important exception for your case: 40% immediate and you still keep the product.', 'Consegui uma exceção importante para seu caso: 40% imediato e você permanece com o produto.', 42),
  ('Reembolso — Ofertas Parciais', 'Oferta 50% (alternativa)', '50% immediate has been approved as the definitive solution for your case.', 'Autorizaram 50% imediato como solução definitiva para seu caso.', 43),
  ('Reembolso — Ofertas Parciais', 'Oferta 60% (alternativa)', 'I secured special approval for 60% immediately with no return required.', 'Consegui autorização especial para 60% imediato sem devolução.', 44),
  ('Reembolso — Ofertas Parciais', 'Oferta 70% (alternativa)', '70% has been approved as the final internal adjustment with no return required.', '70% foi aprovado como ajuste final interno sem necessidade de devolução.', 45),
  ('Reembolso — Ofertas Parciais', 'Oferta 75% (alternativa)', '75% is the highest approved condition today with no return required.', '75% é a condição máxima aprovada hoje sem devolução.', 46),
  ('Reembolso — Ofertas Parciais', 'Clickbank 80%/100% (alternativa)', 'I can release 80% immediately with no return as an exclusive resolution. Or 100% through formal return. Which option would you prefer?', 'Posso liberar 80% imediato sem devolução como condição exclusiva para encerrar isso rapidamente. Ou 100% mediante devolução formal. Qual opção prefere?', 47),
  ('Devolução e Logística', 'Formulário de devolução', 'To proceed, please fill out the form at the link below and share the code generated at the end: https://form.typeform.com/to/cLzSIMM7', 'Para prosseguir, por favor preencha o formulário no link abaixo e me envie o código gerado ao final: https://form.typeform.com/to/cLzSIMM7', 48),
  ('Devolução e Logística', 'Endereço de devolução', 'Please ship to: Biofraga, 19655 E 35th Dr, Suite 100, Aurora CO 80011, USA. Kindly add your email and order ID inside so we can quickly find your account!', 'Por favor, envie para: Biofraga, 19655 E 35th Dr, Suite 100, Aurora CO 80011, USA. Não esqueça de colocar seu e-mail e nº do pedido dentro do pacote!', 49),
  ('Devolução e Logística', 'Devolução sem instruções', 'Since the return was sent without our instructions, could you please share the carrier, tracking number, and email used to help us find it?', 'Como a devolução foi feita sem nossas instruções, você poderia nos informar a transportadora, código de rastreio e e-mail para localizarmos?', 50),
  ('Devolução e Logística', 'Rastreio do pedido', 'Your order is on its way. You can track your package easily right here: [link de rastreio]', 'Seu pedido já está a caminho! Você pode acompanhar a entrega do seu pacote facilmente por aqui: [link de rastreio]', 51),
  ('Devolução e Logística', 'Endereço errado', 'Your order was returned due to an address inconsistency. We want to ensure a successful delivery; could you please confirm your updated shipping details?', 'Seu pedido retornou devido a uma inconsistência no endereço. Queremos garantir a entrega; poderia nos confirmar os dados de envio atualizados?', 52),
  ('Pedidos e Logística', 'Pedido a caminho / Paciência', 'Your order is already in transit. We kindly ask for a little patience, as your area is farther from our distribution center. We are monitoring the delivery to ensure everything arrives properly.', 'Seu pedido já está em trânsito. Pedimos apenas um pouco de paciência, pois sua região fica mais distante do nosso centro de distribuição. Estamos acompanhando a entrega para garantir que tudo chegue corretamente.', 53),
  ('Pedidos e Logística', 'Pedido em trânsito — cancelamento negado', 'Your order has already shipped and is currently in transit. For this reason, cancellation is no longer possible at this stage.', 'Seu pedido já foi enviado e está em trânsito. Por esse motivo, o cancelamento não pode mais ser realizado neste momento.', 54)
) AS v(categoria, titulo, texto_en, texto_pt, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.support_sms_replies);
