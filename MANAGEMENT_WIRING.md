# Sidebar wiring — Management section (2026-07-06)

The Management items are all settings groups already covered by the real, editable POSSettingsScreen.
Rather than build 11 read-only duplicates (which would violate reuse-don't-duplicate), each Management
item now deep-links into the existing editor at its section.

## How
- Added id anchors to POSSettingsScreen's section panels (sec-business-branch, sec-booking-appointments,
  sec-payments-checkout, sec-tax, sec-loyalty-memberships, sec-queue-workflow, sec-auto-logout, sec-notifications)
  and a scroll effect that reads ?section= and scrolls to it.
- Each Management route redirects into the editor at the right section:

| Sidebar item | → editor section |
|---|---|
| /tenant/management/salon-profile | business-branch |
| /tenant/management/business-hours | auto-logout (store hours) |
| /tenant/management/auto-logout | auto-logout |
| /tenant/management/booking-rules | booking-appointments |
| /tenant/management/no-show-policy | booking-appointments |
| /tenant/management/cancellation-policy | booking-appointments |
| /tenant/management/checkout-rules | payments-checkout |
| /tenant/management/tax-tip-rules | tax |
| /tenant/management/loyalty-rules | loyalty-memberships |
| /tenant/management/membership-rules | loyalty-memberships |
| /tenant/management/queue-rules | queue-workflow |

All 11 registered in EXISTING_ROUTES (no FeaturePage fallback, no double-registration).

## Verification
- tsc 0 · build clean · lint clean.
- New deep-link test (anchors exist for ?section= to target). Existing settings test wrapped in
  MemoryRouter for the new useSearchParams dependency. Full pos-web **357/357**, incl. the wiring
  invariant that guards double-registration.
- These route into POSSettingsScreen, a pre-existing screen wired to the real /pos/settings/* endpoints.

## Sidebar tally
55 → **80** items now resolve to real screens (69 dedicated + 11 Management → the real settings editor).
