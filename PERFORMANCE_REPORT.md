# PERFORMANCE_REPORT.md — 200-technician large salon (mandate: 200-Technician Large Salon, §24–§25, §89–§94)

## Oct 28 2026 — Check-In + Live Operations One-Screen

| Measure | Before | After |
|---|---|---|
| Check-In customer search (50,000 customers) | read 50,040 rows per search, filtered in JS | one indexed query, top 20: phone 0.06 ms, name 0.07 ms |
| Walk-in duplicate check | read the whole directory | index scan 0.03 ms |
| `/pos/check-in/state` customer mix | every customer + every paid ticket | paid visits of today's check-in customers (0.03 ms) |
| `/pos/check-in/state` appointment labels | 3 queries per appointment | 3 batched queries |
| Check-In / Live Ops content at 1920×945 (busy) | 1,059 / 1,519 px in 885 | 885 / 885 |
| `useFitRows` | could loop (React #185) at 1600×765 | stable (remembered pitch) |

API latency on a built API was **not** measured.

## Oct 28 2026 — Overview 27-Inch One-Screen

| Measure | Before | After |
|---|---|---|
| Overview content height, 1920×945, busy | 1,172 px in 885 | 885 in 885 |
| Board lists | whole lists, counted in JS | top-N + `count(*) OVER ()` per list (one statement each) |
| Overview API calls on first load | 2 | 2 (`/state`, `/board`) |
| Largest payload (fixture, 200 techs / very busy) | — | 31.7 KB / 40.5 KB (`/state`) |
| Live tech queue / inventory / staff on duty (EXPLAIN ANALYZE, PostgreSQL 16) | — | 0.64 / 0.16 / 0.085 ms (seq scans on small tables; no index added) |
| 200 technicians | — | 6 Live Tech Queue rows, ≈ 800 DOM nodes |

API latency on a built API was **not** measured.

## Oct 28 2026 — Customer Queue One-Screen

| Measure | Before | After |
|---|---|---|
| Queue content height, 1920×945, busy (95 waiting, 200 techs) | 1,318 px in 885 | 885 in 885 |
| Staff rows sent (200 technicians, 100 on duty) | 200 (every technician) | 8 + `staffSummary` |
| Queue panel rows | 20 per page; the panel grew with the Manage drawer | 50 in a fixed panel (internal scroll); the full list 100 a page in an overlay |
| `/pos/queue/state` reads | `loadAll` + locks / lines / conversion | the same + the batched `techSignals` (9 fixed queries, not per technician) |
| Queue read (EXPLAIN ANALYZE, PostgreSQL 16, 250 active) | — | 0.16 ms seq (tiny table) · 0.38 ms bitmap on `idx_pos_queue_items_tenant_branch` |
| Server projection, 200 technicians (unit) | — | < 50 ms |

API, realtime and browser-memory timings were **not** measured (no built API).

## Oct 28 2026 — Serving One-Screen

| Measure | Before | After |
|---|---|---|
| Serving content height, 1920×945, busy (51 on the floor, 200 techs) | 1,492 px in 885 | 885 in 885 |
| Floor hydrate queries (counted from the code) | 3–4 per ticket (~400 for 100 guests) | 4 for any floor size |
| Staff rows sent (100 on duty) | 100 | 8 + `staffSummary` |
| Floor query (EXPLAIN ANALYZE, PostgreSQL 16) | — | 0.027 ms, `idx_tickets_tenant_branch` |

API, stage-transition, realtime and browser-memory timings were **not** measured (no built API).


## Oct 28 2026 — Service Done One-Screen

| Measure | Before | After |
|---|---|---|
| Service Done content height, 1920×945, busy (30 completed, 200 techs) | 3,711 px in 885 | 885 in 885 |
| Board queries for 30 tickets (counted from the code) | ~105 (3 per ticket + tips + ~12 fixed) | ~16 (tickets + lines + technicians + customers + fixed) |
| Staff rows sent / rendered (100 on duty) | 100 | 8 + `staffSummary` |
| Handoff UPDATE (EXPLAIN ANALYZE, PostgreSQL 16) | — | 0.12 ms |

API, realtime and browser-memory timings were **not** measured (no built API).


## Oct 28 2026 — Checkout One-Screen

| Measure | Before | After |
|---|---|---|
| Checkout content height, 1920×945 page, busy (40 ready, 200 techs) | 6,773 px in 885 | 885 in 885 |
| Staff rows sent / rendered on the board (200 techs) | 200 | 8 + counts (`staffSummary`) |
| Ticket lines rendered in the workspace (24-line ticket) | 24 | 6 (all 24 in an overlay) |
| `receiptOutcomesToday` (audit outcomes, 72k rows) | — | 22.7 ms (EXPLAIN ANALYZE, `idx_audit_tenant_created`) |

API latency for the board was **not** re-measured (no built API).


## Full System Test — Oct 28 2026 (what could be measured here)

Commit `07e599ea`; sandbox with **2 vCPU**, PostgreSQL 16.15 local, no API build (no `node_modules`). **The 200-technician API /
browser timings below (Oct 23–27) were NOT re-measured** on this commit — they need the built API and Chromium bundles (V-28).

| Measurement | Result | Notes |
|---|---|---|
| All 646 migrations from zero | 2 min 0 s wall; 47.1 s inside the files | slowest `537_tenant_leading_indexes` 333 ms, `672_expense_finance` 209 ms, `538_core_constraints` 182 ms |
| `pg_dump -Fc` of a migrated DB (2.5 MB) | 0.7–1.3 s | schema-heavy, little data |
| `pg_restore -j 4` | 8.5 s uncontended · 15 s with the unit sweep running | |
| `pg_basebackup` | 8.1 s uncontended · 65–100 s under load | |
| PITR: start → promoted | **2.7 s** uncontended · 49–88 s under load | the local RTO of the recovery step only (copy time excluded) |
| 20 concurrent idempotent payment inserts / 20 same-slot bookings | all settle in < 1 s; 1 winner each | contention cost is negligible at this scale |
| Unit sweep through the stand-in | ≈ 10–20 s per spec file on 2 vCPU (process start + TypeScript stripping per file) | not a product timing |

Bottlenecks still open from the earlier runs: I-5 realtime-first outbox lane (client half), I-16 clock-in burst p95 read-back on
the pilot host, I-18 busy-state responsive report 55 / 90.

**Run:** Oct 23 2026, pilot phase 11 (`apps/api/scripts/live-pilot-day.mjs` → `lib/pilot-large-salon.mjs`), on commit
`2975758d`, after the Security Deep Scan hardening. Evidence: `docs/pilot-runs/2026-10-23-post-hardening/pilot.log`.
**Environment:** one sandbox machine (≈7 GB RAM), the real API (`dist/main.js`, one process) on a freshly migrated local
PostgreSQL 16 (626 migrations), built web apps in Chromium. Single-machine numbers: the API, the database and the load
generator share the CPU, so these are an upper bound for a dedicated host, not a production SLA.

## Dataset (created through the API, no SQL inserts)

| | |
|---|---|
| Technicians | 200 active (176 hired by the pilot through POS in 8.0 s): 72 generalists, 45 pedicure-only, 27 acrylic, 16 nail-art, 16 manicure-only; 16 off "today" |
| Weekly schedules | 200 |
| Appointments tomorrow | 1,112 (1,000 booked by the pilot through the API in 25.7 s, 8 at a time) |
| Clock PINs | 100 set by the manager, unique per salon |

## Latency (measured by the pilot against the HTTP API)

| Read / action | Result | Target (§24) | |
|---|---|---|---|
| Technician page change (`GET /pos/booking/technicians`, 12 a page, 10 samples) | p50 21 ms / p95 22 ms | 500–750 ms | PASS |
| Day grid for the 12 visible technicians | 45 ms, 62 KB (unscoped 200-column answer: 968 KB) | < 2 s initial board | PASS |
| Board state, page 1 | 66 ms, 57 KB | — | |
| Find an Opening, top 5 over 200 (exact service) | 49 ms | < 1 s filter | PASS |
| 20 front desks book one technician + minute at once | 1 booked, 19 × 409 APPOINTMENT_CONFLICT with fresh open times | correct under race | PASS |
| 100 technicians clock in by PIN at once (kiosk) | wall 4.2 s, p50 3.7 s, p95 4.1 s; 100 shifts, no duplicates; 20 replays write nothing | — | **WATCH** (NEXT_STEPS S-A12) |
| 30 guests check in on the kiosk at once | 0.64 s, 30 distinct queue items | — | PASS |
| POS queue state with 100 technicians clocked in, 41 items | 1.84 s, 60 KB | — | **WATCH** (NEXT_STEPS S-A12) |

## Database (EXPLAIN ANALYZE on the real PostgreSQL, same run)

| Query | Execution time | Plan note |
|---|---|---|
| appointments, one day, 12 technicians | 0.18 ms | |
| appointments, one day, whole salon | 0.43 ms | Seq Scan on pos_tech_appointments |
| technician roster (board paging) | 0.22 ms | Seq Scan on technicians |
| exact-service eligibility (one service) | 0.08 ms | Seq Scan on technician_services |
| weekly schedules (200) | 0.35 ms | Seq Scan on technician_schedules |
| clock PIN identify (keyed digest, migration 683) | 0.02 ms | index |
| open shifts (time clock) | 0.09 ms | |

The sequential scans are the planner's correct choice at this table size (a single salon's rows in a scratch database).
They become relevant when many large salons share one database. The index candidates (`technician_blocked_times
(tenant_id, block_date)`, `pos_queue_items (tenant_id, assigned_technician_id)` / `(tenant_id, appointment_id)`,
`pos_tech_queue_tickets (tenant_id, appointment_id)`) should be added with a before / after EXPLAIN on a multi-tenant
dataset — not measurable meaningfully here (NEXT_STEPS).

## Set-based server work (no per-technician query chains)
- Payroll at 200 technicians: `payroll-200-technicians.pgtest` — 200 statements, 400 payout instructions (50 % check /
  50 % cash), set-based writes (commit ce71842e). Compensation auto-build set-based (f4070587). Outbox `writeAll` = one
  multi-row insert per 500 events (38ee355c).
- Clock PIN identify: one keyed HMAC digest lookup (migration 683) instead of scrypt per technician.
- Fair Turn ranking over 200 technicians: ~1 ms, deterministic (`fair-turn-200.vitest.spec.ts`).

## M5 run — Oct 24 2026 (pilot 177/177, commit `ea6636e1`, evidence `docs/pilot-runs/2026-10-24-200-tech/`)

Same single-machine caveat. The M5 load generator paces itself (≤ 30 requests / s) so the salon's per-branch limiter
(3,000 / minute) is respected; it answered 0 × 429 in this run.

| Measure | Result |
|---|---|
| Booking volume — 500 / 1,000 / 2,000 records on one day | booked in 16.7 / 33.3 / 66.7 s through the API; day grid (12 columns) p50 43 / 48 / 58 ms, p95 57 / 70 / 78 ms; largest grid 34 / 53 / 112 KB; list page (100) 42 / 64 / 126 ms; Find an Opening 50 / 50 / 53 ms |
| Busy tomorrow (1,113 records) | grid p50 47 / p95 86 ms, 63 KB |
| Technician page change (API) | p50 12 / p95 17 ms |
| Page change in the browser (click → label + grid, 48 changes) | p50 199 / p95 289 / max 359 ms |
| Browser memory, 17 pages × 3 rounds | JS heap 10.7 (start) → 11.3 → 11.3 → 11.5 MB; DOM nodes 10,019 → 10,025 → 10,025 → 10,025; listeners 992 constant; ≤ 12 columns |
| Fair Turn recommend, 105 clocked in | p50 96 / max 163 ms |
| 100-technician clock-in burst | wall 3.2 s, p95 3.1 s (WATCH, unchanged) |
| POS queue state, 100 clocked in | 1.65 s, 60 KB (WATCH, unchanged) |
| Payroll, 200 technicians | calculate 181 ms; week view 27 ms (306 KB); approve selected 287 ms; 400 payouts |
| Realtime fan-out, 55 live streams | one `appointment_created` → all 55 once each, p50 46 / max 47 ms |
| Mobile assignment (#193 off-screen) | own room 1.34 s, phone screen 1.40 s (includes the outbox tick) |
| Outbox publish lag under a synthetic 3,500-booking burst | before the drain fix (run r2): p50 125 s / max 164 s; after: p50 8.3 / p95 27.8 / max 30.7 s over 4,616 events — **WATCH**: each event runs 5 consumers sequentially in their own transactions (~25 round trips); a separate realtime lane or per-tenant parallel lanes is the next step (NEXT_STEPS) |

## M4 close-out — Oct 24 2026 (commits `9191a704` … `c7ac0064`)

Same machine class (2 vCPU, ≈7 GB, API + PostgreSQL 16 + load generator on one host). Every number below is reproducible
with the script named next to it.

### Indexes (M4) — migration 691, measured on a MULTI-TENANT fixture
`apps/api/scripts/m4-large-salon-explain.mjs` (scratch DB, 60 salons — one with 200 technicians and 1,000 appointments a
day, 59 with 20 / 80 — 120 days of history + 14 ahead: 772k appointments, 687k queue items, 240k tech-queue tickets, 37k
blocked times). EXPLAIN (ANALYZE, BUFFERS), best of 5, the 200-technician salon. Raw run:
`docs/pilot-runs/2026-10-24-m4/index-explain.tsv`.

| Lookup (source) | Before | After | Index |
|---|---|---|---|
| queue item by appointment (booking reassign / check-in) | 12.05 ms, 3,472 buf | 0.012 ms, 4 buf | `idx_pos_queue_items_tenant_appointment` (partial) |
| queue "last served today" per technician (queue state signals) | 18.30 ms, 3,472 buf | 0.34 ms, 600 buf | `idx_pos_queue_items_tenant_tech_started` (partial) |
| queue item by ticket (Service Done) | 9.98 ms, 3,469 buf | 0.022 ms, 7 buf | `idx_pos_queue_items_tenant_ticket` (partial) |
| tech-queue ticket by appointment (booking detail) | 3.60 ms, 1,508 buf | 0.011 ms, 4 buf | `idx_pos_tech_queue_tenant_appointment` (partial) |
| tech-queue tickets for a 50-row booking page | 4.87 ms, 1,508 buf | 0.054 ms, 170 buf | same |
| tech-queue ticket by ticket (Service Done) | 6.52 ms, 1,525 buf | 0.010 ms, 4 buf | `idx_pos_tech_queue_tenant_ticket` (partial) |
| blocked times, one / 200 technicians, one day (availability, Go Check-In) | 0.09 / 0.11 ms, ~70 buf | 0.015 / 0.031 ms, 3 buf | `idx_technician_blocked_times_tenant_date` |
| blocked times, board day (tenant + branch-or-null) / 14-day payroll range | 0.16 / 0.25 ms | unchanged | existing 035 index is used |
| technician by e-mail (hiring duplicate check) | 0.13 ms | — | **not added**: no SQL lookup by `technicians.email` exists (the check reads the roster and `global_tech_profiles.email_normalized`, unique-indexed) |
| appointments: day × 12 / 200 technicians / whole salon | 0.09 / 0.91 / 0.29 ms | — | **not added**: the existing (tenant, branch, technician, date) / (tenant, branch, date) indexes serve them |

Why these were slow: the booking / queue reads scope branch as `branch_id = $b OR branch_id IS NULL`, so only the
`tenant_id` prefix of the (tenant, branch, …) indexes was usable — each lookup read the salon's whole queue history and
grew every day. Sizes on the fixture: 23 / 35 / 33 / 11 / 11 MB / 600 kB. Built `CONCURRENTLY` (no-transaction file).

### Rate limit (M4) — the budget from the apps' own cadences
`apps/api/src/common/tenant-rate-limit.vitest.spec.ts` derives the load from source (15 s safety sync, display / kiosk
heartbeats, Messages polls, Owner Live Ops, the Tech App home's 3 realtime readers, the new 5 s branch-frame throttle) for
two shapes. **20 technicians: 1,075 req/min. 200 technicians at the busy hour (4 visits/min, 25 branch frames per visit,
6 desks, 3 managers, 6 displays, 2 kiosks): 10,030 req/min** — tech safety sync 2,400, tech realtime 4,000, POS desks 1,872,
managers 900, actions 400, messaging 320, displays 132. Busiest single device: a POS desk, ~312/min; a tech phone ~34/min.
- Before M4: one budget, 3,000/min per location → a 200-technician salon's peak was 3.3× over it.
- Tech App before M4: every branch frame re-read 3 cards on every phone — 75 GETs per visit per phone (≈60,000/min at
  200 phones). Now 14 relevant frames per visit, ≤ 12 re-reads/min per card (`apps/tech-web/src/lib/techRelevance.ts`).
- Now: **24,000/min per location** (2.4× the model) and **2,000/min per client** (one signed-in session; 6× the busiest
  device) checked first. A runaway client is refused at 2,000 instead of being able to spend the whole location budget.

### Booking change feed (M4)
`BOOKING_FEED` 50 rows → RESYNC on every tick of a busy minute. Now paged: 200 rows a page, a sweep ≤ 3 pages
(> 600 rows → RESYNC, a bulk import). Tests: 450 rows paged once each; real-Postgres keyset with 30 rows sharing one stamp.

### Clock-in burst and queue state (M5-2 / S-A12) — `apps/api/scripts/m4-clock-burst-bench.mjs`
A copy of the M5 pilot database (the 200-technician salon), the real API, 100 kiosk clock-ins at once, then 30 walk-ins at
once, then `GET /pos/queue/state` ×5 as the front desk. pg_stat_statements + `/proc` CPU.

| | Before | After |
|---|---|---|
| POS queue state, 100 clocked in, ~60 waiting | 1,750–1,850 ms; ~2,500 SQL statements per GET | **225–295 ms p50 (first 206–362 ms)**; ~470 statements |
| 100 clock-ins at once: wall / p95 | 3.3–4.1 s / 3.3–4.0 s | 3.5–3.8 s / 3.4–3.7 s (**unchanged**) |
| API CPU per burst / PostgreSQL CPU | 5.4–5.9 s / 0.9 s | 5.3–5.8 s / 0.9–1.1 s |

Queue state: the board's Best Match asked the AI engine once per waiting guest and each guest re-read the whole branch
(active queue, 200 technicians' signals, catalog, exact skills, roster, settings, appointments, turn day). One batch read now.
Clock-in: the host is CPU-bound — 100 × one scrypt PIN verification (34 ms each) is ~3.4 of the API's ~5.5 CPU-seconds on
2 cores; SQL is ~0.5 s in total. Measured with scrypt stubbed out (an experiment, not shipped): p95 1.7–2.2 s. So
**sub-second p95 is not reachable on this host while every tap verifies one scrypt hash**. Shipped anyway (correct at any
scale, matter on a multi-core host): the turn-lock section is shorter (settings + zone read before the branch lock, the
sequence number inside the insert, the status outbox write before the hook) and a technician's clock row reads only her
punches (a burst read ~16k punch rows before). Options for Kevin: more cores (scales linearly), or a security decision on
the PIN verifier (the keyed HMAC lookup already in place vs. scrypt on a 4-digit PIN — NEXT_STEPS M4-1).

### Realtime lag under a burst (M5-1) — `apps/api/scripts/m4-outbox-burst-bench.mjs`
1,000 bookings written at once, the five real consumers of `appointment.created`, real PostgreSQL.

| Lanes × consumers per event | Drain | Realtime lag p50 / p95 |
|---|---|---|
| 1 × 1 (before) | 7.5–8.7 s | 3.8–5.0 / 7.1–8.3 s |
| 1 × 2 | 6.1 s | 3.2 / 5.8 s |
| 1 × 4 | 4.7–5.6 s | 2.4–2.9 / 4.4–5.3 s |
| **2 × 2 (shipped)** | **3.6–3.8 s** | **1.7–2.0 / 3.4–3.6 s** |
| 4 × 1 / 4 × 2 / 8 × 1 | 3.9 / 4.0 / 3.8 s | 1.9–2.0 / 3.6–3.8 s |

Per aggregate the order is unchanged; §38 is now per aggregate (EVENT_ARCHITECTURE_REPORT.md). The p95 < 2 s target for a
3,500-event burst is **not** met on this host (2.3× better; CPU-bound beyond 2 × 2).

### Pilot day on the M4 code — `docs/pilot-runs/2026-10-24-m4/` (fresh DB through migration 691; 177/177 PASS)

| Phase-11 measure | M5 run (before M4) | M4 run |
|---|---|---|
| 100-technician clock-in burst | wall 3.2 s, p95 3.1 s | wall 3.6 s, p50 3.2 s, p95 3.56 s (100 shifts, 100 joins, no duplicates, 20 replays write nothing) — **not improved** (CPU-bound, see above) |
| POS queue state, 100 clocked in, 41 items | 1.65 s, 60 KB | **0.40 s**, 60 KB |
| Outbox publish lag during the 3,500-booking volume burst (4,616 events) | p50 8.3 / p95 27.8 / max 30.7 s | **p50 1.8 / p95 17.2 / max 19 s** |
| 429s answered to the paced load generator | 0 (3,000/min limiter) | 0 (24,000/location, 2,000/session; the volume days booked from 4 desk sessions) |
| Day grid p50 / p95 at 500 / 1,000 / 2,000 records | 43/57, 48/70, 58/78 ms | 43/60, 51/74, 65/147 ms |
| Fair Turn recommend, 105 clocked in | p50 96 / max 163 ms | p50 107 / max 148 ms |
| Payroll, 200 technicians: calculate / week view / approve | 181 / 27 / 287 ms | 180 / 26 / 260 ms |
| Realtime fan-out, 55 streams; #193 own room / phone | p50 46 ms; 1.34 / 1.40 s | p50 174 ms; 1.16 / 1.23 s |

## M4 follow-ups — Oct 26 2026 (outbox lanes review fixes; M4-1 PIN cost)

Host note: every number in this section was taken on the same 2-core host while it carried other work (load average
9–12 on 2 cores throughout), so the absolute times are 3–6× the Oct 24 numbers above and are **not** comparable to them;
before/after pairs were taken back to back under the same load and are comparable to each other.

### Outbox lanes — the review's three risks, fixed (`EVENT_ARCHITECTURE_REPORT.md` §M4 follow-up)
(a) recipe deduction locks the branch's stock rows in `product_id` order before counting, alerts/audit/`inventory.low_stock`
inside the deducting transaction (`modules/inventory/src/recipe-usage-lanes.postgres-race.vitest.spec.ts`: on the old code
the overlap recorded −2 for one bottle, 20/20 rounds deadlocked 40P01, and the alert leaked out of the open transaction);
(b) loyalty gift-card netting is first-tender-first by `payments (created_at, id)`, not by processing order
(`loyalty-points.pgtest`: both orders → 9 + 30 points, excluded 5000 on the first tender; the old code gave the later
tender 0 points when its lane ran first); (c) the pipeline runs on ~~`DATABASE_WORKER`~~ the PRIMARY pool (corrected Oct 26: the worker role is least-privilege and has no grants on event / consumer tables) with a shared `ConsumerBudget` of
`min(lanes × consumers, poolMax − 2)` (`events-pipeline-pool.vitest`).

`apps/api/scripts/m4-outbox-burst-bench.mjs --events 1000 --concurrency 2x2 --pool N` (1,000 bookings, five real consumers,
real PostgreSQL; `--pool` sizes the pg pool and derives the budget exactly as `events.module` does):

| Lanes × consumers | Pool / budget | Drain | Realtime lag p50 / p95 |
|---|---|---|---|
| 1 × 1 | unbounded (reference under this load) | 36.0 s | 19.4 / 34.0 s |
| 2 × 2 | unbounded (the Oct 24 shipped config) | 21.0–21.4 s | 11.3–11.8 / 20.1–20.3 s |
| **2 × 2** | **pool 5 → budget 3 (shipped: the default worker pool)** | **21.3–21.4 s** | **11.6–12.1 / 20.3–20.3 s** |
| 2 × 2 | pool 6 → budget 4 | 23.3 s | 10.5 / 21.9 s |

The bound costs nothing measurable at 2 × 2 (the lanes rarely have four consumer transactions open at the same instant,
and this host has two cores); the 2.3× over 1 × 1 is kept. `PG_WORKER_POOL_MAX=6` lifts the budget to the full 2 × 2.

### Clock-in burst — M4-1 DONE (Kevin: "lower the hash cost") — `apps/api/scripts/m4-clock-burst-bench.mjs --pin-hash …`
The Clock PIN is now hashed at its own scrypt cost (`modules/workforce/src/technician-clock-pin/clock-pin-hash.ts`:
N = 2048, r = 8, p = 1, 32-byte key; ~4 ms where the password cost was ~34 ms, 8× cheaper per verify) in the same
self-describing `scrypt$N$r$p$salt$hash` format, so every existing password-cost hash keeps verifying and is re-hashed
on the technician's next successful clock-in (`setPinHash`: the lookup digest, counters and lockout untouched). Lockouts,
the per-kiosk window and the keyed lookup digest are unchanged. Same pilot copy, 100 kiosk clock-ins at once, three
rounds each, back to back on the loaded host:

| 100 clock-ins at once | wall | p50 | p95 | API CPU / burst | PostgreSQL CPU |
|---|---|---|---|---|---|
| Before — password-cost hashes verified at the password cost (`dist` pinned to N = 16384 for the run) | 16.7–23.6 s | 14.5–22.1 s | 16.5–23.4 s | 7.4–8.3 s | 1.7–1.8 s |
| Transition — password-cost hashes, each tap verifies at the old cost AND re-hashes at the new (round 1 of `--pin-hash password`) | 18.7 s | 18.2 s | 18.5 s | 8.5 s | 1.8 s |
| **After — PIN-cost hashes (rounds 2–3 of `--pin-hash password`, and `--pin-hash pin`)** | **5.4–8.4 s** | **5.0–8.1 s** | **5.2–8.3 s** | **2.3–3.1 s** | 1.3–1.6 s |

API CPU per burst fell ~3× (the scrypt share went from most of it to a small part; what remains is the turn-lock section,
the shift / rotation writes and the realtime fan-out). Wall time on this host is dominated by the load it was sharing; the
sub-second p95 target still has to be read on the pilot host (NEXT_STEPS M4-1 / S-A12 — rerun `m4-clock-burst-bench.mjs`
there; the Oct 24 baseline on that host was p95 3.4–3.7 s with scrypt 3.4 of 5.5 CPU-s, so ~1.7–2.2 s is the expected
floor, as the stubbed-scrypt experiment measured). 100 shifts, 100 joins and no duplicates in every round.

## Oct 26 close-out — realtime-first lane, clock-in re-measure, Owner App at 200 (commits aad5863f … 3f3a89b2)

Host note: the same 2-core / 7 GB sandbox, shared with another agent's work during these runs (load average 2–5 on 2
cores); every pair below was taken back to back.

### Realtime lag under a burst (§90 / §1) — the realtime-first lane
The M4 publisher ran every consumer of an event before the next batch was claimed, so an SSE frame waited for every earlier
batch's push / analytics / in-app work. Now (`outbox-publisher.ts`, `event-transport.ts` `first`, `ConsumerRunner.runBatch`)
each claimed batch is projected right after its claim (one `processed_events` read + one write for the whole batch — the
projection writes nothing), and the batch's other consumers follow, batch after batch, while the next batches are claimed
(lead ≤ 40 batches). Per aggregate, per consumer the order is unchanged; 044a1878's head-of-line claim is untouched. Two
findings on the way: the claim joined the whole ranked set back to the table before limiting it — with "nothing pending"
statistics right after a burst the planner chose a nested loop (3,500 × 3,500 comparisons, a **2.5–4.6 s claim**, EXPLAIN
ANALYZE on the bench copy); it now picks the batch first. And with the lane on, the claim (which reads every open row) is
on the realtime path: 250 a claim, and migration 693 indexes the open rows (p95 1.8–2.7 s → 1.3–1.6 s on the loaded host).

`m4-outbox-burst-bench.mjs --pool 5` (five real consumers of `appointment.created`, real PostgreSQL, pilot copy):

| Burst | Publisher | Load avg | Realtime lag p50 / p95 / max | All consumers done (drain) |
|---|---|---|---|---|
| 3,500 | M4 (`--first 0`) | 0.3 | 7.3 / 13.0 / 13.6 s | 13.8 s |
| 3,500 | M4 (`--first 0`) | ≈ 5 | 20.3–22.9 / 33.0–33.8 / 34.6–35.6 s | 34.9–36.0 s |
| **3,500** | **realtime-first** | 2–3 | **0.9–1.0 / 1.3–1.6 / 1.3–1.6 s** | 11.8–13.4 s |
| 3,500 | realtime-first | ≈ 5 | 1.9–2.1 / 2.6–3.0 / 2.6–3.0 s | 32.6–36.1 s |
| 1,000 | M4 | 0.3 | 1.8–2.5 / 3.4–4.1 s | 3.6–4.4 s |
| **1,000** | **realtime-first** | 0.3 / ≈ 5 | 0.9–1.0 / 1.15–1.2 s · 0.25–0.27 / 0.34–0.39 s | 3.8–11.3 s |

**Live pilot** (`docs/pilot-runs/2026-10-26-200b/`, phase 11's 3,500-booking volume burst, measured from
`processed_events` of `realtime.projection` against `occurred_at`): **SSE frame lag p50 0.54 / p95 0.99 / max 1.29 s over
4,625 events** (Oct 24 M4 run: publish p95 17.2 s). The slower consumers' completion (`published_at`) was p95 35.3 s in the
same run under load ≈ 5 — they are not on the screen-refresh path. **Verdict:** the < 2 s p95 target is met in the live
pilot and on the lightly loaded bench; on this shared 2-core host under load ≈ 5 the bench p95 is 2.6–3.0 s. A dedicated
≥ 4-core API host is the remaining (external) step for a guaranteed number.

### Clock-in burst re-measured (§1 / §89)
| Where | wall | p50 | p95 | API CPU / burst |
|---|---|---|---|---|
| Pilot 200b phase 11 (100 kiosk taps at once) | 3.4 s | 3.2 s | **3.3 s** | — |
| `m4-clock-burst-bench.mjs --rounds 3` (pilot copy, load ≈ 5) | 3.8–5.2 s | 3.0–4.3 s | 3.7–5.0 s | 1.5–2.4 s |

Unchanged verdict: CPU-bound on 2 cores (the turn-lock section, shift / rotation writes and fan-out after M4-1's cheaper
PIN hash). Sub-second p95 needs more cores — not met here.

### Owner App at 200 technicians (§62 / §69) — pilot 200b, after a paid day of 104 POS checkouts
| Read (owner session) | Result |
|---|---|
| Staff Performance page, 20 a page (11 pages, 201 technicians) | p50 33 / p95 38 ms, 4.6 KB |
| Staff Performance page, 100 a page (month / YTD) | 31–34 ms, 21.8 KB |
| Branches / finance summary / payment mix (week, month, YTD) | 23–37 ms |
| Staff report export (201 rows) | 42–48 ms |
| Payroll week, 200 statements | 48 ms, 612 KB |
| Chromium 390×844: Team / Reports / Payroll week to content | 397 / 343 / 624 ms |

Every total equalled PostgreSQL (per technician, per branch, per service, per tender, per payout method).

## §2 remainder — Oct 27 2026: the last roster-wide POS / Owner states, measured at 1,000 technicians
The four reads that still answered one row per technician of the salon are server pages now (request ≠ roster). Payload =
`JSON.stringify` of the state the server returns, 1,000 technicians, same fixture as the tests named.

| Read | Before (every technician) | After (one page) | Test |
|---|---|---|---|
| `GET /pos/tech-queue/state` (lane rows + lanes + Available + names) | 768 KB, largest technician list 1,000, 257 ms (PGlite) | `?lanePage=1&lanePageSize=10&roster=none`: **12.3 KB**, largest list 10, 103 ms | `tech-queue-lanes-1000.pgtest` (real migrated schema) |
| `GET /pos/check-in/state` (`technicians` + `availableTechnicians`) | 242 KB, 1,000 + 1,000 | `?roster=none&techPage=1&techPageSize=5`: **1.4 KB**, 5 | `check-in-roster-1000.vitest` |
| `GET /pos/time-clock/state` (the day's roster) | 264 KB, 1,000 rows | `?page=1&pageSize=25`: **10.1 KB**, 25 | `time-clock-roster-1000.vitest` |
| `GET /owner/live` (team + in-service list) | team window 1,000 + in-service window 1,000 | team 25 a page (search `vi_fold`, status), in-service 25 a page | `owner-live-ops-queries.pgtest` (1,000 technicians, 60 in service) |

KPIs and counts are still computed over every technician (Available Now 900 of 1,000, Techs Available, Clocked In); only
the lists are pages. Screen side: `apps/pos-web/src/screens/roster-1000.test.tsx` (Tech Queue, Time Clock, Check-In added to
Walk-In / New Booking / AI optimizer / Tech Appointments — no response carries more than one page; every state read has
`roster=none` or a page) and `apps/owner-web/src/screens/LiveOperationsScreen.test.tsx` (1,000-technician fake server).

## Platform Announcements (§98) — Oct 27 2026: indexes reviewed against query plans (migration 699)

`DATABASE_URL=… node apps/api/scripts/platform-announcements-explain.mjs` — scratch database `pa_explain`, real migration
runner, platform-scale fixture: 3,000 salons × 2 branches, 20,000 notices (19,800 history — published-and-expired or
archived — 60 drafts, 140 live / scheduled), 1,882,760 target rows, 765,440 receipts. EXPLAIN (ANALYZE, BUFFERS), best of 5,
three passes on one database: 699's indexes dropped + the pre-Oct-27 salon search, dropped + the rewritten search, rebuilt.

| Query (copied from the service) | Before (674 indexes, old search) | Rewritten search | + 699 indexes | Plan after |
|---|---|---|---|---|
| POS `active()` snapshot | 1.25 ms | 0.86 ms | **0.43 ms** | Bitmap Index Scan `idx_platform_notices_live_ends` + index-only target / receipt probes |
| POS `nextChangeAt` | 5.8 ms | 4.1 ms | 3.7 ms | `idx_platform_notices_live` (unchanged — not indexed further) |
| Admin list page 1 (no filter) | 20.1 ms | 19.9 ms | **0.68 ms** | Index Scan `idx_platform_notices_recent` (was Seq Scan + sort of 20k) |
| Admin list `status=active` | 5.7 ms | 5.6 ms | **0.66 ms** | Index Scan `idx_platform_notices_recent` |
| Admin count `status=active` | 4.7 ms | 5.2 ms | 4.6 ms | Seq Scan (derived CASE status; not indexable — kept) |
| Admin search "holiday" page 1 | **941 ms** | 32 ms | **6.3 ms** | partial unique target indexes via the salon-first UNION |
| Admin search "Salon 101" page 1 | **1,540 ms** | 46 ms | **11 ms** | same |
| Admin count search "holiday" | 681 ms | 28 ms | 29 ms | same |
| Admin detail receipt stats | 0.50 ms | 0.51 ms | 0.53 ms | `idx_platform_notice_receipts_notice` (unchanged) |

Findings: (1) 674's `idx_platform_notices_live (starts_at, ends_at)` must read every published notice that ever started (all
history) for the POS snapshot — `(ends_at) WHERE published` skips expired history (snapshot halves; grows with history, so it
matters more each month). (2) The Super Admin list sorted the whole table per page — `(updated_at DESC, id)` serves the
ORDER BY … LIMIT 25. (3) The salon-name search was a query problem: the correlated EXISTS could not use the PARTIAL target
indexes (`WHERE target_type = …`), so it scanned 1.9M target rows; `platform-notice.service.ts` now matches salons first and
reads their targets per `target_type` (pgtest `§98 salon search rewrite`). Not added: receipt stats, nextChangeAt and the
status count (above). One run recorded; numbers vary ±30 % between runs on this 2-core host (an earlier run: snapshot 0.78 →
0.28 ms, list page 21.4 → 1.2 ms).

## Not measured here
- Production-like hardware (≥ 4 cores, a separate database host); native app shells.
