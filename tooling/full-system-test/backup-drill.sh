#!/usr/bin/env bash
# backup-drill.sh — FullSystemTest.pdf §81 / B7 (Oct 28 2026): a LOCAL backup + restore drill on a real PostgreSQL 16 cluster.
#
#   A. logical: pg_dump -Fc <db>  →  pg_restore into a NEW database  →  compare table / trigger / constraint / index / policy /
#      migration counts and md5 checksums of payments + audit_events between source and restore.
#   B. point in time: pg_basebackup  →  write BEFORE-TARGET  →  note the target time  →  write AFTER-TARGET + a bad payment
#      edit  →  switch WAL  →  restore the base backup into a new data directory on another port with
#      recovery_target_time  →  the recovered copy must have BEFORE, not AFTER, and the original payment amount.
#
# It never touches a production database: it refuses to run unless the host is a local socket directory or 127.0.0.1, and it
# writes only to a scratch database and a scratch data directory. Production restores need the owner's explicit approval
# (FullSystemTest.pdf §3) and are NOT what this script does.
#
# Needs: the cluster running with wal_level=replica, archive_mode=on and an archive_command that copies to $ARCHIVE; a
# migrated database with at least one row in tenants / tickets / payments (tooling/full-system-test/db-races.sh seeds one).
# Usage:  PGHOST=/var/lib/postgresql/aps PGPORT=55432 ARCHIVE=/var/lib/postgresql/aps/wal_archive \
#         WORK=/var/lib/postgresql/aps/drill ./backup-drill.sh fst_conc
set -euo pipefail
DB=${1:?database to drill}
: "${PGHOST:?}" "${PGPORT:?}" "${ARCHIVE:?}" "${WORK:?}"
case "$PGHOST" in /*|127.0.0.1|localhost) ;; *) echo "refusing: PGHOST must be local (got $PGHOST)"; exit 2 ;; esac
BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}; RPORT=${RESTORE_PORT:-$((PGPORT + 1))}; AS=${PG_OS_USER:-postgres}
P() { psql -h "$PGHOST" -p "$PGPORT" -U postgres -Atq -v ON_ERROR_STOP=1 "$@"; }
run() { if [ "$(id -un)" = "$AS" ]; then bash -c "$1"; else su "$AS" -c "$1"; fi; }
mkdir -p "$WORK"; chown "$AS" "$WORK" 2>/dev/null || true
fp() { # the fingerprint compared between source and restore
  for q in "select count(*) from pg_tables where schemaname='public'" \
           "select md5(string_agg(id::text||amount_cents||coalesce(idempotency_key,''),',' order by id)) from payments" \
           "select md5(string_agg(id::text||action,',' order by id)) from audit_events" \
           "select count(*) from pg_trigger where not tgisinternal" "select count(*) from pg_constraint" \
           "select count(*) from pg_indexes where schemaname='public'" "select count(*) from pg_policies" \
           "select count(*) from schema_migrations"; do P -d "$1" -c "$q"; done | tr '\n' ' '; }

echo "== A. logical dump / restore of $DB"
t0=$(date +%s.%N); run "$BIN/pg_dump -h $PGHOST -p $PGPORT -Fc -d $DB -f $WORK/$DB.dump"; t1=$(date +%s.%N)
P -d postgres -c "drop database if exists ${DB}_restore with (force)" -c "create database ${DB}_restore"
run "$BIN/pg_restore -h $PGHOST -p $PGPORT -d ${DB}_restore --exit-on-error -j 4 $WORK/$DB.dump"; t2=$(date +%s.%N)
SRC=$(fp "$DB"); DST=$(fp "${DB}_restore")
echo "dump $(echo "$t1-$t0" | bc) s ($(du -h "$WORK/$DB.dump" | cut -f1)); restore $(echo "$t2-$t1" | bc) s"
echo "source : $SRC"; echo "restore: $DST"
[ "$SRC" = "$DST" ] && echo "PASS  logical restore identical" || { echo "FAIL  logical restore differs"; exit 1; }
P -d postgres -c "drop database ${DB}_restore with (force)"

echo "== B. point-in-time recovery"
T=$(P -d "$DB" -c "select id from tenants order by created_at limit 1")
K=$(P -d "$DB" -c "select idempotency_key from payments where tenant_id='$T' and idempotency_key is not null limit 1")
rm -rf "$WORK/base" "$WORK/pitr" "$WORK/pitr.log"; TAG=drill-$(date +%s)
t0=$(date +%s.%N); run "$BIN/pg_basebackup -h $PGHOST -p $PGPORT -D $WORK/base -Fp -X none -c fast"; t1=$(date +%s.%N)
P -d "$DB" -c "insert into audit_events(tenant_id,module,action) values('$T','drill','BEFORE-$TAG')"
sleep 1.2; TARGET=$(P -d "$DB" -c "select now()"); sleep 1.2
P -d "$DB" -c "insert into audit_events(tenant_id,module,action) values('$T','drill','AFTER-$TAG')"
BEFORE_AMT=$(P -d "$DB" -c "select amount_cents from payments where tenant_id='$T' and idempotency_key='$K'")
P -d "$DB" -c "update payments set amount_cents=999999 where tenant_id='$T' and idempotency_key='$K'"   # the 'bad write' after the target
P -d "$DB" -c "select pg_switch_wal()" >/dev/null; sleep 2
cp -a "$WORK/base" "$WORK/pitr"; rm -f "$WORK/pitr/postmaster.pid"
cat >> "$WORK/pitr/postgresql.auto.conf" <<EOF
port = $RPORT
archive_mode = off
restore_command = 'cp $ARCHIVE/%f %p'
recovery_target_time = '$TARGET'
recovery_target_action = 'promote'
EOF
touch "$WORK/pitr/recovery.signal"; chown -R "$AS" "$WORK" 2>/dev/null || true; chmod 700 "$WORK/pitr"
t2=$(date +%s.%N); run "$BIN/pg_ctl -D $WORK/pitr -l $WORK/pitr.log -w -t 300 start" >/dev/null
for _ in $(seq 1 120); do r=$(psql -h "$PGHOST" -p "$RPORT" -U postgres -Atq -d "$DB" -c "select pg_is_in_recovery()" 2>/dev/null || true); [ "$r" = f ] && break; sleep 1; done
t3=$(date +%s.%N)
R() { psql -h "$PGHOST" -p "$RPORT" -U postgres -Atq -d "$DB" -c "$1"; }
B=$(R "select count(*) from audit_events where action='BEFORE-$TAG'"); A=$(R "select count(*) from audit_events where action='AFTER-$TAG'")
AMT=$(R "select amount_cents from payments where tenant_id='$T' and idempotency_key='$K'")
echo "target $TARGET; base backup $(echo "$t1-$t0" | bc) s; recovery → promoted $(echo "$t3-$t2" | bc) s (RTO of this drill, excluding the copy)"
echo "BEFORE-TARGET rows $B (want 1), AFTER-TARGET rows $A (want 0), payment amount $AMT (want $BEFORE_AMT; live copy now 999999)"
grep -E "recovery stopping|archive recovery complete" "$WORK/pitr.log" || true
run "$BIN/pg_ctl -D $WORK/pitr -m fast stop" >/dev/null
P -d "$DB" -c "update payments set amount_cents=$BEFORE_AMT where tenant_id='$T' and idempotency_key='$K'"   # undo the drill's bad write
[ "$B" = 1 ] && [ "$A" = 0 ] && [ "$AMT" = "$BEFORE_AMT" ] && echo "PASS  point-in-time recovery to the target" || { echo "FAIL  point-in-time recovery"; exit 1; }
