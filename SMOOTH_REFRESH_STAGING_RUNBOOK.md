# SMOOTH REFRESH — STAGING VERIFICATION RUNBOOK

Everything that could be built or proven in the sandbox is done (see `SMOOTH_REFRESH_WIRING_CHECK.md`). This runbook is
the part only real infrastructure can answer. Each step has a pass/fail line. Estimated time: about 1 hour.

## 0. Before you deploy

| # | Do this | Why |
|---|---|---|
| 0.1 | **Large database only:** run these first, outside a transaction (psql), then deploy:<br>`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pos_tech_appointments_updated_at ON pos_tech_appointments (updated_at);`<br>`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pos_queue_items_updated_at ON pos_queue_items (updated_at);`<br>`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_holds_live_expires ON booking_holds (expires_at) WHERE released_at IS NULL AND converted_appointment_id IS NULL;` | Migration 484 builds them plainly, which blocks new bookings while it builds on a big table. Pre-building makes 484 a no-op. |
| 0.2 | Run `npm run perf:booking -w apps/pos-web` and `npm run perf:realtime -w apps/pos-web` on the release commit. **Pass:** both print `… browser check: OK`. | These are the checks that caught the real-browser crash (`6a1263e`). Never release without them. |
| 0.3 | Process roles. **Single process** (`PROCESS_ROLE` unset or `all`): nothing to do. **Split API/worker:** the worker must run the `reconciliation` class — leave `WORKER_JOB_CLASSES` unset (= all classes) or include `reconciliation`. | Proven on the built worker: with `critical` only, expired holds stay live; with `critical,reconciliation` they are released ~20 s after start. |
| 0.4 | `BOOKING_HOLD_SWEEP_CRON_ENABLED` can stay unset. | The 20 s reconciliation now releases expired holds by default. Turning the old minute sweeper on as well is harmless (both are idempotent). |

## 1. The screen no longer dims (the reason this spec exists)
1. Open POS → Booking on a real POS device (the ASUS/Dell touchscreen), logged in, on today's date.
2. Watch it for 2 minutes without touching it.
**Pass:** no shading, no spinner, no flash, nothing moves every 15 s. **Fail:** send a screen recording — the cause is
then visible in minutes.
3. In the browser console type `__apsSync.snapshot()`.
**Pass:** `ticks` rising about 4 per minute, `errors: 0`, `durationMs.p95` well under 15000, `payload.emptyTicks`
close to `payload.samples` (quiet board = tiny ticks).

## 2. Live updates between two stations (§3, §17)
Two POS devices, same branch, both on Booking.
| Do on POS A | **Pass** on POS B |
|---|---|
| Create a booking | appears within ~1 s, no reload |
| Drag it to another time | moves within ~1 s |
| Check the guest in | Check-In and Queue update within ~1 s (`cd96331`) |
| Cancel it | slot frees within ~1 s |
| Edit a customer's name in Customers | POS B's Customers list / open profile / Reception Copilot card update |

## 3. Double booking cannot happen (§7, §12)
1. POS A and POS B both open New Booking for the **same technician, same time**.
2. Press Save on both as close together as possible.
**Pass:** one booking; the other shows "This time was just booked or changed on another device. The schedule has been
refreshed." and its schedule refreshes. Settings → Booking & Appointments → double-booking policy = **Block** (default).
3. Drag the same appointment on both stations at once. **Pass:** one move wins; the other gets the conflict message.

## 4. Failure recovery (§110–§113)
| Do | **Pass** |
|---|---|
| Turn POS B's Wi-Fi off for 30 s, make a change on POS A, turn Wi-Fi back on | POS B shows a small "Offline" pill, keeps its data, then catches up **immediately** on reconnect (not after 15 s) |
| Restart the API / realtime service | POS pill shows "reconnecting", then live again; any change made meanwhile appears after reconnect |
| Restart Redis | bookings and payments keep working; live updates recover; nothing shows an error page |
| Close the POS laptop lid 10 min, open it | board is current within a second or two, no page reload |

## 5. Numbers §123 asks for (collect, do not guess)
| Metric | Where |
|---|---|
| Realtime latency (write → other screen) | `aipowersalon_realtime_*` metrics, or step 2 with a stopwatch |
| Background-sync duration p50/p95, payload bytes, records changed | `__apsSync.snapshot()` on a busy afternoon |
| Booking / version / checkout conflict rate | `aipowersalon_concurrency_conflicts_total{module,code}` |
| Reconciliation duration, outbox lag, active branches, holds released | `aipowersalon_sync_reconciliation_*` |
| Query plans on production data | `EXPLAIN (ANALYZE, BUFFERS)` of the change feed and the active-scopes query (both should be index scans) |

Sandbox reference values (not production): full board reload 67.8 KB / 3 requests (~58 ms), quiet tick 106 bytes,
render p50 ~6 ms, local realtime delivery 0–2 ms, reconnect 0.76 s after a drop, reconciliation active-scopes 0.32 ms at
576k appointments.

## 6. If anything fails
Note the step number, what you saw, and (for anything visual) a screen recording. Everything above maps to a named
test and commit in `SMOOTH_REFRESH_WIRING_CHECK.md`, so a failure narrows to one file quickly.
