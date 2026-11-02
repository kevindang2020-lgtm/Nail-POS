# Sidebar wiring — Devices → Payment Terminals (2026-07-06)

| Route | Screen | Endpoint | Gate |
|---|---|---|---|
| /tenant/devices/payment-terminals | POSPaymentTerminalsScreen | GET /pos/devices/overview | pos.devices.view |

The Devices overview screen already linked to this sub-item; now it's a real screen. Shows paired
Fiserv/Clover terminals (label, station, status) + KPIs (terminal count, connection state, locations),
reusing the existing posDevicesApi.overview(). Honest empty state when no terminals are paired.

## Verification
- tsc 0 · build clean · lint clean.
- 3 new tests (render, empty state, 403 — 403 split into its own file). Full pos-web **360/360**.
- Live E2E through real guards: /pos/devices/overview anon **401** / authed **200**; KPIs include
  paymentTerminals/terminalsAllConnected; terminals array present.

## Sidebar tally
55 → **81** items now resolve to real screens.

## Honest status of remaining sections
Clean quick-wins (existing state endpoints) are largely exhausted. Remaining placeholders mostly need
NEW backends or are sub-views:
- Marketing, Loyalty, Gift Cards: NO controllers yet — need full feature slices (data model + API + UI).
- Communications sub-items (templates, reminders, phone): only an inbox /state today; the specific
  sub-features need their own endpoints.
- Devices sub-types (tablets, kiosk, reception-pos, assignments, health): would filter the same fleet;
  marginal value as separate screens vs the overview.
- Most AI Center items: dedicated AI backends.
Recommend prioritizing by business value (e.g. build the Loyalty or Gift Cards backend as a real slice)
rather than wiring remaining placeholders for their own sake.
