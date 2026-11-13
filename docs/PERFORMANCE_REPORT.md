# PERFORMANCE_REPORT.md — Booking at 200 technicians (round 12, booking200 addendum §13 / §18; 44-page guide §24, §82–§86, §92–§94, §103)

Earlier large-salon measurements (Check-In, Overview, Customer Queue, Oct 28 2026) are in the repository-root
`PERFORMANCE_REPORT.md`. This file holds the round-12 Booking numbers. Every number below was **measured** by an executed
test in this session; nothing is a target restated as a result.

## How it was measured

- Test: `modules/workforce/src/eligibility/booking-200-scale.pgtest.vitest.spec.ts`
  (`cd modules/workforce && TZ=UTC npx vitest run src/eligibility/booking-200-scale.pgtest.vitest.spec.ts`). It prints one
  `MEASURE {...}` line; the table copies it.
- Engine: **PGlite** — PostgreSQL 16 compiled to WASM, running in-process on the test machine, with every migration
  applied. It is not production hardware or a networked PostgreSQL, and no HTTP/Nest layer is in the path: the numbers are
  the booking engine's server work (repository + service + the real exact-service eligibility authority), not end-to-end
  API latency. Production latency was **NOT TESTED**.
- Each read was run 7 times back to back; p50 / p95 of those 7. Bytes = `JSON.stringify` of the answer (uncompressed).
- Dataset (isolated test tenant, never production): 200 active technicians "Tech 001"–"Tech 200" + 1 inactive; mixed
  exact skills (Gel Manicure 150, Spa Pedicure 100, Acrylic Full Set 50, Nail Art 20); 164 working on the test Monday
  (25 off by weekly schedule, 11 by a full-day block); **1,019 appointments** on that day (6 per working technician + a
  17:30 for every 5th, statuses completed / in service / confirmed / booked), lunch 12:00–12:30. Branch clock pinned to
  10:00.

## Results (run of Nov 13 2026, this session)

| Read (server) | p50 ms | p95 ms | Payload |
|---|---:|---:|---:|
| Technician page 1 (`GET /pos/booking/technicians?page=1`) | 18.3 | 23.2 | 2,588 B |
| Technician page 17 (#193–200) | 18.3 | 24.8 | 1,791 B |
| Working-only filter (164 → 14 pages) | 18.0 | 23.0 | — |
| Exact-skill filter (Acrylic → 50, one batch eligibility read) | 31.7 | 35.5 | — |
| Search "#200" | 20.7 | 23.6 | — |
| Locate #200 from page 1 (→ page 17) | 18.4 | 22.5 | — |
| Day grid for page 17's 8 technicians (`GET /day-grid?technicianIds=…`) | 36.9 | 43.0 | 35,863 B |
| Find an Opening / Best Matches, 45-min Gel Manicure, top 10 (`GET /openings`) | 37.1 | 40.4 | 2,231 B |
| Booking KPI cards (`GET /pos/booking/kpi-cards`, six cards) | 77.1 | 80.7 | 552 B |

Find an Opening answer on that busy day: 150 eligible (active + exact-skilled), 115 of them working that day, 90 with an opening, earliest 17:00
(everyone eligible is booked solid until 16:45 + 5-min buffer; the 25 with a 17:30 booking have no 45-minute opening
left; the 35 not working have none). An earlier run in the same session gave p50 values within ±4 ms of these for every read except the KPI cards (67.6 ms then, 77.1 ms here).

`EXPLAIN (ANALYZE)` of the visible-technicians appointment read (tenant, branch, date, 8 technician ids, 1,019 rows that
day): execution 0.495 ms, planning 0.302 ms, top node Sort (PGlite).

Largest Booking payload observed: the day grid for one 8–12-technician page, ~36 KB. The technician page never carries more
than one page of technicians (12 by default, hard maximum 48) and no payroll / pay plan / tax / contact field (pinned by
`booking-200-technicians.vitest.spec.ts`).

## Correctness proven in the same file (executed, PASS)

| Check | Result |
|---|---|
| total 200, pageSize 12, totalPages 17; page 1 = #1–12, page 8 = #85–96, page 16 = #181–192, page 17 = #193–200 (8 columns) | PASS |
| all 17 pages hold the 200 technicians exactly once; status=all → 201, page 17 = 9 | PASS |
| working-only 164 → 14 pages, out-of-range page repaired to 14 | PASS |
| totals 0, 1, 11, 12, 13, 24, 25, 199, 200, 201 (each its own salon): pages and last-page size | PASS |
| search "#200" / "200" / "tech 200"; locate #200 → page 17 (index 199); in working-only → page 14; excluded → `located: null` | PASS |
| exact skill through the ONE eligibility authority (Acrylic = exactly the 50 specialists) | PASS |
| day grid for page 17 = only those 8 technicians' appointments | PASS |
| Find an Opening: only exact-skilled, working technicians; ranked; top 10 + View More with no repeats; identical state → identical answer | PASS |
| live-hold read returns 201 of 201 holds (was capped at 200 — fixed) | PASS (fails with the old `LIMIT 200`) |

## Hidden-limit audit (booking / technician / queue routes) — §8 "No hidden caps", §51

| Place | Finding | Action |
|---|---|---|
| `modules/booking/src/customer-booking/booking-hold.kysely.ts` `liveHolds()` | `LIMIT 200` on the read that decides which slots are held — in a large salon hold #201+ silently stopped blocking its slot (fail-open), and the staff availability (`heldMinutes`) used it | **Fixed**: no cap, ordered; the window bounds the set. Pinned by the 201-hold test. |
| `apps/pos-web/src/screens/POSBookingScreen.tsx` Waitlist KPI | count = length of a `pageSize: 6` queue page → never above 6 | **Fixed**: the card now reads the server count (`waitlist`, `GET /kpi-cards`); pinned with 11 waiting guests. The Waitlist panel still shows 6 rows + "View full waitlist" (a preview, labelled). |
| `GET /pos/booking/technicians` | page size bounded 1–48, full metadata (total / totalAll / workingCount / page / pageSize / totalPages) | intentional pagination, not truncation |
| `GET /pos/booking/openings` | `limit` 1–50 + `offset` + `hasMore` | intentional (top N + View More) |
| `GET /pos/booking/state` / `appointments` list | `clampPageSize(…, 50)` with `pagination.totalItems` / `totalPages` | intentional, paged |
| `GET /pos/booking/day-grid` | `unbounded` for its columns (pinned: 60 appointments on 12 technicians all returned) | none |
| `GET /pos/booking/changes` | `pageRows + 1` sweep with continuation cursor / RESYNC_REQUIRED | intentional, paged |
| `modules/queue/src/service-done/service-done.kysely.repository.ts` `BOARD_LIMIT = 300` | Service Done board shows the newest 300 unpaid completions; older ones stay reachable by search / filter (documented in code) | not a booking/technician route; left as is — noted for the queue owner (a 200-technician day can exceed 300 completions) |
| `modules/queue/src/live-technician-schedule/…` `appointmentNotes()` `.limit(50)` | notes of ONE technician's ONE day | not a scale cap |
| technician reads in booking / queue / tech queue | no LIMIT | none |

## Not measured here (honest list)

Browser render / memory over 17 pages, realtime fan-out (50+ clients), Technician App login for #1/#25/#100/#193/#200,
200-technician payroll / 400 payout instructions, real SUNMI hardware, networked PostgreSQL / built API latency —
**NOT TESTED** in this round by this agent.
