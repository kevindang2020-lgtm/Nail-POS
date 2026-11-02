# Deals Marketplace — System Documentation

A cross-salon marketplace of salon and technician deals: managers and technicians create offers, customers discover
them nearby, save them, book them, and redeem them at checkout — with oversell-safe capacity and Super Admin oversight.
This consolidates the whole feature (Phases 1–8b + the Option-B transaction spine) and records the Phase 9 pass.

---

## 1. Design principle: reuse the primitives

The marketplace is a thin layer over systems that already existed, not a fork of any of them:
- **Discounts** reuse the salon-promotions redemption engine and the checkout apply-discount seam.
- **"Nearby"** reuses branch lat/long, the coordinate index, and the haversine helper already behind the public salon
  directory.
- **Booking** reuses the canonical advisory-locked BookingService.
- **Checkout** reuses the same decoupled redeemer-callback pattern as promotions (the money path never imports the deals
  module directly).

## 2. Data model (migrations 387–389)

- **387** — `deal_settings` (per-tenant technician-deal policy), `deals`, `deal_services`, `deal_approvals`,
  `deal_redemption_holds` (unique on deal + idempotency key), `deal_redemptions`, `deal_saves`, `deal_analytics_events`.
  Check constraints enforce owner type and non-negative prices.
- **388** — `appointment_id` + `deal_version` on `deal_redemption_holds` (links a hold to the appointment it backs).
- **389** — re-keys `deal_saves` to a global `user_id` (the Option-B identity decision — see §5).

## 3. Lifecycle & roles

A deal moves through a guarded status machine (draft → pending approval → published/active → paused/expired/canceled).
Transitions are atomic (`WHERE status IN (fromStates)`), so concurrent actions can't corrupt state.

- **Manager/Owner** (POS, `/pos/deals/*`, gated by existing `pos.marketing.*` permissions): create salon deals, work the
  technician-deal approval queue (approve / reject-with-reason), pause/resume/publish, set the technician-deal policy,
  and read per-deal analytics.
- **Technician** (tech app, `/tech/deals/*`): create and manage their own deals **only when the salon's policy allows
  it** — the screen shows an honest disabled state otherwise. Ownership is enforced server-side; the gate is the policy,
  not RBAC.
- **Customer** (guest-browsable, `/customer/deals/*`): nearby feed, public detail, save/unsave, book, redeem.
- **Super Admin** (`/super-admin/deals/*`, SuperAdminGuard): cross-tenant overview, list all deals, force-suspend.

## 4. Money integrity

Deal prices are always recomputed server-side from the deal definition — the client price is never trusted. Final price
is never negative; a fixed discount is capped at the subtotal; a percentage is rounded consistently. Non-stackable deals
are refused when another discount is already on the ticket. Redemption is atomic and idempotent: recording a redemption
increments the deal's count in the same advisory-locked transaction, and replaying the same appointment+deal is a no-op.

## 5. Oversell-safe capacity (holds)

Booking a capacity-limited deal takes a **hold** inside one advisory-locked transaction: stale holds are expired,
capacity is re-checked under the lock (redeemed + active holds vs cap; null cap = unlimited), and either a hold row is
inserted or the deal reports sold-out — so two shoppers can't overbook the last slot. Holds are idempotent on
(deal, idempotency key), carry a 10-minute TTL, are consumed when the appointment is created, and released on failure or
cancellation.

## 6. Cross-tenant identity — Option B (the decision that unblocked end-to-end)

A shopper interacting with deals across many salons can't be a single tenant-scoped customer record. The chosen model:
- **Saves are user-scoped** — keyed by the global `user_id`; saving a deal never creates a salon customer record.
- **Reserve / book / redeem ride the booking flow's existing customer resolution** — the customer's record in the
  *deal's* tenant is the one created at booking time, exactly where the reservation is consumed.

The full spine is wired end to end:
- **Save** (Increment B1) — user-scoped, idempotent, guest-blocked.
- **Book** (Increment B2) — the reservation is taken inside `customer-booking.book`, *after* phone verification and
  *before* the appointment insert; sold-out refuses without creating an appointment; the hold is consumed with the new
  appointment id, or released on failure. A booking with no deal behaves exactly as before.
- **Redeem** (Increment B3) — wired into checkout via the same callback seam as promotions, but **non-fatal**: a deal
  that can't apply leaves checkout untouched. The ticket→appointment link resolves through the queue item, so the POS
  only needs the ticket id.

## 7. Analytics, notifications, images, oversight

Best-effort analytics events (view, save, booking-start, booking, redemption) never break the underlying action.
Per-deal stats surface in POS; cross-tenant totals surface to Super Admin. Technicians are notified when their deal is
approved or rejected (with the reason). Deal images ride an image URL end to end (client-provided, matching the app's
existing pattern). Super Admin can force-suspend any live deal.

## 8. Phase 9 verification (this pass)

Integrity gates (api): typecheck, di, cross-wiring, permissions, unguarded-routes, SQL, nav, dead-client — **all pass**.

Tests: deals **85** · checkout **106** (103 pre-existing still green + 3) · customer-booking **231** (227 pre-existing
still green + 4) · customer-web **249** (incl. the deals screen) · pos-web typecheck + build + nav-wiring **7/7** +
checkout **11/11**. Migrations 387–389 load cleanly.

## 9. Honestly noted

- Deal images are client-provided URLs (no dedicated upload endpoint — matches the existing app pattern).
- The manager-on-submit notification is the POS approval queue itself (no separate manager in-app notification store was
  found to hook).
