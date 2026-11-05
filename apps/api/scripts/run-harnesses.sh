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
set -u
cd "$(dirname "$0")/.."   # apps/api

LINK=node_modules/@electric-sql
ln -sfn /tmp/pgtest/node_modules/@electric-sql "$LINK" 2>/dev/null || true
cleanup() { rm -f "$LINK"; }
trap cleanup EXIT

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

pass=0; fail=0; declare -a LINES
for f in "${SEL[@]}"; do
  name=$(basename "$f")
  if [[ "$f" == *.mjs ]]; then out=$(timeout 240 node "$f" 2>&1); rc=$?
  else out=$(timeout 240 npx tsx "$f" 2>&1); rc=$?; fi
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
echo "harnesses: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
