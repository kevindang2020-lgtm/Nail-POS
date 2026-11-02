# Pilot Day Report — one salon, one full day, end to end

## Oct 27 2026 — final pass: the whole pilot day, every phase (0 – 14)

**235 of 235 checks pass** — phases 0–14 with **no `PILOT_SKIP`**, screens on (Chromium, 36 screenshots), ~950 s wall —
on a freshly created database (`fr_pilot2`) migrated through **702** (642 migrations). Code under test: `94ba69e9` (branch
`merge-github-main`; the same product code as `b01f8d71` / HEAD — the later commits are docs, evidence and one gate
allowlist line). Evidence: `docs/pilot-runs/2026-10-27-final/` (`pilot.txt`, `pilot.json`, `shots/` as 1280-px JPEGs; invitation /
handoff tokens redacted). Then `scripts/drills/drill-restore.mjs` on the pilot database: **12 / 12**.

Invocation (from `apps/api`, after `npm run -s build:packages && npm run -s build:modules && npm run -s build:api` and the
frontend builds of `final-run.sh`):

    DATABASE_URL=postgres://…/fr_pilot2 PORT_PROOF=3201 PILOT_SHOTS=… PILOT_OUT=…/pilot.json PILOT_TIMEOUT_MIN=120 \
      CHROMIUM_PATH=/opt/pw-browsers/chromium TZ=UTC node scripts/live-pilot-day.mjs

| Phase | Checks | Phase | Checks |
|---|---|---|---|
| 0 boot | 1 / 1 | 8 screens at close | 2 / 2 |
| 1 onboarding | 14 / 14 | 10 handoff mandate (incl. 10d receipt / finance close-outs, 10e paycheck, 10e2 paycheck close-out) | 28 / 28 |
| 2 setup | 16 / 16 | 11 large salon (200 technicians + M5 + blocks) | 78 / 78 |
| 3 day opens | 11 / 11 | 12 secure tap to pay (S0–S14) | 36 / 36 |
| 4 service + checkout | 9 / 9 | 13 Vietnamese POS | 14 / 14 |
| 5 tap to pay | 3 / 3 | 14 recovery flows (§68) | 4 / 4 |
| 6 refund + inventory + loyalty | 3 / 3 | 9 api log + postgres log | 2 / 2 |
| 7 end of day | 14 / 14 | **total** | **235 / 235** |

First pass on the same code (database `fr_pilot`, `final-run.sh` lane): **230 / 235**, five harness failures, no product
defect — fixed in `94ba69e9` and the whole day re-run on a new database:
- phase 14 (four recovery flows) got 401 "No session": phase 13 signs the receptionist out and back in (language persistence)
  and handed her new session back on its env object, but the day kept the old binding;
- 10e2 CANCELED PERIOD required at least one voided statement, but the cancel week lies ahead and has no earnings; the check now
  reports the count (0) and requires every statement to be voided — the voiding itself is now asserted in
  `payroll-paycheck-closeout.pgtest` (it was asserted nowhere before).
Earlier in the final pass, `b2783117` fixed the two 10e2 failures I-17 recorded (a wrong QR handoff code → 401
`HANDOFF_TOKEN_INVALID`, product; the outbox query's `payload_json`, harness).

Numbers from this run (`pilot.json` → `numbers`): clock-in burst (100 technicians by PIN at once) p95 **1,529 ms**; realtime burst
after 3,500 bookings — 0 undelivered, `appointment.created` frame lag p50 0.49 s / **p95 0.95 s** / max 1.05 s; technician page
change p50 24 / p95 27 ms, 12-column grid 30 ms on a 1,000-appointment day; paycheck week $480.00 payable = $240.00 cash paid
(QR / signature / dual confirmations) + $240.00 checks issued; the preparation report reconciles; four recovery flows each settle
exactly once.

## Oct 26 2026 — M7 full regression: the whole pilot day, every phase

**190 of 190 checks pass** — phases 0–12 with **no `PILOT_SKIP`**, screens on, **524 s** wall — on a freshly created
database migrated through **692** (632 migrations). Code under test: `1c03e996` (branch `merge-github-main`; product code =
`634ba8e1` + the admin-web fix `092ceac3`; the only other changes are the two pilot-harness fixes below and docs).
Evidence: `docs/pilot-runs/2026-10-26-final/` (`pilot.log`, `pilot.json`, `shots/` — 20 screenshots; the three invitation
link tokens are redacted). This is the first run with phase 11 (200 technicians incl. the M5 part and the new §48 / §76
blocked-time dataset) and phase 12 (Secure Tap S0–S14) in the same day.

Invocation (from `apps/api`, after `npm run -s build:packages && npm run -s build:modules && npm run -s build:api` and a
`vite build` of pos-web / tech-web / owner-web / customer-display at the same HEAD):

    DATABASE_URL=postgres://…/pilot_final PORT_PROOF=3201 PILOT_SHOTS=<repo>/docs/pilot-runs/2026-10-26-final/shots \
      PILOT_OUT=<repo>/docs/pilot-runs/2026-10-26-final/pilot.json TZ=UTC node scripts/live-pilot-day.mjs

| Phase | Checks | Phase | Checks |
|---|---|---|---|
| 0 boot | 1 / 1 | 7 end of day | 14 / 14 |
| 1 onboarding | 14 / 14 | 8 screens at close | 2 / 2 |
| 2 setup | 16 / 16 | 10 handoff mandate | 22 / 22 |
| 3 day opens | 11 / 11 | 11 large salon (200 technicians + M5 + blocks) | 57 / 57 |
| 4 service + checkout | 9 / 9 | 12 secure tap to pay (S0–S14) | 36 / 36 |
| 5 tap to pay | 3 / 3 | 9 api log + postgres log | 2 / 2 |
| 6 refund + inventory + loyalty | 3 / 3 | **total** | **190 / 190** |

Numbers from this run (`pilot.json` → `numbers`):
- **200-Technician Pilot Matrix** (mandate p.15): all 15 rows PASS, plus pagination edges 0…201, deactivation #50,
  transfer, break #120, schedule change #150, off-screen mobile #193. **Login matrix** #1 / #25 / #100 / #193 / #200 PASS.
- **Blocked-time dataset (§48 / §76), first live run:** 199 technicians × 7 days — 1,373 lunches, 1,373 breaks, 20 time-off
  days, 2,766 / 2,766 written through `POST /pos/booking/blocked-times` (paced ≤ 30 / s, 0 × 429) and exactly those in the
  database; #150 has 24 open 60-minute starts, none overlapping lunch / break; a booking into her lunch → 400, nothing
  written; #1's day off → 0 starts; the 12-column grid draws the blocks; whole-salon availability over the 7 blocked days
  p50 33 / p95 52 ms; Find an Opening still answers 5.
- Board page change p50 18 / p95 32 ms; 12-column grid 40 ms; board state 53 ms.
- **Clock-in burst** (100 technicians by PIN at once): p95 **1,329 ms** (was 3,557 ms before the M4-1 hash-cost decision,
  `146a3f55`); 100 shifts, 100 rotation joins, 0 duplicates, 20 replays write nothing.
- **Realtime burst (§90):** after the 3,500-booking burst the outbox held 0 undelivered events; `appointment.created`
  publish lag p50 0.8 s / **p95 12.6 s** / max 14.1 s over 4,616 events — still above the < 2 s target (WATCH, NEXT_STEPS
  M5-1/M5-2; 2-core host). Fan-out: one booking → 55 streams exactly once, p50 936 ms.
- 200-technician payroll: 200 statements in 143 ms; **400 payout instructions → 400 payouts** (200 check + 200 cash),
  Σ = week payable. Browser memory over 48 page changes: heap 10.8 → 10.9 MB, DOM 6,075 → 6,075.
- Customer Display 3-second privacy clear: 3,006 ms, no frame afterwards shows the guest.
- Rate limiter: 0 × 429 to the M5 load generator and to the blocks phase.

**Attempts before the green run (all on the same code, each on a fresh database):**
1. **160 / 190.** Phase 11's new blocked-time step (`d388ca5f`, never run live before) wrote ~2,800 blocks from ONE
   front-desk session in 15 s; that session's limiter budget is 2,000 / minute (M4), so 881 writes were refused 429 and
   phase 12 then started on the exhausted session (S0 could not queue its tickets → S3–S14 cascaded; 73 Postgres errors
   were the harness sending `null` ticket ids). The limiter behaved as specified — **harness bug**, fixed in `4572c401`
   (the blocks phase uses the M5 pacer, honours Retry-After, lets one limiter window pass before phase 12).
2. Killed by a container restart in phase 11 (no result).
3. **188 / 190.** S14 opened a branch named "Pilot Annex <tag>" — the M5 transfer step had already opened one with that name
   in the same salon (the Oct 26 Secure Tap run skipped phase 11, so the collision never showed); the API refused the
   duplicate (400, correct). **Harness bug**, fixed in `1c03e996` (S14's branches are "Tap to Pay Annex" / "Tap to Pay
   Closed Annex").
4. **190 / 190** — this run.

No product bug was found by the pilot. After it, `scripts/drills/drill-restore.mjs` against the pilot database: **12 / 12**
(dump 0.8 s, restore 4.6 s, 7.9 MB, 772 tables).

Still external (unchanged): one CommerceHub merchant from the environment for every location (S14 note); CommerceHub
transaction inquiry (S8 reconcile answers `no_inquiry`); physical iPhones; real CardPointe / Twilio / SendGrid / S3 /
ClamAV / Textract.

## Oct 26 2026 — Secure Tap to Pay internal gaps (phase 12, S10–S14)

**133 of 133 checks pass** (`PILOT_SKIP=11`, screens on, 187 s wall) on a freshly migrated database (through migration 692),
phase 12 **36 / 36**. Code: an isolated worktree of `2881125c` (the branch head when the run started, incl. the Secure Tap
commits `0c18a930`, `f8e3c0d3`, `33807ecf`, `b52e05d4`) + the pilot-script changes committed with this report — so no other
agent's uncommitted work was in the API under test. Evidence: `docs/pilot-runs/2026-10-26-secure-tap/` (`pilot.log`,
`pilot.json` → `numbers.secureTtp`, `shots/`; the scratch display credential redacted).

| Step | What was proven over HTTP (real API + PostgreSQL, three signing phones) | Result |
|---|---|---|
| S10 §64 phone → POS | the phone's attempt on a ticket is UNKNOWN (S8) → POS cash and POS card refused 409 PAYMENT_STATUS_UNKNOWN; 0 gateway calls; no payment row | PASS |
| S10 §64 POS → phone | a POS card answers UNKNOWN (processing) → the phone's Proceed says PAYMENT_STATUS_UNKNOWN, intent + phone cash 409 PAYMENT_STATUS_UNKNOWN (3 audited refusals), 0 Tap to Pay intents, 0 CommerceHub charges; Verify settles the POS card → paid with ONE payment | PASS |
| S11 §67 refund trio | receptionist (even stepped-up) 403 PERMISSION_DENIED; Bea stale step-up 403 STEP_UP_REQUIRED; after /auth/step-up the same key refunds $5.00; one audit row naming her | PASS |
| S12 §77 Customer Display | the front desk sends Bea's guest to the display (total shown); the PHONE pays; the display's own projection → `payment_success` with no POS action; the display releases | PASS |
| S13 §75 audit trace | one session: LOGIN_SUCCEEDED → checkout_payment_claimed → mobile_payment_initiated → tap_to_pay_session_minted → mobile_payment_completed → mobile_receipt_requested, in order | PASS |
| S14 §10 / §68 store switch | shared phone, owner: unauthorized location 403 DEVICE_BRANCH_NOT_AUTHORIZED; stale 403 STEP_UP_REQUIRED; disabled merchant 409 MERCHANT_NOT_CONFIGURED (new check, before switching); annex switched + audited | PASS |
| S14 money follows the switch | annex payment PAID, row in the annex, intent `merchant_account_id` = the annex's merchant, annex report lists it (device label, employee), main report does not | PASS |

Findings / honest limits:
- **External:** the CommerceHub Tap to Pay charge carries the SAME CommerceHub merchant for every location (one
  `COMMERCEHUB_TTP_MERCHANT_ID` from the environment); the per-location merchant account is recorded on the intent and the
  payment. Per-location CommerceHub MIDs need Fiserv onboarding per location.
- S14's annex ticket is a FIXTURE: T9 went through the queue + Tech App at the main location and was moved to the annex by
  SQL (a second location's own staff / menu / queue are proven in phase 11, skipped here).
- Pilot-script fix: since Security Deep Scan §59 (`2881125c`) every staff invitation is a step-up route; the setup now steps
  up for the receptionist invite too (the manager invite rides the same fresh step-up).
- Unit / PGlite coverage added the same day: `mobile-unsettled-guard` (11), `mobile-device-rename` (7), `device-security-signals`
  (4), `device-attestation` (7), `device-identity` (+1, pgtest +2), `security.test` (+3), `ReturnToStaff` (7), `TapToPayDevicesPanel` (+1), metrics (+2).

## Oct 24 2026 — M4 close-out re-run

**177 of 177 checks pass** on a freshly migrated database (through migration 691) with the M4 code (`c7ac0064` + docs).
Evidence: `docs/pilot-runs/2026-10-24-m4/` (`pilot.log`, `pilot.json`, `shots/`). Phase 11 vs the M5 run: POS queue state
1.65 → 0.40 s; outbox publish lag during the 3,500-booking burst p50 8.3 → 1.8 s, p95 27.8 → 17.2 s; clock-in burst p95
3.1 → 3.56 s (unchanged within noise — CPU-bound, PERFORMANCE_REPORT.md "M4 close-out"); 0 × 429 under the new limiter
(24,000 / location, 2,000 / session). New: `PILOT_M5_CLIENT_RPS` (default 30) paces each session, and the M5 volume days
book from four front-desk sessions.

## Oct 24 2026 — M5: the 200-technician pilot phase completed

**Result: 177 of 177 checks pass** for the whole pilot day (phases 0–12) on a freshly migrated database (through
migration 690), with screens on, in **389 s** wall time. Phase 11 (the large salon) took 280 s; its M5 continuation is
`apps/api/scripts/lib/pilot-large-salon-m5.mjs`, run right after `lib/pilot-large-salon.mjs`. Evidence (redacted):
`docs/pilot-runs/2026-10-24-200-tech/` (`pilot.log`, `pilot.json` → `numbers.large.m5`, `shots/`). Code at `ea6636e1`.

**How to run it** (from `apps/api`, built): `DATABASE_URL=postgres://…/<scratch db> PORT_PROOF=3201 PILOT_SHOTS=<dir>
PILOT_OUT=<file.json> node scripts/live-pilot-day.mjs`. `PILOT_SKIP=11` skips the large salon, `PILOT_SKIP=11m5` keeps
its first part and skips M5, `PILOT_TIMEOUT_MIN` (default 45), `PILOT_M5_RPS` (the M5 load generator's pace, default 30
requests / s — it honours 429 Retry-After; 0 × 429 in this run), `PILOT_SCREEN_SSE=0` restores the old 204 for streams.

| Item | What was proven (real API / real PostgreSQL / Chromium where a screen is required) | Result |
|---|---|---|
| Pagination edges | totals 0 · 1 · 11 · 12 · 13 · 24 · 25 (an exact-service filter on that many technicians), 200, 201 (after hiring #201), 200 (after deactivating #50), 199 (after a transfer): pages = ⌈n/12⌉ (1 when empty), last page 0/1/11/12/1/12/1/8/9/8/7, every technician once, a page past the end answers the last page | PASS |
| 500 / 1,000 / 2,000-record days | booked through the API (16.7 s / 33.3 s / 66.7 s at ≤ 30 rps); all 17 day grids summed = DB (500 / 1,000 / 2,000; busy tomorrow 1,113), no duplicate, ≤ 12 columns; grid p95 57 / 70 / 78 ms, largest 112 KB; list state 42 / 64 / 126 ms; openings 50 / 50 / 53 ms | PASS |
| Customer Display 3-second clear (phase 4) | the Front Desk display is open in Chromium across Jenny's checkout and card payment: "payment complete" → **3,006 ms** → it leaves by itself; no frame afterwards shows her name / total / services; the display released the session (server state idle, session completed) — no "Clear Display" tap | PASS |
| Realtime fan-out | 55 live streams (50 technician phones, each its own signed-in session, + 5 POS screens): one booking → `appointment_created` on all 55 exactly once, p50 46 / max 47 ms; phone frames carry no payload | PASS |
| Off-screen invalidation / noisy technician | the POS Booking board (Chromium, tomorrow, page 1): #150's schedule change → metadata refresh only, **0** day-grid fetches; 20 changes for #150 in 0.8 s → **0** grid fetches in the next 18 s (incl. a safety tick); a booking for visible #5 → grid re-fetched and drawn | PASS |
| Browser memory | 17 pages × 3 rounds (48 page changes): heap 11.3 → 11.5 MB, DOM nodes 10,025 → 10,025, listeners 992 → 992; ≤ 12 columns (page 17: 8); page change p50 199 / p95 289 ms | PASS |
| Off-screen mobile #193 | board on page 1; a guest is assigned to #193 → her own room in 1,339 ms; her phone app (390×844) shows the guest in 1,400 ms without reload; #100's own room hears nothing of it | PASS |
| Reconnect | #100's phone drops, she is assigned a guest, reconnect with Last-Event-ID → `resync_required` (sequence_gap); `/tech/tickets` has the ticket | PASS |
| Schedule change #150 / break #120 | #150's open times end with her new hours, #149 untouched, every POS stream hears it; #120 on break → Fair Turn (105 clocked in, 96 ms p50) marks her "on break", never recommends her; appointments / schedule untouched; back after | PASS |
| 200-technician payroll | through the API (pay plans, bonuses, deductions; sales / time-clock facts as fixtures): calculate 200 statements in 181 ms (commission 140, hourly 40, salary 20, guarantee 20, tips 193, bonus 8, deductions 5); 50/50 to the cent; exceptions-only = exactly the 15 expected; approve selected (185 approved, 15 held) → each held one approved → **400 instructions, 400 payouts (200 check + 200 cash)**, Σ = $78,301.63 = payable, report reconciles; #100 sees only her own statement | PASS |
| Tech App at phone size | #1 / #25 / #100 / #193 / #200: Home, Schedule, Queue, Current Ticket, Time Clock, Earnings, Payroll, Notifications, Profile — every API answer 2xx, no page error, no salon / owner API; nothing on #100's screens carries #101 | PASS |
| Deactivation / transfer | #50 inactive → 200 active, on no page, booking and assignment refused (400), 21 appointments and her approved paycheck unchanged; a technician moved to a new "Pilot Annex" (Super Admin request → approve): main board 199, annex lists her, none of her 26 old appointments visible there (all kept at main), she can enter the annex only, the annex saves her week and books her; #100 cannot enter the annex | PASS |

**Real bugs the pilot found (all fixed, each with tests):**
1. **Booking board reloaded its whole grid for any change** — #150 off-screen, another day, or a walk-in. Appointment events
   now carry `technicianId` / `date` (ids only); the board scopes every refetch (skip / metadata / full), incl. the
   15-second change-feed tick. `apps/api/src/events/consumers/realtime-projection.consumer.ts`,
   `modules/booking/src/booking/booking.kysely.repository.ts`, `apps/pos-web/src/realtime/bookingRelevance.ts`,
   `useRealtime.ts`, `POSBookingScreen.tsx`. Tests: `realtime-projection.board-scope.vitest.spec.ts`, `bookingRelevance.test.ts`, `useRealtime.test.tsx`.
2. **A transferred technician's week could not be saved at her new location (500)** — the writer deleted only the new
   branch's rows; the old branch's rows held every weekday (tenant-wide unique key). The transfer now moves her schedule;
   the writer replaces her week tenant-wide. `technicians.kysely.repository.ts`, `super-admin-staff.kysely.repository.ts`.
   Test: `branch-transfer-schedule.pgtest.vitest.spec.ts`.
3. **The owner could not enter a location the Super Admin opened for her salon** (explicit grants confine). createBranch
   extends owner-level access to it. `super-admin-platform.repository.ts`; test `branch-create-owner-access.pgtest.vitest.spec.ts`.
4. **Realtime fell minutes behind under a booking burst** — the outbox publisher claimed one batch per second (r2: publish
   lag p50 125 s / max 164 s). `drain()` claims the next batch at once while batches come back full (bounded 20).
   `apps/api/src/events/outbox-publisher.ts`; test `outbox-drain.pgtest.vitest.spec.ts`. After: p50 8.3 s / p95 27.8 s / max 30.7 s
   over 4,616 events of the synthetic 3,500-booking burst — still a WATCH item (sequential consumers per event).
5. **The pilot's own API-log check missed 5xx lines** (`"level":"error"` is lower case). It now fails the day on any
   error-level line except two named, expected ones.
6. **No "exceptions only" / technician search for a 200-statement week** (§66/§67): `GET …/paychecks/periods/:id?exceptionsOnly&search&branchId`
   with per-statement exceptions; POS and Owner App toggles. Tests: `payroll-week-review.vitest.spec.ts`, `POSPaycheckTab.test.tsx`, `OwnerPaycheckPanel.test.tsx`.


## Oct 23 2026 — Secure Tap to Pay M6-5: three signing phones, live

**Result: 146 of 146 checks pass** for the whole pilot day (phases 0–12). Phase 12, the new Secure Tap to Pay phase,
has **29 of 29**.

The run used a freshly migrated PostgreSQL database (628 migrations, through 688) and the real built API, with screens
on. The evidence (`pilot.log`, and `pilot.json` with every status code and database row in `numbers.secureTtp`) is in
`docs/pilot-runs/2026-10-23-secure-tap-to-pay/`. The code is `apps/api/scripts/lib/pilot-secure-tap-to-pay.mjs`, which
`live-pilot-day.mjs` runs as phase 12; `PILOT_SKIP=11` skips the large-salon phase for a quick re-run.

This is the first full HTTP round trip of device signing:

- Three payment phones each have their own ECDSA P-256 key, made with `node:crypto`. Only the SPKI DER public key, in base64, is registered.
- Each phone signs every `/mobile-checkout` request exactly as `packages/mobile-sdk/src/device-proof.ts` does. The signature is IEEE-P1363, base64url, and the body hash is over the exact JSON sent.
- The front desk phone calls the `/api/v1/...` URLs and signs the stripped path.
- The CommerceHub loopback has two extra answers: a 200 `PENDING`, and a dropped connection.

| Step | What was proven over HTTP | PASS / FAIL |
|---|---|---|
| S0 | Seven tickets reach Service Done through the queue and the Tech App | 1 / 0 |
| S1 | Pairing codes and a normal registration (details below) | 2 / 0 |
| S2 | Registration and locations for all three phones (details below) | 3 / 0 |
| S3 | Three phones take three checkouts at the same time (details below) | 3 / 0 |
| S4 | Two phones claim the same ticket at once (details below) | 1 / 0 |
| S5 | Shift change on the shared phone, and another user on the personal phone (details below) | 2 / 0 |
| S6 | Tampering is refused (details below) | 6 / 0 |
| S7 | One phone is revoked mid-day (details below) | 4 / 0 |
| S8 | An unknown capture result goes to verification (details below) | 4 / 0, plus 1 BLOCKED_EXTERNAL |
| S9 | The POS and the owner see the mobile payments (details below) | 3 / 0 |

### S1 — pairing codes and a normal registration

- Without a fresh owner step-up, creating a pairing code gives 403 `STEP_UP_REQUIRED`. This was proven on a second owner sign-in that had no step-up.
- With a step-up, the owner creates two codes:
  - a SHARED code for the front desk phone
  - a PERSONAL code for the manager phone
- Each code is single-use, lasts 5 minutes and belongs to one branch. Only its sha256 is stored.
- The checkout phone registers normally and lands PENDING.
- Approval without a step-up gives 403 `STEP_UP_REQUIRED`. With a step-up the phone becomes ACTIVE.

### S2 — registration and locations

- Each phone registers its key with a request signed by that key (proof of possession).
- The two paired phones become ACTIVE at once. Using the shared code again gives `PAIRING_CODE_INVALID`.
- The owner sets each phone's locations with a step-up, through `POST devices/:id/branches`.
- Database check:
  - three ACTIVE phones, each with an ES256 key and a fingerprint
  - the front desk phone is shared
  - the personal phones are bound to their own user

### S3 — three concurrent checkouts

- Each phone runs lock → proceed → intent → readiness → provider session → capture. All three finished in 561 ms.
- There was one charge per ticket, and every ticket ended PAID.
- **Amounts are set by the server.** The intent takes the server's remaining balance of 4942. The processor was charged $49.42 and the payment row records 4942, although each phone reported `capturedAmountCents: 1`.
- An amount above the balance is refused: 409.
- Each payment row records the signed-in employee and the device.

### S4 — two phones claim the same ticket

- Exactly one claim wins. The other gets 409 `CHECKOUT_ALREADY_CLAIMED`.

### S5 — shift change and another user

- **Shared phone:** Max signs out, and his old cookie then gets 401. Bea signs in on the same phone, takes a payment, and the payment is attributed to Bea on the front desk phone.
- **Personal phone:** Max signs in on Bea's personal phone. The claim and the heartbeat both get 403 `DEVICE_NOT_AUTHORIZED`, the intent gets 409 because there is no claim, and no payment is taken.

### S6 — tampering

| Tamper attempt | Server answer |
|---|---|
| Body changed after signing | 403 `DEVICE_KEY_MISMATCH` |
| Same nonce sent twice | 409 `DEVICE_REQUEST_REPLAYED` |
| Timestamp 10 minutes old | 403 `DEVICE_KEY_MISMATCH` |
| Unsigned claim or intent, device header without a signature, or another key's signature | 403 `DEVICE_KEY_MISMATCH` |
| Unsigned capture result or unsigned cancel of the phone's ready intent | 403 `DEVICE_KEY_MISMATCH`, and the intent stays ready |
| Second device registering the same public key (copied private key, another signer, or unsigned) | 403 `DEVICE_KEY_MISMATCH`, and no row is created |

### S7 — revoke mid-day

- Revoking without a step-up gives 403. With a step-up the phone is revoked.
- In the database, its sessions and refresh tokens are revoked.
- The old session gets 401 at once, and the refresh token gets 401 `REFRESH_INVALID`.
- Signed in again on the revoked phone, all nine routes it signs get 403 `DEVICE_REVOKED`.
- The other two phones still get 200.

### S8 — unknown capture result

- A dropped connection and a 200 PENDING answer both put the attempt in `unknown`, which is recoverable and never declined.
- Re-sending the result is refused. A new intent gets `PAYMENT_STATUS_UNKNOWN`. There was one charge per ticket.
- `reconcile` asks the provider and ignores the phone's "confirmed", its reference and its amount. The answer is `wait` (no_inquiry), and the attempt stays unknown.

### S9 — POS and owner history

- The POS checkout list shows each mobile ticket PAID, and the paid commission snapshot is present.
- `payment.captured` and `checkout.completed` are in the outbox and **published**.
- The POS Mobile Payments card shows the two live phones and not the revoked one.
- The owner's history lists all four mobile payments with the device label and the employee.

**BLOCKED_EXTERNAL (S8):** reconcile cannot reach a *verified final* state yet. That needs the CommerceHub transaction
inquiry (`inquireByOrderId`), which is deliberately not implemented until it has been verified against the CommerceHub
sandbox, and that needs credentials. Until then the attempt correctly stays "verifying".

### Server bugs the live run found and fixed

Each fix has a regression test, and the pilot was re-run on a fresh database after the fixes.

1. **A 200 PENDING provider answer was recorded as DECLINED.** An unknown payment must never be a decline. Because the attempt was marked declined, a second charge was allowed.
   - Fix: `FinalizeResult.outcome`, filled by the adapter, so `applyCaptureResult` sends `unknown` to `markUnknown`.
   - Files: `tap-to-pay-session.ts`, `fiserv-commercehub-ttp.adapter.ts`, `mobile-checkout.service.ts`.
2. **While a card was unresolved, a new intent answered `PAYMENT_ALREADY_COMPLETED`.** Nothing had been paid.
   - Fix: it now answers `PAYMENT_STATUS_UNKNOWN`, or `PAYMENT_IN_PROGRESS` when nothing is unresolved.
   - Files: `mobile-remaining-balance.ts`, `mobile-checkout.service.ts`.
3. **The claim on a SHARED phone refused the next employee of the shift** (`DEVICE_NOT_AUTHORIZED`).
   - Fix: `acquireLock` ignored `shared` and now honours it.
4. **An unsigned capture result or cancel for a keyed phone's intent was accepted.** A session alone could decline or cancel the phone's payment.
   - Fix: `assertAttemptDeviceProof`, used by `applyCaptureResult` and `cancelAttempt`.
5. **A revoked phone's session kept authenticating for up to 15 s.** The session store had a cached "live" answer.
   - Fix: `revokeDeviceSessions` also revokes each session in identity's `SessionStore`.
   - Files: `mobile-pay-device.kysely.ts`, `mobile-checkout.module.ts`.

Tests:

- `device-identity.vitest.spec.ts` covers bugs 1, 3 and 4.
- `mobile-remaining-balance.vitest.spec.ts` and `mobile-partial-attempt.vitest.spec.ts` cover bug 2. The old expectation in `mobile-partial-attempt.vitest.spec.ts` encoded the bug.
- `device-identity.pgtest.vitest.spec.ts` covers bug 5.
- `checkout-lifecycles-r2.vitest.spec.ts` was failing before this work. It expected `revoked → active`, which §18 has forbidden since M6-3, so its expectation was corrected.

---

> **Oct 23 2026 — after the Security Deep Scan hardening: 117 of 117 checks pass** (phases 0–11 incl. the 200-technician
> large-salon phase), on a freshly migrated PostgreSQL (626 migrations, through 686), the real built API and the real built
> apps in Chromium. Log, timeline JSON and the restore drill: `docs/pilot-runs/2026-10-23-post-hardening/`.
>
> What the hardening changed in the day itself (and the pilot now proves):
> - the owner's first sign-in: the Super Admin (fresh step-up + a reason) has a temporary password **sent to the owner** —
>   the answer names only the channel and a masked address; the owner exchanges it and sets her own password, and the
>   change mints **no session** (`mustSignIn`) — C1 / C2. (The proof reads the mock e-mail outbox, development only.)
> - the salon's gateway base URL must be https on an allow-listed processor host (D2): the pilot registers
>   `https://pilot-loopback.cardconnect.com`, forwarded to the loopback fake by a proof-only preload.
> - a Super Admin TOTP step-up consumes its 30-second window: two step-ups in one window are refused by design.
>
> Large salon (phase 11): 200 technicians in 17 pages of 12; "#200" search + jump; exact-service filters (pedicure 140,
> acrylic 101); 1,000 more appointments tomorrow (1,112 total); a 12-column day grid of 62 KB vs 968 KB unscoped; page
> change p50 21 ms / p95 22 ms; day grid 45 ms; 20 front desks racing one slot → exactly one booking and 19 × 409
> APPOINTMENT_CONFLICT; Tech App sign-in for #1/#25/#100/#193/#200 with permission attacks refused; 100 unique Clock PINs
> (duplicate → 409 PIN_IN_USE); 100-technician clock-in burst (100 shifts, p95 4.1 s, replays write nothing); 30-guest
> walk-in burst (30 distinct items, 0.6 s); every large-salon read under 1 ms in EXPLAIN ANALYZE.
> Watch items (not failures): the clock-in burst p95 (4.1 s for 100 simultaneous taps) and the POS queue state with 100
> technicians clocked in (1.8 s) — both in NEXT_STEPS as performance follow-ups.

Wave 4 PILOT, 13 Oct 2026. The proof script is `apps/api/scripts/live-pilot-day.mjs`.

**Result: 73 of 73 checks pass** (re-run after the post-pilot fixes, Oct 13 2026, salon zone Etc/GMT-10; the first run was 71 of 71).

The full day ran green in a salon zone east of UTC (Etc/GMT-14, already "tomorrow" in UTC terms). It also ran green in a zone west of UTC (Etc/GMT+10): 66 of 66 checks in that run, before the screen checks were added.

The run used the real HTTP API (`dist/main.js`) on a scratch PostgreSQL database and the real built apps in Chromium. No credentials were used. Every provider call went to a loopback fake or to the "not configured" path:

| Provider | What the pilot used |
|---|---|
| Card processor | The salon's own CardPointe gateway, pointed at a loopback fake |
| Tap to Pay | A CommerceHub loopback fake, with `COMMERCEHUB_TTP_ENV=sandbox` |
| Twilio and SendGrid | Unset, so SMS and e-mail took the degrade path |

**How to run it.** Run from `apps/api`, after a build:

```
DATABASE_URL=postgres://postgres@localhost:5432/<scratch db> \
  PILOT_SHOTS=<folder> PILOT_OUT=<file.json> \
  node scripts/live-pilot-day.mjs
```

| Option | What it does |
|---|---|
| `PILOT_TZ=<zone>` | Pins the salon zone. By default the script picks a whole-hour zone where it is 10:00 now, so the whole day falls inside business hours |
| `PILOT_SCREENS=0` | Skips Chromium |
| `PILOT_STOP_AFTER=N` | Stops after phase N |

## Timeline (salon local time, compressed into one run)

| # | Phase | What happens, through which surface |
|---|---|---|
| 0 | Boot | API on PostgreSQL. Card processor and Tap to Pay point at the loopback fakes. Twilio and SendGrid are unset. |
| 1 | Onboarding | 1. The public website application gets a reference number, and a double tap gives the same reference.<br>2. The Super Admin signs in with TOTP, reviews the application, approves it, and an onboarding case opens.<br>3. The Super Admin creates the tenant: salon code, branch, invited owner, pending gateway.<br>4. The application is marked converted.<br>5. The owner gets a first-sign-in temporary password, signs in and sets her own password.<br>6. With a step-up, the salon moves ONBOARDING → PENDING_APPROVAL → ACTIVE.<br>7. The onboarding case is linked to the tenant. |
| 2 | Owner setup | 1. Business details, the salon zone (written to the branch) and NJ tax of 6.625 %.<br>2. Store hours for 7 days.<br>3. RBAC: the receptionist cannot change tax.<br>4. Receptionist and manager invited **by the owner** (POS → Team → Invite staff, `POST /pos/access/invitations`), then accepted; both invitations audited against the salon; the receptionist cannot invite (403).<br>5. Menu: Gel $45 (60 %), Pedicure $60 (50 %), Acrylic $70 (55 %), and the Nail Art add-on $15 (50 %) in "Add-ons".<br>6. Lisa, Mary and Anna hired on the POS: invite → accept → skills → services → schedule → clock PIN → Tech App sign-in.<br>7. Anna gets 65 % on Acrylic using the Super Admin's one-time code. Without the code the change is refused (403).<br>8. CardPointe gateway set up and its test connection passes.<br>9. Customer display paired.<br>10. Inventory and recipe set up.<br>11. Go Check-In kiosk provisioned and switched on. |
| 3 | Day opens | 1. Fair Turn package switched on, set to RECOMMEND_AND_CONFIRM.<br>2. Clock-in by PIN on the kiosk: a wrong PIN is refused, and the technicians join the rotation in order.<br>3. Kiosk walk-ins Jenny (gel + nail art) and Kim (pedicure).<br>4. Fair Turn recommends Lisa for Jenny and Mary for Kim, and the desk confirms each.<br>5. OTP for online booking cannot be switched on without Twilio Verify (409).<br>6. Online booking: Nina books Anna for an acrylic set; the request is idempotent.<br>7. The AI receptionist books Vera's pedicure, with times in the salon zone.<br>8. Nina's appointment is checked in.<br>9. Olivia's visit is split across two technicians.<br>10. **Screen:** POS Queue and Check-In. |
| 4 | Service + checkout | 1. Each part goes accept → start → Service Done in the Tech App. Mary adds nail art during the service.<br>2. Jenny: the receptionist's discount is refused (403) and the manager applies $6. She adds a $10 tip and buys a $50 gift card. **Screen:** POS Checkout and the customer display both show **$119.61**. She pays by card through CardPointe, once; a retry replays the same payment. The display clears (**screen**). The SMS receipt is "simulated".<br>3. Kim: a membership with 20 % off pedicures is applied automatically; she pays cash.<br>4. Olivia: a $20 tip; the $50 gift card plus a card pay the bill.<br>5. The tip split shows no lost cent. |
| 5 | Tap to Pay | 1. The Super Admin onboards Tap to Pay; the manager registers her phone and the owner approves it.<br>2. The manager claims Nina's ticket. While the phone holds the claim, the front desk cannot take cash.<br>3. A retail Cuticle Oil is added on the phone.<br>4. $20 cash plus $70.05 Tap to Pay. The capture result is posted twice but charges once. |
| 6 | Refund, inventory, loyalty | 1. The owner refunds Jenny's $15 nail art: one CardPointe refund. The receptionist's refund is refused (403).<br>2. Lisa's commission reversal is written as an adjustment.<br>3. Inventory: oil 10 → 9; polish 6 → 4 by the recipe.<br>4. Loyalty: 1 point per dollar, exactly once, net of the refund. |
| 7 | End of day | 1. Reconciliation, shown below.<br>2. Cash drawer.<br>3. Time clock: PIN clock-outs, nobody left clocked in.<br>4. Payroll: period → prepare → step-up → approve (hash) → CSV export → pay → database lock.<br>5. A refund after the lock becomes a next-period adjustment.<br>6. The Tech App and Owner app payroll match. |
| 8 | Screens at close | 1. Lisa's Tech App earnings.<br>2. Owner dashboard and the Owner Reports tab.<br>3. POS Reports. |
| 9 | API log | The API logged no unexpected errors during the day. |

## The numbers (one run; every figure is cross-checked)

| What | Value | Equal to |
|---|---|---|
| Collected: card + cash + gift card | **$411.25** | Payments report mix; Owner app "Today's revenue" |
| Gross sales: services $310.00 + retail $12.00 | $322.00 | — |
| Discounts | $18.00 | Manager's $6.00 + membership $12.00 |
| Tax (6.625 %) | $20.14 | — |
| Tips | $30.00 | Snapshot $30.00 = tips report = commission report |
| Card surcharge | $7.11 | Sum of `payments.surcharge_cents` |
| Gift cards sold | $50.00 | — |

**Identity check:** 322.00 − 18.00 + 20.14 + 30.00 + 7.11 + 50.00 = **411.25**, which equals the amount collected.

**Payroll basis:** report service sales $310.00 equals the compensation snapshot gross of $310.00.

**Commission:**

| Technician | Commission | Tips | Tech App |
|---|---|---|---|
| Lisa | $58.05 − $6.75 refund reversal = $51.30 | $20.00 | $71.30 |
| Mary | $61.50 | $10.00 | Same |
| Anna | $45.50 (65 % Acrylic rule) | — | Same |
| **Total commission** | **$158.30** | | Owner finance $158.30 |

**Cash drawer:** expected $87.17. That is Kim's $67.17 plus the $20.00 cash in Nina's Tap to Pay split; the split's cash status is "partial".

**Payroll period (paid and locked):**

| Technician | Payable |
|---|---|
| Mary | $71.50 |
| Lisa | $71.30, including the −$6.75 adjustment |
| Anna | $45.50 |
| **Total** | **$188.30** — Owner app $188.30; Mary's Tech App shows paid $71.50 with $0 outstanding |

**Refund after the lock:** Kim's $12.00 refund creates a −$6.30 adjustment for Mary in the **next** period, linked to the locked one. The locked lines are byte-for-byte unchanged.

## Screenshots (Chromium; real built apps; session cookies from the same sessions that did the work)

Saved as `pilot-NN-*.png` in `PILOT_SHOTS`. They are not committed; they are regenerated by each run.

| # | Name | Content |
|---|---|---|
| 01 | pos-queue | Receptionist's queue with Jenny and Kim |
| 02 | pos-check-in | Check-In screen |
| 03 | pos-checkout-jenny | Jenny's checkout workspace, Total Due $119.61 |
| 04 | customer-display-totals | 23-inch display, "Hi Jenny" with the line items, TOTAL DUE $119.61 and the tip prompt |
| 05 | customer-display-cleared | Display back to the check-in screen |
| 06 | tech-app-earnings-lisa | Phone-sized Tech App: $71.30; Services $58.05; Tips $20.00; Adjustments −$6.75 (now written sign-first by the shared formatter) |
| 07 | owner-app-dashboard | Today's Revenue $411.25; 4 services |
| 08 | owner-app-reports | Owner app Reports tab, total revenue $411 |
| 09 | pos-reports | Gross $322.00; Net $304.00; Tax $20.14; Surcharge $7.11; Refunds $27.00; Average rating "—" |

## Findings and fixes

Each fix has a test that failed before it and passes after it, and the pilot check is now green. Severity runs from P0 (highest) to P3.

| ID | Sev | Where | Found by | Fix and test |
|---|---|---|---|---|
| P-1 | P1 | `apps/api/scripts/seed.ts` | Onboarding: the Super Admin had no platform role, so the Super Admin APIs refused it | Seed sets PLATFORM_SUPER_ADMIN and repairs a NULL role |
| P-2 | P1 | `tenant_applications` CHECK; super-admin repository | Approve "succeeded", but the status never changed: the CHECK was too narrow and the error was swallowed | Migration `662_tenant_applications_lifecycle_statuses.sql`; no more swallowed error. `application-status-check.pgtest` (20 tests) |
| P-3 | P2 | super-admin onboarding | The onboarding case was never linked to the tenant it produced | `OnboardingService.linkTenant`, called from `markApplicationConverted`. +1 lifecycle test |
| P-4 | P2 | tenants settings | The business-branch zone was saved but never written to `branches.timezone` | Write-through, IANA validation, cache cleared. `business-branch-timezone.pgtest` (2 tests) |
| P-5 | P1 money | workforce technicians | The POS technician commission edit spent the Super Admin code, answered 200, and payroll ignored it | The edit now authors the engine's Technician / Technician+Service / Technician+Category rules. `technician-commission-rules.pgtest` (6 tests) |
| P-8 | P1 | ai voice-booking | The AI receptionist read the wrong settings category, so it used default hours and the New York zone; booked times were off by the zone difference | Reads the saved store hours and the branch zone. `voice-branch-info.pgtest` (3 tests) |
| P-9 | P1 | queue tech | A one-technician visit had no ticket until Service Done, so the Tech App could not add an add-on during the service | The ticket is created at start. +1 shared-visit pgtest |
| P-10 | P2 | queue serving | Literal "Add-on" checks rejected an "Add-ons" category | `isAddOnCategory`. `serving-addon-category` (4 tests) |
| P-11 | P2 | pos-web Checkout | The receipt note always said "sent" | Honest per-channel note. +1 POSCheckoutScreen test |
| P-12 | P1 money | queue visit-ticket | Lines had a NULL category, so membership benefits and category rules never applied | `category_snapshot` is set and passed to the resolver. `visit-ticket-category.pgtest` |
| P-13 | P2 | queue `ServingModule` | Retail sold on the floor never moved stock (inventory port missing) | Imports `InventoryModule`. `serving-module-inventory` test |
| P-16 | P1 | checkout | The live card path recorded no surcharge on the payment | `claimPayment` carries `surchargeCents`. `checkout-card-surcharge-recorded` test |
| P-17 | P1 | checkout | Owner finance showed $0 revenue because ticket final totals were never stamped | `setFinalTotals` in `afterPaid`. `checkout-final-totals` test |
| P-18 | P1 | reports | POS Reports did not reconcile (tax, tips, surcharge, products wrong) and showed invented rates and statuses | Real ticket figures, snapshot tips, tenant rates, gateway status. `reports-reconcile.pgtest` |
| P-19 | P2 | checkout cash drawer | The register's expected cash excluded "partial" cash, such as the cash part of a Tap to Pay split | Uses `REVENUE_BEARING_STATUSES`. `cash-drawer-split-cash.pgtest` |
| P-20 | P2 | analytics owner | Owner app payroll dates came back as "Thu Oct 15 2026 00:00:00 GMT…" | `ymdOfDate`. `owner-payroll-dates` (2 tests) |
| P-21 | P1 | workforce commission-report | "Today" and "Month" used the UTC date. A salon east of UTC — or any US salon after about 8 pm — saw $0 at close while payroll and the Tech App showed the day | The salon's business date (`salonToday`). `commission-report-salon-day` (3 tests) |
| P-22 | P2 | pos-web Checkout | The totals panel left out the card surcharge, so its lines did not add up, and an unpaid total read "Total Paid" | Surcharge line added; "Total Due" until paid. +1 POSCheckoutScreen test |
| P-23 | P2 | reports | POS Reports showed "Average rating 4.8" with no reviews, a +11 % trend against an invented previous period, and 1/1 bookings per chart day | Removed; the screen shows "—". `reports-reconcile` test extended |
| P-11b | P2 | communications / notifications (sender selection) | The mock SMS / e-mail senders ran in any `NODE_ENV`; the ledger said "sent" and the SMS meter was charged | One selection (`packages/notifications` `smsSenderFromEnv` / `messagingEmailSenderFromEnv`) used by all 7 factories: production never takes a mock — an unconfigured channel is refused as `blocked / not_configured`, never sent, never metered; a forced mock (`MESSAGING_MOCK_SENDERS`) is a production startup refusal; outside production the mock's rows are `simulated` (migration 663), unmetered and not usage. `sender-selection.test` (4), `sender-not-configured.vitest` (3), checkout receipt (+2), production-config (+1) |
| P-24 | P3 | tech-web (and every `centsToUsd` user) | The Tech App showed "$-6.75" | The shared formatter writes negatives sign-first, "−$6.75"; pos-web / admin-web membership money helpers moved onto it. `tech-money.test` (1), money display rules updated |
| P-25 | P3 | tenants settings | `saveCategory` swallowed a failed write and the save answered 200 | The write error propagates; the POS Settings screen shows it and no audit row claims it. +1 `business-branch-timezone.pgtest` |
| P-26 | P3 | analytics owner | The Owner app's date chip showed the UTC date of the salon's start-of-day (a day behind east of UTC) | The dashboard's `date` is the salon's business date; the booking overview carries `businessDateFrom` for its chip. `owner-dashboard-business-date` (3) |
| P-27 | P3 | identity / super-admin invitation path, pos-web Team | Only the Super Admin could invite front-desk staff | The salon invites RECEPTION / FRONT_DESK / MANAGER itself through the same invitation (`roles.manage`, own salon only, never above the inviter's own permissions, audited against the salon); POS Team → Invite staff. `salon-staff-invite.vitest` (6), POSTeamPermissionsScreen (+2), pilot check |
| P-28 | P3 | analytics overview / dashboard | `completedServices` counted completed appointments | Counts service lines completed on the salon's day (add-ons count, removed lines do not). +1 `analytics-local-day.pgtest` |
| P-29 | P3 | analytics owner | Owner "average ticket" divided everything collected (tax, tips, gift cards); POS reports divide sales | Sales ÷ paid tickets on the dashboard, branch list, branch detail and finance, labelled "(sales)". `owner-financial-kpis` (+1, 2 re-pinned); pilot check: owner $80.50 = POS $80.50 |
| SW-04 | P3 | workforce compensation | `GET /owner/compensation/reports/platform` was reachable by no role and called by nothing | Route, its gate, service method, port method and repository query removed; generators re-run |
| SW-19 | P3 | queue check-in | Every walk-in looked its temporary `ci_<n>` id up in a uuid column (swallowed error) | Only a uuid is looked up. `check-in-temp-id.vitest` (2) |
| SW-21 | P3 | workforce tech-profile, queue technician help, super-admin transfer preflight | A missing query id reached PostgreSQL as `''` | Checked first (`requireUuidId` / `isUuidId` in `packages/observability`): same 400 INVALID_ID / 404; the sweep's allow-list for it is gone. 3 tests (4 cases) |

**Not fixed — decisions for Kevin**

- **P-6 (P2):** two add-on models exist: the `service_add_ons` table and services in an "Add-ons" category. The pilot uses the category model.
- **P-7 (P2):** the kiosk offers an add-on to any technician, but queue eligibility needs the technician to be mapped to the add-on service. An attempt to align the two was reverted because it contradicted the eligibility authority.
- **P-14 (P2):** loyalty points also count gift-card value. Loyalty ignores "partial" cash.
- **P-15 (P3):** recipes are consumed only when someone records them; there is no automatic deduction at Service Done.
- **SW-18 (P2, sweep):** two Super Admin scheduled-report stores; which one is canonical decides how they are scheduled.

## Generators and gates (post-pilot fix run, Oct 13 2026)

- Run: `openapi.mjs --manifest`, `openapi.mjs`, `role-matrix.mjs --write`, `generate-api-inventory.mjs`, `check-api-contract.mjs --write-types-baseline`, `audit-state-transitions.mjs --write-vocab` (migration 663), `audit-unreached-routes.js --update` (SW-04 and five other routes came off the ledger).
- `node tooling/ci/run-gates.mjs`: all 47 gates + 13 audits pass.
- Still for the lead: the database docs / migration inventory for migrations 662–663.
- Leads seen in the PostgreSQL log during the re-run (pre-existing, not fixed here): `settings_audit_logs.entity_id` NULL on settings saves (the settings audit row is lost, swallowed), a `notification_delivery_logs` status CHECK violation, a `line_8001` id reaching a uuid column, and `clock_out_at` (a column that does not exist).
