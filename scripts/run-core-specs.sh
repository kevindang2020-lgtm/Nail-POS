#!/usr/bin/env bash
# Backend tests: Nest-free *-core.spec.ts harnesses (esbuild+node) + vitest specs (*.vitest.spec.ts).
set -u; cd "$(dirname "$0")/../apps/api"
pass=0; fail=0
# Constitution 13: domain modules keep their Nest-free core specs — search modules/*/src too, or they silently stop running.
for spec in $(find src ../../modules/*/src \( -name '*-core.spec.ts' -o -name '*-service.spec.ts' \) ! -name '*.vitest.spec.ts' 2>/dev/null | sort); do
  # NestJS declares websockets/microservices/class-validator/class-transformer as OPTIONAL peers and loads them inside
  # try/catch; esbuild cannot know that and refuses the bundle when a spec's import graph reaches @nestjs/*. They are
  # externals here (never executed by a core spec). The real fix is on the package side — framework-bound code sits
  # behind ./nest and ./guards entries (Constitution 13 §113) — this keeps the harness honest when a graph still reaches it.
  mkdir -p .harness   # @aws-sdk/client-s3 is a lazy, optional require inside @aipowersalon/media (S3 only when MEDIA_STORE=s3); external so a suite without S3 still bundles
  # the bundle lives INSIDE apps/api so its externals (class-validator, Nest's optional peers) resolve from the API's node_modules — from /tmp they did not
  npx esbuild "$spec" --bundle --platform=node --outfile=.harness/_spec.js --external:@nestjs/websockets/socket-module --external:@nestjs/microservices/microservices-module --external:@nestjs/microservices --external:class-validator --external:class-transformer --external:@aws-sdk/client-s3 >/dev/null 2>&1 || { echo "[BUILD-ERR] $spec"; fail=$((fail+1)); continue; }
  if node .harness/_spec.js; then pass=$((pass+1)); else fail=$((fail+1)); fi
done
echo ""; echo "Harness suites: $pass passed, $fail failed"
echo "Vitest suites:"; npx vitest run --reporter=basic; vit=$?
# Exit non-zero if EITHER the *-core.spec.ts harnesses OR vitest failed (previously only vitest's status
# propagated, so a failing core spec could be printed yet still exit 0 — that hid a real regression).
if [ "$fail" -ne 0 ] || [ "$vit" -ne 0 ]; then echo "RESULT: FAIL ($fail core suites failed, vitest=$vit)"; exit 1; fi
echo "RESULT: PASS"; exit 0
