# SMOOTH REFRESH — WIRING CHECK (all 123 sections against the final tree)

Sep 30 2026 · tree `cd96331` · every row was checked by reading the code or running the named test on this tree today —
not from commit messages. Real-Postgres suites ran on a freshly migrated PG16 database (483 migrations) minutes before
this was written.

Legend — **WIRED**: built, connected end-to-end, tested · **WIRED (verify in staging)**: built and tested here, but the
number the spec asks for can only be measured on real infrastructure · **DEFERRED**: deliberately not done, reason given
· **N/A**: does not apply to this codebase.

## Screens the spec's closing line names

| Screen | Sync hook | Network timers of its own | Blanks on a failed refresh | Loading gate after first load | Page reload |
|---|---|---|---|---|---|
| Booking | `useRealtime('booking')` + change feed | 0 | no | no | no |
| Check-In | `useRealtime('check-in')` | 0 | no | no | no |
| Customer Queue | `useRealtime('queue')` | 0 | no | no | no |
| Tech Queue | `useRealtime` | 0 | no | no | no |
| Serving | `useRealtime` | 0 (1 on-screen clock) | no | no | no |
| Service Done | `useRealtime` | 0 | no | no | no |
| Checkout | `useRealtime('checkout')` | 0 | no | no | no |
| Customer Profiles | `useRealtime('customers')` (refreshes the open profile in place) | 0 | no | no | no |
| Customers list | `useRealtime('customers')` + 45 s — **wired today** (`cd96331`) | 0 | no (fixed today) | no | no |
| Dashboard / Overview | `useRealtime` | 0 | no | no | no |
| Skip-Line drawer | `useRealtime('checkout')` + 5 s while open — **wired today** | 0 (was 5 s) | no | no | no |
| Shell (inbox, badges) | `useSafetySync` | 0 (1 on-screen clock) | — | — | branch switch only (deliberate) |
| Owner App | `startVisibleSafetySync` 45 s | 0 | — | — | no |
| Technician App | `startVisibleSafetySync` 15 s | 0 | — | — | no |
| Customer App | `startVisibleSafetySync` 45 s | 0 | — | — | no |

The only `window.location.reload()` in the POS is the branch switch (a new session), unchanged and deliberate.

## §1–§6 Operating design
| § | Status | Evidence |
|---|---|---|
| 1 | WIRED | Table above; `POSBookingScreen.sync-preservation.test` (5): scroll, date, search, drawer, form, drag all survive a refresh; nothing blanks. `RealtimeStatusPill` is the only indicator. |
| 2 | WIRED | Three layers exist: outbox → projection → SSE; `SafetySync` 15 s; `SyncReconciliation` 20 s. |
| 3 | WIRED (verify in staging) | Producers + projection for create / update / reschedule / cancel / **check-in (wired today)** / queue joined+assigned / service started+completed / checkout completed / customer updated. Latency is measured by `RealtimeMetrics`; the local loop is sub-second, production numbers must come from staging. |
| 4 | WIRED | `SYNC_POLICY.operationalMs = 15_000`; pinned by `sync-policy.test` + `useRealtime.test`. |
| 5 | WIRED | Writes are immediate (repository transactions); `SyncReconciliation` runs in the worker at 20 s. |
| 6 | WIRED | `sync-policy.ts` is the one place all cadences live: 15 s ± 2 s, hidden 60 s, focus/reconnect immediate, server 20 s. |

## §7–§13 Double-booking protection
| § | Status | Evidence |
|---|---|---|
| 7–8 | WIRED | Server-authoritative: create, reschedule and duration edits take the technician+day advisory lock, re-check inside the transaction, and the gist EXCLUDE (426/482) is the last line of defense. Real-PG: 10 devices → 1 booking + 9 conflicts (create AND reschedule). |
| 9 | WIRED | Transaction + lock + version bump (`version` column, 482; trigger 483 stamps every writer) + outbox event, in `KyselyBookingRepository`. |
| 10 | WIRED | Lock key = tenant + technician + date. |
| 11 | WIRED | `overbookingPolicy` BLOCK / WARN_REQUIRE_CONFIRMATION / ALLOW_AUTHORIZED_ROLE; default BLOCK; confirmation + reason + audit; ALLOW_AUTHORIZED_ROLE needs `booking.override` (OWNER + MANAGER). Set in POS Settings → Booking & Appointments (`8844b80`); the engine reads the saved value (real-PG test). |
| 12 | WIRED | 409 `{ code: 'APPOINTMENT_CONFLICT', message, serverTime }` with the spec's sentence; the POS refreshes the schedule behind the modal, not the page. |
| 13 | WIRED | `booking_holds` with expiry (372); expired holds released by the 20 s reconciliation (real-PG test: an expired hold blocked its slot, the run freed it). |

## §14–§16 Optimistic concurrency
| § | Status | Evidence |
|---|---|---|
| 14 | WIRED | `customers.record_version` (reused) + `expectedVersion` → 409 `VERSION_CONFLICT` with `currentVersion`; real-PG: two simultaneous saves → one write; POS edit form keeps what was typed and re-saves against the newer copy. |
| 15 | WIRED | Appointments (`version`), customers (`record_version`), queue (compare-and-set on status + technician), checkout (paid-so-far guard + ticket version), inventory (claim-first ledger), memberships (`expectedVersion`). Technician schedule: N/A as a versioned resource — edits go through the day grid, which the change feed re-reads. |
| 16 | WIRED | No blind last-write-wins on appointments (drag quotes the drag-START version), customers, queue, checkout. |

## §17–§19 Realtime as primary
| § | Status | Evidence |
|---|---|---|
| 17 | WIRED | All listed events have producers and projections (walk-through script, `cd96331`); `technician.status.updated` is the technician profile/membership events plus queue state. `check:realtime-contract` gate: every client event routed and versioned. |
| 18 | WIRED | Outbox → `realtime.projection` consumer → branch room → SSE; sequence numbers per room. |
| 19 | WIRED | The 15 s tick is a safety net: on the Booking board it is a 106-byte change-feed question; events reload at once. |

## §20–§23 Stale-while-revalidate and indicators
| § | Status | Evidence |
|---|---|---|
| 20 | WIRED | 17 screens fixed in `10f4c91` (+ Customers list today); failed refresh keeps last data; pinned. |
| 21 | WIRED | `SyncStatusStore` exposes inFlight / lastSyncedAt / errors; screens keep their own state; only the first load may show a skeleton. |
| 22 | WIRED | First-load skeletons stay; after that, refreshes are invisible (preservation tests). |
| 23 | WIRED | `RealtimeStatusPill`: nothing while healthy; "Live updates reconnecting…", "Offline — showing last synced data", "Couldn't refresh — showing data from 16s ago". No spinner anywhere. |

## §24–§27 Booking board refresh, deltas, cursor, snapshot
| § | Status | Evidence |
|---|---|---|
| 24 | WIRED | State + day grid are branch + date scoped; the tick asks only for changes. |
| 25 | WIRED | `GET /pos/booking/changes?since=` → changed rows + cursor + serverTime (`f59ea74`); deletes are cancellations (rows stay). |
| 26 | WIRED | Opaque `v1.` cursor; invalid/expired or > 50 changes → 409 `RESYNC_REQUIRED`; a quiet board's cursor keeps advancing (40-minute test). |
| 27 | WIRED | RESYNC → full snapshot in place, cursor taken before the snapshot; never a page reload. |

## §28–§33 Customers, queue, serving, checkout
| § | Status | Evidence |
|---|---|---|
| 28 | WIRED | Open profile refreshes in place on `customer_profile_updated`; the list refetches its current page/search only. |
| 29 | WIRED | Customer search is server-side, paginated, trigram-indexed. |
| 30–31 | WIRED | Queue / Tech Queue / Serving: realtime first + 15 s safety sync; queue assignment is compare-and-set. |
| 32–33 | WIRED | Checkout: claim-first payments, processor + webhooks authoritative; no per-second polling; cash double-payment refused (`CHECKOUT_ALREADY_IN_PROGRESS`). |

## §34–§39 Server reconciliation
| § | Status | Evidence |
|---|---|---|
| 34–36 | WIRED | `SyncReconciliation`: expired holds, outbox lag, active scopes only (10-minute window, capped 500); defense in depth — events invalidate first. |
| 37 | WIRED | ±2 s client jitter (`jittered()` test). |
| 38–39 | WIRED — **proven on the built worker** | Runs in the `reconciliation` job class, ±2 s start jitter, `pg_try_advisory_xact_lock` single-flight across workers (real-PG: a second worker skips). Built `dist/worker.js` against real PG16 with an expired hold planted: `WORKER_JOB_CLASSES=critical` → hold still live after 28 s; `critical,reconciliation` → released (`hold_expired`) 23 s after start. |

## §40–§47 Tabs, focus, reconnect, dedupe, library
| § | Status | Evidence |
|---|---|---|
| 40–41 | WIRED | Hidden 60 s; return to a stale tab → immediate; focus/online → immediate (`useRealtime.test`, package tests). |
| 42–43 | WIRED | `ConnectionStateMachine` full-jitter backoff capped 30 s; reconnect → reconcile → refetch. |
| 44 | WIRED | Single-flight in `SafetySync` (mutation-checked); 40 s response test: never two requests at once. |
| 45 | WIRED | Bursts coalesce (250 ms) into one refetch; each screen's refetch is one in-flight promise. Cross-component dedupe of identical GETs is not a separate cache layer — screens do not share requests today (each screen owns one refetch). |
| 46 | N/A | No TanStack/React Query in any app; the hook + policy is the query layer (adding a library would be a second stack, §94). |
| 47 | WIRED | Zero `isLoading || isFetching` gates; the equivalent faults (error gates, report loading gates) fixed. |

## §48–§56 Interaction, forms, drag, rendering
| § | Status | Evidence |
|---|---|---|
| 48–49 | WIRED | Preservation tests: typed customer name, search text, selected tab survive a refresh; edit form version captured at open. |
| 50 | WIRED | Drop quotes the drag-START version (fixed `b75d810`, mutation: 8 vs 7); the drag survives a mid-drag refresh. |
| 51–52 | WIRED | Scroll (top + left), date, filters, open Manage drawer survive (tests). |
| 53 | WIRED — **measured in Chromium** (`6a1263e`) | Real-browser harness, 12 technicians / 60 appointments, 40 refreshes each moving one appointment: exactly **1** technician column's DOM changed in 40/40 — React's reconciliation already repaints only the changed column. `npm run perf:booking -w apps/pos-web` fails if that ever regresses. |
| 54 | WIRED — **measured, memoisation not warranted** | React render work per refresh p50 ~6 ms, p95 ~20–26 ms (sandbox CPU), in the background; first load ~33 ms. Per-column memo of the drag-heavy column code is not justified by these numbers; revisit only on field jank. |
| 55 | WIRED | Customers paginated server-side. |
| 56 | WIRED | Board loads the visible date + technician range only. |

## §57–§67 Queries, versions, sequences, caches
| § | Status | Evidence |
|---|---|---|
| 57 | WIRED — **EXPLAINed on 576k rows** (`55913ff`) | Feed, board, conflict re-check, hold sweep: index scans < 0.1 ms. The reconciliation's active-scopes query was a full parallel seq scan (108 ms, every 20 s, growing) → migration 484 → 0.32 ms, flat. Production pre-build note in the migration. Production plans still belong to staging. |
| 58 | WIRED | Trigram indexes on customer search fields. |
| 59–60 | WIRED | Frames carry version; `EventTracker` drops older versions and duplicate ids. |
| 61 | WIRED | Per-room sequence; gap → `resync_required` → snapshot. |
| 62 | WIRED (`8922007`) | POS list + open profile refresh on customer events; the AI Receptionist looks callers up LIVE (no cache to go stale); the Reception Copilot's caller card now refreshes in place on customer events without touching what is being typed. |
| 63–67 | WIRED | PostgreSQL authoritative; Redis only cache/fan-out; events invalidate immediately. |

## §68–§80 Conflict rules and money/queue concurrency
| § | Status | Evidence |
|---|---|---|
| 68 | WIRED | Range overlap (`pbDetectTechnicianConflict`, half-open int4range). |
| 69 | WIRED | Duration change re-validated inside the transaction. |
| 70 | WIRED | Each technician segment validated independently (party bookings). |
| 71–72 | WIRED | Breaks / working hours enforced; override only with `booking.override`. |
| 73 | WIRED | Live holds exclude via gist (372); expired ones released every 20 s. |
| 74 | WIRED | Cancel → `appointment.canceled` → boards; cancelled rows leave the guard. |
| 75 | WIRED | Atomic reschedule (lock + re-check + one UPDATE); the DB refusal is now a 409, not a false success. |
| 76 | WIRED | `CHECKOUT_ALREADY_IN_PROGRESS`: 10 stations → 1 payment (deterministic race test). |
| 77 | WIRED | Queue compare-and-set: 10 receptionists → 1 assignment. |
| 78 | WIRED | Inventory claim-first ledger (reviewed, unchanged). |
| 79 | WIRED | Gift card: one guarded UPDATE (reviewed, unchanged). |
| 80 | WIRED | Loyalty: reward redemption conditional decrement (unchanged); POS adjustments serialized per customer (fixed `c6bc902`). |

## §81–§99 Polling classes, defaults, scheduler, fairness
| § | Status | Evidence |
|---|---|---|
| 81–83 | WIRED | Operational 15 s; detail 45 s; reports 120 s (`useReportCadence`); settings on event/focus; server 20 s. |
| 84–85 | WIRED | Overlap is harmless: single-flight + jitter on both sides. |
| 86–87 | WIRED | Reconciliation in the worker, never a request path. |
| 88 | WIRED | Compression ≥ 1 KB; SSE excluded (`c42c17f`). |
| 89 | WIRED | Change feed: 106-byte quiet tick vs 67.8 KB full board. |
| 90 | WIRED | ETag → 304 for services / categories / booking settings / business-branch (`fde7461`). |
| 91 | WIRED | `serverTime` (+ cursor) on the feed and on every concurrency 409. |
| 92–93 | WIRED | Small pill only; no global spinner. |
| 94–95 | WIRED | One sync manager (`useRealtime` / `useSafetySync` / `startVisibleSafetySync` on one `SafetySync`); no screen or widget owns a network timer (walk-through today). |
| 96 | WIRED | Adaptive: visible 15 s, hidden 60 s, focus immediate, events immediate. |
| 97–99 | WIRED (verify in staging) | Active scopes only, capped; single-flight; the outbox publisher round-robins tenants. Behaviour at 10,000 tenants is a staging measurement. |

## §100–§103 Observability
| § | Status | Evidence |
|---|---|---|
| 100 | WIRED | Client: `window.__apsSync.snapshot()` (duration p50/p95/max, errors, skipped; **payload bytes, records changed, quiet ticks, resyncs** — `8b51eef`); server: realtime latency/reconnects, `aipowersalon_concurrency_conflicts_total{module,code}` (coverage-guarded), reconciliation duration / lag / holds / active branches. |
| 101 | WIRED (verify in staging) | Sandbox numbers in the report; production values must be measured, not invented. |
| 102 | WIRED | A reconciliation run longer than 20 s is logged + flagged; realtime health thresholds exist. |
| 103 | WIRED | Advisory-lock single-flight (real-PG test). |

## §104–§119 Required tests
| § | Status | Evidence |
|---|---|---|
| 104 | WIRED | booking race 7/7 (create + reschedule, 10 writers, deterministic gate). |
| 105 | WIRED | customers real-PG (one write, one VERSION_CONFLICT) + service + screen tests. |
| 106 | WIRED | queue race 2/2. |
| 107 | WIRED | checkout race 2/2. |
| 108 | WIRED — **race-tested** (`eb14cb2`) | 10 terminals × $10 on a $50 card → exactly 5 succeed, $0, never negative. The test found the ledger recording the wrong balance-after ($30,$0,$0,$0,$0); fixed with RETURNING → $40,$30,$20,$10,$0. |
| 109 | WIRED | loyalty race 3/3. |
| 110–114 | WIRED | `sync-failure-modes.test` (4): realtime off → safety sync; polling off → events; sleep 10 min → immediate, no reload; 40 s responses → no pile-up. **§112 re-run and consolidated** (`redis-down.vitest.spec.ts`): cache read/write/invalidate fail open; both rate limiters fail open; a static guard proves booking / queue / customer / appointment / inventory / checkout write paths never touch Redis (only the AI upsell suggestion cache does); Constitution 9's backbone tests (local delivery, resync after a Redis restart) re-run — 36/36. Mutations: Redis planted in booking, and a limiter failing closed, both caught. |
| 115–119 | WIRED | `POSBookingScreen.sync-preservation.test` (5) + customers screen tests. |

## §120–§123
| § | Status | Evidence |
|---|---|---|
| 120–121 | WIRED | The final architecture and every permanent rule hold on this tree (rows above). |
| 122 | WIRED except the two DEFERRED rows | Build, typecheck, lint and tests pass (below). |
| 123 | WIRED | `SMOOTH_REFRESH_REPORT.md` (§7 risks, §8 follow-ups). |

## Verification on this tree (`cd96331`)
| Check | Result |
|---|---|
| API build + Nest graph boot | OK |
| API (6 shards) | 1,595 pass, 19 skipped by design (14 + 2 + the 3 opt-in real-PG) |
| pos-web | 775 pass |
| booking module | 447 pass |
| Real-PG (fresh 483-migration PG16): booking 7, customers 3, checkout 2, queue 2, reconciliation 3 | all pass |
| Gates | 25 + 3 audits pass |

## Found by the real-browser run (after this check was first written)
**The sync layer crashed every POS screen in Chromium** (`TypeError: Illegal invocation`): `SafetySync` and
`RefetchCoalescer` called the browser's `setTimeout` as a method of another object. Node/jsdom do not enforce that rule,
so every unit test passed. Fixed in `6a1263e`; strict-timer regression tests + the browser check (`npm run perf:booking`)
now fail on the old pattern. Lesson recorded: jsdom tests cannot stand in for one real-browser run.

## Real-browser checks (repeatable, both fail loudly on regression)
| Check | What it runs | Result on this tree |
|---|---|---|
| `npm run perf:booking -w apps/pos-web` | the real Booking board, production React, 12 technicians / 60 appointments, 40 refreshes | 1 column repainted per refresh (40/40); render p50 ~6 ms; no page errors |
| `npm run perf:realtime -w apps/pos-web` | the POS live-update client + `useRealtime` against a REAL SSE endpoint | 13/13: event → one refetch; delivery 0–2 ms (local); duplicate ignored (§59); older version ignored (§60); gap → resync (§61); `resync_required` → snapshot (§26/§27); dropped stream → reconnect 0.76 s after the drop, within §43's first step, then an immediate refetch (§42); status RECONNECTING → CONNECTED; live again; no page errors |
Both reproduce the Illegal-invocation crash when the old timer pattern is put back (mutation-checked).

## What still needs your environment
Step-by-step with pass/fail lines: **`SMOOTH_REFRESH_STAGING_RUNBOOK.md`**.

1. **Staging:** confirm the live POS no longer dims every 15 s (a screen recording if it does) — and that it renders at
   all on the real devices (the crash above shows why one real run matters).
2. **Staging measurements** for §3, §57, §97–§99, §101 (the sandbox CPU numbers are not production numbers).
