# CUSTOMER_APP_CONNECTION_REPORT.md

`apps/customer-web/` (workspace `aipowersalon-customer-web`) connects to the real backend (`apps/api/`).

## Wired flows + endpoints
- Auth/profile: `apps/api/src/customer/` + `apps/api/src/customer-registration/` (`/customer/me`, signup/login, privacy).
- Nearby + salon detail: `apps/api/src/customer-salons/` (`/customer/salons/nearby`, `:salonId`, `:salonId/services`).
- Booking + availability: `apps/api/src/customer-booking/` (`/customer/.../availability`, appointments, reschedule).
- Check-in + active visit/service progress: `apps/api/src/check-in/` + `apps/api/src/serving/` + realtime.
- Receipts + payment methods + wallet: `apps/api/src/wallet/`, `apps/api/src/customer-payments/`.
- Favorites: `apps/api/src/customer-salons/customer-favorites.controller.ts`.
- Notifications/social: `apps/api/src/customer/` + `apps/api/src/nail-showcase/`.

## Status
Builds clean. Nearby search verified live (partners + honest Google message). Booking push verified earlier this
session. Realtime events for the customer visit are emitted from the shared serving/check-in paths (see
POS_APP_INTEGRATION_REPORT.md). Thin spot: a polished map/list "Find Salons" screen (REMAINING_BLOCKERS.md).
