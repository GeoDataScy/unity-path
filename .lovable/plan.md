
Contexto do pedido
- Hoje o campo **“Tipo final”** no modal **Concluir reembolso** é um `<Input />` livre e o schema aceita qualquer texto.
- Você quer que essa coluna aceite **somente percentuais** no formato com `%` e com as opções:
  - 05%, 10%, 15%, …, 100% (incremento de 5)
- Não é necessário mudar o banco de dados, porque a coluna `refund_type` já é **texto** e vai continuar armazenando “05%”, “10%”, etc. O que vamos fazer é **restringir o preenchimento** (UI + validação) para evitar valores fora do padrão.

O que vou implementar

1) Criar uma lista oficial de opções “Tipo final”
- Local: `src/features/refunds/CompleteRefundDialog.tsx` (ou, se for melhor para reaproveitar, mover para `src/features/refunds/types.ts` depois)
- Gerar/definir um array fixo:
  - `["05%", "10%", "15%", ... "100%"]`
- Observação: “05%” precisa ter zero à esquerda.

2) Trocar o campo “Tipo final” de Input para Select (dropdown)
- Arquivo: `src/features/refunds/CompleteRefundDialog.tsx`
- Substituir:
  - `<Input ... {...form.register("refund_type")} />`
- Por um `Select` (o mesmo componente usado em `NewRefundDialog.tsx`), garantindo:
  - As opções vêm do array de percentuais
  - O valor é controlado com `form.watch("refund_type")` + `form.setValue("refund_type", ...)` com `shouldValidate: true`
  - Mensagens de erro continuam aparecendo abaixo do campo

3) Reforçar validação (client-side) para aceitar apenas as opções permitidas
- Arquivo: `src/features/refunds/CompleteRefundDialog.tsx`
- Atualizar o Zod schema:
  - De: `refund_type: z.string().trim().min(1)...`
  - Para: `refund_type: z.enum(PERCENT_OPTIONS, { message: "Selecione um percentual válido" })`
- Benefícios:
  - Impede envio por “tampering” (ex.: alguém tentando injetar outro texto via DevTools)
  - Mantém consistência total no histórico e nos relatórios

4) Garantir compatibilidade com registros antigos (se existirem)
- Situação: se já houver reembolsos concluídos com `refund_type` antigo (ex.: “Total”, “Parcial 50%”), ao abrir “Concluir reembolso” novamente para aquele registro, o `Select` não vai reconhecer o valor.
- Tratamento planejado (para não quebrar a UX):
  - Se `refund.refund_type` não estiver na lista de percentuais:
    - Setar `defaultValues.refund_type` como `""` (vazio)
    - Mostrar erro/validação pedindo seleção
  - Alternativa (se você preferir): mostrar uma opção “Valor antigo: X” somente para visualização. (Eu só implemento isso se você pedir; por padrão, manteremos rígido para padrão novo.)

5) Conferir reflexo no “Histórico/Concluídos”
- Arquivo: `src/pages/agent/Reembolsos.tsx`
- Já existe a coluna “Tipo” que renderiza `r.refund_type`.
- Após a mudança, ela vai naturalmente mostrar “05%”, “10%”, etc., porque:
  - O formulário passa a mandar apenas esses valores
  - O `completeMutation` já atualiza `refund_type` corretamente
- Pequena melhoria opcional (sem mudar comportamento):
  - Renderizar `r.refund_type ?? "—"` para ficar consistente se algum registro vier nulo.

Testes que vou fazer (checklist)
1) No /workspace/reembolsos → Em Aberto → Concluir Reembolso:
   - Campo “Tipo final” aparece como dropdown e lista 05%…100%
   - Não dá para digitar texto livre
   - Ao tentar concluir sem escolher, mostra erro “Selecione um percentual válido”
2) Selecionar “25%”, preencher os demais campos, concluir:
   - Registro sai de “Em Aberto”
   - Aparece em “Histórico/Concluídos” com Tipo = “25%”
3) Reabrir um registro concluído (se o sistema permitir) para confirmar que o valor selecionado permanece compatível.

Arquivos que serão alterados
- `src/features/refunds/CompleteRefundDialog.tsx`
  - Trocar Input por Select
  - Criar lista 05–100%
  - Ajustar Zod schema para enum

Possíveis impactos
- Qualquer valor fora da lista passa a ser inválido no modal (como você pediu).
- Se existirem registros antigos com tipos fora do padrão, eles podem aparecer no histórico normalmente, mas ao editar/concluir novamente, o “Tipo final” exigirá um valor válido do dropdown.

