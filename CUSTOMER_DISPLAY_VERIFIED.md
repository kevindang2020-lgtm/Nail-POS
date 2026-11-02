# Customer Display (iPad) — pairing + realtime, verified

> **Oct 22 2026:** the `verify-customer-display.mjs` script this page describes drove the pre-dual-screen pairing flow and
> was retired on Oct 20 (B-27). `npm run verify:display` now runs its replacement, `apps/api/scripts/live-display-lifecycle.mjs`
> (30/30 on a booted API: Send-to-Display and a tip reach the stream, release, forged token refused). The dual-screen flow
> itself is proven by `live-pilot-day.mjs`. The text below is kept as written.

The mounted customer-facing display is fully wired and verified end-to-end (`npm run verify:display` against a running
sandbox API). 12/12 checks pass.

## What was proven
- **Pairing** — front desk issues a 6-digit pairing code (`POST /pos/settings/customer-display-devices/pairing-code`)
  and pairs the iPad (`POST /pos/settings/customer-display-devices/pair`). A device row goes `pending → paired`.
- **Handoff** — a checkout ticket is handed to the paired display (`POST /pos/customer-display/sessions {ticketId,
  deviceId}`), which mints a one-time **public token** for that session.
- **Token-scoped state (no user session)** — the iPad loads the live checkout state with only `?token=` (or the
  `x-display-token` header): salon name, the customer's services, tip options, and totals. A **wrong token is refused
  (403)**.
- **Customer tip** — the customer selects a tip on the iPad (`POST /customer-display/checkout/:sessionId/tip`,
  body `{ tipType:'custom', amountCents }` or `{ tipType:'percent', percent }`). The display total updates immediately —
  correctly including the **card surcharge recomputed on the tip** — and the selection **persists** so the front desk and
  iPad agree. (The customer-selected display tip is intentionally separate from a front-desk tip.)
- **Realtime** — the display subscribes via **SSE** (`@Sse('checkout/:sessionId/stream')`) and the stream delivers a
  live `customer_display_tip_selected` event when the tip changes. A **4-second polling fallback** in the display app
  (`useDisplay.ts`) covers any SSE drop, so the screen stays fresh either way.

## Modes
The display app reads its credentials from the URL: **SESSION mode** (`?session=<id>&token=<token>` — one checkout handed
to the device) or **DEVICE mode** (`?device=<deviceToken>` — a permanently-mounted iPad that asks "what's my current
session?"). Tokens ride as headers for fetches and as a query param for the SSE EventSource.

## Re-run it
```bash
# start a sandbox API (any seeded tenant), then:
BASE=http://127.0.0.1:3000 SALON=LUXE IDENT=owner@luxenails.test PASSWORD='Owner123!' npm run verify:display
```
