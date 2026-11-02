# Configure Gateway (Fiserv/CardPointe/Clover) — Deep Scan + Build Report

Per your instruction I scanned the codebase first and **reused existing modules**, then built only the genuinely-missing
Configure Gateway actions on top. Most of this system already existed; I did not duplicate it. Below is the full
18-point report.

## 1. Deep scan summary
The per-tenant payment-gateway system is largely built and isolated. Core pieces found:
- **Backend** `apps/api/src/payments/`: `payment-gateway.resolver.ts` (tenant-isolated resolve, masked view, encrypted
  upsert, test-connection, webhook merchant lookup), adapters `cardpointe.client.ts`, `cardpointe-bolt.client.ts`,
  `clover.client.ts`, `square.client.ts`, `stripe.client.ts`, `payment-processor.port.ts`, `processor.factory.ts`,
  `payment-webhook.{service,controller}.ts` (signature-verified, chargeback/scrub specs), `payment-reconciliation.*`.
- **Configure routes** `apps/api/src/super-admin-tenants/super-admin-tenants.controller.ts`: GET/POST/PATCH
  `tenants/:id/payment-gateway`, `/test-connection`, `/pause|/resume|/disable` (audited lifecycle).
- **Command center** `apps/api/src/super-admin-platform/`: `payment-gateways-core.ts` (+spec) pure shaping, list/state/
  export/analytics endpoints.
- **POS** `apps/api/src/checkout/pos-payment-gateway.controller.ts`: GET `/pos/payment-gateway/config` (tenant-scoped from
  auth, never client-supplied).
- **DB**: `tenant_payment_config` (one encrypted config per tenant), `pos_payment_terminals`, `payment_settlements`,
  `payment_gateway_events`, `payment_refunds`, `chargebacks`, `payments`.
- **Frontend** `apps/admin-web`: `PaymentGatewaysScreen.tsx` (command center) + `PaymentGatewayPanel.tsx` (per-tenant
  Configure form: provider/env/status/underwriting/MID/credentials/webhook-secret, encrypted save, masked view) +
  `superAdminApi.ts`.

**Missing vs. your spec (what I built):** Verify Credentials (distinct from Test Connection), Sync Merchant Status, Rotate
Webhook Secret, and Settlement-history read — endpoints + UI + audit.

## 2. Existing modules reused (NOT duplicated)
`PaymentGatewayResolver` (encryption/masking/isolation), the five processor adapters, `payment-gateways-core.ts`,
`PaymentGatewayPanel.tsx`, `superAdminApi`, the lifecycle audit path, `tenant_payment_config` + settlement/event/terminal
tables, and the POS config controller. Terminals are managed by `settings/settings.terminals.kysely.repository.ts`;
payment-method + tax/surcharge/tip rules live in POS tenant settings (`POSSettingsScreen`). I reused these rather than
create the spec's separate `tenant_gateway_payment_methods` / `tenant_gateway_transaction_rules` tables.

## 3. Missing modules found
The four Configure actions above. No missing tables (existing schema covers it). No duplicate routes/components/tables
created.

## 4. Bugs fixed
None required — the existing wiring was sound. This was additive (the scan found no broken gateway wiring).

## 5. Files changed
- `apps/api/src/super-admin-platform/payment-gateways-core.ts` (+spec): `requiredGatewayCredentials` +
  `missingGatewayCredentials` (pure, +7 assertions).
- `apps/api/src/payments/payment-gateway.resolver.ts`: `verifyCredentials`, `syncMerchantStatus`, `rotateWebhookSecret`,
  `listSettlements`.
- `apps/api/src/super-admin-tenants/super-admin-tenants.controller.ts`: 4 endpoints.
- `apps/api/src/super-admin-tenants/super-admin-tenants.service.ts`: `recordGatewayAudit`.
- `apps/api/src/super-admin-tenants/super-admin-tenants-core.ts`: 3 new audit actions in `TenantAuditAction`.
- `apps/admin-web/src/api/superAdminApi.ts`: 4 API methods.
- `apps/admin-web/src/components/PaymentGatewayPanel.tsx`: Verify/Sync/Test buttons, Rotate-secret (confirm + show-once),
  Settlements list.

## 6. Frontend components added/fixed
`PaymentGatewayPanel.tsx` extended (reused, not duplicated): Verify Credentials, Sync Status, Test Connection in the header;
a secondary row with View Settlements + Rotate Webhook Secret; a show-once secret box with copy; a settlements table. Each
button has loading/success/error; Rotate is confirmation-gated (dangerous action, §5).

## 7. Frontend routes added/fixed
None — the Configure surface is the existing `PaymentGatewayPanel` rendered in the Tenants Manage drawer (reachable from the
Payment Gateways command center and Tenant detail). No dead/duplicate routes created, per your instruction.

## 8. Backend APIs added/fixed
- `POST /super-admin/tenants/:id/payment-gateway/verify-credentials`
- `POST /super-admin/tenants/:id/payment-gateway/sync-merchant-status`
- `POST /super-admin/tenants/:id/payment-gateway/webhooks/rotate-secret`
- `GET  /super-admin/tenants/:id/payment-gateway/settlements`
(Existing reused: GET/POST/PATCH gateway, /test-connection, /pause|/resume|/disable, command-center list/state/export,
`/pos/payment-gateway/config`.)

## 9. Backend services added/fixed
`PaymentGatewayResolver` gained the 4 methods (all tenant-scoped, secrets stay encrypted; Verify reports missing fields
without decrypting; Rotate generates + encrypts a new secret and returns it once). `recordGatewayAudit` added for
configure-action auditing.

## 10. Database tables/models used
Reused `tenant_payment_config` (encrypted creds + webhook secret + onboarding status), `payment_settlements` (settlement
read), `payment_gateway_events`, `pos_payment_terminals`, `payments`, `payment_refunds`, `chargebacks`. No new tables.

## 11. Fiserv/CardPointe/Clover adapter status
Real adapters exist for CardPointe (HTTP Basic, per-tenant MID), CardPointe Bolt, Clover, Square, Stripe — all with vitest
specs, all built per-tenant from the encrypted config (never a shared merchant). Verify/Sync/Test do **not** perform a live
processor round-trip — that needs the Fiserv/CardPointe sandbox (honest note returned, per your "clean TODO integration
points" instruction). The exact CardPointe webhook signature header should be confirmed against sandbox.

## 12. POS checkout wiring status
Already wired and reused: `GET /pos/payment-gateway/config` resolves the **authenticated tenant's** active gateway
(tenant_id from the server context, never the client); the checkout/processor path builds the tenant-bound processor via
the resolver; `payments` records transactions. Tenant A cannot use Tenant B's gateway by construction (resolver loads
exactly one tenant row; webhook merchant lookup rejects ambiguous/unknown MIDs).

## 13. Webhook wiring status
Already wired with **signature verification** (processor-aware schemes; invalid → 401, no money applied) and
chargeback/settlement/refund handling. New: **Rotate Webhook Secret** lets Super Admin roll the per-tenant signing secret
(stored encrypted, shown once to paste into the processor dashboard).

## 14. Permissions added/fixed
The Super Admin gateway surface is gated server-side by `SuperAdminGuard` (role-based) on the controller — enforced for all
configure/verify/sync/rotate/settlement routes; the POS config route is tenant-scoped from auth. **Honest note:** I did not
introduce the spec's granular `payment_gateway.*` permission taxonomy — that's a separate RBAC expansion; today the whole
Super Admin surface is guarded as one role. Flag if you want the granular split.

## 15. Audit logs added/fixed
New audited events (no secrets in payloads): `payment_gateway_credentials_verified`, `payment_gateway_status_synced`,
`payment_gateway_webhook_secret_rotated` — written via `recordGatewayAudit` with actor + IP. Existing lifecycle audits
(`super_admin_gateway_paused/resumed/disabled`) reused.

## 16. How to test Configure Gateway per tenant
1. Super Admin → Payment Gateways (or Tenants → a tenant → Manage drawer) → the Payment Gateway panel.
2. Click **Configure**, set provider=cardpointe, environment=sandbox, MID + API username/password + base URL → **Save
   gateway** → reopen: secrets show masked, never echoed.
3. **Verify credentials** → for cardpointe with a missing field it lists exactly what's missing; with all four present it
   reports complete. **Test connection** → confirms a tenant-bound processor builds (no live round-trip). **Sync status** →
   returns the persisted underwriting status. **View settlements** → lists settlement rows. **Rotate webhook secret** →
   confirm → the new secret shows once (copy it).
4. Check Super Admin → Audit Logs for the verify/sync/rotate entries.

## 17. How to test POS payment uses the right tenant gateway
1. Configure distinct gateways for Tenant A and Tenant B (different MIDs).
2. Sign into POS as Tenant A → `GET /pos/payment-gateway/config` returns A's masked config (resolved from A's auth context).
3. A checkout processes through A's merchant; the `payments` row carries A's tenant_id. Tenant B's credentials are never
   reachable from A's session (resolver loads only the caller's tenant row). An inbound webhook for A's MID resolves to A
   only; an unknown/ambiguous MID is rejected (never borrows another tenant's gateway).

## 18. Remaining setup needed
- **Fiserv/CardPointe MID** + API credentials per salon (apply for the merchant account); set them via Configure → Save.
  Confirm the **exact CardPointe webhook signature header** against the Fiserv sandbox (the one payment detail needing a
  live round-trip).
- Set each tenant's **webhook URL** in the processor dashboard and the signing secret (use Rotate to generate one).
- Optional future scope (not built, to avoid speculative duplication): granular `payment_gateway.*` RBAC; dedicated
  super-admin terminal-pairing endpoints under the gateway (terminals currently managed via POS settings); separate
  payment-method/transaction-rule tables (currently POS tenant settings).

## Verification
Backend `bash scripts/run-core-specs.sh` → **634 tests + harness, RESULT: PASS** (payment-gateways-core 81 assertions,
+7). admin-web → 31 files / 168 tests; api + admin-web `tsc` clean; admin-web production build succeeds. No duplicate
modules/routes/tables created; no secrets returned or logged.

---

## Addendum — Webhook events log + health (spec §4.H / §6)

Added the webhook-visibility piece (the symmetric partner to the settlements read), reusing the existing
`payment_gateway_events` table (no new table):
- **Pure core** `webhookHealth(events)` (payment-gateways-core, +5 assertions): summarizes recent inbound webhooks —
  count received, signature failures, last received — and flips health to `failing` if **any** event failed signature
  verification (the thing an operator must notice).
- **Resolver** `listWebhookEvents(tenantId, limit)` — recent events (event type, processor, signature ✓/✗, whether matched
  to a payment, received-at) + the health summary. No secrets.
- **Endpoint** `GET /super-admin/tenants/:id/payment-gateway/webhooks`.
- **Frontend** — `superAdminApi.gatewayWebhooks` + a "Webhook events" button in the panel showing a health badge
  (healthy / N signature failures / none yet) and a table of recent events with per-event verification status.

This realizes spec §4.H ("Last webhook received," "Webhook health," "View webhook logs"). Send-test-webhook remains
external (needs the processor to deliver a real event).

**Updated verification:** payment-gateways-core **93 assertions** (was 81; +7 credentials, +5 webhook); backend **634
tests + harness, RESULT: PASS**; admin-web 31 files / 168 tests; api + admin-web `tsc` clean; admin-web build green. Also
fixed a pre-existing cosmetic quirk in the core harness (the summary line printed before the final assertions, so the
count under-reported) — the summary now prints at the true end.
