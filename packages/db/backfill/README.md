# Travessia do legado para `core`

Roda **dentro** do banco: lê `public`, escreve `core`. Nenhum dado sai, e
nenhuma linha do legado é alterada, apagada ou movida.

| Arquivo | O que é |
|---|---|
| `0003_backfill.sql` | a travessia; reexecutável, `ON CONFLICT DO NOTHING` |
| `fixture_legado.sql` | réplica do legado com os casos difíceis medidos em produção |
| `reconciliacao.sql` | o que assina o corte: 13 verificações aritméticas |

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
