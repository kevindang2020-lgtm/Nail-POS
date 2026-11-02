# Customer Timeline (POS) — Nov 2 2026

Guide: *Customer Timeline* (Kevin, Nov 1 2026). Route: `/tenant/ai/customer-profile/timeline` (unchanged).

## Audit findings (before the build)

| Area | Status | Finding |
|---|---|---|
| Screen | Partial | Title, subtitle, a lookup and a "load older" list. No summary, filters, dates or pages, and no grouping by visit. |
| Backend `/pos/ai-customer-profile/customers/:id/timeline` | Partial | Loaded the customer's **whole** visit and appointment history into memory, then sliced it. Only covered completed visits and appointment state. No payments, refunds, receipts, check-in, queue, loyalty, memberships, gift cards, messages or merges. |
| Access | Wrong gate | Required the AI Customer Profile package, but history is factual (Customer Search's rule: only AI enrichments need the package). |
| Indexes | Partial | Per-customer indexes were missing on queue items, membership activity, gift cards, and payments/receipts by ticket. |

## What was built

- **Search first.**
  - Nothing is shown until a customer is chosen.
  - The lookup is **Customer Search's directory**, reused. Similar names and shared phones stay separate rows, with a "shares contact" hint.
- **Customer 360° summary.** This is **Customer Search's audited profile**, reused. It shows completed visits, first and last visit, upcoming appointments, recorded preferred technician, ledger points and membership.
  - An unavailable source is named, never shown as zero.
- **Source-linked events** (`GET /pos/customer-timeline/customers/:id/events`). One query reads every owning system directly. There is **no projection table**, so the timeline cannot drift from the source.

  | Family | Source |
  |---|---|
  | appointment | Booking: the booking, plus the current status as its own event |
  | visit | Check-In, the queue's status history, and the ticket (service started, Service Done, visit completed, ticket removed) |
  | money | Payments, refunds, receipts |
  | benefit | Loyalty ledger, membership activity, gift-card transactions |
  | communication | Customer notifications, appointment reminders |
  | profile | Profile created, merges in and out |

- **Event ids** are the source record's own id, so a replay can never show twice and a real status change stays its own event.
- **Ordering:** by when the event *happened* (`occurred_at`), with a stable id tie-break. A visit imported today keeps its old date. "Recently added" is a separate sort.
- **Grouping:** one visit's appointment, check-in, queue moves, service, payment, receipt, refund and points share a visit reference. The appointment is linked through the queue item.
- **Filters:**
  - category;
  - date dimension: happened, recorded, or appointment date;
  - presets: Today, Yesterday, This week, Last 7, This month, Last month, Last 30, Last 90, This year, All, Custom (month calendar), using salon-local days;
  - search inside the history: ticket or receipt number, appointment or ticket id, technician or service name (accents optional).
- **Pages:** 10/25/50/100 with a real total.
- **New activity** is announced with a banner instead of moving the page.
- **Field visibility:**
  - payment, refund, receipt and visit amounts, card brand and last 4, and tips need `pos.checkout.view`;
  - message text needs `pos.communications.view`;
  - membership amounts need `pos.memberships.view`;
  - receipt email addresses are always masked;
  - loyalty points are not money and are shown to everyone who can view the timeline.
- **Event detail** (`GET …/events/:eventId`) re-reads the event from its source with tenant, customer and branch scope. For a visit it adds every service line with its technician, so multi-service and multi-technician visits show fully.
  - Every open is audited, fail-closed.
  - Buttons open the owning module: Booking, Checkout, Refunds, Loyalty, Memberships, Gift Cards, Customer.
- **Check Customer Timeline System** (`POST check`): 12 read-only checks, rate-limited to one run per 30 s. They cover:
  - every source answering;
  - the directory;
  - phone storage format;
  - tenant isolation;
  - visits without service lines;
  - bookings linked to visits;
  - chronology (future-dated or missing completion times, plus imports keeping their date);
  - history left behind by merges;
  - loyalty ledger agreement;
  - indexes;
  - branch time zones;
  - open duplicate groups.

## Permissions

| Action | Permission |
|---|---|
| Events, event detail, check | `pos.customers.view` (not the AI package) |
| Amounts, card brand / last 4, tips | `pos.checkout.view` |
| Message text | `pos.communications.view` |
| Membership amounts | `pos.memberships.view` |

Branch-confined roles see only their branches' events, and the customer only if they have activity there.

## Database (migration 762, additive)

**Table:** `customer_timeline_health_runs`.

**Indexes:** `ix_pos_queue_items_tenant_customer`, `ix_membership_activity_tenant_customer`, `ix_gift_cards_tenant_customer`, `ix_payments_tenant_ticket`, `ix_receipts_tenant_ticket`, `ix_customer_merge_logs_tenant_source` / `_target`.

**Rollback:** drop them. No data is rewritten.

## Proof

- **pgtest: 12/12.**
  - chronology, including an import that keeps its date;
  - grouping of 11 events from 9 sources;
  - appointment states;
  - field visibility;
  - detail with two technicians;
  - search, dates and pages;
  - another salon / another customer / unknown id;
  - branch scope;
  - health check, read-only.
- **Two deliberate breaks are caught:**
  - removing the branch filter fails SC-02;
  - removing the money masking fails FN-01.
- **POS screen: 6/6.**
- **Checks:** typecheck, builds and `check:boot` (DI_GRAPH_OK) are green.
- **`ci:gates`:** only the five gates that were already failing still fail, with their counts unchanged.

## Open

- **Status times.** Booking stores only the current status and `updated_at`, so an appointment's status event uses its last-update time. The detail overlay says so. A real status history would need Booking to keep one.
- **Old endpoint.** The old AI-package endpoint `/pos/ai-customer-profile/customers/:id/timeline` stays for its other callers.
