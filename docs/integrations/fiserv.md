# Fiserv — the adapters that exist (CardPointe / CardConnect, Bolt, CommerceHub) and their status

Mandate §191-E: *"Document actual adapters found and their status. Do not claim an adapter exists if code does not contain it."*

| Adapter | File | What it talks to | Status |
|---|---|---|---|
| `CardPointeClient` | `modules/payments/src/payments/cardpointe.client.ts` | CardPointe Gateway REST (`/cardconnect/rest/auth`, `/refund`, `/void`, `/inquireByOrderid`, `/inquireMerchant`) — HTTP Basic, per-tenant MID + credentials | **LIVE-VERIFIED on Fiserv's UAT (Sep 27 2026)**: inquireMerchant, a $1 sale, void, decline amounts — see `PAYMENTS_UAT.md`, `npm run uat:cardpointe`. Production = Kevin's production MID + credentials in Super Admin (BLOCKED_EXTERNAL until Fiserv boards the salon). |
| `CardPointeBoltClient` | `modules/payments/src/payments/cardpointe-bolt.client.ts` | CardPointe Integrated Terminal (Bolt) — `connect`, `ping`, `display`, `authCard` for a Clover device by HSN | **UAT-CONFIRMED** (raw key as Authorization header; `connect` fails until the device is online). Drives the Clover Compact / Flex / Mini. |
| Hosted tokenizer glue | `modules/payments/src/payments/card-data.ts` | CardSecure hosted iFrame tokenizer (`tokenizerForGatewayBase`) | The POS / customer app never receives a PAN: the token is produced in Fiserv's iframe and posted to the API (§29–§31). |
| `CommerceHubClient` | `modules/payments/src/payments/commercehub.client.ts` | Fiserv CommerceHub Charges / Refunds / Cancels (HMAC auth) | **IMPLEMENTED FROM PUBLIC DOCS, NOT SANDBOX-RUN.** Used by the Tap-to-Pay path (`fiserv-commercehub-ttp.adapter`, Owner & Manager Pay app). VERIFY-tagged spots must be confirmed on a CommerceHub sandbox (BLOCKED_EXTERNAL: CommerceHub credentials). |
| Processor factory | `modules/payments/src/payments/processor.factory.ts` | env-only fallback (`PAYMENTS_ALLOW_ENV_FALLBACK=1`, dev) | refused in production |

Selection is by `tenant_payment_config.processor` / `payment_merchant_accounts.processor` (`fiserv` and `cardpointe` are the
same adapter; `clover` is the Clover Ecommerce adapter) through the ONE router — see [tenant-routing.md](tenant-routing.md).

## Request conventions that matter

* **Card-not-present flag**: every REST-gateway charge carries `ecomind: 'E'` (Fiserv onboarding requirement) unless it is a retail keyed sale; swipes/taps go through Bolt, never the REST auth.
* **Stored credentials (COF)**: saved cards send `cof: 'C'` (customer-initiated) with `cofscheduled: 'N'`; membership renewals send `cof: 'M'` + `cofscheduled: 'Y'`; `profile: 'Y'` on the first store with consent (`cofpermission`).
* **Idempotency**: the port carries `idempotencyKey`; the gateway's own duplicate detection is NOT relied on — AIPowerSalon's claim-first row is the guard (§24).
* **Unknown outcome**: `inquireByOrderId(ticketId)` is the only way a stranded attempt is resolved — never a second `auth`.
* **Timeouts / breaker**: `instrumentedFetch('cardpointe')` — 60 s timeout, circuit breaker, per-provider metrics; the Bolt `authCard` call opts out of the breaker (it waits on the customer, not the provider) and uses a 180 s timeout.

## Environments (§125, §127)

* UAT: `https://isv-uat.cardconnect.com/cardconnect/rest` + `https://bolt-uat.cardpointe.com/api` (sandbox merchant + a Clover on the RPCT emulator). `npm run uat:cardpointe` (apps/api) runs sale / void / refund / decline and the terminal connect against them with credentials from env or Super Admin — never committed.
* Production: `https://fts.cardconnect.com/cardconnect/rest` + `https://bolt.cardpointe.com/api`. A production process refuses to start with a UAT/sandbox host in `CARDPOINTE_*` env (`integrations-production-config.ts`); per-tenant rows carry their own `environment` and are validated when saved.
* A local CardPointe-shaped server exists for tests: `apps/api/scripts/cardpointe-mock-server.mjs` + `e2e-cardpointe.mjs`.

## Webhooks

`POST /api/v1/webhooks/payments/fiserv` (and `/cardpointe`): HMAC-SHA256 over the raw body with the tenant's own
`webhook_secret` (rotated from Super Admin, shown once). See [webhooks.md](webhooks.md).
