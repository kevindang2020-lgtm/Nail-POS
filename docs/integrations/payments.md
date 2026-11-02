# Payments integration — how AIPowerSalon takes, refunds and reconciles card money

Mandate: *Payments, Clover/Fiserv, Twilio & External Integrations Completion Mandate* (Oct 13 2026), §4–§55, §111–§119.
Companion pages: [tenant-routing.md](tenant-routing.md), [fiserv.md](fiserv.md), [clover.md](clover.md),
[clover-compact.md](clover-compact.md), [webhooks.md](webhooks.md), runbooks under `docs/runbooks/`.

## 1. The one payment domain

```
POS / Customer Display / Manager Pay / Customer App
        ↓  (session-derived tenant + branch — never from a body)
modules/checkout   CheckoutService.payCard / paySplit / refund / void, TerminalCaptureService (display), mobile-checkout
        ↓
modules/payments   PaymentGatewayResolver  = THE provider router (§13)   tenant + branch → merchant account → adapter
        ↓
   CardPointeClient (Fiserv/CardConnect REST)   CloverPaymentAdapter (Clover Ecommerce)   CardPointeBoltClient (Clover Compact via Bolt)
        ↓
   processor / terminal
```

There is one `PaymentProcessor` port (`modules/payments/src/payments/payment-processor.port.ts`):
`authorizeAndCapture`, `refund`, `voidTransaction`, `inquireByOrderId` (status recovery), optional `testConnection`.
The terminal port (`TerminalDevicePort`: `ping`, `authCard`, `display`) is implemented by `CardPointeBoltClient`.
No provider SDK is used anywhere — the adapters speak the providers' REST APIs through `instrumentedFetch`
(timeouts, circuit breaker, latency/error metrics per provider). The architecture test (`tooling/architecture-tests`)
fails CI when a frontend, a UI package or a non-adapter module names a processor/Twilio host or imports a provider SDK (§154).

## 2. Data model (what exists — §8)

| Mandate entity | Table | Notes |
|---|---|---|
| TenantPaymentIntegration / MerchantAccount (tenant default) | `tenant_payment_config` | one row per tenant: processor, environment, MID, sealed credentials, Bolt base+key, `status` (PAYMENT_GATEWAY machine), `onboarding_status`, `config_version` |
| MerchantAccount (branch) | `payment_merchant_accounts` (638) | one row per branch that settles to its own MID; same columns + display_name, currency; `UNIQUE (tenant_id, branch_id)`; cross-tenant branch refused by trigger |
| PaymentTerminal | `pos_payment_terminals` (017 + 638) | label, station (register), HSN, provider/type/serial/connection, `merchant_account_id`, disabled_*, last_seen/ping/transaction |
| Terminal reservation | `payment_terminal_leases` (485) | one live lease per terminal, expires on its own |
| Payment / tender | `payments` | one row per TENDER (cash, card, gift card, split segment); `status` through the PAYMENT machine; `processor_transaction_id`, `auth_code`, `idempotency_key` |
| Payment attempt (split card reservation, mobile) | `payment_attempts` | claim-first idempotency row |
| Refund | `payment_refunds` | processor refund id unique per tenant |
| Void | `payments.status = 'voided'` + audit | void and refund are different verbs on the port and in the ledger |
| Chargeback | `chargebacks` (096) | case id unique per tenant |
| Settlement batch | `payment_settlements` (038) | gross / fee / net per processor batch; `settlement_id` unique per tenant |
| Processor payout | `payment_settlements.net_cents` | DECIDED: CardPointe funds per batch; the batch's net IS the expected payout (no separate table until a processor payout feed exists) |
| Bank deposit | `bank_deposits` (351) | matched to settlements by the deposit-reconciliation module |
| Webhook inbox | `payment_gateway_events` | provider, event id, signature_valid, matched payment, `processed_at` (claim), `processing_attempts`, `last_error` (638) |
| Fee schedules / adjustments / exceptions | `deposit_reconciliation_*` | §42 formula (gross − refunds − chargebacks − fees ± adjustments vs deposit) with honest `unverified` when data is missing |

## 3. Checkout → payment flow (§21–§28)

1. The backend computes the authoritative amount due (`repo.totalsFor` − `paidTotalCents`); the client sends only a tip selection / tender choice (§32).
2. **Claim first**: a `payments` row in `processing` with the idempotency key (`checkoutId + 'card' + due` or the client's key) is inserted BEFORE the processor call. A concurrent duplicate loses on the unique key and gets `PAYMENT_IN_PROGRESS` (409). A replay of an already-approved key returns the prior payment (§24).
3. Terminal: `payment_terminal_leases` is acquired for the register's terminal; a second POS gets `TERMINAL_BUSY` (409) until release (§19–§20).
4. The adapter is called with a **token** (hosted tokenizer / saved profile) or the Bolt terminal takes the card itself. The API never sees a PAN/CVV (§29–§31; `card-data.ts` is the tokenizer glue only).
5. Only the processor's answer moves money: approved → `recordPayment(approved)` + ticket paid (one transaction, outbox events `payment.captured` / `checkout.completed`); declined → the claim is released; **thrown / timed out → the claim stays `processing`** = PAYMENT_STATUS_UNKNOWN (§26). Nothing is retried blindly.
6. Unknown recovery: the cashier's **Verify with processor** (`verifyCardPayment` → `inquireByOrderId`) and the **payment-attempt sweep** (`payment-attempt-sweep.ts`, every tick, under the ticket's lock, `runAsSingleOwner`) resolve stranded attempts from the processor's own answer; "charged but not recorded" becomes `needs_review` + owner/SA alert, never an auto-void (§119).
7. Checkout completes only when balance due = 0 and no attempt is unknown (§34, §116).

Errors reach the screen as the registry sentence + code (`packages/api-contracts/src/errors.ts`, §134–§136):
`PAYMENT_PROVIDER_NOT_CONFIGURED`, `MERCHANT_NOT_CONFIGURED`, `MERCHANT_SUSPENDED`, `TERMINAL_NOT_CONFIGURED`, `TERMINAL_OFFLINE`,
`TERMINAL_BUSY`, `TERMINAL_DISABLED`, `PAYMENT_DECLINED`, `PAYMENT_STATUS_UNKNOWN`, `PAYMENT_ALREADY_COMPLETED`, `REFUND_EXCEEDS_AVAILABLE_AMOUNT`.

## 4. Refunds and voids (§35–§39)

* Default path: original tender → original refund path; split tickets allocate proportionally across original tenders (`refund-orchestration.ts`).
* Cap: `reserveRefundAtomic` reserves the amount under an advisory lock BEFORE the gateway call — cumulative refunds can never exceed the captured amount (`REFUND_EXCEEDS_AVAILABLE_AMOUNT`). Real-Postgres race test: `refund-race.realpg.vitest.spec.ts`.
* Idempotency: `@Idempotent()` (Idempotency-Key header) on `POST /pos/checkout/payments/:id/refund|void` and `tickets/:id/refund`; the compensation ledger keys reversals on the refund payment id (588).
* Approval thresholds + step-up for large refunds (`refund-approval.ts`, `checkout.approve_refund`).
* Historical captured rows are never edited: refunds, voids, chargebacks and adjustments are their own records (§39).

## 5. Settlement and reconciliation (§40–§43, §117–§118)

`payment_settlements` arrive from processor webhooks (`settlement.*`) and link payments by transaction id; `bank_deposits`
arrive from the bank webhook or import; `modules/payments/src/deposit-reconciliation` matches expected payout (net after
fees/refunds/chargebacks/adjustments) to deposits, flags exceptions, lets AI *explain* an exception while deterministic
matching decides the amounts (§43). Background sweeps run under the scheduler (`deposit-reconciliation.sweep.scheduler.ts`,
single-owner ticks) — reception never waits for settlement.

## 6. Permissions and audit (§54–§55)

Catalog keys (packages/permissions): `checkout.process_payment` (charge), `checkout.approve_refund` (refund past threshold, step-up),
`checkout.manage_overrides` (void / refund), `settings.view` (read terminals + gateway status), `settings.edit` (pair / rename / disable
terminals, step-up), `reconciliation.view|manage|approve`, Super Admin `super_admin.payments.view|manage` + step-up on merchant
configuration. Audited: gateway configured/changed, branch merchant configured/status/tested, terminal paired/unpaired/updated/
disabled/enabled/tested, refund created, void created, manual adjustments, webhook secret rotated — never a secret.

## 7. Health and screens (§49–§53)

* Provider health: `providerHealth(provider)` (calls, failures, timeouts, last success/failure, breaker state) → System Operations / `/metrics`.
* Terminal health: the normalized status (`terminalOperationalStatus`, contracts) from last seen / last ping / live lease / disabled — POS **Devices → Payment Terminals** (`POSPaymentTerminalsScreen`) with Test connection (a real Bolt ping, never a charge), Rename, Disable/Enable, Unpair.
* Super Admin: **Payment Gateways** command center (masked), per-tenant **Configure Gateway** drawer + **Branch merchant accounts** panel, settlements, webhook events + health. No secret is ever returned (§162).
