
Objetivo
- Quando o usuário “bate a meta” (>= 100 atendimentos), tocar um som de palmas, aumentar a quantidade de confetes na tela e dobrar o tempo que os confetes ficam aparecendo (de ~4,8s para ~9,6s).
- Manter a experiência idêntica tanto no gatilho real (quando o contador cruza a meta) quanto no botão DEV “Simular meta batida”.

Estado atual (o que encontrei)
- A celebração é controlada por `AgentDailyMetricsSection`:
  - `CELEBRATION_MS = 4800`
  - Mostra `<ConfettiBurst />` enquanto `celebrate === true`
  - Ativa `pulse` no número enquanto `pulse === true`
  - No gatilho real, usa `localStorage` para disparar só 1x por dia.
  - No gatilho DEV, ignora `localStorage` e só depende de `debugCelebrateNonce`.
- O botão DEV está em `src/pages/agent/Atendimentos.tsx` e usa `CELEBRATION_MS = 4800` para resetar o override de contagem.

Decisões de implementação
1) Dobrar duração da celebração para 9600ms
- Atualizar o `CELEBRATION_MS` em `AgentDailyMetricsSection` para 9600.
- Atualizar também o `CELEBRATION_MS` dentro do handler DEV em `Atendimentos.tsx` para 9600, para que o “overrideCount=100” não volte antes do fim da animação.

2) Mais confetes na tela
- Ajustar a chamada em `AgentDailyMetricsSection` para passar mais peças:
  - De: `<ConfettiBurst />`
  - Para: `<ConfettiBurst pieces={64} />` (ou 80; eu recomendo 64 para dobrar sem ficar pesado).
- Manter `pieces` configurável no componente (já é).

3) Confetes durarem o dobro do tempo (animação)
- Hoje o `ConfettiBurst` está calibrado para ~4,8s (delay até 600ms + duração até 4200ms).
- Vamos recalibrar para ~9,6s:
  - Exemplo de calibração simples:
    - `delayMs`: 0–1200
    - `durationMs`: 6000–8400
    - Total máximo: 1200 + 8400 = 9600
- Isso garante que a janela visual dos confetes “case” com o `CELEBRATION_MS`.

4) Som de “palmas” quando bater a meta
- Adicionar um arquivo de áudio no projeto (ex.: `public/sounds/clap.mp3`).
- Em `AgentDailyMetricsSection`, criar um player de áudio reutilizável via `useRef<HTMLAudioElement | null>` para não recriar em toda renderização.
- Tocar o áudio quando a celebração for acionada:
  - No gatilho real (cruzou a meta e não estava bloqueado pelo `localStorage`)
  - No gatilho DEV (quando `debugCelebrateNonce` muda)
- Tratamento de restrições do navegador (autoplay):
  - Em alguns navegadores, áudio pode ser bloqueado quando não parte de uma ação direta do usuário (por exemplo, quando a métrica atualiza via refetch).
  - Implementação segura:
    - `audio.play().catch(() => {})` para falhar silenciosamente (sem quebrar UI).
    - Para melhorar a chance de funcionar também no “gatilho real”, vamos “desbloquear” o áudio após a primeira interação do usuário:
      - Adicionar um `useEffect` que registra `window.addEventListener("pointerdown", ...)` uma vez.
      - No primeiro clique/toque, inicializa o `Audio`, chama `load()` e marca como “unlocked”.
      - Depois disso, tocar palmas terá mais chance de funcionar.
  - O botão DEV (clique) quase sempre vai permitir o áudio tocar (porque é interação direta).

Arquivos que serão alterados / adicionados
1) Editar: `src/features/agent/components/AgentDailyMetricsSection.tsx`
- Trocar `CELEBRATION_MS` de 4800 para 9600.
- Passar mais peças ao confete: `<ConfettiBurst pieces={64} />`.
- Implementar o player de palmas:
  - `const clapRef = useRef<HTMLAudioElement | null>(null);`
  - Função `playClap()` com try/catch e reset de `currentTime = 0`.
  - “Unlock” do áudio no primeiro `pointerdown`.
- Chamar `playClap()` no exato momento em que `setCelebrate(true)` e `setPulse(true)` são disparados (tanto no fluxo real quanto no DEV).

2) Editar: `src/components/effects/ConfettiBurst.tsx`
- Recalibrar os ranges de `delayMs` e `durationMs` para total ~9600ms.
- (Opcional, se quiser deixar mais flexível) adicionar props como `maxDelayMs` e `durationRangeMs` para não “hardcodar” 9600; mas dá para manter simples e apenas ajustar os números.

3) Editar: `src/pages/agent/Atendimentos.tsx`
- Atualizar o `CELEBRATION_MS` do handler DEV para 9600, para que o overrideCount continue por toda a celebração.

4) Adicionar (novo arquivo estático): `public/sounds/clap.mp3`
- Arquivo leve (curto, 0.5–1.5s), para não impactar o carregamento.
- Referência via caminho absoluto: `"/sounds/clap.mp3"`.

Checklist de testes (end-to-end)
1) DEV (Preview) em `/workspace/agent/atendimentos` (ou a rota equivalente):
- Clicar em “Simular meta batida (DEV)”
- Confirmar:
  - Confetes aparecem em maior quantidade
  - Duração aproximada ~9,6s
  - Número fica pulsando durante a janela
  - Som de palmas toca (deve tocar por ser clique)

2) Gatilho real
- Com o usuário real, ao cruzar a meta naturalmente:
  - Confetes e pulse duram ~9,6s
  - Som de palmas:
    - Se não tocar de primeira (bloqueio do navegador), clicar em qualquer lugar da página e testar novamente em outro momento; após interação, tende a tocar.

Riscos / cuidados
- Performance: aumentar muito `pieces` pode pesar em máquinas fracas. Por isso a sugestão de 64 (dobro do atual) é um bom equilíbrio.
- Autoplay: é normal o navegador bloquear áudio no gatilho real se não houver interação recente. Vamos implementar fallback silencioso para não gerar erro.

Perguntas rápidas (apenas se você quiser decidir agora; se não, eu escolho defaults)
- Volume das palmas: prefere “discreto” (ex.: 0.4) ou “normal” (0.7)?
- Quantidade de confetes: quer exatamente o dobro (64) ou “bem mais” (80/96)?
