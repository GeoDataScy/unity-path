# Backlog — decidido depois

Itens levantados pelo levantamento de 26/09/2026 que o dono do projeto optou por resolver
mais tarde. Nenhum deles bloqueia a reconstrução. Estão aqui para não se perderem, com o
número medido e onde encontrar a evidência.

Ordem: por consequência, não por esforço.

---

## Segurança

### B1 · View `lya_agentes` exposta sem login `RESOLVIDO 26/09/2026`

**Corrigido.** O dono executou `REVOKE ALL ON public.lya_agentes FROM anon, authenticated;`
em produção. Verificado depois:

| Teste | Antes | Depois |
|---|---|---|
| `SELECT` anônimo com a chave pública | 47 perfis | `401 permission denied for view` |
| `PATCH` anônimo | `204`, autorizado | `401` |
| Leitura pelo papel da Lya (`lya_sql_ro`) | 47 | 47, intacta |

O texto abaixo fica como registro do que era o problema.

---

Qualquer pessoa com a chave pública do bundle lê os 47 perfis do time (id, nome, cargo,
canal, se está ativo) **sem autenticar**. Um `PATCH` anônimo é aceito com `204`, o que
significa que `full_name`, `is_active` e `is_available` são graváveis de fora.

Causa: view criada sem `security_invoker`, avaliada com poder do dono, contornando as
policies de `profiles`. Os privilégios de `anon` vêm do padrão do schema público.

Correção pronta em `sql/30-correcao-lya-agentes.sql`. A opção mínima e segura é revogar de
`anon` e `authenticated`: a Lya lê essa view pelo papel `lya_sql_ro`, que tem concessão
própria na migration `20260907120000`, então **não quebra**.

Verificado em 26/09/2026 com requisição anônima real. Ver `30-banco-estado-real.md` §9.

### B2 · Função de SQL livre para usuário autenticado `ABERTO`

`lya_exec_sql` executa consulta arbitrária, protegida por expressão regular e proibição de
ponto e vírgula. O filtro é o elo fraco. Na v2 a Lya consulta por papel somente leitura
sobre views, o que fecha o problema; até lá, continua exposta.

### B3 · Privilégio de escrita para `anon` nas 32 tabelas `ABERTO`

É o padrão do Supabase e a proteção por linha segura. O risco real é operacional: tabela
nova sem policy nasce gravável pelo mundo. Virou regra em `00-CONTRATO.md` D2.

---

## Qualidade de dado

Nenhum item abaixo descarta linha. Todos preservam o dado e adiam a decisão.

| # | Item | Linhas | Onde |
|---|---|---|---|
| B4 | Tickets "concluído na tela, aberto no banco". Eram 6.042 em julho, **crescem ~2 mil por mês** | 10.115 | `31-banco-perfil-dados.md` |
| B5 | `client_email` que é **telefone**, 100% no canal SMS | 22.446 | idem |
| B6 | `service_date` em formato antigo; **6.778 mudariam de dia** se convertidos ingenuamente | 22.320 | idem |
| B7 | `follow_up_number` duplicado, 98,1% no número 1 | 12.755 | idem |
| B8 | Ticket de reembolso sem reembolso (trigger de 06/08 sem backfill) | 4.837 | idem |
| B9 | `platform` "Nenhum" versus vazio, mantidos distintos por decisão D5 | 37.430 | idem |
| B10 | E-mails com caixa inconsistente, 179 colisões, mantidos por decisão D6 | 1.501 | idem |
| B11 | Status final ambíguo entre as duas ordens possíveis de desempate | 216 | idem |
| B12 | `refund_value` acima de 2.000, máximo 76.365. Dono confirmou dólar, então é qualidade de dado | 88 | idem |
| B13 | `completion_date` anterior a `request_date` | 40 | idem |
| B14 | Datas absurdas: ano 1997, anos `0025` e `0026` | 6 | idem |

**B5 é o que mais afeta o modelo novo.** Um quinto dos contatos não tem e-mail, tem
telefone. O campo precisa aceitar os dois sem mentir no nome nem perder a validação.

---

## Dívida de processo

### B15 · Registro de migrations parou em 29/07/2026 `ABERTO`

São 123 registradas contra 153 arquivos: 42 pares registrados sob outra versão, **33 nunca
registrados**, 3 que existem só no banco. Agosto e setembro inteiros fora do registro.
Quatro objetos rodam em produção sem migration nenhuma (`lya_files`, `lya_file_rows`,
`external_refunds`, `normalize_order_number`).

Consequência prática: `supabase db push` reaplicaria dezenas de arquivos. Continua proibido.

### B16 · Três pares de migration com o mesmo timestamp `ABERTO`

A ordem entre cada par é alfabética por acaso, não por intenção.

### B17 · A conversão de tipo não está em migration nenhuma `DIAGNOSTICADO`

Zero `ALTER ... TYPE` nos 153 arquivos, mas 15 colunas mudaram de tipo. As 22.320 linhas com
formato `+00:00` param em **10/03/2026**, o que data a conversão. Resolvido pela
reconstrução; fica registrado para não se repetir.

### B18 · `created_at` de 5 tabelas é instante **sem fuso** `TRATADO NA MIGRAÇÃO`

É UTC por convenção, não por tipo. Converter sem declarar o fuso erra 3 horas. Já corrigido
na especificação de migração; listado aqui porque é a classe de erro mais fácil de repetir.

---

## Funcionalidade

### B19 · Seção pronta e nunca exibida `ABERTO`

O componente de repetições no mesmo dia está importado e nunca renderizado. Religar ou
remover é decisão do dono.

### B20 · Contas de teste escondidas por nome `ABERTO`

O dashboard filtra pelas strings "geovani" e "agente teste" dentro do código. Na v2 vira uma
marca no perfil, mas a lista atual precisa ser conferida para não esconder alguém real.

### B21 · Código morto confirmado `ABERTO`

`src/pages/Workspace.tsx` (469 linhas, não roteado) e `useDashboardServicesQuery` (sem
consumidor, e com a pior consulta do repositório: `select *` sem limite). Não serão
migrados. Remover do legado é opcional.

### B22 · `agent_daily_service_counts` preservada como testemunha `DECIDIDO`

Não será migrada, mas também não será removida: serve de conferência independente na
reconciliação. A trilha de dados confirmou que a trigger está viva e atualizando.

### B25 · `concluído` tinha duas definições no legado `MEDIDO 01/10 — DONO DECIDE`

Medido em agosto/2026: das 9.399 aberturas, a contagem de concluídos difere em **15
tickets** entre a regra do legado e a da arquitetura nova. Classificados:

| Causa | Tickets | O que é |
|---|---|---|
| Deriva | 8 | o legado já tem interação que o `core` ainda não recebeu; somem no corte |
| Ordem canônica | 5 | o legado ordena por `follow_up_number`, que tem 5.545 pares duplicados; o novo ordena por `(recorded_at, seq)` — decisão M9 |
| Incoerência do próprio legado | 2 | `services.status` diz `concluido` e o último follow-up diz `em_andamento` |

Os 2 últimos são o caso interessante: **hoje a tela do agente e o modal da gestora
discordam entre si** nesses tickets. O agente deriva do follow-up e vê "em andamento"; o
modal usa `s.status OR último follow-up` e conta como concluído.

A arquitetura nova tem **uma** definição, `derived_status`, mantida por gatilho. O efeito
na gestora é 3 concluídos a menos em 1.888 no mês (0,16%).

Reproduzir a regra antiga exatamente é possível e barato — trocar por
`derived_status = 'concluido' OR legacy_status = 'concluido'`, que só vale para linha com
`legacy_id` e é inócuo para dado novo. Isso resolveria 2 dos 15; os 5 da ordem canônica
não, porque ali a regra antiga é que está errada.

**Decisão do dono:** manter uma definição só (como está), ou reproduzir a antiga para o
número não mudar na virada.

### B26 · Nada na v2 marca `is_same_day_repeat` `RESOLVIDO EM PRODUÇÃO 01/10 — 0009`

A decisão D1 removeu o bloqueio das 18h apoiada na marcação: "é o que evita contar a
conversa duas vezes". Conferido: `core.interactions.is_same_day_repeat` tem `DEFAULT
false`, nenhum gatilho de `core` a calcula e a API só a devolve. As 1.720 marcações que o
`core` tem vieram copiadas do legado na travessia.

**O que fazer:** gatilho `BEFORE INSERT` em `core.interactions` replicando
`public._tg_follow_up_mark_same_day_repeat` (sem rastreio → `false`; senão `now() <
18:00 SP do dia da última interação`), com garantia na suíte. Entra **antes** de qualquer
tela do agente virar.

**Feito:** `0009_marca_repeticao.sql`. A regra é a função `core.same_day_repeat`; o
gatilho a chama com `now()`, deixa intocada a linha com `legacy_id` e ignora o valor que
o chamador mandar. Validada contra as 62.037 interações do legado antes de escrita:
concordância total. 19 garantias, conferidas contra mutação. Aplicada em produção em 01/10; o
árbitro repetido com a função real deu 62.046 de 62.046.

### B27 · "Concluído" sempre passa, e conta na meta `DECISÃO DO DONO — 01/10`

Em produção hoje, o diálogo de acompanhamento desabilita a segunda interação do dia
**exceto** quando o status é "Concluído" (`StatusTrackingDialog.tsx:94`, deliberado desde
30/04/2026, commit `db89cdb`, do dev anterior). Em
45 dias: 439 repetições do mesmo dia antes das 18h sem rastreio, **435 são "Concluído"**,
8 agentes, uma responde por 70%. Estável há 7 semanas — não é regressão.

A marcação `is_same_day_repeat` existe, mas só a seção "Interações repetidas no mesmo
dia" (`/dashboard/alertas`) a lê. **A meta diária e todos os painéis contam o
"Concluído" do mesmo dia como segunda interação.** Em 30/09: 201 na meta com 6
repetidos; 152 com 9.

Três caminhos, e a escolha é de produto, não de código:

| | O que muda | Efeito |
|---|---|---|
| A. Deixar como está | nada | a gestora segue vendo os repetidos em Alertas; a meta segue contando |
| B. Descontar da meta | `_interaction_events` (e o CTE da v2) ignoram `is_same_day_repeat` | o número da meta cai para quem conclui no mesmo dia; o histórico recua junto, salvo recorte por data |
| C. Fechar a exceção | "Concluído" também respeita as 18h, salvo rastreio | o agente não consegue concluir à tarde o que abriu de manhã — foi por isso que a exceção existe |

Na v2 (D1) não há bloqueio nenhum, então B é o único que preserva a intenção declarada.

### B28 · `recorded_at` de linha nova aceita valor do chamador `ACHADO 01/10 — BAIXO`

O legado força `recorded_at := now()` em **todo** insert (`trg_follow_up_force_now`). O
`core` faz `COALESCE(NEW.recorded_at, now())` — aceita o valor enviado, porque a travessia
precisa gravar o instante original. Pela API não há efeito: a rota nunca envia
`recorded_at`. Mas o comentário de `0001` diz "do servidor e imutável, como no legado", e
para linha nova isso só é verdade por disciplina da API, não por garantia do banco.

A marca de B26 não depende disto (usa `now()`). Corrigir é forçar `now()` quando
`legacy_id IS NULL`, e ajustar o teste de `0007` que grava um instante escolhido em linha
nova.

---

## Fora do escopo da reconstrução

### B23 · Chat da Lya usa streaming `EMENDA PENDENTE`

A resposta em fluxo contínuo não cabe no envelope definido em `00-CONTRATO.md` §3. Precisa
de exceção escrita no contrato antes da implementação do módulo de integrações.

### B24 · Upgrade do banco de `t4g.micro` `ADIADO POR DESENHO`

Só depois de remedir com a arquitetura nova. Subir compute antes esconderia o ganho real e
pagaria por um problema que deixou de existir.
