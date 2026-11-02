# Verifying the 7:00 PM Customer Sync on a real server

Everything below is what this sandbox **cannot** prove. Each step takes a minute or two and produces evidence you
can read directly out of the database or the Super Admin screen.

## 0. Arm the worker

In the API service environment:

```
CUSTOMER_SYNC_WORKER_ENABLED=1
PLATFORM_TIMEZONE=America/New_York      # optional; this is the default
```

Restart the API. On boot the log must contain exactly this line:

```
[CustomerSyncScheduler] Customer sync worker armed (7:00 PM daily window, America/New_York, advisory-locked).
```

**If that line is absent, the worker is OFF** — the env var is the only thing that arms it. No line, no 7 PM run.

## 1. Prove the machinery works before waiting for 7 PM (2 minutes)

Trigger the same code path by hand from Super Admin → Customer Data Oversight → Customer Sync & Reconciliation →
**Run sync now**, or:

```
POST /super-admin/customer-data-oversight/sync/run     {}
```

Then check the run landed:

```sql
select id, trigger, scope, status, started_at, finished_at,
       tenants_scanned, customers_scanned, new_globals, linked_existing, conflicts, errors
from customer_recon_runs order by started_at desc limit 5;
```

A `trigger='manual'` row with a `finished_at` and a status of `COMPLETED` / `COMPLETED_WITH_ISSUES` / `PARTIAL`
proves the engine, the advisory lock, and the database writes all work in your environment. If this fails, the
7 PM run would have failed too — fix it here, not at 7 PM.

## 2. Prove the schedule itself (the actual open item)

Leave the server running past 19:00 in `PLATFORM_TIMEZONE`. After 19:05 local:

```sql
select trigger, status, started_at, finished_at, customers_scanned
from customer_recon_runs
where trigger = 'scheduled'
order by started_at desc limit 3;
```

**Expected:** exactly one `trigger='scheduled'` row whose `started_at`, converted to your platform timezone, falls
inside the 19:00 hour. The dashboard's "Last Sync" should show it, and "Next Scheduled Sync" should have rolled
forward to tomorrow's 19:00.

**Expected on night two:** one more row, one per day — not two, not zero.

## 3. Prove multi-instance safety (only if you run more than one API instance)

Run the manual trigger on two instances within the same second, or watch two instances through a 7 PM window.

```sql
select count(*) from customer_recon_runs
where trigger = 'scheduled' and started_at > now() - interval '2 hours';
```

**Expected: 1.** The `pg_try_advisory_lock('customer_reconciliation')` guard means the second instance skips and
reports `ran: false` with a reason — it does not start a second run, and it does not leave a phantom row.

## 4. Prove the watchdog notices a miss

Stop the API before 19:00 and leave it down for a night. On restart:

```sql
select kind, status, occurrences, created_at from customer_identity_conflicts
where kind = 'CUSTOMER_RECONCILIATION_MISSED';
```

**Expected:** one row (not one per tick), visible in the Super Admin conflicts list, once more than ~26 hours have
passed without a completed run. Running a sync manually clears the condition; the alert row stays for the record.

## What was already proven without a server

- The arming switch: OFF unless the env var is truthy; ON for `1 / true / yes / on`; the timer is `unref`'d so it
  never holds the process open; shutdown is idempotent.
- The production `tick()` driven through a simulated calendar in 5-minute steps: exactly one run per day, always
  inside the 19:00 local hour, across 48 hours — **including both daylight-saving transitions** (Nov 1 2026 fall
  back and Mar 8 2026 spring forward), where a naive scheduler skips a night or fires twice.
- `PLATFORM_TIMEZONE` is honoured: on a Los Angeles platform it fires at 19:00 Pacific (22:00 Eastern), proving
  the hour is not hardcoded to New York.
- The watchdog raises exactly one deduplicated alert and does not itself start a sync.
- A tick arriving while a run is still in flight is skipped — no overlapping runs.

Test file: `apps/api/src/customer-identity/customer-sync-scheduler.vitest.spec.ts` (9 tests).
