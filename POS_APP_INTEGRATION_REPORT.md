# POS_APP_INTEGRATION_REPORT.md

Both apps share the POS's data + recalc + realtime — they do not maintain parallel logic.

## Shared paths
- **Ticket edits** (tech app + POS Serving) go through one bridge in `apps/api/src/serving/` → one recalc, one set of
  realtime events. So a tech edit updates POS Serving, POS Checkout totals, Customer Display, the Customer App, reports,
  and technician earnings consistently (TECH_LIVE_TICKET_EDIT_REPORT.md).
- **Check-in / queue** (POS, Go Check-In kiosk, Customer App) share `apps/api/src/check-in/` + `pos_queue_items` and emit
  `customer_checked_in` / `queue_updated` to the tenant/branch room (`apps/api/src/realtime/realtime-core.ts`).
- **Booking** (Customer App + POS Booking + Tech schedule) shares `apps/api/src/customer-booking/` +
  `pos_tech_appointments`.
- **Checkout / receipts** shared via `apps/api/src/checkout/` + `apps/api/src/wallet/`.

## Realtime
`apps/api/src/realtime/` (`REALTIME` emitter, per-tenant/branch rooms, SSE at `GET /realtime/stream`). Verified live this
session: a kiosk check-in pushed `customer_checked_in` + `queue_updated` (with the `screens` to refetch) to a subscribed
POS client.
