# SMOOTH REFRESH, REALTIME SYNC & BOOKING CONCURRENCY — FINAL REPORT (spec §123)

Sep 30 2026 · built on the merged tree, audit first (`ARCHITECTURE_AUDIT.md`, commit `28e39bf`) · reuse over rebuild: no
second realtime stack, no query library, no job framework, no `*_v2` tables.

## 1. The refresh architecture that existed, and the exact cause of the screen shading

**Existed and kept (reused):** SSE realtime through one `RealtimeStreamFactory` with per-room sequence numbers and
`resync_required` on gaps (Constitution 9); a transactional outbox → projection consumer → SSE rooms (Constitution 8);
the `@aipowersalon/realtime-client` package (jittered 1→30 s reconnect, dedupe, stale-version drop, gap → reconcile,
wake on visibility/online); a worker process with job classes; booking holds + database no-overlap guards (372/426);
claim-first card payments; the inventory ledger.

**What made screens shade, blank or jump — found in source:**
1. **Nine live boards and eight report screens replaced the whole page on a background refresh.** Live boards
   (Booking, Check-In, Queue, Serving, Service Done, Checkout, Tech Queue, …) did `if (error) return <error page>` —
   one failed background request blanked the board. Reports did `setLoading(true)` on every timed refresh and gated
   the render — a "Loading…" flash every cycle. **Fixed (P1).**
2. **The only 15-second timer in the POS was the header message inbox** (developer code): a raw `setInterval`, hidden
   tabs included, flashing its own loading state. The sidebar badges polled every 30 s the same way. **Fixed (P1/P2).**
3. **Honest limit:** the operational screens themselves already replaced data in place (no nulling, no spinner, no
   remount), and there is no TanStack `isLoading || isFetching` pattern anywhere. If the **deployed** POS still shades
   every 15 s after this build, the cause is outside the repository source (e.g. a stale deployed bundle) — a screen
   recording or HAR of the live POS is needed; it is not guessed here.

## 2. What changed (commits, in order)

| Commit | Area | Change |
|---|---|---|
| `28e39bf` | audit | `ARCHITECTURE_AUDIT.md` — repository audit + all 123 sections mapped (EXISTS / HARDEN / BUILD) |
| `10f4c91` | P1+P2 client | No blank screens on failed/timed refresh (17 screens); **one shared sync policy** `packages/realtime-client/src/sync-policy.ts` (`SYNC_POLICY`, `SafetySync`, `SyncStatusStore`); `useRealtime` always-on safety sync with single-flight; `useSafetySync` for event-less widgets; inbox + badges moved onto it; status pill shows "Couldn't refresh — showing data from …" |
| `0c0d73b` | P3 booking | Reschedule/update take the technician+day lock, re-check in the transaction, map the DB refusal to 409 (**it used to report success**); migration **482** (`version`, reasoned-overbook columns, reshaped guard, delta index); `overbookingPolicy` BLOCK / WARN_REQUIRE_CONFIRMATION / ALLOW_AUTHORIZED_ROLE + `booking.override`; stable 409 codes; POS drag/Move send `expectedVersion` |
| `3a6383f` | appointments | Change history had silently stopped on every non-transaction path (a SAVEPOINT outside a transaction) — fixed |
| `c6bc902` | loyalty | Concurrent point adjustments lost updates / duplicated profiles — per-customer lock |
| `217819e` | customers | Profile edits check and bump the existing `record_version` → 409 `VERSION_CONFLICT`; POS edit form sends the version it opened on |
| `981c19d` | checkout | Two stations taking cash for one visit both recorded payment — ticket lock + paid-so-far check → 409 `CHECKOUT_ALREADY_IN_PROGRESS` |
| `9c40bbf` | queue | Two receptionists assigning one guest both "succeeded" (both techs notified) — compare-and-set → 409 `VERSION_CONFLICT` |
| `f59ea74` | P5a feed | Migration **483** (DB stamps `updated_at` + `version` on every update, whoever writes); `GET /pos/booking/changes?since=` + `RESYNC_REQUIRED`; the 15 s tick asks the feed first; quiet-board cursor fix |
| `e6d68f7` | P5b server | `SyncReconciliation` — 20 s ± 2 s, worker, single-flight across workers, active scopes only; **releases expired booking holds** (the existing sweeper was opt-in and enabled nowhere) |
| `b75d810` | P6 | Drag drop quotes the version from drag START (a mid-drag refresh made it overwrite another device's change); UI-preservation suite |
| this commit | P7 | Conflict-rate telemetry + coverage guard (mutation-checked: dropping one `recordConflict` names the file); failure-mode tests; measured numbers; this report |

## 3. Confirmed timings

| System | Spec | Built |
|---|---|---|
| Database writes / booking validation | immediate | immediate, inside the write transaction |
| Realtime update | immediate | outbox → projection → SSE (unchanged, Constitution 8/9) |
| **Active POS safety sync** | **15 s** | **15 s ± 2 s jitter** (`SYNC_POLICY.operationalMs`, `jitterMs`) |
| Hidden tab | 30–60 s | 60 s (`hiddenMs`); a true sleep runs nothing and syncs on wake |
| Focus / tab visible / reconnect | immediate | immediate (`nudge`, `visibilityChanged`) |
| **Server reconciliation** | **20 s** | **20 s ± 2 s** (`RECONCILE_EVERY_MS`, self-rescheduling) |
| Realtime reconnect | backoff 1→30 s | existing jittered backoff, capped 30 s |
| Overlap | none | client single-flight (skipped + counted); server advisory lock across workers |

## 4. Measured (sandbox, real PostgreSQL 16 — not production)

| Measure | Value | How |
|---|---|---|
| Full Booking board reload (12 techs, 60 appts) | **67.8 KB, 3 requests** (state 32.4 KB + day-grid 35.4 KB); state 55.5 ms p50 / 128.7 p95, day-grid 46.4 / 89.0 ms | `booking-board-payload.measure.vitest.spec.ts` (timings vary run to run; byte sizes do not) |
| Quiet 15 s tick (change feed) | **106 bytes, 1 request, 0.6 ms p50 / 7.5 p95** | same test — a quiet tick is ~0.16 % of a reload's bytes and one request instead of three |
| Realtime fan-out | 0.8–1.1 µs per subscriber; 7.8 KB per connection | Constitution 9 `measure:realtime-capacity` |
| Reconciliation run | milliseconds on the test database; never overran | `sync-reconciliation.postgres-race.vitest.spec.ts` |
| Client background-fetch duration, errors, skipped ticks | live in each POS tab: `window.__apsSync.snapshot()` (p50/p95/max) | `SyncStatusStore` |
| Conflict rates | `aipowersalon_concurrency_conflicts_total{module,code}` | every concurrency 409 counted (guarded) |

**Not measurable here (needs staging/production):** end-to-end realtime latency POS A → POS B on real networks; browser
render duration of the 12-technician board (§53/§54 — jsdom timings are meaningless); payload over real compression;
reconciliation under 10,000 tenants.

## 5. Concurrency tests (real PostgreSQL, opt-in `PG_RACE_URL`, each guard mutation-checked)

| Spec | Scenario | Result | Mutation |
|---|---|---|---|
| §104 | 10 devices book one technician/time | 1 booking, 9 `APPOINTMENT_CONFLICT` | lock + guard removed → raw DB errors |
| §104/§75 | 10 devices reschedule onto one free slot | 1 moves, 9 refused (used to "succeed") | swallow refusal → fails |
| §14 | stale appointment version | `VERSION_CONFLICT`, newer change survives | — |
| §105 | 2 devices save one customer version | 1 write, 1 `VERSION_CONFLICT` | predicate removed → both "win" |
| §106 | 10 receptionists assign one guest | 1 assignment, 9 `VERSION_CONFLICT` | CAS removed → 10 assign |
| §107 | 10 stations take cash for one visit | 1 payment, 9 `CHECKOUT_ALREADY_IN_PROGRESS` | lock removed → 10 payments |
| §108 | gift card double spend | already safe: one guarded UPDATE (`balance_cents >= amount`) | reviewed |
| §109 | 10 simultaneous point deductions | 5 of 10 succeed, balance 0, ledger agrees | lock removed → 10 succeed |
| §109 | first-ever adjustments ×10 | one profile | lock removed → 10 profiles |
| §73 | expired hold blocks its slot | released by reconciliation; slot bookable again | sweep removed → fails |
| §103 | second reconciliation worker | skips while the lock is held | lock check removed → runs |

**Method lesson recorded in the commits:** a plain `Promise.all` is not a race — each transaction finished before the
next pool connection opened, and one mutation check survived. The race tests now hold a table lock so every contender
reads first and blocks on the write.

## 6. UI preservation (§48–§52, §115–§119) and failure modes (§110–§114)

Preservation (`POSBookingScreen.sync-preservation.test.tsx`, each asserts the refetch really happened): 12-technician
board keeps scroll top/left, selected date and search text; a failed refresh keeps the board; New Booking keeps the
typed name and the Walk-in tab stays selected; the Manage drawer stays open; a refresh mid-drag neither cancels the drag
nor changes the version the drop quotes. POS Customers edit form keeps its input through a `VERSION_CONFLICT`.

Failure modes (`sync-failure-modes.test.tsx`): **realtime off** → 15 s safety sync alone keeps the screen current;
**polling off** → events alone update it and no timer fires; **browser sleep 10 min** → immediate refresh on wake, page
never reloaded; **poor network** (40 s responses) → never two requests at once, skipped ticks counted, slowness measured.
**Redis off** → PostgreSQL stays authoritative: every race test above runs with no Redis at all, and the backbone-down
case is Constitution 9's named test §237.

## 7. Remaining risks and gaps (honest)

1. ~~Owner, Technician and Customer apps have not adopted the safety sync~~ — **CLOSED (follow-up commit)**: all three
   adapters now run an always-on `startVisibleSafetySync` from the shared package in place of the down-only
   `FallbackPoller`. Cadence per §81: **Technician app 15 s** (live queue = operational), **Owner and Customer apps
   45 s** (dashboards / summaries = the 30–60 s class); hidden tab 60 s, immediate on return, single-flight. Pinned by a
   package test and an Owner-hook test (mutation: no safety sync → fails). Owner 264, Tech 108, Customer 221 pass.
2. ~~§53 / §54 deferred to the browser pass~~ — **MEASURED in Chromium (`6a1263e`)**: exactly one technician column's DOM
   changes per single-appointment refresh (40/40); render work p50 ~6 ms, p95 ~20–26 ms on the sandbox CPU. §53 is met
   by React's reconciliation; §54 memoisation is not warranted by these numbers.
3. **Real-browser crash, fixed (`6a1263e`)**: the sync layer called the browser's setTimeout as a method — every POS
   screen threw "Illegal invocation" in Chromium while every jsdom test passed. Strict-timer tests and
   `npm run perf:booking -w apps/pos-web` now catch it. Run that check before every release.
4. `technician_earnings_updated` / `settings_updated` realtime events still have no producer (Constitution 9 carry-over).
5. The opt-in `BOOKING_HOLD_SWEEP_CRON_ENABLED` minute sweeper still exists beside the reconciliation; both are
   idempotent, but deployments should now leave it off.
6. Staging must confirm the live POS no longer shades (section 1, item 3).

**Process note:** a second session worked in this repository several times during this build (including drafting P7 and
this report); each of its commits and drafts was reviewed and re-verified here before committing (one regression found
and fixed in `3a6383f`; one defect fixed in its staged feed before committing `f59ea74`; P7's numbers re-measured).

## 8. Follow-ups closed after this report was first written

| Commit | Spec | What |
|---|---|---|
| `4f50d88` | closing line, §81 | Owner (45 s), Technician (15 s) and Customer (45 s) apps run the always-on safety sync |
| `8844b80` | §11 | Salons choose the double-booking policy in POS Settings → Booking & Appointments (Block default). Found on the way: the booking engine ignored that whole saved section (hard-coded defaults for every salon) — it now reads the saved slot interval, buffer, default duration, deposit-required and policy |
| `c42c17f` | §88 | HTTP compression for responses ≥ 1 KB; SSE streams excluded (a compressed stream holds events back). Dependency pinned to `compression@1.8.1`, installed without scripts, every new package read |
| `cd96331` | §3, §28, §95 | Wiring walk-through: POS check-in now emits + projects (was reaching other screens only at the 15 s tick); skip-line drawer onto the sync layer; Customers list onto the sync layer |
| `6a1263e` | §53, §54 | Real-browser harness + the Illegal-invocation fix (above) |
| (this commit) | §3, §42–§43, §59–§61, §110–§113 | Real-browser live-update check: the POS client against a genuine SSE endpoint — 13/13, reconnect 0.76 s after a drop, delivery 0–2 ms locally; reproduces the Sep 19 coalescer bug when reverted |
| `fde7461` | §90 | ETag → 304 for four rarely-changing authenticated reads (services, categories, booking settings, business/branch) via `private, no-cache`; everything else stays `no-store`. Written by the second session; verified here (exact anchored paths, all four routes exist, low-sensitivity payloads, mutation fails) |
| `eb14cb2` | §79, §108 | Gift-card race test; found and fixed a wrong balance-after in the redemption ledger under concurrency |
| `8b51eef` | §100 | Client telemetry: payload bytes, records changed, quiet ticks, resyncs per background sync |
| `8922007` | §62 | Reception Copilot caller card refreshes in place on customer events (AI Receptionist verified live, no cache) |
| `55913ff` | §34, §57 | Migration 484: the reconciliation's full-table scan (108 ms / 20 s at 576k rows) → index, 0.32 ms |
| (this commit) | §65, §66, §112 | Redis-down consolidated: cache + limiters fail open; business write paths proven Redis-free by a static guard |

