# AI Usage & Limits — Complete Build Guide handoff (Oct 30 2026)

Source: *AI PowerSalon AI Usage & Limits — Complete Claude Build Guide* (12-page PDF + owner photo). Route kept:
`/tenant/ai/usage`, menu entry, salon selector and shell unchanged. Local commit only — **not pushed, not deployed,
migration 723 not run in production, no billing provider called, no card charged**. All test data are fixtures.

## 1. Audit — what the photo showed and why

| Photo symptom | Root cause found in the code | Fix |
|---|---|---|
| "Trial" chip + "Your free trial has ended — upgrade" + **Cancel** on the same card | the page showed the STORED status (`trialing`) while the access gate (correctly) denies a lapsed trial; the trial sweep is off by default, so rows stay `trialing` | one pure state mapping (`ai-usage-states.ts`): a lapsed trial is **Trial expired**, offers Upgrade, never Cancel |
| "Cancelled" card still offering actions / "Upgrade required" repeated | actions were chosen client-side from `subscription` only; the legacy cancel endpoint returned `ok` even when nothing changed | server-computed `actions[]` per state × permission; legacy `cancel()` now only cancels a live row and reports a real change |
| usage counters (e.g. 0 / 1,000) not matching enforcement | the packages list summed **all-time** usage; the gate counts the **current period** | both the new screen and the legacy `/tenant/ai/packages` count successful usage since `current_period_starts_at` |
| "Monthly AI cost" | summed catalog list prices of active rows; ignored yearly plans, trials, past due | verified cost from subscription prices (yearly ÷ 12, labelled), trials listed apart, past due flagged, "reconciled" only when every paying package has a recorded payment this period; restricted to `subscription.manage` |
| tiny text, 11+ cards crammed | a 4-column Tailwind grid with every paragraph on every card | the fit layout below |
| (not visible) re-trial after cancel | `startTrial` allowed a new trial for a cancelled / expired package (unlimited free months) | one trial per package per salon (server-checked in both the legacy and the new endpoint) |
| (not visible) Super Admin global disable | "Phase 4" — `packageEnabled: true` hard-coded in the gate | `platform_ai_package_settings` read by the gate; **Disabled by admin** on the screen |
| sidebar badge `aiUsageAlerts` | always 0 | open 80/90/100 % alerts of the current periods |

Package inventory (all kept, catalog order): the 15 codes of `modules/ai/src/ai/ai-catalog.ts` — booking, phone call,
queue + technician assignment, scheduling optimizer, business, marketing, customer profile, checkout + upsell, fraud /
money protection, inventory, reception copilot, review / reputation, voice transcription, OCR receipt scanner,
analytics / forecasting — **plus** any subscription row whose code the registry no longer knows (shown as "Unknown package",
never dropped).

## 2. State → action matrix (`modules/super-admin/src/tenant-ai/ai-usage-states.ts`)

| Display state | From | Actions (owner: ai.manage + subscription.manage) | Manager (ai.use) |
|---|---|---|---|
| Disabled by admin | platform switch off, or tenant row `disabled` | View details | same |
| Trial available | no row, trial days > 0, never trialled | Start Trial, Upgrade | View |
| Not subscribed | no row, trial already used | Upgrade | View |
| Trialing | `trialing`, end in the future | Cancel, Upgrade, Open module | View, Open module |
| Trial expired | `trialing` past its end, or `expired` with no payment ever | Upgrade | View |
| Active | `active` | Cancel, Open module | View, Open module |
| Past due | `past_due` / `unpaid` | Cancel, Update billing | View |
| Cancelled / Expired | `cancelled` / `expired` (paid before) | Reactivate | View |
| Suspended | `suspended` | View | View |
| Unable to verify | any other stored value | View | View |

Upgrade / Reactivate / Update billing open **Billing** (`/tenant/account/subscription`) — paid activation is not
self-serve in this codebase and this page never charges. Start Trial and Cancel: confirmation text (price after trial /
"stops right away"), client idempotency key (unique per salon), `expectedStatus` re-check (409 `AI_STATE_CHANGED`),
advisory lock, the subscription change + `tenant_ai_subscription_events` row + fail-closed `audit_events` row in one
transaction, then the page re-reads the server.

## 3. Owner priorities

1. **Verified monthly AI cost** — `summary.cost`: recurring monthly (subscription prices; yearly ÷ 12 labelled), lines per
   package with "payment recorded this period", trials (not cost, price after trial), estimated overage (only with
   overage on, labelled an estimate), last billing event; basis `reconciled` / `subscription_records` / `no_paid_packages`.
   Never a sum of catalog prices for packages the salon does not have.
2. **80 / 90 / 100 % alerts** — `ai_usage_alerts` (unique tenant × package × period × threshold), written by the usage
   logger after every successful call and backfilled on read; one line per package on the page (highest threshold),
   "Got it" acknowledges that threshold and the lower ones; the sidebar badge counts open ones. An alert never upgrades,
   charges or raises a limit (pgtest checks the row is unchanged). At 100 % the existing gate already blocks
   (`limit_exceeded`) unless overage is on — the page says which.
3. **One-click Package Details** — the whole card surface (mouse, Enter, Space) opens a dialog with Overview · Subscription ·
   Usage (period, allowance, remaining, daily bars, alerts) · Billing (owner only) · History (salon changes, platform
   changes from `audit_logs`, billing events) · Settings (platform switch, stored status, limit source, overage). The
   card's own button keeps its action; Escape / Close return focus to the card and keep search, filters and page.

## 4. Layout (guide §4–§6)

Header (title, helper text, "Checked …", Refresh, Usage History) · four KPIs (Total Packages, Active Subscriptions,
Trials / Pending, Verified Monthly Cost) · one alert line (+N more) · toolbar (search across name / description / code /
category / POS area; status segments with counts; category; sort: catalog · name · newest subscribed · usage % · cost) ·
card grid: 4 × 2 = 8 per page when the grid's CSS width ≥ 1180 px, 3 × 2 ≥ 860, 2 × 2 ≥ 560, else 1 column — page size
follows, so pages stay consistent · numbered pager with "Showing x–y of z". Each card: name, category, state chip,
two-line purpose, price / frequency, one `used / allowance unit · %` line (unlimited and not-metered say so — no invented
%), bar, level badge, reset / trial date, one primary action.

## 5. Files

Backend — `apps/api/db/migrations/723_ai_usage_limits_screen.sql`; `modules/ai/src/ai/ai-usage-alerts.ts` (new),
`ai-access.kysely.repository.ts` (platform switch in the gate snapshot, alert hook in the usage logger), `modules/ai/src/index.ts`;
`modules/super-admin/src/tenant-ai/ai-usage-states.ts`, `ai-usage-screen.repository.ts`, `ai-usage-screen.controller.ts`
(new), `tenant-ai.module.ts`, `tenant-ai.service.ts` / `tenant-ai.repository.ts` (period usage, one trial per package,
honest cancel, platform switch); `modules/super-admin/src/super-admin-ai/ai-admin.service.ts` / `.controller.ts` (global
availability, its audit through the file's one audit writer); `modules/super-admin/src/request-schemas-ai.ts`;
`modules/tenants/src/tenant-navigation/tenant-navigation.service.ts` (badge).
Frontend — `apps/pos-web/src/screens/POSAiUsageScreen.tsx` (rebuilt), `apps/pos-web/src/api/posAiUsageApi.ts`
(`posAiUsageScreenApi`; the legacy client stays for the AI Center / package screens), `apps/pos-web/src/i18n/ns/aiusage.{en,vi}.ts`
(203 keys), `styles.css` (`.aiu` block), screen tests rewritten.
Harness — `tooling/catalog-one-screen/aiusage-extra.mjs`, `interact-aiusage.mjs`, `pages.mjs` (`ai-usage`, fit mode).

## 6. API (all tenant routes: TenantAuthGuard + RolePermissionGuard, tenant from the session)

| Route | Permission |
|---|---|
| `GET /tenant/ai/usage-screen/summary` | ai.use (cost block only with subscription.manage) |
| `GET /tenant/ai/usage-screen/packages?q&status&category&sort&page&pageSize` | ai.use |
| `GET /tenant/ai/usage-screen/packages/:code` | ai.use (billing tab only with subscription.manage) |
| `POST …/packages/:code/trial` `{idempotencyKey, confirm}` · `POST …/packages/:code/cancel` `{idempotencyKey, confirm, expectedStatus?}` | ai.manage |
| `GET …/history?preset&from&to&basis(occurred · current_period)&packageCode&status&page` | ai.use |
| `GET …/history/export` (async export contract) | ai.use + reports.export or subscription.manage; denied attempts audited |
| `POST …/alerts/:id/acknowledge` | ai.use |
| `GET /super-admin/ai/package-availability` · `PUT /super-admin/ai/packages/:code/availability` `{enabled, reason, expectedVersion}` | SuperAdminGuard |

## 7. Migration 723 + rollback

Expand-only, idempotent (applied twice to the test template): `platform_ai_package_settings`, `ai_usage_alerts`,
`tenant_ai_subscription_events` (append-only trigger), index `ai_usage_logs (tenant_id, created_at desc)`. Rollback =
revert the code: the tables are unread and the gate falls back to "enabled". Forward-fix only for the history tables.

## 8. Tests actually run (this machine)

* `ai-usage-screen.pgtest` (new) **8/8**: states + actions incl. unknown code and manager permissions; paging 8/page,
  search, filters, sorts; period usage (previous period and failed calls excluded), alerts once per threshold, one line per
  package, acknowledge covers lower thresholds, other salon cannot acknowledge; cost (yearly ÷ 12, trials apart, past due,
  basis), hidden from managers; trial confirm / permission / audit-failure rollback / idempotency / one trial per package /
  disabled-by-admin refusal; cancel rules + stale state 409 + idempotency + append-only events + other salon untouched;
  history newest first, Failed filter, current-period basis, invalid range, CSV redaction, isolation; the gate enforces
  the platform switch, which needs a reason and the current version and is audited.
* Existing: `tenant-ai.vitest` 6/6, `ai-access-kysely.vitest` 4/4, `ai-usage-unknown.vitest` 9/9, `ai-admin.vitest` 6/6,
  `tenant-navigation.pgtest` 3/3.
* Harness E2E `interact.mjs aiue aiusage` **9/9**, 0 page errors (KPIs = server; Trial expired + Upgrade; search /
  status / category / Clear; card click + Enter + Escape focus + page kept; Start Trial confirm → 1 trial + 1 event + 1 audit;
  Cancel confirm → cancelled, no Cancel after; 100 % alert → Got it → badge 6 → 3; cost breakdown; Usage History filter +
  audited CSV; Disabled by admin; manager sees no cost / Cancel / billing).
* `measure.mjs aiu ai-usage` **12/12** (fit mode, 1920×945 · 1536×729 · 1440×765 · 1366×633 × EN / VI / empty) — no page
  scroll; at 1366×633 the card grid scrolls inside its panel (guide: smaller viewports may scroll).
* Gates: list-queries (0 failures), tenant-isolation, as-any, role-checks, validated-bodies, async-exports, select-columns,
  impossible-predicate, unreached-routes, silent-catch, audit-writers, pos-i18n, vi-glossary, inert-controls,
  dead-client-methods — OK; openapi manifest + attack surface regenerated.
* **Not run:** pos-web vitest (cannot run here — the two screen tests are written and syntax/undefined-name checked);
  125 %-scaled Windows and the physical touchscreen; any staging or billing-provider test.

## 9. Not built / limitations

* Super Admin has the API for the global switch but **no admin-web screen** yet.
* "Cancel scheduled" is not representable: cancellations take effect immediately in the existing subscription model.
* No invoice amounts exist for AI packages (`ai_billing_events` has no amount) — cost is "from subscription records" unless
  each paying package has a recorded payment this period; tax / proration are not shown because the data does not exist.
* Alerts are in-app only (sidebar badge + page); no SMS / email notification.
* Branch-specific AI overrides do not exist in the schema (AI subscriptions are salon-wide).
* The trial sweep (`AI_TRIAL_SWEEP_CRON_ENABLED`) is still off by default; the screen is correct either way.

## 10. Owner actions

Review the Vietnamese strings (`docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`, A49); approve migration 723 for staging; run
the pos-web vitest suite in CI; decide whether to enable the trial sweep and whether Super Admin needs a UI for the
global switch.
