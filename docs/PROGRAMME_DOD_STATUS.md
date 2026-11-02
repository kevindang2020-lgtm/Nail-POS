# Programme Definition of Done — final status (BUILD_PLAN Phase 15, Oct 10 2026)

The whole programme (`BUILD_PLAN_2026-10-06.md`, Phases 1–15) measured line by line: the thirteen constitutions and the
seven module specs. Every line is in one of four classes:

| Class | Meaning |
|---|---|
| **DONE** | the evidence is in the tree (code, migration, test, gate) — for the four scripted constitutions the script checks it on every run |
| **DECIDED** | the mechanism exists and a recorded decision says the rest is not to be built; the decision and the default taken are named |
| **HOSTING** | the code side is done; the remaining step is a hosting / account action only Kevin can take — the row id is in `docs/HOSTING_ACTIONS_FOR_KEVIN.md` |
| **OPEN** | genuinely not done in code; listed with the next step |

**Reproduce the scripted numbers:** `cd apps/api && node scripts/programme-dod.mjs` (runs the four DoD scripts unmodified and
prints the per-constitution totals; exit 1 if any line is PARTIAL / NOT DONE or any script reports a BROKEN CHECK; the AI
script runs the `modules/ai` suite, ~5–9 min — `--skip-ai` skips it). The other constitutions and the specs have no single
script: their lines are the Definition-of-Done tables of the phase that closed them (`BUILD_PHASES_REPORT.md`), held by
gates on every push (`node tooling/ci/run-gates.mjs`). Every file / test / gate those tables cite was checked to exist on
Oct 10 (an automated pass over `BUILD_PHASES_REPORT.md`; the only names not found as files are a JSON field
(`/health.schemaVersion`), a served route (`/assetlinks.json`) and `google-services.json`, which by design is never committed).

Kevin's consolidated action list (before the first paying salon / later) is §7 below; every hosting row, with the exact
action and how to verify it, is in `docs/HOSTING_ACTIONS_FOR_KEVIN.md` (A1–E3).

## 1. Summary

| # | Constitution / spec | Source of the lines | Lines | DONE | DECIDED | HOSTING | OPEN |
|---|---|---|---|---|---|---|---|
| C1 | Database (§111) | Phase 10 DoD table + Phase 15 unique-index review | 32 rows | 24 | 4 | 4 | 0 |
| C2 | Permissions (§153) | Phase 9 DoD table | 24 rows | 19 | 5 | 0 | 0 |
| C3 | Authentication (§181) | Authentication constitution (Oct 3–4) | complete | all | — | — | 0 |
| C4 | Infrastructure (§201) | Phase 11 DoD table | 16 rows | 15 | 0 | 1 (+ parts of 7 rows) | 0 |
| C5 | API (§231) | `API_DEFINITION_OF_DONE.md` | 57 | 55 | 1 | 1 | 0 |
| C6 | Mobile (§303) | Phase 13 DoD | grouped | all code lines | 3 | Kevin's mobile list | 0 |
| C7 | Super Admin & Control Plane (§303) | `control-plane-dod-check.mjs` | 73 | 71 | 2 | 0 | 0 |
| C8 | Events (§227) | `check:event-producers` gate (Phase 15) | 155 registry events | 155 produced | 3 retired | 0 | 0 |
| C9 | Realtime (§255) | `check:realtime-contract` gate | 102 events | 102 versioned + produced | 0 | 0 | 0 |
| C10 | AI Platform (§304) | `audit-ai-dod.mjs` | 72 | 71 | 0 | 1 | 0 |
| C11 | Observability (§396) | `observability-dod-check.mjs` | 76 | 70 | 0 | 6 | 0 |
| C12 | Security (§324) | `security-dod-check.mjs` | 82 | 71 | 0 | 11 | 0 |
| C13 | Repository & Monorepo (§388) | `REPOSITORY_ARCHITECTURE_AUDIT.md` §9 (Phase 15) | 7 open lines | 6 | 1 | 0 | 0 |
| S1 | Dual-screen display | `DUAL_SCREEN_FINAL_REPORT.md` | complete | all | — | — | 0 |
| S2 | AI queue assignment | Phase 6 completion list | 27 rows | 20 | 5 | 0 | 2 |
| S3 | AI scheduling optimizer | Phase 7 completion list | 17 rows | 14 | 2 | 0 (load → C5) | 1 |
| S4 | Tenant safety community | Phase 8 completion list | 11 rows | 7 | 3 | 1 | 0 |
| S5 | Booking phone verification | Phase 4 completion list | 35 rows | 27 | 8 | 0 | 0 |
| S6 | Customer phone management | Phase 3 DoD (spec lines 1708–1802) | 43 | 41 | 2 | 0 | 0 |
| S7 | Deals engine | Phase 5 completion list | 33 rows | 25 | 8 | 0 | 0 |

"rows" = a phase table row, which often groups several spec lines that share one piece of evidence. A row marked
"DONE / Kevin" in a phase table is counted HOSTING when Kevin's remaining step is a hosting action and DECIDED when it is a
product / data decision with a default in force; "DONE / decided" is counted DECIDED; "DONE / partial" is classified below
on its own merits. For C8 the DECIDED column counts the three events retired by decision.

**Scripted total (C7 + C10 + C11 + C12): 303 lines — 283 DONE · 2 DECIDED · 18 HOSTING · 0 PARTIAL · 0 NOT DONE.**

## 2. The four scripted constitutions — every non-DONE line

### C7 Super Admin & Control Plane — 71 DONE · 2 DECIDED (`control-plane-dod-check.mjs`)
Phase 15 gave the script a DECIDED status (the decision's record is part of the line's evidence — remove the record and
the line is NOT DONE; `src/common/dod-predicates.vitest.spec.ts`). Before: 2 PARTIAL.
| Line | Class | Decision / default |
|---|---|---|
| Platform API separated under /platform | DECIDED | D1 (`CONTROL_PLANE_AUDIT.md` §4): `/api/v1/platform/*` is an alias of `/super-admin/*`; moving ~1,007 routes breaks seven frontends, the realm guard and every test for no security gain. Kevin: none. |
| Super Admin frontend modularized | DECIDED | D8 (`CONTROL_PLANE_AUDIT.md` §9, recorded Phase 15): one admin app (167 screens) with permission-aware navigation; every route keyed + default deny on the server. Kevin: none unless you want it split. |

### C10 AI Platform — 71 DONE · 1 HOSTING (`audit-ai-dod.mjs`)
Phase 15 fixed the "Tests pass" predicate: it read vitest's text output and failed on ANY skipped test, so the six
real-Postgres race files in `modules/ai` (14 tests that skip without `PG_RACE_URL`; they run in the race lane,
`npm run ci:test:race`, which itself fails on a skip) kept a green suite at NOT DONE. It now judges vitest's JSON report
per file (`apps/api/scripts/ai-dod-tests-predicate.mjs`, test `src/common/ai-dod-tests-predicate.vitest.spec.ts`, 11 cases,
5 mutations killed): skips are allowed only in `*.postgres-race.vitest.spec.ts` files of a package the race lane runs; a
skip anywhere else, a failure, a file that fails to load or an empty run still fails the line. Measured Oct 10:
**1,890 passed; 14 race tests in 6 files run in the race lane**.
| Line | Class | Kevin action |
|---|---|---|
| Load tests pass | HOSTING | **E1** — decision-path capacity is measured (`measure-ai-capacity.mjs`, 11.8 µs/request); a concurrency run against real providers needs staging + real keys with spend caps. (Before: PARTIAL with the same evidence; the line now also requires the E1 row to exist.) |

### C11 Observability — 70 DONE · 6 HOSTING (`observability-dod-check.mjs`)
| Line | Class | Kevin action |
|---|---|---|
| Distributed tracing implemented | HOSTING | C4 — OTLP endpoint + headers (optional: in-platform trace search works) |
| Synthetic monitoring implemented | HOSTING | D3 test salon, D4 CardPointe UAT + Twilio test credentials |
| Alert routing to a human (§262–265) | HOSTING | D5 on-call contacts |
| SLOs defined where measured | HOSTING | none but production traffic (28 days / 1,000 requests, then automatic) |
| Backup monitoring implemented | HOSTING | D6 backup cron + `BACKUP_REPORTS_REQUIRED=1` |
| Load tests pass | HOSTING | C5 staging load test |

### C12 Security — 71 DONE · 11 HOSTING (`security-dod-check.mjs`)
| Line | Class | Kevin action |
|---|---|---|
| TLS enforced | HOSTING | A7 |
| Database private | HOSTING | B4 (+ E2: rotate the external DB password, close 5432) |
| Redis private | HOSTING | B1 |
| WAF implemented | HOSTING | A8 |
| Workers least privileged | HOSTING | D1 |
| Malware scanning works | HOSTING | D2 (ClamAV) |
| Backup encrypted | HOSTING | D9 |
| Backup access restricted | HOSTING | D9 |
| PITR enabled | HOSTING | A2 |
| Restore test completed | HOSTING | A3 |
| Penetration tests completed where possible | HOSTING | D7 (and D8 real devices) |
Standing security items no line covers: **E2** (external DB login in git history) and **E3** (three committed Android upload
keystores) — HOSTING_ACTIONS §E, before the first paying salon.

## 3. The other constitutions — every non-DONE line

### C1 Database (§111, Phase 10)
| Line | Class | Decision / Kevin action |
|---|---|---|
| tenant isolation enforced | HOSTING | RLS on 10 core tables proven live, off by default: `DB_TENANT_RLS=1` in staging, then production |
| duplicate models merged | DECIDED | `audit_logs` + `audit_events` both stay (both append-only); the two customer roots are linked by phone — which root wins is Kevin's (default: linked, not merged) |
| unique constraints correctly scoped | DONE (Phase 15) | all 96 non-PK uniques on tenant tables without `tenant_id` reviewed one by one (`docs/UNIQUE_INDEX_TENANT_REVIEW.md`); the one that was wrong (`payment_gateway_events` processed-event claim: salon B's event dropped as a duplicate of salon A's) is now `(tenant_id, …)` (migrations 567 / 568), the fraud incident key made per salon; 95 remain, each classified with its reason; gate `check:unique-tenant-review` fails on a new unreviewed one |
| timestamps timezone-safe | DECIDED | timestamptz everywhere; appointment `HH:MM` text CHECKed, not moved to timestamptz (wide change) |
| sensitive fields protected | DECIDED | phone-column encryption is Kevin's decision (default: not encrypted; webhook plaintext dropped) |
| backup works / PITR / restore tested | HOSTING | A1, A2, A3 |
| connection pooling configured | HOSTING | per-role pools in code; PgBouncer (B4/B5) |
| retention; soft-delete policy | DECIDED | executor + policy built; purging soft-deleted customers is Kevin's decision (default: not purged) |
| load tests pass | HOSTING | sandbox run, 0 errors; C5 on target infrastructure |
Evidence verified present Oct 10: `apps/api/db/ownership/registry.generated.json`, `DB_ERD_AND_DOMAINS.md`,
`docs/DATA_RETENTION_AND_DELETION_POLICY.md`, `apps/api/db/retention-policy.json`, `docs/DB_EXPLAIN_PASS_2026-10-08.md`,
`docs/DB_SCHEMA_MEASUREMENTS_2026-10-08.md`; gates `db-ownership`, `actor-stamp`, `audit-writers`, `state-transitions`.

### C2 Permissions (§153, Phase 9)
| Line | Class | Decision |
|---|---|---|
| scopes / ASSIGNED | DECIDED | ASSIGNED stays a per-domain rule enforced with the `own-record` policy |
| field-level | DECIDED | field rules stay per domain (customer export, `ai_inventory.view_cost`) |
| entitlements | DECIDED | separate from permissions (`@RequireFeature`, Phase 12) |
| frontend / backend / mobile controls | DECIDED (Phase 15 classification) | backend + POS nav by permission DONE; the mobile apps receive the session's permissions but are role-specific apps (owner, technician, manager pay, customer) and do not hide UI per key — the server refuses every unkeyed or ungranted call (default deny, 0 unkeyed routes). Default: no per-key mobile UI gating. |
| Kevin's open decisions | DECIDED (defaults) | (1) branch confinement; (2) one template per person; (3) per-salon thresholds = today's env values; (4) payment-device approval owner-only; (5) managers keep `inventory.cost.view` |
Evidence: `docs/PERMISSIONS.md`; gates `perms`, `permission-docs`, `role-checks`; `live-phase9-permissions.mjs`.

### C4 Infrastructure (§201, Phase 11)
Every row is DONE in code; the hosting halves are HOSTING_ACTIONS A1–A14, B1–B5, C1–C6 (the dev/staging/production,
TLS, WAF, load balancer, replicas, Redis HA, backups, PITR, private storage, malware scanning, cost alerts and uptime row
is the one wholly-HOSTING row). Evidence: `INFRASTRUCTURE_AUDIT.md`, `DISASTER_RECOVERY.md`, `RUNBOOKS.md`,
`docs/DEPENDENCY_INVENTORY.md`, `docs/ARCHITECTURE_DIAGRAMS.md`, `apps/api/scripts/drills/` (four drills run).

### C5 API (§231, Phase 12)
| # | Line | Class | Note |
|---|---|---|---|
| 14 | Standard success envelope | DECIDED | by ruling (recorded in `API_DEFINITION_OF_DONE.md`) |
| 53 | Load tests pass | HOSTING | C5 — the run on target infrastructure (the doc now says HOSTING too) |

### C6 Mobile (§303, Phase 13)
DONE in code: every line listed in the Phase 13 DoD. DECIDED: feature-folder restructure not done; no crash vendor;
attestation / jailbreak detection / certificate pinning not built (optional in the constitution). HOSTING / Kevin: iOS +
Android builds and signing, Firebase / APNs, link-verification env, one `mobile.yml` run, real devices (D8), store URLs —
`docs/mobile/MOBILE_RELEASE_SETUP.md`. Evidence: `MOBILE_ARCHITECTURE_AUDIT.md`, `packages/mobile-sdk/src/{network,push,config}`,
`.github/workflows/mobile.yml`, gate `tooling/mobile/check-native-config.mjs`.

### C8 Events / C9 Realtime / C13 Repository (Phase 15 agents A, B)
Re-checked Oct 10 after the Phase 15 agents finished:
- **C8 Events — COMPLETE.** `node apps/api/scripts/audit-event-producers.mjs` (gate `event-producers`, new in Phase 15): "155
  events · 155 produced through the outbox · 0 reserved · 3 retired — every registry event has an outbox producer, every
  subscription names a registry event, no retired name is referenced". Retired (plan default, Kevin's choice taken):
  `visit.started`, `checkout.started`, `payment.authorized` — nothing references them outside the retired list. Produced:
  `customer.merged` (`modules/customers/src/customers/customers.kysely.repository.ts` merge, same transaction, ids only),
  `visit.completed` (`modules/checkout/src/checkout/visit-completed.ts`, at ticket → paid).
- **C9 Realtime — COMPLETE.** `check:realtime-contract`: 102 events, 102 versioned, 99 routed, 7 channels; "every event
  versioned, routed and produced"; a NO PRODUCER line is now a failure; `settings_updated` is produced from the tenant
  settings save (`notifySettingsChanged`, the audit now reads package helpers).
- **C13 Repository — COMPLETE except one decision.** `REPOSITORY_ARCHITECTURE_AUDIT.md` §9: the two nested lockfiles,
  `apps/go-check-in-admin`, `apps/booking-html`, `apps/booking-schedule-html`, `_MERGE_ARTIFACTS/`, `HANDOFF/` removed under
  the zero-importer rule (replacements: admin-web Check-In Devices, customer-web Book, pos-web Booking; recover from
  `62a1875d`); `architecture:test` now fails if any comes back. DECIDED: `packageManager` stays unpinned (default; Kevin may pin).

## 4. The seven module specs — every non-DONE line
The specs' own completion lists for S2–S5 and S7 are not in the workspace; each phase checked the Oct 6 audit's table
(`docs/audit-2026-10-06/spec-*.md`) instead — Kevin can send the spec texts for a line-by-line check (Kevin's list, later).

| Spec | Line | Class | Decision / next step |
|---|---|---|---|
| S2 queue assignment | schema: status / skills / congestion tables; per-technician overlap | DECIDED | signals computed from existing tables; capacity is the engine's hard rule |
| S2 | preference levels, language, accessibility | DECIDED | no data exists for them (product decision) |
| S2 | late arrival / grace | DECIDED (Phase 15 classification) | lateness is computed in the branch zone and alerted; it does not change ranking. Default: alert only. |
| S2 | multi-service / groups / simulation | DONE (multi-service + groups, Oct 12 2026) · DECIDED (simulation) | **Multi-technician routing built:** the one engine ranks each service line (`lineScope`) and a pure composer (`ai-queue-assignment-plan.ts`) builds the visit plan — parallel lines (max 2 technicians on one guest at once, 3 per visit), add-ons after their parent, a single technician preferred when they finish within 15 min of the split, each line checked against its technician's shift end at the line's planned window (else staff review); parties planned member by member ("together" never shares a technician); one write path `QueueService.assignPlan` (all lines or none, row locks in id order, version + expected technician per line, idempotency) with event `queue.service_lines_assigned`; each line technician serves their own part (start / complete), the visit completes once when the last part completes; ticket service lines carry their own technician, so commission and tips follow the line (was: every line paid to the lead); engine capacity counts line technicians. Split visits are auto-assignable under every switch; parties never. Migration 569. Proofs: `live-multitech-queue.mjs` (3-service visit over 2 technicians, both complete, $13 tip split $6.50/$6.50; party of 3), race test (6), pgtests. **Simulation** (what-if) — DECIDED not built: the plan preview IS the before-you-assign view. Open: appointment protection for a later "after" line is judged from now (shift end is per line). |
| S2 | platform feature key `ai_queue_assignment` | DECIDED | the gate stays the AI package entitlement |
| S2 | tests: browser E2E of the new screens | OPEN | screens tested in jsdom against mocked responses; the live proof (`live-phase6-queue.mjs`) drives the same API. Next: a Playwright pass like Phase 8's |
| S3 scheduling optimizer | stations / equipment | DECIDED | dormant: `pos_stations` are checkout terminals; no equipment data exists |
| S3 | busy-hour forecast for front desk | DECIDED | read with the caller's own permissions ("forecast unavailable" without `reports.view`); no no-show model |
| S3 | AI receptionist + Reception Copilot holds | DONE (Round 2 H, Oct 12 2026) | **Permission decision:** placing / releasing a hold is a WRITE behind the booking-desk key `pos.booking.create` (no new key); the AI receptionist's principal has it through its voice-booking authorization (`AI_RECEPTIONIST_PERMISSIONS` — it already books, so it may hold). The optimizer's `findOptions({hold})` / `releaseHold` accept `pos.booking.create` or `ai_scheduling.generate`. Holds reuse the hold model (`booking_holds`, `BookingHoldService`, no-overlap constraint, the expiry sweep) and the salon's `hold_seconds`, through `SlotHoldService` (modules/booking `booking-slot-hold.ts`). **Receptionist:** one booking session per call (`voiceCallSession`); `get_availability {hold:true}` holds the best option, `hold_slot` the exact time, `release_hold` / the call's outcome (call end) release it, `create_appointment` converts it (write tools only). **Copilot:** `POST copilot/hold`, `copilot/hold/release` (`pos.booking.create`), `copilot/availability {hold:true}` (403 without the write key); the hold token is sealed for the salon AND the staff member; the copilot booking action presents it and the hold converts. **Engine:** `BookingService` refuses a time another session holds (a first-available hold blocks every technician), first-available skips held technicians, `availability()` does not offer held slots, and the booking's own hold is converted. **POS:** "Hold this time" on a recommended slot with a countdown, Release, and "Book this time" into the booking card. Tests: booking-holds pgtest, voice-holds (unit + pgtest), copilot-holds (controller + pgtest), POSReceptionCopilotHold screen test; 19 mutations killed **Round 3 H2 (Oct 12 2026) — the four gaps closed:** (1) the hold check is re-read INSIDE the booking's locked transaction (create + reschedule, under the branch-day hold lock `bookingHoldLockKey`, after the technician+day lock), and every hold placement (`SlotHoldService.place`, the optimizer's hold port → `acquireLocked`) takes the same lock and re-checks the technician's appointments — a hold and a booking of one slot racing → exactly one wins (real-Postgres race test); (2) reschedule (staff engine, voice `reschedule_appointment` under the call's session, copilot reschedule with its hold token) is blocked by another session's live hold and uses up the mover's own; (3) `CustomerBookingService.availability` (customer app, voice fallback) excludes other sessions' holds and keeps the asking session's own (`bookingSessionId`, server-side only); (4) a lost hold conversion is logged (warn) and audited `pos_booking_hold_conversion_lost`, the hold released, the appointment stands. Tests: booking-holds-locked pgtest, booking-hold-vs-booking postgres-race, customer-booking-availability-holds pgtest, ai-scheduling.hold-port pgtest, voice/copilot additions; 16 mutations (mut-H2) |
| S3 | tests: browser E2E, load | OPEN (E2E) / HOSTING (load, C5) | as S2 |
| S4 safety community | AI writing help | DECIDED | honest 503 `ai_not_configured` until a community task + prompt is registered |
| S4 | technicians create incidents | DECIDED | never (the core's safety floor) |
| S4 | automatic image redaction | DECIDED | a moderator review step (clean / redacted / reject); no automatic face / plate blurring |
| S4 | load test; real S3 upload | HOSTING | C5; A10 + `EVIDENCE_S3_BUCKET` (routes answer 503 until set) |
| S5 booking verification | 8 rows DONE / decided or decided | DECIDED | correlation id via the outbox; trust window live, not stored; no new attempt / rate tables; platform security floor not tenant-tunable; group / deposit / high-value switches hidden (no booking path has those inputs); owner manages it in the POS; the kiosk makes no bookings |
| S5 | real Twilio Verify | HOSTING | first real check at the pilot salon (Kevin's list) |
| S6 phone management | Twilio verification; central identity | DECIDED | the salon's own Verify credentials (proved against a loopback Verify — first real check at the pilot salon); the sign-in credential moves only through the customer's own reauthenticated step |
| S7 deals | separate rule / target / schedule tables; clone; threshold approvals; conflict detection; AI deal builder; tenant cache; deal types; tax / tip / deposit | DECIDED | as recorded in the Phase 5 completion list; BOGO / buy-X-get-Y / bundles-as-deals / gift-with-purchase not built; a two-person rule for salon deals is Kevin's product decision (default: none) |

Pre-existing, outside every DoD line but found in the phase reports and still open: a booking through the public link or
the AI receptionist **without a technician** ("first available") fails in the staff engine (`technician_id` NOT NULL —
Phase 4 honest scope). **FIXED Oct 10 2026 (Phase 15 G)** — see §6 item 4.

## 5. The Oct 6 audit checklists (`docs/audit-2026-10-06/`) — where each open line closed

| Checklist | Open on Oct 6 | Closed by | Still not DONE |
|---|---|---|---|
| `constitution-01-database.md` | 23 PARTIAL · 4 MISSING · 2 Kevin (§111) | Phase 1 (450 trigger, RLS cast), Phase 10 (build order 1–12, §111 table) | §3 C1 rows above |
| `constitution-02-permissions.md` | ~28 rows | Phase 1 (self-escalation), Phase 9 (build order 1–9, §153 table) | §3 C2 rows above |
| `constitution-04-infrastructure.md` | ~37 rows | Phases 1–2 (scheduler, queue, breaker, crashes), Phase 11 (§201 table) | HOSTING rows only |
| `constitution-06-mobile.md` | ~33 rows | Phase 1 (mobile bugs), Phase 13 (§303) | §3 C6 above |
| `dod-constitution-07-control-plane.txt` | 2 PARTIAL | Phase 15 (DECIDED vocabulary, D1 + D8) | 0 PARTIAL |
| `dod-constitution-10-ai-platform.txt` | 1 PARTIAL · 1 NOT DONE | Phase 15 (predicate fix, E1) | 1 HOSTING |
| `dod-constitution-11-observability.txt` | 26 open | Phase 14 | 6 HOSTING |
| `dod-constitution-12-security.txt` | open lines | Phase 14 | 11 HOSTING |
| `spec-customer-phone-management.md` | E1–E15 | Phase 3 | 0 (2 DECIDED) |
| `spec-booking-phone-verification.md` | 13 bugs + table | Phase 4 | 0 (DECIDED rows) |
| `spec-deals-engine.md` | 21 bugs + table | Phase 5 | 0 (DECIDED rows) |
| `spec-ai-queue-assignment.md` | 16 bugs + table | Phase 6 | 2 OPEN (§4) |
| `spec-ai-scheduling-optimizer.md` | bugs + table | Phase 7 | 2 OPEN (§4) |
| `spec-tenant-safety-community.md` | 13 bugs + table | Phase 8 | 0 OPEN (HOSTING / DECIDED) |

## 6. OPEN — the complete list
Genuinely not done in code (none is a Definition-of-Done line of a scripted constitution; none blocks a pilot salon):
1. ~~**S3** — AI receptionist / Reception Copilot controllers do not pass `hold` to `findOptions`~~ — **DONE Oct 12 2026
   (Round 2 H)**: holds are a write behind `pos.booking.create` (see the S3 row above).
2. ~~**S2** — serving-time multi-technician routing for multi-service / group visits~~ — **DONE Oct 12 2026** (see the S2 row). What-if simulation: DECIDED not built (the plan preview before Accept). Small remainder: a later "after" line's next-appointment protection is judged from now.
3. **S2, S3** — browser (Playwright) runs of the queue-assignment and scheduling-optimizer screens against the live API
   (today: jsdom + the live API proofs).
4. ~~"First available" booking through the public link or the AI receptionist failed~~ — **FIXED Oct 10 2026 (Phase 15 G)**:
   `BookingService` picks the first free, skilled technician by the customer app's rule (tests: booking-first-available,
   ai-booking-first-available, voice-first-available pgtests). **Race closed Oct 12 2026 (Round 2 H):** concurrent
   first-available bookings used to all pick the same first free technician and the losers got a 409 while others were
   free; a lost locked re-check now retries with the next qualifying technician (each attempt under the same
   technician+day lock, bounded by `FIRST_AVAILABLE_MAX_ATTEMPTS` and by the qualifying technicians) and answers "taken"
   only when nobody is free. Real-Postgres race: N concurrent with N free → N bookings on N technicians; N+1 → exactly one
   409 (`booking-first-available.postgres-race`).
5. ~~In-process ticket-status cache~~ — **FIXED Oct 12 2026 (Round 2 C)**: the per-process status and discount maps are gone;
   ticket board state is a stored column (`tickets.checkout_status`, migration 572) behind a state machine, every guard is a
   conditional UPDATE on the row (two-replica pgtest + real-Postgres race). Behaviour change: a payment voided / refunded
   below the total now moves `tickets.status` back from 'paid' in the database (before, only one process's memory changed).
6. **POS auto-lock** (Kevin, Oct 12): ON by default at 60 minutes, enforced by the server (423 `SESSION_LOCKED` on every POS
   staff session call except unlock / me / lock-status / lock / logout; PIN unlock, 5 wrong PINs end the session), and a
   lock older than 8 hours revokes the session (full sign-in) — DONE (migration 570, `live-pos-autolock.mjs` 25/25).
Not in this list on purpose: everything HOSTING (§7) and every recorded decision (DECIDED rows above).

## 7. Kevin's list — consolidated and de-duplicated

Sources merged: `docs/HOSTING_ACTIONS_FOR_KEVIN.md` (A1–A14, B1–B5, C1–C6, D1–D9, E1–E3), `BUILD_PHASES_REPORT.md`
Phases 3–14 (Kevin / decided / honest-scope lines), the four DoD scripts (HOSTING lines), `CONSTITUTIONS_STATUS_2026-10-08.md`
"What only Kevin can do", `docs/mobile/MOBILE_RELEASE_SETUP.md`, `MOBILE_ARCHITECTURE_AUDIT.md` §7. The row ids are the ones in
HOSTING_ACTIONS (exact action + how to verify there). No credential value appears anywhere in this list or in the repo —
every value goes into Railway variables / CI secrets / your password manager only.

### 7.1 Before the first paying salon

#### Security (do these first — no code change can close them)
1. **E2** Rotate the external database password and close port 5432 to the internet (the old login is in git history).
2. **E3** Re-key the three committed Android upload keystores via Play App Signing (new upload keys made outside the
   repo), then delete the six files (`*.jks` + `key.properties`) and purge them from history — one history rewrite together with E2.
3. **A13** GitHub secret scanning + push protection ON; rotate any credential ever committed or pasted in a chat.
4. **B4** Postgres private: `DATABASE_URL` on the `*.railway.internal` host, public TCP proxy OFF (also C12 "Database private").
5. **D1** Least-privilege database logins: run `apps/api/scripts/db-provision-roles.mjs` (dry run, then real) as the owner;
   set `MIGRATE_DATABASE_URL` (owner), `DATABASE_URL` (`aps_api`), `PG_WORKER_DATABASE_URL` (`aps_worker`).
6. **A7** TLS: custom domains HTTPS-only (Cloudflare "Full (strict)" if proxied). **A8** WAF: Cloudflare proxy + managed rules.
7. **D2** ClamAV service (`CLAMAV_HOST`, later `CLAMAV_REQUIRED=1`); **A11** GuardDuty malware protection on the evidence bucket.
8. **D7** Independent human penetration test of staging (web, API, four apps).
9. Confirm the Clover signature-return behaviour on a real device (open since Oct 6).

#### Data safety
10. **A1** Railway scheduled backups; **A2** PITR on the plan (or accept RPO 24 h in writing); **A3** restore a REAL backup into
    a scratch DB with `restore-verify` (quarterly after that); **A4** copy every encryption key out of Railway into a sealed
    offline record; **A5** weekly off-site encrypted dump; **D6** schedule `deploy/backup/backup-and-report.sh` then
    `BACKUP_REPORTS_REQUIRED=1`; **D9** confirm backup encryption at rest, Railway members = named people with 2FA.
11. On the production database after the first deploy of this tree: run once `db-backfill-summaries.mjs`,
    `db-backfill-customer-identity.mjs`, and `seal-bank-webhook-secrets.mjs` if migration 542 deferred (Phase 10).

#### Environments, storage, providers
12. **A9** staging environment (separate data, separate provider keys). **A10** media + evidence buckets private,
    encrypted, versioned; `MEDIA_STORE=s3`, `EVIDENCE_S3_BUCKET` set (the safety-community evidence upload answers 503
    until then). **A12** apply `deploy/storage-lifecycle.json`.
13. Provider values on Railway: `TWILIO_*`, `SENDGRID_API_KEY`, the encryption keys; re-save each salon's provider
    credentials through the app after keys are set.
14. First real Twilio Verify check at the pilot salon (phone change + booking verification were proved against a loopback
    Verify only — Phases 3–4).

#### Running it
15. **A6** external uptime monitor on `/health/ready` + alert variables; **D5** on-call contacts in Super Admin, plus
    `PUBLIC_API_BASE_URL` and `ALERT_ACK_SECRET`.
16. **A14** cost alerts (Railway, AWS, Twilio, AI providers); enter AI / SMS unit prices in Super Admin (cost views).

#### Mobile (only if the apps ship at launch)
17. iOS: Apple Developer account + a Mac — App IDs with Push + Associated Domains, APNs `.p8` (`APNS_*`), `APPLE_TEAM_ID`,
    entitlements, Tap to Pay plugin. Android: Play Console, new upload keys (E3), `google-services.json` ×4 on the build
    machine, `FCM_SERVICE_ACCOUNT_JSON`, `ANDROID_CERT_SHA256_*`, `APP_LINK_WEB_*`. One run of `.github/workflows/mobile.yml`.
18. **D8** real-device checks (sign-in, Face ID then `FACE_ID_ENABLED=1`, offline queue, push, links, camera, Tap to Pay);
    store URLs + minimum versions in Super Admin.

### 7.2 Later (scale, observability, decisions that already have a default)

#### Scale / hosting
19. **B1** Redis (`REDIS_URL`, `CACHE_STORE=redis`); **B2** replicas ≥ 2 with `API_REPLICAS`; **B3** the worker service
    (`railway.worker.json`, runbook `worker-split`); **B5** shared variables, least privilege per service; PgBouncer.
20. **C1** CD environment gate (off by default) + pin actions; **C2** Railway config is the IaC of record (decision — no action).
21. **C3** `/metrics` scraper with `METRICS_TOKEN`; **C4** OTLP backend (`OTEL_EXPORTER_OTLP_ENDPOINT` / `_HEADERS`) — optional,
    in-platform trace search already works.
22. **C5** staging load test at 50 clients on the production plan (closes C4 / C5 #53 / C10 / C11 load lines); **E1** AI
    provider concurrency test on staging with real keys and spend caps.
23. **D3** designate a synthetic test salon; **D4** CardPointe UAT + Twilio test credentials for the sandbox probes.
24. **C6** the SPOF table in `DISASTER_RECOVERY.md` §5 is closed by A2/A4/A5/A6/B1/B2.
25. SLO validation needs nothing but production traffic (28 days / 1,000 requests by default).

#### Switches to flip after a trial
26. `DB_TENANT_RLS=1` — staging trial first, then production (RLS on 10 core tables proven live, off by default).
27. `FEATURE_ENTITLEMENT_ENFORCEMENT=enforce` — after reviewing `apps/api/scripts/feature-gate-preview.mjs` on production data.
28. Drop the frozen legacy deal tables one release after production shows no writer (Phase 5).

#### Product / data decisions (a default is in force; act only if you disagree)
29. Phone-column encryption (default: not encrypted); which customer identity root wins (default: linked by phone, not
    merged); cross-salon staff; purging soft-deleted customers (default: not purged).
30. Permissions (Phase 9 defaults): staff confined by branch as built; one role template per person; per-salon approval
    thresholds = today's env values; payment-device approval owner-only; managers keep `inventory.cost.view`.
31. Events (Phase 15 default taken): `visit.started`, `checkout.started`, `payment.authorized` retired; `settings_updated`
    originates from the tenant settings save.
32. Deals: a two-person approval rule for salon deals (default: none — `marketing.manage` holders create and approve);
    BOGO / buy-X-get-Y / bundles-as-deals / gift-with-purchase not built.
33. Queue assignment: late arrival is alerted but does not change ranking; preference levels / language / accessibility
    matching not built (no data for them).
34. Mobile: feature-folder restructure (not done), crash vendor (none), one bundle-id prefix, whether Manager Pay stays a
    fourth app.
35. Control plane: `/platform/*` stays an alias of `/super-admin/*` (D1); the admin app stays one app (D8).
36. Partitioning: decide from real row counts once production has them.
37. The original spec checklists for booking verification (50 items), deals (71), queue assignment (~60), scheduling
    optimizer (~70) and safety community (34) are not in the workspace — the phases checked against the Oct 6 audits instead.
    If you have the spec texts, send them and they will be checked line by line.
38. Repository: `packageManager` stays unpinned in the root `package.json` (default; pin only if a host needs it).
