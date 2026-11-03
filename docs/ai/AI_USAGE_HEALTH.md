# AI Usage & Limits — Nov 2 2026 pass

Guide: *AI Usage & Limits* (Kevin, Nov 1 2026). Route: `/tenant/ai/usage` (unchanged).

## Audit

The page was already rebuilt by the Oct 30 *AI Usage & Limits Complete Build Guide*: one honest state per package (a lapsed trial is
"Trial expired" and offers no Cancel), the four cards with the cost basis named (reconciled / subscription records / no paid packages),
details overlay, usage history with presets and pages, audited export, 80/90/100 % alerts, branch overrides, read-only invoice
reconcile. Verified in code and tests. What was missing or wrong:

| Area | Status | Finding |
|---|---|---|
| Health checker | Missing | No "Check AI Usage & Subscriptions". |
| Permission error | **Bug** | A 403 showed the server's raw word "forbidden". |
| Screen tests | **Broken** | `POSAiUsageScreen.test.tsx` and the 403 test rendered without a router and failed on the untouched tree. |
| Add-on pages / plans | Fixed earlier today | Guides 11 and 13 moved the add-on pages and plans onto this page's honest state. |
| Paid self-serve purchase, per-assistant price editor | Blocked / decision | Same as guide 13 (no billing provider integration for AI packages). |

## What was built

- `POST /tenant/ai/usage-screen/check` (read-only, one run per salon per 30 s, migration 771 `ai_usage_health_runs`): states readable ·
  15-assistant catalog · statuses recognised · stale "trialing" rows · **AI calls after a trial ended** (no payment) · **AI calls after
  cancelling** · cost basis (is $0.00 / the recurring total backed by payments?) · payments current · metering · recent errors ·
  exhausted allowances · plans in step with their assistants · platform switches · no side effects.
- POS: **Check AI Usage & Subscriptions** button + evidence dialog (EN/VI `aiux.*`); a 403 now reads "You do not have permission…".
- Tests: `ai-usage-health.pgtest.vitest.spec.ts` 2/2 (names the screenshot contradictions; read-only); POS usage tests 10/10 (router fixed).
