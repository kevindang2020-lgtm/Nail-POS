# AI cost + usage in the Super-Admin screen

Surfaces the cost data the backend now computes, in the Super-Admin → AI Subscriptions screen. (Option 1 of your pick.)

## What changed (`apps/admin-web`)
- `src/api/superAdminApi.ts` — `aiAdminUsageSummary` type now includes `costMicroUsd`
- `src/screens/AiSubscriptionsScreen.tsx`:
  - loads the usage summary alongside the package rollup (`Promise.all`, fails soft)
  - a **COGS line** under the KPIs: "AI usage cost to date (COGS): **$X.XX** across N calls · provider token spend,
    summed from usage logs"
  - each package row now shows its own **calls + cost** inline (e.g. "… · 125 calls · $1.95 cost")
- `src/screens/AiSubscriptionsScreen.test.tsx` — +1 test asserting the totals + per-package cost render

Costs are formatted from micro-USD (4 dp under a dollar, 2 dp above). The figure is all-time provider token spend rolled up
from `ai_usage_logs`; it sits next to AI MRR so you can eyeball revenue vs. token cost per package. (It's not labelled a
"margin" because the two cover different windows — MRR is monthly, cost is cumulative.)

## Verification
admin-web: `tsc` clean; **98 tests** (+1); `vite build` clean. Backend unchanged (564, `RESULT: PASS`).
