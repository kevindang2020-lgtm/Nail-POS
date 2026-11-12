# Optional extras from Kevin's 160 SUNMI PDFs — backlog (Kevin, Nov 9 2026: "build all of it")

Extracted from the PDFs' "additional / additive / optional recommendations" sections by `tooling/i18n`-independent parser
(`/tmp/extras/parse2.py`, kept in this doc's history). Some rows are parser noise from the main spec (marked NOISE when
triaged). Status: **TODO** · **BUILT** (built + tested this arc, commit named) · **EXISTS** (already in the product, where) · **NOISE**.

Nothing is marked BUILT or EXISTS without the code being opened and the test named.

## Progress (updated Nov 11 2026, 03:30 New York)

| Status | Rows |
|---|---|
| BUILT this arc | 109 (incl. part) |
| EXISTS (opened and named) | 739 (incl. part) |
| NOISE (parser picked up acceptance / instruction text) | 436 |
| TODO | 530 |
| REMOVED (Kevin: no receipt printer) | 4 |

Built so far:
1. **POS saved views** (`ae62e1f1`): migration 844, `pos/me/saved-views`, `components/SavedViews`, wired into 9 screens.
2. **Shared read-only Check … System** (this commit): `GET pos/system-checks/<page>` for expenses, invoices, settlements,
   payments, discounts, catalog, inventory, technicians, memberships — 53 checks, each a count of problem rows; a rule
   the table already enforces is not repeated; the salon's day is its branch's time zone. Mounted on 16 screens.
3. **Check System, wave 2**: service flow (Serving, Service Done), terminals (Payment Terminals), approvals (Approvals);
   Appointment History's own check gains "upcoming booking with a failed deposit". Groups that would have duplicated an
   existing check were dropped: campaigns (Marketing health), cash (Check drawer), follow-ups (End-of-Day health),
   past-open appointments (Appointment History). Checks the database already enforces were removed (double booking —
   exclusion constraint; self-approval — CHECK; appointment end before start — CHECK; duplicate cash movement — unique).
4. **Record timelines (from data already recorded — nothing inferred)**: expense History (expense_history, now with the
   person's name, salon-scoped); invoice Timeline (created / sent / payments / credits / paid / voided); payment
   timeline in Transactions (server, recorded payment / refund / settlement / deposit times). Already present and marked
   EXISTS: Deals & Offers History / Approvals / Redemptions tabs, End-of-Day Cash hand-off events, Price History.
   Not built: a generic per-record history for every page — the audit tables name record types differently per module
   (audit_events.resource_type vs audit_logs.entity_type), so each page needs its own mapping.

Decisions:
- **Comfortable / Compact density switch — built Nov 10 2026 as opt-in Compact spacing** (profile menu, per device;
  Standard = the certified spacing stays default; Compact tightens gaps/padding only, never fonts or touch targets —
  `shell/spacingPref.ts`, styles.css `html[data-spacing="compact"]`). The ~40 rows that ask for it are not re-marked one
  by one yet.
**Rows: 1818** across 153 PDFs.


## Invoices Management (14)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-click Invoices Health Checker Verify API wiring, KPI reconciliation, missing customer links, invalid dates, status transitions, paging, payment records, and all available invoice actions; explain failing source IDs. | BUILT — shared read-only Check Invoices System (GET pos/system-checks/invoices, components/SystemCheck); pgtest 5/5 + PG16 run |
| 02 | Automatic Screen Fit Health Checker Admin/dev diagnostic that captures CSS viewport, panel bounds, overflow, clipped controls, touch target issues and layout screenshots at supported resolutions. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | Full Invoice Timeline Inside Invoice Details, show issue, send, open (if supported), partial/full payments, void/credit events, user actor and authoritative timestamps. | BUILT — Invoice detail → Timeline (created, sent, each payment with who recorded it, credit notes, paid, voided) from recorded dates only; InvoiceTimeline test 2/2 |
| 04 | Unpaid & Overdue Priority View Add an optional status view for genuinely outstanding invoices, based on validated due date and unpaid balance; do not overwrite the default newest-first behavior. | EXISTS — status filter "Overdue" + Outstanding/Overdue KPIs (POSInvoicesScreen STATUSES, kpi-outstanding); default stays newest first |
| 05 | Customer Identity Integrity Checker Detect invalid customer joins, missing bill-to snapshots, tenant-mismatched links and stale display mapping; recommend approved repairs without guessing identities. | BUILT — shared read-only Check Invoices System (GET pos/system-checks/invoices, components/SystemCheck); pgtest 5/5 + PG16 run |
| 06 | Safe Payment Preview Before recording an external/cash payment, show balance before/after, method, amount, reference and explicit confirmation. No automatic card charge. | BUILT — payment dialog shows total, paid so far, balance due AND "Balance after this payment" before Confirm (pay-balance-after); no card charge; POSInvoicesScreen.test |
| 07 | Readable Receivable Explanations Explain why an invoice is Outstanding, Partially Paid, Paid, Overdue or Void by linking to posted payments and credits. Owner-requested specification • November 2026 Addendum page 14 AI P | BUILT — invoice detail "why this status" line from its own totals, payments, credits and due date (explainStatus, status-why); extras test 1/1 + screen test |
| 08 | Smart Duplicate Invoice Warning Warn on suspicious duplicate customer, amount, period and source transaction; never auto-delete or merge records. | BUILT — new-invoice form warns when the same customer has a non-void invoice for the exact total issued in the last 60 days (dup-warning); never blocks/merges; screen test |
| 09 | Document Delivery Eligibility Checker Check authorized email/phone, tenant configuration, sender readiness and proper consent before enabling Send/Resend. | EXISTS — Email/Text buttons enabled only when the sender is connected, the customer has the destination and consent (delivery.canSend), and the user may send; drafts must be issued first |
| 10 | Export and Audit Protection Provide a visibly scoped export preview, role checks, safe spreadsheet escaping and an audit record; preserve existing export behavior. | BUILT — export preview with count, period, filters and the audit note before the CSV; spreadsheet formulas neutralised server-side (ExportPreview; POSInvoicesScreen.test) |
| 11 | Payment-to-Invoice Reconciliation Detect unlinked posted payments, duplicate references and balance mismatches; suggest investigation, never change financial records automatically. | TODO |
| 12 | No-Data and Failure States Use clear zero-invoice, no-search-results, failed-API, offline and unsupported-integration states instead of empty white panels. | EXISTS — StateBlock for failed API (retry/permission) vs no-match with Clear vs no invoices yet (POSInvoicesScreen list states) |
| 13 | Customer Profile Cross-Link A receptionist can click the customer name to open the authorized Customer Profile, then return to the same invoice search/page context. | EXISTS — invoice detail Bill-to → Open customer (open-profile) to Customer Profiles; profile → invoices arrives with ?customerId= filter |
| 14 | Release-gate Module Registry Generate a before/after inventory of original and discovered modules, their routes, API calls, permission rules and test status; fail release if a module disappears. Owner-requested specifica | EXISTS — release-gate module registry (tooling/ci/check-pos-module-registry.mjs + pos-module-baseline.json) |

## Customer Notes 6 (18)

| # | Recommendation | Status |
|---|---|---|
| 01 | Context-aware relevance: Prioritize authorized notes by current service, branch and assigned technician, without hiding lower-priority records. | TODO |
| 02 | Stale/conflicting preference detection: Flag contradictory dates or technician/style preferences for human review, with source evidence. | TODO |
| 03 | Structured nail-service quick notes: Reusable chips for nail shape, length, color, product and aftercare; keep optional free text. | BUILT — notes editor quick chips for Shape / Length / Finish write one line per group into Preferred style (a new pick replaces the old line; free text kept) — POSCustomerNotesScreen applyQuickNote; extras test 3/3 |
| 04 | Critical warning review receipt: Visible role-appropriate acknowledgment timestamp, warning version and source context. | TODO |
| 05 | Source/provenance labels: Clearly distinguish Customer-reported, Staff-observed, Source-confirmed and AI-suggested notes. Guidance for Claude • Verify whether any recommendation is already partly implemented before creat | TODO |
| 06 | Persistent search state: On close/back, restore branch, search term, filters, sort, current page and scroll position. | BUILT — search, filters, sort and page persist in this browser tab and are restored on return (readNotesQuery / sessionStorage; workspace test) |
| 07 | Safe draft recovery: Warn before losing unsaved edits; support secure drafts only if existing policy permits and never auto-submit warnings. | BUILT — closing the notes editor with unsaved edits asks (Keep editing / Discard); never auto-saves or submits; offline drafts already existed (Decision 33) — extras test |
| 08 | Priority-aware density: Balanced four-card summary, compact filter bars, read-only row previews and a large accessible detail drawer. | EXISTS — four summary cards, compact filter bar, read-only row previews (cnx-kpis, cnx-filters, cnx-row) |
| 09 | Language and touch QA: English/Vietnamese tenant POS strings, diacritics, ~44px actions and screen-reader labels tested. | EXISTS — every string behind t() with EN/VI, 44px actions; Vietnamese screen harness certified (cust-notes in BATCH7) |
| 10 | Accuracy and response-time monitors: Track authorized read failure rate, indexed search freshness, note version conflicts and warning retrieval latency. Implementation safeguards • No AI-generated note is automatically t | TODO |
| 11 | Acknowledgments are auditable and do not change, delete or publish the warning. | EXISTS — review decisions are recorded as history and never change the note text (cnx-history; Review & Accuracy sends the read hash) |
| 12 | Health Checker distinguishes healthy, disabled/empty, permission-denied and broken dependencies. | EXISTS — notes health check (cnx-check, cnx-health) |
| 13 | Sensitive-note information and counts never leak across tenants, roles or public displays. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 14 | AI drafts require human review and never invent or silently persist safety information. | TODO |
| 15 | No customer identity, booking, loyalty, gift-card or payment ledger is duplicated or modified. | NOISE — implementation safeguard (no ledger duplicated), not a feature; holds: notes screen only reads/writes customer notes |
| 16 | Automated tests were executed; results, failures and blockers are documented. AI POWERSALON / CUSTOMER NOTES CLAUDE IMPLEMENTATION GUIDE | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |
| 20 | Empty states, error messages and operational honesty STATE VISIBLE MESSAGE / BEHAVIOR No customer selected Search for a customer or select a profile to view notes. | NOISE — empty/error state table heading |
| 26 | Acceptance checklist - definition of done | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |

## SERVICE CATEGORIES (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Automatic Screen Fit overlays, touch reachability. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx) |
| 02 | Category Accuracy Real counts and eligible scope; duplicates; orphaned category references; stale summaries. | EXISTS — catalog System Check (SystemCheckButton domain=catalog) + server counts (kpi-categories, kpi-total-services) |
| 03 | Chart / Breakdown KPI-chart-table consistency, percentages, rounding and current/historical scope. Wrong-tenant links, unauthorized moves, missing category, possible mismatches needing | EXISTS — chart and breakdown table share one server result; chart bar drills the table (chart-drill, breakdown-table) |
| 04 | Service Assignment human review. | EXISTS — service reassignment with preview, reason and confirm (move-preview, move-reason, move-confirm) |
| 05 | Catalog / Booking Wiring Service pickers, Add-Ons, Packages, Booking and Checkout ID continuity. | NOISE — wiring audit instruction |
| 06 | Privacy and Permissions Backend RBAC/tenant/branch isolation and customer-history PII safeguards. | NOISE — security audit instruction |
| 07 | Translation and Touch EN/VI text clipping, keyboard/focus, calendar, charts and button target size. | EXISTS — EN/VI behind t(), Vietnamese harness certified for Service Categories |
| 08 | Data Freshness / Cache Stale metrics after create/edit/reassign/archive, invalidation and real-time event failures. HEALTH CHECKER SAFETY A checker should produce PASS, WARNING, FAIL or NOT TESTED with evidence, affected | BUILT — shared read-only Check Catalog System (GET pos/system-checks/catalog, components/SystemCheck); pgtest 5/5 + PG16 run |
| 09 | Category assignment change timeline: capture old/new service-category associations, editor, reason and effective timestamp in an inspectable history. | EXISTS — category details → History tab: every service-category change with old/new, who, reason and time (posCatalogApi.history field=all, ChangeHistoryTable) |
| 10 | Controlled branch-aware catalog view: if branch rules exist, make authorized scope obvious; do not merge different tenants or branches into one ambiguous total. | TODO |
| 11 | Chart-to-directory drill-down: tapping a category bar filters the current directory and linked services, with a visible Clear Filter action. | BUILT — a category name on the Services per Category chart filters the directory to it, with a visible "Clear filters" (bars-categories-pick, chart-drill); POSCatalogScreens test |
| 12 | Quick “Manage Services” panel: provide easy service reassignment from category details with preview/confirmation and current price/duration preserved. | EXISTS — category details → Manage Services: pick services, target category, reason, preview old → new, confirm in one transaction; price/duration untouched (move-preview, move-confirm) |
| 13 | Saved filter state: preserve filters and page position when viewing details, while resetting to Page 1 after actual search or sort changes. | BUILT — mode, search, period, filters, sort and page persist in this browser tab (details are overlays); a real search/filter change resets to page 1 (shared useSessionState; POSCatalogScreens.test) |
| 14 | Visual regression snapshots: capture normal, Vietnamese, empty, loaded, popover, and overlay states at physical and effective SUNMI viewports. | NOISE — visual-regression instruction (covered by tooling/e2e/pos-vi-one-screen.mjs) |
| 15 | Performance guardrails: backend aggregated counts, indexed category lookups and real pagination; do not prefetch every service for large tenants. | NOISE — performance guardrail instruction |
| 16 | Rollout and rollback plan: feature flag if needed, deploy to a pilot salon, compare counts and navigation before broad rollout; revert code safely without deleting categories. SUNMI FLEX 3 / 1920 x 1080 landscape / 100%  | NOISE — rollout instruction |

## Inventory Management (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Inventory Accuracy Reconcile on-hand, reserved, available, bottle/lot states, valuation, thresholds, 8 KPI definitions, 11/20/171/128 issue and sidebar badge. | TODO |
| 02 | Screen Fit & Module Detect horizontal page overflow, clipped action areas, disproportionate KPI tiles, hidden Preservation tab content, unreachable modal footer and missing preserved controls. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | Technician Usage Integrity Validate actor vs technician IDs, actual used_at, all technicians, Last Used By, branch scope and event-to-movement links. | TODO |
| 04 | Duplicate Stock Movement Find duplicate manual/service/recipe/webhook source references, negative balances, duplicate receiving and concurrent usage conflicts. | TODO |
| 05 | Module sizing and accessible touch controls A professional POS must feel comfortable from a cashier or manager’s standing position at the front desk. ELEMENT GUIDELINE / ACCEPTANCE KPI tiles Same height within a grid row | NOISE — sizing guideline table (screen-fit guidance), not a feature |
| 06 | Receipt / Import & Entitlement Check OCR source status, review approval, duplicate import, secure file reference, permission and AI subscription gating. Output format Every checker should return Pass / Warning / Failed / | TODO |
| 07 | Reorder suggestions with Show on-hand + on-order + target + suggested order qty and verified supplier mapping preview before manager review. | EXISTS — Reorder opens a DRAFT PO prefilled with suggested qty and supplier; nothing saved until Create (TenantInventoryScreen.reorder.test) |
| 08 | Better empty/error states Separate zero products, no matching records, permission denied, offline/API error and zero import queue. IMPLEMENTATION ADDENDUM / 07 NOV 2026 ADDENDUM PAGE 15 AI POWERSALON / SUNMI FLEX 3 / INV | EXISTS — StateBlock for permission/API errors vs no-match vs no products (TenantInventoryScreen list states) |
| 09 | Before/after quantity preview Before Add Stock, Count Adjustment, Transfer, or Usage, show projected quantity, unit and affected branch. | EXISTS (part) — Add Stock shows on-hand → after in its header before saving (inv.addStockSub); Record Product Use shows stock before / after and refuses below zero; Count / Transfer previews not checked |
| 10 | Duplicate event warning Show safe detection before retrying a usage/receiving call; use server idempotency and explicit final status. | EXISTS (part) — Add Stock sends once (in-flight guard) and Record Use carries one idempotency key; no separate retry warning |
| 11 | Purchasing, transfers, alerts and service workflows Screen-fit changes must not interfere with stock custody and cross-module invariants. CROSS-MODULE WIRING PROTECTED BEHAVIOR Suppliers → Purchase Orders Keep supplier/p | NOISE — protected-behaviour table (cross-module wiring to preserve), not a feature |
| 12 | AI Inventory Assistant, OCR and subscriptions Protect operational functionality and licensing while making the interface more compact. AREA MUST PRESERVE / IMPROVE AI entitlement banner Original guide reports trial ended | NOISE — preservation instruction for the AI / OCR / entitlement areas |
| 13 | Role-aware quick actions Surface actions appropriate to receptionist/manager/owner roles; enforce permissions in backend, not just hidden buttons. | EXISTS — actions follow permissions (e.g. inventory.stock.adjust for recording use on behalf of a technician) and the server re-checks every one |
| 14 | Additional recommendations: operational UX Implement selectively after inspecting current code. Each addition must be compatible with the original page and not displace existing modules. RECOMMENDATION BENEFIT / LIMIT | NOISE — heading for the recommendations list, not a feature |
| 15 | Automatic browser visual Screenshots and overflow checks at SUNMI and fallback viewports, both EN/VN, regression representative large datasets. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 16 | Inventory data freshness Show real last successful refresh and retry if disconnected; never show false “live” state. indicator Recommended priority: preserve modules → fix responsive shell → verify 8 KPIs and usage/ledge | BUILT — Numbers updated {time} after a successful metrics read; a failed refresh shows the last good time (shared FinanceKit useFreshAt/FreshnessLine, inventory-fresh; TenantInventoryScreen.fresh.test) |

## Recent Account Activity 8 (3)

| # | Recommendation | Status |
|---|---|---|
| 04 | Full, ready-to-execute directive for Claude Claude, work directly within my existing AI PowerSalon multi-tenant monorepo. I am upgrading the Tenant Front Desk POS Account > Account Overview Recent Account Activity module | NOISE — the directive text itself |
| 07 | Responsive UI blueprint - preserve page geometry SUNMI 27 INCH / ACCOUNT OVERVIEW (illustrative, not live screenshot) +--------------------------------------------------------------------------+ / Logo + Sidebar / Tenant | NOISE — an illustrative ASCII blueprint |
| 18 | Keep Compliance Score and Backup & Data Health Compliance Score card: photographed 50/100 Fair • Preserve exact pictured categories: Login Security (2FA); Messaging Compliance (A2P); Password Hygiene; Access Monitored. • | NOISE — a preserve-as-is instruction (Compliance Score card kept) |

## Check-In (4)

| # | Recommendation | Status |
|---|---|---|
| 14 | KPI Dynamic Values Test: 0 9 | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |
| 32 | Today's Appointments Arriving Keep this panel fixed-height. Display appointments arriving within: Next 3 Hours or the actual configured period. | EXISTS — Today's Appointments Arriving: fixed card (ci-arriving) using the configured arrival window (arrivalWindowMinutes, default 3 h) |
| 38 | Manage Waiting Lounge Keep: Manage Waiting Lounge as a compact link/action. | EXISTS — Manage Waiting Lounge is a compact footer action on the lounge card (ci-lounge → /queue) |
| 64 | Card Padding Operational card padding: 8–12 px often should be sufficient. Do not apply: | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |

## AI BRANCH COMPARISON (14)

| # | Recommendation | Status |
|---|---|---|
| 01 | Comparison Readiness Score: show source coverage and freshness before numeric performance rankings; do not imply unreliable data is accurate. | TODO |
| 02 | Layout Auto-Fit Diagnostics: optional developer-only overlay reporting viewport, overflow, clipped panels, scale and touch-target failures. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | Comparison Presets: save permitted branch group, metrics, date convention and sort; preserve current filters and authorization. | BUILT — POS saved views (migration 844, pos/me/saved-views, components/SavedViews); pgtest 6/6, component 4/4 |
| 04 | Like-for-Like Branch Groups: compare similar service mix, staffing and operating hours rather than misleading size-based rankings. | TODO |
| 05 | Metric Definition Tooltips: explain denominator, exclusions, time basis and why N/A may appear; reference canonical reporting definition. | BUILT — "How these are calculated" under the table: each column's denominator, basis and when N/A appears (Net Sales = the Sales Report's getSales) — bcx-defs; test |
| 06 | Source-to-Answer Audit Trail: owner opens AI explanation and sees the underlying authorized report/record evidence and as-of timestamp. | TODO |
| 07 | Outlier / Small-Sample Cautions: suppress overconfident conclusions when only a few appointments or transactions qualify. For each recommended enhancement, Claude must first identify whether it already exists. Reuse or r | BUILT — a branch with fewer than 5 bookings in the period is marked "small sample" next to its completion rate, with the count in the tooltip — bcx-small; test |
| 08 | Period Comparison Toggle: compare prior equal-length periods with branch-local time and consistent definitions; never silently switch comparison dates. | TODO |
| 09 | Actionable Trend Flags: detect measurable revenue, booking and retention shifts from existing alerts, without inventing a second anomaly engine. | TODO |
| 10 | Owner Portfolio Guardrails: transparent "All Authorized Branches" count and exclusions; reject cross-tenant requests lacking verified grants. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 11 | Data Refresh Indicator: per-branch freshness and partial sync warnings, with non-disruptive refresh of summary and history. | EXISTS (part) — as-of time for the comparison and a Refresh (bcx-asof, bcx-refresh); one freshness for the page, not per branch |
| 12 | Touch-First Branch Navigation: tap-friendly row drawer, clear Back/Close, restore page/filter/scroll after drill-down. | EXISTS (part) — tap/Enter on a row opens the branch detail with Close and a link to its report; page/filters stay as they were underneath |
| 13 | Large Portfolio Performance: bounded aggregation, indexed filters, virtualization/pagination for many branches without freezing POS. | EXISTS — server paging (10/25/50 per page, bcx-size) and search; the comparison is aggregated server-side |
| 14 | Manager Sign-Off Notes: optionally annotate a saved comparison with reviewer/decision, preserving the original immutable financial snapshot. AI must not silently act Growth recommendations must link to existing Booking,  | TODO |

## Overview (1)

| # | Recommendation | Status |
|---|---|---|
| 10 | Reference CSS Architecture (Adapt to Existing Code) Illustrative implementation guidance, not a command to replace current components, design tokens, test IDs or backend contracts. Claude must reconcile these styles with | NOISE — illustrative CSS guidance ("not a command"), not a feature |

## Reviews  Reputation (8)

| # | Recommendation | Status |
|---|---|---|
| 01 | Unified Reputation Health Dashboard: One-click verified ratings + provider sync + moderation + request/response delivery checks, with explanatory proof. | EXISTS — Check Reviews System (rvw-check) with last-check result (rvw-last-check) covering ratings, moderation and request delivery |
| 02 | Review-to-Customer Resolution Timeline: Link genuine complaints to service, technician, authorized contact history, follow-up owner and outcome. | EXISTS (part) — review overview links the customer, technician stats, contact history (ov-comm-messages / requests), follow-up owner (ov-assign) and booking |
| 03 | Fair Rating Distribution Analyzer: Surface sample size, review-source mix, public/hidden definitions and policy-compatible raw distribution. | EXISTS (part) — rating distribution panel (rvw-dist) with counts, public/hidden definitions (glance-hidden) and an insufficient-data guard (ins-insufficient) |
| 04 | Response Quality Assistant: Suggest concise, empathetic replies but require manager approval and prohibit invented claims or fake publication. | EXISTS (part) — Review Assistant insights with reply drafts (rvw-assistant, ins-drafts) — drafts only, nothing is published by AI |
| 05 | Reputation Anomaly Monitor: Flag bursts, duplicates and provider-sync discrepancies for investigation, not automatic suppression. | TODO |
| 06 | Responsive Layout Self-Test: Inspect overflow, equal KPI heights, touch hit boxes and localization for the current display. | EXISTS — profile menu → Check this screen (overflow, peer heights, touch, localisation) on every page |
| 07 | Review Request Eligibility Preview: Show exact recipients, consent status, suppressions and costs before any approved campaign. | TODO |
| 08 | Cross-Branch Reputation Comparison: Normalize by source and sample size; only expose branches authorized for that user. PASTE-READY FINAL INSTRUCTION TO CLAUDE Audit before coding. Rebuild my EXISTING AI PowerSalon Revie | NOISE — the paste-ready instruction block; branch comparison of reputation not built |

## Checkout Upsell (17)

| # | Recommendation | Status |
|---|---|---|
| 01 | Subscriptions + One-Click Checkout Health Checker Resolve On trial / Limited / Trial Ended from the real billing state; verify AI usage, Checkout, Service Done, Receipts, customer data, catalog prices, Booking and techni | EXISTS (part) — Check AI Checkout + Upsell System (ucx-check) on the settings page; trial-state resolution not re-verified here |
| 02 | Repair subscription truth: resolve On trial / Limited / Trial Ended using authoritative billing, access, provider and metering data. | TODO |
| 03 | Verify data correctness: Checkout, Service Done, Receipt, catalog prices, staff commissions, Booking, customer history, Loyalty and promotions. | TODO |
| 04 | Complete existing module preservation inventory Claude must make a before/after inventory from the actual repository and this original guide. Every row below must have a functioning destination, visible entry point or au | NOISE — preservation-inventory instruction (the module registry + preservation matrix gate covers it platform-wide) |
| 05 | Priority 1: subscription and metering truth Independent state dimension Required interpretation Billing lifecycle Trial active, trial expired, paid active, past due, cancel pending, canceled - use actual existing enum/st | NOISE — priority/interpretation text |
| 06 | Add search, month calendars and pagination: secure server queries, date semantics, pages 1/2/3+, newest history first. | EXISTS — history search, custom From–To month calendar and paging on the upsell settings page (ucx-history-search, ucx-preset-custom + RangeCalendar, pager) |
| 07 | Proposed layout blueprint - visual concept only This diagram is a static interface concept, not live POS data. Preserve existing sidebar/top bar outside the main content area shown below. AI Checkout + Upsell Assistant H | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 08 | Smart upsell and add-on recommendation rules Every displayed recommendation must be bound to an active, authorized service or product record for the selected salon. Validate availability and price immediately before an a | TODO |
| 09 | Missed-service detection - two distinct workflows Never confuse a financial mismatch with a sales opportunity A service actually performed but not included on the ticket is a potential record discrepancy requiring human  | TODO |
| 10 | Execute regression/security tests: document evidence, remaining defects and file changes; never claim unrun tests passed. CLAUDE IMPLEMENTATION HANDOFF / EXISTING CODE FIRST / NO AI-INITIATED CHARGES 12 AI POWERSALON / A | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |
| 12 | Monthly date pickers and precise date semantics Add From Date and To Date controls that open actual calendar month views with month/year, previous/next month, weekday headers, selectable days, range highlight, Today, App | EXISTS — From/To month calendar (shared RangeCalendar) on the upsell history |
| 13 | Priority recommendations added without removing modules These are additions based on the full-screen SUNMI goal. They do not supersede the original three priorities: (1) subscriptions + Health Checker, (2) smart upsell / | NOISE — heading for the recommendations |
| 14 | Health Checker: original checks plus layout diagnostics The existing "Check AI Checkout + Upsell System" button must perform safe read-only verification of billing/entitlements/quota/provider, ticket consistency, Service | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 15 | One-Click AI Checkout + Upsell System Health Checker Add a real Check AI Checkout + Upsell System button. Verify services using safe, read-only diagnostics and show Passed / Warning / Failed / Unavailable with affected m | EXISTS — Check AI Checkout + Upsell System button (ucx-check): read-only checks with pass / warning / failed |
| 17 | Secure data contracts and incremental implementation Use existing routes and schemas where possible. The names below are conceptual API capabilities to discover or extend, not instructions to create duplicates. Capabilit | NOISE — data-contract guidance |
| 18 | Security, tenancy, multilingual UI and scalability Required security controls • Backend enforces trusted tenant context, branch scope, user role, Checkout/service edit permission, billing permission and AI feature entitl | NOISE — security / tenancy requirements text (enforced platform-wide by the gates) |
| 19 | Priority-ordered implementation plan for Claude | NOISE — implementation plan heading |

## Service Done (12)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-Click POS Layout Health Checker Read-only diagnostics for current viewport, clipped cards, content overflow, inconsistent peer sizing, touch target violations, clipped overlays, font/language expansion. Show module n | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Verified hardware profile and browser reality Requirement SUNMI FLEX 3 27-inch deployment Orientation and panel Landscape / 27-inch capacitive touch / 1920 × 1080 FHD / 16:9 Physical housing (reference only) 646 × 384 ×  | NOISE — hardware profile description |
| 03 | Module Inventory and No-Regression Gate Generate a machine-readable inventory for Checkout + Service Done from existing components. CI must fail when a previously present module, button, route, API, status action or perm | EXISTS — machine-readable module registry (shell/module-registry.json) with CI gate check:pos-module-registry failing when a module id disappears |
| 04 | Balance and Empty-Space Inspector Detect oversized empty cards, crowded controls, mismatched peer heights, uneven gutters and excessive card padding. Recommend CSS-token fixes instead of deleting low-activity modules. | EXISTS — Check this screen → balance rule (peer heights > 25 % apart) and the harness balance/overlap checks |
| 05 | Mandatory preservation matrix - all Checkout modules This matrix was derived from the owner-supplied Checkout mandate. Claude must compare it to the actual repository and append every additional module discovered; this l | EXISTS — generated preservation matrix (docs/handoff/SUNMI_PRESERVATION_MATRIX.md) with the gate pos preservation matrix |
| 06 | Handoff and Payment Integrity Checker Read-only health report verifying Serving → Service Done → Checkout exactly-once handoff, duplicate tickets, outstanding payment attempts, ticket-version safety and server-reconciled | BUILT — Check Service Flow System (pos/system-checks/service-flow): paid state, paid without payment, done not paid, serving over 8 h, queue waiting, in service without ticket |
| 07 | Accessibility + Vietnamese Label Checker Check actual 100% zoom text contrast, touch targets, screen-reader labels, focus order, soft keyboard overlap, Vietnamese overflow, and actionable error messages. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 08 | Certified Visual Snapshots Save empty, normal, busy, large-salon, UNKNOWN payment and quality-blocked screenshots for both pages. Run pixel/bounding-box regression after every shared-shell change. | EXISTS — one-screen harness screenshots EN + VI at certified sizes for Service Done / Checkout (tooling/e2e/pos-vi-one-screen.mjs) |
| 09 | KPI cards Guests Ready for Checkout; Completed Checkouts Today; Pending Payments; Today’s Revenue; Tips Captured; Average Checkout Time; Gift Card/Loyalty Redemptions; Upsell at Checkout; Receipt Delivery Rate Primary op | TODO |
| 11 | Non-negotiable payment, checkout and data protections The original 18-page mandate (Appendix A) is binding in full. These protections are repeated here because layout work must not regress them. • Canonical flow: Serving | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 12 | Recommended additive improvements - keep existing modules Recommendation Implementation requirement and benefit | NOISE — table heading |
| 13 | Automated test plan and screen acceptance gate At least the following tests must execute against a real or faithfully reproduced POS app shell. Use Playwright or the repository's existing E2E framework and add structured | EXISTS — Playwright harness against the built POS + real API (pos-vi-one-screen) runs these pages |

## Receipt Devices (15)

| # | Recommendation | Status |
|---|---|---|
| 01 | Route Opening existing /tenant/devices/receipt-devices keeps sidebar, header and current route. | EXISTS — /tenant/devices/receipt-devices keeps the shell, header and route (POSDeviceFleetScreen) |
| 02 | Preservation All 11 visible device navigation entries remain accessible. | EXISTS — device navigation entries kept (module registry + preservation matrix gate) |
| 03 | Empty state 0-connected view shows an honest helpful empty state without fabricated records. | EXISTS — no printers: honest Not configured + empty state, digital-receipt history shown instead (dfx-kpi-printers, admin.devices.noneConnected) |
| 04 | Responsive 27-inch Android browser at 100% zoom: no horizontal page overflow or clipped header. | EXISTS — receipt-devices certified in the one-screen harness (BATCH8, EN + VI, 1920×945/952/1032 + responsive sizes) |
| 05 | Responsive Cards balanced; primary actions not buried; vertical scroll works when content grows. | EXISTS — receipt-devices certified in the one-screen harness (BATCH8, EN + VI, 1920×945/952/1032 + responsive sizes) |
| 06 | Compatibility Works at 24-inch web POS and current ASUS browser dimensions. | EXISTS — receipt-devices certified in the one-screen harness (BATCH8, EN + VI, 1920×945/952/1032 + responsive sizes) |
| 07 | Touch Touch targets, tab order, screen-reader labels, overlay close and keyboard work. | EXISTS — 44px targets / focus / dialog close checked by Check this screen and the harness touch rules |
| 08 | Locale Front Desk EN/VN selection preserved; longer strings cause no clipping. | EXISTS — EN/VI behind t(); Vietnamese harness certified |
| 09 | Printer inventory API counts match scoped rows and actual device signals; no fake online status. | EXISTS — printer count shows Not configured (no registry, no fake online status); email / SMS counts are real receipt deliveries |
| 10 | Add wizard Unauthorized employee cannot register or assign printer. | REMOVED — Kevin, Nov 11 2026: no receipt printer in the product (receipts are digital); row dropped, nothing to build |
| 11 | Add wizard Wrong tenant/branch or duplicate device assignment rejected server-side. | REMOVED — Kevin, Nov 11 2026: no receipt printer in the product (receipts are digital); row dropped, nothing to build |
| 12 | Connection Unverified printer reports Not Configured/Unknown, never Ready. | EXISTS — printers are always Not configured, never Ready |
| 13 | Test print Explicit TEST page contains no real customer/payment data. | REMOVED — Kevin, Nov 11 2026: no receipt printer in the product (receipts are digital); row dropped, nothing to build |
| 14 | Adapter Android/WebUSB/Bluetooth limitations surfaced accurately when unsupported. | REMOVED — Kevin, Nov 11 2026: no receipt printer in the product (receipts are digital); row dropped, nothing to build |
| 15 | Digital policy Email / SMS / No Receipt checkout remains unchanged and operational. Internal development handoff • 09 Nov 2026 • Screen + code verification required 27 AI POWERSALON / RECEIPT DEVICES SUNMI FLEX 3 / CLAUD | EXISTS — Email / SMS / No receipt checkout unchanged (the Receipt Devices page reads them only) |

## Refer A Friend Earn Rewards (9)

| # | Recommendation | Status |
|---|---|---|
| 00 | Audit Locate POS referral route, ten modules, existing app surfaces, KEEP / FIX / MERGE / COMPLETE status matrix source-of-truth models and test suites with file paths | NOISE — audit instruction |
| 01 | Layout tokens Adapt existing shell; introduce fluid equal-grid and contained Browser captures at tested sizes scroll; no force-zoom | NOISE — layout-token guidance |
| 02 | Screens Upgrade Overview, Settings, Invites, Activations, Vouchers, Each module opens and functions; no missing Budget, Fraud, Reports, Health and Audit actions | NOISE — acceptance statement for the screen upgrade (the referral screens exist; this row names no feature) |
| 03 | Cross-surface Verify Customer App / Check-In / Checkout / Owner / Super End-to-end referral pilot with source records Admin boundaries | NOISE — end-to-end pilot instruction |
| 04 | Financial Budget concurrency, double-click, Fiserv UNKNOWN, refunds, Executed idempotency and reconciliation tests guards tips and payroll regression | NOISE — test-matrix instruction |
| 05 | Release Feature flag, migration/rollback plan, audit/monitoring, staging Measured report with explicit unresolved blockers on target device RELEASE GATE Do not call the job complete based only on screenshots, a build com | NOISE — release-gate instruction |
| 07 | CUSTOMER A Separate earned reward voucher becomes AVAILABLE | EXISTS — the referrer's earned reward is its own voucher in the customer's wallet (modules/deals referral-vouchers: issued on qualification) |
| 08 | LATER CHECKOUT Referrer redeems own voucher at eligible sponsoring salon Key distinction: The friend may receive an immediately usable first-visit voucher at verification. The referrer may see a PENDING voucher, but it m | EXISTS — checkout finds that voucher in the wallet and applies, reserves, redeems or releases it on the discount authority (referral-vouchers.ts) |
| 12 | COMMUNICATIONS, DEEP LINKS, REALTIME AND PRIVACY R066 Notification policy Send English-only consent-compliant referral activated, pending, reward unlocked, expiring and redemption messages through existing Communications | NOISE — requirement narrative block |

## AI Follow Ups Human Handoff (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Layout Health Check Read-only viewport/overflow checker plus screenshot evidence on SUNMI. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Callback SLA Clock Display elapsed time vs promised callback due time with configurable manager alerts; never invent an SLA. | EXISTS (part) — each task has its due time; Overdue KPI + filter count unresolved tasks past due (aifu-f-overdue); no configurable manager alert |
| 03 | Unassigned Task Triage Compact priority row showing ownerless calls, but reuse the same canonical tasks. | EXISTS — Unassigned count on the KPI cards and the Assignee filter on the same canonical task list (no second queue) |
| 04 | Last-Contact Truth Show attempted vs actually reached, provider accepted vs delivered, and last verified outcome. | EXISTS (part) — contact attempts tab records channel and outcome per attempt (aifu-at-channel / aifu-at-outcome) |
| 05 | Duplicate Contact Guard Warn on recently contacted customers across AI call follow-up and end-of-day technician outreach. | TODO |
| 06 | Staff Handoff Ownership Record accepted assignment and shift-change handover to prevent abandoned tasks. | TODO |
| 07 | Stale Event Reconciler Detect handoff-required call events with no canonical follow-up; review discrepancies, never fabricate silent tasks. | TODO |
| 08 | Priority Explainability Show evidence and timestamp behind every AI urgency suggestion. | BUILT — every Priority & Escalation Assistant suggestion shows its server evidence plus when the task opened and the as-of time of the check: ai-follow-up-center.ts priorities() returns asOf; POSAIFollowUpsScreen aifu-rec-evidence / aifu-rec-when (tests: ai-follow-up-center.pgtest asOf, POSAIFollowUpsScreen.test "evidence, when the task opened") |
| 09 | Readable Call Timeline One chronological view of actual call, transfer, task, attempts, notifications, booking and resolution. | EXISTS (part) — task overlay tabs: original AI call, contact attempts, booking and audit, each newest first (not one merged timeline) |
| 10 | Recovery & Retry Tools Safe permissioned retry of failed notifications/jobs with unique keys and audit. | TODO |
| 11 | Multi-language Fit Test tenant Front Desk EN/VN labels within the same responsive components; do not extend localization to unrelated apps. | EXISTS — EN/VI behind t(); the native apps untouched |
| 12 | Saved Views Optional personal authorized filters: My Tasks, Overdue, Unassigned, Today; original six status chips remain. | BUILT — POS saved views (migration 844, pos/me/saved-views, components/SavedViews); pgtest 6/6, component 4/4 |
| 13 | Mobile-safe Continuity Keep existing native applications unchanged and test backend response contracts for compatibility. | NOISE — compatibility instruction (native apps unchanged) |
| 14 | Data Quality Signals Flag missing branch, ambiguous customer, invalid due time and unlinked provider call instead of displaying deceptive normal state. | TODO |
| 15 | Lightweight Dashboard Use compact actionable counts rather than large decorative graphics; the task list remains the primary work area. | EXISTS — compact KPI counts above; the task list is the main work area |
| 16 | Guided Closeout Require resolution outcome and next-step note for complaints; protect against accidental one-tap closure. CLAUDE BUILD + REPAIR MANDATE • PRESERVE EXISTING MODULES & IPHONE SOURCE ADDENDUM 16 AI POWERSALO | EXISTS — resolving needs a resolution category and reason (aifu-d-rescat, aifu-d-reason); closing is a separate explicit action |

## SUPPLIERS  PURCHASING (7)

| # | Recommendation | Status |
|---|---|---|
| 01 | Supplier Data Accuracy Supplier counts, contacts, active status, archived references, missing FK and duplicate candidates. | TODO |
| 02 | Purchase Order Integrity Draft versus active counts, transition history, line totals, expected delivery and outstanding value. | TODO |
| 03 | Receiving & Stock PO quantity, accepted/damaged receiving, unit conversions, inventory movements and low-stock refresh. | TODO |
| 04 | Automatic Screen Fit Current viewport CSS size, clipped buttons, card size balance, overflow and visible pagination. | EXISTS — Check this screen (viewport, clipped buttons, balance, overflow) on every page |
| 05 | Non-removal checklist: every module and action Area Keep intact and wire to working data POS shell Salon selector, sidebar, top header, global notifications, search/account controls, current route and navigation. KPIs To | NOISE — non-removal checklist (covered platform-wide by the module registry gate) |
| 06 | Four KPI cards: equal size, correct definitions KPI Display and data requirement Total Suppliers Distinct authorized suppliers, not contacts; explicit active/current/all scope. Never show backend failure as verified zero | TODO |
| 20 | Release-blocking test matrix Test category Mandatory evidence Viewport 100% zoom, SUNMI physical 1920×1080, browser chrome visible. CSS widths 1536×864, 1440×900, 1366×768. Balance and clipping All 4 KPIs equal, tabs rea | NOISE — release test matrix instruction |

## Voice Transcription Search Call History (5)

| # | Recommendation | Status |
|---|---|---|
| 01 | Your three highest-priority recommendations These priorities must be implemented in the following order, before more advanced search intelligence. The requirements are intentionally shared between Voice Search and Call H | NOISE — priority-order heading |
| 02 | Complete Call Details and Smart Follow-Ups Let authorized staff open any call and see its transcript, speakers, summary, customer requests and booking-related information. Recommend appropriate follow-ups while preservin | EXISTS — call details overlay (transcript, speakers, summary, requests, booking info) and Smart Follow-Ups into the one task system (VoiceCallsWorkspace, Unresolved screen) |
| 03 | Full-Screen History, Advanced Search, Calendars and Pagination Use available screen space for call records and processing health. Add phone/name/transcript search, custom monthly From/To calendars, and pages 1, 2, 3 and  | EXISTS — shared calls workspace on History + Search: newest first, phone/name/transcript search, filters, date basis, From/To calendars, numbered pages, empty state that says why (VoiceCallsWorkspace) |
| 12 | One-click health check specifications Voice pipeline health with real evidence Reuse the original Check Voice Transcription System mandate on BOTH routes, with a compact summary and full diagnostic overlay. Subsystem Mus | EXISTS — Check Voice Transcription System on both routes (VoiceCallsWorkspace), plus Check Voice Follow-Up System and Settings checks |
| 31 | Final copy-and-run instruction to Claude IMPLEMENTATION Claude: inspect the live AI PowerSalon repository and determine what is truly SAFEGUARD implemented before writing changes. Reuse the current Voice Search, Call His | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |

## End-of-Day Cash (18)

| # | Recommendation | Status |
|---|---|---|
| 01 | Compact cash difference strip Make shortage/overage status visible directly below KPIs; show a link to Under Review records. Do not interpret all negative values as theft. | EXISTS — shortage / overage strip under the KPIs (difference-strip with dif-short / dif-over) linking to the matching records |
| 02 | Technician cash detail drawer Authorized drill-down with source tickets, tender list, shifts, prior hand-offs, count history, actor, variance and audit trail. | EXISTS (part) — hand-off detail with source ticket lines, count figures and the event trail with actor and time (lines-table, count-figures, events) |
| 03 | Pending count queue Small state summary for Awaiting, Submitted, Counted, Under Review; click to apply real filters. | EXISTS — Awaiting / Reconciled KPI cards apply the real status filter on click (kpi-awaiting, kpi-reconciled) |
| 04 | Denomination count helper Optional count sheet with calculated totals; keep manual mode only if approved by tenant settings. | EXISTS — optional denomination count sheet with the calculated total (use-sheet, sheet); manual amount stays available |
| 05 | Partial hand-off timeline Show first/second/subsequent transfers with accepted totals and remaining responsibility; prevent duplicate events. | EXISTS — End-of-Day Cash → technician detail → events list (tech_cash_handoff_events: each hand-off, count, approval or correction with who and when) — POSCashHandoffScreen |
| 06 | Recount & override workflow Require reason and permission; preserve original counts and reviewer details; no silent overwrite. | EXISTS — recount as Add or Replace with the prior count kept, resolve with a required reason (mode-add / mode-replace, resolve-reason); stale-count conflict refused (conflict) |
| 07 | Audit trail shortcut Provide a one-click view of who received, counted, approved or corrected cash and when. | EXISTS — End-of-Day Cash → technician detail → events list (tech_cash_handoff_events: each hand-off, count, approval or correction with who and when) — POSCashHandoffScreen |
| 08 | Status-aware safe buttons Prevent “Confirm” on closed hand-offs or while a prior save is pending. Indicate disabled reason. | EXISTS (part) — a count against a changed hand-off is refused with the current figure shown (conflict); saves disable while pending |
| 09 | Data freshness indicator Display last verified refresh time with Retry for network/API failures; do not turn service failure into financial zero. | BUILT — Numbers updated {time} stamped only after a successful summary; a failed refresh shows the error with Retry (never $0) and the last good time (cash-fresh; POSCashHandoffScreen.test) |
| 10 | Quick View Daily Closeout Link to the branch and business date already selected without expanding tenant/branch scope. Engineering addendum / November 7, 2026 Addendum page 16 AI POWERSALON / END-OF-DAY CASH / SUNMI FLEX | EXISTS — End-of-Day Cash is the Daily Closeout screen itself (/cash-handoffs); branch and business date stay as selected |
| 11 | Module Preservation Registry Take before/after inventory of all route components, hooks, actions and permissions; make missing module a release blocker. | EXISTS — module registry + preservation matrix gate |
| 12 | Controlled device calibration Optional user-visible device profile only after measuring the real CSS viewport; never rely on hardcoded screen-name detection. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 13 | Touch keyboard responsiveness On-screen keyboard must not obstruct the amount field, save action, or count confirmation; adjust overlays dynamically. | TODO |
| 14 | Bilingual label verification Verify Front Desk POS English and Vietnamese label expansion; keep other applications English-only under existing scope. | EXISTS — EN/VI behind t(); other apps stay English (english-only-apps gate) |
| 15 | High-volume / large staff support Test 200 technicians, many hand-offs and thousands of source cash tenders using server pagination and efficient queries. | NOISE — load-test instruction (list is server-paged) |
| 16 | Export scope transparency CSV/PDF must state tenant/branch, business date, selected date field, filters, as-of time and authorized source rows. | EXISTS — the CSV opens with a scope block: generated time, period + date basis + timezone, search and filters (cash-handoffs-screen.repository exportCsv via finance-scope csvDocument) |
| 17 | Period-lock & revision handling Closed daily cash records require permission-controlled reopening with a complete prior history. | TODO |
| 18 | Non-destructive schema policy Inspect existing cash hand-off tables, ledgers and events; reuse them. No duplicate ledger or destructive migration to improve screen fit. Engineering addendum / November 7, 2026 Addendum pa | NOISE — schema policy (no duplicate ledger) — holds: hand-offs reuse the existing cash tables |

## Receipt Document Recognition (6)

| # | Recommendation | Status |
|---|---|---|
| 01 | Overview Six even KPI tiles; processing/health summary; recent documents queue; balanced search, filters, upload and safe refresh actions. | EXISTS — KPI tiles, health check, recent documents with search/filters (rcsx-kpis, rcsx-health, rcsx-row) |
| 02 | Quarantined Security-scanner status, reason, uploader and timestamps; readable two-panel details; restricted release/recheck controls; unsafe preview blocked. | TODO |
| 03 | Extracting Queue/scan/OCR/validation phases, job freshness, attempts and errors; compact processing cards and sortable job table; verified retry eligibility. | TODO |
| 04 | Manual Entry Vendor, invoice ID, dates, currency, totals, line items and attachment; aligned form sections; consistent validation and duplicate gates. | EXISTS — manual entry path on the review screen (rrx-manual) |
| 05 | Review Required Original PDF/image on left and extracted/editable verified data on right, equally prominent; clear approval controls, line-item evidence and source links. Shared navigation contract • All ten labels remai | TODO |
| 06 | Ten Existing Tabs - Functional Requirements 1. Overview • Show six existing metrics from real tenant-scoped queries, with consistent status definitions and last-updated state. • Each KPI drills into the correct filtered  | NOISE — the guide's own tab-by-tab requirements heading |

## AI Scheduling Optimizer (18)

| # | Recommendation | Status |
|---|---|---|
| 00 | 0 Off Enabled Search: customer, phone, technician, service, appointment ID... SEARCH | NOISE — screenshot text (status / search placeholder) |
| 01 | Screenshot baseline and preservation inventory Observed screen title: AI Scheduling Optimizer. Existing route: /tenant/ai/scheduling-optimizer. The captured page contains a Refresh action, four status counters, a How thi | NOISE — preservation-inventory instruction |
| 02 | Recommendations | EXISTS — Recommendations tab: searchable, paged queue (POSAISchedulingOptimizerScreen 'recs') |
| 03 | Schedule Gaps | EXISTS — Gaps & Conflicts tab (schedule gaps from a deterministic engine) |
| 04 | Overbooking & Conflicts | EXISTS — Gaps & Conflicts tab (overbooking / conflicts, hard rules checked before scoring) |
| 05 | Busy & Understaffed | EXISTS (part) — Insights → Staffing (SchedInsightsCard kind 'staffing') |
| 06 | Technician Utilization | NOISE — bare heading (detailed in row 12) |
| 07 | Duration Insights | EXISTS — Insights → Duration: service durations from real history with sample size; approving one changes only the engine's planning duration |
| 08 | Appointment Availability | EXISTS — Find a Time tab + Insights → Availability |
| 09 | Optimization History | EXISTS — History tab led by the append-only event trail |
| 10 | Automatic Optimization ALSO PRESERVE Refresh; How this works; Open recommendations, Awaiting customer approval, Automatic optimization and Module counters; sidebar, salon selector, top search, notifications, owner accoun | NOISE — preserve-list instruction |
| 11 | Module 5 - Busy & Understaffed Analyze workload coverage by hour, branch, service category and qualified staffing; use verified booking volume, work shifts and demand history. • Show available qualified technicians, book | TODO |
| 12 | Module 6 - Technician Utilization Calculate utilization from an explicitly defined denominator and comparable working minutes, rather than raw booking count. Existing route: /tenant/ai/scheduling-optimizer 7 AI POWERSALO | TODO |
| 17 | Preserve Tech Queue rotation and fairness AI Scheduling Optimizer must not become an unauthorized substitute for Tech Queue, Customer Queue or assignment policies. • Respect the established fair rotation, explicit techni | NOISE — preservation rule (Tech Queue rotation untouched) — holds |
| 20 | Illustrative API contracts (adapt to current routes) Claude must discover current API names before adding anything. These examples describe behavior only; they are not an instruction to create competing REST endpoints. O | NOISE — illustrative API contracts |
| 21 | Freshness, workers, consistency, and performance • Use existing Booking event stream/WebSocket/SSE to invalidate or update affected recommendations after booking create/edit/cancel, shift change, break change, qualificat | NOISE — freshness/performance guidance |
| 24 | Health Checker - diagnostic matrix COMPONENT VERIFICATION / FAILURE EXAMPLE Booking and locks API reachable; overlapping holds honored; no false openings Technician shifts Shift version fresh; actual breaks and time off  | EXISTS — Check Scheduling System (read-only diagnostic matrix) |
| 25 | Test matrix - real scenarios, not visual mockup only AREA REQUIRED TEST SCENARIOS Tab and shell All ten tabs route, original header/sidebar preserved, 100% zoom on 24/27-inch layouts Search Name/phone/service/tech/appoin | NOISE — test-matrix instruction |

## Stock Alerts Technician Product Usage (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-Click Stock Accuracy & Alert Health Checker Compare on-hand vs available stock, thresholds, branch scope, sidebar badges, page KPIs, acknowledged filters, cache freshness, and negative stock cases. | BUILT — shared read-only Check Inventory System (GET pos/system-checks/inventory, components/SystemCheck); pgtest 5/5 + PG16 run |
| 02 | One-Click Technician Usage Integrity Checker Trace each confirmed usage event to exactly one inventory movement; flag orphan events, duplicate decrements, missing technician IDs and mismatched units. | BUILT — shared read-only Check Inventory System (GET pos/system-checks/inventory, components/SystemCheck); pgtest 5/5 + PG16 run |
| 03 | One-Click “Last Used By” Verification Validate effective occurred-at ordering, corrections, reversed uses, archived technician IDs and mismatch with cached last-user fields. | TODO |
| 04 | Automatic Screen Fit & Module Health Checker Inspect page and tab overflow, clipped labels, inaccessible pagination, uneven cards and touch target sizes at 100% zoom. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 05 | Product-to-Service Consumption Review Verify known recipes / BOMs, ticket links, multi-technician allocations, and whether any automatic consumption policy was enabled by the tenant. | TODO |
| 06 | Reorder & Receiving Reconciliation Compare suggested reorder quantities, open POs, actual receipts, movement history and post-receipt alert recalculation. | BUILT — lowStockCause().reorder (stock-alerts.repository): suggested reorder via reorderSuggestion (on-order subtracted), open-PO quantity, partly received lines, receipts in the window, last receipt quantity; live alert state from on-hand (post-receipt recalculation) + reorder-recon line in the Stock Alerts product overlay (tests: product-usage.pgtest Low-Stock Cause reorder block, POSInventoryAlertsScreen.test reorder-recon) |
| 07 | Inventory Data Freshness & Realtime Monitor Expose last updated timestamp and disconnected / stale states for stock, alert counts, technician usage and offline retries. Implementation addendum • Original 32-page specific | BUILT — last good update time on Stock Alerts; a failed refresh says it is stale (alerts-fresh) (shared FinanceKit useFreshAt/FreshnessLine; components/FreshnessLine.test.tsx) |
| 08 | Smart Restock Priority Assistant Rank truly low/out-of-stock products by expected demand and reorder lead time, while requiring staff approval for actual purchasing. | TODO |
| 09 | Barcode Scan & Double-Tap Protection Make scanner flows quick on touchscreens with visual confirmation and idempotency protection across repeated scans. | EXISTS — Record Product Use: a scanner's barcode + Enter picks the exact product, chosen product shown, one idempotency key on confirm (POSInventoryAlertsScreen onScan) |
| 10 | Product Usage Details Overlay Show one product’s last user, all technician totals, usage timeline, reversals and related ticket references within a bounded panel. | EXISTS — product details overlay: Overview · Pricing · Inventory · Suppliers · Usage (technician uses, reversals) · History (components/InventoryKit ProductDetailsDialog) |
| 11 | Technician Consumption Trend Offer period-based product / technician summaries with units and service volume context; avoid ungrounded misconduct alerts. | EXISTS (part) — Technicians tab: per-technician product totals for the period with units (no misconduct conclusions) |
| 12 | Low-Stock Cause Explanation Describe whether low stock is driven by confirmed usage, receiving delays, corrections, reservations, or inconsistent inventory units. | BUILT — GET /tenant/inventory/stock-alerts/products/:id/cause (StockAlertsRepository.lowStockCause: last 30 days of movements by kind — usage, received, losses, corrections — open/overdue purchase orders, last receipt, ledger vs on-hand; measured causes only, "no movements" when none) + LowStockCause in the Stock Alerts product overlay (tests: product-usage.pgtest "Low-Stock Cause", POSInventoryAlertsScreen.test "explains why it is low") |
| 13 | Staff-Friendly Acknowledgment Workflow Show who acknowledged alerts, when, what remained unresolved, and what was later restocked. | EXISTS (part) — Acknowledge on active alerts and an Alert History tab (acknowledged / resolved over time) |
| 14 | Safe Export & Audit Drill-Down Authorized CSV/PDF export of all matching records, not only first page, with branch scope, units, date field, actor and event IDs. | EXISTS (part) — CSV export of the current tab's matching rows with its scope (posInventoryAlertsApi.exportCsv) |
| 15 | EN/VN Visual Resilience Test Vietnamese labels, 24-hour / 12-hour formatting, decimal units and Unicode diacritics in the Front Desk POS only. | EXISTS — EN/VI behind t(), Front Desk only; Vietnamese harness certified |
| 16 | Automated Regression Screenshots Snapshot SUNMI-class layout states for empty, low-stock, heavy-use, long-name, long-Vietnamese-label, and huge-history datasets. Implementation addendum • Original 32-page specification a | EXISTS — certified one-screen screenshots EN + VI (stock alerts page in the harness) |

## Service Recommendations 5 (36)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-Click Health Checker: verify Customer Management, Service Done, catalog availability and pricing, Booking, technician qualifications, workers, subscriptions, cache freshness and tenant scope. Explain missing results  | EXISTS — Check Service Recommendations System (srx-check), read-only |
| 02 | Customer 360° evidence and recommendations: show verified completed services, customer preferences, current catalog prices, technician qualifications, upcoming appointments, human review and approved booking handoff. | EXISTS — 360° overlay: evidence, completed services, preferences, today's catalog price / duration / add-ons, qualified technicians, bookings, memberships (ov-*) |
| 03 | Full-screen dashboard, search, calendars and pagination: use unused space; support month-view From/To pickers, tabbed queues, advanced search, and newest-first numbered pages. Before implementing, Claude must audit the e | EXISTS — opens on the salon's queue: tabs, type/service/technician filters, date basis + From/To month calendar, sort, numbered pages (POSAICustomerRecommendationsScreen) |
| 04 | Full-screen design Pages 5-8: runtime viewport, Grid/Flex, balanced design, screen blueprint. 5-9 AI logic, catalog, customer, bookings, staff Pages 10-12: Customer 360°, evidence, active pricing, technician and booking  | NOISE — design/blueprint pages reference |
| 05 | Customer Intelligence. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 06 | Customer Profile AI. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 07 | Duplicate Review. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 08 | Churn Watch. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 09 | Rebooking Opportunities. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 10 | Customer AI Settings. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 11 | Services & Products catalog. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 12 | Active and inactive service records. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 13 | Service prices, durations and approved add-ons. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 14 | Manual service-price override rules. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 15 | Service Done and completed-service history. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 16 | Checkout and existing ticket records. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 17 | Booking Calendar. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 18 | AI Booking Assistant. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 19 | Technician skills and service qualifications. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 20 | Technician work schedules, breaks and availability. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 21 | Customer preferences. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 22 | Memberships. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 23 | Loyalty & Rewards. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 24 | Customer Retention. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 25 | Communications and customer consent. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 26 | AI subscriptions, permissions and usage. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 27 | AI Gateway and recommendation workers. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 28 | Redis caching and synchronization. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 29 | Tenant and branch authorization. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 30 | Existing database schemas, migrations, audits and tests. For every component, report whether it is: AI POWERSALON / CLAUDE ENGINEERING HANDOFF | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 31 | Tenant isolation. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 32 | Branch authorization. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 33 | Audit logging. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 34 | API errors. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 35 | Data freshness. | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |
| 36 | Recommendation outcome tracking. Health states • Passed • Warning • Failed • Insufficient Data • Unavailable For each issue show: • Affected component • Verified problem • Possible cause • Suggested corrective action • L | NOISE — an item in the guide's list of components to verify (audit checklist), not a feature |

## Serving (10)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-click Serving Layout & Module Health Checker Operator/developer diagnostic that verifies screen fit, no panel clipping, module presence, API wiring, permission checks, missing buttons, realtime status, and touch targ | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Saved SUNMI 27-inch certified display profile A tested, reusable design-token/layout preset chosen automatically by measured container conditions. Device-local exceptions must not affect other tenants or screen sizes. | EXISTS — the shell's certified 1920×1080 SUNMI display profile chosen automatically from the live viewport (shell/displayProfile.ts densityFor) |
| 03 | Balanced Module Sizing Controller Centralize row/column weights, gap scale, min readable sizes, and resize-mode thresholds; stop individual components imposing arbitrary widths/heights. | TODO |
| 04 | Smart Service Attention Priority Within the existing Live Service Floor and AI Insights, surface delayed services, conflicting bookings, overdue handoffs, and missing confirmations with a clear severity label and safe dr | TODO |
| 05 | Technician Capacity & Handoff Readiness Preview Within current technician/guest cards, show authorized live capacity, expected finish, qualified availability, and why a Visit is or is not ready for Service Done. | TODO |
| 06 | Multi-technician Line Ownership Inspector From Guest Service Details, offer a detail drawer showing performer, service line, progress, add-on assignment, and audit history without exposing payroll secrets. | TODO |
| 07 | Touch Safe Action Review For Mark Ready, reassignment, manual price changes or impactful add-ons, show selected guest, affected service, actor permission and any conflict before confirmation. | TODO |
| 08 | Service Timing & Data Accuracy Checker Compare displayed elapsed/expected timing and KPI totals with backend timestamps/authoritative reports; show stale/unknown status rather than fabricated percentages. | BUILT (part) — Check Service Flow System: serving over 8 h is flagged; the per-ticket elapsed-vs-expected comparison is not built |
| 09 | EQUAL-WIDTH KPI TILES (ALL NINE) LIVE SERVICE FLOOR (1.12fr) / SERVICE PROGRESS BOARD (1.12fr) / AI SERVICE INSIGHTS (1.00fr) | NOISE — a layout blueprint (equal KPI tiles / column weights) — the Serving page is certified in the harness |
| 10 | Automated Visual Module Parity Gate CI checks screenshot snapshots, all 9+3+3+5+7 required entry points, mobile/desktop fallbacks, overflow, keyboard focus, panel scroll and button touchability. Build instructions · pres | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |

## AI Business Assistant (14)

| # | Recommendation | Status |
|---|---|---|
| 01 | Business Answer Trust Bar Show last verified refresh, source coverage and pending data reconciliation before each answer; computed from real checks, not a made-up score. | EXISTS (part) — every answer shows its supporting numbers, freshness and caveats (POSAiBusinessScreen) |
| 02 | One-Click Data Drilldown Click any KPI for authorized existing report/transaction records; retain time and branch scope. | EXISTS (part) — each answer has a drilldown to the real report |
| 03 | Comparison Explainer State selected prior period, calculation basis and revenue vs profit definition for every comparison. | BUILT — ComparisonBasis in POSAiBusinessScreen: every revenue comparison (explain_revenue answer) states the periods compared (incl. previous-window and in-progress period), the metric calculation basis from the server evidence (net_sales definition, localized), and that revenue is not profit (tests: POSAiBusinessScreen.test "states the periods compared" + no-comparison case) |
| 04 | Smart Question Suggestions Suggest relevant read-only follow-up questions from current authorized context; never imply AI can directly send/charge. | TODO |
| 05 | Balanced Card Auto Layout Dynamically wrap 7 quick questions and four KPIs; equal padding/heights, no unused giant cards. | NOISE — card layout instruction |
| 06 | Session-Safe Workspace Preserve current draft, filters and open answer while browsing within the same tenant; wipe cached scope when switching tenant. | BUILT — period, custom range and the typed question come back after browsing away in this tab; all remembered aps.* UI state is dropped when another user/salon signs in on the tab or on sign-out (useSessionState + AuthContext scopeSessionUiState/clearSessionUiState; tests) |
| 07 | Data Freshness Warning Flag stale source/event lag and offer Refresh/Retry, not fabricated zeros or full-green status. | EXISTS (part) — freshness shown with each answer, Refresh / Retry (aib-refresh, aib-retry); degrades to metrics-only, never fabricated |
| 08 | Executive Summary Mode Optional concise answer preview and Expand for full details; never hide original questions, charts or history permanently. | TODO |
| 09 | Multi-Branch Fairness Notes Normalize staffing/operating hours, show input denominators and clarify that a larger branch naturally has higher totals. | TODO |
| 10 | What Changed Since Last Check Compare two validated reporting snapshots and identify data corrections vs actual business change. | TODO |
| 11 | Context-Aware Empty States When no authorized data, no subscription or no report source, explain what is missing and give a safe next action. | EXISTS (part) — no AI package: says so and still shows the metrics |
| 12 | Touch and Keyboard Comfort Large tap targets, visible focused fields, accessible date picker, modal focus trapping and keyboard Escape/Close behavior. | NOISE — touch/keyboard instruction (FitDialog focus trap + Esc already shared) |
| 13 | History Provenance Timeline Keep saved answers immutable and show refresh/version, source IDs, who viewed/approved exports and permissions. | EXISTS (part) — saved answers searchable with re-run (aib-saved-search, aib-rerun) |
| 14 | Performance at Scale Paginate large datasets, virtualize only where justified, bound backend queries and cache per tenant/branch with invalidation. Implementation efficiency • Prefer extending common POS card, table, dat | NOISE — performance instruction |

## Customer Profile Global Loyalty Protection (6)

| # | Recommendation | Status |
|---|---|---|
| 01 | Request Authorized manager submits positive amount and reason. Server validates and stores pending status. | EXISTS — POST /pos/loyalty/bonus-requests: positive points + reason, server stores a pending loyalty_bonus approval (customers/loyalty/loyalty-bonus.ts) |
| 02 | Notify Correct salon Owner App inbox receives durable record; push notification is supplemental and cannot approve. | EXISTS — request lands on the salon approvals engine shown in the Owner App Approvals inbox (loyalty-bonus.ts) |
| 03 | Review Owner sees customer, salon/branch, requester, reason, current points, proposed award, available tokens and token cost. | EXISTS — owner sees server-computed current points, after-approval preview and token cost (loyalty-bonus.ts header) |
| 04 | Decision Authenticated authorized owner explicitly Approve or Reject; high-value award reauth if current policy requires. | EXISTS — OWNER-only approve/reject (loyalty.bonus.approve), never the requester, one-week expiry |
| 05 | Posting On approval only, verify current policy and funding, atomically/durably post one token debit + one global credit. | EXISTS — executor runs once; funded bonus = one token debit + one global credit in one transaction (postFundedBonus); too few tokens → nothing moves |
| 06 | Confirm Both POS and Owner App show source-backed status, timestamps, transaction references and accurate final balances. Compatibility guard • Preserve existing Owner App account, device authentication, layout standards | EXISTS — request status, timestamps and references shown in POS and Owner App; health check approved_bonus_posted_once |

## AI Command Center (4)

| # | Recommendation | Status |
|---|---|---|
| 09 | Touch, keyboard and accessibility standards SUNMI is a POS touchscreen. Receptionists should be able to operate the AI Center reliably by touch without mouse-specific gestures. COMPONENT TARGET BEHAVIOR Primary actions C | NOISE — accessibility standards text |
| 15 | One-click AI Command Center Health Checker Extend the original “Check AI System” requirement. One click should run safe, primarily read-only diagnostics with per-assistant evidence. HEALTH DOMAIN DETECT AND EXPLAIN Catal | EXISTS (part) — Check AI System card on the AI Command Center (aic-check) |
| 16 | Full assistant details and activity overlays A compact card can stay evenly sized while complex content moves into a complete, accessible details overlay. Preserve the original actions. DETAIL TAB DATA / ACTION Overview  | TODO |
| 21 | QA test matrix A — shell, UI, search and accessibility Run automated browser assertions plus physical-device manual checks where possible. Save pass/fail evidence instead of writing “looks good.” TEST REQUIRED SCENARIO U | NOISE — QA test matrix |

## Discounts Management (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Discounts Accuracy Reconcile the five KPIs, rule lifecycles, eligibility and expiration definitions. | EXISTS — five KPIs (active, expiring, percent, fixed, redemptions) from the server ledger (kpi-*) |
| 02 | Screen Fit & Module Health Find cropped buttons, overlapped popovers, inconsistent KPI dimensions, hidden pager and sideways page overflow. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | Coupon Eligibility & Limits Explain min spend, exclusions, caps, expiration, branch rules and allowed customer segments. | EXISTS — discount details Eligibility and Limits sections (dd-eligibility, dd-limits: min purchase, caps/remaining, dates, branch) in POSDiscountsScreen |
| 04 | Redemption Integrity Identify duplicate use, pending-vs-confirmed confusion, bad timestamps and idempotency errors. | TODO |
| 05 | Checkout & Payment Wiring Verify discount preview, confirmed ticket, Fiserv callback status and downstream receipt agreement. | NOISE — wiring verification instruction |
| 06 | Tenant Security & Permissions Check tenant isolation, code masking, customer access, audit coverage and unauthorized overrides. Health Checker output standard • Each check returns Pass / Warning / Failed / Not Verified,  | BUILT — shared read-only Check Discounts System (GET pos/system-checks/discounts, components/SystemCheck); pgtest 5/5 + PG16 run |
| 07 | Readable No-Data State. Explain genuine zero records separately from no permission, API unavailable and filtered-out results. | EXISTS — filtered-out results ("No discounts match …" + Clear filters) are told apart from a genuine zero; 403 → permission message (POSDiscountsScreen.403.test) |
| 08 | Role-Aware Export Preview. Preview number of matching records and applied PII masking before authorized download. Implementation instructions / 07 November 2026 Addendum page 19 AI POWERSALON / DISCOUNTS MANAGEMENT SUNMI | BUILT — Export shows the matching count, filters and masking before the CSV is generated (ExportPreview; POSDiscountsScreen.test) |
| 09 | Automatic Savings Explanation. Display eligible subtotal, rule calculation, cap/exclusion adjustment and total saving as separate lines. | BUILT — screens/deals/savingsExplain.ts (mirrors deals-checkout-core math + coupon cap) + SavingsWhy in RedemptionsTable (coupon detail → Redemptions): eligible subtotal, rule line, cap/subtotal limit, recorded saving; a saving that differs from today’s terms is kept and called out (tests: savingsExplain.test.ts, savingsWhy.test.tsx) |
| 10 | Stacking Conflict Advisor. When membership, loyalty, gift card or another coupon overlaps, show which verified policy wins. | TODO |
| 11 | Refund Impact Preview. Before authorized refund, show original discount allocation and whether coupon-use reversal applies under existing policy. | BUILT — deals engine/refund-outcome.ts (the ONE refund rule, now used by ledger reverseForTicket too) + GET /pos/discounts/refund-impact/:ticketId (pos.checkout.refund, read-only: each discount’s line allocation and reverse/partial/release/keep outcome, place returned) + RefundDiscountImpact in TicketRefundPanel preview (amount-only refund keeps discounts, as checkout.service does) (tests: refund-outcome.vitest.spec, discounts-screen.pgtest "Refund Impact Preview", ledger regression 76 tests, TicketRefundPanel.test "refund impact preview") |
| 12 | Duplicate Provider Event Alert. Flag duplicate payment callbacks and repeated coupon commit attempts without counting extra uses. | TODO |
| 13 | Redemption to Receipt Drilldown. Link promotion usage to immutable checkout evidence and the corresponding customer record. | BUILT — every redemption row links its ticket (red-ticket: paid → its receipt in Transactions, unpaid → Checkout; shared ticketRoute with Promotions) and the customer record; POSDiscountsScreen.ticket test |
| 14 | Configuration Drift Monitor. Compare displayed discount eligibility with canonical Promotions config and active branch state. | TODO |
| 15 | Auto-Fit Regression Suite. Capture screenshots and overflow assertions for the target SUNMI and fallback CSS viewports. | NOISE — screenshot regression instruction (tooling/e2e/pos-vi-one-screen.mjs) |
| 16 | Safe Change / Rollback Report. Produce a diff of touched components and show what was changed, preserved, verified or rolled back. Priority Prioritize viewport-fit and module preservation, then financial correctness and  | NOISE — change-report instruction |

## 200-Technician Large Salon 4 (20)

| # | Recommendation | Status |
|---|---|---|
| 01 | Smart Jump-to-Technician: keyboard/touch search, exact skill match, page jump, temporary column highlight and link to authorized full-day detail. | TODO |
| 02 | Shift-Aware Staffing Heatmap: summarize ready, booked, on-break and late technicians per time band; expand to underlying authorized schedules. | TODO |
| 03 | Fair Turn Explainability: display eligibility and skip reasons with a manager-facing review history, not a second competing fairness calculation. | TODO |
| 04 | Opening-Hour Surge Mode: optimize batch clock-ins and check-ins, show queue backlog and pending assignments without hiding core action buttons. Recommendations 5-8 | TODO |
| 05 | No-Hidden-Limit Validator: run repeatable 12/24/50/100/199/200/201 employee data tests across endpoints, page counts and filters. | EXISTS (part) — repeatable large-roster tests: payroll-200-technicians.pgtest and the live pilot day's 24-technician / 110-booking paging checks; not every endpoint at 199/200/201 |
| 06 | Technician Skill Coverage: identify service types lacking enough qualified on-shift staff and recommend staffing/schedule review. | TODO |
| 07 | Appointment Conflict Preview: before moving a booking, show duration, buffer, next appointment and hard constraint explanation. | EXISTS — Schedule Conflict Warning before moving a booking: every cause + alternatives (POSTechAppointmentsScreen act-check-conflict / dlg-conflict) |
| 08 | Quick Bulk Staff Actions: invite, search, print/export selected or review exceptions with confirm/audit controls and RBAC. Important boundary Do not invent automatic assignment, change technician eligibility, notify cust | TODO |
| 09 | Responsive Layout Health Overlay: developer-only inspector for clipped controls, DOM overflow, last visible action and internal scroll panels. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 10 | Balanced KPI Presets: consistent 2/3/4-card responsive grid based on container width; data-rich tables get flexible workspace instead of equally tiny columns. | NOISE — layout guidance |
| 11 | Tech Queue, Fair Turn and Assignment A balanced live queue that does not overwhelm the SUNMI display Preserve queue semantics Keep Ready, Serving, Break, Appointment Soon, Hold and Off Shift states; any existing History  | NOISE — preserve-semantics guidance |
| 12 | Team and 200-Person Workforce Management Even modules for staffing; fast tables for record-heavy workflows Management modules to retain Keep technician profiles, Active/Inactive, Branch, Skills, Roles, Employment, Invita | NOISE — module guidance |
| 13 | Time Clock, Schedules and Opening Bursts Every clock event must update eligibility without duplicating shifts Dataset and resilience Generate 200 technicians x 7 days of shifts, breaks, lunch, appointments, time-off and  | NOISE — dataset / resilience guidance |
| 14 | Payroll Accuracy Checker: source-to-statement-to-payout reconciliation with visible exception links; no autonomous financial mutation. | EXISTS — payroll cross-check and the persisted Discrepancy Review (statement vs sources vs payouts) with exception links; nothing auto-changes money |
| 15 | Realtime Noise Guard: aggregate frequent technician status bursts and refresh only affected UI projections. | TODO |
| 16 | Accessibility and Language QA: verify EN/VN Front Desk labels, dynamic label lengths, focus order, text scaling and reduced motion. Design principle Balance comparable modules; never force the 12-column scheduler, a KPI  | EXISTS — EN/VI on the Front Desk POS; Vietnamese harness certified across 147 pages |
| 21 | Additional Recommendations: Faster Operations Additive suggestions - implement only after verifying existing equivalents Recommendations 1-4 | NOISE — heading for additional suggestions |
| 58 | Service-technician compatibility Selecting a service should recommend/filter only technicians approved for that exact service. Claude / Developer Build Mandate / 8 AI PowerSalon / 200-Technician Large Salon Scale Upgrade | EXISTS (part) — technician service eligibility (migration 583/631) drives Best Matches / open times by skill (live pilot day checks) |
| 59 | Appointment protection at scale Efficiently verify now + estimated duration + cleanup buffer <= next appointment using indexed/batched data. | EXISTS (part) — overlapping bookings refused by a database exclusion constraint; the live pilot day's booking race check |
| 60 | Realtime fanout performance Simulate 50+ active POS/manager/tech clients if feasible and verify no uncontrolled N x N broadcast behavior. Claude / Developer Build Mandate / 9 AI PowerSalon / 200-Technician Large Salon Sc | NOISE — load-test instruction |

## Referral Program (2)

| # | Recommendation | Status |
|---|---|---|
| 33 | Original 2 referral codes and customer/code ownership remain unchanged after layout refactor. | NOISE — preservation rule (codes unchanged) — holds |
| 34 | Zero recorded referrals remains true when source records genuinely contain none; no seeded fake history. | NOISE — rule (no seeded fake history) — holds |

## Promotions Management (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Screen Fit Self-Test A read-only “Check Screen Fit” diagnostic showing actual viewport, sidebar width, overflow and too-small tap targets. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Balanced Layout Presets Comfortable / Compact density per tenant device; never use global browser zoom or erase controls. | BUILT — opt-in Compact spacing per device (profile menu → Compact spacing; Standard = certified default; gaps/padding only, never fonts or touch targets) — shell/spacingPref.ts + spacingPref.test 2/2 |
| 03 | Promotion Quick Preview Inspect effective terms and sample eligible ticket without saving a redemption or charging a card. | EXISTS (part) — Eligibility Checks scope + Check Promotion (read-only; nothing redeems) (POSPromotionsScreen) |
| 04 | Expiration Calendar See upcoming expiration by branch; link back to same canonical promotion ID. | BUILT — screens/deals/ExpirationCalendar.tsx opened from the Expiring Soon KPI: live promotions ending in the next 7/30/90 days (existing list, dateField=ends, salon-local today), grouped by day with branch / salon-wide label, each opening the same canonical promotion id in the shared detail; >100 rows says so (test: POSPromotionsScreen.test "expiration calendar") |
| 05 | Promotion Cloning Duplicate safely into Draft with a new code/version; never copy completed uses or approval. | EXISTS — Duplicate from the details creates a DRAFT with a new code; completed uses are never copied (DuplicateDialog) |
| 06 | Pause Impact Warning Show current branch/campaign/Checkout impact before owner confirms Pause. | BUILT — Pause asks first and shows code(s), where it applies, uses vs cap and dates, and says Checkout stops accepting it (server refuses non-active deals: deals.service DEAL_NOT_AVAILABLE) while paid tickets keep their discount (dlg-confirm-pause; POSPromotionsScreen.test) |
| 07 | Code Conflict Finder Detect overlapping code, conflicting service eligibility and unintended stacking. | TODO |
| 08 | Saved Filters Role/tenant-scoped saved library filters, without exposing other salon data. How Claude should add recommendations • Check whether each capability already exists. Improve what is present; do not create dupl | BUILT — POS saved views (migration 844, pos/me/saved-views, components/SavedViews); pgtest 6/6, component 4/4 |
| 09 | Discount Exposure Meter Estimate maximum planned discount outlay from allowed uses and caps; label as estimate. | BUILT — screens/deals/exposure.ts + ExposureRows on the shared coupon detail Limits tab (Promotions/Discounts/Coupons): uses left × per-ticket max, or remaining budget when tighter, labelled as an estimate; unlimited uses / uncapped percent say "no ceiling" instead of a figure (tests: exposure.test.ts, exposureDialog.test.tsx) |
| 10 | Redemption Reconciliation Daily comparison of promotion usage to finalized Checkout and approved refund adjustments. | TODO |
| 11 | Fraud/Abuse Signals Flag repeat-account, high-use or unusual override patterns for human review; no automatic penalty. | TODO |
| 12 | Promotion ROI Explanation Distinguish associated ticket revenue, discount expense and measured contribution; no invented incremental return. | EXISTS (part) — Financial tab: discount actually redeemed vs linked ticket sales (associated, not caused) |
| 13 | Branch Comparison Compare per-branch eligible tickets and redemption rates with consistent denominators. | EXISTS — per-branch breakdown with the same redemption basis (by-branch view) |
| 14 | Version and Audit Timeline See the exact terms effective at each redemption; keep historical versions immutable. | EXISTS (part) — Activity tab: who paused / resumed / archived, when, before → after with version |
| 15 | Checkout Conflict Simulator Use staging fixtures to test coupons, membership, loyalty, split payment, refund and gift cards. | TODO |
| 16 | No-Double-Use Monitor Alert on duplicate callback/idempotency anomalies and cap-race failures; suggest safe correction. Explicit guardrails • Financial recommendations are for reporting or controlled approval. They must  | TODO |

## Payment Terminals (4)

| # | Recommendation | Status |
|---|---|---|
| 07 | Terminal inventory table and 360-degree details A terminal row must open an authorized full-screen/large touch-friendly detail overlay. • Detail fields: terminal nickname, validated device type, provider integration path | EXISTS — POSPaymentTerminalsScreen terminal row → large detail overlay (FitDialog wide): nickname, validated model, location (or unassigned warning), live status with source freshness, troubleshooting per attention state, test connection / rename / enable-disable / assign / unpair by permission, activity + history (tests: POSPaymentTerminalsScreen.test.tsx) |
| 08 | Tap to Pay Phones inventory and state Preserve the 13-phone list shown in the screenshot as a UI capability; actual unique count comes from live enrollment records. • Display enrollment state separately from real-time co | EXISTS — POSPaymentTerminalsScreen Tap to Pay phones from live enrollment records (posMobilePaymentsApi), phone detail overlay with enrollment status shown apart from online state ("active is not online"), staff, platform/app version, sign-ins history, approve/suspend/re-enable/revoke by permission (tests: POSPaymentTerminalsScreen.test.tsx) |
| 09 | Pair Terminal wizard — explicit provider validation Keep the existing Pair Terminal action, but make it reliable, safe and auditable. • Choose branch and register, device type (Clover Compact if verified), provider integ | EXISTS (part) — Pair Terminal kept; the server verifies at pairing with a non-charge probe when it can, otherwise readiness says so |
| 10 | Test Connection must never charge a card The existing screenshot promises “Testing never charges a card.” Make that true in the backend, not just in the button label. • Check existing API family first. If Clover REST Pay | EXISTS — Test Connection is the provider's non-charge ping; nothing on the page charges a card (POSPaymentTerminalsScreen) |

## Customer Notifications (8)

| # | Recommendation | Status |
|---|---|---|
| 01 | Unified Notification Contract: shared event types, recipient/read semantics, source references and schema-versioned payloads across all app SDKs. | TODO |
| 02 | Badge Accuracy Self-Check: one-click comparison of server count vs each UI badge, with diagnostic evidence and safe recalculation. | TODO |
| 03 | Mark All as Read with Cutoff: explicit, permission-scoped action that does not erase new items arriving during the operation. | TODO |
| 04 | Cross-Device Reconciliation Monitor: track last successful unread-count sync per session; show stale/broken clients and repair steps. | TODO |
| 05 | Notification Priority and Categories: separate urgent security/payment alerts from information and marketing, without changing original event history. | TODO |
| 06 | Protected Deep-Link Routing: validate tenant/customer/entity access again upon notification open, including expired links. | TODO |
| 07 | Read vs Acknowledge vs Resolve: keep audit-grade incident workflow distinct from merely opening an alert. | TODO |
| 08 | Notification Preferences and Quiet Hours: user/channel preferences and tenant policy, purpose-aware and respecting required transactional notices. Recommendations are additive All eight enhancements must reuse the curren | TODO |

## Gift Cards (5)

| # | Recommendation | Status |
|---|---|---|
| 01 | Balanced Screen Fit Inspector Read-only developer/QA panel checks overflow, card height variance and control reachability. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Gift Card Trust & Freshness Every balance and KPI exposes data owner, last verified timestamp and source drill-down. | BUILT — Gift Cards KPIs: as-of FreshnessLine (existing) + new data-source line (card balances vs transaction ledger, branch scope, live read) and every KPI drills down (Issued now opens the branch ledger/liability) (test: POSGiftCardsScreen.test "trust & freshness") |
| 03 | Checkout Redemption Readiness Staff preview sees eligibility, card balance, ticket due, split tender effect and approval blockers. | TODO |
| 04 | Liability Reconciliation Workbench Authorized read-only compare of ledger liability, 5 KPIs and branch clearing exceptions; no automatic money movement. | EXISTS — Branch Liability & Clearing panel, read-only (POSGiftCardsScreen.liability.test) |
| 05 | Safe Issuance / Replacement Preview Human review of denomination, funding, branch eligibility, recipient and irreversible impact before write. Prioritize safety and usefulness • If a recommendation already exists in the  | TODO |

## AI Queue Assignment (8)

| # | Recommendation | Status |
|---|---|---|
| 01 | Select an existing waiting queue entry by customer/name/phone, with Queue Entry ID retained as advanced lookup. | BUILT — AIQueueCustomerPanel: find a waiting guest by name or phone through the queue’s own server search (items?search=), live list stays the primary picker; the queue entry ID is an on-demand advanced lookup (hidden until asked) (test: POSAIQueueAssignmentScreen.test "extras: find a guest" + existing "no raw ID box") |
| 02 | Resolve actual customer and requested services; show linked customer preference and wait duration. | EXISTS — guest details with requested services, preference and wait (aq-guest-details, AIQueueCustomerPanel) |
| 03 | Fetch candidate technicians from the correct tenant/branch and filter all hard eligibility constraints. | EXISTS — GET /pos/ai-queue-assignment/entries/:id/panel returns every candidate from the tenant/branch with eligibility and the plain hard-rule reasons (QueueAssignmentPanelCandidate); the override list orders eligible first and says why one is not (test: "the override list comes from the panel's candidates") |
| 04 | Run approved rotation policy over the eligible set; provide ranked alternatives with reproducible rule-based reasons. | EXISTS — rule-based explanation for the recommendation (aiq-explanation) |
| 05 | Display availability, next committed appointment, rotation context and any preference exception. | BUILT — screens/ai-queue/AIQueueCandidates.tsx in the guest panel: each candidate’s availability (free / free in / on break / blocked), shift end, next committed appointment, load vs capacity, match score, asked-for / last-time preference badges and ineligibility reasons (test: POSAIQueueAssignmentScreen.test "extras") |
| 06 | Allow receptionist/manager to approve or reject; never commit merely because a recommendation is displayed. | EXISTS — staff must press Assign; a shown recommendation never commits (aqo-assign; AIQueueCenter.test) |
| 07 | Revalidate queue entry version, tech eligibility, Booking conflict, kill-switch, entitlement and permissions at commit | EXISTS — assign is sent with the queue version shown; a guest moved on another device is refused (AIQueueCustomerPanel header comment) |
| 08 | Use the existing Queue Management assignment API transaction; verify committed assignment ID, then update queue/Serving and audit. Recommendation explanations • Show why candidate A is recommended and why B/C are alterna | EXISTS — AIQueueCustomerPanel accept/override assign through the queue (posAIQueueAssignmentApi decision → server queue assignment with the shown version); the response {decision, applied, queueItem, replayed} is checked — "not assigned" said when applied=false, 409 VERSION_CONFLICT explained; recommendation reasons/warnings + engine explanation (api.explain) shown; decisions are audited (history list) (tests: POSAIQueueAssignmentScreen.test Per-customer panel / Round 2) |

## Device Health (2)

| # | Recommendation | Status |
|---|---|---|
| 06 | Search, discovery and serviceable filters • Global search scope: device display name, ID, alias, type, branch, station, masked serial, truncated terminal identifier, asset tag, authorized assigned employee name/phone/ema | TODO |
| 27 | Implementation phases and deployment safeguards • Phase 1 - Inventory audit: inspect route, current data sources, status algorithms, device identities and summary reconciliation; document source-of-truth mapping. Impleme | NOISE — implementation phases text |

## AI Calendar (14)

| # | Recommendation | Status |
|---|---|---|
| 01 | Calendar Fit & Accessibility Health Check Add a staff-visible diagnostics view (or developer-only audit panel) for actual viewport size, overflow/clipped elements, zoom/scale, touch targets, overlays and current responsi | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Verified Appointment Timeline Show auditable status progression: requested, held, OTP sent, OTP verified, confirmed, checked in, started, completed, cancelled; link to real event IDs. | TODO |
| 03 | Availability Confidence / Freshness Show last verified timestamp and eligibility explanation for open slots, including service duration, qualification and current holds. | TODO |
| 04 | Pending Verification Queue Surface expiring holds and pending verification in a filtered view; require staff authorization for retry and never display codes or assume success. | BUILT — GET /pos/ai/calendar-center/holds/pending (AiCalendarCenter.pendingQueue: live slot holds — not released/converted/expired — soonest to expire first, waiting-for-code and ≤10 min flags, salon tz, branch-scoped) + PendingHolds overlay ("Pending verification") with minutes left and Open in Booking; retry/release stay permissioned in Booking (tests: ai-calendar-center.pgtest "Pending Verification Queue", POSAIBusinessAndCalendar.test) |
| 05 | Conflict Explanation Drawer When a slot cannot be booked, explain actual business hours, staff off-shift, qualification, time-off, reserved time or booking conflict. | TODO |
| 06 | One-click POS Booking Reconciliation Compare branch/day IDs and statuses between AI Calendar and POS Booking, with a read-only discrepancy report and source links. SUNMI 27-inch addendum / Original 14-page guide follows  | TODO |
| 07 | Capacity-aware 200-technician display Use the established 12-per-page technician UI plus efficient pagination/virtualization of long histories; never put 200 narrow columns on one screen. | EXISTS (part) — technicians 12 a page on the booking views (live pilot day 24-technician paging check) |
| 08 | Automatic responsive density - without shrinking fonts Switch between spacious and compact grid spacing based on container width, keep equal KPIs and readable text, and retain all operations. | TODO |
| 09 | Deep-link continuity Return users from POS Booking or a customer overlay to the same authorized date, branch, filters and list location. | EXISTS — date + view kept in the URL (replaceState), so back/refresh return to the same day and view; no PII in the URL (POSAICalendarScreen) |
| 10 | AI booking provenance and exception review Create a reviewable list of AI-origin failures, incomplete verification and false source attribution with source IDs and redacted event details. | TODO |
| 11 | Stage-only visual regression suite Capture 1920 x 1080, available CSS viewport at 100% zoom, 1600 x 900, 1366 x 768, 125% display scaling and long-label scenarios. | EXISTS — harness screenshots at certified + responsive sizes |
| 12 | Safe rollout and rollback Gate new visual or diagnostic components behind existing feature flags where available; preserve old UI/API compatibility and reversible migrations. Every recommendation must be additive. Before | NOISE — rollout guidance |
| 15 | Smart AI Scheduling & Availability Assistant Additional recommendation #3. AI may suggest verified openings, qualified technicians, gaps, pending OTP confirmations or conflict risks. Recommendations must have explicit ev | TODO |
| 16 | API, data and multi-tenant architecture Discover and reuse existing contracts • Inspect the actual React frontend, NestJS services, PostgreSQL schema, Redis cache and booking events. Confirm canonical table names and rou | NOISE — architecture guidance |

## Phone  Messaging  Text Messaging Setup (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | SUNMI Screen Fit Actual viewport, effective CSS dimensions, overflow, clipped controls, visible buttons, 100% browser zoom. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx) |
| 02 | Tenant / Branch Scope Authenticated tenant and branch, inherited-vs-overridden configuration, no cross-tenant access. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 03 | Credential Integrity Secret presence and authenticated provider validation; display only redacted metadata. | EXISTS — authenticated provider check before save; only redacted metadata stored (messaging-health.ts, tenant-messaging-credentials.service.ts) |
| 04 | Assigned Sender Provider number ownership, supported channel, E.164 format and Mapping Service association. | EXISTS — number ownership / on-account checks (messaging-health.ts not_owned, not_on_account) |
| 05 | Registration Readiness Applicable Brand/Campaign/compliance state with provider evidence and last verified time. | EXISTS — brand/campaign registration sync with provider state (registration-sync.service.ts, registration-model.ts) |
| 06 | Outbound SMS Sender readiness, test-eligible controlled workflow, provider acceptance separate from delivery. | EXISTS — controlled test send with provider acceptance vs delivery tracked separately (phoneMessagingTestKit.ts, readiness testView deliveredAt) |
| 07 | Inbound SMS & Webhooks Signed callback configuration, tenant routing and event-processing evidence. | EXISTS — inbound webhook URL matches/mismatch per number (messaging-health.ts expectedInboundUrl) |
| 08 | Booking OTP / Verify Verify Service reachability, global+tenant switches, booking pending/confirmed transition. | EXISTS — Verify service reachability in provider checks + booking verification center (runProviderChecks checkVerify, booking-verification-center.ts) |
| 09 | AI Voice / Caller ID Independent call route/status, impacted dependencies and proper number mapping. | TODO |
| 10 | Cross-Module Regression SMS Inbox, Reminders, Notifications, Templates, AI Receptionist and audit logs. Output contract Show each check as Pass / Warning / Fail / Not Tested, latest observation time, safely redacted sour | NOISE — regression instruction / output contract |
| 11 | Tenant-Scoped Delivery Analytics. Distinguish queued, sent, delivered, undelivered and failed; no inferred success. | TODO |
| 12 | Consent Boundary Checker. Keep booking OTP consent distinct from marketing SMS authorization and respect STOP. | TODO |
| 13 | Encrypted Audit Trail. Securely record configuration changes without secrets or full message payloads. | EXISTS — configuration changes audited without secrets (tenant-messaging-credentials.service.ts audit calls); not separately encrypted |
| 14 | Fail-Safe Configuration Save. Invalid partial updates must not silently break a working account. | EXISTS — validate-before-save keeps the working account on a failed check (messaging-health.ts shared by credentials save) |
| 15 | Offline / Provider Degraded Mode. Show last verified state, errors and safe Retry; never fabricate readiness. | EXISTS — last recorded check, error codes and Retry (recordHealthCheck rows) |
| 16 | End-to-End Regression Dashboard. Protect Messages, Notifications, Reminders, Booking Verify, Caller ID and AI Receptionist. AI POWERSALON / PHONE & MESSAGING / SUNMI BUILD GUIDE ADDENDUM 21 SUNMI FLEX 3 / CLAUDE IMPLEMEN | NOISE — regression dashboard instruction (covered by CI suites) |

## Receipt Expense OCR Accounting (27)

| # | Recommendation | Status |
|---|---|---|
| 01 | Smart viewport calibration Record actual SUNMI CSS viewport and resize when browser chrome/keyboard/orientation changes. | EXISTS — the shell measures the live CSS viewport / visual viewport / keyboard on resize and orientation change (shell/displayProfile.ts → <html data-density>, --pos-vvh) |
| 02 | Receipt-to-expense trace view One tap shows original receipt -> OCR fields -> review -> approval -> ledger -> export. | EXISTS — receipt detail links receipt → review → expense, with pipeline state (rcsx-links, rcsx-pipeline, rcsx-expense-link) |
| 03 | Confidence-first review Show low-confidence fields first, keep high-confidence values available without redundant retyping. | TODO |
| 04 | Duplicate resolution workspace Compare two documents side by side and record staff decision with reason and audit trail. | TODO |
| 05 | Tenant vendor-rule preview Explain how a new vendor rule would classify future drafts; never silently alter approved history. | BUILT — POST /owner/finance/expense-rules/preview (ExpenseService.previewRule, read-only: this vendor’s last 180 days by category, approved/open using another category, rule it would replace; tenant-scoped) + VendorRuleDialog from the expense detail ("Rule for this vendor"): future-drafts-only statement, history never changes, then save via existing expense-rules route (tests: expense.pgtest "vendor-rule preview", POSExpensesScreen.test "vendor rule") |
| 06 | Bill due date calendar Upcoming due / overdue items with optional reminders and permission-controlled updates. | BUILT — GET /owner/finance/expenses/bills-due (expense.repository billsDue + ExpenseService.billsDue: open/partly-paid bills due within 1–90 days of salon today, overdue first, scoped, capped 200) + screens/expenses/BillsCalendar.tsx from the Bills tab (overdue / due today / by day, open totals, opens the bill detail where Record payment is permissioned); reminders = existing daily due-soon/overdue sweep (tests: expense.pgtest "bill due calendar", POSExpensesScreen.test "bill due calendar") |
| 07 | OCR outage resilience Status, safe retries and manual entry; preserve original upload before any OCR attempt. | EXISTS — manual entry path on the review screen when OCR is unavailable (rrx-manual) + health check (rrx-health) |
| 08 | Branch allocation checker Verify exact cents across branches and show branch-level reporting impact. | BUILT — screens/expenses/allocationCheck.ts + AllocationCheck in the expense detail: each branch share (amount, %), exact-cents verdict or the exact difference, and report impact (approved only; one branch; split counted per branch and once in salon total; salon-wide computed share) (tests: allocationCheck.test.ts, POSExpensesScreen.test "branch split adds up") |
| 09 | Accountant export preflight Check period, branch scope, duplicate expenses, missing categories and report reconciliations. | BUILT — GET /owner/finance/expenses/export/preflight (ExpenseService.exportPreflight: the export’s own rows — period, branch scope, filters — with duplicates, uncategorized, missing receipts, unapproved left out, reconciliation to the counted total; filtered/unapproved never claimed to reconcile) + ExportPreflightDialog before every CSV/Excel/PDF export (tests: expense.pgtest "accountant export preflight", POSExpensesScreen.test "after the accountant preflight") |
| 10 | Module and touch regression monitor Screenshot + control inventory; detect missing panels, clipped buttons and accidental removal. Do not turn recommendations into silent automation: AI may recommend; humans and existing | EXISTS — module registry gate + certified screenshot harness (missing panels, clipped buttons, removals fail CI) |
| 24 | Image Optimization Preserve original but generate optimized copies for: OCR thumbnail review screen Do not repeatedly process a 20 MB phone photo. | TODO |
| 25 | Image Quality Analysis Before OCR detect obvious problems: too dark too blurry receipt cut off extreme perspective Developer & Claude Completion Mandate / 10 AI PowerSalon / Receipt, Expense, Invoice, OCR & Accounting In | TODO |
| 29 | AI Platform Integration `ai_ocr_receipt` must use the central AI Platform / AI Gateway. It must not independently import random model-provider SDKs throughout the module. | NOISE — architecture rule (central AI Gateway) |
| 30 | OCR Provider Abstraction Conceptually: DocumentExtractionPort Capabilities: extractText() extractStructuredFields() getConfidence() detectDocumentType() | NOISE — architecture concept (provider port) |
| 40 | Category Recommendation Rules Use deterministic rules before AI when possible. Examples: Home Depot -> Repairs / Maintenance or Equipment depending line items Nail supply distributor -> Supplies Electric / Gas / Water -> | TODO |
| 43 | Never Change Approved Historical Category Silently If a new category rule is created tomorrow: old approved expenses remain unchanged. | NOISE — rule (approved history never re-categorised) |
| 44 | Vendor Entity Normalize vendors. Conceptually: Vendor { id tenantId? normalizedName displayName address? phone? website? defaultCategoryId? | NOISE — data-model concept |
| 74 | Receptionist Access Receptionist should normally not see all business expenses. Optional permission may allow: upload receipt without allowing: view payroll bills view owner expenses export accounting approve expenses | NOISE — role policy text (enforced by RBAC: expenses need finance permissions) |
| 75 | Technician Access Technicians normally should not see salon financial expenses. They may upload reimbursement receipts only if tenant enables it. | NOISE — role policy text |
| 76 | Owner Access Owner has tenant-wide expense management according to role/security policy. | NOISE — role policy text |
| 77 | Manager Access Manager access can be: branch only by default. | NOISE — role policy text |
| 78 | Super Admin Super Admin should normally see: feature health OCR processing failures storage health AI usage Developer & Claude Completion Mandate / 21 AI PowerSalon / Receipt, Expense, Invoice, OCR & Accounting Intellige | NOISE — role policy text |
| 83 | Low-Risk Auto Approval Future Option For trusted recurring vendors under a threshold: Developer & Claude Completion Mandate / 22 AI PowerSalon / Receipt, Expense, Invoice, OCR & Accounting Intelligence electric bill soft | NOISE — a future option, explicitly not now |
| 84 | Immutable Original Financial Evidence After expense approval: do not allow ordinary users to replace the original receipt image invisibly. A replacement must create: new document version or: additional supporting attachm | NOISE — rule (immutable approved evidence) |
| 85 | Delete Rules Draft uploads may be removable according to policy. Approved financial records should generally use: ARCHIVED VOIDED rather than hard deletion. 86. Search Allow search by: Vendor Amount Date | NOISE — rule (void/archive, not delete) |
| 97 | Tax / Accountant Export Owner should be able to export business expense records for: Accountant Bookkeeper Tax Preparation | EXISTS — Expenses export of matching records for the accountant (export-csv / export-xlsx / export-pdf) |
| 98 | Export Formats Support: CSV XLSX PDF summary where appropriate. Developer & Claude Completion Mandate / 25 AI PowerSalon / Receipt, Expense, Invoice, OCR & Accounting Intelligence PDF packages may include receipt images  | EXISTS — CSV, XLSX and PDF exports on Expenses |

## Customer Profiles (8)

| # | Recommendation | Status |
|---|---|---|
| 01 | Automatic Layout Health Measure actual overflowing elements and missing actions across all Customer Profiles views; guide corrective CSS changes, not browser zoom manipulation. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Data Freshness & Trust Show last verified activity/summary timestamp, stale-cache warning and “0 versus unavailable” distinction. | BUILT — POSCustomersScreen: FreshnessLine with the as-of time of the last good /pos/customers/state read (a failed refresh keeps it and says stale; success clears the error), and KPI values the server did not send show "—" instead of a false 0 (nv) (test: POSCustomersScreen.test "data freshness & trust") |
| 03 | Smart Card Details Compact status/visit summary with uniform heights; show more information in Quick View instead of making one card oversized. | TODO |
| 04 | Authorized Action Launcher Same safe Book, Message, History, Loyalty shortcuts on each card; use existing owning service APIs. | BUILT — POSCustomersScreen rows: Message (existing inbox start), Book (POS Booking with the customer preselected, only with pos.booking.create), Profile & activity (history), Loyalty (opens the profile on its Loyalty & Membership tab) — same shortcuts on every row through the owning screens/APIs (test: POSCustomersScreen.test "same safe shortcuts") |
| 05 | Balanced card sizing and layout rules Keep every card useful and similarly sized, regardless of how many customers are shown. Component Preferred SUNMI behavior Compact fallback Customer cards Four equal columns; uniform | NOISE — card sizing rule text |
| 06 | Notes Draft Protection Version checks, unsaved-work prompt, confirmed save and author/time audit on sensitive preference edits. | TODO |
| 07 | Customer 360 Consistency Single authoritative customer ID, shared data contract and stable state when switching Quick/Full View. | TODO |
| 08 | Staff-friendly Language Existing Front Desk EN/VN translations, touch-friendly action labels and visible focus states. Prioritize corrective changes by risk: P0 identity/tenant/loyalty integrity; P1 lost or clipped contr | NOISE — translation/touch instruction (EN/VI keys present) |

## Weekly Technician Paycheck (6)

| # | Recommendation | Status |
|---|---|---|
| 04 | Earnings Calculation & Already-Paid Handling The paycheck screen must read technician earnings from the existing authoritative payroll ledger, not recalculate commission independently. Supported earning components SERVIC | EXISTS — paychecks read the SAME payroll periods/lines; the server decides every figure; already-paid lines are not paid twice (POSPaycheckTab header, workforce payroll) |
| 06 | Payout Plans & Exact 50% Check / 50% Cash Splitting Separate what the technician is owed from how the technician will be paid. EARNINGS LEDGER ↓ PAY PERIOD ↓ PAY STATEMENT ↓ PAYOUT PLAN ↓ OWNER APPROVAL ↓ PAYOUT TRANSACT | EXISTS — salon 50/50 default split, manager changes per technician (percent or dollars) with a reason the owner sees (POSPaycheckTab) |
| 11 | Cash Payout & Technician Acknowledgment Cash payout is a first-class, fully recorded payout transaction. Conceptual CashPayout CashPayout { payoutId amountCents cashSource Developer / Claude Production Completion Mandate | EXISTS — cash payout is a recorded payout handed over with the technician PIN (POSPaycheckTab cash flow) |
| 12 | Cash Drawer Integration & Physical Cash Controls If payroll cash comes from a POS cash drawer, the withdrawal must create a non-sale cash movement linked to the payout. Cash Drawer ↓ PAYROLL_CASH_PAYOUT -$990 ↓ Expected  | EXISTS — cash from the register drawer writes a cash_drawer_movement (bound by apps/api; sources drawer/safe/bank/other), planned → ready → handed off → acknowledged (payroll-paycheck.service.ts) |
| 15 | Technician App - Payroll, Pay Statement & History Payroll home PAYROLL Current Pay Period Oct 12 - Oct 18 Estimated Earnings: $1,980 | EXISTS — Technician App pay statements panel (apps/tech-web TechPayStatementsPanel + test) |
| 17 | Events, Workers, Realtime & Notifications Potential events payroll.period.opened payroll.calculated payroll.manager_review_started payroll.submitted_to_owner payroll.returned payroll.approved payroll.locked pay_statement | EXISTS — payroll status writes are recorded as domain events with realtime to the Owner App (payroll.kysely.repository period_paid/finalized/reopened; owner.service ownerPayrollUpdated) |

## Features (1)

| # | Recommendation | Status |
|---|---|---|
| 20 | Real-time propagation, caching and compatibility • Feature states must refresh after a committed change to plan, tenant override or subscription event. Use existing WebSocket/SSE/event workers with 30–60-second bounded r | NOISE — propagation / caching guidance |

## Unfinished POS Modules Setup (12)

| # | Recommendation | Status |
|---|---|---|
| 01 | SUNMI Screen Fit Actual CSS viewport, overflow, card balance, touch target bounds, focus, modal clipping; capture screenshot. | EXISTS — Check this screen + certified harness |
| 02 | Retention Integrity Historical snapshots, segment definitions, counts, branch scope, consent and booking prefill. | TODO |
| 03 | Twilio Connectivity Stored config, provider-auth outcome, sender number assignment, masked security status. | EXISTS — Twilio connectivity in the messaging health check (messaging-health.ts runProviderChecks) |
| 04 | Carrier Readiness 10DLC/toll-free approval, service association, freshness and real provider evidence. | EXISTS — registration readiness sync (registration-sync.service.ts) |
| 05 | Booking Verify Effective tenant/global toggles, service credentials, resend, attempt limits and pending->confirmed path. | EXISTS — booking verification health check (booking-verification-center.ts verify_service/policy) |
| 06 | Team Integrity Duplicate employee, schedule conflicts, clock state, skills, training, missing assignments. | TODO |
| 07 | AI Entitlement & Billing Branch override vs shared quota, invoice math, provider event idempotency, stale links. | TODO |
| 08 | Nightly Jobs & Wiring Scheduler, queues, retry/alerts, tenant routing and module-to-module consistency. Operating rule. Health Checkers investigate and recommend; they must not change money, employee status, customer con | TODO |
| 09 | CI/staging release proof is still associated with the deployed version. Produce a health_check_runs record, individual health_check_results, severity, source, verification timestamp, actionable explanation, retry history | NOISE — release-proof instruction |
| 13 | Additional safeguard #1: Unified Setup Health Dashboard MANDATORY NEW CAPABILITY. Provide an authorized tenant-owner screen titled Setup Health under an existing appropriate navigation group (avoid duplicate sidebar entr | EXISTS — Setup Health (/tenant/management/setup-health): one authorized dashboard of setup checks by area and branch, with alerts |
| 14 | Additional safeguard #2: automated nightly verification and escalation MANDATORY NEW CAPABILITY. Use the existing job scheduler; run tenant-aware nightly maintenance with staggering, rate limits and retries. Verify both  | EXISTS — nightly Setup Health run with open alerts escalated once and acknowledged by a person (health_check_runs nightly, health_check_alerts escalated_at) |
| 15 | Additional safeguard #3: independently provable completion MANDATORY RELEASE GATE. A feature is not Completed and Verified because a button, schema, automated test file or screenshot exists. For every row in the acceptan | NOISE — release gate definition |

## Customer Segments (7)

| # | Recommendation | Status |
|---|---|---|
| 01 | Discovery Map routes, components, service APIs, segmentation rules, permissions, legacy data, and tests. | NOISE — process step (discovery) |
| 02 | Integrity Reconcile qualifying visits, last visit, lifetime spend, tier eligibility, missing/duplicate customer records. | EXISTS — POSSegmentsScreen Data health (HealthDialog): last visit recorded, unknown-branch visits, walk-in visits without a customer, shared-phone groups, snapshot coverage, VIP rule; Why This Segment? shows qualifying visits / last visit / spend from posSegmentsApi.qualification (tests: POSSegmentsScreen.test.tsx) |
| 03 | Foundation Implement tenant/branch-scoped segment query APIs, search, filters, date semantics, pagination. | EXISTS — posSegmentsApi segment queries (segments-v1): server search, branch activity, From/To with date basis, visits/spend/tier/service/SMS/e-mail filters, sort, 10/20/50 pages with exact count (POSSegmentsScreen toolbar + footer; tests: POSSegmentsScreen.test.tsx) |
| 04 | Workflow Customer overlay, Why This Segment?, snapshots, audience builder, Booking preselection. | EXISTS — POSSegmentsScreen overlays: Why This Segment? (WhyDialog), Customer History & Marketing, As of date snapshots (snapshotDay), Audience Builder (draft only, consent checked), Open Booking with the customer preselected (/booking/new?customerId=…&from=segments) |
| 05 | Integration Customer Retention, Marketing, Twilio/email consent and campaign eligibility. | EXISTS — SMS / e-mail eligibility filters and status per customer, Audience Builder consent check (draft only; Campaign Center approves/sends), marketing history with eligibility reasons in the customer overlay (POSSegmentsScreen) |
| 06 | Proof Type-check/build, test suite, staging screenshots, hardware checks, deployment/rollback and handoff. 05 / Canonical segment definitions Do not change business rules based on appearance alone. Read existing authorit | NOISE — proof/handoff instruction |
| 16 | ADDITIONS 16 recommendations: 1 through 8 Additive improvements only: verify existing equivalents first, then connect rather than duplicating modules. | NOISE — section heading |

## Notification Preferences (6)

| # | Recommendation | Status |
|---|---|---|
| 04 | NON-NEGOTIABLE REPOSITORY AUDIT BEFORE BUILDING Claude must find the actual route, component tree, service boundaries and stored policy before adding screens or APIs. Work from evidence, not from visible buttons alone. • | NOISE — repository-audit-before-building instruction |
| 08 | CLICKING MANAGE ALL: END-TO-END EDITING WORKFLOW The existing Manage All action must work. Reuse its current implementation and route if present; otherwise implement a scoped addition after discovery. The screen must not | EXISTS — AccountKit NotificationPrefs: the card's Manage All (acx-notif-manage) opens the full workspace dialog (acx-notif-dialog) on the same state and one save path (pos/me/notification-prefs, saved only when the server confirms) (tests: AccountKit.test.tsx) |
| 14 | NUMBERED HISTORY PAGES AND NEWEST EVENTS FIRST Pagination is for lists of notifications and audit records, not for the eight switches. Preserve all eight settings on the appropriate responsive grid. • In Notification Del | EXISTS — AccountKit: Recent Account Activity (canonical audit, newest first, numbered server pages) and DeliveryHistory (my alert deliveries: search, channel, status, From–To, numbered pages); the eight switches stay a grid, not paged (tests: AccountKit.test.tsx) |
| 17 | ALERT NOISE CONTROL, DEDUPLICATION AND QUIET HOURS These are additional recommendations. Claude should first verify which mechanisms already exist and enhance them rather than creating redundant schedulers. • Support ten | NOISE — recommendations preamble (verify-first note) |
| 18 | SECURITY, PRIVACY, TENANCY AND ROLE PERMISSIONS Existing tenant isolation and RBAC rules are authoritative. New search and diagnostics must never broaden who can view recipient data or notifications. • Every GET/list/upd | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 25 | DEFINITION OF DONE: REQUIRED EVIDENCE FROM CLAUDE Claude must not state “100% complete” without executed verification against the actual codebase. The final report should include: • Exact frontend/backend files, existing | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |

## Auto Logout 8 (4)

| # | Recommendation | Status |
|---|---|---|
| 24 | Failure states and truthful UI feedback Never use a blank card or a false success message when a security service is failing. • Settings load failure: show an actionable error and keep edits disabled until effective poli | NOISE — truthful-UI principle text |
| 25 | Settings changes, concurrency and safe propagation Changes must be versioned, auditable, and synchronized without granting access beyond platform limits. • After valid owner/admin Save, persist atomically and emit existi | NOISE — settings propagation principle text |
| 26 | Architecture and separation of responsibility No additional authentication database or payment-state store may be created just for this module. • Authentication/Identity: employee identity, credentials and login requirem | NOISE — architecture boundary text |
| 33 | Claude final handoff instructions Paste this mandate into Claude together with access to the actual AI PowerSalon source repository. The PDF is an implementation plan, not a code patch or certified audit. Scope lock • Ta | NOISE — Claude handoff instructions |

## AI Inventory Assistant (26)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-Click Inventory Health & Stock Accuracy Checker Investigate the screenshot showing 11 products and 11 Critical items; verify quantities, thresholds, inbound orders, consumption and receiving. | TODO |
| 02 | What the SUNMI screen actually means Dimension Required engineering interpretation Panel diagonal 27-inch physical screen size; it does not define the browser layout width. Panel resolution 1920 x 1080 hardware pixels, 1 | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 03 | Full-Screen Searchable Dashboard Keep the 6 metric cards and 4 buttons; add SKU/product/supplier search, monthly From/To calendars, newest-first activity pages and detailed overlays. Implementation specification / Verify | TODO |
| 04 | Complete 100% zoom full-screen dashboard; retain four buttons and six KPIs, vertical scrolling. | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 05 | Screen redesign, navigation and responsive behavior At 100% browser zoom on 24-inch and 27-inch POS displays, the fixed application shell remains visible; the content region uses available width. Let long data areas scro | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 06 | Screen and density matrix Test by actual content container width after the shell/sidebar, not nominal resolution alone. These rows are target behaviors, not assertions that a particular browser always reports the listed  | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 07 | Stock classifications, calculations and screenshot discrepancy First extract the actual classification rules from code. If the application intends mutually exclusive categories, propose and validate an explicit precedenc | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 08 | Four action views: functional, balanced, testable Command Center • Preserve summary and all six KPI values; include freshness, priority stock signals, pending approved stock events, active PO status and recommendations,  | EXISTS (part) — four views: Command Center, Low Stock, Reorder (cards with evidence), Slow-Moving; read-only analysis (POSAiInventoryScreen) |
| 09 | Stock classifications and the 11-Critical observation Photographed values are not production truths The existing screenshot shows 11 Products, 0 In Stock, 0 Low, 11 Critical, 0 Out of Stock, 0 Overstock. These values can | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 10 | Run automated, integration, UI and regression tests; document proofs and remaining blockers. Implementation specification / Verify against repository before coding 11 AI POWERSALON / AI INVENTORY ASSISTANT CLAUDE IMPLEME | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 11 | Search, calendars, history and overlays Full-width, readable filter toolbar Product/SKU/barcode/supplier search, category/status, branch scope, explicit date dimension and From/To month pickers. At wide viewport, use equ | TODO |
| 12 | One-click inventory and screen health checks Check AI Inventory System - preserve / complete Health domain Read-only evidence and status Catalog & units SKU uniqueness, active references, product/branch mapping, valid co | TODO |
| 13 | Backend, multi-tenant and iPhone isolation Existing architecture is authoritative • Keep Products & Inventory as canonical catalog and stock ledger. Purchasing/Receiving own PO and physical receipt events. Checkout/Servi | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 14 | QA matrix - must run at 100% zoom on the real target Test Pass conditions / evidence SUNMI primary viewport Actual device (or accurately matched emulator): 27-inch FHD landscape, 100% browser zoom, all 6 KPIs + all 4 act | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 15 | Slow-Moving, Overstock, expiry and waste analysis Slow-moving analysis should show last movement, units sold/used in selected lookback, days since movement, stock coverage, cost/value when authorized, demand horizon and  | EXISTS (part) — Slow-Moving tab (dead-stock findings with evidence); overstock / waste views not built |
| 16 | Copy-ready final mandate for Claude Read this complete PDF, including the appended original 13-page AI Inventory Assistant guide and the SUNMI FLEX 3 27-inch reference image. Work in the EXISTING AI PowerSalon repository | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 17 | One-Click Inventory Health & Stock Accuracy Checker Add Check AI Inventory System button. Run non-mutating diagnostics with per-check Passed / Warning / Failed / Unavailable, last checked, source freshness, concrete evid | TODO |
| 18 | Stock reconciliation and evidence trail A second action, Verify Inventory Accuracy, should compare physical count records with canonical ledger position and authorized receipts/sales/consumption/returns/transfers/adjustm | TODO |
| 20 | Multi-branch access and tenant isolation Support Current Branch, Selected Authorized Branches and All Authorized Branches only when server-side owner permissions permit. Provide branch-specific stock, reorder, forecast,  | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 21 | AI entitlements, subscriptions, privacy and localization • Inspect real AI inventory entitlement, plan, trial, metering and Super Admin overrides; do not invent prices or quota limits. • AI unavailability must not stop b | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 22 | Illustrative API and storage integration contract These endpoints/fields are conceptual checklists, NOT instructions to duplicate current services. Claude must find and extend existing endpoints and schema patterns, pres | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 23 | Real-time refresh and scaling Use existing WebSocket/SSE or safe fallback polling when stock events occur. Apply idempotent event processing, version checks and cache invalidation. Refresh counts on sales, configured ser | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 24 | Implementation sequence - exact priorities Order Work package / evidence | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 27 | Claude deliverables after implementation Return a concise implementation report identifying: audited existing modules; verified/defective/missing features; files touched; API and data model changes; migrations and rollba | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 28 | Authorization matrix - permitted vs prohibited actions User interaction Authorized result AI may do View stock / forecast Read authorized data; inspect source and freshness. Explain and suggest only. Review reorder Open  | NOISE — interpretation / QA / mandate / contract text, not a feature |
| 29 | Copy-ready execution mandate to use with this PDF Claude: Treat the photographed /tenant/ai/inventory page as the current UI baseline, not proof of correct backend behavior. First inspect real code and provide a feature- | NOISE — interpretation / QA / mandate / contract text, not a feature |

## Reception Copilot (8)

| # | Recommendation | Status |
|---|---|---|
| 01 | Receptionist Requests an Action | EXISTS — receptionist asks in the Copilot chat; the action is PREPARED, not executed (useCopilotAction prepare) |
| 02 | Screenshot inventory: preserve all visible modules Screenshot / position Exact feature set to preserve 1 · Top view Reception Copilot title and subtitle; Queue now (waiting/in service); AI Phone Receptionist recent activ | NOISE — screenshot inventory (modules preserved; registry gate) |
| 03 | Backend Checks Availability and Permissions | EXISTS — server preview checks availability + permissions before anything is offered (posCopilotCenterApi prepare/preview) |
| 04 | Staff Reviews and Confirms Action | EXISTS — PreparedCard: staff reviews the server preview and confirms |
| 05 | Real POS Backend Executes the Action | EXISTS — confirm runs through the real POS backend services (copilot center confirm) |
| 06 | Result Is Verified, Logged and Displayed Final instruction: Implement, integrate, test, verify and document Reception Copilot as a real safe operational assistant built on existing AI PowerSalon services. Do not duplicat | EXISTS — ActionOutcome shows the verified result; activity history logs it (CopilotWorkspace) |
| 11 | Upgrade C: Front Desk Priority Assistant with approval Build a priority workspace that reads verified operational signals, not generic model guesses. Candidate work: customers waiting, appointments starting soon, schedul | EXISTS — PriorityAssistant: verified task sources with reason/evidence; every proposal needs a person to confirm |
| 16 | Required Claude completion report Claude must return a precise report with: (1) repo audit and screenshots-to-components map; (2) baseline bugs/data sources; (3) architecture and endpoint reuse; (4) modules preserved; (5 | NOISE — completion report instruction |

## TECHNICIANS MANAGEMENT CENTER (20)

| # | Recommendation | Status |
|---|---|---|
| 01 | Screen Fit: viewport, top bar/sidebar, card clipping, overflow, dialogs, touch hit zones, English/Vietnamese labels and zoom target. | EXISTS — Check this screen + certified harness (Technicians in the harness, EN + VI) |
| 02 | Technician Record Integrity: missing IDs, duplicate account references, branch/role mismatch, stale app connection, orphaned records. | EXISTS (part) — Check Technicians System: archived-but-active, missing name, duplicate phone, split out of range, missing app account |
| 03 | Attendance & Shift: compare scheduled, clocked in, on break, serving and available states for the selected branch/date. | EXISTS — Team Attendance Today and Today's Shift Overview: Scheduled Today, On Shift Now and Available Now kept separate (POSTechniciansScreen) |
| 04 | KPI/Performance: verify all eight KPI queries, rating sample size and five-point display rules. | EXISTS — the eight KPIs each say what they count; Performance Overview with bands, Unrated and sample sizes; Top Performers rated only |
| 05 | Service Mapping: missing qualifications, expired certifications, invalid service/branch links and contradictory catalog rules. | EXISTS (part) — Missing Service Mapping filter + Service Mapping Assistant; Training & Certifications show stored expiry |
| 06 | Next Availability: exact-minute gaps, breaks, multi-tech, blocked intervals and conflict revalidation. | TODO |
| 07 | Booking/Queue/Technician App Sync: missing or delayed event propagation, stale role state and mismatched availability. | TODO |
| 08 | Commission & Tip Integrity: check historical rate snapshots, paid/earned labels and duplicate attribution without creating payments. | BUILT — shared read-only Check Technicians System (GET pos/system-checks/technicians, components/SystemCheck); pgtest 5/5 + PG16 run |
| 09 | Search & Pagination: server-wide scoped results, page bounds, stable order, date basis and no cross-tenant matches. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 10 | Permissions & Audit: test role gates, sensitive contact/earnings access, actor/event history and denied cross-tenant IDs. CHECKER OUTPUT CONTRACT Show PASS / WARN / FAIL / NOT TESTED, evidence source, checked time, affec | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 11 | PRIORITY 1 - Full Technician Profile Overlay | EXISTS — Full Technician Profile Overlay (priority flow 1) |
| 12 | PRIORITY 2 - Find Qualified & Available Technician | EXISTS — Find Qualified & Available Technician (priority flow 2) |
| 13 | PRIORITY 3 - Technician Service Mapping Assistant | EXISTS — Service Mapping Assistant (priority flow 3) |
| 14 | Team Productivity, Shifts, Birthdays and Certifications | EXISTS — Team Productivity Today, Today's Shift Overview, Upcoming Birthdays (honest "not recorded"), Training & Certifications |
| 15 | Create/edit technician and Technician App state | EXISTS — New Technician / Edit with commission authorization and lifecycle actions (existing edit flows kept) |
| 16 | Integration and event consistency | NOISE — integration guidance heading |
| 17 | Backend / data model and API contracts | NOISE — data-model / contract guidance heading |
| 18 | Security, privacy, audit and performance | NOISE — security / performance guidance heading |
| 19 | Implementation sequence for Claude | NOISE — implementation-sequence heading |
| 20 | Acceptance tests and handoff checklist | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |

## Split Payments (18)

| # | Recommendation | Status |
|---|---|---|
| 01 | Split Payment Accuracy Distinct ticket counts, tender sums, due balances, status alignment, failed/unknown exclusion, duplicate joins. Evidence-backed discrepancy list. | EXISTS — five KPIs computed server-side over the whole scope; a ticket counted once; declined attempts are never tenders (POSSplitPaymentsScreen) |
| 02 | Device / Payment Wiring Tenant MID/register routing, paired Clover Compact status, Fiserv test availability, feature flags, webhook processing health. Read-only status. | TODO |
| 03 | Screen Fit / Layout Actual CSS viewport, browser zoom guidance, clipped/overlapping controls, pager visibility, tap-target size, EN/VN overflow. | EXISTS — Check this screen (viewport, clipping, overlap, pager, touch) + certified harness |
| 04 | Tender / Refund Integrity Failed/timeout/duplicate attempts, refunds linked to original tenders, remaining refundable balance and audit records. | TODO |
| 05 | Cross-Module Reconciliation Compare Checkout, Split Payments, Gift Cards, Tips, Cash Drawer, Transactions and Daily Closeout using shared event references. No automatic money movement | TODO |
| 06 | Adaptive rows-per-page Compute a safe page size based on the measured table body height and row height. Preserve full-dataset server pagination and deterministic ordering. | EXISTS — rows per page computed from the measured table height (useFitRows); the full data stays server-paged |
| 07 | Payment-state timeline In ticket details show chronological tender attempts, confirmations, callbacks, reversals and outcomes with correlation IDs; mask sensitive references. | BUILT (part) — Transaction detail now has the per-payment timeline and already lists every tender attempt of the ticket with its state and time; processor callbacks are not shown |
| 08 | Uncertain Payment Review overlay Surface a compact “Status unknown - verify original attempt” view with safe retry criteria; prevent another charge by double tap. | TODO |
| 09 | Split Tender Preview Before initiating checkout, show intended card/cash/gift-card allocation and remaining due; preview is not a financial mutation. | BUILT — screens/checkout/splitPreview.ts + SplitPreviewBox in Checkout split payment: allocation by tender (card/cash/gift ×count), still due / over / exact, blank or invalid amounts counted, "preview only — nothing is charged"; no request is made (tests: splitPreview.test.ts, POSCheckoutScreen.test "split tender preview") |
| 10 | Filtered export consistency Export all authorized matching records across pages with the same filters, time basis and accounting definitions as the on-screen list. | EXISTS (part) — Export of the matching records with the current filters (export) |
| 11 | Register / terminal mismatch warning Warn when the selected processor merchant or paired terminal does not belong to the current tenant/register, without exposing other tenant details. | TODO |
| 12 | Financial discrepancy drill-down Let owners/managers inspect the source ticket and tender references when a split amount, refund or tip amount fails reconciliation. Implementation specification • Keep every existing modu | EXISTS — each ticket row opens its payment breakdown in place and a detail overlay with every tender attempt (toggle-breakdown, tenders-table) |
| 13 | Duplicate event detector Flag repeated callback IDs, repeated tender operation IDs and possible duplicated local posting. Diagnosis only; no automatic ledger erasure. | TODO |
| 14 | Pending payment banner A small accessible banner shows unresolved card outcomes and links to safe verification. Avoid counting unresolved charges as paid. | BUILT — banner when card attempts are still waiting for a result: counted per ticket on the server, said to be NOT counted as paid, with verify-before-recharge wording (split-payments-screen summary pendingAttemptTickets; pgtest; POSSplitPaymentsScreen.test) |
| 15 | Per-branch feature readiness Indicate which split methods are genuinely enabled per tenant/branch (Clover, Tap to Pay, gift card, cash). Disabled provider states must explain why. | TODO |
| 16 | Cash and card method clarity Separate financial method from capture device/channel in both summary and ticket detail. Multiple devices never increase tender count. | EXISTS (part) — method combination filter and the per-method breakdown (Cash · Card · Gift Card) separate from register (register filter) |
| 17 | Financial read-only mode during outage If critical provider/backend services fail, allow permitted inquiry with accurate stale-data labeling, but disable unsafe financial mutations. | TODO |
| 18 | Automated screenshots and module-preservation registry Baseline the existing module tree and route actions before changes; fail CI on missing controls, visual overflow and broken primary links. Implementation ordering Fi | EXISTS — module registry + preservation matrix + certified screenshots |

## Technician Profile Team Management (1)

| # | Recommendation | Status |
|---|---|---|
| 08 | KPI cards / profile All eight present, equal geometry on SUNMI wide view; values verified; status from correct source. Full vs drawer Shared IDs, six original drawer tabs, no duplicate role, matching branch and independe | NOISE — acceptance text for the profile KPI cards |

## PAYMENTS  MONEY (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-Click Financial Accuracy Reconcile all eight KPIs and six secondary totals against authoritative Checker full-period data. | TODO |
| 02 | Screen Fit & Module Checker Detect missing modules, clipped panels, horizontal scroll, unreachable buttons and font overflow. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | Payment Provider Readiness Surface Fiserv provider connectivity, terminal readiness and unverified Checker certification/onboarding status accurately. | TODO |
| 04 | Cash-to-Settlement Trace Checker Trace cash, card and gift card transactions to correct respective ledgers without double counting. | TODO |
| 05 | Revenue vs Collections Explainer Show staff the documented difference between earned revenue and successfully collected tenders. | TODO |
| 06 | Refund & Void Integrity Checker Check amount eligibility, provider result, duplicate attempts and correct refund impact. | BUILT — shared read-only Check Payments System (GET pos/system-checks/payments, components/SystemCheck); pgtest 5/5 + PG16 run |
| 07 | Payout & Deposit Checker Explain expected provider payouts separately from sent payments and bank-confirmed deposits. | TODO |
| 08 | Cross-Module Wiring Checker Check broken links between Checkout, Transactions, Tips, Gift Cards, Cash Drawer and Reconciliation. AI authority rule A health checker is diagnostic and advisory. It must not move money, over | BUILT — shared read-only Check Payments System (GET pos/system-checks/payments, components/SystemCheck); pgtest 5/5 + PG16 run |
| 09 | Financial Exception Inbox Consolidate unresolved statuses and mismatch explanations with drill-down evidence. | TODO |
| 10 | Data Freshness Indicator Show last successful refresh and provider sync status per panel; never claim real-time when stale. | BUILT — last successful refresh on Payments overview; never claims live (payments-fresh) (shared FinanceKit useFreshAt/FreshnessLine; components/FreshnessLine.test.tsx) |
| 11 | Transaction State Timeline Display authorize/capture/settle/refund events from real provider references. | BUILT — Transaction detail → Payment timeline (server: recorded payment / refund / settlement / deposit times only; pgtest 14/14) — PaymentTimeline |
| 12 | Better Payout Forecast Cards Show expected payout dates, processor names and confidence/source based on available records. | TODO |
| 13 | Adaptive Table Density Compute readable page size from available table height instead of shrinking text. | EXISTS — page size computed from the available table height (useFitRows), text never shrunk (POSPaymentsOverviewScreen) |
| 14 | Risk-Aware Quick Action Preview Show actor, tenant, amount, recipient/provider and effects before protected financial actions. | TODO |
| 15 | Layout Regression Gate Run screenshot and DOM structure checks before release for all device breakpoints and both POS languages. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 16 | Module Preservation Registry Track each legacy card, chart, action and route mapping with pre/post-test results; fail deployment if anything vanishes. Implementation policy: Add optional recommendations only after inspec | EXISTS — module registry + preservation matrix |

## AI Plans Packages (9)

| # | Recommendation | Status |
|---|---|---|
| 01 | Screen Fit Health Checker Read-only developer/admin diagnostic: CSS viewport, content width, zoom/device scale readout, overflow hotspots, clipped CTA checks, tap-target under-size flags and accessibility warnings. No se | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Balanced Package Card Engine One reusable style for card price, badge, assistant list, footer and focus state. Equal widths; no card dwarfs another. Five cards remain and descriptions can expand accessibly. | NOISE — card style instruction |
| 03 | Price Truth & Real Savings Verifier Compare current server published price against sums of effective standalone prices; flag false savings claims, stale caching and missing pricing versions for correction. | TODO |
| 04 | Purchase Overlap & Duplicate Before checkout, show existing standalone/bundle/trial coverage, confirmed quote, credits and Charge Guard effect; reuse authoritative anti-duplicate billing service. | TODO |
| 05 | Subscription vs Readiness Split Separate commercial trial/active/past-due/cancelled states from technical Ready/Setup Required/Provider Down so users understand access versus setup. | TODO |
| 06 | Responsive Action Density When width falls, collapse secondary descriptions into accessible Details, not primary CTAs. Prioritize readable price, status and Manage/Buy/Cancel visibility. | NOISE — responsive density instruction |
| 07 | Billing Data Freshness Indicator Show last invoice/subscription sync and real provider-pending states. No false Paid/Active badge based on a browser request response. | TODO |
| 08 | Accessibility + Vietnamese Text Long translated labels, 44px touch targets, keyboard/reader focus, contrast and dialog Audit scrolling. Tenant Front Desk only gets EN/VN; other apps retain their current language scope. I | NOISE — accessibility/translation instruction |
| 22 | State machine and failure handling Event Expected behavior Product viewed No charge, no entitlement change. Purchase submitted Persist idempotent intent; show pending until verified. | NOISE — state-machine table heading |

## Review Reputation Settings (4)

| # | Recommendation | Status |
|---|---|---|
| 02 | Effective Policy Preview & Explain Why Provide a concise read-only side panel: configured value, effective value, source, lock reason, AI entitlement, last applied worker revision, and exact blocked reason. The Settings  | TODO |
| 03 | Safe Dry-Run Eligibility Preview Let authorized managers inspect the current policy impact using existing counters or staging fixtures: potential recipients, suppressed by consent, quiet-hours exclusions, disconnected ch | TODO |
| 04 | Pending Changes & Conflict Guard Show unsaved changes, affected automation categories, last updater and active configuration version. When approval-required and auto-response conflict, explain the exact policy; reject in | TODO |
| 05 | Integration Freshness & Risk Alerts Show real last successful provider sync, Twilio status, pending publish queue, delayed request queue, billing entitlement and role-based security failures. Provide “Open Integrations”, | TODO |

## AI MONEY PROTECTION 5 (19)

| # | Recommendation | Status |
|---|---|---|
| 01 | Monitoring Trust Banner At top of overview show “Monitoring Active / Stale / Disabled / Partial / Error” with last successful run and source coverage. | EXISTS — overview says whether monitoring is CURRENT / stale / never ran (never "no alerts" when detection never ran) (MoneyProtectionWorkspace MpOverview) |
| 02 | One-Click Health Summary Single button with dependency matrix, last validated source and safe resolution path; read-only. | EXISTS — Check AI Money Protection System in the shared header (read-only) |
| 03 | Evidence Completeness Meter Per alert/case show which source links were verified, missing, stale or permission-limited. | TODO |
| 04 | Deduplicated Exposure Drill-down Explain Value Under Review calculations, overlapping alerts and why sums differ from alert count. | TODO |
| 05 | Funding Calendar Awareness Mark “Expected / Not yet due / Overdue / Unmatched” based on processor and bank timing. | TODO |
| 06 | Reviewer Workload View Summarize pending, high-priority, assigned/unassigned and aging cases, without merging Investigations. | BUILT — same as the duplicate section below: Investigations workload strip (money-protection-center investigations().workload; tests) |
| 07 | Safe Rule Preview Before a manager saves rule edits, show read-only estimated historical matches on approved test data; never silently activate. | TODO |
| 08 | Source Reconciliation Links One click from alert to same ticket, refund, batch or reconciliation in the existing owning module. Priority labels Priority A: 01-05 because they prevent misleading risk/health messages. Prio | EXISTS — an alert opens with the invoice / payments / staff it points at, linked to their own pages, and its history |
| 09 | Workspace Layout Profiles Use responsive layout presets for 1920 × 1080 SUNMI, other desktops and short viewports; reflow with CSS, not OS/browser zoom hacks. | EXISTS — certified 1920×945/952/1032 layouts reflow with CSS; screen check on every page |
| 10 | Smart Filter Presets Saved local UI preferences for “Critical”, “Awaiting Review”, “My Cases”, “Last | BUILT — POS saved views (migration 844, pos/me/saved-views, components/SavedViews); pgtest 6/6, component 4/4 |
| 11 | Documented Alert Rate Limits Throttle duplicate notifications while preserving distinct evidence and an auditable incident timeline. | TODO |
| 12 | Failure-aware Snapshot Allow authorized read-only as-of view labeled stale when providers are offline, rather than misleading zeros. | TODO |
| 13 | Long-list Virtualization For heavy histories use stable server pagination and optional row virtualization without losing focus/navigation. | EXISTS (part) — alerts / investigations use stable server paging, newest first (no virtualization needed at page size) |
| 14 | Better Empty States Explain verified no alerts vs no transaction data vs paused monitor vs filtered no matches vs access restriction. | TODO |
| 15 | Export Provenance Export author, time, tenant scope, metric definitions, source freshness and redaction scope on approved files. | TODO |
| 16 | Accessibility & Language QA Touch targets, keyboard focus, real screen reader labels and EN/VN layouts; no truncation in translated labels. DO NOT AUTO-ENABLE Ship new dashboards, diagnostic controls or presets behind ex | EXISTS — EN/VI behind t(), coded texts translated (mpTextCoded); Vietnamese harness certified |
| 18 | Notifications, escalation and multi-salon owner views Notification delivery • Reuse existing tenant notification center and authorized email/SMS connectors where configured; respect roles, quiet hours, cooldown and escal | NOISE — notifications/escalation requirement narrative |
| 19 | Subscription, bilingual POS and accessibility • Use actual AI PowerSalon billing entitlements and usage counters; do not invent prices. Keep basic payment processing functioning during AI service expiration. • For tenant | NOISE — subscription/bilingual/accessibility narrative |
| 20 | Suggested contracts and ownership (verify before implementation) Do not create these endpoints or tables blindly. The following are required behaviors to map onto the real repository. Reuse or extend existing services ra | NOISE — suggested contracts ("do not create blindly") |

## CASH DRAWER (1)

| # | Recommendation | Status |
|---|---|---|
| 11 | Universal search - best way to find Cash Drawer records Single universal input: Search customer, phone, ticket, transaction, employee, or cash reference... Search across all authorized matching records, not just the curr | EXISTS — one universal search over movement / reference / customer or employee / ticket / session, with date range, status and server pages (POSCashDrawerScreen) |

## PRODUCTION-READY POS 5 (8)

| # | Recommendation | Status |
|---|---|---|
| 01 | Rebuild the machine. 2. Rotate credentials. 3. Revoke old/exposed Firebase key. 4. Create new Play upload keys. | TODO |
| 02 | Fix critical backend issues first: security containment, merchant configuration, durable financial recovery, split-payment guard and exact-service eligibility. | TODO |
| 03 | Complete OCR infrastructure, Twilio ledger, optional expense allocation, 200-tech pilot, Customer Display privacy assertion and lint/type-quality cleanup. | TODO |
| 04 | Implement the shared SUNMI responsive shell, improve page-specific layouts and validate all modules at 100% zoom. | TODO |
| 05 | Change PostgreSQL credentials. 6. Close public PostgreSQL port 5432. 7. Validate new environment. 8. Only then push rewritten Git history. No exposed password, JWT, Firebase, Google, Twilio, Fiserv/CardPointe, CommerceHu | TODO |
| 06 | Close public PostgreSQL port 5432 | TODO |
| 07 | Validate new environment | TODO |
| 08 | Only then push rewritten Git history Claude / Developer Production Completion Mandate / 2 AI PowerSalon / Remaining Production Work & Final Completion Mandate | TODO |

## AI Deposit Reconciliation (2)

| # | Recommendation | Status |
|---|---|---|
| 00 | Automatic Viewport Fit Checker — detects clipped controls, excessive whitespace, unreadable KPIs and missing tab actions. 1 | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 01 | Exception Review Queue — severity, assigned reviewer, due date, audit and reopen flow. | TODO |

## AI Receptionist Settings (10)

| # | Recommendation | Status |
|---|---|---|
| 01 | Map source-code components, routes, data stores and existing integration behavior; record pre-change baseline. | NOISE — process step (baseline mapping) |
| 02 | Trace every screenshot field from the frontend through backend validation and persistence to the effective voice configuration. | NOISE — process step (trace fields) |
| 03 | Repair existing Save/enable/recording/provider-sync behavior without duplicating database concepts. | NOISE — process step (repair existing save path) |
| 04 | Redesign the Settings page for the ASUS touchscreen and preserve all original navigation. | NOISE — process step (redesign; nav preserved by registry gate) |
| 05 | Add effective status, health diagnostics, error remedies and versioned settings history. | EXISTS — receptionist health check + versioned control history with reason (rcp-health, rcp-ctl-history, expectedVersion) |
| 06 | Implement settings/history search, full month From/To calendar, stable server pagination, detail overlays and restore controls. | TODO |
| 07 | Connect optional AI configuration recommendations to a human approval workflow. | TODO |
| 08 | Write and execute UI, integration, concurrency, recording, security and multi-tenant tests. | NOISE — test instruction |
| 09 | Verify staging and approved provider test accounts; do not perform billable call tests without authorization. | NOISE — staging/provider verification instruction |
| 10 | Prepare rollout controls, feature flags, observability, deployment and rollback instructions; isolate account-level blockers. Claude must return these artifacts and proof • Files changed, design summary, relevant API/dat | NOISE — rollout instruction |

## Global  Tenant Earning Rules (4)

| # | Recommendation | Status |
|---|---|---|
| 01 | Display Use Global Rules / Custom Rules conspicuously on the tenant Loyalty & Rewards dashboard, showing the actual effective rule and its source, so a salon owner always knows what rate is in effect. | TODO |
| 02 | When Super Admin updates the global earning rate, only tenants inheriting the global rate up- date automatically (at the specified effective time). Tenants with active custom earning rates do not change, except where man | TODO |
| 03 | Roll out under a controlled, default-off tenant custom earning feature flag. Never automatically convert existing tenant-only points, gift cards, or customer wallet balances to funded global rewards. | TODO |
| 04 | Funding is not settlement: A token purchase authorization/approval does not necessarily mean cleared bank funds. A reimbursement PAYABLE does not mean PAID. Display and reconcile each separately. Implementation posture:  | TODO |

## SERVICE PRICING (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Service Pricing Accuracy Health Checker Compare the four KPIs against canonical eligible service rows; explain discrepancies, currency rounding and archived/custom-price exclusions. | BUILT — shared read-only Check Catalog System (GET pos/system-checks/catalog, components/SystemCheck); pgtest 5/5 + PG16 run |
| 02 | Automatic SUNMI Screen Fit Health Checker In development/admin test mode, detect clipped cards, horizontal overflow, inaccessible actions, off-screen popovers, and effective viewport size. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | Price History and Audit Integrity Checker Find missing actor/reason/effective date, overlapping price versions, invalid rollback history and mismatched current versus scheduled prices. | BUILT — shared read-only Check Catalog System (GET pos/system-checks/catalog, components/SystemCheck); pgtest 5/5 + PG16 run |
| 04 | Booking Price & Duration Impact Checker Before future price/duration edits, detect booked appointments, fixed quotes, technician availability conflicts and stale service pickers. | EXISTS (part) — pricing impact preview before saving (services/:id/pricing-impact) |
| 05 | Checkout and Transaction Wiring Checker Reconcile service line snapshots with checkout totals, taxes, discounts, authorized overrides, refunds and payment status. | TODO |
| 06 | Category & Service Relationship Checker Flag possible anomalies such as Haircut or Hair Coloring categorized as Nails; never auto-mutate owner data. | EXISTS (part) — category anomalies flagged for review on Service Categories (service_category_mismatch) |
| 07 | Permission & Tenant Isolation Checker Validate service prices, edits, history exports and customer lookups are scoped server-side to the correct tenant and branches. New SUNMI Addendum • Attached original follows unchang | NOISE — isolation checker instruction |
| 08 | Live Price Preview Show how a service price would appear in Booking/Checkout including applicable add-ons, discounts and taxes, without charging anyone. | TODO |
| 09 | Service Price Difference Explanation Show why a final checkout line differs from the catalog base price: branch override, add-on, approved manual override, promotion or membership. | EXISTS (part) — Customer History shows what was actually charged (ticket snapshots) beside the catalog price |
| 10 | Effective-Date Change Timeline Display current, pending and previous service prices in one readable drawer and forbid overlapping incompatible scheduled prices. | EXISTS (part) — Price History tab (append-only, reason + version per change) exists; scheduled future prices are not built |
| 11 | Duplicate Service / Name Review Warn about near-identical names or codes before creating a service; never auto-merge distinct records. | BUILT — new or renamed service warns (never blocks/merges) on a look-alike name: same words, accents/case, 1–2 letter typos (serviceNameDup.ts + service-lookalike in ServiceDialog; tests) |
| 12 | Technician Compensation Preview Explain potential commission basis changes where configured and audit the source of actual payout values. | TODO |
| 13 | Owner Review for Suspicious Categories Offer a non-destructive review queue for category anomalies with original IDs and owner approval workflow. | TODO |
| 14 | Readable EN/VN Mode Test translated long labels/diacritics at SUNMI size without truncating KPI meanings, button actions or validation messages. | EXISTS — EN/VI; harness certified |
| 15 | Data Freshness & Conflict Notice Explain when a price was last updated and warn if another manager saved a newer version before submitting. | EXISTS — Edit Pricing carries the version the editor opened; a newer save is refused (conflict notice) |
| 16 | Pricing Export Verification Give an authorized full-scope export with the date/time of the price snapshot; protect tenant/customer PII. New SUNMI Addendum • Attached original follows unchanged Addendum 16 AI POWERSALON / | TODO |

## Customer Displays (1)

| # | Recommendation | Status |
|---|---|---|
| 31 | Copy-ready final instruction for Claude Claude, modify my existing AI PowerSalon codebase - do not rebuild the application. Read this entire PDF and inspect the three provided reference images. The route is /tenant/devic | NOISE — copy-ready instruction text |

## AI BUSINESS SETUP (15)

| # | Recommendation | Status |
|---|---|---|
| 01 | Explain Zero Counts Each readiness tile opens a reasons drawer: raw/eligible count, exclusion list, branch, source and refresh timestamp. | EXISTS — readiness rows show raw vs eligible counts, the exclusions and the source (same rules the AI receptionist uses) (POSAIBusinessSetupScreen) |
| 02 | Guided Setup Checklist One-click deep links to existing Hours, Service Catalog, Team and Staff Schedule editors, with return navigation. | EXISTS — readiness checklist rows deep-link to Hours, Services, Team and Schedule editors with Retry (ReadinessRow onGo in POSAIBusinessSetupScreen) |
| 03 | Branch Scope Inspector A compact label showing selected tenant and branch; surface mismatch in a read-only diagnostic. | TODO |
| 04 | Source Freshness Marker Last checked, updated, sync-lag and unknown state, never a false green ready flag. | EXISTS (part) — a count that could not be read shows Unknown + Retry, never 0 |
| 05 | Balanced Dense/Comfortable View Optional operator preference affects spacing, not content; default remains touch-friendly. | BUILT — opt-in Compact spacing per device; spacing only, default unchanged (shell/spacingPref.ts) |
| 06 | FAQ Duplicate Warning Warn about similar questions before saving, but permit authorized overrides and | BUILT — new FAQ shows existing questions that ask the same thing (warn only, Add stays enabled; opens the existing FAQ) (faqDup.ts + ais-faq-dup; tests) |
| 07 | Approval Difference View Side-by-side draft vs currently approved answer before manager publishes. | EXISTS (part) — editing an approved FAQ is a pending change that never replaces the live text until approved |
| 08 | Safe Knowledge Test Pack Run preapproved sample questions against read-only source snapshots; never contact real customers. | EXISTS — Preview AI Knowledge / FAQ preview run read-only; never books, holds, texts or calls |
| 09 | Long-List Usability Sticky list columns/actions and clear pagination, with no entire-page horizontal scrolling. | TODO |
| 10 | Empty/Error Separation Show true empty, filtered no-match, unauthorized, stale and API failure as different states. | TODO |
| 11 | Readiness Change History Audit recent status transitions with source version, actor, time and reason. | TODO |
| 12 | Visual Regression Gate Automated screenshots across SUNMI target, old ASUS and common desktop CSS widths. SUNMI FLEX 3 27-INCH / BUSINESS SETUP / ORIGINAL 16 PAGES PRESERVED ADDENDUM 13 AI POWERSALON / CLAUDE ENGINEERING | EXISTS — harness screenshots EN + VI |
| 13 | Integration boundaries and security AI Receptionist, AI Front Desk and Booking Business Setup is the knowledge and readiness interface. AI Front Desk uses approved knowledge; Retell is a voice provider, Twilio routes cal | NOISE — integration boundary text |
| 17 | Final acceptance and deliverables required from Claude Non-negotiable feature checklist • Original screenshot modules preserved; top bar and sidebar unchanged; clear full-width 27-inch design. • Business Hours, Services  | NOISE — acceptance checklist |
| 19 | Final copy/paste mandate for Claude CLAUDE - IMPLEMENT, DO NOT JUST RESTYLE Using the embedded original AI PowerSalon screenshot and the existing repository, inspect `/tenant/ai/receptionist/business-setup`; preserve all | NOISE — copy/paste mandate |

## CheckOut (12)

| # | Recommendation | Status |
|---|---|---|
| 01 | Automatic Fit Health Checker Small nonfinancial technical action in Settings / device diagnostics: show browser CSS viewport, content viewport, density mode, detected outer overflow, clipped panels, font/touch audit. Man | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx: viewport, fit, display) |
| 02 | Certified SUNMI Device Profile Create optional hardware profile configuration (SUNMI_FLEX3_27_FHD) for layout defaults, viewport checks, connection status and managed kiosk instructions. Avoid hardware-user-agent lock-in | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | Checkout Module Registry + Define stable module IDs to detect accidental deletion, hidden entry points or dropped Preservation Tests permission/handler wiring when Claude refactors Checkout. Maintain before/after capabil | EXISTS — stable data-module-id entries checked by tooling/ci/check-pos-module-registry.mjs (e.g. checkout-three-ways) |
| 04 | Automatic 100% viewport-fit contract On startup, resize and orientation changes • Detect available CSS viewport width and height using window.innerWidth/innerHeight, window.visualViewport where supported, documentElement | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 05 | Balanced one-screen layout blueprint Layout priority: Reserve stable space for the POS shell and critical controls; use an adaptable central grid for operational work. The workspace is slightly wider than Queue and AI, b | NOISE — layout blueprint text |
| 06 | Readability + Touch QA Add tests for long EN/VN labels, 200 staff, 100 queue records, 20-line ticket, keyboard, spinner, OS scaling, rotated display and target collisions. | NOISE — test instruction |
| 07 | Role-Safe Quick Action Explanations A disabled button indicates the missing ticket, permission, unresolved payment, not-configured merchant or stale total; never mask the control or silently approve the operation. These  | TODO |
| 08 | Viewport auto-fit engine and UI state stability A viewport-aware hook/observer should update display configuration only when the actual app container size changes. Use the existing React patterns and resize utilities if  | NOISE — implementation guidance (FitKit/useFitRows already used) |
| 09 | Touch-first Checkout friendliness • Use an uncluttered information hierarchy: selected guest -> services -> balance due -> selected payment -> status -> receipt/next action. • Touch targets: aim >=44 x 44 CSS px for prim | NOISE — UX guidance |
| 11 | Non-negotiable payment, checkout and data protections The original 18-page mandate (Appendix A) is binding in full. These protections are repeated here because layout work must not regress them. • Canonical flow: Serving | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 12 | Recommended additive improvements - keep existing modules Recommendation Implementation requirement and benefit | NOISE — section heading |
| 13 | Automated test plan and screen acceptance gate At least the following tests must execute against a real or faithfully reproduced POS app shell. Use Playwright or the repository's existing E2E framework and add structured | NOISE — test plan text |

## Tablets (13)

| # | Recommendation | Status |
|---|---|---|
| 01 | Guided Enrollment Wizard One safe flow for device type, branch/station, QR/one-time code, app confirmation and owner approval. | EXISTS — pair a device with its 6-digit one-time code, station + branch (POSDevicesScreen pairing form) |
| 02 | Connection & Battery Health Expose last authenticated heartbeat, battery where available, OS/app version and stale-device warnings. | TODO |
| 03 | One-Click Tablets Health Checker Read-only diagnostic across registry, pairing, sessions, health events, permissions and integrations. | EXISTS — Check Tablets System (read-only) in the fleet header (POSDeviceFleetScreen) |
| 04 | Assignment Conflict Preview Warn before two devices claim one restricted station/role; show impact before commit. | TODO |
| 05 | Remote Logout / Revoke Owner-controlled sign-out and credential invalidation with clear confirmation and audit. | EXISTS — owner Revoke access with confirmation; revoked devices listed as revoked (POSDevicesScreen revokeDevice) |
| 06 | Secure Replacement Flow Decommission lost/replaced devices safely and enroll a new device without copying secrets. | TODO |
| 07 | Customer Privacy Reset Automatic kiosk/customer-display reset of previous customer data after use or inactivity. | EXISTS — customer display clears the previous customer 3 seconds after use (pilot phase 4 DISPLAY 3-SECOND PRIVACY CLEAR) |
| 08 | App and OS Lifecycle Show outdated/unsupported versions clearly; require explicit policy before mandatory upgrades. | TODO |
| 09 | Tablet Activity Timeline History of enrollment, session, assignment, updates, failures and recovery with search, calendars and paging. | EXISTS (part) — a device's details with its own history + the History tab (newest first, calendar, pages) |
| 10 | Branch/Station Fleet View One scoped list for multi-branch owners, with clear current branch and station ownership. | EXISTS (part) — one scoped list with Branch and Station columns and filters |
| 11 | Safe Export & Evidence Bundle Authorized redacted CSV/PDF device inventory and health report; never export keys or customer PII. | TODO |
| 12 | Payment Capability Gate Keep generic tablets distinct from Fiserv terminals and native iPhone Tap to Pay; show supported features from verified backend capability. Claude implementation specification / 09 Nov 2026 26 AI  | NOISE — rule (tablets stay distinct from Fiserv terminals and Tap to Pay) — holds: tablets never take payments |
| 25 | Twelve additional recommendations | NOISE — heading |

## Reception Copilot (12)

| # | Recommendation | Status |
|---|---|---|
| 01 | Screenshot evidence and inventory | NOISE — a section heading of the guide (no feature text) |
| 02 | Visual and interaction design | NOISE — a section heading of the guide (no feature text) |
| 03 | Advanced search, date calendars and pagination | NOISE — a section heading of the guide (no feature text) |
| 04 | Customer, caller, phone AI and duplicate review | NOISE — a section heading of the guide (no feature text) |
| 05 | Queue, services, availability and conflict checking | NOISE — a section heading of the guide (no feature text) |
| 06 | Booking, rescheduling and cancellation safety | NOISE — a section heading of the guide (no feature text) |
| 07 | SMS messaging and communications | NOISE — a section heading of the guide (no feature text) |
| 08 | Copilot chat, settings and AI entitlements | NOISE — a section heading of the guide (no feature text) |
| 09 | Three priority recommendations | NOISE — a section heading of the guide (no feature text) |
| 10 | Backend contracts, data and event flow | NOISE — a section heading of the guide (no feature text) |
| 11 | Tenant security, observability and rollout | NOISE — a section heading of the guide (no feature text) |
| 12 | Acceptance tests and delivery evidence AI POWERSALON / RECEPTION COPILOT / CLAUDE BUILD SPEC 2 Screenshot 1 of 3 — Front desk overview Original user-provided photograph (unaltered): | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |

## Fiserv Payment Gateway (7)

| # | Recommendation | Status |
|---|---|---|
| 01 | Find the exact route /tenant/integrations/payment-gateway and inspect its component tree, stylesheet, layout shell, locale strings, data hooks and current test coverage. | NOISE — process step (inspect route) |
| 02 | Trace the tenant/branch selector, Gateway UI status, credential display, onboarding status and merchant mapping back to actual backend endpoints and database entities. | NOISE — process step (trace selectors) |
| 03 | Inspect existing Fiserv Gateway, CardPointe, Bolt and/or Clover REST Pay Display adapters and identify which have REAL SDK/provider wiring versus mocks. | NOISE — process step (inspect adapters) |
| 04 | Identify the canonical Checkout/Payment Domain, payment intent/state machine, terminal registry, merchant onboarding, receipt, refund, idempotency, webhook and reconciliation code. | NOISE — process step (identify domain) |
| 05 | Inspect Fiserv provider credentials and routing as references only: NEVER print them or place them in a PDF, log, diff, test screenshot, browser bundle or development report. | NOISE — process step; standing rule: credentials never printed |
| 06 | Inventory subscription-related billing separately from salon customer card processing. Subscription invoice payment services are not automatically the Fiserv checkout service. | NOISE — process step (inventory billing separately) |
| 07 | Produce a preservation matrix: Existing and working / Existing but broken / Partial or mocked / Not built / Externally blocked. For each module cite actual file and function names. Mandatory inventory format MODULE SOURC | NOISE — deliverable instruction (preservation matrix exists: docs/handoff/SUNMI_PRESERVATION_MATRIX.md) |

## Voice Transcription Settings (4)

| # | Recommendation | Status |
|---|---|---|
| 01 | SOURCE SCREENSHOT AND OBSERVED SETTINGS The following enlarged excerpt is taken directly from the supplied screenshot. It is evidence of the current frontend presentation, not proof of backend functionality. Existing con | TODO |
| 02 | Complete Privacy, Retention and Consent Protection Keep sensitive-data redaction permanently ON. Verify the current 365-day configured retention policy, actual provider-side deletion, legal holds, raw transcript restrict | TODO |
| 03 | Full-Screen Settings, Search, Calendars and Pagination Use the blank space for organized settings, provider diagnostics, and auditable change history. Add From/To monthly calendars and pages 1, 2, 3 and beyond, with newe | TODO |
| 32 | Implementation phases - order of work Phase Required work and exit criteria 1 / Audit Map source files, routes, APIs, records, workers, ownership, subscription, tests; classify actual status. 2 / Privacy first Prove mand | TODO |

## AI Business Reports (11)

| # | Recommendation | Status |
|---|---|---|
| 01 | Keep the original: AI Business Reports route, four report-generation buttons, historical records, Report / Generated / Status columns, left sidebar and POS shell. | EXISTS — route, report-type generate buttons and report history kept (bzx-gen-types, bzx-r-history) |
| 02 | Repair UX: 24-inch/27-inch POS at 100% zoom, readable touch controls, no clipped content, vertical scroll only when needed, and improved use of blank space. | NOISE — UX instruction |
| 03 | Make reports findable: contextual authorized search, monthly From/To calendars, server pagination, and newest-generated-first history on page 1. | EXISTS — search, From/To period bar, server pages, newest-first sort (bzx-r-search, BzPeriodBar, Pager, bzx-r-sort) |
| 04 | Fix report lifecycle: queued/processing/completed/failed must be distinct from expired temporary links, missing artifacts and retention expiry. | EXISTS — processing / failed / expired / viewable counted and shown separately (bzx-r-processing, bzx-r-failed, bzx-r-expired, bzx-expired) |
| 05 | Implement five upgrades: Report System Health Checker, automated schedules, AI Executive Summary and Growth Advisor, source/number verification, and authorized all-my-salons reporting. | TODO |
| 06 | Protect financial truth: one canonical Reports calculation service. Same metric + same scope + same dates + same snapshot = same figure everywhere. | TODO |
| 07 | Finish real implementation: actual APIs/storage/jobs/permissions; regression tests and final file/change inventory, not unsupported claims of completion. What is known from the screenshot versus what must be checked Visu | NOISE — delivery instruction |
| 14 | Owner recommendation #2 - Automated daily, weekly and monthly reports Add scheduled report generation that uses existing background workers, scheduler and notification channels. Do not require the owner to keep the brows | TODO |
| 15 | Owner recommendation #3 - AI Executive Summary & Growth Advisor The AI layer explains verified report data and proposes owner-reviewable opportunities. It must not calculate official numbers from its own imagination or p | TODO |
| 17 | Secure report viewer, file exports and historical snapshots Report details overlay • Report ID/title/type; owner and branch scope; created/generated timestamps; reporting date window; timezone; created by; generation/acc | EXISTS — report detail overlay with meta, verify and regenerate (bzx-report, bzx-report-meta, bzx-verify, bzx-regen) |
| 19 | Tenant isolation, AI access and subscription control • Tenant isolation: enforce authenticated tenant/branch context in backend database access; no client-supplied tenant scope without authorization. Avoid cross-tenant d | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |

## Customer Retention (15)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-Click Retention Accuracy Health Checker Add a button that verifies cohort definitions, Never Visited separation, last completed visit, days away, KPI counts, and oldest-first sort order. | EXISTS — Check Retention System runs read-only checks with overall result (open-health → health-run / health-result) |
| 02 | Screen Fit & Layout Health Checker Add a development or admin-only diagnostic that flags clipped controls, overlapping text, hidden pagination, and horizontal overflow on the target viewport. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | Bulk SMS Eligibility Checker Before preview/send, list exactly why recipients are excluded: missing phone, invalid phone, no consent, STOP, global SMS disabled, tenant Twilio not configured, or quiet-hours restrictions. | EXISTS — bulk SMS preview lists why each recipient is excluded (consent, opt-out, phone, recently contacted, upcoming booking, never visited) (POSRetentionScreen) |
| 04 | Safe Cross-Page Selection Review When selecting across pages, provide a compact review summary so staff understand how many recipients are selected, eligible, and excluded before sending. | EXISTS (part) — selection bar with counts: select page / all matching eligible / clear |
| 05 | Compact Campaign History Access Keep campaign history accessible through a drawer, overlay, or right-side panel instead of letting it crowd the main retention work area. | EXISTS — Campaign History from the header |
| 06 | Customer Retention Drill-Down Let authorized users open a clean customer retention detail view showing last visit, recent visits, outreach history, and eligibility without leaving the route unnecessarily. AI POWERSALON / | TODO |
| 07 | Threshold clarity Show the active at-risk threshold clearly, especially if the threshold is configurable by tenant or settings. | EXISTS (part) — cohorts use the salon's own thresholds from Settings |
| 08 | Quiet-hours protection If outbound messaging rules require quiet hours, show the policy clearly and queue or defer messages appropriately. | TODO |
| 09 | Duplicate-send protection Use idempotency keys and clear button disable states to prevent duplicate campaigns from double taps or retries. | TODO |
| 10 | Empty-state quality If a tenant has zero at-risk customers, show a useful empty state with explanation and alternative actions. | TODO |
| 11 | Vietnamese copy resilience If POS localization applies, ensure longer Vietnamese labels wrap intentionally and do not break the table header or KPI row. | EXISTS — EN/VI; Vietnamese harness certified |
| 12 | Accessible comparison text Show status/eligibility with text and icon—not color alone—so staff can understand the outcome quickly. | TODO |
| 13 | Table personalization only if already supported If column visibility or density controls already exist in the platform, keep them. If not, do not create risky complexity unless necessary. | NOISE — conditional instruction (only if already supported) |
| 14 | Data freshness hint Show the last updated time or refresh behavior when helpful, especially for campaigns and recently delivered statuses. | BUILT — Numbers updated {time} after a successful summary; a failed refresh keeps the last good time and says so (retention-fresh; shared FreshnessLine) |
| 15 | Communication audit shortcut Provide quick access to the audit trail for authorized users when a send, exclusion, or callback status needs investigation. AI POWERSALON / CUSTOMER RETENTION / SUNMI FLEX 3 Claude developer | TODO |

## Customer Intelligence (22)

| # | Recommendation | Status |
|---|---|---|
| 01 | Start with a repository and data-flow audit | NOISE — audit / implementation-order / mandate text, not a feature |
| 02 | Verify six metric definitions and 15/1/0 population relationship; validate freshness. | EXISTS — the six cards reconcile on screen ("Why these numbers?" cix-why: each scanned profile in exactly one state) with real freshness (cix-freshness) |
| 03 | Implement one-click read-only Health Checker and error diagnostics. | EXISTS — Check Customer Intelligence System (cix-check), read-only |
| 04 | Redesign 24/27-inch full-screen UI while preserving current navigation/cards. | NOISE — audit / implementation-order / mandate text, not a feature |
| 05 | Implement customer search, month-view date ranges, server-side pagination. | EXISTS — authorized customer list: search, status/flag filters, date field + presets + month calendar, sort, numbered pages |
| 06 | Wire full customer details overlay and evidence/source drill-downs. | EXISTS — customer overlay with classification, evidence, the Customer Search profile and links to owning modules |
| 07 | Authorized advanced search • Customer: first/last/full name, verified phone (normalized), permitted email, customer ID. • Technician: actual technician name/ID, previously assigned technician, verified preference (distin | EXISTS (part) — customer search (name / phone / email) on the list |
| 08 | Monthly From Date / To Date calendar controls • Open actual month-grid popover with month/year heading, previous/next month, weekday labels, selectable days, highlighted range, Today/Apply/Clear/Cancel. • Presets: Today, | EXISTS — From/To month calendar (shared RangeCalendar) on the customer list |
| 09 | Numbered pagination and correct sorting • Use server-side pagination for customer overview, candidates, active/inactive lists, churn/rebooking/recommendation records, intelligence activity, scan history and data-quality  | EXISTS — server-side numbered pages with sort |
| 10 | Execute tests, document source changes, results and blockers. | NOISE — audit / implementation-order / mandate text, not a feature |
| 17 | Retention, marketing and communication safety • Customer Intelligence may identify reviewable segments; Customer Retention owns lifecycle policy, Audience Builder owns marketing eligibility, Campaign Builder owns approva | NOISE — safety requirement narrative (segments are review-only; sending stays in Retention/Marketing) |
| 18 | Identity correctness, phone updates and cross-branch • Normalize numbers, preserve phone verification and audit history, support legitimate shared numbers and prevent false merges. • Staff may update phone through existi | NOISE — identity requirement narrative |
| 23 | Multi-branch Customer Intelligence • Switch Current Branch, Selected Authorized Branches or All Authorized Branches according to actual owner permissions. • Show aggregation scopes explicitly, deduplicate distinct custom | TODO |
| 24 | Loyalty and memberships: read authoritative data • Customer Intelligence displays only authorized current tiers, balances, membership state and benefits from Loyalty & Rewards/Memberships. • Do not calculate or persist a | NOISE — read-authoritative-data requirement narrative |
| 25 | Entitlements, subscriptions and AI metering • Audit AI Customer Profile Assistant and Customer Intelligence access separately from ordinary Customer Management. • Use the existing subscription/entitlement service and AI  | NOISE — entitlement/metering audit narrative |
| 26 | Privacy, RBAC, tenant isolation and audit • Server-authorized tenant and branch scope on each read, search, overlay, export and write; never trust a browser-supplied tenant ID. • Apply role permissions, minimization and  | NOISE — privacy/RBAC requirement narrative |
| 29 | Language, accessibility and app boundaries • Front Desk tenant POS supports English/Vietnamese via the existing localization system; add labels for new cards, search, calendar, detail views, health and validation. • Do n | EXISTS — EN/VI on the Front Desk POS only (english-only-apps gate keeps other apps English) |
| 30 | Five additional upgrades • One-Click Customer Intelligence Health and Accuracy Checker: authoritative counts, visit history, duplicates, retention/rebooking, scan freshness. • Customer 360-Degree Intelligence: approved i | EXISTS (part) — the first of the five (health & accuracy checker) is cix-check; the others not built |
| 31 | Implementation order (strict priority) Phase Implementation deliverable | NOISE — audit / implementation-order / mandate text, not a feature |
| 32 | Acceptance and regression test matrix Existing visual fidelity • Route, title, six card titles/definitions, Refresh, How to use this, cached update, sidebar, header and Help remain functional. • 24-inch 100% browser zoom | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |
| 33 | Definition of done (must all be true) • The original six cards and controls remain; numeric results are real and traceable to source/eligibility rules. • 15 scanned / 1 active / 0 inactive has an evidence-based explanati | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |
| 34 | Final execution mandate for Claude Implement this directly in the existing AI PowerSalon repository. Start by auditing actual code and schema, preserve all six metric cards, current navigation, Refresh and the How to use | NOISE — audit / implementation-order / mandate text, not a feature |

## Customer Profile Assistant (9)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-Click Layout & Module Fit Health Add a read-only visual QA subcheck under existing AI Customer Profile System Health: viewport, overflow, card sizes, focus/keyboard occlusion, date-picker placement, inaccessible Clos | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Smart Balanced Layout Presets Optional Touch Comfortable / Compact mode, persisted in existing tenant UI preferences (if applicable). No global browser zoom; allow choice to display more rows while respecting min font/to | BUILT — opt-in Compact spacing per device (profile menu → Compact spacing; Standard = certified default; gaps/padding only, never fonts or touch targets) — shell/spacingPref.ts + spacingPref.test 2/2 |
| 03 | Evidence + Freshness Status Show provenance and stale/last-refreshed indicators on existing preferences, services, VIP/retention summaries and note drafts; never create parallel source ledgers. | TODO |
| 04 | Customer Snapshot panel Read-only customer context preview in the real Customer Profile overlay with links to Booking/History/Notes; avoid duplicate profile records or full private details on the AI subscription home. | TODO |
| 05 | Slow Network / AI Failure resilience Use skeletons and stable card heights, bounded retries, cached authorized metadata where safe, never obscure existing customer/booking services during an AI outage. | TODO |
| 06 | Visual regression & accessibility CI Add screenshot diffs at target viewports, automated overflow checks, keyboard and touch tests, long EN/VN data cases and module-inventory checks. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 07 | Performance guardrails Defer expensive AI summaries until authorized customer context opens, dedupe provider calls, memoize safe selectors, paginate history and reduce unnecessary shell rerenders. Prioritize upgrades wit | TODO |
| 12 | VIP and churn/retention intelligence Reuse existing Customer Retention statuses and Loyalty tier definitions. Do not create a competing lifecycle or VIP rule engine inside this feature. CLAUDE ENGINEERING GUIDE / AUDIT F | TODO |
| 13 | Backend security, tenant isolation, permissions, EN/VN scope and other app localization restrictions. 14-15 Engineering phases, testing matrix, positive/negative cases and requirements for actual test evidence. 16-17 Com | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |

## Deals  Offers (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Responsive Layout Diagnostics: hidden developer-only overlay showing actual CSS viewport, overflow offenders, panel dimensions and browser zoom context. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | One-click Deal Health Checker: reconcile Checkout connectivity, approval rules, stale data, expiration jobs and financial totals. | EXISTS — Check Deal System in the header (POSDealsScreen) |
| 03 | Customer-specific Deal Preview: show precise eligible items, discount base and reason codes without recording a use. | TODO |
| 04 | Discount Budget Exposure Guard: estimate maximum authorized promotion cost from discount caps and allowed uses before activation. | TODO |
| 05 | Duplicate Redemption Monitor: find duplicate callbacks or repeated ticket/deal keys and guide investigation without auto-editing ledgers. | TODO |
| 06 | Upcoming Expiration Alerts: notify authorized managers about scheduled starts, expirations and remaining usage before staff confusion. | EXISTS (part) — Expiring soon card from the server; no notification |
| 07 | Approval SLA / Escalation: flag technician proposals approaching start time, retaining manager authorization rather than auto-approving. | TODO |
| 08 | Preview vs Paid Comparison: compare the initial estimate with the final Checkout discount and explain changes due to ticket edits. Implementation principle All proposed enhancements are additive to the existing interface | TODO |
| 09 | Deal Rule Versioning: freeze each committed redemption under the exact approved rules used at payment time. | EXISTS (part) — deal version history; redemptions kept on the discount authority |
| 10 | Discount Stacking Explorer: staff preview of allowed and blocked combinations across Deals, Coupons, Promotions, Loyalty and Membership. | TODO |
| 11 | Branch Performance Comparison: compare verified usage and discount costs by branch, never treating associated revenue as incremental lift. | TODO |
| 12 | Commission Impact Review: flag deals where commission basis or funding allocation is not approved before production. | TODO |
| 13 | Deal Timeline / Audit: read-only chronological record of draft, request, approve, activate, pause, redeem and refund events. | EXISTS — Deals & Offers detail: History tab (audit), Approvals tab (decisions with names), Redemptions tab (redeem / reverse) — POSDealsScreen + DiscountDetailsDialog |
| 14 | Safe Rollback & Feature Flags: gate new UI/diagnostics by tenant or branch with rollback that never discards history. | NOISE — rollout guidance |
| 15 | Accessibility / Touch QA: automated text-clipping and hit-target checks with both English and Vietnamese labels. | EXISTS — EN/VI + harness touch/clipping checks |
| 16 | Automated Financial Regression Suite: replay 5%, 20%, technician cap, refunds, duplicate events and concurrency with seeded fixtures. Recommendation acceptance Each recommendation must be classified Already Working, Need | NOISE — regression-suite instruction |

## Products Management (20)

| # | Recommendation | Status |
|---|---|---|
| 01 | Screen Fit & Module Health No hidden Modules, clipped controls, blocked sidebars, overlapping text, unreachable pager, font shrink, or page-level horizontal overflow. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Product Catalog Accuracy Duplicate SKU/barcode, invalid variant relationship, archival mismatches, branch/catalog counts and broken Detail links. | EXISTS — inventory System Check from the Products header (SystemCheckButton domain=inventory) |
| 03 | Product KPI & Retail Value Products count, Need Reorder, Retail Value formula, summary-to-detail ties and accurate error/unavailable states. | EXISTS — Products / Need Reorder / Retail Value from server metrics, same scope as Stock Alerts (POSProductsScreen header comment, kpi-*) |
| 04 | Stock Movement Integrity PO receipts, Add Stock, transfers, waste, usage and corrections post once to the canonical ledger. | TODO |
| 05 | Technician Attribution Last Used By, all technician events, used_at vs recorded_at, branch attribution, corrections and idempotency. | EXISTS — Last Used By on every row + Technician Usage tab (LastUsed, ProductDetailsDialog) |
| 06 | Cross-Module Wiring Products → Inventory → Alerts → Suppliers/POs → Checkout → Reports; stable IDs, cache freshness and tenant safety. | NOISE — cross-module wiring audit instruction |
| 07 | Duplicate product warning Alert when a new SKU, barcode or supplier SKU may duplicate an existing product; allow authorized review. | EXISTS (part) — a duplicate SKU / barcode is refused by the server and said so in the product form (ProductFormDialog); no supplier-SKU near-match warning |
| 08 | Quick scan and find Focus barcode input efficiently for compatible scanner hardware; never add unintended spacing to exact codes. | EXISTS — one universal search includes barcode/SKU; Enter never submits a form (POSProductsScreen search) |
| 09 | Stock status preview Before Add Stock, display current, incoming, projected and threshold impact by branch and unit. | EXISTS (part) — Add Stock shows current → after quantity before saving (inv.addStockSub); incoming / threshold impact not shown |
| 10 | Row-level quick details Compact Details overlay from the product row, keeping Add Stock and Archive available. | EXISTS — product row opens Details (Overview · Pricing · Inventory · Suppliers · Technician Usage · History) with Edit / Add Stock / Record Use / Reorder kept (ProductDetailsDialog) |
| 11 | Readable price history Expose authorized effective-date changes, why a price changed and what original receipts retain. | TODO |
| 12 | Unavailable-data clarity Show loading/unavailable/retry separately from zero products, no matches, or no technician history. | EXISTS — StateBlock error/retry vs filtered no-match vs no products yet (POSProductsScreen list states) |
| 13 | Stable filtering Preserve active search/sort when returning from Details, editing or a stock confirmation. Source: Products_Claude(1).pdf • November 2026 ADDENDUM PAGE 18 AI POWERSALON / PRODUCTS MANAGEMENT SUNMI FLEX 3  | EXISTS — details/edit/stock are overlays, so search/sort/filters stay as they were |
| 14 | Controlled low-stock reorder Prefill a draft PO from verified product-supplier mappings; require human approval before ordering. | EXISTS (part) — Details → Reorder (when a suggested reorder exists) opens a draft purchase order for review; nothing is ordered without a person |
| 15 | Safe archive preview Explain affected inventory/active dependencies before archiving, and preserve access to historical receipts. | EXISTS — archive confirm warns about stock on hand; Archived view keeps history with Restore (archive-confirm, life-archived) |
| 16 | Touch layout diagnostics Admin/dev-only overlay displays viewport CSS size, shell/sidebar widths and any overflow warnings; no forced zoom. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 17 | Concurrent-edit protection Warn when a product or stock balance changed since opening the form and refresh authoritative data. | BUILT — product edit carries the updatedAt it opened with; a product changed elsewhere is refused 409 PRODUCT_CHANGED and nothing is written (inventory.service updateProduct; inventory-product-concurrency.pgtest; ProductFormDialog.concurrency.test) |
| 18 | Product movement timeline A chronological evidence view for receipts, stock in/out, usage, transfers, waste and reconciled counts. | EXISTS — Details → History: stock movements (receipts, usage, transfers, corrections) with the audit trail, paged (posInventoryScreenApi.movements) |
| 19 | Metrics freshness marker Show timestamp/source for successful refresh; never show a fresh-looking timestamp after an API error. | BUILT — 'Numbers updated {time}' stamped only after a successful metrics read; a failed refresh says the numbers are from the last good read (metrics-fresh; POSProductsScreen.test) |
| 20 | Automated visual regression Capture primary SUNMI and fallback viewport screenshots in both POS languages and compare after releases. Source: Products_Claude(1).pdf • November 2026 ADDENDUM PAGE 19 AI POWERSALON / PRODUC | EXISTS — certified one-screen screenshots EN + VI for Products in the harness |

## Global Loyalty Rewards (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-click Loyalty Accuracy Scan funding, points, holds, redemptions, payables and cross-device freshness; Health Checker evidence-backed PASS/WARN/FAIL. | EXISTS — Check Customer & Loyalty System: read-only checks incl. ledger balance reconciliation and bonus posting (loyalty-health-run) |
| 02 | Money Flow Explorer Click a redemption to trace originating token-backed earning → hold → ticket → payable → provider settlement. | TODO |
| 03 | Smart Wallet Funding Alert Show low balance and estimated funding needs using verified historical usage; no automatic purchase. | EXISTS (part) — token wallet balance with alert level (migration 804, wallet/levels) on Loyalty → Rewards Network; no depletion forecast |
| 04 | Policy Impact Preview Before earning rule changes, show allowed branch scope, expected effect and human approval; historic events immutable. | EXISTS (part) — earning rule changes go through a preview (earning/preview), drafts and scheduled versions before activation (step-up) |
| 05 | Balanced Dashboard Layout Automated screenshot and overflow checks for each SUNMI viewport with Diagnostics preserved-module inventory. Recommended visual hierarchy Primary operations and finance KPIs stay top-level; low | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 06 | Funding vs Liability Explicitly compare backed rewards, available points, held points and salon payables Reconciliation without combining ledgers. | EXISTS (part) — KPI row: available tokens, reward value (read-only) and pending funding (RewardsNetworkPanel) |
| 07 | Redemption Exception Queue Owner/finance-friendly queue of expired holds, unreconciled paid tickets and disputed reversals with assignment. | TODO |
| 08 | Safe Notification Read Sync Reading an alert clears only the recipient unread badge across devices, not the underlying failure. | TODO |
| 09 | Duplicate & Abuse Warning Review-first alerts for hold churn, replayed callbacks and suspicious payout changes; no System silent asset confiscation. | TODO |
| 10 | Source-linked Financial Explain every KPI formula, scope, currency, version, last refreshed time and Tooltips missing/unknown states. Operational guardrail All recommendations must reuse existing modules, notifications,  | TODO |
| 11 | History Smart Filter Presets Save authorized date/status/branch filters with newest-first server pagination and safe permissions. | EXISTS (part) — purchase history and token activity ledger, newest first, server-paged |
| 12 | Screenshot-based Regression Test viewport geometry, open/close overlays, English/Vietnamese POS labels and Suite source-backed data. | EXISTS — Loyalty page in the certified harness, EN + VI |
| 13 | Device-friendly Details A consistent Close, Back, View Source, action toolbar, focus restoration and internal Overlay scrolling. | EXISTS — shared FitDialog: Close, Esc, focus trap, focus restored to the opener, internal body scrolling (components/FitKit.tsx) |
| 14 | Readiness Control Center Per-feature CODE_READY, SANDBOX_READY, PRODUCTION_READY or BLOCKED_EXTERNAL with evidence. | EXISTS (part) — Buy Tokens says BLOCKED_EXTERNAL when no approved provider is connected (no pretend readiness) |
| 15 | Stable Cross-app Balance Use existing push/realtime contracts and explicit stale-time labels; no optimistic financial Invalidation changes. | TODO |
| 16 | Audit-ready Export & Role-scoped CSV/report with date basis, rule versions, source IDs, reviewer notes and Evidence export audit. Every new recommendation is additive. Existing screens, route names, action destinations,  | TODO |

## AI Booking Assistant (14)

| # | Recommendation | Status |
|---|---|---|
| 01 | Customer intent Receive request; AI constructs a proposal only; no completed appointment assertion. | EXISTS — AI builds a proposal only; "AI said booked" vs pending vs confirmed appointment shown as different statuses (POSAIBookingScreen header) |
| 02 | Eligibility Recheck subscription, tenant toggle, Super Admin policy, role/branch access and usage/budget limits. | EXISTS — package/eligibility state at the top (AiPackagePanel: price, usage, trial, Off) + booking system check (bk-check) |
| 03 | Services / techs Read canonical service prices/durations/add-ons, qualifications, schedules and customer context. | TODO |
| 04 | Availability Query canonical Booking; validate holds, blocked time, tech breaks, existing appointments and conflicts. | EXISTS — reads the existing booking records; holds/expiring holds surface as recovery cases (bk-recovery) |
| 05 | Human approval Display exact date, salon-local time, service, technician(s), price and terms; require authorized confirmation. | EXISTS — recommendation approval requires a staff action with a reason (bk-rec-approval, bk-rec-approval-go) |
| 06 | Pending hold Create idempotent pending booking through existing API; never label pending as confirmed. | EXISTS (part) — pending holds go through the existing verified booking flow (idempotent hold; pending never shown as confirmed) |
| 07 | Six-digit SMS When required by policy use existing tenant-specific verification, retries, cooldown and expiry. | EXISTS (part) — the salon's own Twilio Verify for six-digit codes with retries / cooldown (Booking Phone Verification) |
| 08 | Confirm + verify Only mark Confirmed after backend verifies code and transaction; emit Booking events; reconcile POS and AI Calendar. | EXISTS (part) — confirmed only after the server verifies the code (BookingVerificationGuard / VerifiedBookingFlow) |
| 09 | Audit + display Store action result and correlation reference; show exact appointment ID and reliable current state. “AI proposed”, “SMS submitted”, “SMS delivered”, “pending hold exists” and “appointment confirmed” are  | EXISTS — request overlay with Execution / Verification / Audit tabs and the real appointment (bk-overlay, bko-booking) |
| 10 | Contextual Service Breakdown Surface service, add-ons, estimated duration and canonical salon price in review; visually separate manual overrides from catalog prices. | TODO |
| 11 | Reception Priority Worklist Explainable queue of pending verification, impending holds, unresolved AI booking attempts and conflicts; sorted by urgency, not just newness. | EXISTS — recovery worklist: failed requests, expiring/expired holds, failed codes, unconfirmed AI appointments (bk-recovery) |
| 12 | Accessibility Quick Audit Development/staging check for focus order, contrast, safe modal close, 44px touch targets and language overflow, including tenant-facing English/Vietnamese POS. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 13 | Controlled Rollout Flag Enable revised layout for pilot tenants/branches and preserve a documented rollback path; do not run unapproved production migrations. | NOISE — rollout guidance |
| 14 | Evidence Export Generate an authorized support report with timestamps, status, masked references, test/trace IDs and screenshots; redact PII, secrets and raw OTP. Do not treat these recommendations as license to remove o | TODO |

## AI Analytics Forecasting (21)

| # | Recommendation | Status |
|---|---|---|
| 01 | Forecast Trust Ribbon Across Appointments/Revenue/No-Show: source timestamp, history coverage, model version, last verified backtest, source freshness and readiness; links to existing details. | EXISTS — readiness ribbon: available vs required history, last run, data quality (fcx-readiness, fcx-r-*) |
| 02 | Adaptive Layout Health Developer/authorized admin-only diagnostics for rendered viewport, zoom, overflow, clipped Check controls, card sizes, browser/Android info and screenshot evidence. Never expose sensitive runtime d | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | Forecast-to-Capacity Gap Read-only chart comparing expected appointment workload and qualified technician-hours; advisory link to Scheduling Optimizer, no automatic shifts. | TODO |
| 04 | Explain the Readiness Gap A click on Insufficient History opens a factual source breakdown (days, statuses, missing dates, filters, worker freshness) and links to Booking. | EXISTS — readiness cards break the gap down by required vs available days and valid records (fcx-ready-cards, fcx-r-required, fcx-r-valid) |
| 05 | Model Reliability Transparent time-based MAE/WAPE/Brier or other applicable task metric, baseline, sample Scorecard size, interval coverage and current version; “Not evaluated” where absent. | TODO |
| 06 | Source-to-Report Side-by-side canonical historical revenue totals with date/status/refund explanations and Reconciliation source links; never recompute independent financial authority. | TODO |
| 07 | Non-mutating Scenario Optional what-if staffing/service demand illustration with explicitly labeled assumptions; Sandbox versioned and separate from real forecasts, never written as actual appointment or revenue. | TODO |
| 08 | Accessibility / Touch Chart Tap-to-inspect chart points, textual accessible trend summary, larger focus states, table Summary equivalents and full-screen chart view without truncation. Do not reduce the number of origina | TODO |
| 09 | Prevent cut-off charts, tables, or buttons. | NOISE — guidance or a list of source systems to verify, not a feature |
| 10 | Preserve filter settings during navigation. | BUILT — the chosen forecast tab is kept in the address (?tab=), so leaving and returning or refreshing keeps it (readTab / writeTab); test |
| 11 | Use accessible chart legends and tooltips. | NOISE — generic chart instruction |
| 12 | Preserve the existing gold/cream appearance. Recommended Dashboard Layout A. Header Display: | NOISE — guidance or a list of source systems to verify, not a feature |
| 13 | Service catalog. | NOISE — guidance or a list of source systems to verify, not a feature |
| 14 | Service Done. | NOISE — guidance or a list of source systems to verify, not a feature |
| 15 | Checkout. | NOISE — guidance or a list of source systems to verify, not a feature |
| 16 | Payments and refunds. | NOISE — guidance or a list of source systems to verify, not a feature |
| 17 | Sales Reports. AI POWERSALON / CLAUDE IMPLEMENTATION GUIDE 17 / 45 AI Analytics & Forecasting | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |
| 20 | STAFFING DEMAND FORECASTING Add an optional staffing analysis layer based on verified demand. Use: • Historical appointments • Service durations • Technician skills • Shift availability • Breaks • Forecast booking volume | TODO |
| 21 | SERVICE DEMAND FORECASTING Support forecasts for real salon services. Potential categories: • Manicure • Pedicure • Gel services • Acrylic services • Nail art • Head spa • Other tenant-defined services Use actual service | TODO |
| 26 | PERFORMANCE AND SCALABILITY AI PowerSalon must support thousands of salons and substantial transaction volume. Requirements: • Server-side data aggregation • Efficient database indexes • Bounded queries • Cached aggregat | NOISE — guidance or a list of source systems to verify, not a feature |
| 32 | IMPLEMENTATION PRIORITY ORDER Claude, implement in the following order. Priority 1 — Audit Existing Implementation Find working, broken, partial, and missing functionality. Priority 2 — Verify Historical Data Investigate | NOISE — guidance or a list of source systems to verify, not a feature |

## AI Fraud Money Protection (12)

| # | Recommendation | Status |
|---|---|---|
| 01 | Exact duplicate charge 09 Paid ticket without capture | EXISTS — these are canonical Money Protection rules (duplicate charge / paid ticket without capture …) in modules/ai ai-money-protection-rules.ts |
| 02 | Likely duplicate charge 10 Captured money on cancelled ticket | EXISTS — canonical Money Protection rules (likely duplicate charge / captured money on cancelled ticket) in ai-money-protection-rules.ts |
| 03 | Verify financial data and all 15 canonical rules with realtime/near-realtime/batch worker health and no duplicate engine. | TODO |
| 04 | Build one-click read-only Fraud Protection Health Checker with source freshness and actionable error classification. | EXISTS — Check AI Money Protection System (read-only) in the shared header |
| 05 | Redesign full-screen module home for 24/27-inch POS, status cards, navigation, readable touch UI and vertical scroll. | NOISE — redesign instruction |
| 06 | Add authorized search, monthly date-range calendars and paginated history with newest-first default and explicit date modes. | EXISTS — alerts / investigations: search, presets + From/To month calendar, newest first, numbered pages |
| 07 | Add source-backed AI financial explanation overlays for refund, discount, void, mismatch, cash and settlement cases. | TODO |
| 08 | Priority 2 - explainable suspicious refund monitoring • Trace original captured payment, payment method, ticket, refund request vs completed refund, cumulative refunds, processor reference, authorized employee action and | TODO |
| 09 | Extend verified AI Analytics and permitted multi-branch summaries using canonical Reports definitions. | TODO |
| 10 | Run full UI, API, security, worker, billing and payment non-mutation regression tests; document actual results and blockers. | NOISE — regression instruction |
| 19 | Implementation order - specific engineering plan | NOISE — implementation order |
| 20 | Verification matrix and negative tests Area Mandatory checks Screenshot parity Original route, finance description, $69/mo reference, 0/10,000 calls reference, status, trial notice, Cancel add-on, sidebar and links Billi | NOISE — verification matrix |

## MESSAGE TEMPLATES  AUTOMATION (12)

| # | Recommendation | Status |
|---|---|---|
| 01 | Template CRUD Create/save/retrieve/list permission and transaction path; failed API response shown. | EXISTS — create/update/status/duplicate with version conflict + validation errors shown (POSMessageTemplatesScreen, message-templates.pgtest) |
| 02 | Variable renderer Legacy [name], new allowlisted tokens, missing-data safeguards. | EXISTS — server renderer with allowlisted variables, legacy [name] placeholders flagged, missing-data fallbacks (template-variables.ts, mt-live-preview) |
| 03 | Active version Draft/Active correctness, active automation binding, queued snapshot consistency. | EXISTS — versions tab + active-binding protection (mt-versions, TEMPLATE_IN_USE replacement flow) |
| 04 | Booking connections Existing booking confirmation, reminders, follow-up and missed-call dependencies. | EXISTS — Automations tab: workflow connections/bind/unbind (TemplateAutomations, api.connections) |
| 05 | SMS readiness Tenant-specific Twilio account, sender, registration and callbacks (last checked). | EXISTS — health check sms_sender finding (tenant Twilio set / last validated / failed) in message-templates.ts healthCheck |
| 06 | Email readiness Verified sender/domain, transport config and events (last checked). | EXISTS — health check email_sender finding in message-templates.ts healthCheck |
| 07 | Consent Suppression and purpose-specific eligibility enforced by actual send pipeline. | EXISTS — consent/suppression enforced in the send pipeline (communications notifications.service, reminders.service) |
| 08 | Queue/worker Pending jobs, retries, failed queues, scheduler heartbeat and duplicate prevention. | EXISTS elsewhere — notification failures queue (notification-failures.ts) + reminder run heartbeat (appointment_reminder_runs); not surfaced on this page |
| 09 | Frontend Viewport fit, clipped controls, API error states, date picker and translation. | EXISTS — FitDialog/ErrorRetry/PeriodBar calendar, EN/VI keys (POSMessageTemplatesScreen) |
| 10 | Security Tenant isolation, permission guards, masking and logs. Health Checker implementation rules • Read-only by default. Never create real send jobs, change settings, publish a template or access other tenants when ru | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 11 | Duplicate Template Detection Warn when a new draft is near-identical within the same authorized tenant/branch. | BUILT — new drafts warn (never block) when same name or near-identical body exists on the channel (messageTemplateDup.ts + mt-dup-warn; tests) |
| 12 | Version Rollback Assistant Restore earlier approved content as a NEW audited version; do not rewrite historic messages. Scope safeguard: Add recommendations only after confirming no current module already provides that c | BUILT — 'Restore this version' saves the old content as a NEW version via the audited update path; history kept (mt-restore-version; POSMessageTemplatesScreen.test) |

## TEAM PERFORMANCE 3 (11)

| # | Recommendation | Status |
|---|---|---|
| 00 | Responsive-layout diagnostic mode Optional developer-only overlays showing actual viewport bounds 1 and overflow. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 01 | Screen Fit & UI Health Clipping, page overflow, visual hierarchy, touch size, popover position, keyboard focus. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Score Scale & Formula 5%/5.0 representation, metric definitions, score model and formatting. | EXISTS — score rule shown on screen (score-rule; 5.0 scale, verified reviews only) |
| 03 | Rating Source & Sample Verified reviews, counts, missing data, duplicates, stale score calculations. | EXISTS — verified reviews counted once, Unrated when none, low-sample marking (POSTeamPerformanceScreen header rules, reviews-list) |
| 04 | Distribution & Ranking Tier boundaries, eligible technicians, ties and rank criteria. | EXISTS — distribution bars + ranked-by criteria; minimum sample ranked first (distribution, ranked-by) |
| 05 | Completed Service Accuracy Service Done links, multi-tech allocations, canceled cases and duplicate events. | EXISTS — services table with role/helper for multi-tech tickets (services-table, service-role, service-helper) |
| 06 | Search & History Wiring Authorized query paths, date semantics, real pagination and detail drilldown. | EXISTS — search, date basis, pages and detail drilldown (search, services-date-h, dlg-performance) |
| 07 | Branch & Tenant Isolation Cross-tenant negative tests, record scoping, leakage in client cache/exports. | NOISE — isolation test instruction |
| 08 | Cross-Module Integration Team, Booking, Service Done, Reviews, Reports and payroll separation. Controls Each checker returns Pass / Warning / Fail / Unable to Verify with scope, evidence, exact affected module, proposed  | NOISE — integration checker instruction |
| 09 | Custom dates - real monthly calendar • Presets: Today, This Week, This Month, This Year, Custom Range. • Custom range shows From Date and To Date fields. Clicking either opens a true month-view calendar with previous/nex | EXISTS — period presets + custom From/To month calendar (PeriodBar) |
| 14 | Performance history, indicators and fairness • History view should distinguish completed service count, service accuracy, verified customer rating, rating count and any explicitly configured operational metrics. • Custom | TODO |

## OCR Receipt Scanner (5)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-Click OCR Health and Accuracy Checker Verify storage/upload, OCR provider, workers, duplicate detection, Expenses approvals, purchasing/receiving, inventory boundaries, subscription metering and tenant permissions. S | EXISTS — read-only receipt scanner / review system checks (rcsx-check → rcsx-health; rrx-check → rrx-health) |
| 02 | Full review and human-controlled approval workspace Show original receipt beside extracted editable data, line items, taxes, arithmetic warnings, category and inventory match. Staff must confirm any posting/receiving. | TODO |
| 03 | Search, month calendars and newest-first pages Search vendor, invoice, product, SKU, amount, receipt/expense/PO ID, and only legitimate authorized customer references. Use custom month-view From/To controls and numbered  | EXISTS — search, date field + From/To month calendar, newest-first sort (rcsx-search, rcsx-datefield, rcsx-sort; rrx-search, rrx-sort) |
| 04 | Duplicate and purchase-order matching Find repeated uploads/expenses, mismatched unit prices and partial receiving; require review and protect against double expense/stock posting. | EXISTS — duplicate receipts flagged + Duplicates KPI (rcsx-dupe, kpi-dupes) |
| 05 | Expense and inventory intelligence Use approved supplier costs, category spend and verified receiving to explain changes while preserving canonical reporting formulas and human control. 26 / Implementation sequence for C | TODO |

## Customer Timeline (8)

| # | Recommendation | Status |
|---|---|---|
| 01 | Locate route, component, existing APIs, permissions, worker pipelines and all relevant source systems; produce code audit. | NOISE — process step (locate/map) |
| 02 | Repair customer search, identity disambiguation and current source linkage before new visuals. | NOISE — process step (repair search first) |
| 03 | Implement read-only health diagnostics to expose real missing/stale/error data. | EXISTS — read-only timeline check + partial-data notice (tlx-check, tlx-partial) |
| 04 | Complete authorized timeline aggregation, true chronological ordering, idempotency and visit grouping. | EXISTS — chronological events grouped by visit (tlx-events, tlx-group) |
| 05 | Build responsive full-screen selected-customer summary, event list and source-linked detail overlays. | EXISTS — customer summary KPIs + source-linked event overlay (tlx-kpis, ov-booking/ov-checkout/ov-refunds) |
| 06 | Implement advanced search, month-view From/To calendars, filters and stable numbered pagination. | EXISTS — search with match picker, From/To month calendar, filters, numbered pages (tlx-search, tlx-matches, tlx-cal, tlx-pagesize) |
| 07 | Integrate live refresh, localization and clear empty/error/permission states. | EXISTS — newer-events notice, EN/VI keys, empty/error states (tlx-newer, tlx-find-err) |
| 08 | Test source reconciliation, tenant isolation, financial safety, performance and regression; report files changed and verified results. AI POWERSALON / CUSTOMER TIMELINE CLAUDE BUILD SPECIFICATION · 2026-11-01 | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |

## LIVE TECHNICIAN SCHEDULE (17)

| # | Recommendation | Status |
|---|---|---|
| 01 | Auto Screen Calibration Detect usable viewport; diagnostic reports overflow before enabling a density adjustment | EXISTS — the shell measures the usable viewport live and Check this screen reports overflow (shell/displayProfile.ts, ScreenCheckDialog) |
| 02 | One-click Schedule Health Read-only checks for conflicts, missing shifts, stale data and broken KPI wiring | TODO |
| 03 | Gap Quality Indicator Explain gap minutes and whether service duration + buffers can fit | EXISTS (part) — the full-day overlay lists gaps and the next opening; Find Next Available uses the booking engine's openings for a real service (duration + buffers) |
| 04 | Shift-vs-Clock-In Badges Separate expected schedule from physical presence with true status labels | TODO |
| 05 | Multi-Tech Conflict View Preview synchronized availability for bookings requiring several specialists | EXISTS (part) — Find Next Available Technician over the booking engine's openings; multi-specialist sync view not built |
| 06 | Next-Openings Preview Show earliest eligible appointments with auditably calculated start/end | EXISTS — Next openings from the booking engine with start/end, bookable from the panel (openings, book-opening) |
| 07 | Protected Break Preview Warn if a lunch/break change conflicts with existing commitments | EXISTS (part) — Start / End Break from the day overlay; Weekly Hours shows impact on booked appointments before saving |
| 08 | Last-Synced Status Show current last update and refresh/reconnect actions when live stream is delayed Feature preservation rule Every recommendation must add a clearly named option or module while preserving existing int | EXISTS — last updated + Refresh in the header; a past day never claims live counts (not-live) |
| 09 | Schedule Conflict Warning Mandatory feature #3: block unsafe changes, explain why, and offer only verified alternatives. TRIGGER WARNING / SAFE ACTION Booking overlaps booking Show both intervals and technician; offer va | EXISTS — Schedule Conflict Warning: every cause and alternatives; never books or moves anything itself |
| 10 | Service Skill Explanation Show why a candidate was or was not eligible; cite actual skill assignments | TODO |
| 11 | Conflict Impact Preview List customers, appointments and shifts affected before save | EXISTS — Weekly Hours / Block Time show affected booked appointments BEFORE saving; nothing is moved |
| 12 | Technician Day Notes Use existing authorized notes with audit and privacy guards | TODO |
| 13 | Activity history & pagination Distinguish event chronology from real appointment scheduling and maintain stable, useful pagination. • Maintain event categories: booking created/modified/cancelled, shift edits, break star | EXISTS — Schedule activity (booking changes, status, breaks, time off, blocked time, weekly hours) newest first with its own period, search and paging (activity-table) |
| 14 | Queue Fairness Indicator Explain when customer preference or rotation changes recommendation order | TODO |
| 15 | Live updates & race conditions The POS must update promptly without false availability, duplicate appointments or an unstable touchscreen UI. • Reuse current WebSocket/SSE subscriptions for bookings, shift edits, breaks, | NOISE — live-update / race requirements text (bookings protected by the exclusion constraint) |
| 16 | Visual Regression Suite Save before/after screenshots for real viewports and English/Vietnamese Prioritization recommendation Build screen fit and the three mandatory schedule features first. Then implement Health Checke | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 21 | Screen-fit acceptance matrix Claude must test the real application at 100% zoom and on the actual SUNMI hardware when available. VIEWPORT / STATE PASS CONDITION SUNMI 1920 x 1080 panel Actual browser viewport measured; s | NOISE — acceptance matrix instruction |

## Review Reputation (6)

| # | Recommendation | Status |
|---|---|---|
| 08 | External review provider and internal-feedback integration Inspect actual connectors; support only approved provider APIs and existing integration capabilities. • Inventory existing Google Business Profile, Facebook, Yel | TODO |
| 09 | Responsive screen states and component ownership Operating state Claude must test and implement SUNMI full-screen landscape Use available height below top bar; balanced peer cards and review work area. Browser 100% scale | NOISE — responsive state instruction |
| 10 | Custom From/To monthly calendar Provide a visible date-range control with a real month-view calendar opened by either date field. • Calendar displays month/year, previous and next month, weekday names, clickable dates, s | TODO |
| 16 | Fair post-visit review requests and marketing safeguards Review solicitation must be fair, policy-compliant, and controlled by the existing Communications system. • Eligible requests start from actual completed customer  | TODO |
| 17 | Recurring complaints and reputation analytics Enable evidence-based insights without claiming AI caused business improvement. • Use canonical review-count, rating-average, distribution, reply backlog, negative review cou | TODO |
| 20 | Final Claude execution mandate and definition of done CLAUDE: EXECUTE IN THE REAL AI POWERSALON REPOSITORY. First inspect the current code and database. Retain all original Review / Reputation Assistant modules (original | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |

## Stock Alerts  Technician Product Usage (10)

| # | Recommendation | Status |
|---|---|---|
| 01 | Header Title left / essential actions right; one compact row where space High: all controls reachable permits. | EXISTS — title left, actions right (refresh, export, settings) in one header row (POSInventoryAlertsScreen) |
| 02 | KPIs Five equal cards if all five metrics exist; otherwise 3 equal cards for Equal heights + weights the original three KPIs. | EXISTS — five equal KPI cards (kpi-open, kpi-critical, kpi-out, kpi-uses, kpi-techs) |
| 03 | Filters Search about 40% width; Date Range + Severity/Status + Branch Labels legible in EN/VN + Apply/Clear use remaining width; wrap intelligently. | EXISTS — search + severity + period filters with Clear (search, severity, clear-all) |
| 04 | Tabs Active Alerts / Product Usage / All Technicians / Alert History, same Never clip inactive tabs row. | EXISTS — Active Alerts / Product Usage / Technicians / Alert History views (tab state 'active'|'history'…) |
| 05 | Results One dominant data surface (table), bounded by available height. Allocate largest vertical area | EXISTS — one bounded list panel (sa-list FitPanel) |
| 06 | Footer Selection count + results + newest-first status + numbered pager. Stay visible Balanced space rules • Use a common 8 / 12 / 16px spacing rhythm, consistent card radii, baseline alignment, and matching card heights | TODO |
| 07 | Reorder / Receiving Safety Low-stock reorder recommendations vs on-order and actual received; no stock increase on draft PO. | EXISTS — reorder opens a draft purchase order; stock rises only on receiving (reorder / create-po) |
| 08 | Tenant / Permission Integrity Role checks; branch-scoped search/export; cross-tenant product, staff, customer and vendor data leak prevention. | NOISE — security audit instruction |
| 09 | Realtime / Freshness Data invalidation, last updated indicators, subscriber reconnect and offline pending entries. | BUILT — last updated indicator on Stock Alerts; a failed refresh keeps the last good time (alerts-fresh) (shared FinanceKit useFreshAt/FreshnessLine; components/FreshnessLine.test.tsx) |
| 10 | English / Vietnamese UI Translation coverage on tenant Front Desk POS only; text wrapping, date controls and labels remain accessible. Diagnostics must be read-only by default. Display exact source records, discrepancies | NOISE — translation instruction (EN/VI keys present) |

## Full-System Engineering Upgrade (32)

| # | Recommendation | Status |
|---|---|---|
| 01 | Very Important: Use the Recommended Option For ordinary technical decisions, do not stop development to ask me which implementation I want. When multiple reasonable technical approaches exist, use the recommended option  | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 02 | Never Blindly Rewrite My System Before creating anything new, search the repository. Do not create: | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 03 | Tenant isolation AI PowerSalon / Full System Run, Audit, Repair, Wiring & Completion Mandate | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 04 | Financial correctness | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 05 | Data integrity | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 06 | Server authority | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 07 | Backward compatibility | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 08 | Simplicity | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 09 | Maintainability | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 10 | Performance | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 11 | Scalability | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 12 | Operational reliability Use the safest production-quality option and continue. Document the decision afterward. Only stop and ask me when the decision requires something that cannot safely be inferred, such as: Productio | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 32 | Recommended Fair Turn Defaults Use: Mode RECOMMEND_AND_CONFIRM Fairness WEIGHTED TRADITIONAL ROTATION Clock-In JOIN_BACK Skill-ineligible skip KEEP POSITION Customer requests another technician KEEP POSITION | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 33 | Fair Turn Eligibility Before ranking: employment active correct tenant correct branch clocked in working shift skill eligible not serving not unavailable not on protected break appointment safe | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 34 | Fair Turn Must Be Explainable Every automatic/recommended decision must have: selected technician candidate ranking reason skipped technicians AI PowerSalon / Full System Run, Audit, Repair, Wiring & Completion Mandate s | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 35 | Time Clock Test: Clock In Break Start Break End Clock Out Server timestamps remain authoritative. | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 36 | Break vs Queue Hold Do not merge these concepts. BREAK = time/payroll event QUEUE HOLD = assignment availability state | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 37 | Workforce Scheduling Test: shift lunch breaks time off vacation unavailable blocks multi-branch assignment Booking and Fair Turn must use authoritative schedule state. | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 38 | Technician Profile Verify global professional identity is separate from tenant employment. Professional/portable: profile photo bio portfolio public skills public reputation Tenant-private: commission payroll manager not | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 39 | Skill Requests Verify: submit review approve reject AI PowerSalon / Full System Run, Audit, Repair, Wiring & Completion Mandate Technician cannot self-approve. Approved skill affects: booking eligibility queue eligibilit | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 40 | Technician App Run: Home Schedule Queue Tickets Service Customers where permitted Time Clock Earnings Tips Payroll Portfolio Ratings Skills Notifications Profile Settings Every screen must connect to real APIs. | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 41 | Service Workflow Test complete: ASSIGNED -> ACCEPT if required -> START SERVICE -> SERVING -> ADD / MODIFY AUTHORIZED ITEMS -> SERVICE DONE | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 42 | Service Done Service Done must produce/lock the appropriate operational financial snapshot. | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 67 | Gift Cards Test: issue load redeem partial redeem AI PowerSalon / Full System Run, Audit, Repair, Wiring & Completion Mandate refund multi-location history Use ledger. | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 68 | Membership Verify: purchase renew cancel benefit checkout application branch rules as implemented. | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 69 | Deals / Promotions Run: eligibility date rules branch rules service/product rules stacking checkout Do not implement discount formulas only in frontend. 70. Twilio Inspect all SMS/Verify code. Business modules should use | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 71 | Tenant Twilio Routing Verify: Tenant A -> Twilio A Tenant B -> Twilio B No cross-tenant SMS. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 72 | Communications Tests Run: OTP appointment confirmation reminder Check-In queue ready receipt review request marketing where allowed | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 73 | SMS Failure Twilio outage must not invalidate: AI PowerSalon / Full System Run, Audit, Repair, Wiring & Completion Mandate appointment payment checkout Communication retries independently. | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 74 | Customer Display Run dual-screen flow: Check-In Advertising Checkout takeover Tip Payment state Receipt Payment Complete 3 seconds clear customer state Advertising | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 75 | Customer Display Privacy Test After payment completion: verify previous customer's: name phone services total tip payment receipt is actually removed. Do not merely overlay advertisement. | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |
| 76 | Advertising | NOISE — a principle / test instruction from the full-system mandate, not a feature (the flows it names are run by the live pilot day, 242 checks) |

## Customer Queue (16)

| # | Recommendation | Status |
|---|---|---|
| 05 | Preserve the Current Modules • Top queue KPI/status cards • Live Customer Queue • Guest Flow Board • AI Guest Insights Claude Build Mandate / 2 AI PowerSalon / Customer Queue 27-Inch Touchscreen, Guest Flow & Assignment  | NOISE — preserve-modules instruction (registry gate) |
| 06 | Primary Hardware Certification Target • 27-inch touchscreen • 1920 x 1080 • 100% browser zoom • Microsoft Edge and Google Chrome • Browser tabs and address bar visible • Windows taskbar visible | NOISE — hardware target |
| 07 | Measure the Real CSS Viewport Use window.innerWidth, window.innerHeight, visualViewport where appropriate, and 100dvh. Do not assume the application receives the monitor's full physical resolution. | EXISTS — the shell reads innerWidth/innerHeight/visualViewport live (shell/displayProfile.ts) |
| 08 | Full guest and assignment overlay - additive recommendation Improve the operator drill-down without enlarging the main page or rewriting the Visit/Tech Queue domains. Guest row tap should open one responsive, viewport-co | TODO |
| 09 | Smart queue recommendations without automated harmful changes Recommendation layer is read-only by default; deterministic policy and staff approval remain authoritative. C. Smart Wait-Time / Priority and Technician Recom | TODO |
| 10 | Backend safeguards from original mandate - retain all UI redesign must not weaken operational correctness, financial boundaries or tenant isolation. Non-negotiable Engineering acceptance rule Canonical Visit One check-in | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 11 | Viewport Height Budget • POS header ~48-52 px • Customer Queue title/filter row ~42-48 px • KPI row ~64-74 px • Primary operational row ~155-175 px Claude Build Mandate / 3 AI PowerSalon / Customer Queue 27-Inch Touchscr | NOISE — height budget blueprint |
| 12 | Page Container .customer-queue-page { height: calc(100dvh - var(--pos-header-height)); overflow: hidden; } /* Nested grid/flex children */ min-height: 0; min-width: 0; | NOISE — illustrative CSS |
| 31 | Assignment Backend Authority Frontend may display/recommend, but the backend must revalidate tenant, branch, Visit state, technician eligibility, Fair Turn policy, schedule, skills, and conflict at commit time. | NOISE — rule (backend revalidates) |
| 32 | Assignment Concurrency • Two receptionists assigning the same guest simultaneously: one succeeds, the other gets stale/conflict. • Two guests assigning to a single-capacity technician simultaneously: only one conflicting | EXISTS — two terminals assigning the same guest: one wins, the other gets 409 (live pilot day) |
| 33 | Exact-Service Eligibility A technician qualified for Gel Manicure is not automatically qualified for Acrylic Full Set. Use the shared exact-service eligibility authority. | EXISTS (part) — exact-service eligibility (technician service eligibility, migration 583/631) |
| 34 | Appointment Protection NOW + estimated service duration + cleanup / buffer <= next protected appointment | EXISTS (part) — appointment protection via the exclusion constraint and the booking engine |
| 35 | Guest With Multiple Services Determine whether one technician performs all services or services are intentionally split across technicians. Do not falsely mark a technician eligible for all requested services because the | TODO |
| 36 | Waiting Time • Use server-authoritative timestamps. • Frontend may animate elapsed wait, but business truth comes from the backend. • If thresholds exist, show normal/warning/critical using text/icon plus color. | NOISE — rule (server timestamps) |
| 37 | Queue Trend Today Keep the chart compact (roughly 115-135 px total card height). This is an operational page, not a full analytics report. | EXISTS — Queue Trend Today compact card (cq-ana-queue-trend-today, registered) |
| 38 | Customer Type Mix Use a compact mix (Returning/New/VIP or the actual configured categories) with a small donut + legend or equivalent. Claude Build Mandate / 6 AI PowerSalon / Customer Queue 27-Inch Touchscreen, Guest Fl | EXISTS — Customer Type Mix compact card (cq-ana-customer-type-mix, registered) |

## Account Claude Guide (4)

| # | Recommendation | Status |
|---|---|---|
| 02 | Exact screenshot inventory: eight summary cards Your screenshot shows eight KPIs across a very compressed row. Preserve all eight, but redesign to provide readable space and consistent proportions. CARD SHOWN SCREENSHOT  | NOISE — screenshot inventory |
| 15 | Account Finder and controlled search The user requested search by phones and names. Make search useful, permission-sensitive and contextual. Do NOT create one unscoped search across all salons. • Add an Account Finder th | TODO |
| 23 | Twelve additional recommendations tailored to AI PowerSalon • 1. Account Completion Assistant: explain missing fields, verification state and safe next action before displaying “100%”. • 2. Account Integrity Health Check | NOISE — recommendations list heading |
| 24 | Implementation order for Claude PHASE WHAT MUST BE VERIFIED AND DELIVERED P0 - Repository audit Locate route/UI/backend/data/migrations/auth; map every observed card, panel, sidebar route and data owner; capture baseline | NOISE — implementation-order table |

## AI Marketing Assistant (18)

| # | Recommendation | Status |
|---|---|---|
| 01 | Active Campaigns Preserve status definition, scoped counts and original display card. | EXISTS — the seven photographed cards kept, each over a period with one event time (POSAIMarketingScreen) |
| 02 | Scheduled Preserve approved future scheduling state and active filters. | EXISTS — cards kept with their period filters |
| 03 | Drafts Include saved AI/user drafts only; no invented drafts. | EXISTS — drafts are Campaign Center's stored drafts only |
| 04 | Messages Sent Distinguish submitted, sent and delivered using canonical message events. | TODO |
| 05 | Bookings Deduplicate campaign-associated bookings and preserve attribution window. | TODO |
| 06 | Associated Rev Use Checkout/Reports values; associated does not imply caused revenue. | EXISTS — the page labels revenue "associated, not caused" |
| 07 | Cost / Booking Divide actual attributable cost by qualifying bookings; N/A for zero denominator. All existing modules beside the cards • Reach & Consent: Opted in to SMS, Opted in to Email, Suppressed (opted out), Messag | EXISTS (part) — message cost is the provider cost of messages actually sent, budgets shown apart; N/A rules on ratios |
| 08 | Budget variance monitor Compare estimated vs actual billable segments/fees and flag overrun. | EXISTS (part) — campaign budgets shown separately from actual message cost |
| 09 | Delivery failure triage Identify provider readiness, invalid contact, webhook delays and retry status. | TODO |
| 10 | Source verification Click KPI or result to open existing authorized source; do not create a new ledger. | TODO |
| 11 | Campaign approval timeline Versioned audit of reviewer, content, audience, channel and cap. | TODO |
| 12 | Permission-safe branch comparisons Owner-authorized aggregated metrics; distinct tenant recipient lists remain separated. | TODO |
| 13 | Accessible operator mode Touch targets, keyboard/focus, readable status descriptions and optional density settings. | NOISE — accessibility instruction |
| 14 | Read-only performance telemetry Log frontend render and queue latency by tenant safely, excluding PII. AUDIT FIRST / PRESERVE ALL MODULES / APPROVED SENDS ONLY ADDENDUM PAGE 18 AI POWERSALON / AI MARKETING ASSISTANT SUNM | NOISE — telemetry instruction + audit-first heading |
| 17 | Multi-branch intelligence and strict tenant isolation Owners may manage multiple locations, but that does not create platform-wide permission. Cross-branch and cross-tenant aggregation must follow existing explicit owner | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 18 | AI gateway, data pipeline and persistence Preserve the platform stack (React/NestJS/PostgreSQL/Redis/object storage/queue/AI Gateway) where confirmed by the repository. This document specifies logical roles, not assumed  | NOISE — platform-stack guidance |
| 21 | Exact implementation priority order Follow this sequence to avoid building attractive UI on top of incorrect consent, unverified data or disconnected campaign services. | NOISE — implementation order |
| 22 | Definition of done and final Claude response Do not claim completion until the work is actually integrated into the existing repository and the following acceptance criteria have been verified or explicitly recorded as b | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |

## TRANSACTIONS (13)

| # | Recommendation | Status |
|---|---|---|
| 01 | Transaction Source Explanation Show a concise definition popover for Transactions, Gross, Tips and Net, citing which payment states and sources are included. | EXISTS — the four KPIs each carry their definition (POSTransactionsScreen) |
| 02 | Provider Status Timeline In Details, display requested → authorized → captured → settled/refunded only for actual provider-confirmed events. | BUILT — Transaction detail → Payment timeline (server: recorded payment / refund / settlement / deposit times only; pgtest 14/14) — PaymentTimeline |
| 03 | Safe Duplicate-Payment Review Warn on duplicate external references, repeated callbacks and conflicting payment attempts without | TODO |
| 04 | KPI cards Transactions, Gross, Tips, Net with correct period/filter labels and backend-derived values. Date presets and calendars Today / This Week / This Month / This Year / Custom Range; From Date and To Date month pic | EXISTS — Transactions · Gross · Tips · Net from the server over every matching tender with period / filter labels |
| 05 | Refund Eligibility Preview From Details, preview eligible remaining refundable amount and direct users to the existing authorized refund workflow. 6. “Data Last Verified” Indicator Add subtle freshness messaging when tra | EXISTS — details overlay shows refunds and what is still refundable, with the existing guarded refund |
| 07 | Sticky Ledger Header and Footer Keep headers and pager visible while rows scroll inside the bounded central work area. These are additions or improvements. Audit the repository first; if equivalent features already exist | TODO |
| 08 | Customer & Ticket Context Preview Show compact authorized customer identity and ticket details without requiring many page changes. | EXISTS (part) — details: the tender, its ticket's lines / tenders / tips |
| 09 | Payment Method Explanation Separate tender type from capture channel, so Clover Compact and Tap to Pay do not appear to be different financial tender currencies. | TODO |
| 10 | Export Scope & Privacy Preview For existing exports, display selected dates/filters, records and role-based masking before the user downloads. | BUILT — Export opens a scope & privacy preview: server record count for the same filters, period + date basis, active filters, masking, 20,000-row cap note; nothing generated until Download (components/ExportPreview.tsx; POSPaymentsScreens.test) |
| 11 | Localized Empty and Error States Add clear English/Vietnamese text for no transactions, no matches, unavailable provider status and retry; never fabricate $0.00. | EXISTS — EN/VI empty / error states behind t() |
| 12 | Reconciliation Shortcut Open verified related settlement or deposit details without inventing a connection from matching amounts. | EXISTS (part) — the settlement is shown only when linked |
| 13 | Transaction Trend Mini-Summary Optional small period comparison if data exists. Keep compact and never displace main ledger or KPIs. | TODO |
| 14 | Search Result Type Indicators Label matched source as Ticket, Payment, Customer or Refund so staff can distinguish similar identifiers. Never enable unapproved money movement, alter revenue calculation rules, or remove e | TODO |

## AI Receptionist (10)

| # | Recommendation | Status |
|---|---|---|
| 01 | Auto-Fit Display Health Indicator Non-invasive display diagnostics available to authorized staff: actual viewport, overflow hotspots, sidebar/keyboard collisions, and test timestamp. UI adapts; a health badge alone is no | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Voice-to-Booking Accuracy Trace Click a call and follow call ID → requested service/time → Booking API response → pending/confirmed record → customer notification, without creating a duplicate booking ledger. | EXISTS — call overlay follows the call to appointments, follow-ups, handoffs and AI actions with Open Booking (rcp-overlay, rcp-ov-book) |
| 03 | Call Recovery Worklist Highlight missed/failed/repeat calls with responsible owner, urgency, first-contact time and safe follow-up controls; managers approve outbound contact. | EXISTS — priority list: urgent + oldest first; Front Desk prepares a follow-up, owner/manager confirms (rcp-priority, rcp-prepare, rcp-confirm) |
| 04 | AI Agent Capability Matrix Display, for each agent, what is Configured, Tested, Active and Allowed: hours, services, availability, booking, reschedule, cancel, SMS and handoff. | TODO |
| 05 | Automatic Layout Regression Tests Capture current view and touch interactions for 1920×1080, effective CSS viewport variations, EN/VN text, keyboard open, modals and tablet-like narrower widths. These five additions are  | NOISE — layout regression test instruction (tooling/e2e/pos-vi-one-screen.mjs) |
| 06 | Verified Receptionist Readiness Display timestamped configuration, last successful provider check, actual test call, Timeline activation actor and last operational failure; show separate stages. | EXISTS — stage ladder Not configured → Configured → Ready for test → Test-call verified → Live, with last check time (rcp-live, rcp-last-check, rcp-check) |
| 07 | Human Handoff SLA & Escalation Warn about failed transfers or unassigned callbacks; expose time waiting and one-click Assign to Receptionist, without auto-changing booking state. | EXISTS — handoffs shown as requested / attempted / completed / failed in the call overlay; priority list surfaces unresolved ones |
| 08 | Consent-Safe Call Insights Surface common question categories and service interests only from permitted and retained call data; redact unnecessary PII and label AI-derived summaries. | TODO |
| 09 | Billing & Call Usage Reconciliation Compare provider minutes/invoices to unique call IDs and AI usage events; flag unmatched usage, retries and unexplained charges for owner review. | TODO |
| 10 | Agent Rollout and Safe Kill Switch Feature-flag activation per tenant/branch, status acknowledgment, rollback to original handoff-only process, and immediate disable of voice tool execution when safety checks fail. Human | EXISTS — owner/manager controls: arm booking actions, verify test call, activate — gated with reason and history (rcp-controls, rcp-arm, rcp-activate, rcp-ctl-history) |

## Expenses Management (12)

| # | Recommendation | Status |
|---|---|---|
| 01 | Smart expense attention bar Small alerts for missing receipts, incomplete categories, overdue reviews, duplicate risk. Opens existing detail views. | TODO |
| 02 | Receipt-to-expense Suggest links for uploaded receipts and invoices using existing backend data; require user matching confirmation. | TODO |
| 03 | Expense approval queue If supported by policy, add an owner/manager review state without overwriting current expense posting semantics. | EXISTS — pending_review state with Approve / Void for approvers (act-approve, canApprove); posting semantics unchanged |
| 04 | KPI cards Total Expenses; Expense Entries; Top Category; Categories Used. Preserve click-through if implemented. Expense work area Search; category/method filters; sorting; expense table; record counts; loading/empty/err | EXISTS — KPI cards Total Expenses / Entries / Top Category / Categories Used (finance.ex.kpi.*) with search, category/method filters, sort |
| 05 | Better vendor lookup Tenant-scoped vendor suggestions using canonical vendor IDs; do not create duplicates from similar names. | TODO |
| 06 | Monthly spending trend Compact drill-down in reports or overlay; use actual filtered data, not default fake charts. | TODO |
| 07 | Duplicate guard before save Warn for matching vendor/date/amount/receipt hash but allow authorized resolution and audit it. | EXISTS — duplicate detection on save (finance detectExpenseDuplicates, duplicate_status possible/exact, override needs a reason) — each decision now shows in the expense History |
| 08 | Receipt/OCR confidence Clearly separate “suggested by OCR” from “verified by staff”; never silently post. review | EXISTS — receipt upload goes to the Receipt AI review queue; nothing posts without a person (POSExpensesScreen upload → /tenant/ai/ocr-receipt) |
| 09 | Export quality preview Preview date scope, counts and columns; protect CSV and PII before generating. | TODO |
| 10 | Accessible bilingual Use current Front Desk EN/VN localization with robust text growth, no hardcoded English controls placeholders. | EXISTS — every control behind t() with EN/VI (pos-i18n gate: no raw JSX text), Vietnamese harness certified |
| 11 | Safe multi-branch view Owners see only authorized branches; per-branch scope follows existing permissions and reporting definitions. | TODO |
| 12 | Layout density setting Optional Compact/Comfortable for staff only if all essential controls remain readable and current global system supports it. NEW INSTRUCTIONS / Original 18-page expenses guide preserved after this  | BUILT — opt-in Compact spacing per device (profile menu → Compact spacing; Standard = certified default; gaps/padding only, never fonts or touch targets) — shell/spacingPref.ts + spacingPref.test 2/2 |

## PHONE NUMBER MANAGEMENT 4 (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-Click Phone Verification Health Checker: read-only tenant Twilio, Verify, policy, recent errors, sync lag and API status with evidence and remediation. | EXISTS — Check Verification Health + Verification & Synchronization Health panel (PhoneManagementCenter) |
| 02 | Full Customer Phone Change Overlay: two-pane touch-friendly current/pending identity, code entry, countdown, request history and explicit Close. | EXISTS — change overlay: trusted vs proposed, six-digit progress, notice, history, Close; nothing unverified becomes trusted |
| 03 | Pending & Recovery Center: actionable outstanding requests, failed/expired reasons, safe resends, manager review and priority sorting. | EXISTS — Pending & Recovery, soonest deadline first |
| 04 | Data Synchronization Monitor: distinguish tenant-active from platform-synced; expose retry backlog, revision conflicts and idempotent resolution. | EXISTS — Sync Monitor |
| 05 | Duplicate and Family Identity Guard: proactively identify shared contacts and show an “individual profiles remain separate” reminder before a change. | TODO |
| 06 | Suspicious Number Change Review: flag unusually frequent changes, cross-device patterns and multiple failed codes; route to authorized risk review, not automatic user lockout without policy. | TODO |
| 07 | Old-Number Security Notification: preserve configured notices, indicate actual send status and give an unauthorized-change reporting path. | TODO |
| 08 | Draft and Session Recovery: preserve safe form input across refresh; never store raw OTP in local storage or revive a superseded server request. | EXISTS (part) — filters and page are kept in the URL across refresh; codes and search text never stored |
| 09 | Screen Fit Diagnostics: development-only overlay showing CSS viewport, device pixel ratio, container width, overflow indicators and current responsive breakpoint; never expose diagnostics to ordinary staff by default. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 10 | Effective Policy Explanation: explain whether a setting is inherited, tenant-selected or overridden by Super Admin, without changing it implicitly. | TODO |
| 11 | Change Audit Timeline: show Requested, SMS Sent, Verified, Applied, Synced and Security Notice events with verified timestamps and sanitized provider references. | EXISTS (part) — Phone Change History newest first with period and date basis; the overlay shows the change's history |
| 12 | Safe Reverification on Changed Contact: require future Booking and identity workflows to distrust old-phone OTP proof for the new destination. | TODO |
| 13 | Searchable Monthly Reporting: request counts, verified changes, failed attempts, shared contacts and pending sync by branch and date, with documented denominators. | EXISTS (part) — history with presets / From–To and date basis, numbered pages; no monthly summary report |
| 14 | Accessibility and EN/VN Regression Gate: automated checks for focus, contrast, full translated labels, calendar keyboard navigation and 44px touch controls. | EXISTS — EN/VI behind t(); harness certified |
| 15 | Safe Sync Replay Tool: owner/operations-only idempotent replay for eligible outbox events with dry-run preview, immutable audit and no unreviewed batch rewrite. | TODO |
| 16 | Rollout Guardrails: feature flag, pre/post screenshots, monitoring thresholds, reversible schema rollout and explicit rollback procedure if verified-contact invariants fail. Reasonable implementation ordering Treat recom | NOISE — rollout guidance |

## TIPS  GRATUITY (12)

| # | Recommendation | Status |
|---|---|---|
| 01 | Technician Earnings Overlay Clickable allocated/pending/paid details tied to tickets and approved paycheck records. | TODO |
| 02 | Tip Split Preview Before confirming an authorized split, display exact cents per technician and rounding remainder. | TODO |
| 03 | Duplicate Tip Warning Flag same event/transaction processed twice without silently deleting financial history. | TODO |
| 04 | Cash Tip Source Labels Distinguish drawer-collected cash from cash handed directly to technician. | EXISTS (part) — the tips summary separates card and cash tips (Team → Tips; Reports tips) |
| 05 | Refund Impact Preview Explain whether a reversal affects collected total, allocation and payable. | TODO |
| 06 | Tip Discrepancy Inbox Queue evidence-based mismatches for managers; no automatic ledger edit. | EXISTS — evidence-based mismatch flag + filter chip; no automatic ledger edit, adjustments need a reason (mismatch-flag, mismatch-chip, adjust-reason) |
| 07 | Smart Search Shortcuts Locate tip via ticket, phone, technician or payment ID with exact matches first. | BUILT (part) — Team → Tips: find a technician by name (accent-free) in the period's full list (tips-search); ticket / phone / payment search not built |
| 08 | One-Tap History Open complete transaction audit and payout chronology inside an accessible panel. | EXISTS — tip detail panel with allocation and adjustment history (tip-detail, alloc-table, adjustments-table) |
| 09 | Time-Basis Badges Explain Tip Collected Date vs Allocation/Payout Date to prevent misleading comparisons. | BUILT — Team → Tips states its time basis: the day the payment was taken (salon day), not allocation / payout day (tips-basis); test |
| 10 | Source-of-Truth Labels Display when values are verified, pending sync, adjusted or unavailable. | TODO |
| 11 | Verified CSV/PDF Exports Use ledger-backed filtered result sets and protect spreadsheet formula injection. | EXISTS — ledger-backed filtered CSV with scope header, masked contacts, audited; cells starting = + - @ are neutralised (finance-scope.ts csvCell, tips-screen.repository exportCsv) |
| 12 | Regression Snapshot Tests Guard module count, chart/cards/table balance and important workflows across deployments. Prioritize recommendations 1–6 for tip accuracy and staff trust; 7–12 for usability and operational dura | EXISTS — module registry + harness screenshots |

## Rebooking Opportunities (10)

| # | Recommendation | Status |
|---|---|---|
| 01 | Scope Start from authenticated tenant and allowed branches. Match canonical customer ID. | EXISTS — tenant + authorized-branch scope (rebooking-center.ts scope / branchScope) |
| 02 | Data sufficiency Require configured minimum history. Otherwise Insufficient History, not strong prediction. | EXISTS — Insufficient History tab below the cadence minimum (rebooking-center.ts RB_TABS 'insufficient') |
| 03 | Auto-fit Web POS shell: all screens, not one screenshot Global layout contract • Retain existing top bar and side navigation; make the main content a fluid child using flex: 1 and min-width: 0. Avoid fixed widths that ov | NOISE — shell layout contract text |
| 04 | Upcoming booking Find relevant future appointments; classify confirmed, pending, other service, canceled and unavailable distinctly. | EXISTS — upcoming booking suppression + booked tab (has_upcoming, ov-booking) |
| 05 | Catalog check Check recommended service is active, branch-available, and has current approved price/duration. | EXISTS — service price/duration shown only while the service is active (rebooking-center.ts service_active) |
| 06 | Deduplicate One active opportunity per canonical customer/service/appropriate evaluation window unless existing model explicitly differs. | EXISTS — one opportunity per customer from the single Customer Intelligence snapshot; new opportunity keyed by rebooking_since (765_rebooking_center.sql) |
| 07 | Explain Store/return source references, rule version, calculated window, caveats and evaluation time. | EXISTS — evidence, inputs, window and caveats in the overlay (ov-evidence, ov-inputs, ov-window, ov-caveats) |
| 08 | Review Opportunity becomes a staff-review item, not a preauthorized appointment. Distinguish business states Opportunity created means advisory analysis exists. Booking started means a human entered the Booking Assistant | EXISTS — staff review (mark reviewed / defer / reopen); booking only via the Booking Assistant (rbx-mark-reviewed, rebooking_review_events) |
| 11 | Helpful status/empty/error states and accessibility Situation Truthful screen behavior Initial page Explain the basic Search or load an authorized default queue if existing policy permits; avoid a meaningless giant blank | EXISTS — loading/notice/unavailable/empty states (rbx-loading, rbx-notice, rbx-unavailable) |
| 17 | Build order and evidence Claude must provide Phase Concrete work Exit evidence 0 — Audit and Locate route, shell, all nested modules, CSS, APIs, worker Preservation matrix and 100% zoom baseline jobs, integrations, tests | NOISE — build-order table heading |

## Customer Displays (1)

| # | Recommendation | Status |
|---|---|---|
| 31 | Copy-ready final instruction for Claude Claude, modify my existing AI PowerSalon codebase - do not rebuild the application. Read this entire PDF and inspect the three provided reference images. The route is /tenant/devic | NOISE — copy-ready instruction text |

## MONEY PROTECTION ALERTS (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | SUNMI display target and what “100% fit” means The provided reference is a physical-dimensions illustration of the SUNMI FLEX 3 in 27-inch landscape orientation. It is not a screenshot of the running POS or a measurement | NOISE — display target explanation |
| 02 | One-click layout diagnostics Authorized debug tool records viewport, overflow elements and problem panel IDs, with no PII. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | Status/freshness strip Show last successful rule run and source feed readiness separately from zero-alert count. | EXISTS — the overview says whether monitoring is current / stale / never ran, separate from zero alerts (MoneyProtectionWorkspace) |
| 04 | Even KPI/summary sizing Use aligned, equal-height cards that wrap without clipping or oversized whitespace. | NOISE — card sizing guidance |
| 05 | Saved filter views Allow role-safe personal presets (New, High, Unassigned, My Branch) without changing active detection rules. | BUILT — POS saved views (migration 844, pos/me/saved-views, components/SavedViews); pgtest 6/6, component 4/4 |
| 06 | Combined smart search Search IDs/name/phone/source reference with masked results and strict tenant scope. | EXISTS (part) — alerts search with filters, tenant-scoped |
| 07 | Alert list, severity filter and workspace flow The original uploaded guide shows an existing Severity = All control and an empty-state screen. Preserve both. Enhance with real data, not a replacement mockup. Page-level o | EXISTS — alert list with severity filter, presets + From/To calendar, sort, numbered pages |
| 08 | Pinned action row Keep Refresh and Health Check accessible in long scroll states, without overlaying content. | BUILT — Run detection / Check row is sticky inside the screen scroll area (not an overlay) on every Money Protection tab (mpx-pinned, styles.css .mpx-pinned) |
| 09 | Evidence overlay, investigations and no-money rule The central safety distinction: an alert is a possible discrepancy. It is not a verified loss or accusation. Money Protection Alerts is a triage/investigative interface, | EXISTS — alert evidence overlay; acknowledge / dismiss (reason) / reopen; nothing here moves money |
| 10 | One case per incident Use idempotency/reuse to prevent duplicate Investigation cases from repeated clicks. | BUILT — opening a case for alerts already in one case returns that case instead of a duplicate (investigations.service create; investigations.vitest.spec) |
| 11 | False-positive review insights Show repeated patterns and human feedback; never self-disable monitoring rules. | TODO |
| 12 | Performance, reliability and state recovery An attractive responsive page is not complete if it stalls under large salons, heavy alert histories or degraded provider data. • Use server-side paging and indexes, bounded qu | NOISE — reliability guidance |
| 13 | Batch triage preview Where permissions allow, preview actions and require user confirmation; no bulk payout or charge actions. | TODO |
| 14 | Freshness-aware exports Export only authorized source-linked records; include as-of time, active filters and masking. | TODO |
| 15 | Offline-safe reliability Preserve last-known information with obvious Stale/Unavailable warnings and Retry. | TODO |
| 16 | Automated visual regression Use screenshots/diffing at actual SUNMI viewport and smaller windows for every release. Money Protection Alerts / SUNMI FLEX 3 27-inch / Preservation-first Addendum page 14 AI POWERSALON / CLA | EXISTS — certified harness screenshots EN + VI |

## REFUNDS  VOIDS (17)

| # | Recommendation | Status |
|---|---|---|
| 01 | Purpose, source priority and boundaries This update supplements the original Refunds & Voids Complete Build Guide (18 pages). Its core goal is automatic screen-fit and proportional module layout on the SUNMI FLEX 3 while | NOISE — purpose / boundaries text |
| 02 | Device reference and automatic viewport detection Reference Device requirement Screen SUNMI FLEX 3; 27-inch landscape; 1920 × 1080 physical display; 16:9. Physical unit Approx. 646 mm wide × 384 mm high × 29.8 mm thick ( | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | Smart Duplicate Warning Warn on same original tender, amount, operator, reason or provider reference; block true idempotent duplicates. | TODO |
| 04 | Partial Refund Allocation Review Require staff to confirm which original card, cash, gift card or other tender receives each refund amount. | EXISTS — Find Original Payment lists each captured tender with refunded / pending / refundable and why an action is off; a refund targets ONE chosen tender (POSRefundsVoidsScreen) |
| 05 | Refund Receipt Preview Show proposed customer receipt and final confirmed result; do not send a completed receipt before confirmation. | TODO |
| 06 | Escalation Inbox Group provider timeouts, stale pending refunds and broken cross-module links for managers to review. | TODO |
| 07 | KPI definitions: show real money, not optimistic guesses Preserve original financial meanings from the source guide (original page 9). The page cannot claim a refund or void completed until its authoritative lifecycle co | NOISE — KPI meaning rule (preserve original definitions) |
| 08 | Cross-Page State Synchronization Use existing app cache invalidation / WebSocket or SSE after confirmed status changes; do not invent duplicate engines. | TODO |
| 09 | Export Reconciliation Report Add permission-controlled export of all matching reversal records, exception reasons and linked references, with PII minimization. | EXISTS — permission-gated CSV of all matching reversal records with the scope block and formula-safe cells (refunds-voids-screen.repository exportCsv, csvDocument) |
| 10 | Exception Root-Cause Advisor AI summarizes evidence from the shared ledger but never changes status or retries refunds itself. | TODO |
| 11 | Partial refunds, concurrent attempts and idempotency The available refundable amount must be calculated against the specific original tender and all completed reversals plus active reservations. Include controls against  | EXISTS — refundable is per original tender (what each can still return); refunds go through the existing claim-first, idempotent Checkout routes |
| 12 | EN/VN Layout Regression Tests Verify available English/Vietnamese POS translations, longer labels and accessibility on the same screen. | EXISTS — EN/VI behind t(); Vietnamese harness certified for Refunds & Voids |
| 13 | Recovery After Browser Reload Reopen pending request state without allowing staff to fire another payment operation accidentally. | EXISTS (part) — refund / void calls are claim-first and idempotent server-side, so a reload cannot fire a second operation; the pending state shows in the ledger |
| 14 | Release-Time Module Registry Diff Record every existing module/CTA before and after, with any missing action treated as an implementation regression. Claude engineering addendum · Original 18-page guide follows unchanged | EXISTS — module registry diff gate (check:pos-module-registry + preservation matrix) |
| 16 | Additional recommendations — operational quality | NOISE — heading |
| 22 | Final module preservation + handoff checklist • Original 3 KPI cards, plus additional Pending and Needs Review if supported, display validated totals and click-through scopes. • Main Find Original Payment path, universal | NOISE — handoff checklist |
| 26 | API contract: intent, not a forced rewrite Discover and reuse existing API conventions. If endpoints must be added, implement equivalent contracts with backend-enforced tenant identity, roles and validation; never trust  | NOISE — API-contract guidance |

## Reception POS (4)

| # | Recommendation | Status |
|---|---|---|
| 05 | Responsive CSS / React implementation examples These are illustrative patterns, not instructions to paste over existing components. Claude must find the actual layout primitives and reuse them where possible. /* Example: | NOISE — illustrative CSS/React examples |
| 11 | Verified status, heartbeat and operating health The user-facing 0 connected must come from verified device connectivity data, not an assumption based on empty UI state. If the page loads zero rows, trace the actual fetch | TODO |
| 20 | Roles, privileges, tenant isolation and auditing Actor Permitted actions (server policy always authoritative) Receptionist View authorized station status, use assigned POS; no global device approval by default. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 22 | Conceptual APIs, data and events - adapt, do not duplicate Use these only as capability contracts; they are not assertions about existing API names. Claude must inspect actual controllers, DTOs, policies, database struct | NOISE — conceptual API contracts text |

## Customer AI Settings 6 (10)

| # | Recommendation | Status |
|---|---|---|
| 01 | Truthful Operational State Matrix One compact state summary distinguishing salon preference, policy, entitlement, Gateway and worker readiness; clicking reveals authoritative source and timestamp. | EXISTS — status strip separates salon switch, package/subscription, effective-for-session and whether evaluations used the current values (casx-strip, casx-salon, casx-package, casx-effective, casx-propagation) |
| 02 | Policy Provenance Inspector An expandable “Why this value?” link for each of five thresholds, showing policy source, scope, version and last applied time without exposing secrets. | EXISTS — per-threshold provenance: value, default, which level set it, allowed range, last change (casx-th-reason, casx-last) |
| 03 | Config Drift Alert Non-mutating detection of discrepancies between settings resolver and Churn Watch/Rebooking/Customer Intelligence consuming an older version. | TODO |
| 04 | Change Impact Preview Authorized preview estimates the count and type of affected customers, explicitly labels uncertainty and never commits or triggers messages. | EXISTS — read-only impact preview before saving thresholds, labelled (casx-preview, casx-preview-note) |
| 05 | Propagation Timeline Visual read-only event trail for saved/queued/processing/applied/delayed/failed across existing workers, with source-linked diagnostics. Recommendations must be integrated only after discovering exis | EXISTS — history detail shows whether evaluations picked the change up (casx-event-propagation) |
| 06 | Safe Change Review A reusable confirmation summary shows previous/proposed state, role, salon and effects; blocks stale-version changes and accidental double taps. | EXISTS — confirmation names salon, change and role; version-checked save (casx-confirm, casx-confirm-text) |
| 07 | Responsive Module Health Scan Developer-only viewport assertions log overflow/collision at agreed breakpoints; no page-scale zoom or hidden overflow as a substitute for real layout. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 08 | Guided Empty and Restricted States Distinct legitimate empty, unauthorized, disconnected, stale, not entitled and missing-data states, each with a precise safe next action. | TODO |
| 09 | Contextual Customer Impact Shortcut For authorized roles, link an effective threshold into its existing Customer Search or related module via verified context and permission checks. | TODO |
| 10 | Change-Event Diff View A clean side-by-side before/after overlay with source links, actor and version for authorized audit reviewers, without editing historical events. Implementation priority P0: preserve and verify exi | EXISTS — history detail overlay with before / after (casx-event, casx-before, casx-after) |

## AI Scheduling Optimizer (13)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-Click Scheduling Accuracy Health Checker: detailed source-of-truth reconciliation, exact cause, time and remediation. R02 “Why this opening?” explainer: service/skill, shift, break, hold and duration facts for every  | EXISTS — Check Scheduling System from the optimizer header (POSAISchedulingOptimizerScreen header: Check Scheduling System) |
| 03 | Before/After Impact Preview: proposed move, affected bookings/technicians, capacity and approval status. | TODO |
| 04 | Queue-Aware Gap Filling: link recommendations to actual customer waiting and approved queue fairness logic. | TODO |
| 05 | Schedule Freshness Indicator: source timestamps, delayed events, stale recommendation badge and recheck action. | TODO |
| 06 | Service Duration Confidence: show observed sample size and variability before managers adjust catalog timing. | TODO |
| 07 | Capacity Risk Heatmap: optional per-hour skill demand / safe staffing summary; never replace the canonical booking board. Rollout guardrails for all recommendations • Every new module is additive and optional. Keep origi | TODO |
| 08 | Manager Review Inbox: approve/reject eligible proposals with a reason and immutable audit trail. | EXISTS — staff review every recommendation; confirmed appointments also need customer approval; History = append-only event trail (Recommendations + Customer approvals + History tabs) |
| 09 | Multi-Branch Capacity Comparison: authorized owner sees branch-specific demand without tenant leakage. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 10 | 200+ Technician Roster Navigator: scoped search, skill filters, groups and bounded virtualization; retain 12-tech Booking paging. | TODO |
| 11 | What Changed? Activity Timeline: booking/shift/queue events that invalidate earlier AI suggestions. | TODO |
| 12 | Protected Saved Filters: authorized per-user preferred views, date filters and branch selection. | BUILT — POS saved views on the recommendation queue (components/SavedViews) |
| 13 | Read-Only Dry Run Mode: show recommendations and metrics without booking edits or billing actions outside current plan policy. | EXISTS — engine only proposes; every change is applied by the server through the booking service after review — no browser edits (POSAISchedulingOptimizerScreen header) |
| 14 | Visual Layout Health Check: capture viewport metrics and detect clipped buttons, unequal KPI heights and empty oversized panels. PROTECTED CODE BOUNDARY: Do not modify, refactor, migrate, reformat, regenerate or delete a | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |

## Appointment Reminders (4)

| # | Recommendation | Status |
|---|---|---|
| 01 | Remember last selected history/queue tab and non-sensitive date filters for each authorized employee. | BUILT — last queue/history tab + non-sensitive filters remembered in this browser tab (a link’s own ?tab wins; never phone/email/search text) (POSRemindersScreen; test) |
| 02 | Provide an accessible compact/wide density preference, never a page-wide scale-down. | EXISTS — profile menu → Compact spacing (this device): tightens spacing only, never a page-wide scale-down (shell/spacingPref.ts) |
| 03 | Provide contextual Help for Send Window explaining the verified existing behavior. | EXISTS — How it works line under the settings explains lead time + send window, the 5-minute run, reschedule/cancel and that a missed window is never sent late (rmc-semantics in POSRemindersScreen, matches reminders.service windowMs) |
| 04 | Add a one-click Screen Fit Health Checker and visual regression snapshots at different CSS viewports. Scheduling and delivery accuracy (5-8) | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |

## END-OF-DAY FOLLOW-UPS (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Settings integrity: saved tenant/branch values, effective inheritance and config version. | EXISTS — the seven original settings + Save kept (EndOfDayFollowUpSettings) |
| 02 | Scheduler registration: live worker heartbeat, last success, next local run and DST policy. | EXISTS — health check: generation runs + worker heartbeat staleness (eod-center.ts generation / 'worker has not checked in') |
| 03 | Generation correctness: eligible completed visits vs created tasks, duplicates and exclusions. | EXISTS (part) — Preview Tonight (read-only) and the generation run log |
| 04 | Follow-Up Queue connection: same canonical task IDs/counts across Settings, Queue and Technician App. | EXISTS — health check: queue awaiting approval with oldest (eod-center.ts key 'queue') |
| 05 | Expiry safety: 24-hour policy, backlog, stale messages and race handling. | EXISTS — health check: expiry policy (eod-center.ts 'expiry') |
| 06 | Technician notifications: routing, push/service status, last result and duplicate alerts. | EXISTS — health check: technician ready-list alerts in 7 days (eod-center.ts key 'tech_alerts') |
| 07 | Consent/suppression: opt-outs, quiet hours, already-rebooked cases and cooldown policy. | TODO |
| 08 | Messaging channels: effective tenant Twilio and email sender, verified callback health. | EXISTS — health check: channel = Customer App inbox; SMS/email shown as not used (eod-center.ts keys channel/sms/email) |
| 09 | Approval/replies: pending manager approvals, revision status and inbound conversation mapping. | EXISTS (part) — details overlay: approve / return with a note / send with an audited manager exception |
| 10 | Screen accessibility: viewport overflow, clipped controls, touch targets and localized label fit. Health result UX Every check shows Ready / Attention Required / Pending / Failed / Unknown, last verified timestamp, actua | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 11 | Opt-Out Integrity: block messages regardless of staff override; verify current consent at dispatch. | TODO |
| 12 | Provider Status Audit: distinguish accepted/sent/delivered/failure with webhook evidence. | NOISE — this workflow sends no SMS/email (in-app only), so there is no provider callback to audit |
| 13 | Technician Alert Dedup: one committed-ready-list notification per technician per run. | TODO |
| 14 | Customer Timeline: accessible task, message, reply, booking and verified outcome history. | EXISTS (part) — follow-up activity history (search, status, approval, technician, date basis, calendar, pages) |
| 15 | AI Copy Suggestions: optional respectful draft suggestions requiring authorized review; never automatic send by default. | TODO |
| 16 | Safe Rollback & Monitoring: feature flag, performance/error telemetry and testable rollback for each change. SUNMI supplement / Existing source guide appended without replacing pages 23 / 24 AI POWERSALON / END-OF-DAY FO | NOISE — rollout / monitoring guidance |

## Salon Locations (10)

| # | Recommendation | Status |
|---|---|---|
| 01 | Open: The existing + Add Location button opens a responsive full-screen modal / wizard or existing form. Preserve original required fields and validations; do not invent mandatory fields without verifying source rules. | EXISTS — + Add Location creates the branch, then the full location editor opens (TenantLocationsScreen; inline form, not a multi-step wizard) |
| 02 | Identity: Enter branch/salon name, code (if applicable), authorized manager/contact and existing tenant/parent branch context. Scope ownership server-side, never from a trusted client-supplied tenant_id. | EXISTS — name, public display name, salon code, manager fields (TenantLocationsScreen field list) |
| 03 | Address: Street address, unit, city, state/province, postal/ZIP, country, timezone. Existing provider autocomplete is optional but must not silently overwrite typed data. | EXISTS — street, line 2, suite, city, state, ZIP, timezone fields |
| 04 | Pin: Geocode address using the project’s configured map integration; show the address and pin side by side; allow drag/set pin manually; distinguish pin present, manager confirmed and system verification. | EXISTS — server geocode + pin confirm with manual lat/long fallback (locations/SalonLocationMapEditor.tsx) |
| 05 | Booking: Apply existing booking availability flags and business-hours rules. Never treat a pin as proof the salon is authorized to accept bookings. | EXISTS — online-booking toggle is separate from the pin (is_online_booking_enabled) |
| 06 | Save: Persist transactionally, return the authoritative location record and validation result, update counters and list, reset page to 1 under default “newest first” ordering. | EXISTS — save returns the authoritative record and refreshes the list (posLocationsApi update → onSaved) |
| 07 | Next actions: If draft or incomplete, show “Complete profile / Verify / Publish” as permitted next steps rather than fabricating a published state. Existing Edit & Map Pin button • Keep the exact visible Edit & Map Pin a | TODO |
| 09 | Add / Edit Location and map-pin workflow Create Location - step-by-step | NOISE — section heading |
| 13 | Responsive accessibility and performance checklist Area Definition of success Keyboard / touch Tabs, filters, date selectors, maps and dialogs work with keyboard + touch; logical focus order, Escape closes, focus returns | NOISE — checklist table heading |
| 14 | Three recommended intelligence safeguards These additions are recommended alongside the screen redesign, not as replacements for any existing modules. They must remain informational/permission-aware and never publish or  | NOISE — section heading |

## AI Front Desk (10)

| # | Recommendation | Status |
|---|---|---|
| 01 | Live Layout Diagnostic Show measured CSS viewport and identify any clipped controls, overflowing cards or keyboard interference without auto-changing settings. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Per-Agent Readiness Scorecard Separate configured, provider checked, voice route checked, booking checked, test call and owner activation. | EXISTS — verified states Setup required / Ready / Active / Degraded per agent; Active only when live AND the latest call reached the agent (POSAIFrontDeskScreen) |
| 03 | Agent Comparison Preview Compare an existing agent/draft and proposed changes side by side before saving or activating. | EXISTS — owner-approved activation preflight shows current vs proposed route, blockers and rollback destination |
| 04 | Routing Conflict Detector Flag duplicate use of a tenant phone number by multiple competing agents; prevent unsafe activation. | EXISTS — live routing monitor + activation preflight blockers for the number route |
| 05 | Conversation Sandbox Preview Allow safe simulated FAQ and policy tests without placing paid calls or making real bookings. | TODO |
| 06 | Knowledge Drift Check Detect changed hours, services or booking rules not yet reflected in an agent configuration. | TODO |
| 07 | Missed Call Recovery Queue Route unresolved/failed calls to an owner-approved callback and receptionist worklist. | TODO |
| 08 | Agent Performance Drill-Down Use verified calls/confirmed bookings and human handoffs, with clear date range and comparison basis. | TODO |
| 09 | Usage & Error Budget Alerts Detect quota pressure, webhook failures and unexplained provider charges; require human approval to spend. | TODO |
| 10 | Safe Rollout + Kill Switch Branch-scoped staged activation with explicit rollback and handoff fallback; preserve agent history and existing settings. All ten are recommendations. Claude must inventory existing features f | EXISTS — pause / resume / archive / rollback with owner-approved activation and rollback destination (agent profile overlay) |

## TEXT MESSAGING SETUP  SMS READINESS (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Account Provider auth and exact tenant account; never show saved secrets. | EXISTS — Account Credentials: the salon's own Twilio account; secrets write-only (masked last-4), validated with Twilio before saving (POSMessagingSetupScreen) |
| 02 | Sender Effective branch sender, provider capability and ownership. | EXISTS — Number Assignment and a branch's own Twilio beside the salon's (scope selector) |
| 03 | Registration Correct long-code or toll-free approval state and required actions. | EXISTS — Registration & Messaging Service section with the registration state |
| 04 | Inbound Signature enforcement, route config and last verified inbound event. | EXISTS — Inbound / Status webhooks section (signature-verified inbound) |
| 05 | Delivery Callback wiring, last provider-confirmed delivery and missing-event health. | EXISTS — test SMS reports Accepted until Twilio's signed callback says Delivered |
| 06 | Booking Verify Effective platform/tenant toggles and actual Verify Service availability. Additional recommended checks • Cost/usage limits and quota exhaustion based on configured real billing records. • SMS Inbox conver | EXISTS — Verify Configuration with a real Test Verify that booking verification waits for |
| 07 | Finish Per-branch summary of Ready / Pending / Blocked items and next actions. Wizard correctness • Preserve incomplete wizard state across page reload and branch change without exposing credentials. • Never mark skipped | TODO |
| 08 | Credential Rotation Safety Preflight replacement API rights and sender consistency; never discard existing valid secret if rotation validation fails. Engineering instructions / November 7, 2026 Addendum page 19 AI POWERS | EXISTS (part) — a new token is validated with Twilio on the server first; a wrong one never overwrites a working setup |
| 09 | Branch Sender Simulator Read-only preview of which account, number, Messaging Service and rules each branch would use for reminders, test SMS and OTP. | TODO |
| 10 | Registration Expiry / Status Alerts Alert owner on relevant suspended/rejected registrations or stale provider status, with evidence, deduplication and non-spam notification rules. | TODO |
| 11 | End-to-End Delivery Trace One activity overlay traces application request, provider acceptance, SID, callbacks, current status and failure reason. | TODO |
| 12 | Booking Code Health Test Safe staging verification of six-digit OTP route, expiry, attempts, abuse controls and provider configuration; never send a real code without authorization. | TODO |
| 13 | Compliance and Opt-Out Shield Separate transactional/marketing purpose, STOP processing, suppression, quiet hours and retry eligibility, with explicit blocking reason. | EXISTS — reminders honour STOP/opt-out ("opted_out" outcome), quiet hours and the STOP line in every language; inbound STOP routed to the one owning salon; marketing consent separate (reminder-core.ts, reminder-center.ts, tenant-number.service.ts, notifications consent) |
| 14 | Accurate Cost Guardrails Show verified current SMS costs and configured budget/usage thresholds; warn before paid actions; no invented fees. | TODO |
| 15 | Safe Configuration Export Allow a masked, role-authorized setup/health report for support; exclude tokens, raw destination PII and hidden tenant identifiers. | TODO |
| 16 | Regression Snapshot Suite Automate screen/layout snapshots at SUNMI and smaller viewports, EN/VN texts, role profiles, error states, and all existing modules after changes. Engineering instructions / November 7, 2026 Add | EXISTS — certified harness screenshots EN + VI for Messaging Setup |

## Tech Queue (24)

| # | Recommendation | Status |
|---|---|---|
| 04 | Next Available Technician Find the next actually eligible technician for selected service(s), Use shared Workforce/Booking duration and protected appointments. eligibility; never guess from green READY status. | TODO |
| 05 | Module Preservation Contract The repository is the source of truth for the full inventory; this list is only a minimum. DO NOT REMOVE / DO NOT REPLACE / DO NOT DISABLE No module may be deleted, hidden behind a permanent  | NOISE — preservation contract (module registry gate covers it) |
| 06 | Module Spacing, Typography & Touch UX Balanced cards with strong readability in a bright front-desk setting. Design system constraints • Use consistent card border, elevation, header height, badge styling, padding and ic | NOISE — spacing/typography guidance |
| 07 | Customer-to-Tech Handoff Show selected customer assignment state and whether POS A, No extra Visit, duplicate assignment Status Customer Queue and Technician App have synced. or shared cross-tenant data. Recommended upgr | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 08 | Assignment Panel, Queue Row & Schedule Overlays Keep full workflows reachable without stretching the main page. Compact queue list • A technician row should show existing queue order, avatar/name, status, waiting time, t | EXISTS — compact lane/queue lists with technician and ticket dialogs (lane-table, dlg-tech, dlg-ticket) |
| 09 | Recommended Upgrade #1 - Auto-Fit Health Checker Non-mutating layout diagnostics for each POS front-desk station. One-click Check Tech Queue Layout button • Detect current CSS viewport, DPR, orientation, display profile, | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 11 | Recommended Upgrades #4 - #7 Useful additions; preserve any already-implemented equivalent rather than duplicating it. Upgrade Requested behavior Boundary | TODO |
| 12 | Multi-Device Runtime and Reliability An adaptable web POS must remain correct on SUNMI as well as existing Windows desks. Runtime Must verify SUNMI 27-inch target Actual Chromium/WebView, Android/SUNMI OS build, CSS view | NOISE — multi-device runtime guidance |
| 19 | Mode Selector Security Changing Fair Turn mode is sensitive. Enforce manager/owner permission and audit the change. | TODO |
| 20 | Main Queue Row Use compact rows. Adapt to the actual design rather than forcing new fields. • Queue position • Avatar/name • Queue status • Ready since / wait Claude Build Mandate / 5 AI PowerSalon / Tech Queue 27-Inch T | EXISTS — compact lane rows (lane-row: position, name, status, current ticket) |
| 21 | Do Not Put Payroll on Tech Queue Do not expose commission, pay rate, salary, bank/tax data, or private manager notes on this operational screen. | NOISE — rule (no payroll on Tech Queue) — holds: rows show status, rotation, specialties, next appointment only |
| 22 | Explicit Queue Statuses Use the existing canonical state model and keep states unambiguous. • READY • SERVING • BREAK • QUEUE_HOLD • APPOINTMENT_PROTECTED • OFF_SHIFT • CLOCKED_OUT • UNAVAILABLE | NOISE — rule (canonical queue states) |
| 23 | Time Clock and Queue State Are Different CLOCKED_IN does not automatically mean READY. A clocked-in technician can be serving, on break, on hold, or appointment- protected. | NOISE — rule (clocked in ≠ ready) |
| 24 | Break and Queue Hold Are Different Break is workforce/time state. Queue Hold is temporary participation state. Do not merge them. | NOISE — rule (break ≠ queue hold) |
| 25 | Hard Eligibility Before Fairness Fair Turn ranking starts only after all hard eligibility checks pass. tenant -> branch -> active employment -> clocked in / scheduled -> not serving -> not unavailable -> not on protected | NOISE — rule (hard eligibility before fairness) |
| 41 | Assignment Panel Must Not Expand Page Whether 1, 10, or 100 candidates exist, the panel height remains fixed. Candidate lists use internal scrolling or top recommendations. | NOISE — layout rule (fixed-height assignment panel) |
| 42 | Customer Queue Integration Use the canonical Visit/Customer Queue record. Tech Queue assignment updates that same Visit; it must not create a duplicate Visit or duplicate customer queue entry. Customer checks in -> Visit | TODO |
| 43 | Assignment Concurrency Two receptionists must not assign the same single-capacity technician simultaneously. Session A assigns Lisa Session B assigns Lisa at the same time Expected: ONE SUCCESS ONE ASSIGNMENT_CONFLICT | EXISTS — two terminals assigning the same guest at once: exactly one wins, the other gets 409 (live pilot day MULTI-TERMINAL ASSIGN RACE) |
| 45 | Manual Override Authorized manager override requires permission, reason, and audit when Fair Turn policy is bypassed. | EXISTS (part) — Reassign requires a technician and a reason (doReassign; server tech-queue.service); Decline reasons that are safety/eligibility never cost a turn |
| 46 | Manual Override Must Preserve History Record original recommendation, selected technician, override reason, actor, and time where appropriate. Claude Build Mandate / 8 AI PowerSalon / Tech Queue 27-Inch Touchscreen, Fair | TODO |
| 47 | Quick Actions Audit actual Tech Queue actions. Potential legitimate actions include Assign, Hold, Return to Queue, Break Start/End, View Schedule, View Technician, and Reconcile/Refresh. | EXISTS — quick actions panel + per-technician actions: assign, break start/end, start (quick-actions, tech-actions, tech-assign, tech-break, tech-end-break, tech-start) |
| 48 | No Dead Buttons Every action must have a real handler and backend/domain path. No console.log, fake toast, or placeholder route. | NOISE — rule (no dead buttons) — enforced platform-wide by the dead-client / unreached-route audits |
| 49 | Technician Row Tap Open a compact detail drawer instead of expanding row height. | EXISTS — tapping a technician opens the technician dialog instead of growing the row (lane-tech → dlg-tech) |
| 50 | Technician Detail Drawer May show operational status, ready since, today's queue history, next appointment, relevant skills, current assignment, and break/hold state. Do not expose unnecessary payroll. 51. Search For 200 | EXISTS — technician dialog: summary, assignable reason, recent history, actions (tech-summary, tech-assignable, tech-recent) |

## Marketing Growth (14)

| # | Recommendation | Status |
|---|---|---|
| 01 | Choose goal Win back lapsed visitors, fill schedule gaps, promote a service or improve repeat bookings. | EXISTS — Campaign Assistant goals: win back inactive, fill slow weekdays, promote a new service, repeat visits (POSCampaignCenterScreen GOALS) |
| 02 | Select scope Tenant/branch, verified audience, date window, messaging channel, service and budget. | EXISTS — wizard details → audience (segment snapshot with selected/eligible/excluded counts) → content → schedule (cc-w-audience-now) |
| 03 | Generate proposal Safe draft with source metrics, segment eligibility, exclusions, templates and estimated costs if verified. | EXISTS — recommendations with source reasons and status (amk-recs, amk-rec-why, amk-rec-status) |
| 04 | Validate Consent, opt-outs, branch/timezone, provider readiness, SMS segments, overlap cooldown and active booking conflicts. | EXISTS — recipients carry consent-now and exclusion reasons; the worker re-checks consent at send (cc-rec-table, header note) |
| 05 | Review and approve Authorized manager sees recipient count, message preview, schedule and actual spend ceiling. | EXISTS — review → approval step; Launch only schedules an APPROVED campaign (STEPS review/approval) |
| 06 | Schedule safely Only after explicit approval through existing campaign jobs; never send or spend from AI generation itself. SUNMI interaction pattern • Use short step tabs or responsive wizard columns; preserve all six u | EXISTS — campaigns only send after explicit approval through the existing campaign jobs (Campaign Center launch preflight) |
| 07 | Date/Timezone Diagnostics Detects branch-local cutoff errors and daylight-saving reporting mismatches. | TODO |
| 08 | Provider Readiness & Deliverability Separates configuration from real SMS/email callback success. | TODO |
| 09 | Reward Liability Reconciliation Explains points, token funding, referral expense and gift-card liabilities separately. | TODO |
| 10 | KPI Freshness and Source Drill-Down Every financial total carries source, reporting scope and last update time. | EXISTS — last updated + cost explanation on the marketing KPIs (amk-updated, amk-cost-expl) |
| 11 | Journey Attribution Labels Distinguishes exposure, associated booking and validated attributable outcomes. | EXISTS (part) — revenue labelled "associated, not caused" across marketing pages |
| 12 | Alerting for Marketing Anomalies Flag unexpected cost spikes, send failures, duplicate claims and balance drift. | TODO |
| 13 | Screen/Locale Regression Suite Automated screenshot checks in English/Vietnamese at SUNMI CSS widths. | EXISTS — harness screenshots EN + VI |
| 14 | Safe Rollback & Feature-Flag Launch Release improvements gradually without affecting working campaigns or money ledgers. FINAL MANDATE: Keep every existing Marketing & Growth module intact; fix correctness first, use the | NOISE — rollout guidance |

## Safety Community (13)

| # | Recommendation | Status |
|---|---|---|
| 01 | Layout Self-Check & Screen Health Test current viewport, overflow and six tabs without mutating records. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Moderation Queue SLA View Show verified age and backlog of submitted drafts; no auto-approval. | TODO |
| 03 | Safe Draft Completeness Assistant Warn on missing context/evidence and suggest neutral wording. | TODO |
| 04 | Balanced desktop wireframe This drawing shows the intended hierarchy and six equal-access tabs, not a replacement app or fabricated advisory records. The original POS shell remains the source of truth. AI POWERSALON / SE | NOISE — wireframe drawing |
| 05 | Private Evidence Access Timeline Authorized auditable log of who viewed each restricted attachment. | TODO |
| 06 | Corrections & Retractions Inbox Track material published changes, follower notification delivery and appeals. | TODO |
| 07 | Region Alert Preferences Preview Show what subscribers would receive without exposing source cases. | TODO |
| 08 | Permission-Aware Role Preview Let owner inspect actions available by role, with no privilege escalation. | TODO |
| 09 | Safe Export / Developer Incident Report Export sanitized operational diagnostics, never private PII by default. | TODO |
| 14 | CSS implementation reference - foundation Apply these ideas to the existing design system. The selectors are illustrative. Do not introduce a new shell or replace correct production components; reuse existing layout toke | NOISE — CSS reference |
| 19 | Verified empty states, UI errors and loading CONDITION RECOMMENDED MESSAGE Salon community disabled "Safety Community is disabled for this salon. An authorized owner can enable it in Community Settings." Enabled, query s | NOISE — empty/error state wording table (states already distinct on the page) |
| 20 | Ten additional improvements - never replacements # Proposed enhancement Guardrail / benefit | NOISE — heading |
| 24 | Definition of done and original guide appendix • Original Safety Community route and all six tabs remain present, correctly permissioned and functional. • At SUNMI landscape 1920 × 1080 and normal browser zoom, app shell | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |

## Duplicate Review (14)

| # | Recommendation | Status |
|---|---|---|
| 01 | Baseline List actual components, routes, modules, API contracts, data owners, role permissions and existing tests. Capture screenshots of original page and comparison. | NOISE — process instruction (baseline inventory) |
| 02 | Preserve Produce original-to-new feature placement map; identify everything that must remain reachable, including newly discovered modules. | NOISE — process instruction (preservation map) |
| 03 | Shared shell Implement tested auto-fit adapter in Front Desk Web POS only. Preserve native mobile code. Verify Header/Sidebar/Booking/Checkout first. | EXISTS — FitKit dialogs/panels + shell compact spacing; native apps untouched |
| 04 | Duplicate page Arrange equal KPI cards, filters, queue/evidence/historical views; adapt CSS containers and touch controls. | EXISTS — KPI cards, filters, queue/history views (dup-kpis, dup-filters, dup-results) |
| 05 | Detail workflow Improve A/B comparison and sticky footer; preserve "Merge into this" as survivor selection, not immediate execution. | EXISTS — A/B compare, sticky footer, Merge into this kept as survivor choice (dup-compare, dup-foot, dup-merge-into) |
| 06 | Data correctness Check matcher confidence, backend merge preview, permission, version/idempotency, linked financial/consent records. | EXISTS — confidence, server merge preview with blockers/acks, merge idempotency key (dup-confidence, pv-blockers, newMergeKey) |
| 07 | Discoverability Secure search, genuine month calendars, stable newest-first numbered pages and read-only health. | EXISTS — search, month calendar, newest-first numbered pages, page size (dup-search, dup-cal, dup-pagesize) |
| 08 | Verification Run unit, API, integration, E2E, security and responsive screenshot suites; document exact environment and blockers. | NOISE — verification instruction |
| 09 | Rollout Feature flag, staged release, monitor overflow/error/merge metrics, retain safe rollback and do not silently migrate records. Three additional implementation recommendations • Screen-Fit & Module Preservation Che | NOISE — rollout instruction |
| 10 | Validate Automated, integration, manual UI and security tests with actual logs/results | NOISE — validation instruction |
| 16 | Security, multi-tenant boundaries and accessibility Area Must be proven in code and tests Server tenant isolation Tenant resolved from trusted authentication context. All candidate IDs and both customer IDs validated bef | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 20 | Definition of done + paste-ready execution mandate DEFINITION OF DONE: Existing Duplicate Review functionality is all preserved; the Web POS auto-fits SUNMI 27-inch landscape from real viewport measurements; modules rema | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |
| 29 | Implementation sequence for Claude Stage Required work and verified output | NOISE — implementation-sequence heading |
| 30 | Acceptance tests: identification and review • Two people with identical names are not auto-merged; shared family phone produces distinct candidates and requires confirmation. Source: supplied POS screenshot and owner req | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |

## TECH QUEUE (17)

| # | Recommendation | Status |
|---|---|---|
| 01 | Screen Fit / Module Health All eight KPIs, A/B/C, tickets, D/E and seven actions present and usable. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Queue Count Accuracy Active/Waiting/In Progress KPIs match actual eligible status events. | EXISTS — KPIs come from the server queue state (POSTechQueueScreen kpis / e1–e4) |
| 03 | Technician Eligibility Skills, schedule, break/offline, current work, branch and conflict checks. | EXISTS — per-technician assignable reason: on break / serving / off (tech-assignable) |
| 04 | Rotation & Fairness Arrival/rotation priority and approved exceptions without leapfrogging. | TODO |
| 05 | Status Transitions Legal paths; no stuck/expired live waits or duplicate completion. | EXISTS — status transitions declared and audited (apps/api/scripts/audit-state-transitions.mjs gate) |
| 06 | Realtime & Concurrency Subscription health, update lag, duplicate events and conflicting operators. | EXISTS — live connection dot + realtime refresh (live-dot) |
| 07 | AI Assignment Protection Model recommendations are permissioned, audited, approvable and safe. | TODO |
| 08 | Cross-Module Sync Booking, Check-In, Customer Queue, Serving, Service Done, Checkout and tech app consistency. | NOISE — audit category text (cross-module check list) |
| 09 | Analytics Accuracy D2/E1-E4 from canonical work and completion records. | EXISTS — E1–E4 analytics cards from canonical records (testId e1..e4) |
| 10 | Security & Privacy Tenant separation, branch scoping, staff/customer PII, audit/export controls. Every finding must show severity, affected branch/record IDs, observed vs expected state, timestamp, root-cause hint, and a | NOISE — security audit instruction |
| 11 | Queue throughput metrics with explicit numerator/denominator, business date and no-data state. | TODO |
| 12 | Audit timeline on each ticket, including timestamps for every canonical transition and approving user. | EXISTS — per-ticket timeline with queue status history and checkout (ticket-timeline, ticket-events) |
| 13 | Preserve user context when live updates stream in: no jumps, stale actions, or overwritten search filters. | TODO |
| 14 | Low-risk visual regression baseline for English and Vietnamese at multiple viewport sizes. | EXISTS — certified harness screenshots EN + VI at the certified and responsive sizes (Tech Queue in MODULES) |
| 15 | Idempotency/retry dashboard for duplicate queue or message events visible only to authorized support. | TODO |
| 16 | High-volume performance: server pagination, stable keys, virtual lists and bounded DOM/chart updates. Do not infer a required new database, AI engine, messaging service or scheduler from these ideas. Reuse existing autho | NOISE — performance guidance |
| 17 | Assigned Tickets with service-done rows Separate active, checkout-pending and historical views using source status transitions. Long wait on expired ticket Stop elapsed timer at expiry; show actual historical duration. N | EXISTS — Assigned Tickets tabs: live, waiting, accepted, in service, delayed, done today, checkout pending (TQ_TAB_KEYS) |

## COMMISSION REPORT (9)

| # | Recommendation | Status |
|---|---|---|
| 01 | Baseline audit Locate /tenant/reports/commission; inspect original 5 cards, 7 columns, Full View, existing query/API/business logic and screenshot. | NOISE — process step (baseline audit) |
| 02 | Finance definitions Trace captured rates, tip assignment, adjustments, earned/payable/paid meaning; reconcile screenshot arithmetic. | TODO |
| 03 | Auto-fit shell Repair layout with CSS grid/minmax/dvh and actual viewport handling; preserve sidebar/topbar and responsive fallback. | TODO |
| 04 | Report layout Implement equal KPI row, full-width table, balanced detail/history, discrepancy panels; preserve all actions. | TODO |
| 05 | Search and dates Wire role-limited global search, From/To calendar, date basis and correct local time filtering. | TODO |
| 06 | Paging and drill-down Implement stable grouped report pagination, newest-first event histories, complete technician details. | TODO |
| 07 | Accuracy checkers Add read-only Commission/Payroll and Screen Fit checkers based on canonical data; no auto money changes. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 08 | Cross-module QA Verify Checkout, Service Done, Tips, Refunds, Payroll, permissions, tenant isolation, localization. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 09 | Release review Run lint/types/build/unit/integration/e2e and rendered screenshot review; list changed files and gaps. NO DUPLICATE BUSINESS ENGINES Check existing services and APIs first. Extend real code only where need | NOISE — release review instruction |

## Individual Technician Tipping (8)

| # | Recommendation | Status |
|---|---|---|
| 00 | Evidence map Locate all tip and customer display screens; inspect screenshots, payment flows, source tables, routes, worker states, localization, mobile dependencies and current tests. | NOISE — process step (evidence map) |
| 01 | Compatibility Prove target SUNMI runtime/OS/touch capability and external customer display integration model; do not assume Windows-specific APIs. | NOISE — process step (compatibility proof) |
| 02 | Screen fit Implement/adapt responsive POS shell and module layout; preserve global navigation; verify container geometry and zero global x-overflow. | TODO |
| 03 | Customer UX Equal-size per-technician cards, independent presets/custom, review and fixed confirm actions, 1/2/3+ recipients. | TODO |
| 04 | Financial safety Validate versioned tip selection, one trusted Checkout amount, Fiserv routing and UNKNOWN recovery without modifying native iPhone code. | TODO |
| 05 | Ledger and payroll Verify per-recipient payment/card/cash allocation reconciliation, cash already paid, adjustments and reports. | TODO |
| 06 | Isolation and privacy Backend permission negative tests, display pairing, audit and three-second state reset. | TODO |
| 07 | Test and rollout Unit + integration + UI viewport + physical device + Fiserv sandbox/UAT; progressive feature-flag release only after P0 gates pass. Blocker handling If SUNMI external display support, Clover Compact prov | NOISE — test and rollout instruction |

## Campaign Builder (7)

| # | Recommendation | Status |
|---|---|---|
| 01 | Mandatory audit before coding Claude must inspect the actual running application/repository, not assume prior PDF requests have been completed. Preserve production data and follow existing conventions. Subsystem Specific | NOISE — audit-before-coding instruction |
| 02 | SUNMI display facts and what 100% fit means Dimension Source figure / engineering implication Screen 27-inch landscape, nominal 1920 x 1080 resolution, 16:9 aspect ratio. Unit dimensions Overall width 25.43 in / 646 mm;  | NOISE — display facts table |
| 08 | Step 2 - Audience: strict eligibility This is one of the three highest-risk areas in the original source guide. The UI must make "matched" and "eligible to contact" visibly different, while keeping all existing filtering | TODO |
| 10 | Step 4 - Offer: reuse approved promotion rules Canonical offer guardrails • Use existing Deals & Promotions, Loyalty & Rewards, Gift Cards, service catalog and Checkout. Preserve all implemented Offer step controls. • Ke | TODO |
| 11 | Step 5 - Schedule: calendar & delivery readiness Date and time contract from the original guide • Retain the existing schedule wizard step, preserve draft dates/time and use the configured branch timezone. • Month calend | TODO |
| 16 | Recommendations 9-16: safety & insight 09 - One-Click Campaign System Health Reuse original guide Health Checker and show Passed/Warning/Failed/Unavailable for drafts, audience/consent, content, provider, worker, costs a | TODO |
| 17 | Visual acceptance checklist - SUNMI & 24-inch Claude must execute these checks with actual 100%-zoom browser screenshots and interaction evidence. Browser/device confirmation is required; a desktop emulator screenshot al | NOISE — visual acceptance checklist |

## Three Ways To Pay (9)

| # | Recommendation | Status |
|---|---|---|
| 01 | AI PowerSalon LLC is the parent ISV software platform; participating salons are isolated child tenants, and approved salons have their own appropriate Fiserv merchant configurations. | NOISE — platform/ISV policy statement |
| 02 | The physical test device supplied by Fiserv is a Clover Compact, not a Clover Flex. Maintain the existing Bolt integration for Compact. | NOISE — hardware fact (Clover Compact via Bolt) — integration unchanged |
| 03 | Build three separate payment entry points: Clover Compact (Bolt), merchant iPhone Tap to Pay (PSP-native) and customer in-app saved-card checkout (hosted tokenization + Gateway). All use one server-authoritative ledger. | EXISTS — Checkout → Three Ways to Pay (co-ways-btn / checkout-three-ways): Clover Compact (Bolt), iPhone Tap to Pay (read-only native), customer phone pay |
| 04 | No live transactions or merchant boarding until Fiserv confirms integration certification and merchant activation. | NOISE — standing rule: production payments disabled until Fiserv certification |
| 05 | Balance, spacing, accessibility and scroll Consistent visual weight across three methods; no oversized card beside tiny text. Design-token recommendations (adjust to existing component library) Token Working design targe | NOISE — styling instruction |
| 06 | Recommended responsive CSS implementation Concept code for Claude to adapt after inspecting current React components and design tokens. /* SUNMI front-desk surface only; do not style native iOS app */ .pos-frame { displa | NOISE — concept CSS text |
| 07 | Adaptive component structure and state protection The page should resize safely while a real payment or inquiry is in progress. // Pseudocode / fit example: reuse existing shell and payment APIs. const channels = ["clove | NOISE — state-protection guidance |
| 13 | Tips, surcharge, receipts and split-tender UI safety Show accurate verified amounts, protect real processor decisions and preserve original rules. A single clear checkout summary Amount component Required UI behavior | TODO |
| 24 | Strict 3% surcharge acceptance contract - all three channels NO BLANKET 3% - NEVER SURCHARGE DEBIT OR PREPAID Fiserv's CardPointe Merchant Surcharge Program is limited to enrolled eligible merchant accounts and eligible  | NOISE — surcharge policy; standing rule: no flat 3% surcharge is implemented |

## GIFT CARDS (15)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-click Gift Cards Layout Health Checker Validate actual visible bounds for the five KPIs, toolbar, pagination, primary actions, overlays, and EN/VN labels; report overflow, clipping and undersized targets. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Display profile inspector Show detected CSS viewport, pixel ratio, browser, orientation, safe viewport height and last test. Treat profile as diagnostic, not a forced browser zoom setting. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | One-click Gift Card Ledger Accuracy Checker Reconcile each sample card and tenant totals across ledger, checkout and KPI aggregate; show exact source IDs behind anomalies. | TODO |
| 04 | Quick customer-card finder From Checkout or Customer Profile, open a scoped, masked card picker with purchaser/recipient labels, without requiring staff to leave their active sale. | EXISTS (part) — universal masked search (card ref / last 4, purchaser or recipient, phone, email); exact code only via protected Check Balance |
| 05 | Live status and recency indicators Show when balance was verified, source freshness and pending issuance/reversal states; do not confuse stale cached data with authorized spendable value. | TODO |
| 06 | Barcode/scanner assistance Use the existing input/scanner interface if supported; keep a protected manual lookup fallback, with no secret exposure in autocomplete. | TODO |
| 07 | Guided gift card issuance overlay Create a concise, touch-friendly workflow with input validation and a clear payment-confirmation step. Make primary buttons consistently sized. CLAUDE BUILD ADDENDUM / NOVEMBER 7, 2026 A | EXISTS (part) — Issue Gift Card is payment-first: it opens a ticket Checkout pays; the card holds value only after payment (POSGiftCardsScreen) |
| 08 | Duplicate issuance and double-spend alerts Detect repeated payment references, identical idempotency keys, overlapping redemption requests and mismatched gift-card activation events. | TODO |
| 09 | Gift-card liability by branch report Show funded liability, outstanding balances, issued value and redeemed value by authorized branch and as-of date, respecting existing cross-branch rules. | EXISTS — liability by branch with clearing exceptions (Branch Liability & Clearing panel; POSGiftCardsScreen.liability.test) |
| 10 | Refund/reversal preview Before permitted corrections, display current balance, proposed delta, resulting balance, linked ticket and an explicit approver/audit reason. | TODO |
| 11 | Gift-card eligibility explanation Explain active/void/redeemed/pending/locked status, allowed locations and permitted spend rather than showing a vague disabled button. | EXISTS (part) — status tabs All / Active / Redeemed / Void; Void is a manager's reasoned, step-up, ledgered action |
| 12 | Reconciliation to daily closeout Compare gift-card issuance tenders, redemption amounts, receipt totals and outstanding liability movements to daily register closeout. | TODO |
| 13 | Secure digital delivery monitoring If delivery by SMS/email exists, show sent/failed status and consent eligibility without revealing complete redeemable secrets in routine messages or audit logs. | TODO |
| 14 | Controlled large-tenant performance Server-side pagination/indexes, stable sorting, request cancellation and no cross-tenant data fetching for large card ledgers. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 15 | Feature preservation audit before deployment Automatically assert original component registry, routes, critical actions and API behaviors remain present across old and new builds. CLAUDE BUILD ADDENDUM / NOVEMBER 7, 2026 | EXISTS — module registry + preservation matrix gate |

## ADD-ONS MANAGEMENT (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Screen Fit & Module Health 100% zoom, viewport height, horizontal overflow, missing/hidden buttons, clipped dialogs, KPI alignment, sticky header/footer and EN/VN text expansion. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Add-On Catalog Accuracy All records and four KPI definitions agree with tenant-scoped canonical data, including archived/active and service offering counts. | EXISTS (part) — the four cards count offerings with their shared definitions stated under the first card (POSServiceAddOnsScreen) |
| 03 | Service Assignment Integrity Orphaned links, category/service mismatches, duplicate active offerings and correct shared versus service-specific edit scope. | EXISTS (part) — a nail add-on on a hair service is flagged for review, never removed |
| 04 | KPIs CSS grid repeat(4,minmax(0,1fr)) where supported. Equal heights and consistent typography; at narrow viewports use 2 × 2. Filter toolbar Search takes flexible width, status and date filters intrinsic minimum widths. | NOISE — CSS grid guidance (certified in the harness) |
| 05 | Checkout & Refund Wiring Real selected/performed add-on -> one checkout line -> receipt/payment -> refund/void; prevent duplicate charges and wrong technician allocation. | TODO |
| 06 | Inventory & Usage Confirmed consumption deducted once, accurate technician attribution, recipe linkage and Stock Alerts consistency. Output format Show PASS / WARNING / ERROR / NOT CONFIGURED, number of affected records, | TODO |
| 07 | Booking impact preview: Before changing +time or archiving, report which future appointments might require staff attention. | TODO |
| 08 | Mass edit safeguards: If bulk assignment is supported, show explicit affected-count preview, role check, audit and rollback plan. Implementation guide · 7 Nov 2026 20 AI POWERSALON / ADD-ONS MANAGEMENT SUNMI FLEX 3 · CLA | TODO |
| 09 | Service profitability context: Optional authorized reporting on sold add-ons and consumed recipe cost with clearly defined basis. | TODO |
| 10 | Attach-rate analytics: Report the share of eligible completed service tickets with a confirmed add-on, using a documented denominator. | TODO |
| 11 | Real-time freshness hint: Show last refreshed/updated time and distinguish stale data from verified zero. | BUILT — Numbers updated {time} after a successful read; a failed refresh says it is stale, never a verified zero (addons-fresh; shared FreshnessLine, FreshnessLine.test) |
| 12 | Friendly empty states: Offer useful actions for empty catalog, no matching results or no historical purchases without fake data. | EXISTS — empty catalog offers Create (manage only); no-match offers Clear filters; no usage says so — no fake data (POSServiceAddOnsScreen Empty states) |
| 13 | Role-aware details: Open a bounded detail overlay with only data the user is allowed to view, avoiding accidental PII exposure. | EXISTS — Add-On details overlay: Overview · Assignments · Pricing · Usage · Audit |
| 14 | Price/tax reason display: Explain why the exact charged total differs from the default add-on price (overrides, discounts, taxes). | TODO |
| 15 | Performance guardrails: Cache or index safe tenant queries appropriately, with explicit invalidation after record updates. | NOISE — performance guidance |
| 16 | Visual regression automation: Capture key screenshots at real device viewport sizes in both English and Vietnamese and check controls remain reachable. Implementation guide · 7 Nov 2026 21 AI POWERSALON / ADD-ONS MANAGEM | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |

## Coupons  Promotions (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Auto-Fit Diagnostics Developer/admin-only report showing CSS viewport, scaling, sidebar width, overflow offenders and layout test results. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Unified Offers Relationship Viewer Read-only map of coupon, promotion and deal references for vishal and other records, with same-benefit detection. | TODO |
| 03 | Discount Exposure Preview Before activation, estimate maximum configured liability with eligible-transaction assumptions and clearly labeled uncertainty. | TODO |
| 04 | Duplicate Redemption Guard Detect duplicate payment callbacks, reused idempotency keys and suspicious near-simultaneous code applications. | TODO |
| 05 | Expiration / Limit Alerts Warnings for soon-to-expire offers, exhausted usage limits, paused codes and stale coupons. | EXISTS — Expiring KPI + paused/exhausted status chips on Discounts (kpi-expiring, status filter) |
| 06 | Full Benefit Stacking Inspector Show exactly why coupons, deals, membership, loyalty and gift-card tender do or do not combine. | TODO |
| 07 | Quick Customer Eligibility Preview Read-only selection of customer, service and branch; reason codes without decrementing coupon limits. | EXISTS (part) — Eligibility Checks on Promotions / Coupons (read-only customer · service check with reasons) |
| 08 | Change History & Version Compare Side-by-side before/after offer terms, actor, approver and audit links; protect financial history. ALL ARE OPTIONAL, NONE REPLACE CORE MODULES Document which enhancements already exist. U | EXISTS (part) — Activity with before → after and version on each offer |
| 09 | Responsive Card Consistency Centralized UI card sizing/gap tokens to keep all marketing pages proportional at 1920, 1536 and 1366 widths. | NOISE — UI sizing-token guidance |
| 10 | Touch Usability Audit Automated hit-target size, focus, labels, modal Close visibility and EN/VN overflow checks. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 11 | Campaign Cost Protection Pre-send authorization, audience consent, estimated SMS/email cost, duplicate campaign-send prevention. | TODO |
| 12 | Promo-to-Checkout Trace From a promotion, inspect authorized ticket, applied discount, payment and reversal evidence. | EXISTS — redemption rows open the customer and the ticket (receipt in Transactions / Checkout) (shared ticketRoute) |
| 13 | Source-Based ROI Explanation Separate associated revenue, discount costs, spend and unverified incremental lift. | TODO |
| 14 | Advanced Branch Scorecard For authorized multi-branch owners, comparable offer uptake, applied discounts and actual associated revenue. | TODO |
| 15 | Accessible Export & Audit Scoped CSV/PDF export with masked PII, date basis, filters and export activity log. | TODO |
| 16 | Automatic Release Regression CI and screenshot diffs for desktop/touch layouts plus pricing, permission and reconciliation invariants. NO AUTONOMOUS PRODUCTION CHANGES New AI or health tools must only recommend and diagn | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |

## AI PowerSalonLive Operations (12)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-Click Live Operations Health Checker Inspect all module wiring, real-data freshness, tenant/branch scope, fetch/query errors, realtime subscription health, empty-vs-broken state and viewport overflow. Report PASS / W | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Automatic Screen Fit & Display Calibration A shared read-only display diagnostic that reports CSS viewport, DPR, density mode, OS/browser safe area, outer overflow, clipped cards and Quick Action visibility. Automatic fi | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx: viewport, fit, clipped, touch, display) |
| 03 | Smart Priority Operations Strip Add a compact existing-panel-compatible priority summary for blocked checkouts, unusual waits, excessive staffing gaps, overdue appointments and stale messages; all results link to authori | TODO |
| 04 | KPI Accuracy & Reconciliation Checker Verify each KPI against backend authoritative definitions, selected branch, time zone, date range, payment-state rules and report aggregates. Display mismatch reasons and stale-cache | TODO |
| 05 | Multi-Location Safe Summary For authorized multi-branch owners, offer branch switch or aggregate preview without leaking one tenant into another; show current selection visibly and enforce branch permissions server-side. | EXISTS — Multi-Location Snapshot card per authorized branch (lo-locations) |
| 06 | Quick Action Readiness & Permission Guard For each Quick Action explain why enabled/disabled, verify selected customer/Visit when relevant, prevent accidental duplicate submissions, and maintain existing manager approval | TODO |
| 07 | Realtime Recovery Indicator A small actual connectivity indicator, last-sync timestamp and safe manual reconcile button. On reconnect fetch authoritative snapshot then resume events; no window.location.reload(). | BUILT — live indicator now shows the last successful read time + a manual ↻ Refresh that re-reads /state (live-ops-synced / live-ops-refresh; POSDashboardScreen.test) |
| 08 | One-Click Module Preservation Checker Compare pre/post component inventory, routes, handlers, permissions, tests and current actions. Fail the release if a module disappears, becomes unreachable or a button degrades to a | EXISTS — check-pos-module-registry gate + POS preservation matrix (tooling/e2e/pos-preservation-matrix.mjs) |
| 09 | Staff-Friendly Detail Mode Use existing View All or viewport-bound drawers to show deep detail without stretching the summary page; preserve current filters, selected branch and item context when closing. | EXISTS — every KPI/snapshot tile opens its full module instead of stretching the dashboard (POSDashboardScreen kpiCards[].to) |
| 10 | Operational Trend Explainability For changing revenue/appointments or performance, display exact source and time window plus a concise “what changed” explanation, while leaving decisions and money movement with employees | TODO |
| 11 | Business integrity, tenancy & realtime Authority boundaries • Appointments: Booking remains the authority. Do not invent a new appointment count or separate visit state in Live Operations. • Queue / staff / service: Cust | NOISE — authority-boundary policy text |
| 12 | Proof-based validation matrix Claude must run automated and manual tests in the actual repository, record measurements and screenshots, and distinguish PASS, FAIL, NOT_TESTED, or BLOCKED_EXTERNAL. The checklist below ext | NOISE — validation instruction |

## AI MONEY PROTECTION 5 (19)

| # | Recommendation | Status |
|---|---|---|
| 01 | Monitoring Trust Banner At top of overview show “Monitoring Active / Stale / Disabled / Partial / Error” with last successful run and source coverage. | EXISTS — monitoring banner: current / stale / off with last run and schedule state (mpx-monitoring) |
| 02 | One-Click Health Summary Single button with dependency matrix, last validated source and safe resolution path; read-only. | EXISTS — read-only Money Protection check from the header (mpx-check, mpx-health) |
| 03 | Evidence Completeness Meter Per alert/case show which source links were verified, missing, stale or permission-limited. | TODO |
| 04 | Deduplicated Exposure Drill-down Explain Value Under Review calculations, overlapping alerts and why sums differ from alert count. | TODO |
| 05 | Funding Calendar Awareness Mark “Expected / Not yet due / Overdue / Unmatched” based on processor and bank timing. | TODO |
| 06 | Reviewer Workload View Summarize pending, high-priority, assigned/unassigned and aging cases, without merging Investigations. | BUILT — workload strip on Investigations: active / high priority / unassigned / open 7+ days for ALL active cases in scope (server count, independent of list filters); High and Open 7+ days narrow the list; cases stay separate (money-protection-center investigations().workload; pgtest IN-01; POSAIMoneyProtectionInvestigationsScreen.test) |
| 07 | Safe Rule Preview Before a manager saves rule edits, show read-only estimated historical matches on approved test data; never silently activate. | TODO |
| 08 | Source Reconciliation Links One click from alert to same ticket, refund, batch or reconciliation in the existing owning module. Priority labels Priority A: 01-05 because they prevent misleading risk/health messages. Prio | BUILT — alert sources link to the same ticket / payment in Transactions; Transactions now honours ?ticket= / ?q= deep links across all dates (mpx-src-ticket, mpx-src-payment; POSAIMoneyProtectionAlertsScreen.test, POSPaymentsScreens.test) |
| 09 | Workspace Layout Profiles Use responsive layout presets for 1920 × 1080 SUNMI, other desktops and short viewports; reflow with CSS, not OS/browser zoom hacks. | EXISTS — certified 1920×945/952/1032 layouts reflow with CSS; screen check on every page (shell/ScreenCheckDialog) |
| 10 | Smart Filter Presets Saved local UI preferences for “Critical”, “Awaiting Review”, “My Cases”, “Last | BUILT — POS saved views (migration 844, pos/me/saved-views, components/SavedViews); pgtest 6/6, component 4/4 |
| 11 | Documented Alert Rate Limits Throttle duplicate notifications while preserving distinct evidence and an auditable incident timeline. | TODO |
| 12 | Failure-aware Snapshot Allow authorized read-only as-of view labeled stale when providers are offline, rather than misleading zeros. | TODO |
| 13 | Long-list Virtualization For heavy histories use stable server pagination and optional row virtualization without losing focus/navigation. | EXISTS — stable server pagination (Pager) on every Money Protection list; row virtualization not added (pages are bounded) |
| 14 | Better Empty States Explain verified no alerts vs no transaction data vs paused monitor vs filtered no matches vs access restriction. | TODO |
| 15 | Export Provenance Export author, time, tenant scope, metric definitions, source freshness and redaction scope on approved files. | TODO |
| 16 | Accessibility & Language QA Touch targets, keyboard focus, real screen reader labels and EN/VN layouts; no truncation in translated labels. DO NOT AUTO-ENABLE Ship new dashboards, diagnostic controls or presets behind ex | NOISE — accessibility/language QA instruction |
| 18 | Notifications, escalation and multi-salon owner views Notification delivery • Reuse existing tenant notification center and authorized email/SMS connectors where configured; respect roles, quiet hours, cooldown and escal | NOISE — notifications/escalation requirement narrative |
| 19 | Subscription, bilingual POS and accessibility • Use actual AI PowerSalon billing entitlements and usage counters; do not invent prices. Keep basic payment processing functioning during AI service expiration. • For tenant | NOISE — subscription/bilingual/accessibility narrative |
| 20 | Suggested contracts and ownership (verify before implementation) Do not create these endpoints or tables blindly. The following are required behaviors to map onto the real repository. Reuse or extend existing services ra | NOISE — suggested contracts text (verify-before-implementing note) |

## AI Calls  Voice Intelligence Management Center (4)

| # | Recommendation | Status |
|---|---|---|
| 02 | SUNMI hardware and usable viewport Physical inches are not CSS coordinates. Reference Target / developer rule SUNMI panel 27-inch landscape; image states 1920 × 1080 pixels, 16:9 ratio Display housing 25.43 in / 646 mm w | NOISE — viewport facts (screen check covers fit) |
| 13 | Added recommendations - operational quality New suggestions are additive: none replace existing original features. R1 - Call lifecycle status timeline A compact evidence timeline: Incoming → Routed → Agent Active → Tool  | NOISE — recommendations heading |
| 14 | Added recommendations - scale and service Apply only after an audit shows that the capability is absent. R7 - AI call quality review queue Staff may flag a call for accuracy, clarity or incorrect service suggestion. Use  | NOISE — recommendations heading |
| 15 | Security, consent and protected surfaces Multi-tenant voice data and iPhone payment code are out of bounds for risky changes. Tenant and branch isolation • Enforce tenant/branch ownership and RBAC in every API, database  | NOISE — security/consent boundary text |

## Payment Terminals 2 (12)

| # | Recommendation | Status |
|---|---|---|
| 01 | Automatic SUNMI display profile with live CSS viewport detection and a safe standard-browser fallback. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Layout Health Checker with real DOM overflow/touch-target checks and screenshots in CI. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | Four KPI equal-height responsive cards with evidence timestamp and click-to-filter. | EXISTS — terminal KPI cards with refresh (kpis, refresh) |
| 04 | Provider-aware Device Readiness Checker to distinguish offline, stale, untested, and genuinely online. | BUILT — Check Terminals System (pos/system-checks/terminals): not seen in a day, last ping failed, never verified, duplicate serial |
| 05 | Clover Compact pairing checklist: branch, MID, register, supported app, non-charge verification, test evidence. | EXISTS — pairing flow: processor, register, model/HSN, non-charge test connection, verify step (pair-*, test-connection, pair-verify) |
| 06 | Safer iPhone revocation review with last-working-payment-method warning and provider-confirmed result. | EXISTS — revoke needs a reason and warns when it removes the last working capture method (revoke-reason, last-capture-warning) |
| 07 | Smart contextual “Needs Attention” assistant with a specific troubleshooting path per failure state. | EXISTS — terminal detail troubleshooting: each attention state shows its own why + fix path (pt.why.* / pt.fix.*) with the status freshness line (POSPaymentTerminalsScreen detail overlay; tests: POSPaymentTerminalsScreen.test.tsx) |
| 08 | Device detail overlay with real last payment, last seen, previous status events and authorized copy-ID. | EXISTS — terminal history / status events (terminal-history) |
| 09 | Payment Activity trace with exact provider-device linkage and no guessed customer/device attribution. | EXISTS — payment activity with provider-reported device (activity-table, activity-device) |
| 10 | Routing preview: show current vs proposed register-terminal association before Save. | EXISTS — register↔terminal routing confirmed before save (routing-table, confirm-routing, save-routing) |
| 11 | One-click Transaction Attempt Status Check to resolve unknown outcomes before a retry. | TODO |
| 12 | Release-blocking module registry tests: no tab, action, page or existing record becomes unavailable after layout changes. CLAUDE IMPLEMENTATION ADDENDUM • 7 NOV 2026 17 AI POWERSALON / SUNMI FLEX 3 / PAYMENT TERMINALS | EXISTS — release-blocking module registry gate (tooling/ci/check-pos-module-registry.mjs) |

## Money Protection Settings (10)

| # | Recommendation | Status |
|---|---|---|
| 01 | Layout Health Checker: add read-only “Check Screen Fit” diagnostic available to authorized POS managers/developers. It reports viewport, clipped primary controls, content overflow and minimum control sizes without changi | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Visible “Saved vs Effective” chip: each row and top summary should distinguish persisted settings, currently effective worker version and config drift. Prevent “Saved” from being mistaken for running protection. | TODO |
| 03 | Consistent card and table design tokens: one reusable balanced layout pattern across Settings, Rules, Alerts and Investigations; preserve each page’s existing fields and workflows. | NOISE — design-token instruction |
| 04 | Optional manager compact-density preference: choose comfortable or compact spacing without removing fields, disabling scrolling or changing rule evaluation; remember per authorized user. | BUILT — opt-in Compact spacing per device (profile menu → Compact spacing; Standard = certified default; gaps/padding only, never fonts or touch targets) — shell/spacingPref.ts + spacingPref.test 2/2 |
| 05 | Safe recovery: after a failed Save or lost connection, offer Reload Current, Compare Changes and Retry with explicit confirmation; never silently overwrite concurrent edits. | TODO |
| 06 | Phase 5 - Cross-module verification. Verify Rules → Alerts → human Investigations and source ledger boundaries, prevention OFF, tenant isolation, Fiserv/Checkout compatibility and iPhone app non-interference. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 07 | Phase 6 - Visual and E2E proof. Run all documented screen sizes, actual SUNMI kiosk/browser viewport, EN/VN, touch/keyboard, regression tests and screenshot diffs. Repair failures. | NOISE — visual/E2E proof instruction |
| 08 | Phase 7 - Handoff. Deliver file-by-file changes, screenshots, command logs, exact pass/fail counts, blockers, rule inventory before/after and an honest final implementation status. CLAUDE BUILD MANDATE / PRESERVE ALL MOD | NOISE — handoff instruction |
| 14 | Suggested API contracts - map to existing endpoints These are behavior contracts, not instructions to create a new API namespace when equivalent endpoints already exist. Capability Required contract / checks List setting | NOISE — API contract proposal text |
| 15 | Implementation plan for Claude | NOISE — implementation-plan heading |

## DEPOSITS  SETTLEMENTS (12)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-click Screen Fit & Layout Health Check CSS viewport, page overflow, visible KPI/paging, overlapping buttons, Checker toolbar wrapping, calendar placement and touch targets. Dev/owner diagnostics; never fake a pass. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Settlement & Refund Data Health Checker Check source freshness, provider event uniqueness, missing batch IDs, orphan refunds and dates. Explain which adapter/query failed. | BUILT — shared read-only Check Settlements System (GET pos/system-checks/settlements, components/SystemCheck); pgtest 5/5 + PG16 run |
| 03 | One-click Financial Reconciliation Accuracy Compare six KPIs, provider totals, refunds, fees and bank matches against Checker authoritative records, with a traceable discrepancy report. | EXISTS — six KPIs + reconciliation strip (kpis, recon-strip) |
| 04 | Smart Bank Confirmation Status Separate processor-settled, payout-sent, bank-confirmed, partially matched, missing and unknown states; show true evidence. | EXISTS — bank-confirmed shown separately from processor-settled (testId bank-confirmed) |
| 05 | Settlement Detail + Transaction Lineage One touch opens settlement underlying payments provider payout bank-match evidence, without constructing speculative customer links. | EXISTS — settlement detail with its underlying transactions (settlement-detail, tx-table) |
| 06 | Refund Impact Drilldown Explain whether a refund affected the current or later settlement, and whether its amount is already netted. Read-only unless explicitly authorized. Preserve all existing modules and show new diag | EXISTS — refund detail drilldown (refund-detail, refunds-table) |
| 07 | Provider Sync Status Center Display last verified sync, stale feed and provider-specific errors; distinguish no transactions from missing data. | TODO |
| 08 | Duplicate Import Detection Flag repeated provider event IDs and batch keys; stop double totals while retaining evidence and audit. | TODO |
| 09 | Smart Exception Triage Highlight fee variance, missing payout, unexpected refund and long-pending settlement; recommendations only, no autonomous correction. | TODO |
| 10 | Reconciliation Detail Shortcuts Open the established Deposit Reconciliation route with valid settlement context; never recreate a second match engine. | EXISTS — Open Deposit Reconciliation from a settlement (open-recon) |
| 11 | Saved View & Date Presets (if authorized) Use tenant-scoped presets for common reporting periods and filters; preserve precise date basis and no cross-user data exposure. | BUILT — POS saved views (migration 844, pos/me/saved-views, components/SavedViews); pgtest 6/6, component 4/4 |
| 12 | Automated Visual & Financial Regression Capture before/after actual browser screenshots and run ledger scenarios for Suite zero, high volume, partial settlements, bank delays and provider outages. Prioritization • First: | NOISE — regression instruction |

## TEAM MANAGEMENT (17)

| # | Recommendation | Status |
|---|---|---|
| 01 | SUNMI Screen Fit Actual CSS viewport, overflow bounds, hidden clickable elements, zoom and reflow state. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx) |
| 02 | KPI Definitions Eight KPI values and source/period/timezone, missing queries and inconsistencies. | EXISTS — eight KPIs (4 + 4), each with its definition, period, source and state (loading / unavailable) (POSTeamScreen) |
| 03 | Directory Integrity Unique employee IDs, duplicated rows, role counts and stable pagination. | EXISTS (part) — Check Technicians System: active-but-archived, missing names, duplicate phones, split out of range, missing app account (system-checks technicians) |
| 04 | Attendance / Shift Actual clock events versus effective shift and breaks; approved exceptions. | EXISTS — attendance view against shifts (view-attendance, shift-rule) |
| 05 | Skills / Availability Mapped services, branch eligibility, next openings and Booking conflicts. | TODO |
| 06 | Commission / Productivity Earned vs paid labeling, original source totals and rounding anomalies. | EXISTS — Commission is labelled EARNED; Paid comes only from payroll payouts (POSTeamScreen KPI definitions) |
| 07 | Ratings / Rankings 0-5 verified stars, sample counts and separate composite evidence. | TODO |
| 08 | Approvals / Training Unresolved requests, missing training links and real certification dates. | TODO |
| 09 | Realtime / Integrations Queue, Booking, Time Clock and Technician App sync freshness. | TODO |
| 10 | Security / Localization Tenant boundaries, role gates, English/Vietnamese layout overflow. Diagnostic UI behavior Show Last Checked, scope, Passed / Warning / Blocked / Not Configured, source reference and exact next act | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 11 | Revenue vs earnings glossary Explain every finance metric and its date basis. | EXISTS (part) — each finance KPI states its definition and date basis on the card; no separate glossary page |
| 12 | Find Qualified & Available Staff Priority B: a functional availability overlay shared with Booking/Technician Scheduling; never invent an opening from UI-only logic. Required input and decision pipeline • Inputs: request | EXISTS — Find qualified & available staff overlay (open-finder) |
| 13 | One-Day Shift Editor with conflicts Priority C: a technician/date-specific editor integrated with the existing Staff Schedule. It is not a replacement for recurring shift templates. Overlay workflow • Open from employee  | EXISTS — one-day shift editor per technician/date (open-date-shift, row-date-shift) |
| 14 | Health Checker evidence export Redact PII and require permission; never dump raw payroll. | TODO |
| 15 | Visual regression snapshots Baseline SUNMI screenshots for EN and VN at target viewports. | EXISTS — certified harness screenshots EN + VI |
| 16 | Safe rollout feature flags Roll out new overlays/diagnostics per tenant or role in staging first. CLAUDE ENGINEERING HANDOFF / DEVELOPMENT / STAGING ADDENDUM 21 AI POWERSALON / SUNMI FLEX 3 / TEAM MANAGEMENT | NOISE — rollout guidance |
| 21 | 16 improvements - add without replacing The following are optional additive enhancements. First inspect whether equivalent functionality already exists; extend existing services and components instead of duplicating them | NOISE — heading for optional improvements |

## Customer Retention  Win-Back Management (8)

| # | Recommendation | Status |
|---|---|---|
| 01 | Original screenshot — required visual reference Original customer-provided AI PowerSalon Customer Retention screenshot | NOISE — screenshot reference |
| 02 | Search toolbar: searchable text; Today / Week / Month / Year / Custom; From/To calendar; Segment; Visit Count; SMS Eligible; sort and Clear. | EXISTS — search + period presets/custom calendar + segment, visits, SMS, email, branch, technician, spend filters (rt-search, flt-*) |
| 03 | Summary cards: preserve the five existing cards and add Never Visited, optionally Recovered and Campaign Recoveries as distinct metrics. | EXISTS — five original cards + Never Visited · Recovered · Campaign Recoveries, each opens its cohort (POSRetentionScreen KPI row) |
| 04 | Segment tabs: All Customers / Returning / Approaching Risk / At Risk / Never Visited / Recovered. Keep counts consistent with selected filters. | EXISTS — segment tabs All | Returning | Approaching Risk | At Risk | Never Visited | Recovered (+90+/180+/SMS-eligible) (POSRetentionScreen) |
| 05 | Win-Back customer list: retain six original columns; add select checkbox, Segment, SMS Eligibility, Last Contact, action; use sticky table header if necessary. | EXISTS — win-back list rows with segment reason, SMS/email eligibility and actions (rt-row, rt-segment-reason, rt-row-book) |
| 06 | Action toolbar: Select Page / Select All Matching Eligible / Clear Selection / Preview Bulk SMS / View Customer. | EXISTS — select page / select-all-matching (confirmed) / bulk preview through the plan (select-all-confirm, ai-selected, ai-eligible/excluded) |
| 07 | Reporting panels: Retention Trend, Win-Back Priority, Campaign History, Recovery Tracking, Follow-Up Activity. | EXISTS — Retention Trend, priority, campaign history, recovery tracking (rt-trend, rt-prio, open-history, open-recovery, rt-recovery-totals) |
| 08 | Overlays: Customer Details, Campaign Composer, Send Confirmation, Calendar — all with clear Close and Cancel actions. AI POWERSALON / CUSTOMER RETENTION / CLAUDE BUILD GUIDE PAGE 7 Desktop layout target: ASUS 27-inch AIO | EXISTS — customer details, campaign composer/plan, cancel confirmation, calendar overlays with Close/Cancel (rt-customer-close, ai-plan, campaign-cancel-confirm) |

## Loyalty  Rewards (14)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-Click Loyalty Accuracy Reconcile KPIs, balances, reward counts, ledger totals, tier breakdowns and Checker posted redemptions. | EXISTS — Points Outstanding KPI shows ledger matches/differs (balanceReconciled) + Check Customer & Loyalty System (loyalty-health-run) |
| 02 | One-Click Screen Fit Checker Detect clipped headings, overlapping actions, unreadable labels, invisible pager, non-reachable last records and horizontal overflow. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | Reward Eligibility Checker Preview status, tier, inventory, limits, dates and points affordability before a redemption attempt. | EXISTS — reward catalog says why a reward cannot be redeemed (avail.expired/outOfStock/tier/upcoming, notEnough) and the redeem picker blocks it (POSLoyaltyScreen.test) |
| 04 | Duplicate Earning/Redemption Flag replayed sale events, double-click credits and competing redemption Protector requests; never silently alter balances. | TODO |
| 05 | Tier Qualification Preview Show why a customer is in a tier and what rule would change the tier, using real configured criteria. | BUILT — screens/loyalty/tierPreview.ts + TierWhy in POSLoyaltyScreen MemberTierDialog: current tier threshold vs lifetime earned, next active configured tier and points to reach it, lower fit when below; no threshold → says so (tests: tierPreview.test.ts, POSLoyaltyScreen.test.tsx "explains the member tier rule") |
| 06 | Loyalty Activity Investigation Show complete source transaction history, actor and audited corrections for View authorized finance/owner roles. AI can investigate and recommend but must never move tokens, alter balances  | EXISTS — point history / audit trail per member (people.loyalty.pointHistoryOf, auditTrail, ledger dialog) |
| 07 | Redemption Reconciliation Compare points debits, reward redemptions and linked checkout/service records; highlight mismatches. | TODO |
| 08 | Wallet Funding & Liability If approved and implemented, show tenant token wallet balance and issuance Visibility funding health with authorized access. | EXISTS — Rewards Network panel: wallet levels, low/critical thresholds, reviewed token purchase (RewardsNetworkPanel rn-levels / rn-buy-review) |
| 09 | Newest-First Data Freshness Show last sync, update timestamp and clear refresh feedback for high-activity Marker salons. | BUILT — 'Updated {time}' line + one Refresh for KPIs and every list (loyalty-fresh / loyalty-refresh; POSLoyaltyScreen.test) |
| 10 | Smart Empty State No rewards or no members should present truthful guidance and authorized Create/Enroll action. | EXISTS — truthful empty states with authorized CTA (noRewards + createFirstReward, noMembers + Enroll) |
| 11 | Member Points & Tier Detail Open full customer loyalty summary with earned, redeemed, expired, adjusted and upcoming eligibility. | EXISTS — member points history + redemptions dialogs (pointHistoryOf, redemptionsOf) |
| 12 | Accessible Quick Actions Evenly sized buttons, readable labels and no hover-only shortcuts on touch displays. | EXISTS — evenly sized quick-action panel with text labels (loyalty-quick), no hover-only shortcuts |
| 13 | Multi-Branch Reporting Clarity Explicitly show selected branch vs full tenant scope and prohibit cross-tenant visibility. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 14 | Bilingual Layout QA Automated screenshot checks for both EN and VI text, long tier labels and large numbers. INTERNAL / POS LOYALTY OPERATIONS / 06 NOV 2026 ADDENDUM PAGE 16 AI POWERSALON / CLAUDE ENGINEERING MANDATE SUN | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |

## Campaign Results (7)

| # | Recommendation | Status |
|---|---|---|
| 05 | Responsive layout rules and CSS reference Technical design principles • Reuse the current shared React POS shell, design-system components, CSS variables and existing layout primitives before introducing new infrastructu | NOISE — responsive CSS reference text |
| 08 | Campaign list, filters, calendars and pagination Campaigns panel: keep original interaction • Maintain selected campaign highlighting, campaign names, SMS/email channel badges, status, dates and the original list-to-resu | TODO |
| 13 | Permissions, localization and 10k-tenant readiness Tenant & financial boundary checks • All list/search/detail/export/AI/health endpoints enforce authenticated tenant and branch scope server-side. Never trust browser-pro | NOISE — permissions/localization requirement narrative |
| 15 | My recommendations: improvements 9-16 # / Recommendation Expected behavior and guardrail 09 / Branch-Aware Date Semantics Date-mode selector with branch timezone, DST handling and clear interpretation of sent vs booked v | NOISE — recommendations table heading |
| 16 | UX / responsive acceptance matrix: 24 checks Execute these against the actual application and record environment, browser mode, CSS viewport, zoom setting, screenshot/test artifact and result. Testing on an emulator alon | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 17 | Campaign comparisons, owner-authorized multi-branch and trends • Allow selected campaigns to be compared by eligible audience, delivery rate, qualifying bookings, completed visits, associated revenue, actual costs and co | TODO |
| 20 | Reliability, real-time updates and performance • Subscribe to tenant-scoped delivery/bookings/completion/checkout/refund events using existing WebSocket/SSE where supported; fall back to measured refresh without re-sendi | NOISE — reliability/performance requirement narrative |

## Membership Overview (13)

| # | Recommendation | Status |
|---|---|---|
| 01 | Automatic viewport profile Detect available CSS space and apply responsive density without OS sniffing. | EXISTS — FitKit panels + shell compact spacing (shell/spacingPref.ts) |
| 02 | Module parity audit Snapshot route/component/action registry before and after each change. | NOISE — process instruction (parity audit); covered by check-pos-module-registry + preservation matrix gates |
| 03 | Balanced visual rhythm Unify card headers, badges, gutters and chart/body vertical spacing. | NOISE — styling instruction, no discrete feature |
| 04 | Layout Health Checker Automatically detect clipped controls and overlapping cards. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 05 | Membership Data Health Checker Verify all 5 KPIs and 4 charts against authoritative records. | BUILT — shared read-only Check Memberships System (GET pos/system-checks/memberships, components/SystemCheck); pgtest 5/5 + PG16 run |
| 06 | Full member detail drawer Expose plan, history, billing, benefits, renewal and status in a bounded overlay. | EXISTS — member detail dialog: identity, lifecycle, billing, benefits, audit (md-* in POSMembershipsScreen) |
| 07 | Expiring / past-due advisor Offer authorized, previewed outreach to eligible members; no auto-send. | EXISTS — expiring/past-due filters + previewed, permission-gated reminder send (md-reminder / reminder-send); no auto-send |
| 08 | Benefit redemption integrity Reconcile issue, reserve, redeem and reversal transitions. | TODO |
| 09 | Payment retry guard Protect renewal and checkout idempotency, especially during uncertain provider states. | EXISTS — renewal/checkout idempotency in membership-billing.repository + membership-renewal.scheduler |
| 10 | Smart subscription change preview Show how plan edits affect current vs future subscribers before approval. | TODO |
| 11 | Bilingual visual CI Test long EN/VI strings, focus, touch hit areas and no state reset. | NOISE — test instruction (visual CI), not a feature |
| 12 | Monthly finance reconciliation Connect membership collections/refunds to existing Payment/Reports ledger, not a shadow total. Priority: deliver preservation, data correctness, responsive fit, and the ten existing actions | TODO |
| 16 | Engineering blueprint: backend & mutations Code audit sequence • Locate the existing route, page component, CSS, membership models, controllers, services, queries, payment/reconciliation logic, customer-profile links, au | NOISE — engineering blueprint text |

## Device Integration Logs (13)

| # | Recommendation | Status |
|---|---|---|
| 01 | Logging Accuracy & Source Coverage Checker Compare registered sources and observed event producers to find silent gaps, stuck workers, or missing device event subscriptions. | EXISTS (part) — five verified cards over the same filters (events, warnings, errors, device, integration), "—" when unreadable |
| 02 | Clover Compact / Fiserv Trace Viewer Connect terminal events, command timestamps, provider responses and status inquiry through correlation IDs without logging card data. | TODO |
| 03 | One-Click Device Connection Timeline Show registered → connected → disconnected → reconnecting → recovered history with timestamps and provenance. | TODO |
| 04 | Error Triage & Assignment Create an authorized issue link to a log event with owner, priority, follow-up, status and audit; reuse support/incident engine. | TODO |
| 05 | Automated Alert Routing Send deduplicated actionable warnings for device offline, terminal unavailable, sync failures and critical provider errors. | TODO |
| 06 | Integration Environment Labels Clearly show UAT vs production on relevant payment logs to prevent misleading certification/readiness assumptions. | TODO |
| 07 | Read-only Screen Fit Checker At 100% zoom check viewport dimensions, clipped text/actions, scroll regions, focus and mobile keyboard overlays. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 08 | Export Sanitized Logs Role-gated CSV/JSON export with redaction and a fixed date range; evidence of exporter audit. | TODO |
| 09 | Worker Delay & Retry Visibility Show actual retry queue lag, attempt numbers and dead-letter status without creating a second retry engine. | TODO |
| 10 | Cross-module Drill-through Deep link between Device Logs, Device Health, Payment Terminals, Device Assignments and Payment Gateway with stable scopes. | EXISTS (part) — the logs page links to Device Health (TenantLogsScreen) |
| 11 | Device Firmware & Version Awareness Expose registered app/OS versions and supported firmware warnings only where the actual device inventory provides them. | TODO |
| 12 | Customer-impact Context Show if a device outage affects check-in, receipts or checkout; never infer customer identity from public hardware logs. SUNMI FLEX 3 27-inch / 1920x1080 / Front Desk POS / 100% zoom 18 AI POWERSA | BUILT — a device event’s details say what that device is for (card terminal, register, customer display, check-in kiosk) — a fixed role per device kind, never inferred from customer or hardware data (TenantLogsScreen DEVICE_ROLE + lgx-impact; test) |
| 17 | Additional operational recommendations These additions should improve an existing module, never replace it. First confirm whether they already exist in Device Health, Payment Gateway, Notifications or the Control Plane. | NOISE — heading |

## Email Management  Delivery Center (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Auto-Fit Health Check Report viewport, overflow, hidden controls, clipped labels and touch-size failures. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Responsive density presets Comfort / Standard modes that adjust spacing without shrinking content illegibly. | BUILT — opt-in Compact spacing per device (profile menu); Standard stays default; spacing only, never content size — shell/spacingPref.ts |
| 03 | Provider evidence timeline Show domain state, last successful check, callback readiness and real send events. | EXISTS (part) — provider health by layer with the next action, never green from a saved key (POSEmailScreen) |
| 04 | Email deliverability guard Prevent false Delivered states and flag provider acceptance versus completion. | EXISTS — Delivered is N/A without verified provider events, never 0 or assumed |
| 05 | Bounce/complaint hygiene Separate suppression and hard bounce, with guided approved remediation. | TODO |
| 06 | Test-send wizard Controlled recipient, preview, confirmation and full provider attempt history. | EXISTS (part) — staff-only test email |
| 07 | Draft autosave Recover typed subject/body during resize, relogin or language switch. | BUILT — composer subject + message autosave in this browser tab and come back on reopen / re-login / language switch; the recipient is not stored; a send clears it (POSEmailScreen readEmailDraft/writeEmailDraft; test) |
| 08 | Duplicate-send prevention Deduplicate retry, webhook replay and concurrent resend. | EXISTS (part) — protected Resend in Email Details |
| 09 | Template variable checker Catch missing/unauthorized placeholders before sending. | TODO |
| 10 | Customer identity confidence Warn on ambiguous tenant-local customer/contact matches before sending. | TODO |
| 11 | Delivery latency monitoring Measure accepted-to-confirmed delivery where provider supports it. | TODO |
| 12 | Email-cost/usage visibility Show provider usage/cost estimates only when grounded and authorized. | TODO |
| 13 | Accessible status details Readable failure reason, timestamps and next action beyond a color badge. | EXISTS (part) — Email Details: events, attempts and links with readable status |
| 14 | Alert fatigue control Deduplicate sustained outage alerts and require severity thresholds. | TODO |
| 15 | Audit-ready export Authorized masked export with scope, date basis and traceable actor. | TODO |
| 16 | Rollback-ready rollout Feature flags, canary cohort, staging metrics and verified revert plan. Never auto-send, auto-fix provider credentials, change DNS, alter customer permissions or perform production rollout as a sid | NOISE — rollout guidance |

## SERVICES  PRODUCTS 2 (19)

| # | Recommendation | Status |
|---|---|---|
| 01 | Responsive layout profile Use shared CSS tokens + container width checks across Front Desk POS. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | One-click screen-fit audit Check clipping, target sizes and independent scrolling at 100% zoom. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 03 | Catalog data integrity checker Report inconsistent service/category/price/status records. | BUILT — shared read-only Check Catalog System (GET pos/system-checks/catalog, components/SystemCheck); pgtest 5/5 + PG16 run |
| 04 | Inventory alert reconciliation Compare canonical stock to dashboard and sidebar counts. | TODO |
| 05 | Price change impact preview Show future booking/branch effects before owner approval. | EXISTS — service pricing impact preview before saving (GET pos/catalog/services/:id/pricing-impact) |
| 06 | Branch override comparison Side-by-side tenant default and effective branch settings. | TODO |
| 07 | Technician eligibility checker Check qualifications against branch hours and booking conflicts. | TODO |
| 08 | Duplicate scan/import prevention Block repeated SKU, product import and stock movement posting. | TODO |
| 09 | Smart search suggestions Exact code/SKU then name fallback, without cross-tenant access. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 10 | KPI cards 5 columns x 2 rows; 1:1 widths; shared All 10 labels, units, values, status meanings min-height Service / Product catalogs 2 equal-width panels; generous row height Independent search/page; readable prices/SKUs | EXISTS — KPI grid certified in the harness |
| 11 | Accurate financial chart labels Distinguish sales versus menu-price and cost-based proxies. | TODO |
| 12 | Expanded data details overlays Allow large forms without crowding summary cards. | TODO |
| 13 | Data freshness indicator Show last sync and offline/error states for relevant panels. | BUILT — Services dashboard shows Numbers updated {time} / stale-after-error (catalog-fresh; shared FreshnessLine) |
| 14 | Independent catalog pagination Preserve selection, filters and Page 1 defaults without duplicates. | TODO |
| 15 | Visual regression automation Screenshot wide/small CSS viewports, both EN/VN strings. | EXISTS — harness screenshots EN + VI |
| 16 | Permission-aware quick actions Visible, auditable, working action routing for real roles. AI POWERSALON / SUNMI FLEX 3 / SERVICES & PRODUCTS CLAUDE BUILD ADDENDUM | NOISE — row text merged with the next section heading; quick actions already permission-gated (useCan) |
| 18 | Data correctness, security and privacy • Scope every response to current tenant. The salon selector is not a substitute for backend authorization. A user cannot change tenant_id or branch_id in a request to read another  | NOISE — security / privacy requirements text |
| 22 | Required development completion report Claude must finish by presenting a clear, verifiable report with: | NOISE — completion-report instruction |
| 23 | Screenshot-by-screenshot preservation matrix (three current photos) Reference Existing visible features Verify after implementation Picture 1: top of Header; Export Data; Add New; ten KPIs; Service All visible and readab | NOISE — screenshot preservation matrix instruction |

## FOLLOW-UP QUEUE (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Screen Fit Viewport size, zoom, overflow, clipping, touch target and modal reachability. | EXISTS — Check this screen + certified harness |
| 02 | Source Data Completed services / missed-call source counts and tenant/branch eligibility. | TODO |
| 03 | Generate Now Handler, last invocation, idempotency, created/existed/skipped/failed counts. | EXISTS (part) — Generate Now kept with results (created / existed / skipped / failed) |
| 04 | Scheduler Last/next run, worker heartbeat, queue backlog, retries and dead-letter items. | TODO |
| 05 | Task State Pending/Scheduled/Skipped/Failed consistency and stale/cancelled source handling. | TODO |
| 06 | Twilio / Email Tenant sender readiness, registration, API/webhook status and recent provider errors. | TODO |
| 07 | Consent / Cooldown Opt-outs, permitted purpose, quiet hours and duplicate-message checks. | TODO |
| 08 | Search / Paging Query scope, date/timezone accuracy, stable ordering and history availability. | EXISTS — server search, filters, explicit date basis + month From/To calendar, numbered pages 10/20/50 (POSFollowUpsScreen) |
| 09 | Cross-Module Booking, Checkout, Customer Profile, Technician App and SMS Inbox reconciliation. | TODO |
| 10 | Human-in-the-Loop Sending Preview, permission, consent, sender, cost and final confirmation for discretionary sends. | EXISTS — task details with message preview, contact check, then Send / Approve; every write through the existing server send path |
| 11 | Contact Cooldown Timeline Show recently sent equivalent messages across approved SMS/email and marketing tools. | TODO |
| 12 | Safe Retry Console Review only eligible failed attempts; prevent duplicate sends and retain original evidence. | EXISTS (part) — Retry on failed tasks through the same send path (one task, no duplicate) |
| 13 | Customer Rebooking Prefill Directly open authoritative Booking with verified customer, not name-match duplicates. | EXISTS — Open Customer and Book Appointment from the task (verified customer, not name match) |
| 14 | Verified Recovery Funnel Track subsequent bookings, completed returns and associated revenue distinctly. | TODO |
| 15 | Tenant Isolation Probe Automated negative tests for cross-tenant and unauthorized branch data exposure. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 16 | Visual Regression Gate Capture SUNMI/compact viewports, English/Vietnamese labels, overlays, keyboard and touch. Three release priorities • P0: Correct zero-task causes, Generate Now, scheduler and route mismatch before  | EXISTS — certified harness screenshots EN + VI |

## Appointment History (10)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-Click Appointment History + Layout Health Check Extend the original read-only Check Appointment History System action with a UI Layout Fit section. Report viewport width/height, overflow/clipped controls, KPI consist | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Booking-to-History Accuracy Monitor Compare the authorized Booking source, Appointment History read model and Service Done completions; expose stale cache, failed worker, mismatched status or missing technician mapping w | TODO |
| 03 | Smarter Follow-up and Rebooking Review Offer a review-only shortcut to existing Rebooking Opportunities and AI Booking Assistant when a prior completed service supports it. Show whether a future appointment already exist | TODO |
| 04 | Appointment Change and Source Evidence Viewer Within the details overlay show recorded original versus rescheduled dates, who changed them, verified events and safe audit references. Keep the actual Booking event history | TODO |
| 05 | Staff-friendly Saved Filter Views Optional “Today”, “Upcoming”, “Recently Created”, “No-Shows” and “Needs Review” quick filters. Save the current staff user’s view preference only if there is a suitable existing preferen | BUILT — POS saved views (migration 844, pos/me/saved-views, components/SavedViews); pgtest 6/6, component 4/4 |
| 06 | Automated Layout Regression Pipeline Use Playwright viewport snapshots and DOM measurements at 1920×1080, 1600×900, 1440×900, 1366×768 and at reduced available sizes. Fail CI on hidden core actions, unexpected browser ov | NOISE — layout regression pipeline instruction (tooling/e2e/pos-vi-one-screen.mjs) |
| 12 | Complete Appointment Details overlay A. Header and customer context Show booking ID, scheduled time/timezone, status, branch, source channel, created/updated timestamps, customer identity and authorized contact details.  | TODO |
| 14 | Customer, completion, checkout and retention reconciliation Service completion and visits The completion count must be reconciled with Service Done and the canonical visit definition. A customer with multiple services on | NOISE — reconciliation requirement narrative |
| 16 | Loading, zero-data, disabled and failure states State Recommended user-facing behavior Loading Loading appointment history… with skeleton rows or spinner. Verified no records No appointments exist in this authorized scop | NOISE — state table text |
| 17 | Realtime behavior and source-of-truth protection Use existing Booking events and WebSocket/SSE; if unavailable, use an established safe refresh fallback. Refresh changed rows after appointment creation, reschedule, cance | NOISE — realtime requirement narrative |

## English Vietnamese POS Localization (13)

| # | Recommendation | Status |
|---|---|---|
| 01 | Display profile registry Persist tested viewport rules for SUNMI 27-inch, iMac desktop and common smaller screens. | EXISTS — display profiles decided from the live viewport (shell/displayProfile.ts densityFor) and certified sizes in the harness |
| 02 | Balanced module sizing tokens Centralize card min/max widths, rows, padding, gap and font sizing for consistent pages. | NOISE — sizing-token guidance |
| 03 | Bilingual visual screenshot CI Capture every core page in both languages with busy-state fixtures and compare against approved baselines. | EXISTS — every registered page captured in English and Vietnamese at certified + responsive sizes (pos-vi-one-screen, 147 pages) |
| 04 | Translation coverage dashboard Show missing keys, hard-coded strings, untranslated errors and glossary-review status. | EXISTS (part) — gates check-i18n (Vietnamese complete, placeholders match), check-pos-i18n (no hard-coded JSX text) and the VI draft review sheet (docs/handoff/VI_DRAFT_REVIEW.md) |
| 05 | No-removal preservation manifest Record existing modules, accessible routes, actions and permissions before layout changes. | EXISTS — module registry + preservation matrix |
| 06 | Automatic overflow inspector Highlight clipping, outer scroll, off-screen actions, and keyboard overlap with exact DOM locations. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 07 | Vietnamese typography review Use approved short labels and complete diacritics support; do not sacrifice legibility. | EXISTS (part) — Vietnamese drafts reviewed against English (batch 9 pass) and marked for Kevin's approval |
| 08 | Safe language-switch checkpoint Assert no payment/booking/queue side effects or duplicate realtime subscriptions. | TODO |
| 09 | Header language-selector usability One consistent English / Tiếng Việt switch across all tenant POS screens. | EXISTS — one English / Tiếng Việt switch in the POS header |
| 10 | Touch-first adaptive forms Sticky actions, field focus recovery and Android keyboard-aware overlays. | TODO |
| 11 | Tenant preference integrity Test persistence, tenant separation, per-user overrides and English fallback. | TODO |
| 12 | Rollback-ready release gate Block deployment on lost modules, state regressions or untranslated critical payment warnings. SUNMI FLEX 3 27-INCH / EN / VI TENANT POS / ORIGINAL MANDATE APPENDED IN FULL 17 AI POWERSALON /  | EXISTS — gates block lost modules (registry) and untranslated / hard-coded strings |
| 29 | Core POS Action Terminology Use consistent initial translations and refine them only through one shared glossary. English Vietnamese Save Lưu Cancel Hủy Close Đóng | NOISE — terminology process |

## Finish the Five Unfinished Features (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Log accepted request at authorized backend endpoint/job with correlation ID. Record actual succeeded or failed outcome after generation/delivery, not at click time. | TODO |
| 02 | Record denied attempts according to central audit policy. Prevent a sensitive export from silently bypassing required audit storage; fail closed or use an approved recoverable outbox. | TODO |
| 03 | Log metadata only. Never write raw CSV rows, full customer contact records, processor credentials, auth tokens or card numbers to audit logs. Recommendation 04 Add an export-audit Health Checker showing last attempt, las | NOISE — logging rule (metadata only) — holds: audit rows carry summaries, never CSV rows or secrets (secret scan in security-audit) |
| 04 | Evidence Trace: Click from a finding to its original service, rate snapshot, refund or authorized ledger record. | TODO |
| 05 | Manager Review Queue: Add age/status grouping to triage overdue discrepancy investigations. | TODO |
| 06 | Conflict-Free Workflows: Optimistic locking and explicit changes-since-loaded prompt for all edits. | TODO |
| 07 | Audit Coverage Dashboard: Show last verified backend export and last missing audit event, where evidence permits. | TODO |
| 08 | Refund Policy Explanation: Display policy/version/timing and reasons when a reversal cannot be verified. | TODO |
| 09 | Shift Before/After Diff: Side-by-side schedule overrides with affected booking preview before saving. | TODO |
| 10 | Booking Conflict Timeline: Use color plus text to explain overlapping shifts, breaks and assignments. | TODO |
| 11 | Score Explanation: Display weighted components, evidence counts and all exclusion rules in one overlay. | TODO |
| 12 | Version Comparison: Show model-version differences without silently reranking historical staff. | TODO |
| 13 | Graceful Failure States: Preserve unsaved work on network error; revalidation/retry tools and clear warnings. | TODO |
| 14 | Visual Regression CI: Screenshots for 1920x1080, 1536x864, 1366x768, EN/VN and keyboard states. | EXISTS — harness screenshots at 1920×945/952/1032 + 2560×1440, 1920×1080, 1600×900, 1366×768, 1280×800 in EN and VI |
| 15 | Performance & Pagination: Server-side stable sort; indexed lookups; virtualized data only where appropriate. | NOISE — performance guidance |
| 16 | Safe Release Switches: Feature flags, staging verification, rollback drill and separate production approval. AI POWERSALON / FIVE UNFINISHED FEATURES / SUNMI ADDENDUM ADDENDUM 20 SUNMI FLEX 3 / ENGINEERING ADDENDUM | NOISE — release-switch guidance |

## Campaign Center (6)

| # | Recommendation | Status |
|---|---|---|
| 01 | Smart Campaign Health & Delivery Checker Add Check Campaign System. Verify Twilio, Email, campaign scheduling, recipient eligibility, background workers and delivery failures. Explain specifically why Completed may coexi | EXISTS — Check Campaign System (cc-open-health → cc-h-findings / cc-h-trace) |
| 02 | Full Campaign Details & Customer Results Overlay Clicking any campaign, including spring into glow, opens a complete authorized overlay: selected/eligible audiences, message attempts, provider statuses, bookings, actual  | EXISTS — details overlay: Overview · Recipients · Message · Delivery Events · Bookings & Redemptions · Financial · Audit (POSCampaignCenterScreen) |
| 03 | AI Campaign Assistant With Approval Allow owners to choose inactive-customer recovery, slow weekdays, new services or repeat visits. Suggest audience/message/budget/schedule and consent exclusions. Staff must approve bef | EXISTS — Campaign Assistant drafts; launch only schedules an APPROVED campaign (cc-open-assistant; six-step flow ends in approval) |
| 05 | POWERFUL SEARCH: CAMPAIGNS VS RECIPIENTS Search must operate on the correct data domain. A reusable campaign is not itself a customer. Provide clear scopes: All Campaigns, Recipients, Delivery History, Booking Outcomes,  | EXISTS — campaigns ↔ recipients search scopes (cc-search, cc-rec-search) |
| 07 | Quick Actions (wrap) DISPLAY RULE An overview must surface every existing area. With shorter usable viewports, keep the primary table scrollable and move secondary detail into explicit expand/tabs/overlays - never silent | NOISE — display rule text |
| 15 | CONNECTED MODULES AND QUICK ACTIONS Keep the 13 existing Marketing & Growth sidebar modules plus the four dashboard cards and all seven quick actions. Use existing routes and services, not new disconnected duplicates. Mo | NOISE — connected-modules rule (sidebar modules preserved by the registry gate) |

## AI Review and Reputation (8)

| # | Recommendation | Status |
|---|---|---|
| 01 | Audit all eight tabs, six KPI definitions, external provider capabilities and existing service ownership. | NOISE — process step (audit tabs/definitions) |
| 02 | Repair review import/authorization before trusting displayed metrics. | NOISE — process step (repair import first) |
| 03 | Build the One-Click Reputation Health Checker and clear empty/unavailable states. | TODO |
| 04 | Complete Review Inbox, full details and human-controlled Response Approvals. | TODO |
| 05 | Finish Serious Complaints with case ownership, evidence and escalation. | TODO |
| 06 | Complete Feedback Trends, authorized Branch Comparison, Review Requests and Integrations. | TODO |
| 07 | Implement full-screen layout, search, From/To month calendars, numbered newest-first paging. Claude implementation guide / Reference screenshot: 2026-10-30 / Prepared 2026-11-01 14 AI POWERSALON / AI REVIEW & REPUTATION | NOISE — implementation instruction text |
| 16 | Viewport, input and workflow test matrix Test configuration Required visual and functional proof SUNMI target - 1920 x 1080 At 100% zoom capture actual layout viewport, sidebar/top-bar/main rect, eight visible/reachable  | TODO |

## Communications  SMS Inbox (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Screen Fit Viewport, clipping, overlay visibility, horizontal overflow, composer keyboard access | EXISTS — Check this screen (viewport, clipping, overlays, overflow) + certified harness |
| 02 | KPI Accuracy All 13 calculations, date scopes, unknown states, freshness and duplicate counting | TODO |
| 03 | Inbox State Conversation sorting, unread state, thread selection and persisted drafts | EXISTS — sorts Newest activity / Unread first / Longest unanswered / Follow-up due; the selection and every unsent draft are kept across live updates (POSCommunicationsScreen) |
| 04 | Provider Readiness Per-tenant Twilio, sender, carrier/A2P, inbound callback, status callback | EXISTS (part) — composer shows the truthful sender readiness when sending is blocked; provider setup lives in Messaging Setup |
| 05 | Identity & Isolation Authorized customer resolution, tenant/branch protections, unknown contacts | EXISTS — identity: linked / possible match / Unknown contact, never guessed by name; server-scoped search across the salon |
| 06 | Message Idempotency One click/request = one logical message; safe retry under timeout | EXISTS — one request key per Send; a retry is the same message (newRequestKey) |
| 07 | Consent & Policy STOP suppression, transactional versus marketing categories and audit | EXISTS (part) — inbound STOP / START / HELP keywords classified and suppression applied (packages/notifications twilio-inbound-core classifyInboundKeyword) |
| 08 | Booking Wiring Correct customer/branch prefill; confirmation and conflict checks | EXISTS — Book Appointment opens New Appointment with the verified customer preselected; Unknown / ambiguous asks to choose first |
| 09 | Campaign/AI Wiring Existing reminders, templates, review, AI calls and subscriptions | EXISTS (part) — the Timeline tab joins SMS, automated texts (reminders, follow-ups, receipts, campaigns), review requests and AI Receptionist calls |
| 10 | Realtime / History Reconnect, callbacks, load older messages, no lost draft or status data Report each check as PASS, FAIL, WARNING, NOT TESTED or BLOCKED_EXTERNAL, with evidence, owner, root cause and next action. AI re | EXISTS — live conversation_updated refresh keeps selection, scroll and drafts; older messages on demand without losing position; Live / Reconnecting / Polling shown |
| 11 | Conversation-to-booking evidence: link successful booking to source thread and prevent duplicates. | TODO |
| 12 | Missing webhook warnings: detect stale callback timestamps without inventing message failures. | TODO |
| 13 | Campaign budget protection: costs, recipient eligibility, approval summary before send. | TODO |
| 14 | Performance freshness: source timestamp plus unknown/partial metric warnings. | TODO |
| 15 | Accessible touch mode: larger targets, contrast and visible keyboard/tap focus. | NOISE — accessibility instruction |
| 16 | Visual regression suite: screenshot every module at multiple CSS sizes and EN/VN. Treat recommendations as additive proposals; do not remove an existing feature or create duplicate databases, providers or AI engines to i | EXISTS — certified harness screenshots EN + VI at multiple sizes |

## Device Assignments (11)

| # | Recommendation | Status |
|---|---|---|
| 01 | App shell Preserve sidebar, global header, branch selector and account controls. | NOISE — preservation instruction (shell untouched) |
| 02 | Header/actions Page title, context, last verified sync, Refresh, Assign Device, Check Device System; permission-scoped. | EXISTS — header with Refresh + Check Device System (dfx-refresh, dfx-check) |
| 03 | Optional KPIs If backend verified: Registered Devices, Assigned, Connected, Needs Attention; equal-height units. | EXISTS — device KPIs (dfx-kpis) |
| 04 | Search toolbar Device/station/employee search plus type, branch, station, status filters; wrap gracefully. | EXISTS — search + status/sort/date filters (dfx-search, dfx-filters) |
| 05 | Directory Device table fills available width and height; sticky column headers, row details, history and pagination. Claude implementation specification • 09 Nov 2026 06 AI POWERSALON / DEVICES & INTEGRATIONS SUNMI FLEX  | EXISTS — device table, row detail, history tab, page size (dfx-results, dfx-detail, dfx-tab-history, dfx-pagesize) |
| 06 | Device Duplicate Identity Inspector Flag multiple nicknames or unexpected duplicate fingerprints without automatically merging registered devices. | TODO |
| 07 | Suggested React/CSS auto-fit implementation Use the existing style conventions; this is a pattern, not an instruction to copy component names or replace the app shell. The shell must expose a bounded content container. / | NOISE — implementation pattern text |
| 08 | SUNMI Hardware Readiness Checklist OS/browser/touch/agent/reconnect/peripheral compatibility evidence; no fabricated provider or driver support. | TODO |
| 09 | Payment Terminal Routing Guard Link to Fiserv/Clover health, reserved busy state and authenticated register pairing; do not directly move money. Claude implementation specification • 09 Nov 2026 27 AI POWERSALON / DEVICE | TODO |
| 12 | Full Assign Device overlay: screen and actions • Opening: click a device row or “Assign Device”. Show an overlay up to the usable viewport height, with Close/Cancel consistently visible and a scrollable body. • Identity: | EXISTS — row / Manage opens the device detail overlay (dfx-detail, dfx-manage) |
| 25 | Security, audit and history integrity • Keep a tamper-evident record of device registration, state transitions, station reassignment, enrollment revocation and privileged diagnostic actions. • Capture previous and new st | TODO |

## Money Protection Rules (18)

| # | Recommendation | Status |
|---|---|---|
| 01 | Screen Fit Diagnostics Add a developer-only diagnostics readout for CSS viewport, DPR, container width, overflow and active breakpoint; hide from normal production users. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Always-visible Safety Banner Keep the blocking OFF state visible during rule browsing; surface the separate flag only from its existing protected control. | EXISTS — safety line always shown at the top of the workspace (mpx-safety); layer-off chip per rule (mpx.rules.layerOff) |
| 03 | Reliable Rule Freshness Show per-rule last evaluated time and input freshness; default to Unknown/Stale rather than false green success. | BUILT — each active rule shows when a recorded detection pass last checked it, or "Not checked since it was turned on or changed" (warn), never a false green (money-protection-center rules() lastCheckedAt; pgtest RU-02; POSAIMoneyProtectionRulesScreen.test) |
| 04 | Rule Execution Timeline Add a read-only chronological view of last runs, queue lag, errors and source events per rule. | EXISTS — read-only run history list (mpx-runs, mpx-run-row) |
| 05 | Explain Why Triggered Show matched predicate, authoritative references, threshold and exclusions in human-readable terms. | EXISTS (part) — each of the 15 rules shows what it checks and how often it fires; an alert shows its evidence |
| 06 | Duplicate Incident Suppression Use stable fingerprints and source-event IDs to prevent webhook retry noise and repeated investigations. | EXISTS — stable fingerprints dedupe repeat incidents (ai-money-protection-rules.ts / repository fingerprint) |
| 07 | Safer Batch Readiness Warn when membership, gift-card or cash close batch schedules or ledgers are unavailable. | TODO |
| 08 | Consistent Empty States Differentiate no matching rules, no recorded evaluations, permission denied, stale source and API outage. MONEY PROTECTION / RULES & DETECTION / 27-INCH LANDSCAPE ADDENDUM 19 AI POWERSALON / SUNMI | TODO |
| 09 | Threshold Change Preview Show estimated affected past evaluations in dry-run only; no production mutations. | TODO |
| 10 | Configuration Diff Viewer Expose before/after settings, actor, reason, effective date and rollback eligibility. | EXISTS (part) — a rule change needs a reason to weaken it and keeps before → after with the actor (MpRules) |
| 11 | Sensible Default Sorting New evaluations first with stable ID tiebreaker; configured rule priority never follows display order. | EXISTS — newest first with stable paging on evaluations / alerts |
| 12 | Cross-Module Evidence Links Use existing Alerts and Investigations routes, maintaining original selection and filters on return. | EXISTS — links go to the existing Alerts and Investigations routes (shared page tabs) |
| 13 | Staff-Fairness Guardrails Baseline anomalies must communicate uncertainty, minimum sample size and peer group comparability. | TODO |
| 14 | End-to-End Monitor Check Add a non-mutating readiness summary for source intake -> evaluation -> alert handoff -> human review. | EXISTS — non-mutating Money Protection check (mpx-check, mpx-health) |
| 15 | Controlled Export Export only authorized, sanitized rule/evaluation columns with filter scope and audit event. | TODO |
| 16 | Progressive Rollout Behind an existing safe Web POS feature flag, compare baseline screenshots and monitor production errors before broad rollout. MONEY PROTECTION / RULES & DETECTION / 27-INCH LANDSCAPE ADDENDUM 20 AI P | NOISE — rollout instruction |
| 18 | Additional recommendations: operations | NOISE — heading |
| 19 | Additional recommendations: governance | NOISE — heading |

## AI BUSINESS ALERTS (17)

| # | Recommendation | Status |
|---|---|---|
| 01 | Rule collision / duplicate detector - Warn when two active rules repeatedly produce overlapping alerts for the same branch, metric and time window. | BUILT — the New Alert form warns when an ACTIVE rule already watches the same metric, comparison and period (overlapping alerts); creating stays allowed — bzx-a-collision; test |
| 02 | SUNMI display profile Understand hardware dimensions versus browser viewport dimensions Visual reference provided: SUNMI FLEX 3 27-inch, landscape. The uploaded illustration labels a 1920 x 1080 (16:9) display and a devi | NOISE — display-profile background |
| 03 | Clear data freshness ribbon - Show latest metric/report refresh and last successful evaluator run; label stale or partial data. | EXISTS — Last evaluated KPI (or Never) + automatic-evaluation state shown honestly (bzx-a-last, summary.automaticEvaluation) |
| 04 | Automatic screen-fit implementation Scoped layout recipe - adapt to existing React styles instead of replacing globally Actual viewport-driven React/CSS behavior Claude should locate the current POS shell and reuse exist | NOISE — layout recipe |
| 05 | Notification unread integrity - Durable user-specific read state; badge clears across tabs/devices while incident acknowledgment stays separate. | TODO |
| 06 | Preserve rule creation and management Improve the form without changing saved rule meaning Original controls remain first-class UI Maintain Alert name, Metric, comparator (falls below/rises above), Amount/threshold, repo | NOISE — preserve rule creation (kept: New Alert row + rule table) |
| 07 | Rule change comparison - Show current vs proposed thresholds, period, sample rule and recipients before a manager confirms. | TODO |
| 08 | Budget-aware SMS protection - Estimate delivery recipient count and cost, confirm tenant Twilio readiness and prevent runaway notification loops. | TODO |
| 09 | Low sample explanation - State exact eligible sample denominator, why rules are insufficient and where to investigate missing records. | EXISTS — an evaluation records the sample and "not evaluated because the sample was too small" (POSAiAlertsScreen history) |
| 10 | Search, calendars and pagination Advanced controls must fit the touch viewport and keep filters stable Search and filters Global POS search stays unchanged. Add a dedicated Business Alerts search by rule name, metric, ru | EXISTS — alert history with search, state, date presets + From/To month calendar, numbered pages |
| 11 | Saved workspace / filter memory - Restore authorized branch, active tab, date range, search and paging after returning from details. | BUILT — rules list search, filters and page come back after a details overlay or another screen (this tab; cleared on user change/sign-out) (useSessionState; POSAiAlertsScreen.test) |
| 12 | Large-salon performance - Windowed lists, indexed rule history, bounded polling and smooth touch interactions for many techs/branches. | NOISE — performance guidance |
| 13 | Contextual source links - One click from alert evidence to the existing authoritative Sales, Booking, Staff or Customer view. | EXISTS (part) — Explain shows the measured price × volume bridge / appointment funnel behind an alert |
| 14 | Safety review and rollback - Feature flags, baseline screenshots, before/after metric reconciliation and a reversible rollout plan. No removals and no automatic business actions These recommendations add capability to yo | NOISE — rollout guidance |
| 15 | Existing Booking, Checkout, Reports, AI Center and ordinary POS operations remain functional. | NOISE — non-regression statement |
| 16 | Acceptance tests: screen and workflow Test IDs SUNMI-BA-001 through SUNMI-BA-028 Test ID Pass condition BA-001 1920 x 1080 physical SUNMI at 100% zoom: app usable with browser chrome visible. | NOISE — main-spec acceptance / instruction text picked up by the parser, not an optional extra |
| 22 | Definition of done + Claude delivery checklist ACCEPTANCE GATE: A polished screen is not completion. The alert rules, real metric computations, evaluator jobs, notification/incident states, tenant isolation, AI safeguard | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |

## Churn Watch (8)

| # | Recommendation | Status |
|---|---|---|
| 01 | Inventory Find Churn Watch UI route, components, shell, CSS, hooks, translated File paths, feature inventory and screenshots. keys and all linked modules. | NOISE — process step (inventory) |
| 02 | Baseline Run current tests; capture viewport sizes, screenshot and actual data Baseline tests, console errors and measured boxes. readiness, identify overflow/clipping. | NOISE — process step (baseline) |
| 03 | Audit data Confirm customer/visit/booking relationships, workers, retention rules, Source-of-truth map and broken/partial/missing list. six KPI semantics and permissions. | NOISE — process step (data audit) |
| 04 | Auto-fit Reuse shell; introduce local flex/grid responsive layout and equal-size Screenshots at target viewport plus regression of KPI/filter/tab components. 24-inch. | TODO |
| 05 | Workspace Repair search/date tabs/numbered pagination and expand evidence Working source-backed page flows. overlays, without removing original controls. | TODO |
| 06 | Diagnostics Implement read-only Churn Watch Health + Screen Fit Health Subsystem results and safe error states. diagnostics using existing observability. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 07 | Controls Ensure staff-reviewed actions, opt-out checks, rebooking handoff and Authorization and non-mutation tests. tenant protection. | TODO |
| 08 | Release Run UI/accessibility/API/E2E/regression, gate rollout when needed; Commands + pass/fail/skipped, changed files, rollback. report known blockers. Do not start over If a module already exists and works, leave its b | NOISE — release instruction |

## Voice Call History (9)

| # | Recommendation | Status |
|---|---|---|
| 01 | Adaptive screen-fit Owner/developer-only diagnostic showing CSS viewport size, shell content dimensions, inspector overflow/clipping hotspots and currently active density breakpoint. Never expose developer internals or P | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx) |
| 02 | Unified call processing Show provider received → recording available → transcription queued/completed → AI timeline summary completed → follow-up task created, all from verified events. Useful for investigating “empty hi | EXISTS — per-call processing status chips + pending/processing/transcribed/failed KPIs (vcx-status-chip, vcx-kpi-*) |
| 03 | Missed-call priority inbox Surface evidence-backed missed calls and unresolved requests with age/SLA indicators; deep-link to existing Voice Follow-ups, no duplicate task engine or auto-send. | EXISTS — missed-call KPI + Unresolved Requests screen (vcx-kpi-missed, POSAIVoiceTranscriptionUnresolvedScreen) |
| 04 | Transcript quality flags Warn about low-confidence speaker attribution, mixed-language audio, incomplete recordings and uncertain booking intent. Preserve original transcript, provenance and human review. | TODO |
| 05 | Call-to-booking Show verified source call, requested service, proposed schedule and authoritative traceability Booking outcome without confusing intent with confirmed appointment. | TODO |
| 06 | Operational availability Compact provider / webhook / transcription queue / search-index health chip in the ribbon toolbar; details live in Health Checker overlay, not a giant permanent dashboard tile. | EXISTS — voice system check from the header (vcx-check, vcx-health) |
| 07 | Safe configuration help When provider configuration is missing, show the authorized Voice Settings deep link, required permission and exact next action, without displaying credentials. | TODO |
| 08 | Usage and cost Where actual entitlement data exists, show authorized transcription minutes, AI usage, transparency job retries and billable status via existing usage service; never invent prices. Priority order: (a) Pres | TODO |
| 29 | Proposed API contracts and result models Inspect the existing NestJS routes and DTOs first; these are behavioral contracts, not an instruction to create duplicate endpoints. Prefer extending existing handlers. List and s | NOISE — API contract proposal text |

## Customer (10)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-click Customer Page Layout & Wiring Health Checker • A permissioned Check Customer Page button (dev/support or authorized manager as appropriate) checks viewport, scroll reachability, card overflow, missing registry  | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | One-click Customer Data & Merge Integrity Checker • Compare customer total/count definitions, orphaned foreign keys, duplicate candidates, unresolved merge conflicts, repeated gift/loyalty entries and missing consent ref | TODO |
| 03 | Customer Profile 360 overlay • One tap opens the authorized customer snapshot: profile/contact, visits, next appointment, preferences, notes, loyalty/membership, gift cards, receipts and activity. • Reuse canonical Custo | TODO |
| 04 | Smart duplicate prioritization with explicit evidence • Rank high-risk matches by verified phone/email and relevant identifiers. Display why the pair is suggested and which financial dependencies require human approval.  | TODO |
| 05 | Smart customer follow-up status • Show advisory indicators for upcoming bookings, overdue follow-up or incomplete contact verification, sourced from authorized data. • No automatic marketing message or outreach without c | TODO |
| 06 | Customer metrics explanation overlay • Tapping a KPI or analytics explanation shows exact definition, period, branch scope, inputs and last data refresh. • Make reconciliation transparent; do not add a second competing c | TODO |
| 07 | Automatic device layout calibration • Use viewport/container measurements and responsive presets. Detect and report the current effective viewport without trying to force system display density or browser zoom. • Support | EXISTS — profile menu → Check this screen + FitKit measured layouts |
| 08 | Safe import/merge staging and recovery • For customer imports or large duplicate reviews, provide a dry-run with preview of affected identities, histories and potential collisions. • Use durable audit and explicit approv | TODO |
| 09 | Performance-aware customer search • Index normalized search keys, use bounded server pages and source-appropriate caching. Measure EXPLAIN plans before changing database indexes. • Prevent huge all-customers downloads on | NOISE — performance guidance (customer search is server-paged) |
| 10 | New-module-preservation CI gate • A route/component registry and screenshot checks detect removed customer sections, missing toolbar actions, disappearing AI card and broken overlays. • Fail the build or require explicit | EXISTS — module registry gate + preservation matrix (check-pos-module-registry.mjs, pos-preservation-matrix.mjs) |

## BOOKING PHONE VERIFICATION 3 (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Tenant identity Last successful provider authentication, intended account and tenant; “Fix Credentials” routes to existing setup. | EXISTS — health check twilio_identity (ready / failed / never tested, routes to Phone & Messaging) in booking-verification-center.ts |
| 02 | Verify Service Configured service reference, service permissions, last lookup; “Review Verify Setup”. | EXISTS — health check verify_service (set / last-4 / last validated) |
| 03 | Sender readiness Applicable capability/registration state, actual delivery evidence if available; “View Messaging Setup”. | EXISTS — health check sender readiness |
| 04 | Effective policy Global/tenant/branch overrides and six source flags; “Review Settings”. | EXISTS — health check policy (effective platform/tenant source; bv-why explains the rule) |
| 05 | Recent errors Verified throttling, failed challenge, expired holds, code-delivery issues; “View Failed Records”. | EXISTS — health check recent_errors (provider errors, expired holds) |
| 06 | Integration Health of API, book-confirmation guards, database, scheduling/hold worker and event processing; “Open Diagnostics”. Status vocabulary Ready / Needs Setup / Pending Provider Action / Degraded / Failed / Unknow | EXISTS — health check integration (API, hold worker, events) |
| 07 | Verified SMS Delivery Evidence Separate sender readiness, challenge send attempts, delivery events and actual successful OTP check. | TODO |
| 08 | Visual Fit Health Check Diagnostics showing CSS viewport, DPR, sidebar width, overflow/overlap elements and text clipping in English/Vietnamese. SUNMI 27-inch engineering addendum / Original 13-page guide follows 21 / 24 | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 09 | Verification Funnel Scorecard Track requested → challenge sent → verified → hold converted → booking confirmed with definitions and verified counts. | TODO |
| 10 | Lost-Booking Recovery After an expired hold, offer fresh available times and safe restart; never auto-confirm a no-longer-available slot. | TODO |
| 11 | Tenant Configuration Comparison Show inherited/default vs branch override, effective source and approval state without exposing another tenant. | TODO |
| 12 | Provider Failure Triage Group recent failures by permission, service, sender, rate limit, unavailable service and wrong-phone conditions. | TODO |
| 13 | Locked-Down Override Registry Require an authorized, time-bound exception reason and audit evidence; default to no bypass. | TODO |
| 14 | Test Tenant Simulation Use controlled fixtures to rehearse all six channels, expiration and resend behavior without live customer charges. | TODO |
| 15 | Accessibility & Touch Audit Automated and manual tests for large touch controls, focus, keyboard popups, scroll and translation length. | EXISTS — touch / focus checked by the harness and Check this screen; certified EN + VI |
| 16 | Release Safety & Rollback Panel Show feature flags, migration readiness, last successful E2E result, rollout gate and exact rollback instructions. SUNMI 27-inch engineering addendum / Original 13-page guide follows 22 /  | NOISE — release-safety panel guidance (ops) |

## POS Top-Bar Announcements (9)

| # | Recommendation | Status |
|---|---|---|
| 01 | Authenticate employee. | EXISTS — announcements load only inside the signed-in POS shell (shell/PlatformAnnouncementBar.tsx) |
| 02 | Resolve trusted tenant + branch. | EXISTS — tenant + branch come from the server session, not the client (platform announcements snapshot endpoint) |
| 03 | Full POS application auto-fit - every route The POS front-desk shell must be responsive at the actual viewport size, not hardwired to a single development monitor. Use CSS Grid/Flexbox, fluid widths, intrinsic sizing, re | TODO |
| 04 | Render highest-priority eligible message. | EXISTS — highest-priority eligible message rendered, More for several (PlatformAnnouncementBar.test) |
| 05 | Subscribe to authorized realtime updates. | EXISTS — realtime signal refetches the snapshot (useRealtime in PlatformAnnouncementBar; test) |
| 06 | Detailed Super Admin authoring experience Preserve the existing product flow and all present controls. Add improvements only after repository audit; every new control must have real backend behavior or a visibly labeled  | TODO |
| 07 | On reconnect, refetch snapshot. RENDER: - 1 line when short. Developer / Claude Production Completion Mandate / 11 AI PowerSalon / Super Admin POS Top-Bar Announcement & Platform Broadcast | EXISTS — refetch on realtime/reconnect; one line when short, More panel when long (PlatformAnnouncementBar.test) |
| 13 | Recommended product upgrades - additive only 01 / Live Fit Diagnostics - Read-only button checks actual SUNMI viewport, overflow, header collision, truncated labels and touch target size. 02 / Audience Impact Preview - B | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 14 | End-to-end test cases - group A: viewport / touch These new test IDs supplement, and do not replace, the original mandate items 140-164. Each test result must include real browser/device evidence or a clear NOT RUN reaso | NOISE — end-to-end test case list |

## AI Usage Limits (10)

| # | Recommendation | Status |
|---|---|---|
| 01 | One-click Catalog Integrity Audit Compare all 15 product IDs, five bundles and price versions across catalog, AI Gateway and subscriptions, with discrepancy drill-down. | TODO |
| 02 | Effective Entitlement Explainer Show why each module is Active/Blocked: individual, bundle, trial, policy override, provider and last verified time. | TODO |
| 03 | Smart Cost & Quota Advisor Use real usage trends to estimate whether a plan fits; estimates explicitly labeled, no auto-buy/overage. | TODO |
| 04 | Bundle Overlap Detector Detect duplicate paid coverage and present a staff-approved review; never cancel or refund automatically. | TODO |
| 05 | Balanced module sizing: exact card rules The user’s key requirement is equal visual weight: no oversized module beside a tiny one. Use one reusable card component with content zoning and consistent padding, headings, sta | NOISE — card sizing rule text |
| 06 | Usage Anomaly & Duplicate Event Monitor Flag sudden metering spikes, duplicate IDs or stale ingestion; protect hard caps and actual records. | TODO |
| 07 | Price Change Transparency Show effective price source, version, override, grandfathering and approved comparison before any new purchase. | TODO |
| 08 | One-click Billing-to-Usage Reconciliation Cross-check invoice, active entitlements, provider confirmations and counted usage without creating new ledgers. | TODO |
| 09 | Adaptive Catalog View Preferences Allow permitted Compact/Comfortable density preference; keep all cards intact, avoid hidden data and persist per device. | BUILT — opt-in Compact spacing per device (profile menu → Compact spacing; Standard = certified default; gaps/padding only, never fonts or touch targets) — shell/spacingPref.ts + spacingPref.test 2/2 |
| 10 | Search, month calendars, history and pagination Static catalog cards (15 total) and five bundles remain discoverable through responsive search/scroll. Numbered pages apply to dynamic event history, not to hiding the comp | TODO |

## Membership Overview (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Membership Accuracy Total vs active counts, status transitions, plan scope, expiry windows, duplicate-member suspicion and meaningful source links. | EXISTS (part) — Check Memberships System (shared system checks) on the page |
| 02 | Billing & Revenue Invoices/collected/refunded amounts, provider results, renewals, pending failures and KPI-to-ledger reconciliation. | TODO |
| 03 | Benefits & Checkout Grant/consume/remaining totals, negative allowances, duplicate redemptions, actual ticket links and concurrency. | TODO |
| 04 | SUNMI Screen Fit Clipped components, scroll reachability, card size imbalance, hidden buttons, 100% browser zoom, responsive EN/VN labels. | EXISTS — Check this screen + harness certified |
| 05 | Search & Pagination Server-side phone search, member IDs, filters, date inclusivity, newest-first sort and missing/stale pages. | EXISTS — one phone-first search + presets / month calendar with date field; each tab server-paged newest first (POSMembershipsScreen) |
| 06 | Cross-Module Wiring Membership -> Customers, Booking, Check-In, Checkout, Discounts, Loyalty, Payments, Reports and notifications. | TODO |
| 07 | Communication & Consent Per-tenant SMS readiness, template approval, STOP/opt-out, delivery acknowledgment, duplicates and audit. | TODO |
| 08 | Tenant Security & Access Cross-tenant leakage, per-branch access, role-granted mutations, sensitive exports and PII audit events. AI RESTRICTIONS Checkers are read-only by default: show exact evidence, affected source re | TODO |
| 09 | Lifecycle Change Audit Visible authorized log for pause, resume, renewal, cancellation and plan changes. | EXISTS — Member Details → activity + audit (lifecycle changes) |
| 10 | Member Communication Offer consent-aware reminder preview and estimated per-tenant messaging cost. Preview | TODO |
| 11 | KPI Source Tooltips Define date scope and metric meaning; differentiate snapshot count from selected-period events. | EXISTS — each KPI states snapshot vs this-month scope and opens its list |
| 12 | Export Scope Review Show authorized row count, filters and data sensitivity before export. | BUILT — membership exports read the rows first, then a preview shows the real row count and scope; the CSV is written only after Download (ExportPreview in POSMembershipsScreen; test) |
| 13 | Touch-Safe Quick Actions Keep all ten existing actions in a consistent, balanced two-row bar. | EXISTS — the ten Quick Actions kept under every tab |
| 14 | Data Freshness Indicator Show refresh status/last successful update when data may be stale. | BUILT — last successful update on Membership Overview (memberships-fresh) (shared FinanceKit useFreshAt/FreshnessLine; components/FreshnessLine.test.tsx) |
| 15 | Reconciliation Drill-Down From discrepant KPI to source ledger/receipt/benefit event for authorized staff. | TODO |
| 16 | Visual Regression Gate Automated checks at native and scaled effective viewports in EN and VN. Implementation requirements / 07 Nov 2026 Addendum page 20 AI POWERSALON / MEMBERSHIP OVERVIEW SUNMI FLEX 3 / CLAUDE IMPLEMEN | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |

## GLOBAL LOYALTY  REWARDS (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Auto-fit diagnostics Show detected viewport, zoom, overflow regions and component measurement test | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Balanced-card layout system Reusable KPI/side-panel sizing tokens across all tenant POS modules | NOISE — layout-token guidance |
| 03 | Wallet low-balance forecast Estimate days until depletion using verified trailing allocations; label as estimate | BUILT — wallet panel shows an estimate of days of tokens left at this month’s verified pace (labelled Estimate; no use → no estimate) (walletForecastDays + rn-forecast; walletForecast.test) |
| 04 | Purchase status timeline Requested → processing → verified / exception, with provider timestamps | EXISTS (part) — purchase detail (purchases/:id); nothing spendable until the provider verifies the funds |
| 05 | Customer rewards explainer Show where points came from, when spendable and which rule version applied | TODO |
| 06 | Redemption preview Show rewards applied, due after discount and why amount is eligible | TODO |
| 07 | Reimbursement drill-down Explain PAYABLE/PROCESSING/PAID with actual provider and journal evidence | TODO |
| 08 | Smart authorized filters Remember non-sensitive filter state; deep-link safe reports, not PII in URLs Implementation condition Do not ship a new feature as a stub or fake metric. Each recommendation requires a backend so | TODO |
| 09 | Daily double-entry integrity Flag unbalanced token/points/funding journals; human-reviewed correction only | TODO |
| 10 | Stale-provider indicator Show last settlement verification and distinguish pending from unknown | TODO |
| 11 | Idempotency conflict center Investigate repeated purchase/earn/redeem keys without double side effects | EXISTS (part) — one request key per token purchase, re-sent on a lost answer, so a retry never charges twice |
| 12 | Fraud/risk queue Review refund loops, employee self-awards and sudden cross-salon spend safely | TODO |
| 13 | Branch usage attribution One tenant wallet with truthful branch-level earning reports and no double funding | TODO |
| 14 | Rule-change simulator Compare old/new funding exposure before centrally approved effective date | EXISTS (part) — earning rule preview before activation; scheduled changes cancelable before they start |
| 15 | Automated visual regression Capture EN/VN and desktop/compact screenshots as part of release gates | EXISTS — certified harness screenshots EN + VI |
| 16 | Owner finance audit trail Download/export backed purchases, allocations, payouts and exceptions safely Do not silently introduce an auto-funding rule Auto-reload is OFF unless an owner affirmatively consents and provider | TODO |

## Checkout Upsell Assistant Settings (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Responsive Layout Health Indicator. Developer/admin diagnostic records content overflow, clipped elements, CSS viewport dimensions, scroll ownership and failed component render; do not expose to staff unnecessarily. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Exact preservation contract Claude must reconcile repository reality with both the source PDF and the prior screenshot before changing any existing behavior. Preserve precisely What it means in the upgraded application R | NOISE — preservation contract |
| 03 | Memberships Show eligible active plans, recurring terms and existing membership state; no automatic signup or billing. | TODO |
| 04 | Automatic full-screen fitting: correct contract The goal is 100% usable fit at 100% zoom, not artificially shrinking an entire 1920 × 1080 design into every browser window. Requirement Implementation and acceptance condi | NOISE — fitting contract |
| 05 | Loyalty redemption Use authoritative current points, tenant-funded tokens, exclusions and approved redemption transaction. | TODO |
| 06 | Recommended complete screen arrangement A two-card, equal-width top configuration avoids one enormous module next to a tiny one. Dynamic data occupies the lower pane. AI POWER SALON / BRANCH Search Notifications Owner SA | NOISE — layout recommendation |
| 07 | Responsive layouts across device sizes The SUNMI landscape target is primary, but the same Web POS must remain usable across the existing 24-inch POS, windows and touch devices. Viewport / state Expected adaptation Wide  | NOISE — responsive guidance |
| 08 | React / CSS: viewport-safe shell Illustrative code only. Claude must adapt selectors to the existing codebase and use the actual shared POS layout rather than replace it. /* Scope these rules to the existing Checkout Ups | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 09 | Touch Accessibility Audit. Automated screenshot/interaction checks for 44px targets, focus, contrast, EN/VN wrapping, portal modals and reduced window height. | EXISTS — harness touch / focus checks; certified |
| 10 | Safe Rollout and Rollback. Feature-flag incremental UI rollout, baseline/after screenshots, compatible old clients, monitoring and reversible CSS/API changes. CHECKOUT UPSELL ASSISTANT SETTINGS • CLAUDE BUILD HANDOFF Add | NOISE — rollout guidance |
| 11 | Full-screen layout and user interaction specification • Keep fixed POS sidebar/top bar and original design tokens. The content area should fill remaining viewport height at 100% zoom; use min-height/overflow-y auto, not  | NOISE — layout specification |
| 13 | Enable state, policy and safe settings changes Separate “enabled at this salon” from actual eligibility to execute AI recommendations and from payment authority. Independent state Source / display requirement Salon prefe | TODO |
| 14 | Searchable history and full-width tabs Search/Date/Pagination belong to activity and audit histories, not to the 7 switches or 3 static limits. Suggestion Activity Authorized customer name, phone, customer ID, ticket or  | EXISTS — searchable history (ucx-history-search) with date and paging on the settings page |
| 15 | From/To calendars and stable pagination Add month calendars and numbered pages to dynamic records. Make every control work at 1920 × 1080 and in a compact browser window. Calendar and search contract • From Date and To D | EXISTS — From/To month calendar (ucx-preset-custom + RangeCalendar) and numbered pages |
| 18 | Data, API and event implementation contract (illustrative) Names below are conceptual; discover existing routes, tables and event types first. Reuse real application interfaces instead of creating duplicates. Any new end | NOISE — illustrative contracts |
| 19 | Operational logging, monitoring and recovery • Trace a recommendation from configured policy version to source IDs, eligible-candidate decision, display, staff review and authoritative outcome. Store privacy-safe identif | NOISE — logging guidance |

## Customer Retention  Win-Back (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Operator selects authorized tenant and branch scope, enters 856 into Area Code, then chooses Find Customers (or an explicit immediate-search behavior). | TODO |
| 02 | Search displays all matching stored customer telephone numbers from this authorized salon tenant, across all result pages; show customer name, masked/unmasked phone according to role, last completed visit, inactivity, se | TODO |
| 03 | Show counts: Matching customers, Matching phone numbers, Eligible contacts, Excluded contacts. Numbers are not necessarily one-to-one with customers. | EXISTS — eligible vs excluded counts with exclusion reasons on the win-back plan (ai-selected, ai-eligible, ai-excluded) |
| 04 | Provide one-by-one checkboxes; Select This Page; Select All Matching; Deselect All; and a clear selection summary. See the dedicated selection contract later. | EXISTS — Select page / Select all matching eligible / Clear in the selection bar (POSRetentionScreen) |
| 05 | Operator may combine Area Code with inactivity thresholds (30/60/90/120/180/365 days), last visit range, Never Visited toggle, and other existing search filters. | EXISTS (part) — Priority / SMS / Visits filters, segment tabs incl. 90+ · 180+, period with date basis |
| 06 | Choosing Create Campaign passes a validated selection to the existing Campaign Center as a draft/audience preview only, not as a sent message. | EXISTS (part) — Create Win-Back hands the selection to Campaign Center as a draft |
| 07 | Show helpful examples and an empty result when the code has no matching stored numbers. Do not invent numbers or search across other salons. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 08 | Existing Offer Selector: attach approved promotions/coupons using the existing Checkout redemption and stacking rules; no new standalone discount engine. IMPLEMENTATION DISCIPLINE Add only where genuinely missing. Avoid  | TODO |
| 09 | One-Click Audience Health: show which selected records have invalid numbers, no consent, no prior visits, or upcoming bookings before review. | EXISTS (part) — bulk SMS preview checks consent, opt-out, phone, recently contacted, upcoming booking, never visited (server) |
| 10 | Phone Contact Verification: track verified/unverified reachable numbers without modifying customer identities or inferring consent from verification. | TODO |
| 11 | Duplicate Contact Protection: show where multiple customer profiles share a phone; preserve distinct profiles while preventing unintended repeated outreach. | TODO |
| 12 | Before/After Snapshot: capture filter, segment rules, and customer count on campaign creation and compare recovered visits later with appropriate caveats. | EXISTS — campaign history with before/after comparison table (hist-compare-table, hist-counts) |
| 13 | Rebooking Shortcut: allow reception to book a selected customer with canonical ID, nearest qualified technician, and existing booking validation. | TODO |
| 14 | Quiet-Time Filling: identify historically slow days and recommend preapproved offers only; no automatic price changes or sends. | TODO |
| 15 | Bulk Selection Guardrails: clear warning for selection over an admin-configured size, confirm count and criteria, and support safe cancel/undo before approval. | TODO |
| 16 | Performance Monitor: report query latency, error rate, invalid-phone counts, message failures, and rendering issues with tenant-safe diagnostics. RISK LEVEL Start with data correctness, area-code filtering, selection and | NOISE — monitoring instruction (latency/error-rate telemetry), not a screen feature |

## TECH APPOINTMENTS (16)

| # | Recommendation | Status |
|---|---|---|
| 01 | Auto-fit Diagnostics Detect viewport overflow, clipped controls and touch-target issues. | EXISTS — profile menu → Check this screen (shell/ScreenCheckDialog.tsx, rules in shell/screenCheck.ts: fit, horizontal, clipped, overlap, touch, balance, in-view, modules, realtime, display); CI screenshots EN+VI at 1920×945/952/1032 (tooling/e2e/pos-vi-one-screen.mjs) |
| 02 | Availability Confidence Show verified/estimated/stale source and refresh timestamp. | TODO |
| 03 | Status Explanation Reveal why a technician is available, off-shift, serving or on break. | EXISTS (part) — each technician card shows its status, booked / free minutes and next appointment (POSTechAppointmentsScreen) |
| 04 | Gap Finder Highlight usable continuous gaps for selected service length. | EXISTS (part) — open slots on the Day board + Find Next Available Technician (booking engine openings for a service length) |
| 05 | Conflict Preview Show collision before final booking or reassignment. | EXISTS — Schedule Conflict Warning (every cause + alternatives) before booking / reassigning |
| 06 | Exact-Time Tooltip Show appointment actual start/end and time buffers. | TODO |
| 07 | Quick Full-Day Peek Open contextual full-day overlay from each technician card. | EXISTS — View Full Day from each technician card |
| 08 | Pending Verification Show SMS-required/pending without pretending booking confirmed. | TODO |
| 09 | KPI cards Equal min-height, aligned labels/values and icon slots. Use responsive grid; avoid one oversized KPI. Allow 5+4 or balanced 3×3 if measured widths require it. 3 technician cards Grid with equal card heights and | EXISTS — nine KPI cards in the certified grid (harness) |
| 10 | History Diff Display before/after schedule changes with actor and reason. | EXISTS (part) — Recent booking changes from the appointment change log, newest first, with actor (own period and pages) |
| 11 | Data Freshness Warn when live stream disconnected or API query stale. | BUILT — Numbers updated {time} after a successful read; a failed refresh says the numbers are from the last good read (ta-fresh; shared FreshnessLine) |
| 12 | Keyboard & Touch QA Add automated focus/touch-target/visible-dialog checks. | EXISTS — the harness checks focus/touch targets and visible dialogs; Check this screen on demand |
| 13 | Narrow-Screen Adaptation Adapt KPI columns and timeline scrolling without zoom tricks. | EXISTS — responsive sizes certified (1366×768, 1280×800) without zoom |
| 14 | Empty State Actions Offer New Booking, Change Date, or Find Next Available. | EXISTS — empty list offers Clear filters and Find Next Available Technician (empty-clear, cta-finder, open-finder) |
| 15 | Appointment Audit Preview Preview allowed transitions and impact before commit. | EXISTS — Schedule Conflict Warning with every cause + alternatives before rescheduling (act-check-conflict, dlg-conflict) |
| 16 | Permission-Aware Actions Do not show unsupported or forbidden action buttons. Build guide addendum • Original owner-approved 12-page guide appended unchanged Addendum 22 / 24 AI POWERSALON / SUNMI FLEX 3 2026 / ENGINEERI | EXISTS — actions follow permissions; the server re-checks (original actions kept) |

## Customer Search (10)

| # | Recommendation | Status |
|---|---|---|
| 01 | Smart Search Match Explanation Show why a customer matched (exact ID, verified phone, email, name prefix, allowed fuzzy match). This aids safe family/duplicate disambiguation without exposing hidden records. | EXISTS — per-row match chip says why it matched (csx-matched, csx.match.{matchedBy}) |
| 02 | One-Click Search Data Freshness Badge Show authorized last successful customer index sync; link stale index to the read-only Health Checker. Do not claim “up to date” without verification. | EXISTS — updated time on the results (csx-updated) + search check (csx-check) |
| 03 | Balanced Customer 360° Dashboard Use equal-width detail cards and consistent tabs for bookings, services, loyalty, AI, duplicate review and retention; preserve all data sources and actions. | TODO |
| 04 | Customer Identity Collision Warning Display “Multiple possible matches” for shared phone/name with separate candidate rows; require explicit selection and approved Duplicate Review. | EXISTS — shared-phone marker + possible duplicates in the overlay (csx-shared, ov-duplicates) |
| 05 | Recent Searches & Filters (optional) Store only authorized, short-lived user preferences after privacy review; avoid persisting raw PII or making customer search history visible to other employees. | TODO |
| 06 | Operational Search Performance Panel Expose safe search latency, stale indexes and import status inside diagnostics, with no unrestricted database statistics or PII leakage. | EXISTS (isolation part) — enforced in CI: check:tenant (every query keyed by the session tenant), src/common/idor-route-coverage + scripts/idor-routes.mjs (another salon's id → not found, every by-id route), role matrix (apps/api/scripts/role-matrix.mjs), check:audit-writers; any page-specific remainder of the row is not built |
| 07 | Consistent Branch Scope Indicator Keep an always-visible read-only “Searching Current Branch / Authorized Branches” label to avoid staff confusion in multi-location businesses. | EXISTS — scope indicator (csx-scope) and branch filter for multi-branch |
| 08 | Touch-Friendly Customer Preview On row tap, offer concise identity-safe preview and View Full Profile; avoid disruptive full-screen switches for every accidental tap. | EXISTS — row opens a concise overlay with View Booking / Book (csx-overlay, ov-*) |
| 09 | Direct Related-Module Navigation Keep authorized links to Booking, Rebooking, Duplicate Review, Churn Watch, Loyalty and Customer AI Settings without reproducing their business logic. | EXISTS — overlay links to booking and duplicate review (ov-book, ov-view-booking, ov-dup) |
| 10 | Automatic Responsive Layout Regression Suite Run viewport snapshots on CI for 1920×1080, 1600×900, 1366×768 and browser-chrome reductions to catch clipped controls after future releases. NEW IMPLEMENTATION ADDENDUM / ORI | NOISE — CI viewport regression instruction (tooling/e2e/pos-vi-one-screen.mjs) |

## Approvals Management Authorization Center (1)

| # | Recommendation | Status |
|---|---|---|
| 01 | Verify approval-to-execution reconciliation. 2. Provide urgent escalation without auto-approving. 3. Centralize rules so local settings cannot weaken Super Admin protections. CONFIDENTIAL IMPLEMENTATION GUIDE • SCREENSHO | BUILT (part) — Check Approvals System: approved-not-executed + execution failed + pending past expiry (point 1); points 2–3 not built |
