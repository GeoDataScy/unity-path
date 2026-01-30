
Objetivo (o que vai mudar)
- Na aba **Histórico/Concluídos** (/workspace/reembolsos), adicionar uma nova coluna **“Valor reembolsado”**.
- Esse valor será **calculado** com base em:
  - **Valor do reembolso** (o valor “cheio” que o agente preenche, ex: 1000.00)
  - **Tipo final** (percentual, ex: 50%)
- Exemplo: `Valor do reembolso = 1000.00` e `Tipo final = 50%` → **Valor reembolsado = 500.00**
- O campo **Valor do reembolso** (refund_value) **continua sem aparecer** como coluna na tabela do histórico (apenas será usado para cálculo e, se necessário, para reabrir o modal preenchido).

Como vamos fazer o cálculo “no banco” (como você pediu)
1) Criar uma função no backend para listar reembolsos do agente já com o valor calculado
- Criar uma SQL function (via migration) no schema `public`, por exemplo:
  - Nome sugerido: `my_refunds_with_refunded_value`
- Ela vai:
  - Garantir que só devolve registros do usuário logado (`user_id = auth.uid()`)
  - Retornar as colunas que o frontend já usa (id, datas, email, plataforma, pedido, etc.)
  - Retornar também um campo calculado: **`refunded_value`** (numeric 10,2)

2) Regra de cálculo na função (robusta para dados antigos)
- O campo `refund_type` é texto e pode existir legado (ou nulo). Então a função vai tratar assim:
  - Se `refund_value` for NULL → `refunded_value` = NULL
  - Se `refund_type` for NULL → `refunded_value` = NULL
  - Se `refund_type` não estiver no padrão esperado (`NN%` ou `NNN%`) → `refunded_value` = NULL
  - Senão:
    - `percent = replace(refund_type, '%', '')::numeric / 100`
    - `refunded_value = round(refund_value * percent, 2)`

3) Segurança
- Como já existe RLS na tabela `refunds`, a função ainda assim vai filtrar por `auth.uid()` para garantir que o agente só veja os próprios dados.
- A função será `STABLE` e não vai exigir permissões especiais do usuário além de estar autenticado.

Mudanças no frontend
4) Alterar a query `useMyRefundsQuery` para buscar via RPC (função) em vez de select direto na tabela
- Arquivo: `src/features/refunds/useMyRefundsQuery.ts`
- Trocar:
  - `.from("refunds").select(...)...`
- Por:
  - `.rpc("my_refunds_with_refunded_value")`
- Resultado: o frontend passa a receber `refunded_value` pronto (já calculado no backend).

5) Ajustar o tipo `RefundItem` para incluir o novo campo calculado
- Arquivo: `src/features/refunds/types.ts`
- Adicionar:
  - `refunded_value: number | null`
- Manter `refund_value` no tipo (para o modal “Concluir reembolso” continuar podendo preencher o campo ao reabrir), mas continuar não exibindo esse campo na tabela.

6) Adicionar a coluna “Valor reembolsado” no Histórico/Concluídos
- Arquivo: `src/pages/agent/Reembolsos.tsx`
- Mudanças:
  - No `<TableHeader>` da aba “done”, inserir uma coluna “Valor reembolsado”.
  - No `<TableRow>` de cada item concluído, renderizar:
    - Se `r.refunded_value` for null → “—”
    - Senão formatar como dinheiro em dólar com 2 casas.
- Formatação (conforme seu exemplo “$ 500,00”):
  - Usar formatação pt-BR para separador decimal (vírgula) e prefixo manual “$ ”.
  - Ex.: `"$ " + new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor)`

O que NÃO vai mudar
- Não vamos criar/mostrar uma coluna “Valor do reembolso” no Histórico/Concluídos.
- O agente continua preenchendo “Valor do reembolso” e “Tipo final” no modal; o histórico só mostra o “Valor reembolsado” (resultado do percentual).

Checklist de testes (end-to-end)
1) Abrir /workspace/reembolsos → concluir um reembolso:
- Valor do reembolso: `1000.00`
- Tipo final: `50%`
- Concluir
2) Ir em Histórico/Concluídos e verificar:
- A nova coluna “Valor reembolsado” aparece
- Para esse registro, mostra **$ 500,00**
- A coluna “Valor do reembolso” não aparece
3) Testar casos de dados incompletos/antigos:
- Se existir concluído com `refund_type` nulo ou fora do padrão, “Valor reembolsado” deve mostrar “—” (sem quebrar a tabela)

Arquivos/itens que serão alterados
- Backend (migration):
  - Criar função `public.my_refunds_with_refunded_value()` retornando lista de reembolsos do usuário + `refunded_value`
- Frontend:
  - `src/features/refunds/useMyRefundsQuery.ts` (passar a chamar RPC)
  - `src/features/refunds/types.ts` (adicionar `refunded_value`)
  - `src/pages/agent/Reembolsos.tsx` (adicionar coluna e renderização)

Riscos e como vamos evitar
- “refund_type” legado (texto fora de “NN%”): função retorna `refunded_value = NULL` e UI mostra “—”.
- Tipo `numeric` vindo como string no client: se acontecer, ajustamos tipagem/conversão no ponto de leitura da RPC. (Ajuste pequeno e controlado.)

Resultado final esperado
- Histórico/Concluídos passa a mostrar o valor efetivamente reembolsado (resultado do percentual) sem expor o valor base preenchido no modal.
