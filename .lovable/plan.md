
Objetivo (o que vamos fazer agora)
1) Triplicar a duração do efeito de confete/pulse quando bate a meta (de ~1,6s para ~4,8s), ajustando também a animação das partículas para ficar visualmente “bonita” durante todo o tempo (sem cortar no meio).
2) Em seguida, limpar os dados de teste da agente Giovanna no ambiente de teste (apenas os registros “fake” usados no teste).

Estado atual (como está hoje)
- O confete aparece porque o componente `AgentDailyMetricsSection` liga `celebrate=true` ao cruzar a meta, e renderiza `<ConfettiBurst />`.
- O tempo que o confete fica na tela hoje é definido por:
  - Timeout no `AgentDailyMetricsSection`: 1600ms para desligar `celebrate` e `pulse`.
  - Partículas no `ConfettiBurst`: duração randômica entre ~1100–1700ms e delay até 220ms.
- Resultado prático: o overlay some em 1,6s; algumas partículas poderiam durar um pouco mais, mas são interrompidas quando o overlay desmonta.

Mudanças planejadas (triplicar tempo e “adaptar para ficar bom aos olhos”)
A) Ajustar duração do overlay (o “tempo na tela”)
- Arquivo: `src/features/agent/components/AgentDailyMetricsSection.tsx`
- Trocar o timeout de:
  - `1600ms` -> `4800ms` (triplo)
- Como você escolheu “Pulse 4,8s”, o `pulse` vai acompanhar o mesmo tempo:
  - `setPulse(false)` também após `4800ms`
- Resultado: confete e pulse ficam visíveis por ~4,8s.

B) Ajustar a animação do confete para “preencher” bem esses 4,8s
Problema que vamos evitar:
- Se apenas aumentarmos o timeout para 4,8s mas deixarmos as partículas com 1,1–1,7s, elas “morrem” cedo e ficam ~3s sem nada acontecendo (sensação de bug).

Ajustes no `ConfettiBurst`:
- Arquivo: `src/components/effects/ConfettiBurst.tsx`
- Aumentar a duração das partículas proporcionalmente:
  - Hoje: `durationMs = 1100..1700`
  - Novo alvo: `durationMs = 3300..5100` (aprox. 3x)
- Ajustar o delay para espalhar melhor o início (sem virar “chuva infinita”):
  - Hoje: `delayMs = 0..220`
  - Novo alvo: `delayMs = 0..450` (leve aumento para distribuir mais, mas ainda com “burst” rápido)
- Ajustar a distância percorrida no keyframe para manter movimento natural durante mais tempo:
  - Hoje: desce `160px`
  - Novo alvo: `~280–360px` (vamos calibrar visualmente; em geral 320px fica bom para 4–5s sem parecer lento demais)
- Manter cores discretas, mas garantir legibilidade:
  - Continuar usando `primary`, `status-success` e `muted-foreground` (já está corporativo).
- Como você pediu “um pouco mais” de intensidade:
  - Aumentar `pieces` padrão de `22` para algo como `28–34` (vou começar por 30/32, que costuma ficar sutil ainda).
  - Manter tamanho das partículas igual (para não virar carnaval), a ideia é só ter “vida” na tela durante 4,8s.

C) Garantir que não há “corte” no final
- Importante: o overlay deve ficar tempo suficiente para cobrir o pior caso:
  - `max(delay) + max(duration)` precisa ser <= `4800ms` (ou bem próximo).
- Se usarmos `delay` até 450ms e `duration` até 5100ms, daria 5550ms (cortaria).
- Então vamos alinhar para não cortar:
  - Opção recomendada (eu vou aplicar esta): `durationMs = 2800..4200` e `delayMs = 0..600`, com overlay `4800ms`.
  - Assim o pior caso fica perto de 4800ms e não corta perceptivelmente.
- Resumo de calibração que vou implementar:
  - Overlay: 4800ms
  - Partículas: duração até ~4200ms e delays até ~500–600ms
  - Queda: ~320px

D) Teste visual rápido (para validar “bom aos olhos”)
- No /workspace (logada como agente), ao cruzar 99→100:
  1) Confete deve ficar “ativo” durante quase todo o período de 4,8s (não só no começo).
  2) O número deve pulsar durante 4,8s (como você definiu).
  3) Badge “🏆 Meta Batida!” permanece.
  4) Não deve travar scroll/click (continua `pointer-events-none`).

Limpeza dos dados de teste da Giovanna (ambiente de teste)
Como você escolheu “Só dados de teste”:
- Vamos remover apenas os registros que foram inseridos para teste (ex.: e-mails `@test.local` / prefixos `giovanna+...`), sem apagar atendimentos reais.
- Critério de remoção (proposto, seguro):
  - Tabela: `services`
  - `user_id = <id da Giovanna>`
  - E-mail de teste: `client_email ILIKE '%@test.local%'` OR `client_email ILIKE 'giovanna+%`
  - (Opcional) Restringir também ao dia de hoje em São Paulo para não remover testes antigos inadvertidamente.
- Após a limpeza:
  - Invalidar/atualizar os dados no UI (as queries já invalidam quando cria/deleta via UI; como a limpeza será feita fora da UI, vamos recarregar a página ou invalidar queries).

Observação importante para “retestar” confete depois da limpeza
- O disparo é “uma vez por dia” por usuário via `localStorage` (chave `goalHit:${userId}:${dateKey}`).
- Se você quiser testar novamente no mesmo dia após a limpeza:
  - Precisaremos limpar essa chave no navegador (DevTools > Application > Local Storage) ou implementar temporariamente um botão/admin reset (opcional).
  - Alternativamente: testar no dia seguinte.

Arquivos que serão alterados
1) `src/features/agent/components/AgentDailyMetricsSection.tsx`
- Trocar timeouts de 1600ms para 4800ms (celebrate + pulse).

2) `src/components/effects/ConfettiBurst.tsx`
- Ajustar duração/delay das partículas, distância da animação e aumentar ligeiramente a quantidade (`pieces`).

3) Limpeza de dados (sem mudança de schema)
- Executar uma operação de DELETE nos dados de teste da tabela `services` (ambiente de teste), filtrando por `user_id` da Giovanna e padrões de e-mail de teste.

Critérios de aceite
- Ao cruzar 99→100:
  - Confete visível por ~4,8s (sem “sumir cedo”).
  - Pulse visível por ~4,8s.
  - Efeito continua sutil e corporativo (sem exagero de cores/tamanho).
- Limpeza:
  - Todos os registros `@test.local` / `giovanna+...` da Giovanna somem do ambiente de teste.
  - Nenhum dado “real” é removido.

Sequência de execução
1) Ajustar tempo e animação (código).
2) Testar no /workspace (idealmente com uma agente em 99 para cruzar 100).
3) Fazer a limpeza de dados de teste da Giovanna.
