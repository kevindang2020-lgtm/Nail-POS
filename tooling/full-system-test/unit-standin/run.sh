#!/bin/bash
# usage: run.sh <repo> <spec.ts> [STUBS json]
H=$(cd "$(dirname "$0")" && pwd); export REPO_ROOT="$1"; export SPEC_NAME=$(basename "$2"); export STUBS="${3:-{\}}"
exec node --no-warnings --experimental-strip-types --import "$H/register.mjs" "$2"
