# FULL_PILOT_VALIDATION_REPORT.md — golden day, 200 technicians, two salons, multi-app, financial edges (FullSystemTest.pdf Appendix B)

| | |
|---|---|
| Date | 2026-10-28 |
| Commit under test | `07e599ea` (`merge-github-main`) |
| **Pilot status on this commit** | **NOT_TESTED — BLOCKED_DEPENDENCY.** The pilot (`apps/api/scripts/live-pilot-day.mjs`) drives the compiled API over HTTP and Chromium for the screens. This environment has no npm registry, so no NestJS / `pg` / Kysely / vite / React: the API cannot be built or booted, and no app can be bundled. Nothing below was re-run today. |
| Last full run | **Oct 27 2026, 235 / 235 PASS, 0 FAIL**, all 15 phases, fresh database through migration 702, screens on — `docs/pilot-runs/2026-10-27-final/pilot.txt` (+ `pilot.json`, 36 screenshots in `shots/`), commit `22a98978` (evidence `fe1080e6`) |
| Commits since then | 103 (1,042 files), incl. migrations 703–706, Tap to Pay per-location MID + POS refunds, paycheck changes, POS-only Vietnamese, the AI receptionist English-only, strict bodies on 1,245 routes, 1,703 `as any` removals |

This file does not repeat `PILOT_VALIDATION_REPORT.md` (the per-phase write-up of the earlier runs); it states what is proven,
on which commit, and what the next run must show.

## 1. Appendix B scenarios — where each stands

| Scenario | Last executed result (commit) | What changed since that can affect it | Status on `07e599ea` |
|---|---|---|---|
| **B1 golden salon day** (login → clock-in → booking online / POS / AI → check-in → Visit + Customer Queue → skill + Fair Turn → assignment + Tech App → start, add-on, multi-tech → Service Done → Checkout Queue → cash / card / split / gift / loyalty / Tap to Pay → receipt → Customer Display 3 s clear → reports / earnings / payroll) | PASS — phases 0–8 (`22a98978`); display clear 3,006 ms (phase 4) | Tap to Pay merchant per location (704); paycheck items (`78a07f6b`); customer messages English (`9f250679`) | NOT_TESTED |
| **B2 payment safety race** (lost reply → UNKNOWN, conflicting tenders blocked, settle once) | PASS — phase 14 split card / wallet / Skip-the-Line / refund timeout 4 / 4; race lane 336 | POS Tap to Pay refunds (`33034f61`); refund sweep never auto-releases (`d8f2967e`) | DB part PASS today (`db-races.log`); unit PASS (`PAYMENT_RECONCILIATION_REPORT.md`); e2e NOT_TESTED |
| **B3 booking / assignment concurrency** (20 simultaneous bookings, one winner) | PASS — phase 10 / 11: 20 desks, one technician + minute → 1 booked, 19 × 409 | eligibility authority required at boot (`ba73e2ef`) | DB part PASS today: 20 concurrent same-slot bookings → 1, 20 holds → 1, overlap refused, adjacent slot accepted; API NOT_TESTED |
| **B4 200 technicians + app login** (12 per page, last page 193–200, #193 on a phone, realtime, p95) | PASS — phase 11 + M5 (177 / 177 on Oct 24; inside 235 / 235 on Oct 27): page 17 = #193–#200, #193 live on her phone 1.4 s, page change p95 17 ms API / 289 ms browser, heap 11.3 → 11.5 MB over 48 page changes | Tech App English-only bootstrap (`05ac57cd`), manager PIN per location (`039e3725`) | NOT_TESTED |
| **B5 customer display privacy** (complete → ~3,000 ms → idle, next customer sees nothing) | PASS — 3,006 ms, session released by the display, no customer frame after | display English-only (`05ac57cd`) | NOT_TESTED |
| **B6 payroll check / cash** ($2,000 → $1,000 check + $1,000 cash → owner approve → issuance confirmation → no duplicate payout) | PASS — phase 10e / 10e2 (incl. the technician's cash confirmation, wrong handoff code → 401) | payout-completed push, voided payout reopens a paid week, itemised bonuses (`78a07f6b`) | DB part PASS today: payroll lines locked in review / finalized / paid; payout idempotency unique (+ check number); e2e NOT_TESTED |
| **B7 recovery exercise** | not part of the pilot | — | local drill PASS today (dump / restore identical; PITR to a timestamp) — `backup-drill.log`; per-tenant restore, production backup, Super-Admin-unavailable path BLOCKED_EXTERNAL |
| Two tenants / cross-tenant probes | PASS — phase 11 §66 technician cross-tenant probe; salon B owner | — | DB RLS probes PASS today (as an ordinary role); API NOT_TESTED |
| Vietnamese POS on the 27-inch layout, 200 technicians | PASS — phase 13 (one-screen 54 / 54 primary); busy-state responsive report 55 / 90 (I-18, open) | **POS-only Vietnamese** (`05ac57cd`): the receipt in the customer's language step is now **English by rule** — the pilot's expectation was changed to English and has not run | NOT_TESTED |
| English-only customer / tech / owner / Tap to Pay apps | n/a before Oct 28 | bootstrap policy + gate `check:english-only-apps` | gate PASS today (static); screens NOT_TESTED |

Screenshot paths from the last run (mandate §94): empty / normal / busy POS pages `docs/pilot-runs/2026-10-27-final/shots/pilot-01…09`;
200-tech `pilot-10`, `pilot-21…23`; #193 / #100 on the Tech App `pilot-11…20`; Checkout UNKNOWN `pilot-30-vi-checkout-unknown-200.jpg`;
Vietnamese POS `pilot-24…31`; customer display totals → cleared `pilot-04`, `pilot-05`; Super Admin English `pilot-33…35`.
No new screenshots were taken today (no browser bundle).

## 2. How to run it on this commit (developer, V-28)

```bash
npm ci && npm run build:packages && npm run build:modules && npm run build:api
createdb px_pilot && MIGRATE_DATABASE_URL=postgres://…/px_pilot node apps/api/scripts/migrate.mjs     # → 706
cd apps/api && DATABASE_URL=postgres://…/px_pilot PORT_PROOF=3201 PILOT_SHOTS=../../docs/pilot-runs/<date>/shots \
  PILOT_OUT=../../docs/pilot-runs/<date>/pilot.json node scripts/live-pilot-day.mjs | tee ../../docs/pilot-runs/<date>/pilot.txt
```

Pass condition: every line PASS (the Oct 27 count was 235; new checks since then add lines), no FAIL, the two known
BLOCKED_EXTERNAL INFO lines (CommerceHub inquiry S8) unchanged; then the physical parts (iPhones, terminals, the 27-inch
touchscreen on site) — `EXTERNAL_SETUP_CHECKLIST.md` X-9, X-19.
