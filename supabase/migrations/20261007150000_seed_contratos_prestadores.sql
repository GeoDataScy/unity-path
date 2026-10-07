-- Razão social e CNPJ dos prestadores (ajuste 5 do doc XMX-2026/IMP-SUP-01-A v2).
--
-- Ids fixos, conferidos com o usuário em 07/10/2026 (casamento por nome feito
-- fora da migration). Ficaram de fora: Ester (gestora), o perfil manager da
-- Jessica, a "Ana" (anav.business1@) e Gislane, Veronica e Victória (sem conta).
--
-- CNPJ gravado com máscara, como veio da lista. Só preenche campo nulo: o que a
-- gestora já digitou em Usuários → Contrato nunca é sobrescrito. Capacidade,
-- pacote, contrato e vigência não são tocados.
--
-- TODO(v2): portar para o core na virada da arquitetura v2.

INSERT INTO public.provider_contracts (user_id, razao_social, cnpj) VALUES
  ('3b561989-a6c3-4106-92e5-8ddcade4c791', 'ANA CAROLINA GOMES DA SILVA',       '62.729.600/0001-42'), -- Ana Carolina
  ('db70f80f-ff4c-4763-9ebd-0f08c36c1835', 'GIOVANNA GODOY AQUINO',             '62.826.853/0001-34'), -- Giovanna Godoy
  ('0e094fc1-ece8-496a-852b-f460196fb899', 'GABRIELLE ANDRADE ROSA',            '62.824.136/0001-73'), -- Gabrielle Andrade
  ('8598aaa5-6817-4273-a87e-739b3d36e5a1', 'JESSICA OLIVEIRA SANTOS MACHADO',   '51.968.052/0001-97'), -- Jessica Machado (agent)
  ('3d93da6b-596d-4610-846a-8f30de202ee7', 'JULIA PAULINO MACHADO',             '45.957.351/0001-23'), -- Júlia Paulino
  ('af85fc34-2113-4eba-9483-6f5f404d6588', 'MARCIO DE BARROS SILVA JUNIOR',     '57.751.270/0001-51'), -- Márcio Barros
  ('cccdf5a2-19b9-45f5-9936-8e05ff6ef7ba', 'SABRINA JOHANSEN TADEI',            '66.822.497/0001-31'), -- Sabrina
  ('69bee46d-7e33-4edf-9ee8-cc76fdeae81e', 'JONATAN COSTA FREITAS',             '67.709.149/0001-15'), -- Jonatan Costa
  ('7be240d0-d51d-4fab-b4da-0cca9e64a11b', 'KETLEN RODRIGUES MACEDO',           '67.739.673/0001-39'), -- Ketlen Macedo
  ('b45cfef3-2dd0-449d-a013-3be538b84458', 'THAYLANE ALVES REINALDO',           '68.094.831/0001-03'), -- Thaylane Alves
  ('8a00e37b-309d-45d6-8346-e6f9d0197b31', 'HARYANE RODRIGUES FRANÇA DE JESUS', '69.291.635/0001-91'), -- Haryane
  ('629c5527-d119-4eb0-894c-f96dcb41d2c7', 'ALICIA MIRELLA DA SILVA',           '37.161.842/0001-35'), -- Alicia
  ('53fb8c6d-d8ff-4d89-9cf2-525906eb1261', 'DIEGO SILVA DE OLIVEIRA',           '58.364.653/0001-30')  -- Diego
ON CONFLICT (user_id) DO UPDATE
  SET razao_social = COALESCE(public.provider_contracts.razao_social, EXCLUDED.razao_social),
      cnpj         = COALESCE(public.provider_contracts.cnpj,         EXCLUDED.cnpj);
