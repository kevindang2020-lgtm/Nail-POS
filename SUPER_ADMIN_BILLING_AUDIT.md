# Super Admin → Billing & Subscriptions — audit & fix (audit-first hardening)

Page: `apps/admin-web/src/screens/BillingScreen.tsx` (route `/subscriptions`; `/billing` redirects here). Per-tenant
subscription + payment-config + hardware-payoff roll-up over the real `tenant_subscriptions` / `tenant_payment_config` /
`tenant_hardware_payoff` tables, with inline plan/status edits. Previously had no screen test; now covered.

## Wiring verified (correct — no rebuilds, no duplication)
- Client `billing()` ↔ `@Get('super-admin/billing')` → `{ rows, overview }`.
- Client `updateSubscription(tenantId, { plan, status })` ↔ `@Patch(':tenantId/subscription')` →
  `normalizeSubscriptionUpdate` (rejects un-settable values, incl. `status: 'none'`) → and crucially the service returns
  `getBilling()`, i.e. the **full refreshed `{ rows, overview }`** — so the screen's `applyBilling(response)` is safe.
- `billing-core` initializes every `bySubscriptionStatus` / `byPaymentStatus` key to 0, so KPIs like "Past Due" always
  render a number (never "undefined") even when no tenant has that status. (Backend already covered by `billing-core.spec.ts`.)

## Bug found & fixed — no-subscription tenants mis-rendered in the status dropdown
A tenant with no subscription has `subscriptionStatus: 'none'`, but the status `<select>` only listed the *settable*
statuses (active/trialing/past_due/expired/cancelled). A controlled `<select value="none">` with no matching `<option>`
renders the **wrong** value (browsers fall back to showing the first option, "active"), so a tenant with no plan looked
like it had an active subscription. Fix (mirrors the screen's existing plan-options pattern, which already injects the
current value): when the current status isn't settable, prepend it as a **disabled** `— none —` option, so the row shows
its true state and the admin can still pick a real status to activate it. `'none'` stays unselectable, matching the
backend's rejection of `status: 'none'`.

## Tests added (3, all pass)
`BillingScreen.test.tsx`: renders roll-up KPIs + tenant rows and confirms "Past Due" shows 0 (not undefined); confirms a
no-subscription tenant shows `— none —` in the status select (the fix); saves a status change via the real PATCH route
with the exact `{ plan, status }` body.

## Honest remainder
- The billing roll-up returns all tenant rows unpaginated (rendered in a scrollable table). Fine at current scale; a
  server-side page/limit would be the follow-up if the tenant count grows large.
- MRR stays $0 until `PLAN_PRICES_JSON` is configured — by design (never fabricated); the screen surfaces whatever the
  backend computes.

## Verification
admin-web `tsc` clean, **126 tests pass** (24 files), `vite build` clean. No backend change; backend remains 603 / PASS.
