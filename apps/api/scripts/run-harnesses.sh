#!/usr/bin/env bash
# run-harnesses.sh — run the PGlite behavior harnesses (scripts/verify-*.ts) with the @electric-sql link handled,
# a fresh compiled app for the live-socket harness, per-harness timeouts, and an honest summary + exit code.
#
# Usage:
#   bash scripts/run-harnesses.sh              # run ALL verify-*.ts harnesses
#   bash scripts/run-harnesses.sh owner tech   # only harnesses whose filename matches any given substring
#
# Notes:
# - verify-live-socket.ts boots dist/main.js: the runner builds first when it is in the selection.
# - verify-migrations-pglite.mjs is plain node (no tsx) and is included automatically.
# - The bolt/cardpointe UAT probes are intentionally NOT here: they need real merchant credentials.
# - Oct 20 2026: two kinds of script need infrastructure this runner does not create. They are run when it is supplied and
#   reported SKIPPED (never "passed") when it is not:
#     HARNESS_DATABASE_URL  a disposable, fully migrated PostgreSQL (scripts that say "DATABASE_URL (a disposable, migrated
#                           database) is required" — e.g. verify-terminal-capture.ts)
#     HARNESS_API_BASE      a running API on a seeded database (scripts that say "Assumes an API is … running" — the live
#                           check verify-customer-import.mjs); tooling/ci/final-run.sh runs it beside the route sweep,
#                           whose seed (LUXE, owner@luxenails.test) it signs in with.
set -u
cd "$(dirname "$0")/.."   # apps/api

# Oct 20 2026: the old `ln -sfn /tmp/pgtest/node_modules/@electric-sql node_modules/@electric-sql` link is gone — on any machine
# without that directory it created a DANGLING link that shadowed the workspace install of PGlite and every harness failed
# before its first query. PGlite comes from the root node_modules like every other dependency.

mapfile -t ALL < <(ls scripts/verify-*.ts scripts/verify-*.mjs 2>/dev/null | sort)
SEL=()
if [ "$#" -gt 0 ]; then
  for f in "${ALL[@]}"; do for pat in "$@"; do case "$f" in *"$pat"*) SEL+=("$f");; esac; done; done
else
  SEL=("${ALL[@]}")
fi
[ "${#SEL[@]}" -gt 0 ] || { echo "no harnesses matched"; exit 2; }

for f in "${SEL[@]}"; do
  if [ "$f" = "scripts/verify-live-socket.ts" ]; then
    echo "— building dist for live-socket —"
    npm run build >/tmp/_harness_build.log 2>&1 || { echo "[BUILD-ERR] dist build failed (see /tmp/_harness_build.log)"; exit 1; }
    break
  fi
done

pass=0; fail=0; skip=0; declare -a LINES
for f in "${SEL[@]}"; do
  name=$(basename "$f")
  ENVV=()
  if grep -q "Assumes an API is .*running" "$f"; then
    if [ -z "${HARNESS_API_BASE:-}" ]; then skip=$((skip+1)); LINES+=("⏭  $name — SKIPPED: needs a running API (HARNESS_API_BASE)"); continue; fi
    ENVV+=("BASE=$HARNESS_API_BASE")
  fi
  if grep -q "DATABASE_URL (a disposable, migrated database) is required" "$f"; then
    if [ -z "${HARNESS_DATABASE_URL:-}" ]; then skip=$((skip+1)); LINES+=("⏭  $name — SKIPPED: needs a migrated PostgreSQL (HARNESS_DATABASE_URL)"); continue; fi
    ENVV+=("DATABASE_URL=$HARNESS_DATABASE_URL")
  fi
  if [[ "$f" == *.mjs ]]; then out=$(env "${ENVV[@]}" timeout 600 node "$f" 2>&1); rc=$?
  else out=$(env "${ENVV[@]}" timeout 240 npx tsx --tsconfig tsconfig.harness.json "$f" 2>&1); rc=$?; fi   # tsconfig.harness.json: no `paths` (see that file)
  tailline=$(printf '%s\n' "$out" | grep -E "passed|FAIL|❌|🎉|⚠️" | tail -1)
  if [ $rc -eq 0 ] && ! printf '%s' "$out" | grep -qE "❌| 1 failed|[1-9][0-9]* failed|FAIL:"; then
    pass=$((pass+1)); LINES+=("✅ $name — ${tailline:-ok}")
  else
    fail=$((fail+1)); LINES+=("❌ $name (rc=$rc) — ${tailline:-no summary line}")
    printf '%s\n' "$out" | tail -15
  fi
done

echo ""; echo "──────── harness summary ────────"
for l in "${LINES[@]}"; do echo "  $l"; done
echo "harnesses: $pass passed, $fail failed, $skip skipped"
[ "$fail" -eq 0 ] || exit 1
