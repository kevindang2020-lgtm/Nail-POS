# TECH_LIVE_TICKET_EDIT_REPORT.md

The spec's most-emphasized feature (§5–§12): a technician edits a live accepted ticket. **Already implemented and
backend-authoritative.**

## Endpoints (`apps/api/src/tech/tech.controller.ts`)
- `GET  /tech/tickets/:id/edit-options`
- `POST /tech/tickets/:id/service-lines` — add a service line
- `PATCH /tech/tickets/:id/service-lines/:lineId` — update (notes/status)
- `DELETE /tech/tickets/:id/service-lines/:lineId` — remove
- `POST /tech/tickets/:id/change-requests` / `GET …/change-requests` — manager approval
- `POST /tech/tickets/:id/add-addon`, `POST …/notes`, `POST …/accept`, `POST …/start-service`, `POST …/service-done`

## Backend-authoritative design (`apps/api/src/tech/tech.service.ts`)
Each edit method: (1) resolves the technician, (2) requires `tech.ticket.edit_lines`, (3) verifies **ticket ownership**
(`ownedTicket` — enforces tenant + assigned technician), then (4) delegates to the shared serving bridge
(`techAddService` / `techChangeService` / `techRemoveLine` / `techPatchLine`). The bridge is the **same recalc + realtime
path the POS Serving screen uses**, so the ticket total, checkout total, customer display, customer app, reports, and
technician earnings all update consistently — totals are never computed on the phone. Every edit is **audit-logged**
(`auditSafe`).

## Status gating (§6) and approval (§7)
Editing is allowed only for editable ticket statuses; locked tickets (ready_for_checkout / in_payment / paid / voided /
cancelled / refunded / closed) are rejected with the front-desk message. Changes that require approval create a
`ticket_change_request` (statuses pending/approved/rejected/cancelled/applied) and are decided from POS Serving
(`apps/api/src/serving/serving.controller.ts` change-request decision).

## Realtime (§12)
The shared bridge emits `ticket_service_line_added/updated/removed`, `ticket_total_recalculated`,
`ticket_change_request_*`, and the serving/checkout/customer-display update events (see `apps/api/src/realtime/realtime-core.ts`).

## Bug fixed during verification (high severity)
The tech edit path passed the tech-queue **projection** id (`pos_tech_queue_tickets.id`) to the serving bridge, which is
keyed on the real `tickets.id` — so every live edit would miss the ticket. Fixed by exposing `realTicketId` from
`getTicket` and translating at all 8 bridge calls in `tech.service.ts` (guarded + regression-tested). See BUG_FIX_REPORT.md.

## Verification — recalc PROVEN
- Builds clean; `apps/api/src/tech` + `apps/api/src/serving` tests pass.
- Endpoints present and wired; ownership/permission/audit enforced in code.
- **Backend recalculation is now covered by a dedicated test** (`apps/api/src/serving/serving-tech-recalc.vitest.spec.ts`):
  using the real `ServingService` + repo, `techAddService` on a live in-service ticket takes the backend-computed
  subtotal from **7000 → 13500** when a $65 service is added (service count +1), and the shared bridge emits
  `ticketTotalRecalculated` + `ticketServiceLineAdded` to the tenant room (POS Serving/Checkout/Display refetch). An
  invalid service is rejected with **no** total change. This is the same recompute path (`subtotalFromServingLines`) the
  Kysely/production repo uses, so the tech-app edit and POS Serving edit recalc identically.
- **Live HTTP round-trip PROVEN (against Postgres, aps_fresh).** Seeded a serving ticket owned by a real technician
  (Ava, user `tech@luxenails.test`) + its `pos_tech_queue_tickets` projection (distinct id), minted a TECHNICIAN session,
  and hit the real endpoints: `GET /tech/tickets/:projId` → 1 line / 5000; `POST /tech/tickets/:projId/service-lines`
  → **201** "Service added to ticket."; `GET` again → **2 lines / 10000**. DB proof: the new `ticket_service_lines` row
  attached to the **real `tickets.id` (2 lines), with 0 stray lines on the projection id** — i.e. the id-translation fix
  works through the full HTTP + session + Kysely path, written `by TECHNICIAN` with the technician's user id. This is the
  exact scenario that failed before the fix.
