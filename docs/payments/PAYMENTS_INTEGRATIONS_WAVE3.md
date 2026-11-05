# Payments, Clover/Fiserv, Twilio & External Integrations — wave 3 report (Oct 13 2026)

Mandate: *AI PowerSalon — Master Payments, Clover/Fiserv, Twilio & External Integrations Completion Mandate* (191 sections).
Method: INSPECT → VERIFY → FIX → MERGE → COMPLETE → WIRE → TEST → DOCUMENT. Every section is classified, with file and test
evidence, in the section ledger (wave-3 scratch ledger `ledger-PAYI.md`, summarised here):

| Status | Sections |
|---|---|
| COMPLETE (already right, cited) | 130 |
| BUILT NOW (this wave, file + test) | 47 |
| DECIDED (default + reason) | 12 |
| BLOCKED_EXTERNAL | 2 (§188 payments go-live checklist, §189 Twilio go-live checklist — the live halves only) |
| NOT DONE | 0 |

Companion pages (written this wave): `docs/integrations/{README,payments,tenant-routing,fiserv,clover,clover-compact,twilio,webhooks}.md`,
`docs/runbooks/{payments-provider-outage,clover-terminal-offline,payment-status-unknown,twilio-outage,twilio-a2p-failure}.md`.

---

## A. Existing integration discovery

| Kind | What exists |
|---|---|
| Payment module | `modules/payments` — `payments/` (port, router `PaymentGatewayResolver`, adapters, webhooks, card-data PCI rule, production-config), `refunds-voids/`, `split-payments/`, `deposit-reconciliation/`, `customer-payments/` (saved cards), `hardware-payment/` (salon buys hardware from the platform), `invoices/` |
| Merchant configuration | `tenant_payment_config` (tenant default) + `payment_merchant_accounts` (branch, migration 638); Super Admin Payment Gateways (`modules/super-admin/.../super-admin-tenants.controller.ts`, `apps/admin-web` PaymentGatewayPanel + BranchMerchantAccountsPanel) |
| Clover integration | Clover Compact/Flex/Mini via Fiserv Bolt (`cardpointe-bolt.client.ts`, `apps/api/src/customer-display/terminal-capture.service.ts`, `apps/api/src/payments/terminal-probe.module.ts`); Clover Ecommerce processor (`clover.client.ts`). No Clover SDK. |
| Fiserv integration | CardPointe REST (`cardpointe.client.ts`, UAT-verified), Bolt, CommerceHub (`commercehub.client.ts`, Tap-to-Pay path, not sandbox-run) |
| Checkout payment paths | `modules/checkout/src/checkout/checkout.service.ts` (payCard / paySplit / refund / void / verifyCardPayment), `skip-line-checkout/` (customer app), `payment-attempt-sweep*`, `terminal-lease.ts`; mobile checkout (TTP owner) |
| Twilio / communications | `modules/communications` — `notifications/` (the one send path, sender resolvers), `tenant-messaging/` (credentials, numbers), `tenant-a2p/` (TrustHub, brand, campaign), `sms-packages/` (Verify packages, billing, entitlement), `reminders/`, `campaigns/`, `messaging-inbound/` (inbound + status webhooks), `messaging-readiness/`; `packages/notifications` (TwilioSmsSender, Verify, signature, keywords); booking OTP `modules/booking/src/customer-booking/booking-verification.*` |
| Webhook routes | `POST /webhooks/payments/:processor`, `POST /webhooks/bank/:token`, `POST /webhooks/twilio/sms/inbound`, `POST /webhooks/twilio/sms/status`, `POST /webhooks/twilio/booking-verification/status` |
| Workers | payment-attempt sweep, deposit-reconciliation sweep, mobile attempt recovery (TTP), reminders, end-of-day follow-ups, campaign delivery — all `runAsSingleOwner` under `PROCESS_ROLE=worker` |
| Tables | see `docs/integrations/payments.md` §2 and `twilio.md` (tenant_payment_config, payment_merchant_accounts, pos_payment_terminals, payment_terminal_leases, payments, payment_attempts, payment_refunds, chargebacks, payment_settlements, bank_deposits, payment_gateway_events, customer_payment_methods; tenant_messaging_credentials, tenant_messaging_numbers, tenant_a2p_registrations, notifications, notification_opt_outs, sms_usage_records, sms_verification_packages, campaign_*) |
| Frontend integration pages | POS: Devices → Payment Terminals, Settings → Payments/Checkout, Communications, Notifications (A2P), SMS plan, Campaign Center. Super Admin: Payment Gateways, tenant gateway drawer + branch merchants, Integrations, A2P, SMS packages, webhook events. Customer app: Pay (Skip-the-Line), Payment Methods. |

## B. Problems found

| Class | Problem | Fixed |
|---|---|---|
| **P0 Security (PCI)** | Customer web app **Pay** screen had its own card form and posted the TYPED CARD NUMBER as the payment "token" to `/customer/.../confirm` (and saved it as a "token" via add-payment-method). Neither the skip-line confirm nor the POS card path refused a PAN. | Pay screen now uses the salon's CardSecure hosted iFrame tokenizer (origin-checked postMessage, 9-prefixed token only); API refuses `looksLikeRawPan` on skip-line confirm (400 `raw_card_rejected`), POS pay-card and split. Any rows already saved that way: run `node apps/api/scripts/purge-raw-card-numbers.mjs` on production. |
| **P0 Security** | Bolt key sealed with the PAYMENT key by Super Admin was opened with the MFA key in terminal capture → ciphertext sent to Clover as the API key | terminal capture uses the router + PAYMENT secrets (`terminal-capture-routing.pgtest`) |
| **P0 Tenant leakage** | `tenant-number.service` registered a number with `ON CONFLICT (phone_number) DO UPDATE SET tenant_id` — any salon could take over another salon's number (its inbound routing and sender) | refused; `tenant-number-isolation.pgtest` |
| P1 Broken wiring | checkout / skip-line / terminal capture resolved the TENANT gateway only — branch merchants ignored | router `resolve(tenant, branch)` everywhere |
| P1 Broken wiring (fake control) | POS terminal **Test** answered "paired and responding" without contacting anything | real Bolt ping (TerminalProbePort) |
| P1 Fake control | customer web Apple Pay / Google Pay buttons sent a made-up token | removed from the web app (no wallet sheet) |
| P1 Missing provider recovery | payment webhook processing failure after the claim lost the event (claimed, never retried) | inbox keeps error + attempts, releases the claim, 500 → processor retry reprocesses once |
| P2 Missing features | branch merchant accounts; terminal registry + normalized status; Messaging Service routing; account mode; number purpose/status/SID; SMS segment accounting; campaign cost preview + confirmation; production env validation; error taxonomy codes; payment + messaging business metrics; webhook `failed` + latency; A2P status-change / number-attach audits | all built (§C–§R) |
| P3 Cleanup | env-wide processor marked `@deprecated`; docs + runbooks | done |

## C. Payments architecture

Merchant resolution, branch resolution, provider routing, terminal routing and secret resolution are one function family on
`PaymentGatewayResolver` — see `docs/integrations/tenant-routing.md`. In short: `ctx.tenantId` + `ctx.branchId` (session) →
branch merchant (`payment_merchant_accounts`) if the branch has one (paused/pending blocks, never falls back) → tenant default
(`tenant_payment_config`) → adapter built from that row's sealed credentials (PAYMENT key), cached per
`(tenant, scope, provider, config_version, credential fingerprint)`. Terminals: `resolveTerminalConfig(tenant, branch, terminal.merchant_account_id)`.

## D. Clover Compact

Connection mode: cloud, through Fiserv Bolt (by HSN). Registration: POS Devices → Pair Terminal (code, label, HSN, register),
registry fields from 638. POS pairing: terminal ↔ register (`station_id`). Reservation: `payment_terminal_leases` (TERMINAL_BUSY).
Transaction flow: display/POS → terminal capture → lease → Bolt `authCard` → record → release. Status recovery: a thrown
`authCard` records `processing` (unknown) and "Verify with processor" / the sweep resolve it by inquiry. Detail:
`docs/integrations/clover.md`, onboarding `docs/integrations/clover-compact.md`.

## E. Fiserv / CardPointe / Bolt

`docs/integrations/fiserv.md`: CardPointe REST — LIVE-VERIFIED on Fiserv UAT (Sep 27); Bolt — UAT-confirmed; CommerceHub — implemented
from public docs, not sandbox-run (BLOCKED_EXTERNAL credentials); hosted tokenizer glue `card-data.ts`. No adapter is claimed that the
code does not contain.

## F. Payment data model

Intents = the claim row in `payments` ('processing' + idempotency key) / `payment_attempts` / skip-line intents (no duplicate
`payment_intents` table). Transactions = `payments` (one row per tender) with `processor_transaction_id`, `auth_code`.
Refunds = `payment_refunds` + refund payment rows. Voids = `voided` rows + original marked voided. Settlements =
`payment_settlements`. Payouts = settlement net (DECIDED until a processor payout feed exists). Bank deposits = `bank_deposits`.

## G. Payment security

PCI search (`cardNumber|pan|cvv|track|magstripe`): the only raw-card handler was the customer-web Pay form (fixed, §B);
everything else is the refusal list (`request-schemas` RAW_CARD), `card-data.ts`, redaction. Tokenization: CardSecure hosted
iFrame (customer app), Bolt (card present), saved cards store tokens only and the contract never returns the token. Secrets:
sealed columns with purpose keys, masked reads, no "view secret" anywhere. Webhooks: HMAC over raw body with the tenant's own secret.

## H. Payment concurrency (real PostgreSQL, scratch DB, this wave)

| Test | Result |
|---|---|
| duplicate charge — `checkout-concurrency.postgres-race` (10 stations, same visit → ONE payment; identical splits → ONE settlement) | PASS 4/4 |
| terminal busy — `terminal-lease.postgres-race` (10 stations → 1 lease; crashed lease expires) | PASS 3/3 |
| unknown state — `payment-attempt-sweep.postgres-race` (10 sweepers → ONE needs_review; two workers → one tick) | PASS 5/5 |
| refund race — `refund-race.realpg` | SKIPPED here (needs `REALPG_MODULES` binaries); cap enforced by `reserveRefundAtomic` (advisory lock) |
| terminal capture on the Clover (display path) — `terminal-capture.postgres-race`, `terminal-capture-paid.postgres-race`, `terminal-capture-post-payment.postgres-race` | PASS 13/13 |
| card idempotency (unit) — `checkout-card-idempotency`, `checkout-payment-metrics` (replay ≠ new attempt) | PASS |

## I. Twilio architecture

Tenant mapping: `tenant_messaging_credentials` (tenant default + branch rows), `account_mode` tenant_owned / platform_managed (639).
Subaccount: a tenant-owned account today; automated platform subaccount provisioning is DECIDED-not-built (needs Kevin's ISV
parent account decision). Messaging Service: `messaging_service_sid` on the tenant row or the A2P registration's verified
service → `MessagingServiceSid` on send. Number: `tenant_messaging_numbers` (one salon per number, purpose/status/SID).
Secret: auth token / API key secret sealed with the PROVIDER key, never returned. A2P: `tenant_a2p_registrations` (TrustHub
profile → brand → campaign → number), status changes now audited.

## J. SMS workflows

OTP: booking verification (Verify or salon number), TTL/attempts/resend/IP/device caps. Confirmation + reminders: reminders
service (window rule skips passed reminders). Queue notification / check-in: TenantMessenger, optional. Receipt: checkout →
TenantMessenger. Review: post-visit hook, never gated. Marketing: campaigns with consent, caps, quiet hours, cost preview +
confirmation (≥ 50 recipients).

## K. Messaging consent

Transactional texts follow the service relationship; marketing needs marketing consent; `purpose` stamped per send;
STOP/UNSUBSCRIBE/… → `notification_opt_outs` (blocks every non-account purpose); START re-opts; HELP answered.

## L. SMS billing

Segments: `notifications.segment_count` from Twilio (`num_segments` / `NumSegments`), unknown never guessed. Verification usage:
`sms_usage_records` against `sms_verification_packages` (included, overage, hard limit). Allowances/overage: data-driven
packages + `platform_settings.sms.marketing_segment_price_cents`. Cost attribution: `provider_cost_micros` per tenant/period.
Owner view: verification balance + "Text messages this month … segments".

## M. Webhooks

`docs/integrations/webhooks.md` — every route, its signature scheme, tenant resolution, dedupe key, storage and effects.

## N. Secrets

| Category | Where the reference / ciphertext lives |
|---|---|
| Merchant API credentials, Bolt keys, payment webhook secrets | `tenant_payment_config` / `payment_merchant_accounts` sealed columns (PAYMENT key) |
| Twilio auth tokens, API key secrets | `tenant_messaging_credentials` sealed columns (PROVIDER key); platform sender in env `TWILIO_*` |
| Bank webhook tokens | per bank endpoint row |
| Encryption keys | environment (key ring), production refuses to boot without real keys |

## O. Tenant isolation tests

Payments: `merchant-routing.pgtest` (8/8), `payment-webhook-dedupe.pgtest` (18/18), `terminal-capture-routing.pgtest` (4/4).
Twilio: `tenant-number-isolation.pgtest` (6/6), `tenant-messaging-credentials.pgtest` (10/10, "another salon's branch is refused").

## P. Branch isolation tests

Payments: `merchant-routing.pgtest` (branch merchant vs default, paused branch never falls back). Devices:
`terminal-capture-routing.pgtest` (the Cherry Hill Clover charges through the Cherry Hill merchant; a disabled terminal is never charged).

## Q. Provider failure tests

Clover offline: terminal capture (authCard throws → unknown, no retry; `terminal_offline` counted). Fiserv timeout:
`checkout-payment-metrics` (processor throws → unknown, never declined) + `payment-attempt-sweep` race. Twilio outage:
`messaging-metrics` (send throws → failed ledger row, caller unaffected), `provider-breaker.test`. Credential failure:
`tenant-messaging-credentials.pgtest` (failure clears validation, records why). Webhook duplicate: `payment-webhook-dedupe.pgtest`,
`twilio-webhook-dedupe.pgtest`; processing failure → `payment-webhook-inbox-failure.pgtest` (1/1).

## R. Observability

Metrics: provider telemetry (requests/failures/timeouts/latency/breaker), `aipowersalon_webhook_events_total{provider,outcome}`
incl. `failed` + `aipowersalon_webhook_latency_ms`, NEW `aipowersalon_payment_events_total{event}` (attempt, approved, declined,
unknown, refund, void, terminal_offline, terminal_busy) and `aipowersalon_messaging_events_total{event}` (segments_sent,
delivered, failed, verification_attempt, verification_success, rate_limited, opt_out). Logs: redacted, audit-scrubbed. Traces:
W3C traceparent through `instrumentedFetch`. Provider health: `providerHealth(provider)`. Tenant integration health: gateway /
branch-merchant status + last validation, messaging readiness, A2P status, terminal operational status.

## S. Files changed (PAYI, wave 3)

* payments: `modules/payments/src/payments/{payment-gateway.resolver,payment-webhook.service,payment-webhook.controller,processor.factory,integrations-production-config}.ts`, `index.ts`; specs `merchant-routing.pgtest`, `integrations-production-config.vitest`, `webhook-counters-wiring.vitest`.
* checkout: `checkout.service.ts`, `checkout.controller.ts`, `skip-line-checkout.service.ts`; specs `checkout-tenant-gateway-charge`, `checkout-error-taxonomy`, `checkout-payment-metrics`, `raw-card-refusal`, `skip-line-salon-gateway`, `checkout-card-idempotency`.
* tenants: `settings/{settings.service,settings.integrations,settings.terminals.kysely.repository,settings.controller,settings.module}.ts`, `request-schemas.ts`, `devices/{devices-overview-core,devices.kysely.repository}.ts`, `index.ts`; `settings-core.spec.ts`, `devices-overview-core.spec.ts`.
* super-admin: `super-admin-tenants.controller.ts`, `super-admin-tenants-core.ts`, `request-schemas-tenants.ts`; `payment-merchant-audit.vitest`.
* communications: `notifications/{notifications.service,notifications.kysely.repository,notifications.repository,notifications.dto,notifications.sender-numbers,notifications.tenant-sender}.ts`, `tenant-messaging/tenant-number.service.ts`, `tenant-a2p/tenant-a2p.service.ts`, `messaging-inbound/twilio-inbound.service.ts`, `sms-packages/{sms-tenant-plan.service,tenant-sms-plan.controller}.ts`, `campaigns/{campaigns.service,campaigns.controller,campaigns.repository,campaigns.kysely.repository}.ts`; specs `tenant-number-isolation.pgtest`, `tenant-a2p-audit.pgtest`, `sms-segments.pgtest`, `campaign-cost-preview`, `messaging-metrics`, credentials pgtest.
* booking: `booking-verification.service.ts` (metrics only).
* api: `apps/api/src/customer-display/terminal-capture.service.ts`, `customer-display.module.ts`, `apps/api/src/payments/terminal-probe.module.ts` (+spec), `app.module.ts` (1 line), `common/production-config.ts` (+spec), `common/payment-webhook-inbox-failure.pgtest`, `customer-display/terminal-capture-routing.pgtest`, `scripts/tenant-builder-baseline.json` (1 reviewed entry).
* packages: `api-contracts/src/{errors,payment-terminals,sms-segments}.ts` (+tests, index); `notifications/src/sms.service.ts` (+adapters test); `observability/src/{webhook-counters,integration-business-metrics,index}.ts` (+tests); `database/src/kysely.types.ts`.
* tooling: `tooling/architecture-tests/{run,graph}.mjs`.
* frontends: admin-web `BranchMerchantAccountsPanel` (+test), `PaymentGatewayPanel`, `superAdminApi`; pos-web `POSPaymentTerminalsScreen` (+tests), `POSDevicesScreen`, `posDevicesApi`, `SmsVerificationPanel` (+test), `posSmsPlanApi`, `POSCampaignCenterScreen` (+cost-preview test), `posCampaignsApi`; customer-web `PayScreen` (+test).
* gate records: `apps/api/scripts/secrets-exposure-check.mjs` (resolver review note), `tooling/ci/response-exposure.allowlist.json` (--update), `modules/communications/src/communications-lifecycles.ts` (TENANT_MESSAGING_NUMBER machine), `modules/communications/src/sms-packages/sms-tenant-plan.service.ts` (utcDate).
* docs: the 8 integration pages, 5 runbooks, this report.

## T. Database migrations

`638_payment_merchant_accounts_and_terminal_registry.sql`, `639_tenant_messaging_integration_model.sql`,
`640_sms_segment_accounting.sql`, `641_tenant_messaging_numbers_actor_stamp.sql` — additive, idempotent backfills, no rewrite of payment history (index notes for CONCURRENTLY in headers).

## U. API changes

`GET/POST /super-admin/tenants/:id/payment-gateway/branches[/:branchId[/test-connection|/status]]` (step-up on writes);
`POST /pos/settings/terminals/:id/{rename,disable,enable}`; terminal test is now a real probe; `GET /pos/campaigns/:id/cost-preview`,
activate takes `confirmEstimate` (409 `CAMPAIGN_CONFIRMATION_REQUIRED`); `GET /tenant/sms-plan` gains `messaging`; checkout
errors carry taxonomy codes (TERMINAL_BUSY 409, PAYMENT_ALREADY_COMPLETED …); skip-line confirm refuses raw PANs (400).
Contracts: `payment-terminals.ts`, `sms-segments.ts`, `errors.ts` codes.

## V. Worker changes

No new queue. The payment webhook inbox now retries through the processor's own redelivery (claim released on failure);
existing sweeps unchanged (verified on real Postgres).

## W. Frontend changes

POS: Payment Terminals rebuilt on the registry (status, rename, disable/enable, real test, unpair), Devices pill honest, SMS plan
segments, Campaign Center cost-preview confirmation. Super Admin: Branch merchant accounts panel. Customer app: hosted-tokenizer
card entry, no fake wallets. Owner app: unchanged by PAYI (payment-device health is the TTP owner's).

## X. Tests (this wave, exact)

| Suite | Result |
|---|---|
| modules/payments | PASS 235/235 |
| modules/communications | PASS 400/400 |
| modules/tenants (vitest) + settings-core harness | PASS 140/140 + 110/110 |
| modules/checkout | PASS 717 (43 race tests skipped in that run — run on real Postgres below) |
| modules/super-admin super-admin-tenants | PASS 64/64 |
| modules/booking booking-verification* | PASS 213 (5 skipped) |
| apps/api PAYI files with PG_RACE_URL (webhook dedupe / inbox failure, terminal capture + routing + races) | PASS 50/50 |
| real-Postgres race lane (checkout): terminal-lease, checkout-concurrency, payment-attempt-sweep | PASS 12/12 |
| refund-race.realpg | BLOCKED here (needs REALPG_MODULES binaries) |
| packages: api-contracts 97/97, observability 278/278, notifications 7/7 | PASS |
| frontends: pos-web touched screens 25/25, admin-web 17/17, customer-web PayScreen 8/8 | PASS |
| mutation checks (mut-PAYI) | 10/10 KILLED |

## Y. Build matrix

| Target | Result |
|---|---|
| API (tsc --noEmit) | PASS |
| Gates | PAYI-owned failures fixed (error-codes, api-contract, actor-stamp column, response-exposure, state-transitions, tenant-builder, architecture). Remaining need the lead's generators: `openapi.mjs --manifest` (new SA branch + terminal + cost-preview routes), `gen-actor-columns.mjs` (641), db-ownership registry (`pos_payment_terminals` sensitivity), event + realtime catalogs. Not PAYI: types-drift (migration 660), TTP's untyped mobile-checkout routes, check:tenant mobile-checkout sessions. |
| POS (tsc + vite) | PASS |
| Super Admin (tsc + vite) | PASS |
| Customer App (tsc + vite) | PASS |
| Owner App | not touched by PAYI |
| Modules (payments, tenants, communications, booking, checkout, super-admin) + packages | PASS |
| Workers / Realtime | same build as the API (PASS) |

## Z. External dependencies (BLOCKED_EXTERNAL only)

* Fiserv **production MID + API credentials** per salon (and Bolt production key) — boarded by Fiserv.
* A physical **Clover Compact** registered to that MID (HSN) for the production terminal test.
* **CommerceHub sandbox credentials** to run the Tap-to-Pay adapter's VERIFY points.
* **Twilio A2P 10DLC brand + campaign approval** per salon (carrier review) and a **production phone number** per salon.
* A managed **Secrets Manager** if Kevin wants one beyond sealed columns (hosting choice).
* Kevin's decision on **platform-managed Twilio subaccounts** (ISV parent account) — the schema mode exists; provisioning is not automated.
