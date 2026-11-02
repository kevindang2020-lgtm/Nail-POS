# HARDWARE_PAYMENT_CODE_AUDIT.md

Audit run before building. Existing payment/billing/hardware infrastructure was **merged with, not duplicated**.

## Existing code found + how it was used
| Path | What it does | Layer | Decision |
|---|---|---|---|
| `apps/api/src/payments/` (cardpointe.client.ts, cardpointe-bolt.client.ts, clover/square/stripe clients, `payment-processor.port.ts`, `processor.factory.ts`) | Tokenized card processing — `PaymentProcessor.authorizeAndCapture({ token, amountCents })`, Fiserv CardPointe + others | backend | **Reuse** — the auto-charge depends on a small `HardwareChargePort` that production wires to this processor (token in, no raw PAN). |
| `apps/api/src/super-admin-billing/` (billing-core.ts, billing.service.ts, invoices/subscriptions) | Subscription + overage billing, money helpers | backend | **Merge pattern** — followed its integer-cents + Super-Admin-guard conventions; did not fork it. |
| `database/kysely.types.ts` → `HardwarePackagesTable` (`hardware_packages`) | Existing hardware package records (iMac/Clover/display serials, agreement/payment-setup status) | db | **Reference** — `hardware_payment_plans.hardware_package_id` points at it; not re-created. |
| `database/kysely.types.ts` → `TenantHardwarePayoffTable` (`tenant_hardware_payoff`) | Existing simple hardware balance (total/remaining cents) | db | **Coexists** — the richer `hardware_payment_plans.remaining_balance_cents` tracks the financing plan; keep payoff in sync in a later pass. |
| `apps/api/src/super-admin-platform/super-admin-platform.service.ts` | Already creates a hardware-package record on application approval | backend | **Reference** — the plan attaches to that package. |
| `apps/api/src/common/guards/` (super-admin, tenant-auth, role-permission) | Auth guards | backend | **Reuse** — Super-Admin + Owner controllers use these. |

## What was missing (and is now built — see HARDWARE_PAYMENT_BUILD_REPORT.md)
No revenue-split → hardware-credit → shortfall → auto-charge logic existed; no hardware payment plans / split settings / hardware invoices / hardware ledger / autopay consents / tokenized tenant payment methods / reconciliation runs. All added under `apps/api/src/hardware-payment/` + migration `078`.

## Rules honored
No duplicate billing/payment code. Tokenized card-on-file **only** — a hard guard rejects anything resembling a raw PAN/CVV. All money in integer cents + basis points.
