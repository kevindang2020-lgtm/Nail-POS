# PILOT_VALIDATION_REPORT.md — the Pilot Nail Salon day, run for real (Oct 22 2026)

## Oct 28 2026 — Check-In + Live Operations One-Screen

**Not piloted on this commit** (needs the built API, two POS stations and the 27-inch touchscreen). What ran: the new SQL on PostgreSQL 16 (search on 50,000 customers, isolation, baselines, Live Operations authorities), the server rules in unit tests, and both pages in Chromium against stateful fixture APIs (measure 72 / 72, E2E 46 / 46).

## Oct 28 2026 — Overview 27-Inch One-Screen

**Not piloted on this commit.** The Overview pilots (27-inch touchscreen at 100 % zoom with the browser and taskbar visible, two-station realtime, a 200-technician tenant on a built API) need the built API and the hardware.

What ran here: the Overview SQL on PostgreSQL 16 (KPIs, board lists, isolation, EXPLAIN), the server rules in unit tests (11 / 11), and the real POS bundle in Chromium against a stateful fixture API (measure 36 / 36, E2E 22 / 22, announcement 5 / 5).

## Oct 28 2026 — Customer Queue One-Screen

**Not piloted on this commit.** None of the §88–§101 pilots ran. They need the built API, two POS stations, the Technician App and the 27-inch touchscreen. The pilots are:
- end-to-end Check-In → Queue → Tech Queue → Serving;
- concurrent assign / start;
- Add to Queue double tap;
- priority override;
- wait alert;
- 200-technician board;
- realtime between stations;
- tenant / branch isolation.

What ran here:
- the queue SQL on PostgreSQL 16 (one active entry, concurrent start compare-and-set, durable key, isolation, EXPLAIN);
- the service in unit tests (`queue-floor.vitest.spec.ts` 23 / 23, including restart / race idempotency, the priority reason, the coded HTTP refusals and the app wait alert);
- the screen in a real browser against a stateful fixture API (`interact-queue.mjs` 34 / 34).

## Oct 28 2026 — Serving One-Screen

**Not piloted on this commit.** The §135–§145 pilots (end-to-end, multi-technician, delayed service, add-on, concurrent start / stage, Mark Ready, Service Done handoff, realtime, Technician App update, tenant / branch isolation) need the built API and two stations.

What ran here:
- the Serving SQL on PostgreSQL 16 (concurrent start, add-on primary key, reassignment sessions, isolation, EXPLAIN);
- the service in unit tests (`serving-floor.vitest.spec.ts` 25 / 25, incl. concurrent start / Mark Ready / Send / add-on, multi-technician partial completion, isolation);
- the floor in a real browser against a stateful fixture API (`interact-serving.mjs` 36 / 36).


## Oct 28 2026 — Service Done One-Screen

**Not piloted on this commit.** The §122–§129 pilots (Serving → Service Done → Checkout, multi-technician, partial completion, quality issue, late add-on, rebooking, Move-to-Checkout concurrency, isolation) need the built API.

What ran here:
- the handoff SQL on PostgreSQL 16, including concurrency, refusals and tenant scope;
- the service in unit tests;
- the board in a real browser against fixtures (`interact-sd.mjs` 29 / 29).


## Oct 28 2026 — Checkout One-Screen

**Not piloted on this commit.** The browser E2E ran against a fixture API: `tooling/checkout-one-screen/interact.mjs`, 26 / 26. That is not a pilot. The live pilot day (`live-pilot-day.mjs`) needs the built API, which this environment cannot build.

On the physical 27-inch screen, check:
- the one-screen fit with the real fonts;
- finger scroll inside the queue and workspace;
- Apply Discount focus with the on-screen keyboard.


**What this is.** One realistic nail salon's whole day, end to end, through the REAL HTTP API on a REAL PostgreSQL 16
database, by the real roles (Super Admin, owner, manager, receptionist, technicians, a second salon's owner). The script
only READS the database to cross-check what the API said. It is `apps/api/scripts/live-pilot-day.mjs`; the
mandate's extra scenarios are its **phase 10** (added Oct 22). The earlier pilot write-up, `docs/PILOT_DAY_REPORT.md`,
covers phases 0–8 in prose and still applies.

**How to run it yourself** (built API, a scratch database — it creates a whole new salon with a unique code each run):

```bash
npm run build:packages && npm run build:modules && npm run build:api
createdb px_pilot && MIGRATE_DATABASE_URL=postgres://…/px_pilot node apps/api/scripts/migrate.mjs
cd apps/api && DATABASE_URL=postgres://…/px_pilot PORT_PROOF=3201 PILOT_SHOTS=/tmp/pilot-shots PILOT_OUT=/tmp/pilot.json node scripts/live-pilot-day.mjs
```

It is also lane `live-pilot-day` of `tooling/ci/final-run.sh` (log `final-run/21-pilot-day.log`, numbers `final-run/pilot.json`).

**What is real and what is a stand-in** (nothing is a stand-in where a real one exists here):

| Piece | In the pilot | Status |
|---|---|---|
| API, database, permissions, step-up, MFA (TOTP) | real (compiled API, PostgreSQL 16, real auth) | WORKING |
| Card processor | the salon's own CardPointe gateway configured through Super Admin, pointed at a **loopback CardPointe** that answers like CardPointe (approve `A`, decline `C`, host retry `B`, an answer with no status, a dropped connection, `inquireByOrderid`) | SANDBOX_READY (a real MID is Kevin's — P0-2) |
| Tap to Pay | loopback CommerceHub (session mint + charge) | BLOCKED_EXTERNAL (Apple / Fiserv) |
| Twilio | each salon's own Twilio account set through Super Admin; requests answered **in-process** by `scripts/lib/twilio-loopback.mjs` (records account SID, From, To — never the token); nothing reaches Twilio | PARTIAL (A2P / real numbers = Kevin) |
| Receipt OCR | the AI scan route's **development mock** (a fixed sample receipt — labelled DEV MOCK in the log; production answers 503 without a provider). The document pipeline (upload → scan → extract) has no object store / malware scanner / Textract here and honestly **quarantines** the upload | BLOCKED_EXTERNAL (P1-5) |
| E-mail | not configured → the invite link is handed to the manager (the product's honest degrade) | PARTIAL |

## 200-Technician Large Salon phase (M5, Oct 24 2026) — phase 11 + `lib/pilot-large-salon-m5.mjs`

Whole pilot day on a fresh database: **177 / 177 PASS** (389 s). Evidence: `docs/pilot-runs/2026-10-24-200-tech/`;
narrative and the bugs fixed: top of `docs/PILOT_DAY_REPORT.md`. Every row below is a check the run executed.

### 200-Tech Pilot Matrix

| Item | Result | Evidence (numbers from the run) |
|---|---|---|
| Technicians created | 200 | 176 hired through POS + the day's 24; mixed skills (72 / 45 / 27 / 16 / 16) |
| Booking page size | 12 | |
| Expected pages | 17 | |
| Page 1 (1-12) | PASS | page 1 = #1–#12 |
| Page 8 (85-96) | PASS | page 8 = #85–#96 |
| Page 17 (193-200) | PASS | page 17 = #193–#200 (8); with #201 hired = #193–#201 (9) |
| Pagination edges 0/1/11/12/13/24/25/199/200/201 | PASS | pages 1/1/1/1/2/2/3/17/17/17, last page 0/1/11/12/1/12/1/7/8/9 |
| Technician Search | PASS | "#200" → exactly #200 |
| Jump-to-Tech | PASS | locate #200 → page 17 |
| Find an Opening | PASS | top 5 + View More, eligible only, earliest first; 43–53 ms on 500–2,000-record days |
| Best Matches | PASS | same server ranking, no repeats |
| Exact Service Eligibility | PASS | pedicure filter = DB count; acrylic smaller pool |
| Concurrent Booking | PASS | 20 desks, one technician + minute → 1 booked, 19 × 409 |
| Fair Turn | PASS | 105 clocked in: recommend p50 96 ms; #120 on break → never recommended, back after |
| Realtime | PASS | 55 streams, one copy each (p50 46 ms); #193 live on her phone 1.4 s; reconnect → resync; noisy #150 → 0 grid refetches |
| Technician App Login | PASS | matrix below |
| 200-Tech Payroll | PASS | 200 statements in 181 ms; commission / tips / hourly / salary / bonus / guarantee / deductions; exceptions-only = 15; approve selected + held |
| 400 Payout Instructions | PASS | 400 instructions → 400 payouts (200 check + 200 cash), Σ $78,301.63 = payable |
| Performance | PASS | page change p95 17 ms (API) / 289 ms (browser); grid p95 ≤ 86 ms at 2,000 records; heap 11.3 → 11.5 MB over 48 page changes |
| Deactivation #50 | PASS | 200 active; booking / assignment refused; history and paycheck unchanged |
| Transfer | PASS | main 199; annex lists her, old appointments stay private to main; annex books her |
| Schedule change #150 | PASS | availability follows; neighbours untouched; board fetches no grid |
| Customer Display 3-second clear | PASS | 3,006 ms, session released by the display, no customer frame after |

### Technician App Login Matrix

| | invite / activation | login | refresh | logout kills cookie | tenant scope | branch scope | own-data privacy | Home | Schedule | Queue | Current Ticket | Time Clock | Earnings | Payroll | Notifications | Profile | Overall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| #1 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| #25 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| #100 | PASS | PASS | PASS | PASS | PASS | PASS (annex refused) | PASS (#101 pay / statement / owner APIs refused; no #101 on any screen) | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| #193 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| #200 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |

Screens are the built Tech App in Chromium at 390×844, each account's own session; every API answer on every screen was
2xx and no salon / owner API was called. "Own-data privacy" for the other four = their schedule lists only their own
appointments. The matrices are also in `pilot.json` → `numbers.large.m5.matrix200` / `loginMatrix`.

**Not covered / honest limits:** the native app shells (Capacitor) were not driven — the web Tech App was; the payroll
week's sales and time-clock facts are bulk fixtures (assertions all through the API); a single-machine run (API, DB and
load generator share the CPU).

## Result

The logged run's exact figures are in `TEST_REPORT.md` → "Oct 22 2026 — handoff run". The development runs on Oct 22,
each on a fresh database, went: **80/96 → 90/96 → 95/96**; the logged run: **95/96** first pass (the proof's own status check) → **96/96** after that one-line fix (`a42dd40f`) — every red was either a mistake in the new proof
script (fixed in the script) or a real product bug (fixed in the product, test-first, its own commit). The real bugs
the pilot found are listed at the end.

| Phase | Checks | What it proves |
|---|---|---|
| 0 boot | 1 | compiled API boots on PostgreSQL with the payment / Twilio stand-ins |
| 1 onboarding | 13 | public application → review → approve → onboarding case → tenant + owner → first sign-in → go-live (step-up) |
| 2 setup | 16 | zone, NJ tax, staff invited by the owner (manager invite needs step-up), store hours, menu + add-on, three technicians (invite → accept → skills → services → schedule → clock PIN), personal commission with the Super Admin's one-time code, the salon's own card gateway, Twilio not configured |
| 3 day opens | 11 | clock-in by PIN on the kiosk, Fair Turn recommend & confirm, kiosk walk-ins, online booking with a hold, AI receptionist booking, an appointment arrives, a two-technician visit |
| 4 service + checkout | 9 | accept → start → add-on → Service Done in the Tech App; discount (RBAC), tip, gift-card sale and partial, card on the salon's gateway (retry replays), the customer display, SMS receipt |
| 5 Tap to Pay | 3 | manager app claim + split cash / card on the loopback CommerceHub |
| 6 refund, inventory, loyalty | 3 | refund once (retry replays), commission reversed, recipe stock deduction at Service Done, loyalty once per paid tender |
| 7 end of day | 14 | sales = payments = payroll basis, tips by technician, Owner App = POS, Tech App = payroll, cash drawer, time clock closes, payroll approve (step-up) → export → paid → DB lock, a refund after the lock lands in the next period |
| 8 screens | 2 | Tech App earnings and Owner App / POS reports in Chromium show the same numbers |
| **10 handoff mandate** | **22** | below |
| 9 logs | 2 | no unexpected API error; no swallowed PostgreSQL error |

### Phase 10 — the mandate's scenarios, as run in the logged run (`final-run/21b-pilot-day-rerun.log`, salon `PLT889807`, numbers in `final-run/pilot.json`)

| Scenario (mandate) | What happened | Result |
|---|---|---|
| 24 technicians, 12 per page | 21 more hired on the POS (3 pedicure-only); tomorrow's day grid has 24 columns → 2 pages of 12 on the board | PASS |
| Find an Opening / Best Matches | availability for a Gel Manicure gives open times to the **21** technicians who do it and **0** to the 3 pedicure-only; the earliest (09:00) is the Best Match | PASS (fixed Oct 22: they used a fixed list / a fixed "Gel Manicure · 45 min" label and offered unskilled technicians) |
| A busy day | 110 appointments tomorrow; 2 pages of up to 100, 110 distinct; the board now follows the pages | PASS (fixed Oct 22: the board drew only the first 50) |
| New Booking variants | two simultaneous bookings of one technician at 4:00 PM → one booked, one **409 APPOINTMENT_CONFLICT**; Gel 45 + Nail Art 15 → 17:00–18:00 (60 min from the catalog); a pedicure-only technician refused for a manicure (400) | PASS |
| Fair Turn — on break | Lisa on break → not recommended, reason ON_BREAK | PASS |
| Fair Turn — skill ineligible | acrylic walk-in → Mary (not approved for acrylic) never offered | PASS (fixed Oct 22: the hard rule compared categories) |
| Fair Turn — customer request | the guest asked for Anna → Anna; others passed over, CUSTOMER_REQUEST | PASS |
| Fair Turn — appointment soon | Mary booked in 20 minutes → a pedicure walk-in is not given to her; reason names the appointment | PASS |
| Card — decline | gateway `C` → "declined" (recorded); the same card may be tried again (a decline is never replayed, by design) | PASS |
| Card — processor busy | gateway `B` → **503 CARD_PROCESSOR_UNAVAILABLE**, recorded *failed*, never a decline; a good card then pays | PASS |
| Card — unknown answer | → **409 PAYMENT_STATUS_UNKNOWN**, the attempt stays processing; another card is refused and never reaches the gateway; **Verify** asks the processor → approved → paid with exactly **one** approved payment | PASS (fixed Oct 22: a second card was charged — the guest paid twice) |
| Card — dropped connection | → 409 PAYMENT_STATUS_UNKNOWN (was a raw **500**); Verify finds no record yet → pending, nothing re-charged | PASS (fixed Oct 22) |
| Receipt → expense | scan (DEV MOCK) → the owner files $44.90 (submitted) → the same receipt again **409 RECEIPT_DUPLICATE** → approved → in the month's report ("All branches") | PASS (fixed Oct 22: a salon-wide expense could not be opened / approved / reported; "All branches" showed only the sign-in branch) |
| Receipt pipeline without its services | upload accepted and **quarantined** (no scanner / object store / Textract) — never shown as extracted; OCR settings save persists | PASS (fixed Oct 22: every upload was a 500; the settings save stored nothing) |
| No double pay | a second pay period over already-paid days → **409 PAYROLL_PERIOD_OVERLAP** | PASS (fixed Oct 22: it was created and paid the same tickets again) |
| Weekly paycheck 50 % / 50 % | three statements (Lisa $200, Mary $160, Anna $120 — Lisa's large bonus waits for the owner's decision); each plan **check 50 % / cash 50 %** to the cent: check $240.00, cash $240.00 of $480.00 | PASS |
| Manager submission → owner approval | the owner's approve before submit → **409 PAYROLL_PERIOD_NOT_READY**; the manager submits; the owner approves with a fresh step-up; 6 payouts | PASS (fixed Oct 22: an unsubmitted week could be finalized) |
| Check + cash, technician confirmation | 3 checks numbered and issued; a reused number **409 CHECK_NUMBER_IN_USE**; each cash half prepared from the safe (step-up), handed over and **confirmed by the technician in the Tech App** (a repeat replays; another technician cannot — 404) | PASS |
| Paid / unpaid | cash halves PAID $240.00; issued, not yet cleared checks UNPAID $240.00; paid + unpaid = payable $480.00 | PASS |
| Platform announcement | Super Admin publishes a maintenance notice (fresh step-up, start + end time) for salon A only → A's POS shows it, salon B's does not | PASS |
| Twilio per salon | each salon's own account set in Super Admin (token encrypted); A's text left on **A's account from A's number**, B's on B's — never crossed; the SMS ledger row records `sender_route = tenant_account` and the From | PASS (migration 678, Oct 22) |

## Real bugs the pilot found on Oct 22 (all fixed, each with a regression test)

| # | Severity | Bug | Fix commit |
|---|---|---|---|
| 1 | P0 | a second card was charged while the first attempt's answer was unknown — two approved payments on one ticket | `47d13d8d` |
| 2 | P0 | a pay period over already-paid days paid the same tickets again | `ae5bb3d4` |
| 3 | P1 | a dropped processor connection answered a raw 500 (POS card, split); skip-the-line recorded unknown answers as declines; wallet top-up called them declined | `05ec3522` |
| 4 | P1 | every receipt upload from the POS and the Owner App answered 500 | `e0e28816` |
| 5 | P1 | Fair Turn and walk-in assignment checked the service category, not the service — an unapproved technician was recommended | `0a67b2af` |
| 6 | P1 | an owner with branch grants could not open / approve / report a salon-wide expense; the Owner App's "All branches" finance view showed only the sign-in branch | `9f65ce62` |
| 7 | P2 | an unsubmitted (empty) paycheck week could be finalized | `6b128aa5` |
| 8 | P2 | New Booking start times were a fixed list; Best Matches used a fixed label; the board drew 50 appointments; open times ignored add-ons | `eb1f9167`, `00e3f774` |
| 9 | P2 | the receipt-OCR settings save stored nothing | `4556cb75` |
| 10 | P3 | the SMS ledger could not say which salon's Twilio account / number sent a text | `f5d9001d` |

What the pilot does **not** prove (external, `NEXT_STEPS.md`): a real CardPointe MID, real Twilio delivery (A2P), Textract /
S3 / ClamAV, Tap to Pay on a real iPhone, native app builds, hosting.
