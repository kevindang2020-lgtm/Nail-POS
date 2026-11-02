# Skip-the-Line Checkout — Code Audit (audit-first, merge don't duplicate)

Searched the whole monorepo for: checkout, payment(s), customer app, tech app, ticket, invoice, receipt,
cash/card/split/gift payment, tip, customer display, service done, serving, payment gateway, Fiserv/Clover, loyalty.

**Headline:** the payment *engine* already exists and is solid (POS checkout, multi-processor gateways, receipts,
loyalty tables, Service-Done→Checkout, realtime). What does **not** exist is the Skip-the-Line orchestration:
**payment intents**, the **cash-to-technician confirmation** flow, and a **customer "pay my active bill from the app"**
path. The build adds exactly those, **reusing** the existing bill math (`computeTotals`/`subtotalFromLines`), the
`payments`/`receipts` tables, the processor abstraction, the realtime bus, and the audit log — no second checkout system.

## Inventory

| Path | What it does | Layer | Cust | Tech | POS | BE | Gateway | Real API | Mock | Disposition | Missing |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `apps/api/src/checkout/` | POS checkout: pay cash/card/gift/split, tips, discounts, **backend totals** (`computeTotals`), refund/void, receipts (sms/email/app), gift cards, customer-display sessions | BE | no | no | **yes** | yes | yes | yes | no | **KEEP + reuse** (bill math, `payments` table, receipts, ticket-close) | app-initiated pay; cash-pending-tech state |
| `apps/api/src/payments/` | Processor abstraction + clients (CardPointe/Clover/Square/Stripe), per-tenant `payment-gateway.resolver`, `processor.factory`, webhooks, reconciliation | BE | — | — | — | yes | **yes** | yes | sandbox | **KEEP + reuse** (intents call this for card/app charges) | intent lifecycle on top |
| `apps/api/src/customer-payments/` | `/customer/payment-methods` (list/add/remove/default) + `/customer/wallet/top-up` | BE | **yes** | no | no | yes | tokenized | yes | no | **KEEP + reuse** (saved methods for app card pay) | "pay my bill" flow |
| `apps/api/src/customer/` | Customer app backend (queue, realtime, core) | BE | yes | — | — | yes | — | yes | no | **KEEP** (add active-bill + pay endpoints here-adjacent) | active-bill, pay |
| `apps/api/src/tech/` | Tech app: tickets, accept, start-service, **service-done**, service-line edits, notifications | BE | — | **yes** | — | yes | — | yes | no | **KEEP + extend** (add cash-pending + confirm/report) | cash confirmation |
| `apps/api/src/service-done/` | Service Done: quality-check, mark-ready / **send-to-checkout**, notify-customer, reopen | BE | — | — | yes | yes | — | yes | no | **KEEP + extend** (offer Skip-the-Line send) | send-app-payment, cash option |
| `apps/api/src/serving/` | In-service ticket state | BE | — | — | yes | yes | — | yes | no | KEEP | — |
| `apps/api/src/customer-display/` | Display device + `terminal-capture` (card capture on display) | BE | — | — | yes | yes | yes | yes | no | KEEP (alternate pay surface) | — |
| `apps/api/src/wallet/` | Wallet/stored-value ledger | BE | yes | — | — | yes | — | yes | no | KEEP (wallet/gift as a method) | — |
| `apps/api/src/realtime/` | SSE push bus (used by check-in/booking/settings) | BE | — | — | — | yes | — | yes | no | **KEEP + reuse** (emit skip-line events) | skip-line topics |
| DB `payments`, `receipts`, `payment_refunds`, `payment_settlements`, `payment_gateway_events` | payment + receipt persistence | DB | — | — | — | yes | — | yes | no | **KEEP + reuse** | — |
| DB `customer_payment_methods`, `customer_loyalty_profiles`, `loyalty_rewards`, `loyalty_redemptions` | saved methods + loyalty | DB | yes | — | — | yes | — | yes | no | **KEEP + reuse** | loyalty-on-payment hook |
| `apps/customer-web`, `apps/tech-web`, `apps/pos-web` | the three React frontends | FE | yes | yes | yes | — | — | yes | no | **KEEP + add screens** | skip-line UI |

## What is MISSING (the build)

- **Tables:** `payment_intents`, `cash_payment_confirmations`, `skip_line_checkout_settings` (per-tenant). (No `invoices`
  table exists — "invoice" = the ticket's derived bill; `invoiceId` in the spec maps to a ticket id/number. Confirmed.)
- **Customer pay-from-app:** `GET /customer/me/active-bill`, `POST /customer/payments/:id/start|confirm|pay-cash-to-tech`,
  `GET /customer/payments/:id/status`.
- **Technician cash confirmation:** `GET /tech/me/cash-pending`, `POST /tech/tickets/:id/confirm-cash-received`,
  `POST /tech/tickets/:id/report-cash-not-paid`.
- **POS surfacing:** skip-line statuses in checkout state + `send-app-payment` / `cancel-app-payment`.
- **Settings:** auto-send prompt, allow cash-to-tech, require tech confirmation, manager approval over amount.
- **Realtime/notifications** for the above; **frontends** (customer/tech/pos) and the **website** section.

## Merge rules honored
- One bill-math source (`computeTotals`/`subtotalFromLines`), one `payments` table, one `receipts` path — reused, not
  re-implemented. The new module orchestrates *who* initiates payment and adds the *cash-pending-confirmation* state.
- Backend-authoritative money everywhere; tenant/branch always derived server-side (session/ticket/assignment).
- Production mock data: none introduced; sandbox processor only when `PAYMENTS_SANDBOX=1`.
