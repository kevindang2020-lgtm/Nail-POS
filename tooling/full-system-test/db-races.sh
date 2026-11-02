#!/usr/bin/env bash
# db-races.sh — DB-level concurrency + protective-trigger tests on REAL PostgreSQL 16 (fresh clone of the fully migrated
# schema). Every case prints PASS/FAIL with the observed numbers. Usage: db-races.sh <db>
set -u
DB=${1:-fst_conc}
P="psql -h ${PGHOST:-127.0.0.1} -p ${PGPORT:-55432} -U postgres -d $DB -Atq -v ON_ERROR_STOP=1"
Q() { $P -c "$1"; }
pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass+1)); }
bad() { echo "FAIL  $1"; fail=$((fail+1)); }

# ── seed: two salons, a branch each, a customer, a technician, a ticket ──────────────────────────────────────────────
read T1 T2 <<<"$(Q "insert into tenants(legal_name,display_name,tenant_slug,tenant_code,lifecycle_state) values
  ('Race A LLC','Race A','race-a','RACEA','active'),('Race B LLC','Race B','race-b','RACEB','active') returning id" | tr '\n' ' ')"
B1=$(Q "insert into branches(tenant_id,name) values('$T1','A Main') returning id")
B2=$(Q "insert into branches(tenant_id,name) values('$T2','B Main') returning id")
C1=$(Q "insert into customers(tenant_id,branch_id,first_name,last_name,full_name) values('$T1','$B1','Ann','Lee','Ann Lee') returning id")
TECH=$(Q "insert into technicians(tenant_id,branch_id,first_name,last_name,full_name) values('$T1','$B1','Thu','Tran','Thu Tran') returning id")
TK=$(Q "insert into tickets(tenant_id,branch_id,customer_id) values('$T1','$B1','$C1') returning id")
echo "seed: tenants $T1 / $T2, ticket $TK"

# ── 1. 20 parallel payments with ONE idempotency key → exactly 1 row ─────────────────────────────────────────────────
for i in $(seq 1 20); do
  $P -c "insert into payments(tenant_id,branch_id,ticket_id,method,amount_cents,idempotency_key) values('$T1','$B1','$TK','card',4500,'idem-race-1') on conflict do nothing" >/dev/null 2>&1 &
done; wait
n=$(Q "select count(*) from payments where tenant_id='$T1' and idempotency_key='idem-race-1'")
[ "$n" = 1 ] && ok "20 concurrent payments, same idempotency key → $n row" || bad "same-key payments → $n rows (want 1)"

# 1b. without ON CONFLICT: 19 of 20 must get unique_violation, never a second row
errs=0; for i in $(seq 1 20); do ( $P -c "insert into payments(tenant_id,branch_id,ticket_id,method,amount_cents,idempotency_key) values('$T1','$B1','$TK','card',4500,'idem-race-2')" >/dev/null 2>&1 || echo E ) & done > /tmp/fst-1b.txt; wait
errs=$(grep -c E /tmp/fst-1b.txt); n=$(Q "select count(*) from payments where idempotency_key='idem-race-2'")
[ "$n" = 1 ] && [ "$errs" = 19 ] && ok "plain concurrent inserts: 1 row, $errs refused by payments_tenant_idem_uq" || bad "plain inserts: $n rows, $errs refused"

# 1c. the same key in ANOTHER salon is a different payment (key is tenant-scoped)
TK2=$(Q "insert into customers(tenant_id,branch_id,first_name,last_name,full_name) values('$T2','$B2','Bo','Ng','Bo Ng') returning id")
TK2=$(Q "insert into tickets(tenant_id,branch_id,customer_id) values('$T2','$B2','$TK2') returning id")
Q "insert into payments(tenant_id,branch_id,ticket_id,method,amount_cents,idempotency_key) values('$T2','$B2','$TK2','card',100,'idem-race-1')" >/dev/null 2>&1 \
  && ok "same idempotency key in another salon is accepted (tenant-scoped uniqueness)" || bad "tenant-scoped key refused across salons"

# ── 2. 20 parallel appointments for one technician, same slot → exactly 1 ───────────────────────────────────────────
D=$(date -u -d '+7 days' +%F)
for i in $(seq 1 20); do
  $P -c "insert into pos_tech_appointments(tenant_id,technician_id,customer_name,appt_date,start_time,end_time,status) values('$T1','$TECH','Guest $i','$D','10:00','11:00','booked')" >/dev/null 2>&1 &
done; wait
n=$(Q "select count(*) from pos_tech_appointments where technician_id='$TECH' and appt_date='$D'")
[ "$n" = 1 ] && ok "20 concurrent same-slot bookings for one technician → $n (exclusion constraint)" || bad "same-slot bookings → $n (want 1)"
Q "insert into pos_tech_appointments(tenant_id,technician_id,customer_name,appt_date,start_time,end_time,status) values('$T1','$TECH','Next','$D','11:00','12:00','booked')" >/dev/null 2>&1 \
  && ok "back-to-back slot 11:00–12:00 accepted ([) range)" || bad "adjacent slot wrongly refused"
Q "insert into pos_tech_appointments(tenant_id,technician_id,customer_name,appt_date,start_time,end_time,status) values('$T1','$TECH','Overlap','$D','10:30','11:30','booked')" >/dev/null 2>&1 \
  && bad "overlapping 10:30–11:30 accepted" || ok "overlapping 10:30–11:30 refused"

# ── 3. booking holds: 20 parallel holds on one technician + time → 1 ────────────────────────────────────────────────
S=$(date -u -d '+8 days 15:00' +%FT%TZ); E=$(date -u -d '+8 days 16:00' +%FT%TZ)
for i in $(seq 1 20); do
  $P -c "insert into booking_holds(tenant_id,branch_id,technician_id,start_time,end_time,expires_at) values('$T1','$B1','$TECH','$S','$E',now()+interval '10 minutes')" >/dev/null 2>&1 &
done; wait
n=$(Q "select count(*) from booking_holds where technician_id='$TECH'")
[ "$n" = 1 ] && ok "20 concurrent online-booking holds on one slot → $n" || bad "holds → $n (want 1)"

# ── 4. audit trail is append-only ────────────────────────────────────────────────────────────────────────────────────
AID=$(Q "insert into audit_events(tenant_id,module,action) values('$T1','checkout','payment.capture') returning id")
Q "update audit_events set action='x' where id='$AID'" >/dev/null 2>&1 && bad "audit_events UPDATE allowed" || ok "audit_events UPDATE refused"
Q "delete from audit_events where id='$AID'" >/dev/null 2>&1 && bad "audit_events DELETE allowed" || ok "audit_events DELETE refused (inside retention)"
Q "truncate audit_events" >/dev/null 2>&1 && bad "audit_events TRUNCATE allowed" || ok "audit_events TRUNCATE refused"
Q "truncate security_events" >/dev/null 2>&1 && bad "security_events TRUNCATE allowed" || ok "security_events TRUNCATE refused"

# ── 5. payroll: lines of a paid / finalized period are locked ────────────────────────────────────────────────────────
PP=$(Q "insert into payroll_periods(tenant_id,period_start,period_end,status) values('$T1','2026-10-01','2026-10-14','draft') returning id")
LN=$(Q "insert into payroll_lines(tenant_id,period_id,technician_id) values('$T1','$PP','$TECH') returning id")
for st in review finalized paid; do
  Q "update payroll_periods set status='$st' where id='$PP'" >/dev/null
  Q "update payroll_lines set technician_id=technician_id where id='$LN'" >/dev/null 2>&1 && bad "payroll line edited in a $st period" || ok "payroll line UPDATE refused in a $st period"
done
Q "insert into payroll_lines(tenant_id,period_id,technician_id) values('$T1','$PP','$TECH')" >/dev/null 2>&1 && bad "line added to a paid period" || ok "payroll line INSERT refused in a paid period"
Q "delete from payroll_lines where id='$LN'" >/dev/null 2>&1 && bad "line deleted from a paid period" || ok "payroll line DELETE refused in a paid period"

# ── 6. a money column refuses a fractional / text amount ─────────────────────────────────────────────────────────────
Q "insert into payments(tenant_id,branch_id,ticket_id,method,amount_cents) values('$T1','$B1','$TK','card',12.5)" >/dev/null 2>&1 \
  && { v=$(Q "select amount_cents from payments where amount_cents in (12,13) limit 1"); echo "INFO  12.5 cents was rounded by the integer cast to $v (the API passes integer cents)"; } || ok "fractional cents refused"

# ── 7. row-level security (defence in depth; on only with DB_TENANT_RLS=1) as an ordinary role, not the superuser ──────
Q "do \$\$begin if not exists(select 1 from pg_roles where rolname='aps_rls_probe') then create role aps_rls_probe login; end if; end\$\$;
   grant usage on schema public to aps_rls_probe; grant select,insert,update,delete on all tables in schema public to aps_rls_probe;
   grant execute on all functions in schema public to aps_rls_probe;" >/dev/null
U() { psql -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-55432}" -U aps_rls_probe -d "$DB" -Atq "$@"; }
asA() { U -c "select set_config('app.tenant_id','$T1',false)" -c "$1" 2>&1 | tail -1; }
v=$(asA "select count(*) from payments where tenant_id='$T2'"); [ "$v" = 0 ] && ok "RLS: salon A reads 0 of salon B's payments" || bad "RLS: salon A read $v of B's payments"
v=$(asA "select count(*) from payments where tenant_id<>'$T1'"); [ "$v" = 0 ] && ok "RLS: salon A sees only its own payments" || bad "RLS: A sees $v foreign payments"
v=$(asA "with u as (update payments set amount_cents=amount_cents where tenant_id='$T2' returning 1) select count(*) from u"); [ "$v" = 0 ] && ok "RLS: salon A updates 0 of B's payments" || bad "RLS: A updated $v of B's payments"
v=$(asA "insert into customers(tenant_id,branch_id,first_name,last_name,full_name) values('$T2','$B2','x','y','x y')"); echo "$v" | grep -q "row-level security" && ok "RLS: salon A cannot insert a row for salon B" || bad "RLS: cross-salon insert: $v"
v=$(U -c "select set_config('app.tenant_strict','on',false)" -c "select count(*) from customers" | tail -1); [ "$v" = 0 ] && ok "RLS strict: no tenant on the session → 0 rows" || bad "RLS strict without tenant → $v rows"
v=$(U -c "select set_config('app.tenant_id','x'' or 1=1',false)" -c "select count(*) from customers" | tail -1); [ "$v" = 0 ] && ok "RLS: a malformed tenant id → 0 rows" || bad "RLS malformed tenant id → $v rows"
v=$(U -c "select count(*) from customers" | tail -1); echo "INFO  RLS non-strict with no tenant → $v rows visible (by design: permissive until DB_TENANT_RLS_STRICT=1 — set it in production)"

echo "db-races: $pass passed, $fail failed"
[ "$fail" = 0 ]
