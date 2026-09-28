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

reset_db() {
  dropdb --if-exists "$DB" >/dev/null 2>&1
  createdb "$DB" || { echo "não consegui criar $DB"; exit 1; }
  for m in "$HERE"/migrations/*.sql; do
    if ! psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$m" >/dev/null 2>&1; then
      echo "MIGRATION FALHOU: $(basename "$m")"
      psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$m" 2>&1 | tail -5
      exit 1
    fi
  done
}

for t in "$HERE"/tests/*.test.sql; do
  FILES=$((FILES + 1))
  reset_db
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
