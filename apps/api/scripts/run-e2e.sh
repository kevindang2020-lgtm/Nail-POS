#!/bin/sh
# Reusable E2E smoke: seeds a temp DB, boots the real API, hits key endpoints through the real
# auth guards with a minted tenant session, then tears down. Wire into CI.
# Usage: sh scripts/run-e2e.sh
set -e
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DB=aps_e2e
export NODE_ENV=test REPO_DRIVER=postgres AUTH_SESSION_SECRET=e2esecret PORT=4599
export DATABASE_URL="postgresql://postgres@/${DB}?host=/tmp&port=5433"

npm run build >/dev/null 2>&1 || true
"$PGBIN/psql" -h /tmp -p 5433 -U postgres -d postgres -c "DROP DATABASE IF EXISTS ${DB}" -c "CREATE DATABASE ${DB}" >/dev/null
for f in $(ls db/migrations/*.sql | sort); do "$PGBIN/psql" -h /tmp -p 5433 -U postgres -d ${DB} -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
"$PGBIN/psql" -h /tmp -p 5433 -U postgres -d ${DB} -c "INSERT INTO customers (id,tenant_id,branch_id,first_name,last_name,full_name,status) VALUES (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000b1','Zephyr','A','ZephyrE2E A','active'),(gen_random_uuid(),'bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-0000000000b2','Zephyr','B','ZephyrE2E B','active')" >/dev/null

node dist/main.js > /tmp/e2e_api.log 2>&1 &
APIPID=$!
i=0; while [ $i -lt 25 ]; do curl -sf http://127.0.0.1:4599/health >/dev/null 2>&1 && break; i=$((i+1)); sleep 1; done
RC=0
node scripts/e2e-search.mjs || RC=1
echo ""
node scripts/e2e-smoke.mjs || RC=1
kill $APIPID 2>/dev/null || true
exit $RC
