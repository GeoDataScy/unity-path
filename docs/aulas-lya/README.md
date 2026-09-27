# Aulas da Lya — material para os usuários

Duas aulas curtas sobre o agente de IA que roda no Painel da Gestora do XMX
Suporte, mais os três arquivos que quem assistir leva para construir o seu
próprio agente.

## As aulas

| aula | duração | o que ensina |
| --- | --- | --- |
| 1 — Como a Lya funciona | 5 min | o que é o modelo, o que são ferramentas, o ciclo do agente, de onde vem cada número, as travas de segurança e o revisor |
| 2 — Como se treina a Lya | 3 min | por que "treinar" aqui é memória e não escola, as duas gavetas, o treinador, como corrigir e o grafo |

O roteiro cronometrado das duas está na página da aula.

## Os arquivos

| arquivo | para quem | o que é |
| --- | --- | --- |
| `01-backend-do-agente.md` | quem vai construir | a planta do servidor: o loop do agente, as ferramentas, o sandbox de SQL, o prompt, o cérebro e o verificador |
| `02-frontend-do-agente.md` | quem vai construir | a planta da interface: o stream ao vivo, o estado da conversa, o histórico e os erros que só aparecem depois |
| `skills/cerebro-grafo/SKILL.md` | um assistente de código | a skill que constrói a tela do cérebro em grafo, no estilo Obsidian |

## Como usar

1. Escolha o assistente de código (Claude Code, Cursor, o que preferir).
2. Entregue `01-backend-do-agente.md` junto com uma descrição do seu sistema:
   quais telas existem, quais números aparecem nelas e quais tabelas há no banco.
3. Depois entregue `02-frontend-do-agente.md` para a interface.
4. Para a tela do cérebro, instale a skill: copie a pasta `skills/cerebro-grafo`
   para `.claude/skills/` do seu projeto e peça "constrói a tela do cérebro".

Os três arquivos descrevem um sistema **em produção**, não um exemplo. Cada
armadilha listada neles custou tempo de alguém.
