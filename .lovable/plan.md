
Contexto do pedido
- Você quer 3 comportamentos:
  1) Quando passar de 100 atendimentos/dia, o card “Total de atendimentos hoje” continue subindo normalmente (101, 102, 150…).
  2) A barra de progresso deve parar em 100% (não passar de 100).
  3) Os cards são diários e precisam zerar no “reset” diário.
- Nas suas respostas agora, você confirmou:
  - Reset diário: **à meia-noite (horário de São Paulo)** (não às 20:00).
  - Botão “Hoje” no formulário: **hoje do calendário** (não o “dia de meta”).

O que está acontecendo hoje (estado atual)
- “Total de atendimentos hoje” já usa o contador real (my_count) e já continua subindo acima de 100.
- A barra de progresso já é limitada em 100% (cálculo usa Math.min(100, ...)).
- Porém, o texto ao lado da barra (ex.: “x/100”) hoje está “travado” em 100/100 quando passa da meta porque ele usa `Math.min(effectiveCount, goal)`. Isso dá a sensação de que não está subindo, mesmo subindo no card.

Mudanças que vou fazer (frontend)
1) Mostrar o contador real acima de 100 no texto “x/100”
- Arquivo: `src/features/agent/components/AgentDailyMetricsSection.tsx`
- Trocar o trecho que renderiza o texto ao lado da barra:
  - De: `Math.min(effectiveCount, goal)/goal`
  - Para: `effectiveCount/goal`
- Resultado:
  - Card “Total de atendimentos hoje”: continua subindo (já sobe).
  - Texto ao lado da barra: passa a mostrar, por exemplo, “132/100”.
  - Barra: continua parando em 100% (já para).

2) Garantir que o “reset diário” continua correto (meia-noite SP)
- Não vou mudar horário de reset para 20:00, porque você escolheu “reinicia à meia-noite”.
- O backend já calcula o “dia” usando São Paulo, então ao virar o dia (00:00 SP) o contador volta a 0 automaticamente.
- O mecanismo de “Meta Batida 1x por dia” (localStorage) já usa a data do dia em São Paulo; portanto, também “zera” automaticamente no dia seguinte.

Arquivos que serão alterados
- `src/features/agent/components/AgentDailyMetricsSection.tsx`
  - Ajuste no texto “x/100” para não limitar em 100.

Checklist de testes (end-to-end)
1) Teste de UI em DEV
- Abra Atendimentos e clique em “Simular meta batida (DEV)”.
- Confira:
  - “Total de atendimentos hoje” mostra 100
  - Barra fica em 100%
  - Texto ao lado da barra mostra “100/100”
- Depois, eu posso te adicionar (se você quiser) uma segunda simulação “+20 acima da meta” para validar “120/100” e barra em 100%.

2) Teste real com dados acima de 100
- Registre atendimentos até passar de 100.
- Confirme:
  - “Total de atendimentos hoje” continua subindo (ex.: 101, 102…)
  - Barra fica travada em 100%
  - Texto mostra “101/100”, “120/100”, etc.

3) Teste de virada de dia (meia-noite SP)
- No dia seguinte, validar que os cards começam do zero e contam novamente.

Observação importante sobre “20:00”
- Como você escolheu “reinicia à meia-noite”, não vou implementar virada às 20:00.
- Se você mudou de ideia e quer mesmo “virar o dia às 20:00”, isso exige ajuste também no cálculo do backend (para considerar um “dia de meta” diferente do calendário). Posso preparar isso num próximo passo, com cuidado para não bagunçar relatórios/contagens.
