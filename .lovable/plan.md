
Objetivo (o que será entregue)
- Criar uma nova tela do agente chamada **“Minhas métricas”**, acessível por um botão/item na **sidebar** do agente.
- A tela terá:
  - **Filtro por período** via calendário (DateRangePicker) para o agente escolher um intervalo de dias.
  - **Cards (KPIs)** que mudam conforme o filtro.
  - **Gráfico de linha** (atendimentos por dia) + **linha da média** do período.
  - **Tabela diária** (dia, total, variação vs dia anterior, tendência visual com cores).
  - **Mix de produtos** (gráfico de pizza/donut com top produtos no período), seguindo o mesmo estilo do dashboard.
- Backend: criar uma **estrutura de dados no banco** para facilitar puxar métricas diárias do agente com performance e consistência (principalmente para gráficos e médias), sem quebrar as regras de segurança.

O que já existe e vamos reaproveitar
- Tabela `services` já é a fonte primária dos atendimentos (com RLS: agente vê os próprios).
- Já existe componente de calendário reutilizável: `src/components/dashboard/DateRangePicker.tsx`.
- Já existe uso de `recharts` no Manager Dashboard (`src/pages/Dashboard.tsx`) e tokens de cor da plataforma em `src/index.css`.
- Já existe “métrica do dia” via RPC: `agent_daily_metrics(target_date date)`.

Decisões importantes (alinhadas com o que você pediu)
- **Os números serão sempre diários**: “dia” será calculado em **horário de São Paulo** (America/Sao_Paulo), para evitar drift de UTC.
- **Filtro por período**: será o único filtro por enquanto (sem filtro por agente, pois é “Minhas métricas”).
- **Período padrão**: últimos **7 dias** (incluindo hoje).
- **Gráfico principal**: **linha por dia + linha horizontal da média do período**.
- “Completo (mais cards)”: vou entregar uma versão “rica” com KPIs úteis e leitura rápida da evolução, mas sem “inventar” métricas que não existam ainda (ex.: qualidade, conversão, etc.). O foco será atendimentos e produtos.

Parte 1 — Roteamento e Sidebar (frontend)
1) Nova rota do agente
- Adicionar em `src/App.tsx` uma rota nova dentro de `/workspace`:
  - `/workspace/metricas` -> página “Minhas métricas”.

2) Botão na sidebar do agente
- Atualizar `src/components/agent/AgentSidebar.tsx`:
  - Adicionar item “Minhas métricas” com ícone (ex.: `LineChart` do lucide-react).
  - Garantir que a rota destaque corretamente quando ativa (como já é feito hoje).

Parte 2 — Nova tela “Minhas métricas” (frontend)
1) Criar página
- Criar arquivo: `src/pages/agent/MinhasMetricas.tsx`
- Estrutura visual (seguindo padrão de outras telas do agente):
  - Header com título + texto descritivo.
  - Filtro (DateRangePicker) no topo, com período padrão “últimos 7 dias”.

2) Estado do filtro
- Estado `DateRange` (react-day-picker).
- Conversão para `fromISO` e `toISO` (YYYY-MM-DD), sempre interpretando em São Paulo.
- Comportamento:
  - Se o usuário selecionar só “from”, tratamos como período de 1 dia.
  - Se não tiver seleção, usar padrão últimos 7 dias.

3) Consultas de dados (React Query)
- Criar hook: `src/features/agent/useMyMetricsRangeQuery.ts`
  - Busca métrica agregada no período para o usuário autenticado.
- Criar hook: `src/features/agent/useMyProductMixQuery.ts` (ou similar)
  - Busca contagens por produto no período (top N).

4) KPIs (Cards) que mudam com o período
KPIs propostos (todos recalculados conforme período):
- **Total no período** (soma do período)
- **Média diária do período** (total / número de dias no intervalo)
- **Melhor dia** (dia com maior número de atendimentos no intervalo)
- **Tendência** (indicador simples de evolução):
  - Ex.: comparação entre média da “primeira metade do período” vs “segunda metade do período” em %.
  - Exibição com cor:
    - Verde (status-success) se evoluiu
    - Amarelo (status-open) se ficou estável
    - Vermelho (destructive) se regrediu

5) Gráfico de evolução (linha + média)
- Usar `recharts` como no dashboard do manager, com as mesmas cores/tokens:
  - Linha principal: `hsl(var(--primary))`
  - Linha da média (horizontal): cinza com `hsl(var(--muted-foreground))` e tracejada
- Dados do gráfico:
  - Série por dia no formato `{ day: "dd/MM", value: number, avg: number }`
  - Garantir continuidade preenchendo dias faltantes com 0 (mesmo padrão do Dashboard).

6) Tabela diária (para leitura “cientista de dados”)
- Tabela com colunas:
  - Data (dd/MM/yyyy)
  - Atendimentos do dia
  - Δ vs dia anterior (ex.: +3, -2) com cor (verde/vermelho)
  - Observação opcional (ex.: “Acima da média” / “Abaixo da média”)
- Ordenação: por data ascendente (para acompanhar evolução) ou descendente (mais recente primeiro). Vou usar ascendente para combinar com o gráfico.

7) Mix de produtos (gráfico + lista)
- Gráfico donut (PieChart) com top produtos do período
- Lista (ou tooltip) com:
  - Nome do produto
  - Contagem
  - % do total do período (quando fizer sentido)

Parte 3 — “Tabela no banco” para métricas (backend / schema)
Você pediu explicitamente “precisamos de uma tabela no banco para puxar todos os dados dos agentes”.
Para atender isso de forma correta e útil para gráficos/médias, vou criar uma tabela de **agregação diária por agente** (um “fato diário”):

1) Nova tabela (agregados diários)
- Criar tabela: `agent_daily_service_counts`
  - `day date not null` (dia em São Paulo)
  - `user_id uuid not null`
  - `service_count integer not null default 0`
  - `updated_at timestamptz not null default now()`
  - PK composta `(user_id, day)` ou unique `(user_id, day)` + id opcional
- Índices:
  - `(user_id, day)` para range queries

2) Backfill inicial
- Ao criar a tabela, popular com histórico existente em `services`:
  - `INSERT INTO agent_daily_service_counts (...) SELECT user_id, (service_date AT TIME ZONE 'America/Sao_Paulo')::date as day, count(*) ... group by ...`

3) Mantendo a tabela sempre atualizada (trigger)
- Criar função `refresh_agent_daily_service_count(p_user_id uuid, p_day date)`:
  - Recalcula `count(*)` na `services` para aquele `user_id` e `day` e faz UPSERT em `agent_daily_service_counts`.
- Criar trigger em `services` AFTER INSERT/UPDATE/DELETE:
  - Em INSERT: recalcular para `(NEW.user_id, NEW_day)`
  - Em DELETE: recalcular para `(OLD.user_id, OLD_day)`
  - Em UPDATE: se mudou `user_id` e/ou `service_date`, recalcular para ambos (old e new)
- Isso garante que:
  - O agente pode registrar/editar/excluir e os números refletem automaticamente
  - As métricas “zeram” no dia seguinte de forma natural (porque a contagem é por `day`)

4) Segurança (RLS)
- Habilitar RLS na `agent_daily_service_counts`.
- Políticas:
  - Agente: pode SELECT somente onde `user_id = auth.uid()`
  - Manager: pode SELECT todos (usando `is_manager()` que já existe)
  - Sem INSERT/UPDATE/DELETE pelo cliente (somente via trigger/funções do banco)

Parte 4 — Funções (RPC) para retornar dados prontos (backend)
Para entregar consultas simples e rápidas para o frontend (e evitar lógica pesada no cliente), vou criar RPCs que retornam JSON pronto.

1) RPC: `agent_metrics_range(from_date date, to_date date)`
- Retorna jsonb com:
  - `total_count`
  - `avg_daily`
  - `best_day` (YYYY-MM-DD) e `best_day_count`
  - `by_day`: array ordenado com `{ day: 'YYYY-MM-DD', value: int }`
  - `trend_pct`: % (segunda metade vs primeira metade) e um label (“Evoluindo/Estável/Regredindo”)
- Implementação: lê de `agent_daily_service_counts` filtrando `user_id = auth.uid()` e `day between ...`.

2) RPC: `agent_product_mix(from_date date, to_date date, top_n int default 10)`
- Retorna array jsonb com `{ name: product, value: count }`
- Implementação: agregação direta na tabela `services` no período (porque produto é detalhe do registro, não do agregado diário).

Parte 5 — Integração final (frontend ↔ backend)
- “Minhas métricas” vai chamar:
  - `agent_metrics_range` para cards + gráfico + tabela (diário)
  - `agent_product_mix` para donut de produtos
- Tudo sempre com sessão autenticada (mesmo padrão das queries existentes)

Arquivos que serão criados/alterados (resumo)
Frontend
- Editar: `src/App.tsx` (nova rota)
- Editar: `src/components/agent/AgentSidebar.tsx` (novo item “Minhas métricas”)
- Criar: `src/pages/agent/MinhasMetricas.tsx`
- Criar: `src/features/agent/useMyMetricsRangeQuery.ts`
- Criar: `src/features/agent/useMyProductMixQuery.ts` (ou nome equivalente)

Backend (migração)
- Criar tabela: `agent_daily_service_counts`
- Criar índices
- Backfill inicial a partir de `services`
- Criar função `refresh_agent_daily_service_count`
- Criar trigger em `services` (insert/update/delete)
- Criar RPCs:
  - `agent_metrics_range(from_date, to_date)`
  - `agent_product_mix(from_date, to_date, top_n)`
- Criar RLS policies adequadas na tabela de agregados

Checklist de testes (end-to-end)
1) Navegação
- Entrar como agente → ver “Minhas métricas” na sidebar → abrir `/workspace/metricas`.

2) Período padrão
- Ao abrir, carregar últimos 7 dias:
  - Cards exibem valores coerentes
  - Gráfico mostra 7 pontos (com zeros em dias sem atendimento)
  - Tabela lista o período corretamente

3) Filtro por calendário
- Selecionar um intervalo diferente → todos os cards/gráficos/tabelas atualizam.

4) Consistência com inserção/edição/exclusão
- Registrar um atendimento em “Atendimentos” → voltar em “Minhas métricas” → números refletem o novo registro.
- Editar a data de um atendimento (mudando de dia) → confirmar que o dia antigo decrementa e o novo incrementa.
- Excluir um atendimento → confirmar decremento.

5) Segurança
- Confirmar que um agente não consegue ver dados de outro (RLS).
- Confirmar que manager (se entrar nessa tela por engano) não terá acesso indevido (na prática manager é redirecionado para /dashboard, mas as policies também protegem).

Riscos e cuidados
- Triggers em `services` precisam ser bem feitos para não gerar contagens erradas em UPDATE (quando muda o dia) — vou tratar “old day” e “new day” separadamente.
- Como `service_date` é timestamptz, sempre vou calcular `day` via `(service_date AT TIME ZONE 'America/Sao_Paulo')::date` no backend para consistência absoluta.
- Volume de dados alto: a tabela agregada diária evita fazer `COUNT(*)` direto em `services` para cada render, melhorando performance do gráfico e KPIs.

Definições finais já confirmadas com você
- Reset diário: à meia-noite (horário de São Paulo)
- Botão “Hoje”: calendário
- Período padrão da tela: últimos 7 dias
- Gráfico: linha por dia + média

Próximos incrementos possíveis (não entram nesta entrega, mas ficam prontos para evoluir)
- Comparar com meta (100/dia) no gráfico (linha horizontal da meta).
- Comparar período atual vs período anterior.
- Adicionar insights “estatísticos”: desvio padrão, consistência, streak (dias seguidos), melhor sequência, etc.
