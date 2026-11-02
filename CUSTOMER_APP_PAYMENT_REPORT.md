# Customer App Payment — Report

## Done (backend, verified live)
- `GET /customer/me/active-bill` → the customer's current **service-done, unpaid** ticket as a server-computed bill
  (invoice=ticket number, salon/tech, service lines + prices, subtotal, tax, tip, discount, **total due**) plus the
  tenant's enabled methods. Customer resolved from the session (`customers.user_id`); never trusts a client id.
- **Cash to technician** — `POST /customer/payments/:invoiceId/pay-cash-to-tech` (intent + pending tech confirmation).
- **Card / Apple Pay / Google Pay charge** (NEW this increment):
  - `POST /customer/payments/:invoiceId/start` → creates the payment intent and reports gateway availability
    (`configured`, `gateway`) so the app knows whether to render card/wallet entry.
  - `POST /customer/payments/:invoiceId/confirm` → charges via the **tenant processor** (`processorFromEnv()` → CardPointe
    when `CARDPOINTE_*` is set; a clearly-labeled **sandbox** when `PAYMENTS_SANDBOX=1`; otherwise an honest
    "not configured"). Accepts a **tokenized** card (hosted fields / wallet token) or a **saved method**
    (`paymentMethodId`) — **never a raw PAN/CVV**. On approval it records the payment (with the processor retref) and
    **closes the ticket** in one transaction; on decline it records a declined payment and leaves the ticket open. Amount
    is the **backend-recomputed balance** (idempotency-keyed so a retried confirm can't double-charge).
  - `GET /customer/payments/:paymentId/status` → intent status for the Processing screen to poll.

Verified live (sandbox): start → tokenized confirm → **succeeded**, ticket closed, `payments` row `card|approved|5150`
with a processor reference + audit row; **declined** token → ticket stays open, intent `failed`; missing token → 400;
**Apple Pay** token routes through (`payments.method = apple_pay`); re-confirm on a paid ticket → 409; ownership and
tenant isolation enforced (Ivy / tenant-B → 403); status polling returns `succeeded`.

## Deferred (next increment)
- The five **customer-web screens** (Review Bill → Choose Method → Card → Processing → Success → Receipt) and the
  "Pay Cash to Technician" CTA; `GET /customer/me/invoices/:invoiceId` and receipt GET endpoints for the app.
- Apple/Google Pay are surfaced only when the gateway advertises support; the merchant-validation handshake is a
  front-end concern wired during the screen build.
