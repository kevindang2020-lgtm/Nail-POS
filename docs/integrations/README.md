# External integrations — developer README (§187)

| Page | What it answers |
|---|---|
| [payments.md](payments.md) | the one payment domain: flow, data model, idempotency, unknown-state recovery, refunds, settlement, permissions |
| [tenant-routing.md](tenant-routing.md) | how a tenant + branch resolves to a merchant account / Twilio sender; isolation tests |
| [fiserv.md](fiserv.md) | the CardPointe / Bolt / CommerceHub adapters and their verification status |
| [clover.md](clover.md) | Clover Compact as a Bolt device vs Clover Ecommerce as a processor; reservation; status model |
| [clover-compact.md](clover-compact.md) | the production onboarding procedure for a Clover Compact, step by step |
| [twilio.md](twilio.md) | the communications domain, tenant configuration, A2P, usage/segments, production onboarding |
| [webhooks.md](webhooks.md) | every inbound provider callback, its security method, dedupe, observability |
| `docs/runbooks/payments-provider-outage.md`, `clover-terminal-offline.md`, `payment-status-unknown.md`, `twilio-outage.md`, `twilio-a2p-failure.md` | what support does when something breaks (no secret access needed) |
| `docs/payments/PAYMENTS_INTEGRATIONS_WAVE3.md` | the Oct 13 2026 mandate report (A–Z) |

## How to configure a sandbox

* **Payments (Fiserv UAT)**: enter the UAT site / MID / API credentials and the Bolt UAT base + key in Super Admin →
  Payment Gateways → Configure Gateway with environment `sandbox` (or, for a local run only, `CARDPOINTE_BASE_URL`,
  `CARDPOINTE_MERCHID`, `CARDPOINTE_USERNAME`, `CARDPOINTE_PASSWORD` + `PAYMENTS_ALLOW_ENV_FALLBACK=1`). Then
  `cd apps/api && npm run uat:cardpointe` (sale / void / refund / decline / terminal connect). Credentials live only in
  Super Admin's sealed columns or your local env — never in the repo.
* **Local processor without Fiserv**: `node apps/api/scripts/cardpointe-mock-server.mjs` + `e2e-cardpointe.mjs`.
* **Simulated cards for a demo**: `PAYMENTS_SANDBOX=1` (refused in production).
* **Twilio**: a trial account's SID / token / number in `TWILIO_*` (platform) or a salon's own in POS Settings →
  Communications; without any, the `MockSmsSender` records sends in memory and the ledger marks them `simulated`.
* **Production refuses to start** with a sandbox processor host, `PAYMENTS_SANDBOX`, the env gateway fallback, a mock
  Tap-to-Pay provider, a half-configured shared Twilio sender, an http callback base or without raw-body webhooks
  (`apps/api/src/common/production-config.ts`).

## How to run the tests

```
# module suites (vitest; PGlite-backed pgtests included)
cd modules/payments && npx vitest run
cd modules/communications && npx vitest run
cd modules/checkout && npx vitest run
cd apps/api && npx vitest run src/common/payment-webhook-* src/customer-display/terminal-capture-* src/payments
# real-Postgres race lane (needs PG_RACE_URL)
node tooling/ci/run-race-tests.mjs
# gates incl. the architecture test (SDK / provider-host boundary)
node tooling/ci/run-gates.mjs
```

## How to add a provider adapter

1. Implement `PaymentProcessor` (`modules/payments/src/payments/payment-processor.port.ts`) — integer cents in, the
   port's normalized `AuthorizeResult` / `ProcessorActionResult` out; throw `ProcessorError` on transport failure
   (never return a fake approval). Wrap your fetch with `instrumentedFetch('<provider>')`.
2. Add the `processor` value to the CHECK constraints (`tenant_payment_config`, `payment_merchant_accounts`) in a new
   migration and to `PaymentGatewayResolver.build()` — the only place an adapter is constructed.
3. Unit-test request shaping and response mapping with an injected transport (see `cardpointe.client.vitest.spec.ts`);
   add the provider's host to the architecture test's provider lists.
4. Webhooks: if the provider calls back, add its signature scheme to `verifyProcessorSignature` and its event names to
   the mapping functions in `payment-webhook.service.ts`. Never add a route outside `/webhooks/...`.
5. For an SMS provider: implement `SmsSender` in `packages/notifications` and resolve it in
   `notifications.tenant-sender.ts` / `sender-numbers.ts`; consent, opt-outs, segments and the ledger are provider-agnostic.

## How tenant routing works

See [tenant-routing.md](tenant-routing.md). In one line: `ctx.tenantId` + `ctx.branchId` (from the session) →
`PaymentGatewayResolver.resolve(tenant, branch)` / the sender resolvers → adapter; cross-tenant is impossible by construction
and tested on the real schema.

## How secrets are stored

Sealed at rest with purpose-specific keys (`apps/api/src/common/key-ring.ts`, Constitution 12 §41): payment credentials
and Bolt keys with the PAYMENT key (`v2p:` prefix), Twilio tokens / API key secrets with the PROVIDER key, webhook
secrets with the PAYMENT key. The database holds ciphertext + a masked hint; reads return masks; decryption happens only
inside the resolver / sender resolvers in the API process. Production refuses to boot without real keys. The secret
scanner (CI security lane) and the `secrets` gate catch committed or screen-exposed secrets.

## How webhooks work

See [webhooks.md](webhooks.md).
