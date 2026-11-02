# POS Checkout Integration — Report

## Done (backend, verified live)
- `GET /pos/checkout/skip-line/state` → open app-payment intents + cash confirmations (sent-to-customer, processing,
  cash-pending, cash-issue, failed) joined to ticket numbers/customers — so the front desk sees "customer paid in app",
  "cash pending technician confirmation", "cash confirmed", "needs front desk help". Gated by `pos.checkout.view`
  (OWNER/SUPER_ADMIN pass).
- `GET /pos/tickets/:ticketId/payment-status` → paid state + total due + any pending cash.
- `POST /pos/tickets/:ticketId/send-app-payment` → creates a `sent_to_customer` intent + emits the prompt to the
  customer; rejects paid tickets (409).
- `POST /pos/tickets/:ticketId/cancel-app-payment` and `…/move-to-front-desk-checkout` → cancel the open app request so
  the ticket falls back to normal front-desk checkout. Manager override honored.

## Reuse
- The existing POS **checkout** module already lists ready/unpaid tickets and records cash/card/split/gift payments; this
  feature adds the skip-line *status overlay* + app-payment controls on top of the same `tickets`/`payments` data — no
  second checkout system. Service Done → Checkout wiring is unchanged; the `auto_send_prompt_on_service_done` /
  cash-to-tech settings control the skip-line behavior (front-end hookup of the Service-Done buttons is the next step).
