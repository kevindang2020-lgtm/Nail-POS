# Deals Marketplace — audit, data-model decision & phase plan

Both specs require an audit and a reuse/gap/plan **before** building, precisely so we extend the canonical domains
rather than duplicate them. This is that deliverable, plus **Phase 1 (the data model) is built and verified**.

## 1. What already exists — REUSE, do not duplicate

| Capability | Where it lives | Reuse for the marketplace |
|---|---|---|
| Salon discount engine | `salon_promotions` (discount_type percent/fixed, status, dates, max_redemptions, created_by) + `salon-promotions` service (`create`, `redeem`) | The published deal's **discount application + redemption** at checkout reuses this primitive |
| Redemption ledger | `promotion_redemptions`, `tenant_promotion_redemptions` | Redemption recording pattern |
| Checkout apply | `POST checkout/:id/promotions/:promotionId/apply`, `tickets/:id/apply-promotion`, `apply-discount` | Deal discount lands through the **canonical checkout**, never recomputed on the client |
| **Nearby geo** | `branches.latitude/longitude` (mig 063), `idx_branches_coords` (mig 106), haversine in the service tier, public salon directory | **"Nearby deals" reuses branch coords + haversine** — no PostGIS, no new geo system |
| Simple customer deals list | `customer_deals` + customer `DealsScreen` + `GET /deals` | The Deals screen is extended, not replaced |
| Booking | canonical `BookingService` (advisory-locked, oversell-safe) | "Book This Deal" creates the appointment through this, with a deal reference |
| Services / technicians / customers | canonical catalogs + FKs | Deal services, technician ownership, eligibility reference these |
| File storage | existing object-storage substrate (signed URLs) | Deal images reuse it — no second storage system, no base64-in-DB |
| Notifications / Audit | existing notification + audit services | Deal lifecycle events reuse them |

## 2. What's missing — the genuinely new work

1. **Deal ownership** — `salon_promotions` has no `owner_type` or `technician_id`; there are no technician-owned deals.
2. **Manager approval workflow** — no `pending_approval`/`rejected`/`scheduled`/`sold_out` states, no approval audit record.
3. **Tenant technician-deal policy** — no "Allow technicians to create deals" setting or its granular limits.
4. **Marketplace fields** — eligibility (new/member), per-customer limits, deposit, stackability, images, saves, analytics.
5. **Deal → booking reservation** — booking doesn't attach a deal or hold a redemption; no oversell-safe hold.
6. **Nearby *deals* feed** — the geo primitives exist for salons but aren't wired to a deal feed with distance/sort/filter.
7. **Technician "My Deals" module** and **Manager "Deals & Offers" admin** surfaces.

## 3. Data-model decision

**Add a thin marketplace layer that reuses the existing discount + geo + booking primitives; do not fork
`salon_promotions`.** The new `deals` table carries ownership/approval/eligibility/schedule; discount *application* at
checkout flows through the existing promotion/redemption path; distance uses existing `branches` coordinates. Additive
migration only — nothing existing is altered or dropped.

**Phase 1 tables (migration `387_deals_marketplace.sql`, built + verified this pass):**
`deal_settings` (tenant tech-deal policy, default OFF), `deals` (salon/technician, 11-state status, integer-cent prices
with non-negative checks), `deal_services`, `deal_approvals` (immutable decisions), `deal_redemption_holds`
(unique per deal+idempotency key — oversell-safe), `deal_redemptions` (attribution), `deal_saves`,
`deal_analytics_events`. Indexes for tenant/branch/technician/status/window + a partial index for the active feed.

*Verified:* loads cleanly alongside all 386 existing migrations in the PGlite harness; all 8 tables created; CHECK
constraints enforced (e.g. a bogus `owner_type` is rejected; prices constrained `>= 0`).

## 4. Security & privacy posture (enforced in later phases, designed now)

- Customer/tenant/branch/technician derived **server-side** from the session — never trusted from the client.
- Backend enforces `deal_settings` limits (discount caps, min price, per-tech active cap, approval) — not the app.
- Technician deals are **locked to the technician** unless `allow_tech_substitution`; booking revalidates.
- Nearby uses **branch** coordinates only; customer precise location is never stored or exposed to salons.
- Money integer cents; discount can never produce a negative price (DB check + service clamp); payments stay on
  Fiserv/CardPointe/Bolt/Clover and never mix with subscription billing.

## 5. Phase plan (building phase by phase)

- **Phase 1 — Data model** ✅ *done + verified this pass* (migration 387).
- **Phase 2 — Backend deal domain**: `deals` module — DealService (create/submit/approve/reject/pause/publish, status
  machine, integer-cent pricing clamp), EligibilityService, DealSettingsService, repository + Kysely driver, DTO
  validation, permissions (`deals.*`), audit events. Unit + pgtest coverage.
- **Phase 3 — Manager/Owner admin**: `GET/POST/PATCH /management/deals`, approve/reject/pause, settings; wire into
  Owner/POS "Marketing & Growth → Deals & Offers".
- **Phase 4 — Technician "My Deals"**: `/tech/deals*` gated by `deal_settings`; tech-web module; honest disabled state.
- **Phase 5 — Customer discovery + detail**: `GET /customer/deals/nearby` (branch haversine, radius/sort/filter),
  `/:id`, save; extend `DealsScreen`; salon-vs-technician cards; ZIP/city fallback; location-denied state.
- **Phase 6 — Book-a-deal + reservation**: hold → BookingService → attach deal + version; oversell-safe concurrency.
- **Phase 7 — Checkout redemption**: apply locked deal terms through the canonical checkout; record redemption; stacking
  rules; cancel/no-show handling.
- **Phase 8 — Analytics, notifications, Super Admin oversight, technician-departure handling, images.**
- **Phase 9 — Full test matrix + docs** per the specs.

Each phase lands wired end-to-end and verified green (tsc / DI / tests) before the next.
