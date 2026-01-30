
Contexto (o que já existe hoje)
- A tela `src/pages/agent/Atendimentos.tsx` já exibe 3 cards de métricas do dia (total do agente, distância do líder, restante para meta 100) alimentados por `useAgentDailyMetricsQuery`.
- Já existe um componente de progresso `src/components/ui/progress.tsx` (Radix Progress) com animação suave (`transition-all`), mas hoje ele usa sempre `bg-primary` no indicador.
- Não existe implementação de “confetti” no projeto (nenhuma ocorrência no código).

Objetivo do ajuste
- Adicionar uma barra de progresso logo abaixo dos 3 cards:
  - 0–59: vermelho (atenção)
  - 60–89: amarelo (alerta / progresso)
  - 90–100: verde (meta próxima/atingida)
  - Preenchimento gradual com animação suave conforme novos atendimentos são registrados.
- Ao atingir 100 (meta do dia):
  - Explosão sutil de confetes por ~1–2s, sem bloquear interface.
  - Mostrar um badge fixo “🏆 Meta Batida!” no card (vou colocar no card “Total de atendimentos hoje”, por ser o mais direto).
  - Micro animação de “pulse” no número 100 destacando a conquista.
- UX:
  - Leve, corporativo, não intrusivo.
  - O estímulo (confete + pulse de conquista) deve acontecer apenas 1 vez por dia, no momento exato que cruza 100.
  - Após meta atingida, barra permanece verde com leve glow discreto.

Abordagem técnica (sem dependências extras)
1) Calcular progresso e “estado visual” (cor)
- Em `Atendimentos.tsx`, calcular:
  - `const goal = 100`
  - `const progress = Math.min(100, Math.max(0, (myCount / goal) * 100))`
- Determinar a cor do indicador por faixa:
  - `myCount <= 59` → classe `bg-red-500`
  - `60..89` → `bg-amber-400` (ou `bg-yellow-400`)
  - `>= 90` → `bg-emerald-500`
- Se `myCount >= 100`, aplicar glow discreto no container:
  - ex.: `shadow-[0_0_0_3px_rgba(16,185,129,0.20)]` (ajustar para ficar sutil)

2) Inserir a barra abaixo dos cards (layout)
- Ainda em `Atendimentos.tsx`, logo após o `<section ... aria-label="Métricas do dia">`, inserir um bloco:
  - Um wrapper com `mt-2`/`-mt` pequeno para “colar” visualmente nos cards, e `mb-8` para manter respiro antes do formulário.
  - Label pequena (opcional) “Progresso da meta: X/100” em texto muted.
  - Componente `Progress` com `value={progress}`.
- Para personalizar a cor do indicador, farei uma destas opções (vou escolher a que se encaixar melhor no código atual):
  A) Melhor (mantém `Progress` genérico): evoluir `src/components/ui/progress.tsx` para aceitar `indicatorClassName` (prop extra) e usar `cn()` no Indicator.
  B) Alternativa (sem mexer no componente): renderizar um progresso simples com `div`/`span` e `style={{ width: `${progress}%` }}` + `transition` (100% controlável).
- Preferência: (A), pois mantém padrão shadcn/Radix e reutilizável.

3) “Meta Batida!” (badge fixo no card)
- No card “Total de atendimentos hoje”:
  - Se `myCount >= 100`, renderizar um `Badge` (provavelmente `variant="open"` ou `default`, com ajuste de cor se necessário) com o texto “🏆 Meta Batida!”
  - Posicionamento:
    - Ao lado do título (“Total de atendimentos hoje”) no header, ou abaixo do número. Vou colocar no header à direita para ficar “clean” e fixo.

4) Disparo único diário (confete + pulse) ao cruzar 100
- Precisamos detectar “momento do evento”: quando `myCount` muda de `< 100` para `>= 100`.
- Em `Atendimentos.tsx`:
  - Criar `const dateKey = todayISO()` (já existe função timezone São Paulo).
  - Guardar `prevCount` via `useRef<number>(myCount)` para comparar transições.
  - Usar `useEffect` observando `[myCount, userId, dateKey]`:
    - Se `!userId` return
    - Se `prevCount.current < 100 && myCount >= 100`:
      - Checar localStorage: `localStorage.getItem(confettiKey)`.
      - `confettiKey = goalHit:${userId}:${dateKey}`
      - Se ainda não disparou hoje:
        - setar `localStorage.setItem(confettiKey, "1")`
        - setar um state `celebrate = true` por ~1600ms (com `setTimeout`)
        - setar um state `pulse = true` por ~1200–2000ms (também via timeout)
    - Atualizar `prevCount.current = myCount` no final.
- Isso garante: só ocorre quando cruza 100 e apenas uma vez por dia (por usuário).

5) Confete sutil, leve e não intrusivo (sem bloquear)
- Implementar um componente pequeno, por exemplo `src/components/effects/ConfettiBurst.tsx`:
  - Renderiza um overlay `div` com `pointer-events-none`, `position: absolute`, `inset: 0`, `overflow-hidden`.
  - Gera ~18–28 “pedaços” (spans) com posições e delays pseudo-randômicos (usando `Math.random()` no mount).
  - Animação CSS curta (1.2–1.8s) de “subir um pouco e cair” + rotação, com opacidade diminuindo:
    - Definir keyframes dentro do próprio componente via `<style>` local (para não precisar mexer no `index.css`/tailwind config).
  - Cores discretas: primário do sistema + tons neutros + verde (evitar carnaval/exagero).
- Em `Atendimentos.tsx`, posicionar o ConfettiBurst:
  - Idealmente no container que envolve os cards + barra, com `relative`, e o confete como overlay absoluto.
  - Só renderizar quando `celebrate === true`.

6) Pulse no número 100 (micro animação)
- Requisito: “Aplicar micro animação de pulse no número 100, destacando a conquista”.
- Implementação:
  - No número do card “Total de atendimentos hoje”, aplicar `className` condicional:
    - Se `pulse === true` e `myCount >= 100`, adicionar classe `pulse` (já existe utilidade no projeto conforme as animações).
    - Alternativa: `animate-pulse` do Tailwind, mas prefiro usar `pulse` já definido (para manter consistência e controle).
  - Duração controlada pelo timeout do state `pulse`.

7) Estados de loading e consistência
- Enquanto `metricsLoading`:
  - Barra de progresso mostra `Skeleton` ou `Progress` em 0 com cor neutra (mais simples: usar `Skeleton` para evitar “pulos”).
- Ao atualizar contagem:
  - A `ProgressPrimitive.Indicator` já tem `transition-all`, então o preenchimento será suave automaticamente (ou adicionaremos `duration-500 ease-out`).

Arquivos que serão alterados/criados
- Editar:
  - `src/pages/agent/Atendimentos.tsx`
    - inserir barra de progresso abaixo dos cards
    - badge de meta no card
    - lógica de disparo único diário (localStorage + useEffect)
    - render do confetti overlay e pulse
- Editar (se escolher a opção A):
  - `src/components/ui/progress.tsx`
    - adicionar prop opcional `indicatorClassName?: string`
    - aplicar `cn(..., indicatorClassName)` no Indicator
- Criar (componente de efeito):
  - `src/components/effects/ConfettiBurst.tsx` (ou nome similar)
    - confete sutil por 1–2s, sem dependências externas

Critérios de aceite (como você valida rapidamente)
1) Progresso e cores
- Com `myCount` entre 0–59: barra vermelha
- 60–89: barra amarela
- 90–99: verde
- 100+: verde + glow discreto

2) Animações
- Registrar atendimentos e ver a barra preenchendo suavemente (sem “saltos” bruscos).
- Ao cruzar 100:
  - confete aparece por ~1–2s e some sozinho
  - número “100” aplica pulse curto
  - badge “🏆 Meta Batida!” aparece e permanece
- Registrar mais atendimentos após 100:
  - barra continua verde e com glow (sem re-disparar confete/pulse)

3) “Apenas uma vez por dia”
- No mesmo dia, após atingir 100:
  - atualizar/registrar mais atendimentos não dispara novamente
- No dia seguinte:
  - ao cruzar 100 novamente, dispara de novo (chave do localStorage inclui a data São Paulo)

Notas de UX (para ficar corporativo e motivador)
- Confete com poucas partículas, movimento curto, cores discretas (primário + verde + neutros).
- Glow leve (não neon).
- Pulse curto (não infinito), somente no momento da conquista.
