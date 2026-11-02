# customer-display — audit + test harness (the sixth app)

The customer-facing kiosk was the one app untouched by the sweep. Audited it end-to-end against its live backend
(`@Controller('customer-display')`, token-scoped public endpoints, tip-selected SSE push) and locked it with a new test harness.

## Audit findings — clean (no bug)
- **types.ts is a faithful mirror of the backend DTO** (`checkout-display.dto.ts`), verified field-for-field:
  `CustomerDisplayState`, `TipOption`, `CheckoutTotals`, and `ticket.services` all match, and **both enums match exactly** —
  `DisplayState` (8 values) and `PaymentMethod` (`card`/`cash`/`gift_card`/`split`). `Money` is `number`. No drift (the failure
  mode that bit the owner hardware-payment types is absent here).
- **Every endpoint the client calls exists for both auth modes.** Session mode hits `checkout/:id` + `/tip` `/method` `/pay`
  `/stream`; device mode hits `device/current` + `device/tip` `/method` `/pay` `/stream`. All ten routes are present — no 404
  risk.
- **SSE handling is correct.** The backend uses NestJS `@Sse` emitting `{ data: { event } }` with no `type` field, which
  serializes as the default `message` event — so the kiosk's `es.onmessage = () => load()` fires on every push (tip/state
  change), with the 4s poll as a backstop. The transient-error path keeps the last good screen rather than flashing an error.
- **App.tsx covers all eight `DisplayState` values** and maps the customer's taps correctly: percent →
  `{ tipType:'percent', percent }`, custom → `{ tipType:'custom', amountCents }`, none → `{ tipType:'none' }`; the pay/method UI
  shows only when `payButtonEnabled`.

Verifying-clean is the honest outcome here — the app was already well-built and correctly wired.

## Test harness added (was zero tests)
New `vitest.config.ts` + `src/test/setup.ts` (mirroring tech-web), a `test` script for parity, and **26 tests** across three files:
- `api.test.ts` (9) — `readCreds` auth-mode selection: device token wins, session needs both id+token, camelCase aliases, hash
  fallback, null cases; `streamUrl` query-param encoding for both modes.
- `types.test.ts` (2) — `usd` cents→dollars formatting incl. thousands separators.
- `App.test.tsx` (15) — phase gating (no-creds / forbidden / connecting), the full state machine (each `DisplayState` → the
  right screen), Review rendering (order, service lines, totals, conditional tip/surcharge rows), and the tip/method/pay wiring
  (percent + No-Tip mapping, method selection, pay button shown only when enabled).

## Verification
customer-display `tsc` clean, **26 tests pass** (3 files), `vite build` clean.
(admin-web 151, pos-web 75, owner-web 85, tech-web 74, customer-web 136, backend 603 / PASS — all unchanged.)

**All six frontend apps are now audited and test-locked.**
