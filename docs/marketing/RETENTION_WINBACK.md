# Customer Retention & Win-Back — Complete Build Guide (Oct 30 2026), guide 16 of 20

Route: `/tenant/marketing/win-back` (and `/tenant/customers/retention`), both rendering `POSRetentionScreen`. Built on the existing
Retention module. Nothing here or anywhere in this build sends a message. Campaigns are still approved and launched only in
Campaign Center.

## The photographed P0 (13 "At Risk" rows with Last Visit = Never, 0 visits, $0.00)

**Root cause:** the pre-Oct-29 win-back list used "no visit in 60+ days". A NULL last visit made every never-visited profile qualify.

- The Oct 29 Retention mandate fixed this before this guide.
  - `RetentionRepository.base()` classifies `visits = 0 → never_visited`, so a never-visited customer can never be At Risk.
  - The existing pgtest asserts it (`retention-guide.pgtest` "Never Visited is its own segment").
- Re-verified for this guide:
  - **Database test:** `winback-center.pgtest` R01 passes. A customer whose only ticket was later removed also counts as Never Visited.
  - **Browser test:** E2E step 1 passes. At Risk and Never Visited on screen equal an independent SQL count, and no At Risk row shows "Never".
- **One gap this guide closed:** the win-back SMS worker re-checked consent, opt-out, booking and phone at send time, but not "still has a completed visit".
  - If a ticket is voided or removed after confirmation, a zero-visit customer could stay queued.
  - The worker now blocks it as `never_visited`.
  - A mutation check proves it: without the block, the provider is called.

## What existed before this guide (reused, not rebuilt)

| Capability | Where | Status |
|---|---|---|
| Segments: Never / Active / Approaching / At Risk / Returning / Recovered, salon thresholds (versioned) | `retention.repository.ts` | COMPLETED_AND_VERIFIED (existing suites re-run) |
| Server search (name, phone digits, customer / ticket / appointment id, service) beyond page 1 | same | COMPLETED_AND_VERIFIED |
| Period, date basis and month calendar (`PeriodBar`); pages 10 / 20 / 50 with stable sorts; newest profile first in All / Never | same + screen | COMPLETED_AND_VERIFIED |
| Smart Priority, suppression of upcoming bookings, consent-checked SMS preview → confirm → per-recipient worker | `retention-sms.*` | COMPLETED_AND_VERIFIED |
| Recovery tracking (observational, last touch within the window) | `recovery()` | COMPLETED_AND_VERIFIED |
| Nightly snapshots (no invented history), branch activity scope, audited CSV export | `retention-snapshots.ts` | COMPLETED_AND_VERIFIED |
| Overlay with visit evidence, upcoming bookings, consent, outreach; Open Booking by customer id | screen | COMPLETED_AND_VERIFIED |

## Built by this guide

| Item (guide §) | Change | Status |
|---|---|---|
| §05 "Already Rebooked" and "Contacted" segments plus counts | `rebooked` = ≥1 visit and an upcoming booking. `contacted` = a marketing notification submitted in the period (Retention SMS or Campaign Center, any channel; failed / blocked texts don't count). | COMPLETED_AND_VERIFIED |
| §04 / §12 Contacted and Delivered | Strip under the KPIs. **Delivered** counts only provider evidence (`notifications.status = 'delivered'`, or delivery events). With no evidence on record it shows **Unknown**, never 0. | COMPLETED_AND_VERIFIED |
| §06 filters | Inactivity 30 / 60 / 90 / 120 or custom days (1–3650; never visited is never "inactive"). Email eligible / not / opted out. Future booking yes / no. Server-side; pagination resets to page 1. | COMPLETED_AND_VERIFIED |
| One marketing-email rule | `email_status` (no email / invalid / no consent / unsubscribed) now lives in the shared `base()`. Customer Segments uses it instead of its own copy. | COMPLETED_AND_VERIFIED |
| §08 overlay | Adds Communications: every message for the customer, any channel, with state delivered / failed / skipped / queued / submitted. "Delivered" appears only with evidence; message bodies are not returned. Also adds marketing-email consent and refunds. | COMPLETED_AND_VERIFIED |
| §09 Check Retention Data | `POST /pos/retention/health-check`, `GET /pos/retention/health`. Read-only, with nine checks; details below. | COMPLETED_AND_VERIFIED |
| §10 / §11 Win-Back Assistant | `POST /pos/retention/winback/plan` and `POST /pos/retention/winback/audience`; details below. | COMPLETED_AND_VERIFIED |
| Campaign Center assistant drift | Its audience count counted removed tickets as visits. Fixed with `removed_at is null`. | COMPLETED_AND_VERIFIED (code + regression) |

**Check Retention Data — the nine checks:**
- never visited not lapsed;
- queued win-back text to a never-visited customer;
- visit timestamps (no paid time / future);
- visits linked to a missing customer;
- possible double checkouts (same customer and amount within 5 minutes; review only, never auto-edit);
- Segments vs Retention counts;
- Lapsed Value recounted independently;
- snapshots (no snapshot = Unknown, never invented);
- text sender readiness.

Each check reports:
- its status: Ready, Attention required, Failed or Unknown;
- the affected count and up to 5 customers of this salon;
- the cause and the fix;
- when it was last Ready.

Every run is recorded in `retention_health_runs` (migration 749). Manual runs are limited to one per salon per minute, decided under a per-salon advisory lock.

**Win-Back Assistant:**
- **Goals:** inactive (salon At Risk threshold), 90+ days, before they lapse (Approaching), slow weekdays (regulars), promote a past service.
- **What it returns:**
  - the factual criteria;
  - eligible and excluded counts with reasons (the Segments `win_back` verdict);
  - never-visited customers only as a separate, not-included count;
  - a suggested message labelled "Suggested";
  - active offers (read-only), the send window from quiet hours, and a cost only when a per-text rate is configured.
- **Saving:** the audience is recomputed on the server and saved as an UNSENT Segments `win_back` audience draft. It is idempotent and audited (`retention.winback.audience_saved`).
- **Creating the campaign:** the screen then creates a Campaign Center draft and attaches the audience. Approval and launch stay in Campaign Center.

Files:
- **Backend:**
  - `modules/customers/src/retention/winback-center.ts` (new);
  - `retention.repository.ts`, `retention.controller.ts`, `retention-sms.worker.ts`;
  - `segments/segments.repository.ts` (shared email rule; `priceCents` public);
  - `request-schemas.ts`;
  - `packages/api-contracts/src/errors.ts`: `RETENTION_INVALID_FILTER`, `WINBACK_GOAL_INVALID`, `WINBACK_AUDIENCE_EMPTY`, `WINBACK_HEALTH_RATE_LIMITED`;
  - `campaign-center.ts` (removed tickets).
- **Migration:** `749_retention_winback_center.sql` (additive). Rollback: `DROP TABLE retention_health_runs`.
- **POS:**
  - `RetentionWinBack.tsx` (new: health and assistant dialogs);
  - `POSRetentionScreen.tsx` (tabs, filters, strip, overlay, buttons);
  - `posRetentionApi.ts`;
  - `ns/winback.{en,vi}.ts` (unique `wb.*` keys);
  - `styles.css`.
- **Generated:** `kysely.types.ts`, ownership override and registry, openapi manifest, attack surface, owner/tech error catalogs.

## Tests (31 Oct 2026, this workspace)

| Suite | Command | Result |
|---|---|---|
| `winback-center.pgtest` | `FST_PG_TEMPLATE=aps REPO_ROOT=$PWD bash tooling/full-system-test/unit-standin/run.sh $PWD modules/customers/src/retention/winback-center.pgtest.vitest.spec.ts` | 10/10 |
| `winback-center.postgres-race` (4 real sessions) | `PG_RACE_URL=postgres://postgres@127.0.0.1:55432/<db> … run.sh $PWD …postgres-race…` | 2/2 |
| Mutation: send-time never-visited block removed | same pgtest | 9/10 — the worker test fails |
| Mutation: advisory lock removed | race spec | 1/2 — the health-run race fails |
| Regression: segments, retention, retention-guide, retention-round2, campaign-center | stand-in runner | 13/13, 10/10, 12/12, 14/14, 14/14 |
| Win-back browser test `wb` (EN/VI, Front Desk, 4 viewports) | `node tooling/checkout-one-screen/build.mjs && node tooling/catalog-one-screen/interact.mjs wb-e2e wb` | 8/8 |
| Combined marketing + messaging browser run and `comms` | `interact.mjs mkt-combined seg,cp,do,promo,cc,mg,mt,cn,pm,bv,ms,eod,fuq,rmd,em,wb` | 170/170 (16 sections) · `comms` 12/12 |

The two mutation checks show what each fix guards:
- Without the send-time never-visited block, the worker calls the provider.
- Without the advisory lock, every tap of Check Retention Data records its own run.

**Gates:** 58 of 62 pass (52 through npm, 6 through the stand-in loader). lint, boot, api-contract and strict-bodies-types can't run here.
- The first run flagged `as-any`: a SQL column alias literally named `any`, now renamed.
- `db-ownership` needed the new table's domain, now added to overrides.

## Not verified / blocked

- **IMPLEMENTED_NOT_VERIFIED (needs CI):**
  - the POS and API type-checks;
  - `POSRetentionScreen.test.tsx` (unchanged, still mocks the old summary shape, all fields optional);
  - the 4 gates above.
- **BLOCKED_EXTERNAL:**
  - real SMS and email delivery and provider callbacks (only stored evidence was used);
  - the physical ASUS 27″ screen (browser viewports only);
  - migration 749 on staging and production (owner approval).
- **NOT_IMPLEMENTED:**
  - a scheduled (automatic) data check — runs are manual;
  - win-back by email through Retention's own sender. Email goes through the assistant → Campaign Center path.

## Open owner decisions

1. Run "Check Retention Data" automatically every night, with an alert when a check fails?
2. Should a failed check, such as a queued text to a never-visited customer, also cancel the pending win-back campaign automatically? Today the worker blocks each such text at send time and the check only reports it.
3. Is a 5-minute same-amount window the right definition of a "possible double checkout"?
