#!/bin/bash
# Mirrors apps/api/scripts/migrate.mjs with psql: lexical order, one transaction per file, `-- migrate: no-transaction`
# files statement by statement (autocommit), a schema_migrations ledger with sha256 + duration. Stops on the first failure.
DB="$1"; DIR="$2"; LOG="$3"
P="psql -h ${PGHOST:-127.0.0.1} -p ${PGPORT:-55432} -U postgres -d $DB -v ON_ERROR_STOP=1 -q"
$P -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum text, duration_ms integer)" >/dev/null
: > "$LOG"; n=0
for f in $(cd "$DIR" && ls *.sql | LC_ALL=C sort); do
  done=$($P -tA -c "select 1 from schema_migrations where filename='$f'")
  [ "$done" = "1" ] && continue
  sum=$(sha256sum "$DIR/$f" | cut -d' ' -f1); t0=$(date +%s%3N)
  if head -5 "$DIR/$f" | grep -qiE '^--\s*migrate:\s*no-transaction'; then
    out=$($P -f "$DIR/$f" 2>&1); rc=$?
  else
    out=$($P --single-transaction -f "$DIR/$f" 2>&1); rc=$?
  fi
  t1=$(date +%s%3N)
  if [ $rc -ne 0 ]; then echo "FAILED $f"; echo "$out" | grep -v '^NOTICE' | head -8; echo "FAILED $f" >> "$LOG"; echo "$out" >> "$LOG"; exit 1; fi
  $P -c "insert into schema_migrations (filename, checksum, duration_ms) values ('$f','$sum',$((t1-t0)))" >/dev/null
  echo "$((t1-t0)) $f" >> "$LOG"; n=$((n+1))
done
echo "applied $n"
