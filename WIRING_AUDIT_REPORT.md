# Wiring audit — unwired code found + fixed (2026-07-03)

You asked me to deep-audit for anything built but NOT wired (to the backend, a frontend route, or the sidebar) and add
it where it belongs — with special attention to the AI features. Here's what the audit found and what I fixed.

## Method
- Backend: cross-referenced all 143 `*Module` classes against `app.module.ts`.
- Frontend: cross-referenced every `*Screen.tsx` against `App.tsx` routes and `AdminLayout.tsx` nav links, and traced
  every `tenant/ai/*` and super-admin AI backend route to a frontend consumer.

## Backend — FULLY WIRED (no gaps)
All 143 modules are reachable from `app.module.ts`. The one not imported there directly — `CheckoutLockModule` — is
correctly imported by `checkout.module.ts` and `mobile-checkout.module.ts` as a shared sub-module. Nothing orphaned.

## AI features — 2 backends were unwired, now fixed
Every AI backend module is registered and every admin-web AI screen is routed + in the sidebar (AI Insights, AI
Receptionist, AI Reports, AI Usage & Configuration, AI Packages, AI Plans, AI Subscriptions, AI Handoffs). But two
TENANT-facing AI backends had NO frontend consumer and were not called internally either — built, tested, and stranded:

1. **`tenant/ai/revenue`** (AiRevenueModule) — `GET summary` (today/week AI-attributed revenue + by-source breakdown).
2. **`tenant/ai/workflows`** (WorkflowRunsModule) — `GET runs/summary` (per-automation sent-today + success rate).

Both belong to the tenant AI hub, so I wired them into **pos-web → AI Center** (`POSAICenterScreen`), which already had
placeholder copy admitting this data "isn't tracked yet" — now replaced with the real feeds:
- Added `aiRevenueSummary()` + `workflowRunsSummary()` to `posAiApi`.
- Added an **AI-Attributed Revenue** section (today/week in integer-cents via `money()`, by-source breakdown, honest
  empty state) and an **Automation Runs (today)** section (per-workflow count + success%, `—` when a rate is null).

## admin-web — 1 orphaned panel, now embedded
**`AppControlsPanel`** (per-tenant App Controls, build doc §26, has a test, calls the live `/super-admin/platform/
app-flags/:tenantId` endpoint) was imported nowhere. Its header comment said it belongs "inside the Tenants → Manage
panel," so I embedded it in **`TenantsScreen`**'s tenant detail panel as an "App Controls" section keyed to the selected
tenant. It now reaches its real backend endpoint.

`SuperAdminPlaceholder.tsx` is an unused leftover (referenced only by a layout test); left as-is — harmless, and removing
it is out of scope.

## Not gaps (verified legit)
The other ~35 unrouted `*.tsx` files are sub-components imported by their parent screens — modals (`*Modals`,
`Security*Modal`), drawers (`ConnectionDetailDrawer`, `DeviceDetail`), wizards (`AddIntegrationWizard`), sub-tabs
(`ProductCatalog*`, `Membership*`, `SuperAdminCampaigns*`), and AI sub-panels (`AiInsightsDetails`, `AiUsageConfigPrompt`,
`AiUsageConfigProvider`). Correct architecture — not meant to be routed.

## Verification (fresh runs)
- admin-web: tsc 0, build clean, **suite 722/722 across 119 files**.
- pos-web: tsc 0, build clean, **suite 303/303 across 64 files**.
- (api unchanged this pass: 2697/2697.)

## Files changed
- pos-web: `api/posAiApi.ts` (+2 methods/types), `screens/POSAICenterScreen.tsx` (+2 sections), test mock.
- admin-web: `screens/TenantsScreen.tsx` (embed AppControlsPanel), test mock.
