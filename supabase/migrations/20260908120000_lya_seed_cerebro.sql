-- ============================================================================
-- 20260908120000_lya_seed_cerebro.sql
-- Cérebro da Lya: memórias de EXEMPLO (seed = true) e a RPC que as remove.
--
-- Por que existe: o grafo do Cérebro nasce vazio e a gestora não tem por onde
-- começar. Estas 45 memórias mostram o que ela pode ensinar — regras do
-- sistema (notas), telas do painel (referências), preferências de resposta e
-- treinamentos possíveis (projetos marcados como exemplo) — já ligadas entre si
-- por [[wikilinks]] e tags, para o grafo ter forma.
--
-- Todas entram com seed = true: o botão "Remover exemplos" (lya_delete_seed_memories)
-- apaga só elas, sem tocar no que a gestora ensinou. Editar uma memória de
-- exemplo pela tela a mantém como seed; é de propósito — a gestora decide quando
-- limpar. Idempotente: ON CONFLICT (name) DO NOTHING.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lya_delete_seed_memories()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.lya_memories WHERE seed = true;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.lya_delete_seed_memories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lya_delete_seed_memories() TO authenticated, service_role;

INSERT INTO public.lya_memories (name, description, type, tags, body, seed)
SELECT v.name, v.description, v.type, v.tags, v.body, true
FROM (VALUES
  ('quem-e-a-lya', 'Quem é a Lya', 'user', '["lya", "perfil"]'::jsonb, 'A Lya é a assistente de inteligência do Painel da Gestora do suporte da XMX. Responde só com o que está no painel, no banco e na Base de Suporte, e diz de onde tirou cada número. Ver [[Para quem a Lya responde]].'),
  ('para-quem-a-lya-responde', 'Para quem a Lya responde', 'user', '["lya", "perfil", "gestora", "copy"]'::jsonb, 'Responde para a gestora do suporte e para o time de copy (só leitura). Quando a pergunta não define período, usa o período e o agente selecionados na barra lateral. Ver [[Papéis do sistema]].'),
  ('comecar-pela-resposta', 'Começar pela resposta', 'feedback', '["formato", "concisao"]'::jsonb, 'Em toda resposta, a conclusão vem na primeira frase. Depois os números de apoio, em tabela curta quando forem mais de três. Sem preâmbulo.'),
  ('sempre-dizer-a-fonte-e-o-periodo', 'Sempre dizer a fonte e o período', 'feedback', '["formato", "fonte", "periodo"]'::jsonb, 'Todo número vem acompanhado de onde saiu (tela do painel, banco de dados ou Base de Suporte) e do recorte usado (datas e agente). Ver [[Contagem de atendimentos]].'),
  ('agentes-pelo-primeiro-nome', 'Agentes pelo primeiro nome', 'feedback', '["formato", "agentes"]'::jsonb, 'Ao citar pessoas do time, usar o primeiro nome (como a gestora fala). Em ranking, manter a ordem do painel.'),
  ('grafico-quando-houver-comparacao', 'Gráfico quando houver comparação', 'feedback', '["formato", "grafico"]'::jsonb, 'Comparação entre agentes, produtos ou canais vira gráfico de barras; evolução por dia vira linha; participação em um total vira pizza. O texto comenta os destaques, não repete todos os números.'),
  ('separar-reembolso-integral-de-parcial', 'Separar reembolso integral de parcial', 'feedback', '["reembolso", "parcial", "integral", "formato"]'::jsonb, 'Sempre que falar de reembolsos concluídos, separar integral (100%) de parcial e citar a eficiência por canal. Ver [[Reembolso integral e parcial]] e [[Eficiência por canal]].'),
  ('nao-listar-e-mails-em-respostas-agregadas', 'Não listar e-mails em respostas agregadas', 'feedback', '["privacidade", "formato", "cliente"]'::jsonb, 'E-mail de cliente e número de pedido só aparecem quando a pergunta pede o detalhe de um caso. Em totais e rankings, nunca.'),
  ('contagem-de-atendimentos', 'Contagem de atendimentos', 'nota', '["atendimentos", "interacoes", "contagem", "painel"]'::jsonb, 'A tela Atendimentos conta eventos: cada ticket aberto vale 1 e cada follow-up vale 1, no dia de São Paulo. O evento é creditado a quem o registrou. Ver [[Status do ticket]] e [[Fuso horário de São Paulo]].'),
  ('status-do-ticket', 'Status do ticket', 'nota', '["status", "ticket", "follow-up"]'::jsonb, 'O status vivo é o do último follow-up: sem follow-up = Novo; último follow-up concluído = Concluído; senão = Em andamento. O campo status gravado em services não basta. Ver [[Contagem de atendimentos]].'),
  ('meta-diaria-do-agente', 'Meta diária do agente', 'nota', '["meta", "agentes", "sms", "tickets"]'::jsonb, '100 tickets distintos por dia. Sobe para 150 quando a maioria dos atendimentos do agente no período é pelo canal SMS. Um ticket conta uma vez por dia por agente. Ver [[Canais de atendimento]].'),
  ('regra-das-18h', 'Regra das 18h', 'nota', '["follow-up", "regra", "18h", "repeticao"]'::jsonb, 'Um follow-up fica bloqueado até as 18h (São Paulo) do dia da interação anterior do mesmo ticket. Ver [[Repetição no mesmo dia]].'),
  ('repeticao-no-mesmo-dia', 'Repetição no mesmo dia', 'nota', '["follow-up", "repeticao", "violacao", "tracking"]'::jsonb, 'Follow-up registrado no mesmo dia da interação anterior é marcado como repetição (is_same_day_repeat) e conta como violação da [[Regra das 18h]]. Tickets com código de rastreio ficam de fora dessa conta.'),
  ('reembolso-em-aberto-e-concluido', 'Reembolso em aberto e concluído', 'nota', '["reembolso", "status", "periodo"]'::jsonb, 'Em aberto = sem data de conclusão; concluído = com data de conclusão. A tela Reembolsos põe no período os abertos pela data do pedido e os concluídos pela data de conclusão. Ver [[Reembolso em atraso]].'),
  ('reembolso-em-atraso', 'Reembolso em atraso', 'nota', '["reembolso", "alerta", "atraso"]'::jsonb, 'Reembolso em atraso é o que está em aberto com pedido anterior a hoje. É o que aparece na tela Alertas, com os dias de atraso por agente. Ver [[Tela Alertas]].'),
  ('reembolso-integral-e-parcial', 'Reembolso integral e parcial', 'nota', '["reembolso", "parcial", "integral", "eficiencia"]'::jsonb, 'Tipo 100% = integral; qualquer outro valor (50%, 30%) = parcial; vazio = não informado. Ver [[Eficiência por canal]] e [[Motivos de reembolso]].'),
  ('eficiencia-por-canal', 'Eficiência por canal', 'nota', '["reembolso", "canal", "eficiencia"]'::jsonb, 'Eficiência por canal = percentual de reembolsos parciais entre os concluídos do canal. Quanto maior, mais o time evitou devolver 100%. Ver [[Reembolso integral e parcial]].'),
  ('motivos-de-reembolso', 'Motivos de reembolso', 'nota', '["reembolso", "motivo", "categoria"]'::jsonb, 'O motivo escrito pelo agente é classificado em categorias: arrependimento, não reconhece a compra, compra duplicada, cobrança recorrente, atraso na entrega, compra em excesso, dificuldade de uso, problemas técnicos, produto não funcionou, insatisfação, indicação médica, risco de chargeback, reclamação VSL, follow up e outros. Ver [[Reclamação VSL]].'),
  ('atendimento-cria-reembolso', 'Atendimento cria reembolso', 'nota', '["reembolso", "atendimento", "sync"]'::jsonb, 'Um atendimento com motivo reembolso cria automaticamente um reembolso vinculado, que fica invisível para o agente até alguém assumir. Ver [[Motivos de contato]].'),
  ('canais-de-atendimento', 'Canais de atendimento', 'nota', '["canal", "email", "sms", "clickbank"]'::jsonb, 'Canais: Email, SMS, Clickbank e Nenhum. Cada agente tem um canal principal (support_channel). Ver [[Meta diária do agente]].'),
  ('plataformas-de-venda', 'Plataformas de venda', 'nota', '["plataforma", "cartpanda", "clickbank", "buygoods"]'::jsonb, 'Plataformas: Cartpanda, CartCandy, Buygoods, ClickBank, Digistore24, SalesBound, LogiCall, PagAmerican e Nenhum. Aparecem em atendimentos e em reembolsos.'),
  ('motivos-de-contato', 'Motivos de contato', 'nota', '["motivo", "contato", "atendimento"]'::jsonb, 'Dúvida de uso, reembolso, cancelamento de compra, cancelamento de assinatura, reclamação VSL, troca de endereço, embalagem danificada, dúvida de envio, ingredientes, dúvidas geral e outro. Ver [[Reclamação VSL]] e [[Atendimento cria reembolso]].'),
  ('reclamacao-vsl', 'Reclamação VSL', 'nota', '["vsl", "motivo", "copy"]'::jsonb, 'Reclamação VSL e Outro exigem a descrição do agente (qual promessa do anúncio o cliente cobrou). É o motivo que o time de copy acompanha. Ver [[Motivos de contato]].'),
  ('pedidos-em-espera', 'Pedidos em espera', 'nota', '["pedidos", "logistica", "espera"]'::jsonb, 'Pedidos importados por planilha que ficaram retidos na logística. Status pending (aguardando) ou confirmed (confirmado pela gestora); andamento do agente em novo, em andamento e concluído. Ver [[Tela Acompanhamento]].'),
  ('transferencia-de-ticket', 'Transferência de ticket', 'nota', '["transferencia", "ticket", "agentes"]'::jsonb, 'Transferência é um pedido para o dono continuar um ticket; o ticket nunca troca de dono. Ver [[Tomada de ticket na folga]].'),
  ('tomada-de-ticket-na-folga', 'Tomada de ticket na folga', 'nota', '["tomada", "folga", "aprovacao", "ticket"]'::jsonb, 'Quando o dono do ticket está de folga, outro agente pede para assumir e a gestora aprova. Ver [[Transferência de ticket]] e [[Tela Usuários]].'),
  ('papeis-do-sistema', 'Papéis do sistema', 'nota', '["perfil", "gestora", "copy", "agente"]'::jsonb, 'agent = atendente; manager = gestora; copy_grup = time de copy, que entra na área de analytics só para ler. Alertas, Usuários, Base de Suporte e pedidos em espera são só da gestora.'),
  ('fuso-horario-de-sao-paulo', 'Fuso horário de São Paulo', 'nota', '["data", "fuso", "sao-paulo"]'::jsonb, 'Todo dia do painel é o dia de São Paulo. Datas de atendimento e de reembolso são gravadas como texto e convertidas na consulta. Ver [[Contagem de atendimentos]].'),
  ('padrao-de-horarios', 'Padrão de horários', 'nota', '["horarios", "turno", "pico"]'::jsonb, 'A tela Atendimentos mostra o pico por hora e dia da semana, o horário mediano de início e fim, a divisão por turno e a hora em que a meta diária costuma ser batida. Ver [[Meta diária do agente]].'),
  ('tela-atendimentos', 'Tela Atendimentos', 'reference', '["painel", "atendimentos", "tela"]'::jsonb, '/dashboard: total do período, por agente, por produto, por dia, por plataforma e por canal; status dos tickets; padrão de horários; tabela de auditoria. Ver [[Contagem de atendimentos]].'),
  ('tela-reembolsos', 'Tela Reembolsos', 'reference', '["painel", "reembolso", "tela"]'::jsonb, '/dashboard/reembolsos: abertos e concluídos, por agente, tipo, produto, canal, plataforma e motivo; eficiência por canal; auditoria. Ver [[Reembolso em aberto e concluído]].'),
  ('tela-interacoes', 'Tela Interações', 'reference', '["painel", "interacoes", "tela"]'::jsonb, '/dashboard/interacoes: tickets novos, interações e concluídos por agente, média de interações até concluir, taxa de conclusão e repetições no mesmo dia. Ver [[Repetição no mesmo dia]].'),
  ('tela-alertas', 'Tela Alertas', 'reference', '["painel", "alerta", "reembolso", "tela"]'::jsonb, '/dashboard/alertas (só gestora): reembolsos em atraso hoje, por agente, com dias de atraso e a baixa. Ver [[Reembolso em atraso]].'),
  ('tela-acompanhamento', 'Tela Acompanhamento', 'reference', '["painel", "pedidos", "tela"]'::jsonb, '/dashboard/acompanhamento (só gestora): pedidos em espera, distribuição por agente e andamento. Ver [[Pedidos em espera]].'),
  ('tela-usuarios', 'Tela Usuários', 'reference', '["painel", "usuarios", "tela"]'::jsonb, '/dashboard/usuarios (só gestora): time, ativo/inativo, disponível (folga), online agora, tickets em aberto. Ver [[Tomada de ticket na folga]].'),
  ('tela-base-de-suporte', 'Tela Base de Suporte', 'reference', '["painel", "base", "tela", "produtos"]'::jsonb, '/dashboard/base (só gestora edita): produtos do painel e-mail, brands de SMS e respostas prontas. A Lya busca aqui com buscar_base_suporte.'),
  ('tela-zendesk', 'Tela Zendesk', 'reference', '["painel", "zendesk", "tela"]'::jsonb, '/dashboard/zendesk (só gestora): tickets do Zendesk lidos ao vivo. A Lya ainda não lê o Zendesk.'),
  ('hub-atendimentos', 'Hub: atendimentos', 'project', '["hub", "atendimentos"]'::jsonb, 'Tudo que a Lya sabe sobre atendimentos e interações: [[Contagem de atendimentos]], [[Status do ticket]], [[Meta diária do agente]], [[Regra das 18h]], [[Padrão de horários]], [[Tela Atendimentos]], [[Tela Interações]].'),
  ('hub-reembolsos', 'Hub: reembolsos', 'project', '["hub", "reembolso"]'::jsonb, 'Tudo sobre reembolsos: [[Reembolso em aberto e concluído]], [[Reembolso em atraso]], [[Reembolso integral e parcial]], [[Eficiência por canal]], [[Motivos de reembolso]], [[Tela Reembolsos]], [[Tela Alertas]].'),
  ('hub-time', 'Hub: time', 'project', '["hub", "agentes"]'::jsonb, 'Tudo sobre o time: [[Papéis do sistema]], [[Canais de atendimento]], [[Transferência de ticket]], [[Tomada de ticket na folga]], [[Tela Usuários]].'),
  ('treinamento-resumo-diario', 'Treinamento: resumo diário', 'project', '["treinamento", "resumo", "diario", "exemplo"]'::jsonb, 'Exemplo de treinamento que o time pode fazer. Ao pedir o resumo do dia, a Lya traz: total de atendimentos e a comparação com o dia anterior, os 3 agentes mais ativos, reembolsos abertos e em atraso, e as repetições no mesmo dia. Apague ou edite para virar a regra real. Ver [[Começar pela resposta]] e [[Hub: atendimentos]].'),
  ('treinamento-ranking-semanal', 'Treinamento: ranking semanal', 'project', '["treinamento", "ranking", "semanal", "exemplo"]'::jsonb, 'Exemplo de treinamento. Ranking semanal por agente com tickets, interações, taxa de conclusão e meta diária batida em quantos dias; gráfico de barras; primeiro nome. Ver [[Agentes pelo primeiro nome]] e [[Meta diária do agente]].'),
  ('treinamento-leitura-de-reembolsos', 'Treinamento: leitura de reembolsos', 'project', '["treinamento", "reembolso", "exemplo"]'::jsonb, 'Exemplo de treinamento. Ao analisar reembolsos, separar integral de parcial, mostrar a eficiência por canal e os 3 motivos mais frequentes, com o texto original de um caso de cada. Ver [[Separar reembolso integral de parcial]] e [[Hub: reembolsos]].'),
  ('treinamento-alerta-de-atraso', 'Treinamento: alerta de atraso', 'project', '["treinamento", "alerta", "reembolso", "exemplo"]'::jsonb, 'Exemplo de treinamento. Quando perguntarem por atrasos, listar por agente os reembolsos em atraso com dias e pedido, começando pelo mais antigo, e sugerir quem precisa de cobrança. Ver [[Reembolso em atraso]].'),
  ('treinamento-copy-e-vsl', 'Treinamento: copy e VSL', 'project', '["treinamento", "vsl", "copy", "exemplo"]'::jsonb, 'Exemplo de treinamento para o time de copy. Ao perguntarem sobre reclamações de VSL, agrupar por produto e trazer as descrições dos agentes. Ver [[Reclamação VSL]] e [[Motivos de reembolso]].')
) AS v(name, description, type, tags, body)
ON CONFLICT (name) DO NOTHING;

NOTIFY pgrst, 'reload schema';
