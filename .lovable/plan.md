
Objetivo
- Na tela de Atendimentos, adicionar um botão visível somente em desenvolvimento (DEV) que, ao clicar, simula exatamente o “momento de bater 100 atendimentos”: badge “Meta Batida!”, número pulsando e confetes por ~4,8s, sem depender do backend nem do número real de atendimentos.

O que existe hoje (estado atual)
- A celebração real acontece em `AgentDailyMetricsSection` quando o contador do dia cruza a meta:
  - Condição: `prevCount.current < goal && myCount >= goal`
  - Dispara confetes (`ConfettiBurst`) por 4800ms e adiciona `pulse` no número.
  - Usa `localStorage` com chave `goalHit:${userId}:${dateKey}` para tocar apenas 1 vez por dia.
- A tela `Atendimentos.tsx` já renderiza `AgentDailyMetricsSection` no topo, então é o ponto ideal para colocar um botão de simulação.

Decisão de design (como vamos simular “exatamente”)
- Não vamos “mexer” no banco nem criar 100 registros.
- A simulação será totalmente front-end, mas reutilizando os mesmos elementos visuais da celebração real:
  - Confetes: o mesmo componente `ConfettiBurst`
  - Pulso: a mesma classe `pulse`
  - Badge/estado da meta: usando a mesma lógica do componente, porém com um “contador efetivo” temporário (ex.: 100) para que a UI mostre “meta batida” como se tivesse acontecido.
- A simulação precisa ignorar o bloqueio “uma vez por dia” do `localStorage`, senão você clicaria e não veria nada se já bateu meta hoje. Portanto, o gatilho de DEV terá um fluxo separado que não grava/consulta o `localStorage`.

Mudanças planejadas (frontend)

1) Atualizar `AgentDailyMetricsSection` para suportar simulação em DEV
- Alterar o type `Props` para aceitar props opcionais de debug, por exemplo:
  - `debugCelebrateNonce?: number` (um número que muda a cada clique, só para disparar o efeito)
  - `debugOverrideCount?: number | null` (quando presente, a UI usa esse valor como “myCount”)
- Implementação:
  - Criar `const effectiveCount = debugOverrideCount ?? myCount;`
  - Trocar os usos de `myCount` por `effectiveCount` nos cálculos/visual:
    - progress, indicador de cor, remainingToGoal, badge “Meta Batida!”, glow, texto do número e do contador “x/goal”.
  - Manter a lógica real (com localStorage) intacta para o uso normal.
  - Adicionar um `useEffect` separado que escuta `debugCelebrateNonce`:
    - Quando `debugCelebrateNonce` mudar (e houver `userId`), executar:
      - `setCelebrate(true); setPulse(true);`
      - timeouts para desligar após `CELEBRATION_MS`
    - Esse efeito não lê nem escreve `localStorage`.
  - Garantir cleanup de timeouts no return do effect.

2) Adicionar o botão DEV na tela `src/pages/agent/Atendimentos.tsx`
- Criar state local para controlar a simulação:
  - `const [debugCelebrateNonce, setDebugCelebrateNonce] = useState(0);`
  - `const [debugOverrideCount, setDebugOverrideCount] = useState<number | null>(null);`
- Renderizar o botão somente em DEV:
  - Condição: `if (import.meta.env.DEV) { ... }`
- Colocação sugerida:
  - Logo abaixo do `<h1>` e antes do `AgentDailyMetricsSection`, ou ao lado do título, para ficar fácil de testar.
- Comportamento do botão (ao clicar):
  - Setar `debugOverrideCount` para o valor da meta (ex.: 100) para a UI mostrar “meta batida”.
  - Incrementar `debugCelebrateNonce` (ex.: `setDebugCelebrateNonce((n) => n + 1)`).
  - Agendar um timeout de 4800ms para limpar o override:
    - `setDebugOverrideCount(null)` depois de acabar a animação, para voltar a mostrar os dados reais.
- Passar as props para o componente:
  - `<AgentDailyMetricsSection ... debugCelebrateNonce={debugCelebrateNonce} debugOverrideCount={debugOverrideCount} />`

3) Garantias importantes (para ficar “exato” e seguro)
- “Somente DEV”: o botão fica invisível em produção porque `import.meta.env.DEV` é false.
- Não altera dados reais:
  - Não insere registros, não muda a métrica real, não mexe em backend.
- “Exato visualmente”:
  - Confetes e pulse são os mesmos já usados na celebração real.
  - A badge “Meta Batida!” e o glow aparecem porque o “contador efetivo” chega na meta.
- Repetível:
  - Como a simulação ignora `localStorage`, você consegue clicar quantas vezes quiser para ver “o que acontece”.

Testes (checklist)
- Em DEV (preview), ir em Atendimentos:
  - Ver o botão “Simular meta batida” (ou nome similar).
  - Clicar:
    - Confetes aparecem e somem após ~4,8s.
    - Número entra em pulse durante a janela da celebração.
    - Badge “Meta Batida!” aparece durante a simulação.
    - Barra de progresso fica no estado final (verde + glow).
  - Após ~4,8s:
    - UI volta a exibir o contador real vindo do backend (sem ficar travado em 100).
- Em produção (published):
  - Confirmar que o botão não aparece.
  - A celebração real continua funcionando quando o usuário realmente cruzar a meta.

Arquivos que serão alterados
- `src/features/agent/components/AgentDailyMetricsSection.tsx`
  - Adição de props de debug
  - Cálculo `effectiveCount`
  - Novo effect para simulação
- `src/pages/agent/Atendimentos.tsx`
  - Botão DEV + state + passagem das props para `AgentDailyMetricsSection`

Observação de compatibilidade
- Não foi encontrado uso amplo de `import.meta.env` no projeto além do client do backend; usar `import.meta.env.DEV` é compatível com Vite e é o padrão para condicionar UI em desenvolvimento.
