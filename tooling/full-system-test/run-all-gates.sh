#!/usr/bin/env bash
# run-all-gates.sh — FullSystemTest.pdf (Oct 28 2026): every repository gate this environment can run, with exit codes.
#   1. tooling/ci/run-gates.mjs (the CI runner, unchanged)
#   2. the gates it reports as failing only because node_modules is missing, re-run the way the environment allows:
#      - database gates against a REAL PostgreSQL through tooling/full-system-test/pg-standin (no PGlite package)
#      - TypeScript gates with whatever `typescript` is resolvable (the Oct 28 run used 6.0.2 from the offline npm cache;
#        the repository pins 5.4.5 — say which one ran)
# Output: one "RESULT <gate> <exit>" line per gate, then a summary. Needs FST_PG_PORT / FST_PG_HOST for the DB gates.
set -u
cd "$(dirname "$0")/../.."
SI="--import ./tooling/full-system-test/pg-standin/register.mjs"
echo "typescript: $(node -p "require('typescript').version" 2>/dev/null || echo none)"
node tooling/ci/run-gates.mjs; echo "RESULT run-gates.mjs $?"
g() { local name=$1; shift; "$@" > /tmp/fst-gate-$name.log 2>&1; local rc=$?; echo "RESULT $name $rc  — $(grep -v '^\s*at ' /tmp/fst-gate-$name.log | grep -v '^$' | tail -1 | cut -c1-200)"; }
g sql                 node $SI apps/api/scripts/sql-prepare-check.mjs
g types-drift         node $SI apps/api/scripts/introspect-schema.mjs
g sql-identifiers     node $SI apps/api/scripts/audit-sql-identifiers.mjs
g db-ownership        node $SI apps/api/scripts/db-ownership.mjs --check
g actor-stamp         node $SI apps/api/scripts/gen-actor-columns.mjs --check
g unique-tenant-review node $SI apps/api/scripts/audit-unique-tenant-review.mjs
( cd apps/api
  g permission-docs   npm run -s check:permission-docs
  g async-exports     npm run -s check:async-exports
  g openapi           npm run -s check:openapi
  g error-text        npm run -s check:error-text )
g pos-i18n            node tooling/ci/check-pos-i18n.mjs
