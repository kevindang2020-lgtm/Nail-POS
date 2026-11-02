# Tech Queue Projection — Fix Report

**Found by:** a new live, end-to-end technician-journey harness (`apps/api/scripts/e2e-tech-journey.mjs`) that drives the
real NestJS API on a real Postgres engine.
**Severity:** production-blocking for the technician app's core function.
**Status:** FIXED + verified end-to-end + wired into the live regression gate.

---

## What was broken

The technician app (`/tech/*`) and the front-desk tech-queue board (`/pos/tech-queue/*`) both read tickets from the
`pos_tech_queue_tickets` table. **Nothing in the application — and no database trigger — ever inserted a row into that
table.** Every reference to it across `src` is a `selectFrom` (read) or `updateTable` (state change); there is no
`insertInto` and no raw `INSERT` anywhere in application code. The only inserts were in test harnesses, which seed the
table directly.

The front-desk "move to tech queue" action (`POST /pos/queue/items/:id/move-to-tech-queue`) only flipped the
`pos_queue_items.status` to `moved_to_tech_queue` and set an in-memory idempotency key. It returned the **same** queue
item id and never created the technician-facing ticket.

**Net effect in production:** a ticket "moved to the tech queue" never reached the technician. The tech's queue
(`/tech/queue/state`), ticket list (`/tech/tickets`), and the front-desk tech-queue board would all stay empty, so a
technician could never see, accept, start, or complete a service through the app. The per-component tech logic was fine
all along (the tech harnesses pass because they seed `pos_tech_queue_tickets` directly) — the **wiring** from the live
front-desk queue into the tech queue was missing. This is the technician-side analogue of the earlier customer
self-registration gap: the pieces worked in isolation, but the end-to-end path was never connected.

## Root cause

`QueueService.moveToTechQueue` performed a status flip but no projection. `pos_tech_queue_tickets` (migration
`027_tech_queue.sql`) is a real table with `queue_item_id REFERENCES pos_queue_items(id)` and
`assigned_technician_id UUID NOT NULL REFERENCES technicians(id)`, but nothing populated it from the queue flow.

## The fix

Added an idempotent **projection** that creates the `pos_tech_queue_tickets` row from the queue item when it is moved to
the tech queue:

- **`src/queue/queue.repository.ts`** — added `projectToTechQueue(ctx, id)` to the `QueueRepositoryPort` interface, plus
  a no-op implementation on the in-memory test double (the in-memory double has no real tech-queue table; the live path
  is Kysely).
- **`src/queue/queue.kysely.repository.ts`** — the real implementation: reads the tenant/branch-scoped queue item and
  inserts a `pos_tech_queue_tickets` row (`status='assigned'`, carrying customer, services, ticket linkage, source,
  priority, VIP flag, and `assigned_technician_id`). Idempotent on `queue_item_id` so a repeated move never creates a
  duplicate. `source`/`priority` are coerced to the tech-queue `CHECK` domains so an out-of-domain queue value cannot
  fail the insert.
- **`src/queue/queue.service.ts`** — `moveToTechQueue` now calls the projection after the status flip, emits the
  existing `queueUpdated` realtime event (so the tech's live stream refreshes), and additively returns the new
  `techQueueTicketId`. The pre-existing idempotency short-circuit also returns the existing ticket id.

The move-to-tech-queue gate already requires an assigned technician (`canMoveToTechQueue` → `TECHNICIAN_REQUIRED`), so
the `NOT NULL assigned_technician_id` is always satisfiable.

## Verification

**New live journey (`e2e-tech-journey.mjs`) — 19/19, against the real API + real Postgres:**
owner seeds a service + a login-capable technician → owner routes a walk-in (check-in → queue → assign → move-to-tech-queue)
→ the projection creates the tech-queue ticket → the technician logs in (real scrypt-hashed credentials) → sees the
customer in the queue → sees the ticket in the list → accepts → starts service → marks service done → reads earnings +
ratings. The technician's HTTP actions drive the shared `pos_tech_queue_tickets` row through its real lifecycle
(`assigned → accepted → in_service`, with `accepted_at`/`started_at` set), proving the front-desk → technician wiring.

**No regression:**
- `npm run build` clean.
- Queue/check-in/tech harnesses green: `verify-checkin` 6, `verify-tech` 28, `verify-tech-profile-http` 30.
- Affected core specs green: `queue-core`, `check-in-core`, `booking-core` 79/79, `tech-appointments-core`.
- Full `npm run e2e:live` green with the new guard added to the gate: `e2e-flow` 14, `e2e-customer-journey` 13,
  **`e2e-tech-journey` 19**, `e2e-rbac` 14, `e2e-receipts` 7, `e2e-skill` 5, `e2e-cardpointe` 7; RLS 102 policies
  fail-closed. The harness is now a permanent regression guard in the `e2e-live` gate array.

## Honest note — a related, deeper item (NOT changed here, flagged for your decision)

In a walk-in that enters the tech queue **without** a prior front-desk "start service", the underlying POS ticket and
`ticket_service_lines` are not created (those are created in the front-desk serving path). The tech-queue ticket's
`status` is intentionally never `done` — that value isn't in the table's `CHECK`; by design, completion is recorded on
the service lines, which is what the dashboard/earnings reads use. So when a technician marks "service done" on a
walk-in that arrived via the tech queue with no ticket yet, the call succeeds but there are no service lines to mark
complete, and no commission/earnings is recorded for that path.

This is a separate, money-path architecture decision (where/when the POS ticket + service lines are created for a
tech-queue-first flow) and is **not** silently changed in this fix. The projection fix above is the necessary first step
— it makes the tech queue reachable from the live flow — and the existing per-service completion/earnings logic is
already covered by the tech harnesses on properly-formed tickets.
