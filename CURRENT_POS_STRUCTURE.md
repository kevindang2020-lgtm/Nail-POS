# CURRENT_POS_STRUCTURE — the "current" half of the restore diff

This is the reference-independent half of `OLD_V4_1_TO_CURRENT_DIFF.md` and `V4_1_VISUAL_COMPONENT_MAP.md`. The **OLD**
columns stay blank until `AIPowerSalon-POS-APP_4_1.html` is uploaded; then each row gets filled and reconciled.

Target of the restoration = the React/Vite app **`apps/pos-web`** (not the standalone HTML demos).

## Route → canonical screen → state API (all 15)
Each route already has exactly **one** canonical screen (no `V4`/`Old`/`Copy` duplicates) and loads real backend data — verified
that screens call their state endpoint rather than hardcoding.

| Route (`/pos/...`) | Canonical screen component | State API | Backend wired |
|---|---|---|---|
| overview | `POSOverviewScreen.tsx` | `posOverviewApi` | ✅ |
| dashboard | `POSDashboardScreen.tsx` | `posDashboardApi.getState` | ✅ (+realtime) |
| check-in | `POSCheckInScreen.tsx` | `posCheckInApi.state` | ✅ |
| booking | `POSBookingScreen.tsx` | `posBookingApi.state` | ✅ |
| tech-appointments | `POSTechAppointmentsScreen.tsx` | `posTechAppointmentsApi.state` | ✅ |
| tech-queue | `POSTechQueueScreen.tsx` | `posTechQueueApi.state` | ✅ |
| queue | `POSQueueScreen.tsx` | `posQueueApi.state` | ✅ (+realtime) |
| serving | `POSServingScreen.tsx` | `posServingApi.state` | ✅ |
| service-done | `POSServiceDoneScreen.tsx` | `posServiceDoneApi.state` | ✅ |
| checkout | `POSCheckoutScreen.tsx` | `posCheckoutApi.state` | ✅ (+realtime) |
| customers | `POSCustomersScreen.tsx` | `posCustomersApi` | ✅ |
| technicians | `POSTechniciansScreen.tsx` | `posTechniciansApi` | ✅ |
| services | `POSServicesScreen.tsx` | `posServicesApi` | ✅ |
| reports | `POSReportsScreen.tsx` | `posReportsApi` | ✅ |
| settings | `POSSettingsScreen.tsx` | `posSettingsApi.getState` | ✅ |
| (sub) technicians/schedule | `POSLiveTechnicianScheduleScreen.tsx` | `posLiveTechnicianScheduleApi` | ✅ |

Shell: `apps/pos-web/src/shell/POSLayout.tsx` (sidebar + header). Login: `LoginScreen.tsx`. Fallback: `ComingSoon.tsx`.

## Current sidebar (grouped) vs the task's requested flat order
Current `POSLayout.tsx` NAV groups:
- **(top):** Overview, Dashboard, Check-In
- **Booking group:** Booking, Tech Appts, Live Schedule, Tech Queue, Queue
- **Service group:** Serving, Service Done, Checkout
- **Manage group:** Customers, Technicians, Services
- **(bottom):** Reports, Settings

Differences to reconcile against `_4_1.html` once uploaded:
- Current is **grouped**; the task lists a **flat** order. Need the old file to confirm which the old build used.
- Extra item **Live Schedule** (`/technicians/schedule`) — not in the task's 15. Keep (newer functionality); decide placement.
- Label deltas: `Tech Appts` → likely `Tech Appointments`; confirm exact old labels.

## Modals / drawers / panels (currently inline within screens)
Screens containing modal/drawer/overlay logic: Booking, Customers, Queue, Service Done, Serving, Tech Appointments,
Tech Queue, Technicians. Only one extracted component today: `components/PaymentGatewayStatusCard.tsx`. These inline
modals are the working actions that **must be preserved** when the old visual layout is applied (§9).

## Backend / security / realtime to preserve (do NOT regress during restyle)
- 21 API clients; all screens load via state APIs.
- Tenant/branch/role/permission derived server-side; per-tenant payment gateway; SSE realtime push bus.
- Money is integer cents end-to-end.

## What fills in on upload
1. OLD screen structure per route (the blank column) → complete `OLD_V4_1_TO_CURRENT_DIFF.md`.
2. OLD sidebar order/labels/styling → confirm/adjust `POSLayout.tsx`.
3. OLD card/table/panel composition + cream/gold tokens, spacing, typography → restyle each canonical screen.
4. Per-action trigger mapping → `V4_1_ACTION_PRESERVATION_MAP.md`.
