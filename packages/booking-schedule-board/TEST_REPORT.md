# Test Report — Booking Schedule Board

## After the merge into the POS (Nov 13 2026, branch `extras-agent1`, Node 22, Vitest 2.1, jsdom, PGlite)

Every line below ran in the merge session. Nothing here was run on a real browser, a real Postgres server or the SUNMI
hardware — those rows say NOT_TESTED.

| Lane | Command | Result |
|---|---|---|
| Package typecheck (strict) | `cd packages/booking-schedule-board && npx tsc --noEmit -p .` | 0 errors |
| Package no-print gate | `node scripts/check-no-print.mjs src` | OK |
| Package suite | `npx vitest run` | **63 / 63** — domain 18, adapter 14, board 15 (the standalone 47; the production-adapter contract test was rewritten for the real routes), wire 8, merge 8 |
| Real-API wire + acceptance | `cd modules/booking && TZ=UTC npx vitest run src/booking/booking-board-wire.pgtest.vitest.spec.ts` | **10 / 10** |
| Booking module neighbours | 14 more booking spec files (skills authority, 200 technicians, holds, drafts, first-available, appointment machine, start-service, conflict-atomic, changes feed, permissions, realtime, coded refusals, authority boot) | 78 / 78 |
| Booking module typecheck | `npx tsc --noEmit -p .` | 0 errors |
| POS Booking screen files | `POSBookingScreen.{test,board,ai-scheduling,arrived-late,openings,pager,sync-preservation,vi,week-paging}`, `booking/boardMode.test`, `realtime/bookingRelevance.test`, `POSNewBookingScreen.test` | **120 / 120** (the classic-calendar files run with `runOnClassicBookingBoard()`) |
| POS typecheck | `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p apps/pos-web` | 0 errors |
| Host gates run here | `check:no-print`, `check:dialogs`, `check:money`, `check:silent-catch`, `check:dead-client`, `check:error-text`, `check:as-any`, architecture tests, `check-i18n`, `check-pos-i18n`, `check-vi-glossary`, ns collisions, POS module registry (+3 ids accepted), preservation matrix, frontend builds, app types, lockfile hygiene, inert controls, zoom | all pass |

### What the real-API run proves (`booking-board-wire.pgtest`)

- The wire shapes the adapter maps (technicians page, locate page, day grid, availability, openings, created / rescheduled
  rows, blocked time, 409 conflict / 409 VERSION_CONFLICT / 400 TECHNICIAN_NOT_SKILLED_FOR_SERVICES bodies) equal the
  committed fixtures key-for-key; a drift fails (seen once during the run, before regeneration).
- Spec §39 #1 45→45 fits and the opening disappears · #2 60→45 refused, nothing written · #3 two concurrent creates → one
  success + ConflictError (PGlite serialises: the true parallel proof stays the `postgres-race` suite) · #4 move to an
  unqualified technician refused · #5 runs into the next appointment refused · #6 unqualified technician: no slots, not
  in openings, create refused with the code · #7 blocked hour removes the opening · #10 a move frees the source and
  fills the destination · stale `expectedVersion` → VERSION_CONFLICT · another salon sees nothing and cannot move a row.

### Defects found and fixed on the way

1. `KyselyBookingRepository` never selected `version`: every appointment read answered `version: 1`, so any row edited
   once could never be moved with its `expectedVersion` (classic board and new board alike). `version` is now selected.
2. The exact-skill authority's refusal lost its registry code (a 400 with only English); it now carries
   `TECHNICIAN_NOT_SKILLED_FOR_SERVICES`, which the board maps to `TECHNICIAN_SERVICE_INELIGIBLE`.

### Addendum / spec items

| Item | Status | Evidence |
|---|---|---|
| P-01 / P-02 top bar + sidebar unchanged | PASS (diff) | no file under `apps/pos-web/src/shell/` or `App.tsx` changed |
| P-04 / P-05 / B-20 no schedule print | PASS | package `merge.test` "no schedule printing", POS board test, both no-print gates |
| P-06 Block time visible + operational | PASS | POS board test; package board.test #7 |
| P-09 identity accent on header / rail / detail panel | PASS (pager row not coloured) | package `merge.test` identity tests; POS board test |
| P-10 status palette + icon/text | PASS | `board.css` §04 palette; every status has a glyph + `status.*` text |
| P-11 no screenshot sample data | PASS | neutral fixture names only; nothing seeded |
| P-12 / §8 1920×1080, no page scroll | NOT_TESTED | no browser run in this session (`.pos-booking-board` keeps the board scrolling inside itself) |
| P-13 SUNMI hardware | BLOCKED_EXTERNAL | needs the device |
| P-14 EN / VN | PASS | POS board test (Vietnamese, no English left in the board); `bsb` namespace parity test |
| B-01 / B-02 paging (1–12, 193–200, 8 real columns) | PASS (board side) | POS board test (200 technicians, #200 → page 17, 8 columns); server paging proof is agent 2's |
| B-04 jump to #200 | PASS | POS board test |
| B-07 tap opens Quick Booking prefilled | PASS | POS board test (the existing Booking Assistant) |
| B-09 conflict feedback, no double booking | PASS | pgtest #2/#3; package board.test #3 |
| B-11 walk-in Fair Turn | NOT_TESTED here | the page's Add Walk-In still opens the existing walk-in workflow |
| B-12 drag validates + rollback | PASS | package board.test #4/#10; pgtest #4 |
| B-14 change for #150 does not reload #1–12 | PASS | POS board test |
| B-15 load / latency | NOT_TESTED | agent 2 records measured latency |
| B-17 detail drawers restore state | PASS (state restore) | POS board test "board state survives…" |
| B-18 cross-tenant refusal | PASS | pgtest tenant isolation |
| B-19 Fiserv / Clover / Tap to Pay untouched | PASS (diff) | no payment file changed |

## Standalone run (Oct 27 2026, before the merge — kept for history)

The package's own report: typecheck, no-print gate, 47 / 47 unit/UI tests, `vite build`, 13 / 13 Playwright checks and a
sabotage run proving the double-booking test fails without serialisation. The demo host, Vite build and Playwright
script were not carried into the monorepo, so those browser checks were NOT re-run after the merge.
