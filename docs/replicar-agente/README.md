# Replicar a arquitetura da Lya e do Daniel

Três arquivos para entregar à IA de programação (Claude Code, Cursor, Codex…)
de quem vai construir um agente de IA especialista nos dados do próprio
sistema, conectado ao banco de dados do próprio cliente.

| arquivo | o que é | quando ler |
| --- | --- | --- |
| `01-ORIENTACOES-DE-ARQUITETURA.md` | o que construir, por que cada peça existe, a arquitetura de consulta e a de treinamento, segurança, modelos, o procedimento de adaptação ao cliente e as lições que custaram caro | primeiro, inteiro |
| `02-BACKEND-DOS-MODELOS.md` | migrations completas (cérebro + recall, histórico, sandbox de SQL, seed) e os seis arquivos da função (porteiro, loop, tools, prompt, treinador, verificador); variante Next.js + FastAPI; radar de demanda; deploy; testes | ao implementar o servidor |
| `03-FRONTEND-DOS-MODELOS.md` | tipos, stream SSE, hook da conversa, histórico, componentes do chat, e a skill `cerebro-grafo` (a tela do segundo cérebro em grafo estilo Obsidian, com o código completo) | ao implementar a interface |

## Como usar

1. Entregue os três arquivos à IA junto com uma descrição do sistema do
   cliente: quais telas existem, quais números aparecem nelas, quais funções
   as alimentam, quais tabelas há no banco e quem pode conversar/treinar.
2. Peça que ela siga o procedimento da seção 8 do arquivo 01 (descobrir a
   stack, inventariar o banco, inventariar as telas, escrever glossário e
   catálogo, definir papéis) antes de escrever código.
3. Para a tela do cérebro, copie a Parte B do arquivo 03 para
   `.claude/skills/cerebro-grafo/SKILL.md` no projeto do cliente.
4. Exija os testes de aceitação da seção 8.7 do arquivo 01 antes de
   considerar pronto.

Os três descrevem sistemas **em produção** (Daniel na CBIE desde agosto/2026,
Lya na XMX desde 07/09/2026), não um exemplo. Quando os dois divergirem, a
Lya é a referência.

## Segurança do banco do cliente

As migrations só criam objetos novos com prefixo `agente_*` e concedem `SELECT` a uma role sem login. Nada apaga, altera ou sobrescreve o que já existe no banco do cliente. O que precisa de decisão consciente (policy do sandbox em banco multi-tenant, colunas de PII, dados que vão para a API do modelo, CORS) está na seção 6.5 do arquivo 01 e nas seções I.6 (reversão) e I.7 (auditoria) do arquivo 02.
