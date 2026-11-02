# Loyalty & Rewards · Membership Overview · Customer Retention — build handoff (Oct 29 2026)

Three Front Desk POS screens rebuilt against the three Oct 29 specs
(`AI_PowerSalon_Loyalty_Rewards_Claude_Full_Build_Spec.pdf`, `AI_PowerSalon_Membership_Overview_Claude_Build_Spec.pdf`,
`AI_PowerSalon_Customer_Retention_Claude_Full_Build_Spec.pdf`) inside the existing codebase: same shell, sidebar and
top bar, the POS gold-and-cream design, English + Vietnamese through the existing POS i18n.

| Route | Screen | Layout (one screen at 100 % zoom, no page scroll) |
|---|---|---|
| `/tenant/customers/loyalty` | Loyalty & Rewards | header (Enroll Member · Create Reward · Settings) · 5 KPIs · Members by Tier \| Rewards Catalog · Loyalty Members \| Recent Redemptions · Quick Actions |
| `/tenant/customers/memberships` | Membership Overview | header (Create Membership Plan) · 5 KPIs · Plans \| Active Members \| Activity · Revenue \| Status \| Plan Distribution \| Top Services · 10 Quick Actions (2 × 5) |
| `/tenant/customers/retention` | Customer Retention | header (Campaign History) · 5 KPIs · segment chips · win-back table (search, sort, numbered pages) · selection bar (Select page · Select all matching · Clear · Send SMS to Selected) |

Every list pages **on the server** inside its panel; the page size is how many rows fit the panel right now (`useFitRows`),
so a list never grows the page. Pagers are numbered (`‹ 1 2 3 … 18 ›`, "Showing x–y of z").

## What changed, by spec requirement

### Loyalty & Rewards
- **KPIs** (`GET /pos/loyalty/overview`): Loyalty Members (+ new this month), Points Outstanding (checked against the
  ledger sum — the card says "Matches the points ledger" or shows the difference), Active Rewards (of total), Redemptions
  this month (pending · voided split; voids excluded), Points Redeemed this month (net of voids). One labelled period:
  this calendar month in the salon's time zone (footer of the page states it). Each card opens its list / dialog.
- **Members by Tier**: the tiers members actually carry (no invented tiers), count · % · points; tapping a tier filters
  Loyalty Members. **Manage Tiers** is read-only: there is no tier-rule table in the platform (see Blockers).
- **Rewards Catalog**: newest first, status filter, create / edit / activate-deactivate (existing `POST/PATCH
  /pos/loyalty/rewards`, validation unchanged), per-reward redemption history. A new reward is first on Page 1.
- **Loyalty Members**: newest enrolment first, search, tier filter; row actions Redeem, Adjust points, Points history;
  the name opens the customer profile (`/customers?customerId=…`).
- **Recent Redemptions**: newest first, status filter, detail overlay with the ledger entries; **Void** an unused
  (issued) code with a reason → points restored through the ledger, lifetime totals corrected, audited.
- **Writes** (`modules/customers/src/loyalty/loyalty-program.repository.ts`, all through `applyLoyaltyEntry` — the one
  ledger writer — under the per-customer advisory lock):
  - Enroll (`POST /pos/loyalty/enroll`, `pos.customers.loyalty.edit`): this salon's live customer only; a second
    enrolment is refused (`LOYALTY_ALREADY_ENROLLED`).
  - Adjust (`POST /pos/loyalty/adjust`): reason required, idempotency key = ledger source id (a double tap or retry posts
    once — verified in the browser: 2 POSTs, 1 ledger row), never below zero.
  - Redeem (`POST /pos/loyalty/redeem`): active reward worth something, enough points, exactly once (the key is the
    redemption id; reusing a key for a different reward is refused).
  - Void (`POST /pos/loyalty/redemptions/:id/void`, `pos.checkout.void` → owners / managers): only `issued`; the status
    write goes through the `LOYALTY_REDEMPTION` state machine (moved from checkout to `modules/customers`, now with
    `issued → void`; checkout re-exports it, its own moves are unchanged).
  - Audit: every committed mutation recorded through `AuditService` after commit (`loyalty.member_enrolled`,
    `points_adjusted`, `reward_redeemed`, `redemption_voided`).

### Membership Overview
- **KPIs** (existing `GET /pos/memberships/overview`, corrected): Total, Active (% of total), Revenue this month
  (succeeded payments settled this month + payment count), Expiring Soon (now … now + 7 days), Canceled This Month (both
  `canceled` and `cancelled` spellings; salon month). Each card opens its filtered list.
- **Analytics** with explicit populations: status breakdown now covers every status (denominator printed), plan
  distribution of current memberships (denominator printed), top services ranked for this month, revenue trend.
- **Operational panels**: Plans (Manage → plan detail: benefits of the current version, this month's performance, its
  members), Active Members (filter: active / all / expiring / canceled this month / paused / past due / trial; Manage →
  the existing manage modal), Activity (newest first). Each has **View All** → a searchable, numbered list
  (`GET /pos/memberships/members|activity|payments`).
- **All 10 Quick Actions work**: Add New Member (existing enrol flow), Create Plan (existing plan builder), Send Reminder
  (new review step `GET /pos/memberships/comms/reminders/preview` → then the existing run), Manage Discounts
  (`GET /pos/memberships/discounts`), Membership Report (in-page report from the same figures), Export Members /
  Payments / Redemptions (spreadsheet-safe CSV: BOM, CRLF, a cell starting with `= + - @` is prefixed with `'`), Plan
  Performance (`GET /pos/memberships/plan-performance`; what is not tracked is said so), Membership Settings.
- The enrol and plan-builder overlays gained `role="dialog"` and Escape-to-close.

### Customer Retention
- **The reported defect is fixed**: a customer with no completed visit is **Never Visited**, never "60+ days at risk"
  (a canceled ticket is not a visit). Cohorts come from `GET /pos/retention/*` (settled tickets only, refunds netted).
- **KPIs**: Returning Rate (returning ÷ visitors this month; "—" with "No visits this month yet" instead of a fake 0 %),
  Returning, New This Month (first visit; new profiles shown beside it), At Risk (visited before, away ≥ 60 days), Lapsed
  Value ("Historical spend of at-risk customers (net of refunds)"). Each opens its cohort.
- **Segments**: All, At Risk 60+, 90+, 180+, Never Visited, Recently Returned, SMS-Eligible (+ the KPI cohorts).
- **Order**: longest absence first (last visit ASC, customer id ASC); Never Visited by oldest profile; the current sort
  is printed; search and other sorts on the server.
- **Selection**: row (by customer id, kept across pages), Select page (eligible rows only, the note says how many were
  left out), **Select all matching** behind an explicit second confirmation (resolved on the server at preview against
  the filters as they are then; capped at 5,000), Clear. Selection is cleared when the cohort changes.
- **SMS** (`modules/customers/src/retention/`): preview → confirm → queue → individual texts → results.
  - Preview: consent (`marketing_sms_opt_in`), opt-out, missing / invalid phone, recently texted (7 days), duplicate
    destination, another salon's id — each excluded with its reason; the exact final text (salon name + "Reply STOP to
    opt out."), segments, the salon's sender, quiet hours, no guessed cost. Nothing is queued at preview.
  - Confirm (`POST /pos/retention/sms/campaigns`, `pos.marketing.manage`): idempotency key; revalidates every recipient
    (an audience that shrank needs a second confirmation); one durable job per recipient; audited.
  - Worker (`retention.sms.send`): re-checks consent / opt-out / phone at send time; `queued → submitting` committed
    before the provider call; a job that finds `submitting` marks the recipient `unknown` and **never re-sends**; sends
    through `TenantMessenger` (the salon's own Twilio account or the salon's shared-sender number — never another salon).
  - Campaign History: per-recipient Queued / Sent / Delivered / Undelivered / Blocked / Failed / Unknown; Delivered comes
    only from the signed Twilio status callback (no carrier report → never "delivered").

## Files
Backend: `modules/customers/src/loyalty/loyalty-program.{repository,controller}.ts`, `loyalty-redemption-machine.ts`,
`modules/customers/src/retention/{retention.repository,retention-sms.service,retention-sms.worker,retention.controller}.ts`,
`modules/customers/src/{customers/customers.module.ts,index.ts,request-schemas.ts}`,
`modules/memberships/src/{membership-lists.ts,membership-comms.*,memberships.kysely.repository.ts,memberships.dto.ts,memberships.module.ts}`,
`modules/checkout/src/checkout/checkout-lifecycles.ts` (re-export), `packages/api-contracts/src/errors.ts` (18 codes),
migrations `709_retention_sms_campaigns.sql`, `710_loyalty_membership_list_indexes.sql` (CONCURRENTLY, no-transaction).
Frontend: `apps/pos-web/src/screens/POS{Loyalty,Memberships,Retention}Screen.tsx`, `components/FitKit.tsx`,
`api/pos{Loyalty,Memberships,Retention}Api.ts`, `styles.css` (`.work.fit` block, scoped to these pages),
`i18n/ns/{people,errors}.{en,vi}.ts`, `MembershipEnrollModal.tsx`, `MembershipPlanBuilder.tsx`.
Generated / review records: `apps/api/openapi/manifest.txt` (+24 routes), `docs/security/SECURITY_ATTACK_SURFACE.md`
and `attack-surface-routes.csv`, `apps/{owner,tech}-web/src/i18n/errors.generated.ts`,
`docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` (section "Oct 29 2026 … (A36)", 395 rows for Kevin's review).
Tooling: `tooling/customers-one-screen/` (seed, live server, fit measurement, E2E, scale check, results), and the
no-node_modules stand-ins in `tooling/full-system-test/` (Kysely raw-SQL compiler with `$n` placeholders /
`sql.join` / `sql.ref`, transactions on the dialect driver; PGlite stand-in: JS arrays as PostgreSQL arrays,
`uuid[]` parsing, `FST_PG_TEMPLATE` to clone the migrated database instead of replaying 649 migrations).

## Verification (what was actually run)
| Check | Result |
|---|---|
| New pgtests on PostgreSQL 16 (real schema): `loyalty-program`, `retention`, `membership-lists` | 6/6, 10/10, 4/4 |
| Existing loyalty / membership specs (stand-in runner) | all pass except 3 files that fail identically on the unmodified HEAD (query-builder / fake-timer / decorator stand-in limits) |
| Repository gates `node tooling/ci/run-gates.mjs` | 12 fail vs 15 on the unmodified HEAD — every remaining failure is environmental (no node_modules: vite, eslint, `@types/react`, module resolution); all gates the change touches pass: tenant, error-text, error-codes, list-queries, as-any, silent-catch, raw-sql-inputs, state-transitions, audit-writers, openapi, attack-surface, no-print, pos-i18n |
| Screen fit (`tooling/customers-one-screen/measure.mjs`) — 3 pages × {pilot EN, pilot VI, empty salon} × 1920×945, 1536×729, 1440×765, 1366×633 | 36/36 pass (`results/final/measurements.json`): no document or page-container overflow, every KPI / panel / pager / quick action painted inside the viewport, no touch target under 44 px, no console errors |
| Browser E2E (`interact.mjs`, real controllers + SQL) | 28/28 — enrol → first on Page 1; new reward first on Page 1; double-tap adjust = one ledger row; redeem; void (audited); numbered pages; Escape + focus return; Never Visited separate; longest absence first; cross-page selection → preview → confirm → 3 individual texts with salon name + STOP line; no invented "delivered"; replayed confirmation = same campaign, no new jobs; select-all-matching confirmation; all 10 membership quick actions (3 CSV downloads formula-safe); KPI click-through; Vietnamese screens |
| Roles (live server) | FRONT_DESK: adjust ✓, void ✗ 403, SMS ✗ 403 · MANAGER: void ✓, SMS ✓ · TECHNICIAN: read-only |
| Scale (`perf.mjs`): 100,000 customers, 350,000 tickets, 40,000 loyalty members, 10,000 memberships | loyalty reads ≤ 0.2 s; membership reads ≤ 0.07 s; retention summary 0.64 s, at-risk page 1 0.47 s, page 500 0.84 s (server-side, median of 3) |

Viewports are the CSS page a 100 % zoom browser leaves on each screen with the tab strip, address bar and Windows
taskbar visible (1920×1080 → 1920×945, the repo's primary target; 1366×768 → 1366×633 is the hardest case: lists show
2–4 rows there and page, typography is not shrunk).

The harness is not production: no Nest guards / ListQuery interceptor (controller methods are called with the session
context; request bodies go through the real `ValidatedBody` pipes), reward create/edit use a raw-SQL adapter under the
real `LoyaltyService` (the loyalty module's query builder needs node_modules), SMS go to a recording messenger, and the
membership enrol / plan builder overlays were opened and closed but not submitted (their APIs use the query builder).

## Blockers / decisions for Kevin
1. **Tier rules** — there is no tier-qualification configuration anywhere in the platform. Manage Tiers shows the
   tiers members carry and says "Not configured"; automatic tier rules need a product decision + schema.
2. **Rewards catalogue permission** — the loyalty module gates create/edit on `pos.settings.edit` ("owners / managers",
   Decision 15), but the MANAGER role does not hold `settings.edit` in `packages/permissions` rbac, so managers cannot
   edit rewards today. Unchanged here; the void uses `pos.checkout.void` (managers hold it).
3. **Plan edit / archive from the POS** — the builder only creates; editing benefits means publishing a new version
   (`POST /pos/memberships/plans/:id/versions`), which has no UI yet. The plan dialog says so.
4. **Retention filters** — segments, search and five sorts are server-side; range filters (visits, spend, last-visit
   date) from §07 are not built yet.
5. **Live SMS** was never sent: per the spec no bulk marketing traffic without authorization. The send path was
   verified with a recording messenger; a staging test with the salon's own Twilio account (and A2P status) is next.
6. **Loyalty Reports** opens the existing Customers report (`/tenant/reports/customers`); there is no loyalty-specific
   report screen.
7. The Customer Directory commit `241ab0bb` is not in this checkout (its bundle was not re-attached); this work is on
   `36dc8d40`. Both touch `people.{en,vi}.ts`, `styles.css` and `VI_NEW_STRINGS_FOR_REVIEW.md` (append-only blocks) —
   expect a trivial merge.

## Not pushed
Committed locally on `merge-github-main`; nothing pushed (K-12 steps 1–5 of `SECURITY_REMAINING_ACTIONS.md §A` first).
Migrations 709 / 710 run with the normal migration runner (`apps/api/db/migrations`), 710 outside a transaction.
