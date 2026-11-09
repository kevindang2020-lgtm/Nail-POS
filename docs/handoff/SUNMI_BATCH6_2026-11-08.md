# SUNMI batch 6: Customer AI, AI analytics / plans / OCR, voice transcription, reviews, inventory, checkout upsell, Money Protection (Nov 8 2026)

Kevin sent 20 PDFs (Nov 8, evening). Each is a SUNMI FLEX 3 addendum placed in front of an original guide that was built on
Nov 1–3. Every addendum allows vertical page scroll in the main workspace and forbids sideways scroll, CSS scale, forced zoom
and removing modules.

## Pages certified (module registry)

| Key | Route | Guide |
|---|---|---|
| cust-recs | /tenant/ai/customer-profile/recommendations | Service_Recommendations_5 (6 KPIs, 7 review tabs) |
| cust-rebooking | /tenant/ai/customer-profile/rebooking | Rebooking_Opportunities (4 tiles) |
| cust-ai-search | /tenant/ai/customer-profile/search | Customer_Search (**Churn Watch + Rebooking statuses added**) |
| cust-dupes | /tenant/ai/customer-profile/duplicates | Duplicate_Review (6 status tiles) |
| cust-ai-overview | /tenant/ai/customer-profile | Customer_Intelligence (6 KPIs, 6 views) |
| ai-plans | /tenant/ai/plans | AI_Plans_Packages (**five tabs added; purchase-overlap preview**) |
| ai-forecasting | /tenant/ai/analytics | AI_Analytics_Forecasting (**six readiness cards**) |
| receipt-scanner | /tenant/ai/receipt-scanner | OCR_Receipt_Scanner (4 KPIs enforced; was certified earlier) |
| voice-settings | /tenant/ai/voice-transcription/settings | Voice_Transcription_Settings (**not-subscribed state fixed**) |
| voice-search | /tenant/ai/voice-transcription/search | Voice_Transcription_Search_Call_History (**4 cards**) |
| voice-history | /tenant/ai/voice-transcription/history | Voice_Call_History (**8 cards; list load bug fixed**) |
| ai-reviews | /tenant/ai/reviews | Review_Reputation |
| ai-inventory | /tenant/ai/inventory | AI_Inventory_Assistant (**6 KPIs + 4 buttons on every tab**) |
| ai-fraud | /tenant/ai/fraud-protection | AI_Fraud_Money_Protection |
| checkout-upsell | /tenant/ai/checkout-upsell | Checkout_Upsell |
| cust-insights | /tenant/ai/customer-insights | Customer_Profile_Assistant |
| mp-settings | /tenant/ai/money-protection/settings | Money_Protection_Settings (**status row**) |
| mp-rules | /tenant/ai/money-protection/rules | Money_Protection_Rules (**7 tiles, 8 named columns**) |
| mp-alerts | /tenant/ai/money-protection/alerts | MONEY_PROTECTION_ALERTS |
| money-protection | /tenant/ai/money-protection | AI_MONEY_PROTECTION_5 (same guide as batch 5; re-verified) |

## Bugs found and fixed

1. **Voice Call History never loaded.**
   - Every load answered `INVALID_SORT "direction must be asc or desc"`. The shared list-query parser read the screen's
     inbound/outbound `direction` FILTER as a legacy sort direction.
   - Fix (packages/database `list-query.ts`): a parameter a route declares as its own filter is never read as a sort
     direction. This is the same rule the Nov 7 fix gave `sort`. Unit test added.
2. **Voice Transcription Settings said "You do not have access" to the owner.**
   - The real reason was `AI_VOICE_TRANSCRIPTION_DISABLED` (no subscription).
   - The guide asks for "blocked by entitlement" to be labelled on its own. The page now says the salon is not subscribed, links
     to AI Plans, and stays readable: the saved policy is shown read-only, and records and the health check are still reachable.
     Saving is off until the salon subscribes.

## Built from the guides

1. **Customer Search status list (§09):** Churn Watch and Rebooking Opportunity, "when source-backed".
   - The source is the Customer Intelligence snapshot that Churn Watch and Rebooking read: `churn_level` possible / elevated /
     high, or an open `rebooking`.
   - Server-side and tenant-scoped. Archived customers stay out. pgtest added.
2. **AI Plans five tabs (§07):** Packages | Individual AI | My Subscriptions | Billing History | Usage & Limits.
   - Packages is the plan page. The other four open the ONE authoritative AI Usage & Limits screen at that view
     (`?view=catalog | subscriptions | billing | usage`).
   - Billing opens the cost & invoices dialog, only for a role that may see cost. No second copy of billing data.
3. **AI Plans purchase-overlap preview (money).**
   - Starting a plan leaves assistants the salon already pays for on their own untouched, so the salon could pay twice after
     the trial.
   - `GET /tenant/ai/plans` now returns `overlap { owned[], ownedMonthlyCents }`.
   - The card names those assistants with their price. Start trial warns before confirming. Read-only.
4. **AI Analytics & Forecasting: six readiness cards** (original §C) for the selected mode: Available history, Required history,
   Valid records, Forecast readiness, Last forecast, Data quality. Every value is from the source. A role without the financial
   permission is told so, not shown zeros.
5. **Voice cards:**
   - **Call History, 8 cards:** Total, Incoming, Outgoing, Missed (from the call log), Completed transcriptions, Processing,
     Failed, Follow-ups needed.
   - **Search, 4 cards:** Total, Transcribed, Pending / failed, Needs follow-up.
   - The earlier figures stay as sub-lines (last 7 days, not transcribed, failed in 7 days).
   - The server summary gained the real counts. pgtest added.
6. **AI Inventory:** the six KPI cards were only on the Command Center tab. The six cards and the four buttons now stay together
   on every tab. The Command Center detail shows only on its tab.
7. **Money Protection Rules:**
   - Seven even tiles: Total, Enabled, Disabled, Exact comparison, Normal levels, Reconciliation, Not running.
   - The guide's eight named columns: Rule, Category, Layer, Severity, Mode, Thresholds, Human review, Status. The alert
     counts and actions are kept.
   - "Rules with errors" is shown as **Not running** (switched on, layer off), the only per-rule failure the system records.
8. **Money Protection Settings:**
   - Status row: Rules, Enabled, Running, Not running, Overridden.
   - No "Pending" card, because no pending state exists. The guide allows 3–6 cards.
   - The configuration table now has headers.

## Touch / fit fixes

- Money Protection Rules / Settings row actions:
  - They now have 44 px hit areas, vertical only.
  - Rules stacks View / See its alerts. Before, in Vietnamese, "Xem cảnh báo" broke across two lines and ran past the table.
- Voice Settings: the inline History / Search / Follow-ups links get `.link-44`. The records pager gets row spacing.
- The Money Protection sub-page tab row wraps instead of scrolling sideways.

## Test harness fix

`tooling/e2e/pos-vi-one-screen.mjs`: the browser window is an edge. A control flush with the bottom of the window was reported
"short" because `elementFromPoint` returns null outside the window and on its last sub-pixel row.

## Additional recommendations (decision rule: money or safety, and nothing already checks it)

| Recommendation | Status |
|---|---|
| AI Plans: purchase overlap / duplicate-charge preview | **BUILT** (see above) |
| Every "One-Click … Health Checker" | Already built on every page (Check … System) |
| Every "Screen-fit / layout health checker" | Already built: profile menu → Check this screen |
| OCR: posting readiness / duplicate checks | Already built: Receipt Review approvals, duplicate detection, amount checks |
| Service Recommendations: trust & freshness, action-safe handoffs | Already built: freshness strip, caveats, review-only actions |
| Others (saved views, heatmaps, comparisons, simulators, presets) | Not built: product features with no money / safety risk |

## Verified this session (Nov 8–9 2026)

- Screen harness, every registered page (MODULE_SET=all, 1920×945 / 952 / 1032, EN + VI): **660/660**.
- POS 2130 tests, API 3279, module suites customers 501 / ai 2450 / super-admin 2061, database package 103: all pass.
- Gates: all 57 gates + 25 audits. Lint 0 / 0. API typecheck clean.
- `security-audit.mjs --full`: no failed checks (32 passed, 4 not verified, which need external systems).
- Pilot day on a fresh migrated database: **242/242**.
- New Vietnamese strings are marked DRAFT (VI review sheet: 286 rows).
