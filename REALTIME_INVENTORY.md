# REALTIME_INVENTORY.md — Realtime Events, Channels & Streaming Architecture

**Status Date:** October 14, 2026  
**Realtime Framework:** Transactional Outbox + SSE / WebSocket Gateway (`@aipowersalon/realtime-contracts`)  
**Client SDK:** `@aipowersalon/realtime-client` with Smooth Refresh Sync Engine  
**Catalog Count:** 112 Realtime Events across 18 Audience Channels

---

## 1. Realtime Architectural Topology

```
   ┌───────────────────────────────────────────────┐
   │            Database Transaction               │
   │  1. Business Row Mutation (Ticket/Appt/Queue) │
   │  2. Domain Event Insert into `outbox_events`  │
   └──────────────────────┬────────────────────────┘
                          │ Commit
                          ▼
   ┌───────────────────────────────────────────────┐
   │          Outbox Publisher Worker              │
   │  Polls `outbox_events` (100ms / LISTEN notify)│
   └──────────────────────┬────────────────────────┘
                          │ Project Event
                          ▼
   ┌───────────────────────────────────────────────┐
   │         Realtime Gateway (SSE & WS)           │
   │  Channel Authorization • Tenant Room Router   │
   └──────────┬──────────────┬──────────────┬──────┘
              │              │              │
              ▼              ▼              ▼
         POS Web App    Tech Mobile    Customer Display
         (Cashier View) (Tech Queue)   (Live Line Items)
```

---

## 2. Core Realtime Channels & Audience Permissions

| Channel Pattern | Audience & Purpose | Required Permission | Connected Apps |
|---|---|---|---|
| `salon:{tenantId}:{branchId}:queue` | Live customer queue & walk-in updates | `pos.queue.view` | POS Web, Go Check-In Kiosk |
| `salon:{tenantId}:{branchId}:turn_board` | Fair Turn rotation & technician order | `pos.turn.view` | POS Web, Tech App |
| `tech:{tenantId}:{technicianId}:tickets` | Technician personal queue & ticket lines | `tech.ticket.view` | Tech Web / Mobile App |
| `booking:{tenantId}:{branchId}:calendar` | Appointment calendar changes | `pos.booking.view` | POS Web, Tech App |
| `display:{tenantId}:{terminalId}:cart` | Real-time dual-screen customer display | `pos.display.view` | Customer Display (23-inch) |
| `checkout:{tenantId}:{ticketId}:state` | Live payment processing, tip selection | `pos.checkout.view` | POS Web, Customer Display |
| `customer:{tenantId}:{customerId}:feed` | Customer booking confirmations, queue status | Signed-in Customer | Customer Web / Mobile App |
| `security:{tenantId}:alerts` | High-risk action alerts & step-up requests | `admin.security.view` | Super Admin Web, Owner App |

---

## 3. Realtime Event Registry (Excerpt of Canonical Events)

| Event Name | Domain | Audience Channel | Resource Version | Smooth Refresh Trigger |
|---|---|---|:---:|---|
| `appointment_created` | Booking | `booking:calendar` | v2 | Re-fetches day appointments without losing open edit drawers |
| `appointment_rescheduled`| Booking | `booking:calendar` | v2 | Updates appointment slot dynamically |
| `customer_checked_in` | Queue | `salon:queue` | v2 | Adds guest to waiting room list with sound chime |
| `queue_customer_called` | Queue | `salon:queue`, `display:wall` | v1 | Triggers kiosk announcement & display wall alert |
| `queue_customer_assigned`| Workforce | `salon:turn_board`, `tech:tickets` | v2 | Advances Fair Turn rotation bucket |
| `service_started` | Service | `tech:tickets`, `salon:queue` | v1 | Transitions ticket state to in-progress |
| `service_done` | Service | `tech:tickets`, `checkout:state` | v2 | Auto-generates checkout ticket from completed lines |
| `checkout_updated` | Checkout | `display:cart` | v1 | Displays itemized line items, tax, and surcharge on dual-screen |
| `tip_selected` | Checkout | `checkout:state` | v1 | Reflects tip choice from customer display to POS screen |
| `payment_completed` | Payments | `checkout:state`, `display:cart` | v2 | Displays thank-you screen and generates digital receipt |
| `commission_updated` | Workforce | `tech:tickets` | v1 | Updates technician daily earnings counter |
| `inventory_low_stock` | Inventory | `salon:staff` | v1 | Triggers reorder toast on manager workstation |

---

## 4. Smooth Refresh Engine & Reliability Guarantees

- **No Page Flashes:** Background refreshes never blank or remount active screens (`packages/realtime-client/src/sync-policy.ts`).
- **No Lost Form Inputs:** Uncommitted form inputs, partial customer search queries, and active line item overrides are preserved during background data synchronizations.
- **Back-off & Automatic Reconnection:** Client connections employ exponential backoff with jitter on network disconnects, immediately fetching an incremental changelog (`/changes?since=<timestamp>`) upon reconnection.
