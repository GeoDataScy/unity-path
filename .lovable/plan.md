
Objetivo
- No modal **“Concluir reembolso”**, logo abaixo de **“Data de conclusão”**, adicionar o campo **“Valor do reembolso”**:
  - Aceita apenas números em dólar, com **até 2 casas decimais** (ex.: `25` ou `25.50`)
  - O símbolo **`$`** deve ficar visível “dentro do campo” (como prefixo visual), sem atrapalhar a digitação
  - Deve ser **obrigatório** para concluir
- Salvar esse valor no backend (banco), mas **não exibir** como coluna na tabela “Histórico/Concluídos” por enquanto (como você escolheu)

Decisão técnica (para atender “com centavos / obrigatório”)
- Criar uma nova coluna na tabela `refunds`:
  - Nome sugerido: `refund_value`
  - Tipo: `numeric(10,2)`
  - `NULL` permitido (para não quebrar registros antigos e reembolsos “Em aberto”)
  - O formulário do “Concluir reembolso” exigirá o valor (obrigatório), então novos concluídos terão o campo preenchido.

Mudanças no backend (estrutura do banco)
1) Migration para adicionar coluna
- Alterar tabela `refunds` adicionando:
  - `refund_value numeric(10,2) null`
- (Opcional recomendado) Adicionar uma constraint simples para evitar valores negativos:
  - `CHECK (refund_value IS NULL OR refund_value >= 0)`
  - Isso é seguro e não depende de tempo, então não conflita com regras de imutabilidade.

Mudanças no frontend (modal “Concluir reembolso”)
2) Atualizar `CompleteRefundDialog.tsx`
Arquivo: `src/features/refunds/CompleteRefundDialog.tsx`

2.1) Adicionar o campo no schema e no form
- Adicionar `refund_value` ao `completeSchema` e ao tipo `CompleteRefundValues`
- Como o input vem como texto, vamos validar assim:
  - Obrigatório (não vazio)
  - Aceita apenas números com 0–2 casas decimais
  - Ex.: regex: `^\d+(\.\d{1,2})?$`
- Transformação: ao submeter, converter para `number` (ex.: `parseFloat`) antes de enviar para o backend.

2.2) UI do campo com prefixo “$” dentro do input
- Implementar um “input com prefixo” usando Tailwind, sem criar dependências novas:
  - Wrapper `div` com `relative`
  - Um `span` absoluto à esquerda com `"$"`
  - O `<Input />` com padding-left maior (ex.: `pl-7`) para não sobrepor o texto
- O `$` deve permanecer visível mesmo após digitar, assim o usuário sempre entende que é valor em dólar.

2.3) Restrições de digitação (UX)
- Usar:
  - `inputMode="decimal"` (facilita teclado numérico no celular)
  - `placeholder="0.00"` (ou `00.00`)
- Opcional (melhora UX): no `onChange`, filtrar caracteres para permitir apenas dígitos e ponto (`.`) e no máximo 2 decimais.
  - Mesmo com filtro, a validação do Zod continua sendo a “fonte da verdade”.

2.4) Default values / compatibilidade
- `defaultValues.refund_value`:
  - Se existir no registro, preencher
  - Senão, começar vazio (e como é obrigatório, exigirá preenchimento)

Mudanças no salvamento (quando clicar “Concluir”)
3) Atualizar a mutation de conclusão
Arquivo: `src/pages/agent/Reembolsos.tsx`
- No `completeMutation.update({...})`, incluir:
  - `refund_value: <valor convertido para number>`
- Manter `completion_date`, `refund_type`, `reason`, `items_returned` como já estão

Mudanças no carregamento de dados do reembolso (para o modal poder preencher)
4) Atualizar query que busca os reembolsos
Arquivo: `src/features/refunds/useMyRefundsQuery.ts`
- Incluir `refund_value` no `.select(...)`

5) Atualizar o tipo `RefundItem`
Arquivo: `src/features/refunds/types.ts`
- Adicionar:
  - `refund_value: number | null` (se o retorno vier como number)
  - Observação: dependendo do driver/typing, `numeric` pode chegar como `string` no client. Se isso acontecer no seu setup, ajustaremos para `string | null` e faremos parse no modal. (Eu vou verificar como está vindo na prática quando implementar.)

O que NÃO vamos fazer (por decisão sua)
- Não vamos adicionar a coluna “Valor” na tabela de **Histórico/Concluídos** agora (apenas salvar).

Checklist de testes (end-to-end)
1) Em `/workspace/reembolsos` → “Em Aberto” → “Concluir Reembolso”
- Campo “Valor do reembolso” aparece logo abaixo de “Data de conclusão”
- O `$` aparece dentro do campo (prefixo)
- Ao tentar concluir sem preencher:
  - Deve mostrar erro e impedir o submit
- Ao preencher `25.50`:
  - Deve aceitar
- Ao tentar preencher `25.555` ou texto:
  - Deve bloquear/invalidar e mostrar erro

2) Concluir reembolso normalmente
- O registro muda para “Histórico/Concluídos”
- Sem necessidade de mostrar o valor na tabela (como pedido)
- Reabrir o mesmo reembolso (se existir essa possibilidade/fluxo):
  - O valor deve aparecer preenchido no modal

Arquivos que serão alterados
- Backend (migration):
  - `refunds`: adicionar coluna `refund_value numeric(10,2) null` (+ opcional check >= 0)
- Frontend:
  - `src/features/refunds/CompleteRefundDialog.tsx`
  - `src/pages/agent/Reembolsos.tsx`
  - `src/features/refunds/useMyRefundsQuery.ts`
  - `src/features/refunds/types.ts`

Riscos/atenções
- Tipo do campo `numeric` pode retornar como string dependendo do client/typing. Se ocorrer, vamos padronizar parse/format no modal para evitar bugs.
- Como é um campo novo, registros antigos continuarão com `NULL` e não quebrarão as telas (porque o campo só será obrigatório no modal de conclusão).
