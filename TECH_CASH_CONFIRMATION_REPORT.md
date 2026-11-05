# Technician Cash Confirmation — Report

## Done (backend, verified live)
- `GET /tech/me/cash-pending` → cash confirmations awaiting **this** technician (resolved via `technicians.user_id`),
  each with ticket number, customer, services, amount.
- `GET /tech/tickets/:ticketId/cash-payment` → the pending cash detail for one ticket (assignment-checked).
- `POST /tech/tickets/:ticketId/confirm-cash-received` → backend **verifies the tech is assigned** (or holds
  `pos.checkout.take_payment` to override), **verifies tenant/branch + that the ticket isn't already paid**, recomputes
  the **authoritative balance**, records a `cash`/`approved` payment into `payments`, **closes the ticket**
  (`paid`, `paid_at`), flips the intent to `cash_confirmed_by_tech` and the confirmation to `confirmed`, writes an
  **audit log** row, and emits `cash_confirmed_by_tech` + `ticket_paid` + `ticket_closed`. Cannot double-confirm a paid
  ticket (404 — no pending cash).
- `POST /tech/tickets/:ticketId/report-cash-not-paid` → confirmation → `customer_did_not_pay`, intent →
  `cash_issue_needs_front_desk`, **ticket stays open**, a front-desk **alert** is created, `cash_issue_needs_front_desk`
  emitted.

## Notes
- Technician earnings/tips: the payment carries `tip_cents`; the existing earnings views read paid tickets — no separate
  write needed. A loyalty-points hook on payment is deferred (see REMAINING_BLOCKERS.md).
