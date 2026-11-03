# AI Center (`/tenant/ai/command-center`) — guide 1a93f016 (refreshed)

## The P0: "0 Active / 11 On Trial / 11 Running"
The old page counted, on the client, every stored `trialing` subscription row as "On Trial" and "Running", whatever its trial end date, and "Active" as "accessible and not trialing". A trial that had ended still said `trialing` in the row, so the page showed 11 trials running while none could run.

Billable AI calls were never let through: `AiPlatform.execute` / the provider gateway run `evaluateAiAccess` before every model call and refuse an ended trial, a cancellation, a platform switch-off or an exhausted allowance. The assistant *screens* are behind `RequiresAiPackage`, whose mode is the platform setting `AI_ENTITLEMENT_ENFORCEMENT` (`off` / `observe` (default) / `enforce`). In `observe` a screen opens and the refusal is only logged.

## What the page shows now
- `GET /tenant/ai/usage-screen/reconcile` (permission `ai.use`, read-only). For each of the 15 assistants it returns:
  - the stored status and the honest state (the same states as AI Usage & Limits);
  - `gate`: the salon's decision from the same `evaluateAiAccess`, with the user's permission set aside;
  - `forYou`: the same decision for the signed-in user;
  - what the old page counted it as;
  - this month's runs, blocked calls and errors, in salon time.

  It also returns the counts both ways, the number of stale trial rows, gate mismatches, and the enforcement mode (`modelCalls: always`, `featureRoutes: observe|enforce|off`).
- KPIs: Paid & active, On live trial, Can run now (of 15), AI runs this month, Blocked this month, AI errors this month, Monthly plan cost, Bookings by AI.
- A reconciliation strip:
  - It explains the old counts in plain words when they differ from today's.
  - It always states how the gate is enforced.
- Each assistant's pill shows its honest state. If the salon should be entitled but the gate refuses, the reason is shown under the pill.
- Check AI System runs the AI Usage check, which now includes:
  - `gate_matches_state`: FAILED when the shown state and the gate disagree;
  - `feature_routes_gated`: WARNING while screens are only observed.
- Usage & history opens `/tenant/ai/usage` (details, cost, history, trials, cancel).

## Owner decision (not changed here)
- Turning on `AI_ENTITLEMENT_ENFORCEMENT=enforce` blocks assistant screens for unentitled salons. It is a platform environment setting. Billable calls are already blocked either way.

## Tests
- `modules/super-admin/src/tenant-ai/ai-usage-health.pgtest.vitest.spec.ts`, AIC-01 and AIC-02 (real schema).
- `apps/pos-web/src/screens/POSAICenterScreen.reconcile.test.tsx`.
