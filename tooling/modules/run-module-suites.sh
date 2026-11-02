#!/bin/bash
# Run one or more module suites and report FILE-level failures too. A test file that fails to LOAD drops all its tests
# from the "Tests N passed" line; only "Test Files ... failed" shows it. tech-app-access sat in modules/workforce failing
# to load from 5e37cda until this was read properly.
cd "$(dirname "$0")/../.."; export PATH="$PWD/node_modules/.bin:$PATH"
[ $# -eq 0 ] && set -- $(ls modules)
rc=0
for m in "$@"; do
  out=$(cd modules/$m && timeout 280 npx vitest run 2>&1)
  files=$(echo "$out" | grep -E "^ *Test Files" | tail -1 | sed 's/^ *//')
  tests=$(echo "$out" | grep -E "^ *Tests " | tail -1 | sed 's/^ *//')
  bad=$(echo "$out" | grep -E "^ FAIL " | sed 's/^ FAIL *//' | cut -c1-120 | sort -u | head -5)
  echo "$m: $files | $tests"; [ -n "$bad" ] && echo "$bad" | sed 's/^/   FAIL /'
  [ -n "$bad" ] && rc=1
done
exit $rc
