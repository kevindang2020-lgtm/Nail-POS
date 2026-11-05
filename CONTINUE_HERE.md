# CONTINUE_HERE.md — where the work stopped and what to do next (Oct 26 2026)

Hand this file to the next session first. **Tree:** branch `merge-github-main`, HEAD `47c4044b` (+ documentation
commits). The build queue is `NEXT_STEPS.md` §1, and the section-by-section truth is `docs/mandates/status/*.md`.
The narrative of what was done is in `CHANGELOG_HANDOFF.md` (M6 / M5 / M4 / Oct 26 sections).

## Standing rules (Kevin's — keep them)

- **Never push to GitHub.** Commit locally only, staging explicit paths: `git add -- <paths>` then
  `git -c user.name=Claude -c user.email=noreply@anthropic.com commit …`. Other agents may be editing the same checkout,
  so never use `git add -A`.
- **K-12 security steps are owned by Kevin's developer.** They go in this order:
  1. Rebuild the machine.
  2. Rotate credentials.
  3. Revoke the Firebase key.
  4. Create new Play upload keys.
  5. Change the DB password and close port 5432.
  6. Only then push the rewritten history.
- **Secrets:** never paste a password or key into chat or into these notes. Use env var NAMES only.
- **No print features.** Kevin re-confirmed this on Oct 26 2026 (`PRINT_FEATURES_REMOVED.md`, `check:no-print`). The Print Schedule built for 200-tech §54 stays backed out; it is parked in commit `02906764` only for the record.
- **Accepted tech-queue offers stay `ready_to_start`.** Kevin decided this on Oct 26 2026 (`modules/queue/src/tech-queue/tech-queue.service.ts`, pinned by `tech-queue-accept-status.vitest.spec.ts`). Ask him before splitting the labels.
- **Clock PIN hash cost:** Kevin chose "lower the hash cost" (M4-1, done). Do not raise it back without asking.
- **Don't remove anything a salon uses.** Harden or deprecate instead. No duplicate "V2" systems: extend the existing one. Dead code goes only through `docs/DEAD_CODE_REPORT.md` / `docs/dead-code-plan.json`.
- **No false PASS.**
  - PASS needs executed evidence.
  - Use BLOCKED_EXTERNAL only for a real outside dependency.
  - An unknown payment answer is never called a decline.
  - No blind retries.
- Kevin writes tersely. "continue" means: do the next logical unit fully, then report honestly.

## How to run

See `DEVELOPER_HANDOFF.md` → "How to run". In short:

1. Build: `npm run build:packages && … build:frontends`.
2. Static checks: `npm run typecheck`, the lint ratchet and `npm run ci:gates` (54 gates + 17 audits).
3. Suites: `ci:test:{packages,modules,apps,api}`.
4. Race lane: `PG_RACE_URL=… npm run ci:test:race`.
5. Pilot: `DATABASE_URL=… PORT_PROOF=3201 node apps/api/scripts/live-pilot-day.mjs`. `PILOT_SKIP=11` gives a quick phase-12 run.

PostgreSQL stops when the container restarts. Start it again with `pg_ctlcluster 16 main start`.

## Current state

- Nov 5: latest unit ca75e5b (C5 First Visit Invitation). Open gap lists are at the end of `docs/GUIDE_QUEUE_2026-11-03.md`.
- Nov 5 (later): Batch F added to the guide queue; working F1 Customer Directory (commits 4819af4 … a9c8860). F1 done / remaining is in the F1 section at the end of `docs/GUIDE_QUEUE_2026-11-03.md`; metric definitions in `docs/customer-directory-metrics.md`.


| Area | State |
|---|---|
| **M4 · 200-technician scale** | DONE: server-paged board, indexes (691), rate limit, feed paging, queue state about 0.26 s, outbox lanes. **Oct 26:** lane review fixes, per-aggregate order across failures and instances (`044a1878`), and M4-1 (PIN-cost scrypt, about 3× less API CPU per burst). **Open:** realtime lag p95 < 2 s under a 3,500-event burst (needs a realtime-first lane plus production hardware), and the clock-in p95 read-back on the pilot host. |
| **M5 · 200-technician pilot** | DONE: pilot 177/177 (`docs/pilot-runs/2026-10-24-m4/`). **Oct 26:** the remaining internal gaps are built (picker, Tech Queue paging, Team filters, payroll exceptions, Owner branch filter / paged performance, First / Last, prefetch, race variants, the blocked-time dataset). **Open:** the live re-run of the blocked-time lines, an Owner App at 200 pilot step, and Appointment Soon / Hold lane states. |
| **M6 · Secure Tap to Pay** | INTERNAL WORK DONE. M6-1 … M6-6 (Oct 23–24) plus the Oct 26 gaps: unsettled spec, rename, biometric lockout, Return-to-Staff password, merchant check on store switch, counters / security events, server attestation intake. Pilot phase 12 S0–S14: 133/133 (`docs/pilot-runs/2026-10-26-secure-tap/`). **External:** native key store / App Attest / Face ID (Mac + iPhones), CommerceHub inquiry (sandbox), per-location CommerceHub MIDs (today one env MID for all locations). |
| **Security deep scan** | P0 / P1 fixed Oct 23. On Oct 26 the network policy, step-up gaps, anonymous limiter, cross-branch suite, signals, strict bodies (partial), sort and HTML gates were added. 140 DONE / 34 PARTIAL / 1 NOT DONE (§157) / 17 BLOCKED_EXTERNAL. |
| **Malware scan** | Oct 26: clean (`docs/security/MALWARE_SCAN_REPORT.md`). gitleaks could not run in the sandbox; CI runs it. |
| **Dead code** | Batch 1 done (69 files). Batch 2 (exports, client methods, i18n keys) is open and may be in progress in the working tree. |
| **Hand-back docs** | Refreshed Oct 26: DEVELOPER_HANDOFF, PROJECT_STATUS, NEXT_STEPS, this file, INTEGRATION_STATUS, DATABASE_STATUS, SECURITY_REVIEW, CHANGELOG_HANDOFF. `TEST_REPORT.md` waits for the full regression. |

## Next concrete steps (in order)

1. **Full regression on HEAD** (NEXT_STEPS I-1).
   - Run `tooling/ci/final-run.sh`, then `tooling/ci/live-proofs.sh`.
   - Then run the whole pilot on a fresh database through 692 with no `PILOT_SKIP`.
   - Fill the "Oct 26 2026 — full regression (pending)" section of `TEST_REPORT.md` and the Final Acceptance Matrix.
   - Commit the evidence under `docs/pilot-runs/2026-10-2x-full/`.
2. **Recovery flows in the pilot** (I-2): top-up, Skip-the-Line, split card and refund timeout, each lost-answer → Verify → settled once.
3. **Wallet webhook leg and the split-tender race** (I-3, I-4).
4. **Realtime-first outbox lane** (I-5). Re-measure with `m4-outbox-burst-bench.mjs`. Decide on the `resourceVersion` client check (no client reads it today).
5. **Owner App at 200 pilot step** (I-6), then the cost-allocation matrix (I-7).
6. **Security internal remainder** (I-8, I-9): unscanned images first, then strict bodies route by route.
7. Secure Tap §51 alert rule / panel (I-10), platform-announcement PARTIAL rows (I-11), Tech Queue lane states (I-12).
8. Dead-code batch 2 (I-14) once no other agent is editing those paths, then the ratchets (I-15).

## Global Loyalty (AI PowerSalon Rewards) — Oct 30 2026

Built from the LoyaltyTokens / LoyaltyRules / LoyaltyComplete PDFs and the *Global Loyalty Final Completion* build guide. **Local commits only.**
- **Commits:** `d20c71b9` (POS Rewards Network), `369e6739` (Super Admin Loyalty Network), `122c87d6` (phases 0–3: holds, Checkout reward tender,
  payables), `9a893aa5` (phases 4–5: books check, integrity dashboard, fraud signals), `291d5961` (phases 6–7: Customer My Rewards + opt-in,
  Owner Rewards), then the phase 8–9 handoff commit (tests T07 / T13 / T22 / T16, reimbursement flag on Pay out, docs).
- **Migrations:** `733_*` (engine) and `734_global_rewards_redemption_payouts.sql`. Neither has been applied to production; that needs owner approval.
- **Docs:** `docs/loyalty/` contains LOYALTY_GAP_AUDIT, LOYALTY_NETWORK, SPEC_CONFLICT_RESOLVED, LOYALTY_FLAGS, LOYALTY_TEST_EVIDENCE,
  LOYALTY_READINESS and LOYALTY_EXTERNAL_BLOCKERS.
- **Truth:** CODE_READY, and SANDBOX_READY where shown in LOYALTY_READINESS. Nothing is PRODUCTION_READY. Every flag is OFF.
  - No payout provider exists, so a payable can never become PAID.
  - Real token purchases are BLOCKED_EXTERNAL.
- **IMPLEMENTED_NOT_VERIFIED (needs CI):**
  - Frontend type-checks.
  - The consumer outbox-path tests.
  - `apps/api/src/customer/global-rewards-checkout.pgtest.vitest.spec.ts` (needs the Kysely query builder).
  - T20. (T10 now PASSES on real Postgres: `global-rewards.postgres-race.vitest.spec.ts`, 4/4.)
  - T21 is BLOCKED (needs a load environment).
- **Next safe steps:**
  1. After K-12 steps 1–5, push to a branch and run CI. Record the job ids in LOYALTY_TEST_EVIDENCE.
  2. Get legal and accounting sign-off on the SPEC_CONFLICT_RESOLVED open items.
  3. Choose the payment and payout providers.
  4. Run the pilot per LOYALTY_FLAGS.

## Customer Segments — Oct 31 2026 (guide 1 of the marketing set)

Marketing & Growth → Customer Segments has been rebuilt in place (`docs/segments/CUSTOMER_SEGMENTS.md`). Local commit only.
- **Defect fixed:** "New" counted 0-visit customers. Now Never Visited = 0, New = exactly 1, Returning = 2+, VIP = staff-set flag (no invented threshold), Inactive = Retention's At Risk.
- **Built:** server search, filters and date basis; pages of 10/20/50; Why This Segment?; a masked, audited customer overlay with Open Booking; an Audience Builder that makes a consent-checked **draft only** and links it to a Campaign Center draft.
- **Snapshots:** the existing nightly snapshot job now records VIP and tier from now on; earlier days are never invented.
- **Migration:** 735 (additive). Not applied to staging or production — that needs owner approval.
- **Tests:** segments pgtest 13/13, customers-core 62/62, Retention 36/36, POS E2E 11/11, all gates pass.
- **IMPLEMENTED_NOT_VERIFIED:** the rewritten POS unit test and the type-check (both need CI).

## Coupons & Promotions — Oct 31 2026 (guide 2 of the marketing set)

- **Route fix:** `/tenant/marketing/coupons` now has its own screen, `POSCouponsScreen`. It used to render the Promotions screen, which is the root cause of the "Promotions" title under the Coupons menu item.
- **One record:** "vishal" is ONE `deals` row (kind coupon). Promotions, Discounts, Coupons and Deals all read that row and the one `deal_redemptions` ledger.
- **New, all over the same engine:**
  - `pos/coupons/*`: a read-only checker that uses Checkout's own engine, related campaigns, health, and an assistant (`rules-v1`, makes drafts only, with an audit row in migration 736);
  - `POST pos/deals/:id/duplicate`;
  - resume rechecks the limit and budget.
- **Tests:** pgtest 18/18, verdict unit test 19/19, real-Postgres race 3/3 (mutation-checked), E2E 14/14, regression suites green, all gates pass.
- **Needs CI:** type-checks, the new POS unit test, and the existing query-builder deals suites.
- **Owner decisions:** whether Front Desk gets read-only Coupons access, confirming round-down rounding, and the assistant's default values.
- **Details:** `docs/promotions/COUPONS_PROMOTIONS.md`. Guides 3 (Deals & Offers) and 4 (Promotions) should extend these pieces, not copy them.

## Deals & Offers — Oct 31 2026 (guide 3 of the marketing set)

- **Screen:** `POSDealsScreen` was rebuilt in place.
  - Kept: New Deal, every row with quick Pause/Resume, Edit, versions, coupon codes, Performance (the dashboard), Settings.
  - Added: six server KPI cards, the technician-policy strip, search and filters, a month calendar with an explicit date basis, numbered pages, an Approvals tab with a Review overlay, Redemption History, System health, and the Deals Assistant (draft only).
- **Backend:** `pos/deals-offers/*` (`deals-center.ts`). It reuses `discounts-screen.ts` and `coupon-center.ts` with the new `scope: 'all'`.
- **Rules added in `deals.service.ts`:**
  - no self-decision on technician proposals (`DEAL_SELF_APPROVAL`);
  - today's technician rules re-checked on approve, publish and resume;
  - `POST pos/deals/:id/request-changes` (sends the deal back to draft, with a note);
  - an approved technician deal cannot be widened (`DEAL_REREVIEW_REQUIRED`).
- **Migration 737:** indexes only.
- **Tests:** pgtest 20/20, real-Postgres race 3/3, regression suites green, E2E 15/15 (plus Coupons 14/14 and Discounts 7/7 regression), all gates pass.
- **Needs CI:** the rewritten POS tests, the type-checks, and `request-schemas.vitest`.
- **Open:** who funds and commissions a technician deal (guide §12). Details are in `docs/promotions/DEALS_OFFERS.md`.

## Promotions — Oct 31 2026 (guide 4 of the marketing set)

Marketing → Promotions was rebuilt in place over the same coupon records, so it adds no second engine. Details are in `docs/promotions/PROMOTIONS.md`.
- **Screen:** the screenshot's title, cards, columns and Pause / Archive are kept. Added:
  - search scopes Promotions / Redemption History / Eligibility Checks / Insights / Check System;
  - branch and service filters, the month calendar with date basis, and pages 10 / 20 / 50;
  - Activity (audit) and Open Ticket in the details;
  - Save & activate (submit → approve → publish, server-checked);
  - assistant safety flags and a message preview.
- **Backend:** `modules/deals/src/salon-promotions/promotions-center.ts` (`pos/promotions/*`, logged read-only checks via Checkout's engine), and migration **738** `promotion_eligibility_checks`.
- **Legacy fix:** `pos/salon-promotions` no longer reports scheduled as active. Its Activate re-checks the end date and cap, and changes status through the audited `transitionStatus`.
- **Tests:** pgtest 13/13, real-Postgres pause race 5/5 (plus a mutation check), E2E 15/15, regressions all pass.
- **Still open:** the type-check and POS unit test need CI; the physical ASUS check and migration 738 to staging / production need the owner.
- **Owner decisions:** Front Desk read-only access, two-person approval for salon promotions, and the assistant's message wording.

## Campaign Center — Oct 31 2026 (guide 5 of the marketing set)

Doc: `docs/marketing/CAMPAIGN_CENTER.md`. Migration **739** (additive; local template only).
- **Root cause of "spring into glow — 50 / 0 / Completed":**
  - The audience was a hand-typed number.
  - Activate and Complete were bare status moves.
  - The send worker only sends campaigns with a plan, and the POS never wrote one.
  - Nothing ever wrote `sent_count`.
  - The funnel summed `audience_size` as "reached".

  The row is unchanged; the screen now says "~50 est. · No messages were sent — no send record exists" and shows N/A where nothing is tracked.
- **Flow:** audience snapshot (from a Customer Segments draft) → message → preview (never sends) → approval (content hash + send plan) → launch
  (`scheduled` only).
  - The existing worker sends, re-reading consent per recipient. It is idempotent, and a cancel stops future sends.
  - The old `schedule` / `activate` routes are gated by the same readiness check.
- **Tests:** pgtest 14/14 · race 4/4 (mutation-checked) · browser E2E 14/14 (5 viewports, EN/VI) · gates 57/61 pass, 4 can't run here.
- **Next:**
  - CI type-check plus `POSCampaignCenterScreen.test.tsx`.
  - Staging run of the sweep against the salon's real Twilio, with authorization.
  - Owner decisions: second approver? booking attribution window? recipient export?
  - Not done here: pause of an in-progress send (the machine has no paused state).
  - Pre-existing harness note: the Segments E2E "newest first" step saw "Promo Tester" (seeded by the Promotions harness) → 10/11. **Fixed in guide 6** (steps compare against DB truth); the combined marketing E2E is 80/80.

## Marketing & Growth — Oct 31 2026 (guide 6 of the marketing set)

Doc: `docs/marketing/MARKETING_GROWTH.md`. **No migration.**
- `/tenant/marketing` rebuilt in place: every photographed section, tile, Open link and quick action is kept.
  - Added: a 6-card KPI strip, one grouped search, period and branch filters, Data checks (GATE 0), Marketing Cost & Profit, activity history and the Customer Marketing Journey.
  - The Smart Campaign Assistant opens Campaign Center's assistant (`?assistant=<goal>`).
- **Fixed:**
  - "0x" ROI: the legacy `avgRoi` was 0 when there was no cost (and it was really ROAS). It is now `null` → N/A.
  - "0 ★" with no reviews is now N/A.
- **GATE 0** (`/pos/marketing-growth/reconciliation`) traces loyalty, gift cards, referrals, campaigns, promotions and reviews to source rows. Every gap is a defect with amount, source, owner and status. Nothing is auto-corrected.
- **Tests:**
  - pgtest 20/20;
  - browser E2E 11/11;
  - combined marketing E2E 80/80;
  - gates: 57 pass, 4 can't run here.
- **Next:**
  - CI type-check + `POSMarketingLandingScreen.test.tsx`.
  - Owner decisions: loyalty card scope (tenant-wide?), spam in the published rating, who sees Cost & Profit.

## Message Templates — Oct 31 2026 (guide 7 of the set)

`docs/marketing/MESSAGE_TEMPLATES.md` is the handoff. The salon's templates stay in `pos_message_templates` (extended by migration
740 — versions, bindings, usage, tests). P0 proven: a template created on the original form is rendered with the conversation's
real customer in the SMS Inbox and the reply records the exact version. Appointment Reminders reads its template binding (built-in
text on any missing value). Preview never sends; Test Send is confirmed, idempotent, salon-Twilio only.
- Tests: pgtest 17/17, real-Postgres race 3/3, E2E 11/11 (`interact.mjs mt-e2e mt`), combined marketing 91/91, inbox E2E 17/17,
  57 gates pass (4 can't run here: lint, boot, api-contract, strict-bodies-types).
- Next guides call `resolveBoundTemplate` / `recordTemplateUsage` from `modules/communications/src/templates/message-templates.ts`
  to make their workflow connectable (see the hand-off table in the doc).
- Owner decisions: Front Desk holds `communications.manage` (manages templates) by the role policy; second approval for templates
  used by automations; retiring the two DEPRECATED `pos/settings/notifications-reminders/templates` routes.

## Customer Notifications — Oct 31 2026 (guide 8 of the set)

`docs/notifications/NOTIFICATIONS.md` is the handoff (incl. the P0 table for the failures in the owner's photo). Migration 741
(additive): delivery-event and consent-event history (append-only), authorized resend requests, branch / source / retry link on
`notifications`, one open `messaging_failure` owner alert per rule. Route kept; screen rebuilt in place (`pos/customer-notifications/*`).
- **P0 defect fixed:** the system send path (`sendSms`: receipts, reminders, inbox) sent numbers without `+country code` to Twilio,
  which read `7876299624` as +7 and refused the "region". Non-E.164 is now blocked (`invalid_destination`), never guessed.
  Twilio's error code is kept; stored failure text is sanitized (no SIDs / numbers).
- **Consent:** a customer's STOP is undone only by their START; staff re-opt-in needs a consent note (one route:
  `POST /pos/notifications/opt-in`). The old silent "Re-subscribe" is gone.
- Tests: pure 14/14, pgtest 18/18, real-Postgres race 3/3 (mutation-checked), E2E 12/12 (`interact.mjs cn-e2e cn`), combined
  marketing + notifications 103/103, inbox 17/17; 57 gates pass (4 can't run here).
- Blocked / next: the production rows behind the photo and the salon's Twilio Geo Permissions (owner); real sends + callbacks on
  staging; email delivery webhooks don't exist (email stays Unknown). Owner decision: Front Desk holds `communications.manage`.

## Phone Number Management — Oct 31 2026 (guide 9 of the set)

Customers → Phone Number Management (`/tenant/customers/phone-management`). Full record: `docs/communications/PHONE_NUMBERS.md`.
Local commit only.
- **What existed and was kept:** the change workflow was already complete and is untouched:
  - pending → verified → active, with atomic activation;
  - manual exception (never "verified"), approve, resolve, retry sync, cancel;
  - the six-digit challenge and the durable sync job;
  - the DB uniqueness backstops and the 7 settings.
- **What's new:**
  - a read-only center (`pos/customer-phone-center/*`, `phone-center.ts`) and the rebuilt screen (`PhoneManagementCenter.tsx`, with the settings kept as `PhoneSettingsPanel`);
  - the old-number notice is linked to its request (`notifications.source_type 'phone_change'`);
  - migration **742** (additive).
- **Tests:**
  - pgtest 13/13; real-Postgres race 4/4; browser E2E 10/10 at five sizes, EN/VI and Front Desk;
  - regression suites pass;
  - gates: 57/61 pass, 4 can't run here.
- **Needs CI:** type-checks, the two POS unit tests, and the service-level flow and race specs (query builder).
- **Open owner decisions:**
  - ~~old-number notice language~~ — resolved in guide 10: it was already English at runtime (dead Vietnamese branch removed);
  - Front Desk access;
  - whether managers should see the full proposed number.

## Booking Phone Verification — Oct 31 2026 (guide 10 of the set)

The guide behind this is *AI PowerSalon Booking Phone Verification — Complete Claude AI build and repair guide*. The page `/tenant/communications/phone-verification` was rebuilt in place.

- **Docs:** `docs/communications/BOOKING_PHONE_VERIFICATION.md` holds the baseline, the discrepancies D1–D7, the API, the tests and the §22 status table.
- **Commit:** see `git log`; it was committed locally only.
- **Migration 743** (additive) is applied to the local `aps` template only and still needs owner approval for staging and production. It adds:
  - `booking_verification_settings.high_value_threshold_cents`;
  - `booking_verification_sessions.policy_reason`;
  - a history index.

**P0 fixes**

1. **Stale holds:** an expired-but-unswept hold no longer blocks the next customer for up to 60 s.
2. **Expired-hold conversion:** the database clock now refuses converting a lapsed hold.
3. **Correct-code lockout race:** found by the new real-Postgres spec. 8 simultaneous correct codes used to LOCK the session. Now only the last wrong guess locks.

**Built**

- **Special rules:** deposit and high-value rules are now fed from the booked services. The high-value amount can be set; when it is empty the rule never fires. The group rule is shown with a note: no remote path books more than one guest.
- **Booking sources:** all six are shown; the three in-salon sources are fixed off.
- **Operations center:** `pos/booking-verification-center/*` provides KPIs, Check Verification System, the live monitor, history, the overlay and a record-bound resend.
- **Language:** customer messages in the phone flows are English only. The old "Vietnamese notice" was dead code and has been removed.

**Tests**

| Suite | Result |
|---|---|
| center pgtest | 14/14 |
| race | 3/3, three runs |
| browser E2E (`interact.mjs bv-e2e bv`) | 9/9 |
| gates | 57 pass, 0 fail, 4 can't run here |

**Next safe steps**

1. Run CI for the POS unit tests and type-check.
2. Run real Twilio Verify on staging with test recipients.
3. Get the owner's decisions on the group switch, a high-value default, and Front Desk resend.

## Text Messaging Setup — Oct 31 2026 (guide 11 of the set)

Full handoff: `docs/communications/TEXT_MESSAGING_SETUP.md`. Local commit only; migration 744 is on the local `aps` template only.

- **Six-part readiness:** "Check SMS System" now shows Account · Sender · Registration · Inbound · Delivery · Booking Verify, each judged on its own evidence, so a Connected account is never shown as ready.
- **Setup Wizard:** 7 steps; it resumes at the first unfinished step and opens the existing cards.
- **Branch senders:** each branch shows whether it inherits the salon default or has its own sender.
- **Setup history:** search, filters, a calendar with date basis, and 10/20/50 rows per page.
- **Test text:** editable, up to 160 characters, with "Cost unavailable".
- **Nightly check:** read-only, with de-duplicated alerts. It is OFF by default (`MESSAGING_HEALTH_SCHEDULE_ENABLED`).

| Evidence | Result |
|---|---|
| pgtest | 14/14 |
| real-Postgres race | 1/1 (fails with the guard removed) |
| browser `ms` | 8/8 |
| combined run | 130/130 |
| gates | 57 pass, 0 fail, 4 can't run here |

The `comms` browser run is 11/12. Its Vietnamese-heading step fails the same way on the unchanged HEAD.

**Next safe steps**

1. Run CI for the type-check and the POS unit test.
2. Owner: decide whether to turn on the nightly run, and whether there is an approved per-text rate.
3. Verify real Twilio delivery reports, inbound webhooks and carrier registration on staging.

## End-of-Day Follow-Ups (guide 12) — Oct 31 2026

- **Commits:** `b8d4f8be` is the pre-task (three POS i18n key collisions fixed, plus the new gate `check:i18n-ns-collisions`). The main build is the commit that adds `docs/communications/END_OF_DAY_FOLLOW_UPS.md`.
- **Migration 745** is local only.
- **P0 fixes:**
  - Expiry no longer hides or deletes tasks, and the 30-day purge job is removed.
  - Sending is one transaction that re-checks the customer protections (already booked, contact cooldown, archived), with an audited manager exception.
  - Manager **Return to technician** was added.
  - Technician alerts are de-duplicated.
- **New:** the read-only management center `pos/eod-follow-ups/*` and the rebuilt `/settings/follow-ups` screen.
- **Tests:**
  - pgtest 15/15, race lane 4/4 (mutation-checked), unit specs 20/20 and 17/17.
  - Browser test `eod` 9/9.
  - Gates: 58 of 62 pass; 4 can't run here.
- **Open:**
  - SMS or email delivery for follow-ups is not built (in-app only).
  - Type-checks and the POS unit test need CI.
  - Owner decisions: cooldown default, Front Desk approvals, the sensitivity class.

## Follow-Up Queue (guide 13) — Oct 31 2026

- **What:** `/follow-ups` rebuilt in place on the guide-12 End-of-Day data. No second queue, scheduler or send path.
- **Doc:** `docs/communications/FOLLOW_UP_QUEUE.md`.
- **Migration:** 746 adds indexes only; it is on `aps` only.
- **Fixed:**
  - The sidebar said "Missed Call Follow-Up" for the after-service queue. It now says **Follow-Up Queue**, and Missed Call is a separate type read from `call_intelligence_events`.
  - The counters now have one written basis (the salon-local due date). A failed load shows **Unknown**, never 0.
  - Generate Now reports eligible / created / already existed / skipped by reason.
- **Added:**
  - server search, filters and a date basis;
  - the anchored month calendar and pages of 10/20/50;
  - Smart Priority `fuq-priority-v1`, with reasons and timestamps;
  - the contact check (Duplicate Message Protection);
  - the detail overlay (Skip-with-reason, Approve / Return, Retry, Book, history);
  - Results (association, not causation).
- **Proof:**

  | Check | Result |
  |---|---|
  | pgtest | 14/14 |
  | Real-Postgres race, incl. forced interleaving | 3/3 |
  | `fuq` browser test | 7/7 |
  | Combined browser run (incl. `fuq`) | 146/146 |
  | `comms` section | 12/12 |
  | Gates | 52 npm + 6 stand-in pass |

  The POS unit test and type-check need CI.
- **Open:**
  - the Customer Profile embed of the history;
  - CSV export (not built);
  - three owner decisions in the doc: in-app opt-out, cross-channel cooldown, the 30-day window.
- **Superseded components:** `FollowUpQueuePanel` and `FollowUpTaskTable` are registered in `docs/dead-code-plan.json`, not deleted.

## Appointment Reminders (guide 14) — Oct 31 2026

- **What:** `/tenant/communications/reminders` rebuilt in place; the original settings (toggle, 24 h lead, 60-min window, SMS, Save) are unchanged. Same reminder service, repository and send path — no second engine.
- **Doc:** `docs/communications/APPOINTMENT_REMINDERS.md` (P0 audit, Send Window semantics, feature-status table, rollout / rollback).
- **Migration:** 747 (additive) — the idempotency ledger `appointment_reminders_sent` becomes the per-occurrence dispatch record (claimed BEFORE the send), the attempt log becomes the event trail, new `appointment_reminder_runs`. On `aps` only. `NOT NULL` contract deferred to a later release.
- **Fixed (P0):**
  - overlapping runs (5-minute scheduler + `/jobs` route / two instances) could send the same reminder twice — now one claim per (appointment, rung, occurrence); race test proves it (guard removed → 3/4 fail);
  - a rescheduled appointment never got a reminder for its new time once one had gone out — the occurrence is now part of the key;
  - no re-check before the provider call — now under the appointment's row lock at claim time and again right before sending.
- **Added:** six KPIs on written bases (Delivered = Unknown until a delivery report arrives) · health (scheduler run record, Twilio, email, booking sync, delivery reports) · Upcoming (derived, earliest due first) and history tabs with server search / filters / date basis / calendar / pages · details with attempts and provider events · Cancel Pending · guarded Safe Retry · quiet hours from Super Admin Smart Reminders (defer / skip) · bounded automatic retry · Customer Profile → Reminder History.
- **Proof:**

  | Check | Result |
  |---|---|
  | pgtest | 19/19 |
  | Real-Postgres race (4 sessions) | 4/4 |
  | Reminder / template / notification regression | all pass |
  | `rmd` browser test | 7/7 |
  | Combined browser run (incl. `rmd`) | 152/153 — the one failure is the `eod` "Finn already got one today" step, which fails identically with this change stashed (time-of-day dependent; not caused by guide 14) |
  | `comms` section | 12/12 |
  | Gates | 52 npm + 6 stand-in pass; 4 can't run here |

  The POS unit test and type-check need CI.
- **Open:** real Twilio / email delivery and callbacks (external); a "Both" channel; confirm-by-reply; turning the in-process scheduler on in production; the profile section's UI in a browser (the harness lacks `GET /pos/customers/:id`).

## Email (guide 15) — Oct 31 2026

- **What:** `/tenant/communications/email` rebuilt in place as the Email Management & Delivery Center. The photographed settings (sender name, the two toggles, Save) are kept, and are now **honoured by the send path**.
- **Doc:** `docs/communications/EMAIL.md` (audit, the one email path, handoff table, rollback, owner decisions).
- **Migration:** 748 (additive). It adds:
  - `notification_opt_outs.scope` (all / marketing);
  - three consent sources;
  - `email_send_keys` (claim-before-send);
  - `email_health_checks` (append-only).

  On `aps` only.
- **Fixed (P0):**
  - Both toggles did nothing. Receipt emails bypassed the ledger, opt-outs and the setting entirely.
  - The saved sender name was overwritten by the SMS brand on every read.
  - SendGrid got HTML labelled `text/plain`.
  - Campaign emails had no unsubscribe link or address (no purpose on the ledger row).
  - The 741 resend let a marketing unsubscribe block resending a receipt.
- **Added:**
  - One email path (`sendEmail`) for every email.
  - A booking confirmation email per appointment (consumer on `appointment.created`).
  - Signed SendGrid events: delivered, bounce, complaint, unsubscribe.
  - CAN-SPAM footer and one-click unsubscribe.
  - Honest KPIs (Delivered N/A without events) and health by layer.
  - History with search, calendar and pages.
  - Details with a protected resend, a staff-only test email, and a customer-record composer.
- **Pre-task (EOD E2E, 152/153 → fixed):**
  - The "Finn already got one today" step depended on which of two tasks created in one transaction (identical `created_at`) the harness picked as "first pending". It also seeded services "15–60 minutes ago", which fall into yesterday between 00:00 and 01:00 local.
  - The harness now seeds fixed salon-local times (10:00–10:45) and submits tasks by customer (`tech=ava` / `tech=finn`).
  - Proof: `eod` 9/9 at 07:48 local. The 8 PM boundary is exercised on the controlled clock (19:59 / 20:01 / 20:30). No clock-faking tool exists here, so a real run just after midnight was not performed; the dependency on the real clock was removed instead.
- **Proof:**

  | Check | Result |
  |---|---|
  | `email-center.pgtest` | 20/20 |
  | Real-Postgres race | 3/3 (claim disabled → 2/3) |
  | settings-core | 115/115 |
  | Regressions | all pass |
  | `em` browser test | 9/9 |
  | Combined browser run (15 sections) | 162/162 |
  | `comms` section | 12/12 |
  | Gates | 58 of 62 pass; 4 can't run here |

- **Blocked:**
  - Real provider, DNS, signed webhook key, and the production unsubscribe secret and public URL.
  - Migration 748 on staging / production.
  - The physical ASUS 27″.

## Customer Retention & Win-Back (guide 16 of 20) — Oct 31 2026

- **Doc:** `docs/marketing/RETENTION_WINBACK.md`. **Migration:** 749 (`retention_health_runs`), applied to the local `aps` template only.
- **The photographed P0 (13 At Risk rows with "Never"):** already fixed on Oct 29 and re-verified. New this round: the win-back SMS worker now also blocks, at send time, a customer who no longer has a completed visit.
- **New:**
  - Already Rebooked and Contacted segments;
  - Contacted and Delivered strip (Delivered = provider evidence only, else Unknown);
  - inactivity, email and future-booking filters;
  - overlay communications, email consent and refunds;
  - read-only Check Retention Data (9 checks, recorded, one run per salon per minute);
  - Win-Back Assistant: an unsent audience → Campaign Center draft; approval and launch stay in Campaign Center.
- **Tests:**
  - pgtest 10/10, real-Postgres race 2/2;
  - two mutation checks fail as expected;
  - browser `wb` 8/8; combined run 170/170 (16 sections); `comms` 12/12;
  - gates 58 of 62 (4 can't run here).
- **Next:** guide 17, Birthday Campaigns.

## Birthday Campaigns (guide 17 of 20) — Oct 31 2026

- **Doc:** `docs/marketing/BIRTHDAY_CAMPAIGNS.md` (P0 audit, B01–B24 matrix). **Migration:** 750, applied to the local `aps` template only.
- **Why October showed 0:** staff could not record or correct a birthday from the POS (the profile edit ignored it) — the
  month match itself was right. Also fixed: the POS row printed "Thu Oct 01"; the CSV import accepted 02/30, rolled
  "Feb 30" into March 2 and stored month/day-only as 1900; the Customer App shifted dates east of UTC and 500'd on 02-30.
- **New:**
  - one birthday rule (`modules/customers/src/birthdays/birthday-core.ts`): Feb 29 policy, year rollover, occasion year;
  - `/pos/birthdays/*` (`modules/reports/src/birthdays/`): KPIs, table (scopes, ranges, search, pages), Missing Birthdays
    Center, overlay, role-gated birthday edit, history, Feb 29 setting, assistant → UNSENT Campaign Center draft;
  - send worker: one birthday message per customer per occasion year per channel, claimed before the provider call.
- **Tests:** birthday-core 12/12 · center pgtest 17/17 · race 3/3 (mutation → 0/3) · import 23/23 · send executor 13/13 ·
  Customer App service 9/9 · browser `bd` 10/10 · regressions green.
- **Next:** guide 18, Referral Program.

## Referral Program (guide 18 of 20) — Oct 31 2026

Doc: `docs/marketing/REFERRAL_PROGRAM.md`. Migration 751 (local `aps` only). Route kept: `/tenant/marketing/referrals`; API `/pos/referral-program/*`.
- **Defect fixed:** "Rewards Paid" was a hand-typed dollar amount set by a Reward button (no ledger, approval or qualification). Retired; Rewards
  Paid is now cash with settlement proof only ($0.00 — no payout provider). Legacy hand-marked rows → UNDER_REVIEW, amount kept separately.
- **Workflow:** code → record (one per new customer, idempotent) → `checkout.completed` qualifies the first paid visit (`ReferralQualificationConsumer`)
  → reward per the owner's policy (NONE set by default — nothing invented) → manager approval → ONE loyalty-ledger posting (`applyLoyaltyEntry`) →
  refund reverses once. Cash rewards = BLOCKED_EXTERNAL.
- **Tests:** pgtest 22/22 · race 3/3 (mutation-checked) · consumer 3/3 · harness `rf` 11/11 · combined 191/191 · comms 12/12 · 62 gates (52 npm + 6 stand-in; 4 can't run here).
- **Also:** `BIRTHDAY_MESSAGE_CLAIM` machine added for guide 17's `birthday_message_claims` writes (exposed by the vocabulary regeneration).
- **Owner decisions:** reward type/value; qualification rule; approval / separation of duties; what to do with legacy hand-marked rewards.

## Reviews & Reputation (guide 19 of 20) — Oct 31 2026

Doc: `docs/marketing/REVIEWS_REPUTATION.md`. Migration 752 (local template only).
- **One rating:** Reviews KPIs and the technician overlay use the verified definition Team Performance already ranks by: rated 1–5, not hidden, not spam (REV-18 test). The public technician profile figure no longer counts spam.
- **Moderation:** Hide / Unhide is reason-coded, version-checked and idempotent, with an immutable trail and an audit row. A 1–2★ review can't be hidden for "other".
- **Retired:** the legacy `pos/reviews/*` routes, which had no caller after the rebuild.
- **Screen:** search, filters, From/To calendar with a date basis, pages 10/20/50, the overlay, the assistant's facts and the read-only Check Review System.
- **Tests:**
  - pgtest 18/18
  - real-Postgres race 4/4 (2/4 with the row lock removed)
  - browser `rv` 11/11; combined 202/202; `comms` 12/12
- **Gates:** 58 of 62 pass; 4 can't run here.
- **Open owner decisions:**
  - should hidden reviews also leave Team Performance?
  - Front Desk read-only access?
  - assistant minimum of 3 written comments?

## AI Business Setup (guide 20 of 27) — Oct 31 2026

Full handoff: `docs/setup/BUSINESS_SETUP.md`. Route kept: `/tenant/ai/receptionist/business-setup`. Migration 753 (local template only).
- P0: "0 services" was a FALSE zero (the screen read `r.services` from a `{ items }` response); "hours configured" was the platform default week.
  Readiness now reads the canonical tables with the AI's own eligibility rules (raw vs eligible + exclusions; UNKNOWN, never 0, on failure).
- FAQs: draft → review → approved (append-only revisions + events, pending edits never overwrite live text, version + request key, audited);
  backfilled FAQs are "Needs review" (nothing auto-published). New voice tool `get_business_info` serves hours + APPROVED FAQs only.
- Check Business Setup (10 non-mutating checks), Preview AI Knowledge (read-only, redacted history), Knowledge Assistant (suggestions only).
- Tests: pgtest 21/21, real-Postgres race 3/3 (1/3 with the lock removed), `bs` E2E 10/10, combined 20-section E2E 212/212, `comms` 12/12, gates 58/62 (4 can't run here).
- Next guides (21–26 AI Receptionist, AI Calls, AI Front Desk, Reception Copilot, AI Calendar, AI Follow-Ups; 27 AI Center) read knowledge
  through `BusinessSetupCenter.knowledge()` / `get_business_info` — never a copy.
- Open owner decisions: holiday/closure source; booking ignoring `online_booking_enabled`; bulk-approve the backfilled FAQs?; canonical hours source.

## AI Receptionist (guide 21 of 27) — Oct 31 2026

- **Doc:** `docs/ai/AI_RECEPTIONIST.md`.
- **Routes and migration:** API `/pos/ai/receptionist-center/*` and migration `754_ai_receptionist_center.sql`; both are local only.
- **Root cause of the photo:** Twilio showed "Connected" because the PLATFORM's `TWILIO_*` env vars existed — never the salon's account or a routed number. Retell showed "connected" whenever a key was saved. Handoff-only came from a process-wide env switch; there was no per-salon control.
- **Now:** every state comes from evidence. Booking writes need the platform switch AND this salon's armed flag. A test call must be a real recorded call. Activation is gated, and every change is append-only and audited.
- **Tests:**

  | Suite | Result |
  |---|---|
  | Database test | 16/16 |
  | Race test | 3/3 |
  | Browser test (`rcp`) | 8/8 |
  | Combined browser run (21 sections) | 220/220 |
  | `comms` section | 12/12 |

  Voice and receptionist regression suites pass; the remaining failures fail identically on unchanged HEAD.
- **Next safe steps:**
  1. Run CI (type-check and the POS unit test).
  2. With the owner and the provider accounts: point the salon number's voice webhook at the Retell agent, issue a `vk_` key, then place one authorized test call and mark it verified on the page.
  3. Activate only after that.

## AI Calls (guide 22 of 27) — Oct 31 2026

- **Doc:** `docs/ai/AI_CALLS.md`.
- **Routes and migration:** `/pos/ai/calls-center/*`, the public `POST /webhooks/voice/retell`, migration `755_ai_calls_center.sql` (local only).
- **Root cause of the empty page:** nothing received Retell's call lifecycle webhooks. A call record existed only if the agent itself posted `/voice/calls/:id/outcome`. The outcome upsert also overwrote known facts on every post.
- **Now:**
  - Signed events are stored once per key, with redeliveries counted.
  - Facts merge out-of-order-safely under a row lock.
  - Every tool request and its result goes to a ledger; a request is not a success, and a success is not a confirmed booking.
  - The page shows verified counters, server search, the calendar, pages, an audited overlay, a read-only Check, and Reconciliation.
- **Tests:**

  | Suite | Result |
  |---|---|
  | Database test | 14/14 |
  | Race test | 3/3 (0/3 with the de-duplication removed) |
  | Browser test (`aic`) | 7/7 |
  | Combined browser run (22 sections) | 227/227 (one known harness page error after Open Booking: "not in the harness") |
  | `comms` section | 12/12 |

  Voice regression suites pass; the `get_deals` failure is identical on unchanged HEAD.
- **Next safe steps:**
  1. Run CI.
  2. With owner approval: set `RETELL_WEBHOOK_SIGNING_KEY` and register `/webhooks/voice/retell` on the salon's Retell agent, then place one authorized test call.
  3. Decide the recording policy.

## AI Front Desk (guide 23 of 27) — Oct 31 2026

- **Doc:** `docs/ai/AI_FRONT_DESK.md`.
- **Routes and migration:** `/pos/ai/front-desk/*`, migration `756_ai_front_desk_center.sql` (local only). The old `/tenant/ai/receptionist/agents` list / get / create / update / status routes are retired; provisioning stays.
- **P0 fixed:** the plain status route let anyone with `ai.manage` set an agent LIVE with no routing evidence, owner approval or salon activation. Nothing stopped two live agents on one route.
- **Now:**
  - Live is reached only through the owner-approved activation: a preflight that requires the verified test call answered by THIS agent, a per-route lock plus a unique index, the prior agent recorded for rollback, and one transaction.
  - "Active" is shown only when the latest recorded call reached this agent; anything less is "Degraded".
  - Pause stops the salon's AI and booking at once.
  - Drafts are version-checked database rows, saved through an 8-step wizard.
  - The page also has the overlay, monitor, read-only checks and activity history.
- **Pre-task, guide 15:** the email webhook outcomes now use the allowed `WebhookOutcome` values (`ec9309d9`).
- **Tests:**

  | Suite | Result |
  |---|---|
  | Database test | 16/16 |
  | Race test | 3/3 (2/3 with the route lock removed) |
  | Browser test (`fd`) | 10/10 |
  | AI regression suites | all pass, except the known `get_deals` failure |

  The combined browser run (23 sections) passed 237/237 and `comms` 12/12. Gates: 58 of 62 pass and 4 can't run here.
- **Next safe steps:**
  1. Run CI.
  2. With owner approval: apply 756 on staging.
  3. Point the number at the agent in the provider console, then verify from a recorded call.

## Reception Copilot (guide 24 of 27) — Oct 31 2026

- **Doc:** `docs/ai/RECEPTION_COPILOT.md` (P0 audit, CP01–CP42 table, rollback). Migration **757** (additive), local `aps` template only.
- **P0 fixes:**
  - The action ledger now claims its key before running, so two simultaneous confirms can no longer both execute.
  - Texts are no longer swallowed as "already processed".
  - Unreadable settings now fail closed.
  - The AI package entitlement now applies to actions and holds.
  - The one-step `copilot/action` route is retired.
- **New flow:** every Book / Reschedule / Cancel / Text goes **prepare** (server preview, no write, sealed 5-minute token) → **confirm** (exact payload) → **verify** (re-read record).
- **Added:**
  - Check Copilot System.
  - The customer reception overlay (audited).
  - The Priority Assistant (proposals only).
  - The live strip.
  - Scoped search and activity history (calendar, pages).
- **Evidence:**
  - Tests: pgtest 13/13; real-Postgres race 2/2 (0/2 with the claim removed); browser test `rcc` 9/9.
  - Gates: all pass that can run here.
  - Type-checks and the POS unit tests need CI.
  - BLOCKED_EXTERNAL: staging Book / Reschedule / Cancel / Text, live Twilio delivery reports, the physical ASUS screen.
- **Next safe steps:**
  1. Run CI.
  2. With owner approval: apply 757 on staging.
  3. Run CP40 on staging with a test customer.

## AI Calendar (guide 25 of 27) — Oct 31 2026

- **Doc:** `docs/ai/AI_CALENDAR.md` (root-cause audit of 0 / 0 / 114 / 3, metric definitions, T01–T52 matrix).
- **What it is:** a read layer over canonical POS Booking at `/pos/ai/calendar-center/*` (`modules/ai/src/ai-center/ai-calendar-center.ts`); no second appointment store and no write route. A move goes through the Reception Copilot prepare → confirm → verify path.
- **Root causes fixed:**
  - Open Slots now subtracts live holds and past times, and shows its definition plus Booking's raw total.
  - Technicians On means scheduled today, not active records.
  - AI-Created is the canonical source `ai`.
  - The day comes from the branch clock, not browser UTC.
  - Literal `‹` / `—` text is fixed via the new `aical.*` namespace (`catalog.en.ts` is untouched).
- **Built:**
  - Day (12 technicians per page) / Week / Month / List views, with URL-kept date and view.
  - Server search, date basis and From/To month calendar; pages of 10/20/50.
  - An 8-tab overlay (audited; contact masked unless `customers.export`).
  - Check Calendar System: 8 groups, recorded, 30 s limit.
  - The Scheduling Assistant.
  - `?date=` read by POS Booking as its starting day.
- **Migration 758:** `ai_calendar_health_runs` + two List indexes (additive). Local `aps` template only.
- **Tests:**
  - pgtest 18/18; real-Postgres race 2/2 (mutations: constraint dropped → 4/4 moves land; lock removed → 4 runs).
  - Browser `rcc,aical` 17/17; combined 25-section run 253/254 (one test-assumption failure in the new assistant step, fixed and re-run 17/17); `comms` 12/12; regressions all pass.
  - Gates 58/62 (lint, boot, api-contract, strict-bodies-types can't run here).
- **Not verified:** POS / API type-checks and `POSAIBusinessAndCalendar.test.tsx` (CI); live realtime socket.
- **BLOCKED_EXTERNAL:** the production rows behind the photo, staging Twilio Verify, the physical ASUS screen.
- **Open owner decisions:** map saved salon hours into the booking engine; Front Desk full contact in the overlay?; deep-link focus on one appointment inside POS Booking.

## AI Follow-Ups (guide 26 of 27) — Oct 31 2026

- **Doc:** `docs/ai/AI_FOLLOW_UPS.md` (root cause of the empty queue, T01–T48 matrix, open decisions).
- **Pre-task (740dc758):** the owner's Reception Copilot decisions. Front Desk cancels (already allowed). An expired AI package blocks Copilot actions via `@EnforceAiPackage()` on the action routes only. The 5-minute review stays.
- **What it is:** the task center at `/pos/ai/follow-ups-center/*` (`modules/ai/src/ai-center/ai-follow-up-center.ts`) over the ONE task table `ai_receptionist_follow_ups`. Migration 759 adds the durable handoff key, version, activity, contact attempts, handoff events, escalations and health runs.
- **Handoff pipeline:** `voice-booking/ai-handoff.ts`, used by both the signed Retell ingest and the gateway handoff tool. A failed transfer, a callback request or a complaint creates one task per call + reason, forever; a completed transfer creates none.
- **Writes:**
  - Every write is row-locked and version-checked, with activity and audit in one transaction.
  - Texts go through the Copilot prepare → confirm path and are shown submitted, never delivered without a report.
  - The overdue job raises one owner alert per task.
- **Retired:** `tenant/ai/receptionist/follow-ups*` (5 routes, 4 client methods).
- **Tests:**
  - pgtest 21/21 and race 4/4 (the mutation fails only with both guards removed).
  - Browser `rcc,fu` 18/18; combined 26 sections 263/263; `comms` 12/12.
  - 58 of 62 gates pass, plus the 4 that can't run here.
- **Next:** guide 27, AI Center (last).

## Merge verification + 20 new guides — Nov 2 2026

- **Merge:** the nine uploaded bundles are one linear chain ending at 4467fb80; this repo is a snapshot import of it
  (`ef877c5`) plus fixes. Full report: `docs/MERGE_2026-11-02.md`.
- **Running it found the API could not start** (3 causes), gift cards and the Customer Notifications list threw on every
  call, and ~220 type errors across modules, API and POS. All fixed; `check:boot` is green and everything builds.
- **Pre-existing test failures** (identical on the untouched tree) are listed in the report: PGlite race tests, plus a bug
  pass worth doing (commission review, tips, voice holds, payroll void, OCR `subtotal_cents`).
- **Next:** Kevin's 20 new guides (Nov 1 2026), built one at a time. Order: Customer Search → Duplicate Review (two guides,
  one screen) → Customer Timeline → Customer Intelligence → Churn Watch → Rebooking → Service Recommendations →
  Customer AI Settings → Review & Reputation → Reputation Settings → AI OCR Receipt Scanner → Receipt Document
  Recognition → AI Plans → AI Usage Limits → AI Analytics & Forecasting → AI Scheduling Optimizer → Checkout Upsell
  Settings → Voice Transcription Settings → Voice Transcription Follow-Ups. (Guide 27, AI Center, is still open too.)
- **Done: Customer Search** (guide 1): `pos/customer-search` routes, migration 760, POS screen rebuilt, EN/VI.
  pgtest 20/20, screen 6/6. Doc: `docs/customers/CUSTOMER_SEARCH.md`.
- **Done: Duplicate Review** (guides 2a + 2b): `pos/duplicate-review` routes, migration 761, POS screen rebuilt, EN/VI.
  - The screenshot's "Strong" came from a blank phone counted as a match. Both the new rule and the old AI endpoint are fixed.
  - Merge = the canonical merge (now `customers/customer-merge.ts`), with a preview hash, idempotency key and acknowledgements.
  - Tests: pgtest 22/22, real-Postgres races 2/2, screen 9/9. Doc: `docs/customers/DUPLICATE_REVIEW.md`.
  - Two old routes with no caller are retired (pinned in tests).
- **Real Postgres is available in the sandbox:** `/usr/lib/postgresql/16` (initdb, port 55432, `PG_RACE_URL`). The race lanes
  can be judged here now.
- **Done: Customer Timeline** (guide 3): `pos/customer-timeline` routes and migration 762.
  - Events are read live from 14 source tables; there is no projection table.
  - Search and the summary reuse Customer Search. Money and messages are shown by role.
  - Tests: pgtest 12/12, screen 6/6. Doc: `docs/customers/CUSTOMER_TIMELINE.md`.
- **Done: Customer Intelligence** (guide 4): `pos/customer-intelligence` routes and migration 763.
  - The 15/1/0 counts were correct: four of the six states were never shown. They now reconcile on screen.
  - A set-based scan uses the assistant's own rules; there is no 300 cap.
  - Tests: pgtest 9/9 (identical to the old aggregate), screen 6/6. Doc: `docs/ai/CUSTOMER_INTELLIGENCE.md`.
- **Done: Churn Watch** (guide 5): `pos/churn-watch` routes and migration 764.
  - Uses the existing `evaluateChurnRisk` inside the shared Intelligence scan, plus a review workflow; Data Unavailable is never shown as zero.
  - Tests: pgtest 10/10, screen 6/6. Doc: `docs/ai/CHURN_WATCH.md`.
- **Done: Rebooking Opportunities** (guide 6): `pos/rebooking` routes and migration 765.
  - Same shared evaluation (rule `ci-2026-11-02c` adds the return window and "opportunity created"); upcoming bookings are read live.
  - "Open AI Booking Assistant" = a one-use prefill of POS → Booking (re-checked on the server; never an appointment).
  - Tests: pgtest 14/14, screen 7/7, handoff 3/3. Doc: `docs/ai/REBOOKING_OPPORTUNITIES.md`.
- **Done: Service Recommendations** (guide 7): `pos/service-recommendations` routes and migration 766.
  - The assistant's `recommendServices`, now keyed by catalog service id and stored per suggestion; prices, add-ons, qualifications and bookings are read live.
  - Service-level "Already Booked"; "Open AI Booking Assistant" = the same one-use prefill (re-checks qualification + calendar).
  - Tests: pgtest 13/13, screen 7/7. Doc: `docs/ai/SERVICE_RECOMMENDATIONS.md`.
- **Done: Customer AI Settings** (guide 8): `pos/customer-ai-settings` routes and migration 767.
  - Fixed: the settings read failed OPEN (DB error = enabled past a Disable); Enable/Disable wiped the thresholds; no version / history.
  - Provenance, propagation, subscription shown apart; version-checked writes + append-only history; preview; health check. Old GET/PUT settings retired (pinned).
  - Tests: pgtest 12/12, screen 6/6. Doc: `docs/ai/CUSTOMER_AI_SETTINGS.md`.
- **Done: Review & Reputation** (guide 9): `pos/reputation` read routes and migration 768; writes stay on the existing workflow routes.
  - Fixed: "Awaiting approval" and "Response rate" were always 0 (the review's response column was never updated); store writes
    swallowed errors (Approve could say "approved" without saving); AI drafts used browser-sent text; approvals stored the review
    id as the draft id; the average rating showed rounded to a whole star.
  - One metrics definition for cards / trends / branches; full review overlay with role-gated customer link; check. Six old
    read routes retired (pinned).
  - Tests: pgtest 11/11, routes 3/3, reputation suite 54/54, screen 8/8. Doc: `docs/ai/REVIEW_REPUTATION.md`.
- **Done: Review & Reputation Settings** (guide 10): `pos/reputation-settings` routes and migration 769.
  - Fixed: the settings read failed OPEN; Save swallowed errors ("Saved" without saving) and had no version check; drafting
    ignored the assistant switch; the auto-reply gate ignored "Require approval"; quiet hours used the server clock, not the salon's.
  - Sources, operational state, what actually runs (no auto-reply job, no request sender, no reminder sender); safe merged saves
    with conflict refusal + version + append-only History (the existing config-versions log) + audit; check. Old GET/PUT retired (pinned).
  - Tests: pgtest 12/12, routes 4/4, reputation suite 71/71, screen 7/7. Doc: `docs/ai/REVIEW_REPUTATION_SETTINGS.md`.
- **Done: AI OCR Receipt Scanner** (guide 11): `pos/receipt-center` read routes and migration 770.
  - Fixed: every AI add-on page showed "On trial" + "Limited" + "trial ended" at once — it now reads the honest usage-screen
    state (price the salon pays, current-period usage + reset date, trial end, confirmed + idempotent Start trial / Cancel).
  - Scanner dashboard: four defined cards, stuck/failed counts, searchable history with four status tracks, read-only receipt
    detail linking to Receipt Review, Check OCR System. Nothing posts or changes stock from this page.
  - Tests: pgtest 7/7, screen 5/5, package screen 4/4 + 1. Doc: `docs/ai/RECEIPT_SCANNER.md`.
- **Done: Receipt Document Recognition** (guide 12): the Receipt Review queues read `pos/receipt-center` (no migration).
  - Fixed: every tab showed every document (the POS sent `status`, the API reads `pipelineState`); "in review" had no tab; the six
    cards were counted from 200 rows; a failed read showed "Nothing here"; Return/Reject sent fixed English and lost the reason.
  - Exact queues with search / dates / pages, real counts, error states, reason prompts, check, `?doc=` deep link. Old list retired.
  - Tests: pgtest 8/8, routes 2/2, screen 6/6 + 4/4. Doc: `docs/ai/RECEIPT_REVIEW.md`.
- **Done: AI Plans** (guide 13): no migration.
  - Fixed: lapsed plan trials showed "On trial"; the plan path re-trialled cancelled packages / re-opened a cancelled plan's trial
    (unlimited free months); Cancel swallowed errors and answered "ok"; catalog reads turned DB errors into "not subscribed / 0 used".
  - Honest plan state + trial dates, confirmations, no-discount note, Individual assistants link. Tests: pgtest 5/5, screen 3/3.
  - Not built (decisions): Super Admin per-assistant price editor; paid self-serve purchase (needs a billing provider); billing history.
  - Doc: `docs/ai/AI_PLANS.md`.
- **Done: AI Usage Limits** (guide 14): the page was already rebuilt (Oct 30 guide); added Check AI Usage & Subscriptions
  (migration 771) — names stale trial rows, AI calls after a trial ended / after cancelling, the cost basis. Fixed the raw
  "forbidden" 403 text and two screen tests that failed on the untouched tree (no router). Doc: `docs/ai/AI_USAGE_HEALTH.md`.
- **Done: AI Analytics & Forecasting** (guide 15): the appointment series came from the sales report (paid-ticket days,
  quiet days missing, UTC) — now from the booking calendar, salon-day zero-filled to yesterday; revenue zero-filled; readiness
  endpoint + panel. Nov 2: forecast history (`/pos/ai-analytics/center/*`: search, type / status, presets + From/To calendars,
  pages, forecast vs actual) and Check AI Analytics & Forecasting System (migration 776). Doc: `docs/ai/AI_FORECASTING.md`.
- **Done: AI Scheduling Optimizer** (guide 16 — docs/ai/SCHEDULING_OPTIMIZER.md). 
- **Done: Checkout Upsell Settings** (guide 17 — docs/ai/CHECKOUT_UPSELL_SETTINGS.md). 
- **Done: Voice Transcription Settings** (guide 18 — docs/ai/VOICE_TRANSCRIPTION_SETTINGS.md). 
- **Done: Voice Transcription Follow-Ups** (guide 19 — docs/ai/VOICE_TRANSCRIPTION_FOLLOW_UPS.md). **Next: AI Center** (guide 27) — BLOCKED: its guide text is not in the uploaded files; waiting on Kevin.
- **Decisions for Kevin** (collected; he asked to decide after everything is built):
  1. Should Global Rewards `/pos/loyalty/network/*` get the `@RequireFeature('loyalty')` plan gate?
  2. Duplicate merge: should a source's gift cards and saved-card references keep moving to the kept profile (today's
     behaviour, shown as acknowledgements), or should they BLOCK the merge until handled in Gift Cards / Checkout?
  3. Rebooking: any future appointment suppresses an opportunity today (the existing rule). The guide says an unrelated
     booked service should not. Change it (it also changes the Customer Intelligence and Churn Watch numbers) or keep it?
  4. Super Admin per-salon threshold overrides and a per-salon emergency switch: build them (the old Settings note promised
     them), or keep Super Admin at the package-wide switch only?
  5. Review replies: drafting and approving use the same manage permission, so one person can draft and approve their own
     reply. Split them (a separate approve permission, and "drafter cannot approve") or keep one permission?
  6. Review requests: requests are scheduled at checkout but no sender runs, so nothing is sent. Build the sender (consent,
     quiet hours, frequency cap, salon Twilio) and the one-reminder sender, or keep requests off and say so (today's screens say so)?
  7. Automatic replies: nothing runs them. Build the job (only with approval OFF, clean 5-star only), or remove the control?
  8. Owner app AI packages still read the older `/tenant/ai/packages` list (it shows "not subscribed" on a database error).
     Move it to the honest usage-screen state like the POS pages?
  9. AI prices: build a Super Admin per-assistant price editor (prices are in code today; plan override/discount exists)?
  10. Paid self-serve AI purchases need a recurring-billing integration — which provider (Stripe / Fiserv)?
  11. Forecasting: a passed forecast day gets its actual only when someone opens that forecast's tab. Add a nightly job to fill
      them? Also: a salon-wide login (no branch picked) never has its forecast kept (forecast_points needs a branch) — keep
      forecasts per branch only (today), or add salon-wide runs?
  12. Turn on the voice retention deletion job in production (it is off by default)?
  13. Allow settings saves (upsell on/off, voice retention, raw text) when the AI subscription has lapsed?
  14. Connect the five dormant upsell categories (retail, loyalty enrollment, loyalty redemption, gift cards, rebooking) to real data?
  15. Add a retry queue for call-recording deletions the provider did not confirm?
## The 20 AI guides of Nov 3 2026 — all built

Kevin uploaded 20 PDFs (Nov 3): voice search + call history, Review / Reputation assistant, Inventory (spec + guide), Fraud &
Money Protection (+ settings, rules & detection, investigations, alerts), Checkout Upsell assistant, Customer Profile assistant,
the Marketing family (assistant, Campaign Builder, Message Studio, Audience Builder, Campaign Results), AI Business Reports and
AI Business Alerts. Every one is built (commits `afc27ba`, `4c4b65b`, `fd6ac68`, `6b48de7`).
Docs: `docs/ai/VOICE_SEARCH_AND_CALL_HISTORY.md`, `AI_ASSISTANT_PAGES.md`, `MONEY_PROTECTION.md`, `AI_INVENTORY_ASSISTANT.md`,
`AI_MARKETING_ASSISTANT.md`, `AI_BUSINESS_REPORTS_AND_ALERTS.md`. Migrations 777–781.

Root-cause fixes found on the way (each pinned by a test):
- **The canonical Sales Report ignored the period** (`preset` without from/to → last 7 days; the Sales Report screen sends
  `period`, which was dropped). Every AI Business tool, report and alert was the same 7 days. Fixed at the source.
- **Marketing "Message cost to date" was the sum of campaign BUDGETS** — the photographed "$100 with 0 sent".
- **The old AI marketing approve route scheduled a campaign with no Campaign Center approval or audience snapshot**, and the
  send sweep then sent it. It now goes through the send-readiness rule; the builder saves into Campaign Center.
- **AI marketing "lapsed" counted a customer who came back yesterday** — now the Customer Retention rule.
- Inventory: a salon-wide login read every product as out of stock. Money Protection, voice and the assistant pages: see their docs.

More decisions for Kevin (continue the numbering above):
  16. Turn on scheduled Money Protection detection (`AI_MONEY_PROTECTION_DETECTION_ENABLED=1`)?
  17. Money Protection: restrict the investigation "assign" route to the branch's active staff?
  18. Inventory: the Low Stock / Reorder / Slow-Moving tabs for a salon-wide login (today one branch's view)?
  19. Checkout "missed-service review" and customer-note drafting (Customer Profile guide) — build them?
  20. Marketing: enforce the campaign budget in the send worker (today shown and checked only)?
  21. Marketing: a per-customer frequency cap at send time (e.g. one campaign message per 7 days)?
  22. Marketing: per-customer personalization in the sender (`{{customer_first_name}}`, booking links)? Today only
      `{salon_name}` / `{offer}`; Message Studio drafts with other tokens are refused before saving.
  23. AI Business Reports on a schedule — deliver in-app only, or email too?
  24. AI Business Alerts: automatic evaluation (each rule's hourly / daily) and SMS / email delivery — turn on, to whom?
  25. All-my-salons reports / alerts across separate salon accounts need an owner grant model that does not exist yet.
- **Sandbox note:** the full POS vitest run hangs here (POSQueueScreen hangs on the untouched tree too), so run only the
  related files. `roster-1000.test.tsx` already fails 2 tests on the untouched tree.

## Nov 3 2026 (afternoon) — 21 audit bugs fixed; 71 guides queued
Kevin sent four more batches on Nov 3 (A 20 AI guides, B 18 marketing/communications, C 13, D 20 — D re-sent at 11:09). The queue,
the status of every guide and the audit findings live in docs/GUIDE_QUEUE_2026-11-03.md and docs/GUIDE_AUDIT_FINDINGS_2026-11-03.md.
Done this session: every wrong-number / money / scope bug the audits found (reminders skipped confirmed appointments; reversed
token purchases stayed spendable; tip/tax refunds took points; '\D' broke phone search; email delivery rate; revenue-change
compared a month with itself; alert scope; settings overwritten by defaults; Rebooked counted cancellations; dead links; literal
\u2192 in English; AI Queue end day; resend without a fix; invented booking slots; health runs shared across branches; removed
tickets in coupon stats; deal cap; archived referrals; birthday branch scope; follow-up escalations). Migration 782 (alert archive).
Next: build the guides in queue order, starting with the AI Center directory (A1).

## Nov 3 2026 (evening) — batch A (A1–A20) worked through
Every batch-A guide now has a row in docs/GUIDE_QUEUE_2026-11-03.md saying what was built and what was NOT built (honest list per
guide). This round: A12 Business Setup (FAQ key reuse, branch-scoped eligibility, presets), A13 AI Follow-Ups (row version required,
overdue re-alert after due change / reopen, edit description + due), A14 Front Desk (per-branch route check, branch-scoped directory,
honest handoff / booking counts), A17 Reviews (KPIs follow filters), A18 Referrals (one tab per state), A19 Win-Back (email + accent +
multi-word search), A20 Birthdays (KPIs follow range, Feb 29 order). Gates: the 6 known failures only (lint 14 hooks warnings,
api-contract, strict-bodies-types, architecture mirrored types, pos-i18n) — silent-catch baseline re-ratcheted after review.
Later the same evening: batch B audit bugs (B1–B4, B9, B11, B13, B15, B16, B17/18) and batch D audit bugs (D1 Team Performance,
D2–D8 catalog / discounts, D6 membership renewal sweep, D9 inventory) fixed with tests — see the "Batch B progress" and "Batch D audit
bugs" sections of docs/GUIDE_QUEUE_2026-11-03.md. D13–D19 money bugs were already fixed in 6a69195. A comment edit had broken
ai-calendar-center.ts compile (fixed in 8e7cc03) — always run post.sh (it builds every module) before a bundle. Gates: the 5 known
failures only (lint 14 hooks warnings, api-contract, strict-bodies-types, architecture mirrored types, pos-i18n).
Next: B5–B8 audits + builds, then C1–C12 (audit inline), then the D guides' NOT-built lists.
(Older note:) batch B — B1–B4 audit bugs in GUIDE_AUDIT_FINDINGS (segments % escape, coupon dollar parsing, atomic draft, ticket lookup
branch), then B5–B8 (audit first), B9–B18; then batches C and D (not audited yet — audit inline).

## External — Kevin / his developer

The full table is `NEXT_STEPS.md` §2. In short:
- K-12 (his developer, in order).
- CardPointe MIDs + UAT (B-23).
- Tap to Pay: Apple entitlement, CommerceHub SDK + sandbox + per-location onboarding, a Mac, three iPhones.
- S3 / ClamAV / Textract.
- Twilio A2P + Verify, SendGrid, Firebase (new) + APNs, AI keys.
- Hosting: edge / WAF, Railway variables, DB roles, `_headers`, backups + a real restore, GitHub settings, digest pins, a pen test.
- Decisions: S-B11, S-A9, K-05 / K-07 … K-11 / K-13, and the deleted Tech App Face-ID auto-prompt patch.

## History (newest first, short)

- **Oct 26:**
  - Mandate audit (`ad4d2183`).
  - Malware scan (`eb691b77`).
  - Secure Tap / 200-tech / security internal gaps.
  - Outbox order fix.
  - M4-1.
  - Dead-code batch 1.
  - Kevin's decisions (`0d1f1db8`).
  - Gates green (`47c4044b`).
- **Oct 24:** M5 pilot 177/177 (`32049600` … `246df92c`), M4 close-out (`9191a704` … `ef7eb6bf`).
- **Oct 23 (night):** M6 Secure Tap to Pay (`cdcfe20d` … `e43c8b43`).
- **Oct 23:**
  - M1 payment recovery (`ab1ccc58`).
  - M2 exact-service eligibility (`085879c6`).
  - M3 OCR internals.
  - Developer merge + M4 (most).
  - Security Deep Scan (`c70f87c5` … `990aff06`).
  - Post-hardening proof `2975758d` (pilot 117/117, restore drill 12/12).

## Nov 3 2026 (late night) — D fixes + API gate sweep
See docs/GUIDE_QUEUE_2026-11-03.md, section "Nov 3 late night". New migrations: 785 (member numbers unique per salon),
786 (tenant-consistency triggers on 35 FKs of the new centers), 787 (validate two NOT VALID checks). apps/api gates still
failing by design until reviewed: role-matrix snapshot, route-domains wire-type ratchet, strict-bodies type proof (15).
The IDOR table now classifies every route but the new fixtures have not been run live (live-phase14-idor.mjs). Open product
question for Kevin: Customer Notifications / Email Center read `notifications` salon-wide although rows carry a branch.

## Nov 4 2026 — membership first payment + per-register cash drawers
- c80d642 D6 first payment: a priced plan without a trial starts PENDING; a confirmed payment (saved card through the
  salon's gateway, or a paid invoice) activates it in one transaction. Card charging needs MEMBERSHIP_AUTOBILL_ENABLED and
  the salon's gateway wired to MembershipChargePort; without them the POS says billing is not set up.
- f1458f9 D15 one drawer per register: migration 788 (payments.register_id from tickets.checkout_register_id), GET
  /pos/cash-drawer/registers, registerId on every drawer call (another location's register refused), POS picker.
- API gates now: role matrix, route domains, IDOR, strict-bodies all green; the ONLY red one is the api-contracts wire-type
  ratchet (774 untyped routes, none from Nov 4 work; not grandfathered).
- The full pos-web suite stalls in this sandbox (only 5 files in 28 min); the touched POS tests were run directly (green).

## Nov 4 2026 (later) — A6, A7, membership rollover, per-service tax, live IDOR
- Commits 8a5c84d (A6 + A7), 1a6d564 (membership), 9a2d583 (per-service tax, add-on route), 2a0e384 (live IDOR 11/11).
  Migrations 789–792.
- POS suite: run it in slices (`npx vitest run --shard=i/12`) — the single run stalls on this 2-CPU sandbox. 13 tests in 8
  files fail (list in docs/GUIDE_QUEUE_2026-11-03.md); slices 3 and 9 stall intermittently.
- Live IDOR: `DATABASE_URL=postgres://postgres@127.0.0.1:55432/aps node apps/api/scripts/live-phase14-idor.mjs` after
  `npm run build` in apps/api.

## Nov 4 2026 — batch E (7 new payment guides) + POS suite + gates
- Commits: 852d6cb (POS suite slices green; paged technician pickers), 13093f9 (batch E money / safety fixes), 14ae52d (E6
  Expenses rebuilt to the guide; the 3 hanging POS test files fixed), f4ab1c1 (API ratchets green again).
- Per-guide status and what is still open: docs/GUIDE_QUEUE_2026-11-03.md, section "Nov 4 2026 (10:14 / 10:15)".
- Next: the open items of E1–E5 and E7 (listed there), then batch A/C/D extras, then the 774-route wire-type backlog
  (check:api-contract is the one API gate still red). Expenses still needs the guide's browser screenshots at 1920×1080,
  1536×864, 1440×900 and 1366×768.
- Lesson: in this jsdom setup React's window.event can stay stale between tests and make an effect loop without yielding
  (the file then hangs with no output). The fixed files clear it per test (clearStaleWindowEvent).

## Nov 4 2026 (evening) — E1–E5, E7 open items
- Commits dfcf807 (E1/E2/E3), 57bd35b (E3/E4/E5/E7), dfd0c4e + c28218d (E7 reward rules, Manage Tiers — migrations 795, 796),
  4d87545 + f09cfff + c6fe4bd + bc76dd3 (E5 credit notes, customer filter / profile invoices, catalog lines, delivery —
  migrations 797, 798).
- E7 and E5 are complete to their guides. Real-Postgres race spec for reward stock:
  `PG_RACE_URL=postgres://postgres@127.0.0.1:55432/aps npx vitest run src/loyalty/loyalty-reward-stock.postgres-race.vitest.spec.ts`
  in modules/customers.
- Still open: E2 (processor choice at pairing, idempotency keys on pairing, filters, device audit history), E6 screenshots,
  batch A/C/D extras, A7 manager approval / alternative times, the 774-route wire-type backlog.

## Nov 4 2026 (night) — E2 / E6 / A7 / B1–B4 / D9
- E2, E6, A7 (alternatives + manager approval) and the B1–B4 marketing gaps are done (see GUIDE_QUEUE "Nov 4" lines;
  migrations 799, 800).
- D9 Inventory (5591134, 5e3f4fa, migration 801): transfers / counts / bottle changes / manual deduction are each one
  transaction; one low-stock rule; reorder subtracts committed POs; PO lines carry the supplier pack.
- State-machine gate green again: PAYMENT_REFUND now lives in @aipowersalon/payments (checkout re-exports it);
  new INVOICE_DELIVERY machine; gift card take-back / adjust go through GIFT_CARD.
- Still open (in order): D9 recipe unit conversion + gaps list; B9–B18, D1 gaps, A-row not-built items (A2–A5, A8–A20),
  batch C; the 774-route wire-type backlog.
- Later Nov 4 night: D9 recipe decimals (802); batch C (C1–C5) audited and its 16 bugs fixed (803 branch numbers); C5 Cancel
  Campaign. Open items per guide: docs/GUIDE_QUEUE_2026-11-03.md last bullet.
