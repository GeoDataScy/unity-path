# @xmx/db — schema v2

Migrations em SQL versionado. Nenhuma alteração de estrutura entra por painel,
MCP, Management API ou conexão direta (`00-CONTRATO.md` §8-B).

O schema nasce em `core`, ao lado do `public` legado, que fica intocado.

## Rodar local

```bash
createdb xmx_v2_test
PGDATABASE=xmx_v2_test npm run --prefix packages/db migrate:local
PGDATABASE=xmx_v2_test npm run --prefix packages/db test:local
```

`tests/0001_core.test.sql` prova as garantias do schema, uma por bloco. Falha o
script quando uma escrita que deveria ser recusada é aceita.
