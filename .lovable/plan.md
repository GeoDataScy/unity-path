
Objetivo (entendido do seu pedido)
- Você quer ajustar a cor da **sidebar** e da **barra superior (topbar do logo)** no **/workspace (agente)**.
- Deve ficar **igual ao roxo do dashboard da gestora**.
- **Escopo: somente agente** (não mudar o /dashboard).
- **Sidebar e topbar iguais** (mesmo fundo).

Diagnóstico rápido (como está hoje)
- No /workspace, tanto a sidebar quanto a topbar usam `bg-sidebar`.
- `bg-sidebar` é um token do design system que hoje mapeia para `--dashboard-sidebar` no `src/index.css`.
- Mesmo assim, é comum ver diferença “na prática” por:
  1) algum container aplicando background diferente por trás,
  2) bordas/overlays (ex.: `border-sidebar-border/10`, `hover:bg-sidebar-foreground/10`) dando impressão de cor diferente,
  3) `App.css` ainda limita o `#root` (max-width/padding), o que pode alterar a percepção/área pintada.

Plano de ajuste (o que vou implementar quando você mandar executar)
1) Tornar a cor do /workspace “explicitamente igual ao dashboard”
   - Em `src/layouts/AgentLayout.tsx`:
     - Trocar `bg-sidebar` por `bg-dashboard-sidebar` na barra superior (header do logo).
     - Garantir que textos continuem `text-dashboard-sidebar-foreground` (branco).
   - Em `src/components/agent/AgentSidebar.tsx`:
     - Passar uma `className` mais explícita para o `<Sidebar ...>` usando `bg-dashboard-sidebar text-dashboard-sidebar-foreground`.
     - Ajustar (se necessário) o `SidebarGroupLabel` e itens para manter contraste.

2) Isolar a mudança para “só agente”
   - Não vou alterar os tokens globais `--dashboard-sidebar` / `--sidebar` no `src/index.css`, porque isso afetaria também o dashboard.
   - Em vez disso, vamos aplicar classes Tailwind específicas **apenas** no layout do agente.

3) Ajustar bordas/efeitos para não “parecer outra cor”
   - O /workspace hoje usa `border-sidebar-border/10` na topbar. Vou alinhar o estilo de borda ao dashboard da gestora (ex.: `border-white/10`) para manter aparência idêntica.
   - Revisar hover do botão “Sair” e do `SidebarTrigger` para garantir que o efeito não “clareie” demais e pareça outra cor (manter `bg-white/10` / `hover:bg-white/15` como no dashboard).

4) Verificar se o layout não está “cortando” a área pintada
   - O `src/App.css` ainda tem `#root { max-width: 1280px; padding: 2rem; }`, que pode fazer a sidebar/topbar não ocuparem a tela inteira e dar impressão de cor errada.
   - Vou checar como o `#root` está impactando especificamente o /workspace:
     - Se estiver afetando, o plano é remover/neutralizar esse estilo “de template do Vite” (ou sobrescrever via `src/index.css`) para que a sidebar/topbar pintem a largura total.

5) Checklist de validação (visual)
   - No /workspace:
     - Sidebar e topbar com o mesmo roxo do dashboard.
     - Contraste ok (texto branco legível).
     - Hover/active dos itens não “lavando” a cor.
     - Sem espaçamentos laterais indevidos (ocupando a tela como no dashboard).
   - No /dashboard:
     - Nenhuma mudança visual (confirmar que ficou idêntico ao que já está).

Arquivos que provavelmente serão alterados
- `src/layouts/AgentLayout.tsx` (topbar e wrapper)
- `src/components/agent/AgentSidebar.tsx` (classes do sidebar)
- Possivelmente `src/App.css` (remover/ajustar estilos do template que atrapalham o layout full width)

Resultado esperado
- Agente em /workspace verá sidebar e topbar com o mesmo roxo do dashboard, de forma consistente, sem afetar a área da gestora.
