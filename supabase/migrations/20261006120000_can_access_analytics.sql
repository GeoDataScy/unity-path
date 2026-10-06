-- Liberação individual do Data Analytics do Suporte para quem não é gestora.
-- Desde o PR #128 o time de copy entra só na Área de Copy; esta flag devolve o
-- Data Analytics a uma pessoa específica sem mudar a regra do time inteiro.
-- O front (src/lib/roles.ts, AreaGrants) lê a coluna nos guards de área. O banco
-- não muda: can_view_support_analytics() já libera gestora + copy.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_access_analytics boolean NOT NULL DEFAULT false;

-- Mateus Maialle (copy_grup) — pedido de 06/10/2026.
UPDATE public.profiles
   SET can_access_analytics = true
 WHERE id = 'e2b130ad-1fb8-4577-8589-dcf974574010';
