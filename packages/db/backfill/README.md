# Travessia do legado para `core`

Roda **dentro** do banco: lê `public`, escreve `core`. Nenhum dado sai, e
nenhuma linha do legado é alterada, apagada ou movida.

| Arquivo | O que é |
|---|---|
| `0003_backfill.sql` | a travessia; reexecutável, `ON CONFLICT DO NOTHING` |
| `fixture_legado.sql` | réplica do legado com os casos difíceis medidos em produção |
| `reconciliacao.sql` | o que assina o corte: 13 verificações (via `psql`) |
| `reconciliacao-api.sql` | a mesma coisa em SQL puro, para a Management API |

## Ensaio local

```bash
createdb xmx_bf
psql -d xmx_bf -f packages/db/migrations/0001_core.sql
psql -d xmx_bf -f packages/db/migrations/0002_catalogos.sql
psql -d xmx_bf -f packages/db/backfill/fixture_legado.sql
psql -d xmx_bf -f packages/db/backfill/0003_backfill.sql
psql -d xmx_bf -f packages/db/backfill/reconciliacao.sql
```

## O critério

```
linhas no legado = linhas em core + linhas em migration_rejects
```

Rejeito **não é perda**: a linha original continua em `public`, intacta, e
o conteúdo dela fica guardado em `payload` para decisão humana.

## Em produção

`fixture_legado.sql` NÃO é aplicado — lá o `public` já existe. A ordem é:
migrations, depois `0003_backfill.sql`, depois `reconciliacao.sql`. Se a
reconciliação falhar, nada foi perdido: `core` pode ser derrubado e o
legado segue intocado.

## Aplicado em produção — 28/09/2026

| Medida | Resultado |
|---|---|
| Atendimentos | 103.059 no legado = 103.057 migrados + 2 rejeitados |
| Interações | 60.031 no legado = 60.030 migradas + 1 rejeitada |
| Reconciliação | 13 de 13 |
| Legado depois | idêntico ao de antes |

Os 3 rejeitos: dois atendimentos com data de 1997 e a interação órfã de um
deles. As linhas originais continuam em `public`, intactas.

`reconciliacao.sql` falhou pela Management API por causa do `\set`. Use
`reconciliacao-api.sql` por esse caminho.
