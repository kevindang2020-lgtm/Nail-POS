# SUPER_ADMIN_APP_CONTROL_REPORT.md

§26–§27: Super Admin / tenant control over app visibility + features.

## Present
- Partner/bookable flags drive the Customer App search: `apps/api/src/customer-salons/salon-directory-core.ts`
  (`is_aipowersalon_partner`, `is_bookable_in_app`) — a non-partner/non-bookable tenant is not bookable in-app.
- Google nearby search is gated by `ENABLE_GOOGLE_NEARBY_SALON_SEARCH` (+ radius caps) — Super-Admin/ops level.
- Tech-app capabilities are surfaced read-only to the app via `tech.service.ts` `settings()` (salon + Super-Admin
  controlled), and tech edits are gated by `tech.ticket.*` permissions + the salon-level serving gate.
- Super-Admin platform module: `apps/api/src/super-admin-platform/`.

## Partial / to verify
The full §26–§27 toggle set (public listing enabled, customer-app booking enabled, show-on-map, allow service-progress
visibility, require-approval-for-tech-changes, per-tenant app enable) is **partially** represented via the flags above
and the settings surfaces; a dedicated Super-Admin "App Control" settings screen that exposes every toggle in one place
is not confirmed and is noted in REMAINING_BLOCKERS.md. The Go Check-In Super-Admin device manager built earlier this
session is a working precedent for that screen.
