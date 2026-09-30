#!/usr/bin/env bash
# Executa cada arquivo de teste num banco limpo, com todas as migrations
# aplicadas em ordem. Reporta o denominador: quantas garantias passaram e
# quantos arquivos rodaram — "nenhuma falha" sem "sobre quantas" não prova nada.
set -uo pipefail

DB="${PGDATABASE:-xmx_v2_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TOTAL_OK=0
FAILED=0
FILES=0

# Um teste declara que precisa do legado simulado escrevendo
#   -- REQUIRES: legado
# na primeira linha. Aí o banco recebe também a fixture e a travessia.
# Sem isso, o teste roda só com o schema — que é o certo para os testes de
# garantia, porque eles semeiam os próprios dados.
reset_db() {
  local extras="${1:-}"
  dropdb --if-exists "$DB" >/dev/null 2>&1
  createdb "$DB" || { echo "não consegui criar $DB"; exit 1; }
  for m in "$HERE"/migrations/*.sql; do
    if ! psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$m" >/dev/null 2>&1; then
      echo "MIGRATION FALHOU: $(basename "$m")"
      psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$m" 2>&1 | tail -5
      exit 1
    fi
  done
  if [ "$extras" = "legado" ]; then
    for b in "$HERE"/backfill/fixture_legado.sql \
             "$HERE"/backfill/0003_backfill.sql \
             "$HERE"/backfill/0004_backfill_reembolsos.sql \
             "$HERE"/backfill/0006_backfill_fatos.sql; do
      if ! psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$b" >/dev/null 2>&1; then
        echo "TRAVESSIA FALHOU: $(basename "$b")"
        psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$b" 2>&1 | grep ERROR | head -3
        exit 1
      fi
    done
  fi
}

for t in "$HERE"/tests/*.test.sql; do
  FILES=$((FILES + 1))
  if head -5 "$t" | grep -q "REQUIRES: legado"; then reset_db legado; else reset_db; fi
  out="$(psql -d "$DB" -v ON_ERROR_STOP=1 -f "$t" 2>&1)"
  ok="$(printf '%s\n' "$out" | grep -c 'NOTICE:  ok ')"
  TOTAL_OK=$((TOTAL_OK + ok))
  if printf '%s\n' "$out" | grep -qE 'FALHOU|^psql.*ERROR'; then
    FAILED=$((FAILED + 1))
    echo "✗ $(basename "$t") — $ok garantias ok, depois falhou:"
    printf '%s\n' "$out" | grep -E 'FALHOU|ERROR' | head -3 | sed 's/^/    /'
  else
    echo "✓ $(basename "$t") — $ok garantias"
  fi
done

echo "----------------------------------------"
echo "arquivos: $FILES   garantias: $TOTAL_OK   com falha: $FAILED"
[ "$FAILED" -eq 0 ] || exit 1
