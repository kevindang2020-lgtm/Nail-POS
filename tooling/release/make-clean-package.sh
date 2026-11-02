#!/usr/bin/env bash
# make-clean-package.sh — mandate §259: the clean delivery package. Produces, from the CURRENT commit only
# (never from git history, which still holds the old keystores until Kevin's history rewrite):
#   <out>/aipowersalon-clean-<sha>.zip      the tracked tree at HEAD (git archive — nothing untracked, no node_modules,
#                                           no dist, no .env, no signing keys)
#   <out>/aipowersalon-<sha>.bundle         a git bundle of the branch (history included — for the developer's fetch;
#                                           NOTE: history still contains the removed keystores — Kevin's K-12 rewrite
#                                           happens before anything is pushed)
#   <out>/SHA256SUMS
# and refuses to produce anything if a credential file is tracked at HEAD (the same rule as gate R7).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
OUT="${1:-$ROOT/../package}"; mkdir -p "$OUT"
SHA="$(git rev-parse --short HEAD)"; BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ -n "$(git status --porcelain)" ]; then echo "refusing: uncommitted changes" >&2; exit 1; fi
CRED='\.(jks|keystore|p8|p12|pfx)$|(^|/)key\.properties$|firebase-admin[^/]*\.json$|service-account[^/]*\.json$|google-services\.json$|GoogleService-Info\.plist$|(^|/)\.env(\.[a-z]+)?$'
if git ls-files | grep -E "$CRED" | grep -vE '\.env\.example$|\.env\.sample$'; then echo "refusing: credential file tracked at HEAD" >&2; exit 1; fi
if git grep -lE 'BEGIN (RSA |EC )?PRIVATE KEY' -- ':!*.md' ':!*.spec.ts' ':!*.test.ts' >/dev/null; then echo "refusing: private key content tracked at HEAD" >&2; exit 1; fi
node apps/api/scripts/check-supply-chain-injection.mjs >/dev/null
git archive --format=zip --prefix="aipowersalon-$SHA/" -o "$OUT/aipowersalon-clean-$SHA.zip" HEAD
git bundle create "$OUT/aipowersalon-$SHA.bundle" "$BRANCH" >/dev/null 2>&1
git bundle verify "$OUT/aipowersalon-$SHA.bundle" >/dev/null
( cd "$OUT" && sha256sum "aipowersalon-clean-$SHA.zip" "aipowersalon-$SHA.bundle" > SHA256SUMS )
echo "package written to $OUT ($SHA, $BRANCH):"; ls -la "$OUT"; cat "$OUT/SHA256SUMS"
