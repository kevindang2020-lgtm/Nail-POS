# AIPowerSalon — Overview Fixes Summary (2026-07-06)

All changes are real, wired features in the monorepo (plus the standalone HTML story).
Verified: api 3013/3013 · pos-web 332/332 · tsc 0 · builds clean · lint clean.

## Real app — apps/pos-web/src/screens/POSOverviewScreen.tsx
- Full-screen "View All" overlay for all five modules — Arrivals & Check-In Queue,
  Live Tech Queue, Today's Appointments, Communications (tab-aware), Insights (list).
  Reuses already-loaded /pos/overview board + state data; closes on ×, Esc, backdrop.
  Each overlay keeps an "Open [dedicated screen] →" link.
- View-All header links + row actions confirmed wired to real screens.

## Real app — Quick Actions (deep-linked to real flows, reusing existing code)
- New Check-In / Walk-In → /check-in (POSCheckInScreen).
- New Booking → /booking.  Assign Tech → /queue?assign=1 (opens the AssignTechSheet
  directly, wired to posQueueApi.assignTechnician).
- Start Service → /queue?status=ready_for_tech (queue filtered to ready-to-start guests,
  each with a live Start button → posQueueApi.startService).
- Take Payment → /checkout (auto-selects a ready ticket; takePayment → payCash/payCard/
  payGiftCard/paySplit; Fiserv-only, honest {configured:false} when not live).
- Add Product → /tenant/inventory?add=1 (opens the Add Product modal directly →
  inventoryApi.createProduct).
- Send Message → /messages.

## Real app — ProfileMenu.tsx
- Wired My Profile → POSAccountScreen, Security & 2FA → POSSecurityScreen,
  Account Settings → POSSettingsScreen; existing avatar + Sign Out (POST /auth/logout).

## Real app — search tenant isolation (apps/api/src/pos/pos-search.kysely.repository.ts)
- Qualified tenant_id per table (removes join ambiguity); proven no cross-tenant leak
  on real Postgres (scripts/search-iso-test.mjs → SEARCH_ISOLATION_OK).

## Real app — appointment-table bug (phantom `appointments` table)
- Fixed 7 queries that targeted a non-existent `appointments` table → pos_tech_appointments
  (search, ai-center KPIs, service-done rebooking, tech-profile), adapting to real columns
  (appt_date/start_time text, appointment_reschedules). Verified on real PG.

## HTML story — apps/pos-web/story/overview.html (also at /mnt/user-data/outputs/AIPowerSalon-Overview.html)
- Logo-matched champagne-gold + cream sidebar; transparent logo.
- Top bar: right-aligned, wired dropdowns (salon/notifications/messages/profile),
  longer search box with ⏎ submit + Enter.
- Removed Print Receipt from Quick Actions (8 actions); all Quick Actions wired
  (open full-screen views where relevant, else route toast).
- Five module "View All" full-screens + a per-row DETAIL card (click a row/View button
  → full details). Fits 1440×900 / 1920×1080, height:100vh, zero overflow.

## New guard / test artifacts
- scripts/search-iso-test.mjs, scripts/appt-fix-verify.mjs
- Tests added: Overview overlay, Queue assign/start deep-links, Inventory add deep-link.
