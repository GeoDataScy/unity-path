
Objetivo (entendido do seu pedido)
- Na tela do agente (/workspace → Atendimentos), logo abaixo do “Vamos lá, {Nome} 🚀”, adicionar **3 cards de métricas do dia**, alinhados e com bom espaçamento:
  1) **Total de atendimentos hoje**: quantidade de atendimentos do agente logado no dia atual.
  2) **Distância do líder**:
     - Se o agente for o líder do dia: mostrar “Parabéns! Você está na liderança” + ícone de troféu.
     - Caso contrário: “Você está X atendimentos atrás de ‘Nome do líder’”.
  3) **Atendimentos para alcançar a meta**: meta diária fixa = 100; mostrar `max(0, 100 - total_hoje)`.

Regras importantes
- “Hoje” será calculado no fuso **Brasil (São Paulo)**.
- Sempre que o agente **registrar** ou **deletar** um atendimento, os cards devem **atualizar automaticamente** (sem recarregar a página).
- A UI não pode causar sobreposição com o formulário ou a tabela já existentes.

Diagnóstico do que já existe (base atual)
- A página do agente é `src/pages/agent/Atendimentos.tsx`.
- O agente já possui:
  - listagem `useMyServicesQuery(["services","me"])`
  - mutations para criar/atualizar/deletar atendimentos, invalidando `["services","me"]`.
- O banco tem a tabela `services` (com `service_date` como `timestamptz`) e `profiles` (com `full_name`).
- Já existe precedente de “agregação de métricas no backend” via RPC (`dashboard_metrics`), o que é ideal para performance e para evitar múltiplas queries no cliente.

Decisão técnica (como vamos calcular as métricas)
- Vou criar uma função no backend (RPC) específica para o agente, com **resultado mínimo necessário** (sem expor dados sensíveis):
  - Retorna:
    - `my_count` (total do agente no dia)
    - `leader_count` (total do líder do dia)
    - `leader_name` (nome do líder do dia)
  - A função usará o usuário logado (`auth.uid()`) e calculará o “dia” usando São Paulo:
    - Comparação por dia: `((service_date AT TIME ZONE 'America/Sao_Paulo')::date = target_date)`
- Isso evita:
  - buscar todos os atendimentos do dia no front-end,
  - depender de regras de timezone no cliente,
  - múltiplas requisições para “leaderboard”.

Plano de implementação (passo a passo)

1) Backend: criar RPC “agent_daily_metrics”
- Adicionar uma migração criando a função:
  - Nome sugerido: `public.agent_daily_metrics(target_date date default (now() at time zone 'America/Sao_Paulo')::date)`
  - Retorno: `jsonb` com `{ my_count, leader_count, leader_name }`
  - Lógica:
    - Garantir usuário autenticado (`auth.uid() is not null`), caso contrário erro.
    - Contar atendimentos do usuário logado no dia (`my_count`).
    - Buscar o líder do dia:
      - `select user_id, count(*) as c from services where day=target_date group by user_id order by c desc limit 1`
      - join em `profiles` para obter `leader_name` (fallback “Sem nome”).
    - Montar o jsonb.
- Por que via função?
  - Mais rápido/consistente e já segue o padrão do dashboard.
  - Evita inconsistência com `timestamptz` + “hoje” em timezone diferente.

2) Frontend: criar um hook de query para as métricas do agente
- Criar um hook em `src/features/agent/` (ex.: `useAgentDailyMetricsQuery.ts`):
  - `queryKey`: `["agent", "daily-metrics", { date: todayISO }]`
  - `queryFn`: chamar `supabase.rpc("agent_daily_metrics", { target_date: todayISO })`
  - `enabled`: somente quando houver sessão (e/ou `Boolean(userId)`).
  - Configurar:
    - `staleTime: 0` (para aceitar invalidação imediata)
    - `refetchOnWindowFocus: true` (bom para quando o agente volta para a aba)
    - Opcional: `refetchInterval: 15000` (auto-refresh suave), mas o principal será a invalidação no create/delete.

3) UI: adicionar os 3 cards abaixo do título
- Em `src/pages/agent/Atendimentos.tsx`:
  - Logo após o `<h1>Vamos lá...` inserir uma `<section>` com grid responsiva:
    - `grid gap-4 md:grid-cols-3`
    - Cards com `CardHeader` compacto + `CardContent` com número/texto.
  - Card 1: “Total de atendimentos hoje”
    - Exibir número grande (formatado pt-BR).
  - Card 2: “Distância do líder”
    - Se `my_count >= leader_count` e o líder for o próprio agente: mostrar:
      - texto “Parabéns! Você está na liderança”
      - ícone `Trophy` (lucide-react)
    - Caso contrário:
      - calcular `gap = leader_count - my_count`
      - texto: `Você está ${gap} atendimentos atrás de '${leader_name}'`
      - (se `leader_name` vier vazio/null, fallback “Sem nome”)
  - Card 3: “Atendimentos para alcançar a meta”
    - meta fixa = 100
    - exibir `remaining = Math.max(0, 100 - my_count)`
- Estado de loading:
  - Enquanto carrega, usar `Skeleton` (já existe no projeto) para evitar “pulo” de layout.
- Garantia de layout:
  - Cards ficam entre o H1 e o formulário atual, com `mb`/`mt` adequado para não colidir.

4) Atualização automática quando criar/deletar atendimento
- No `onSuccess` do `createMutation` e `deleteMutation` (em `Atendimentos.tsx`):
  - Além de invalidar `["services", "me"]`, também invalidar:
    - `["agent", "daily-metrics", { date: todayISO }]` (ou invalidar por prefixo `["agent", "daily-metrics"]` para simplificar).
- Resultado:
  - Ao registrar/deletar, a lista e os cards atualizam juntos.

5) Validação final (checklist de testes)
- Com 2+ agentes:
  - Agente A registra 3 atendimentos hoje → card total = 3; meta = 97; distância do líder correta.
  - Agente B registra 5 atendimentos hoje → B vê mensagem de liderança; A vê “2 atrás de B”.
  - Ao deletar 1 atendimento de B → atualizar instantaneamente e recalcular liderança/gap.
- Conferir transição de dia (São Paulo):
  - perto da meia-noite, “hoje” troca corretamente no cálculo.

Arquivos que serão alterados/criados
- Backend (migração):
  - `supabase/migrations/<timestamp>_agent_daily_metrics.sql` (criar RPC)
- Frontend:
  - Criar `src/features/agent/useAgentDailyMetricsQuery.ts`
  - Editar `src/pages/agent/Atendimentos.tsx` (inserir cards + invalidations)
  - (Se necessário) usar `src/components/ui/skeleton.tsx` que já existe.

Observações e limitações
- Como `service_date` é `timestamptz`, a definição de “hoje” precisa mesmo ser “por timezone”. O uso de `AT TIME ZONE 'America/Sao_Paulo'` resolve isso de forma consistente para todos os agentes.
- A liderança é calculada “por dia”. Se houver empate, a função pode retornar o primeiro encontrado (ordem determinística adicional pode ser incluída, se você quiser).

Próxima decisão (não bloqueante)
- No card “Distância do líder”, você quer mostrar também:
  - o total do líder (ex.: “Giovanna (12)”), ou apenas o nome?
  - Vou começar apenas com o texto que você pediu, e posso ajustar depois rapidamente.
