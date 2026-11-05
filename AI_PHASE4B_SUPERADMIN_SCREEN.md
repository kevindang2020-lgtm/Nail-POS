# AI Phase 4b — Super-Admin "AI Subscriptions" screen

The admin-web UI on top of the Phase-4a API, so Super Admin manages the 15 paid AI packages from the app instead of
SQL/curl. Distinct from the legacy per-tenant tier screen at `/ai-packages` — this is the new 15-package paid system at
`/ai-subscriptions`.

## Files
- `apps/admin-web/src/api/superAdminApi.ts` — 6 client methods (`aiAdminPackages`, `aiAdminPackageTenants`,
  `aiAdminUsageSummary`, `aiAdminAssign`, `aiAdminUpdate`, `aiAdminCancel`)
- `apps/admin-web/src/screens/AiSubscriptionsScreen.tsx` — the screen
- `apps/admin-web/src/screens/AiSubscriptionsScreen.test.tsx` — 3 tests
- `apps/admin-web/src/App.tsx` — route `/ai-subscriptions`
- `apps/admin-web/src/shell/AdminLayout.tsx` — sidebar entry "AI Subscriptions" (under "AI Packages")

## The screen
- **Summary cards:** AI Packages (15), Subscriptions, Active, AI MRR — from the rollup totals.
- **Package list:** every one of the 15 with price/included-usage/trial, plus live rollup pills (subscribers, active,
  MRR). "Assign" opens the modal; "Subscribers" expands the per-package list.
- **Subscribers table** (per package): tenant, status pill (active/trialing highlighted), usage limit (0 = Unlimited),
  overage on/off, trial end. Row actions: **Limit** (override the monthly usage limit) and **Cancel**.
- **Assign / grant-trial modal:** tenant ID, optional usage limit, "grant trial" toggle (uses the package's trial days),
  and an overage toggle → `POST /super-admin/ai/tenants/:tenantId/subscriptions`. After any mutation the rollup and the
  open subscriber list refresh, so counts/MRR update immediately.
- Cream/gold design tokens and existing component classes (`work`/`vh`/`panel`/`kpis k4`/`list`/`row`/`pill`/`btn`/
  `modal`/`sheet`/`ttable`) reused — consistent with the other Super-Admin screens and the Mac-fit shell.

Because 4a's writes are what the Phase-2 gate reads, assigning an active subscription here immediately enables
`POST /ai/:packageCode` for that tenant; cancelling blocks it — fully closed-loop from the UI.

## Verification
admin-web: `tsc` clean; **97 tests** (+3: rollup/MRR totals render, open-package lists subscribers, assign posts the
right payload); `vite build` clean. (The one HardwareScreen failure under parallel load is the pre-existing flake — it
passes in isolation and that file was not touched.) Backend unchanged this turn (still 523, `RESULT: PASS`).

## Remaining
- **4c** — tenant-owner API + owner-web UI: `GET /tenant/ai-packages`, subscribe/cancel, usage meter, locked CTA
  (tenant-scoped by session).
- **4d** — billing/webhook sync so a payment status change flips `tenant_ai_subscriptions.status` (and thus access).
- **Phase 3** — real provider adapters + per-assistant prompt templates behind the existing `AiProvider` port.
- **Phase 5** — POS entry points per assistant rendering the gate's locked/upgrade panel.
