# Payment Terminals + Gift Cards — one-screen rebuild (Oct 29 2026)

Built from `Payment_Terminals_Claude_Build_Guide.pdf` and `Gift_Cards_Claude_Build_Guide.pdf`. (`Invoices_Claude.pdf` in the same
message is byte-identical to the one already built in commit 7294a2ca — nothing new to do there.)
Branch `merge-github-main`, **not pushed** (K-12 steps 1–5 still open — SECURITY_REMAINING_ACTIONS.md §A).

## What was wrong (from the screenshots + code)

**Payment Terminals** (`/tenant/devices/payment-terminals`)
- KPIs were counted in the browser and "Needs Attention" left out never-tested / unpaired readers, so a "1 needs attention" had no row saying why.
- Terminals with **no location** could take payments but were never listed (the count and the list disagreed).
- No search, filters, paging or payment trace. Capture routing was a hidden settings key. Terminal capture never recorded *which* terminal took the card.

**Gift Cards** (`/tenant/customers/gift-cards`)
- The list printed **raw redeemable codes**. KPIs came from the first 200 rows in the browser, with the wrong definitions; the filter was client-side only.
- No issue / reload / void / ledger on the screen. Recipients were never written. Selling activation was not atomic (status flip and ledger row could split). Reload failures were swallowed.
- Cross-location redemption was blocked by a branch scope. The marketing tile read the wrong field. Customer profiles masked with the code instead of the printed number, and showed only cards the customer bought, not ones received.

## What was built

**Payment Terminals** — header (Refresh · + Add iPhone · + Pair Terminal) · 4 physical KPIs (Physical Terminals / Online / Needs Attention with reasons / Disabled), Tap to Pay counted on its own tab · tabs Physical Terminals · Tap to Pay iPhones · Payment Activity · Routing Settings, one search + per-tab filters, server paging, newest first.
- Pair wizard: reader → identify (6-digit code + serial) → register (flags a register that already has a reader) → verify (non-charge ping). The new reader lands at the top of Page 1 and stays "Not verified"/"Offline" until a test succeeds.
- Terminal details: status source, troubleshooting per reason, Test Connection, assign register, rename, disable (reason) / enable, unpair, recent payments, change history.
- Tap to Pay registry: Active / Pending / Suspended / Revoked; revoke needs a reason, warns when it is the last working capture method, success shown only after the server confirms; a revoked phone is never re-activated (must re-register).
- Payment Activity: payment → ticket → device → customer, "Not linked" when no device was recorded; calendar presets + Custom Range; date filters never move the live counts.
- Routing: Terminal-Driven vs Front Desk Manual, register → terminal map with problems, last change + actor; confirmed and audited through the settings route.

**Gift Cards** — header (Refresh · Branch liability · Export CSV · Check Balance · + Issue Gift Card) · 5 KPIs from the server over every card (Outstanding Liability and Active Cards as of now; Total Issued and Redeemed Value (net of refunds) for the period; Total Cards all time) · status tabs All / Active / Redeemed / Void · universal search (card ref / last 4, purchaser or recipient name, any phone format, email) · role, 7 sorts, more filters (type, balance range, original amount) · date-field period bar (Issued / Redemption / Created / Last activity / Expiration) with chips + Clear All · server-paged table, masked identifiers only.
- Detail overlay: balance, purchaser vs recipient, totals, a ledger-vs-balance reconciliation flag, paged ledger (Date / Type / Amount / Balance before / after / Reference / Status). The $100 → $65 → $35 example is seeded and verified.
- Issue: payment-first (a PENDING card on its own ticket, activated only when Checkout takes the payment), purchaser required, recipient kept apart, one idempotency key per dialog (a double tap makes one card), digital number shown once, then on to Checkout.
- Reload: its own ticket (a hold credited once when paid). Void: manager (`pos.checkout.void`), reason ≥ 3 chars, step-up, compensating ledger entry, history kept.
- Check Balance: the existing protected, rate-limited lookup; exact number/code only, masked answer.

## Files changed

Server: `modules/payments/src/finance-screens/{terminals,gift-cards}-screen.{repository,controller}.ts` (new read models), `payment-reconciliation.module.ts`, `payments/src/index.ts`; checkout writer `checkout.{kysely.repository,repository,service,controller,dto}.ts`, `checkout-settings.resolver.ts`, `checkout-display.dto.ts`, `request-schemas.ts`; `gift-cards.{kysely.repository,repository,service}.ts`; `customers.kysely.repository.ts`; `mobile-checkout.service.ts`; `queue/ticket-number.ts`, `queue/src/index.ts`; `settings.{dto,service}.ts`; `apps/api/src/customer-display/{terminal-capture.service,display-devices.repository}.ts`; migrations **713** (gift-card issue idempotency key, void stamps) and **714** (CONCURRENTLY indexes); `packages/api-contracts/src/errors.ts` (+5 codes) and the generated owner/tech catalogs.
POS: `screens/POSPaymentTerminalsScreen.tsx`, `screens/POSGiftCardsScreen.tsx` (rebuilt), their tests, `api/posTerminalsScreenApi.ts` (new), `api/posGiftCardsApi.ts`, `api/posCheckoutApi.ts`, `components/TapToPayDevicesPanel.tsx` (exports), `POSMarketingLandingScreen.tsx`, `i18n/ns/{payterm,giftcard}.{en,vi}.ts` (new), `ns/index.ts`, `ns/errors.{en,vi}.ts`, `styles.css`.
Tooling/docs: `tooling/devices-giftcards-one-screen/*` (harness, E2E, measurement, results), `apps/api/scripts/tenant-builder-check.mjs` (accepts the verified `giftScoped` helper), openapi manifest, attack surface, `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` **A38** (413 strings for Kevin's review).

## Tests

| Check | Result |
|---|---|
| `terminals-screen.pgtest` (real schema) | 9/9 |
| `gift-cards-screen.pgtest` (real schema) | 13/13 |
| E2E in Chromium against the real read models + gift-card writer (`interact.mjs`) | 23/23, no page errors |
| One-screen fit: 5 views × EN / VI / empty × 1920×945 · 1536×729 · 1440×765 · 1366×633 (`measure.mjs`) | 60/60 — no page scroll, every module painted, no touch target under 44 px, text ≥ 12 px (primary 13–14 px) |
| Gates (`run-gates.mjs`) | the same 12 environment failures as before; no new ones (tenant-builder, perms, as-any, pos-i18n fixed) |
| POS unit tests (`POSPaymentTerminalsScreen*.test.tsx`, `POSGiftCardsScreen*.test.tsx`) | **rewritten but not run** — this workspace has no vitest / React types and the npm registry is unreachable; please run `npm test -w apps/pos-web` |

## Not verified / blockers (said plainly)

- **No terminal provider was called.** Pairing makes no provider call (the code only forms the id); "Test connection" is the provider ping where wired, otherwise "not probed". Firmware is shown as "not reported".
- In the harness, terminal / phone / routing **mutations are simulated** (same row changes + audit rows) because their writers use the query builder this sandbox can't run; the read models and the gift-card writer are real. Checkout's own payment (activation, reload credit, redemption) is reproduced statement for statement in the harness and the spec.
- The gift-card **balance lookup** runs through the query builder, so the harness answers it with the same rule (exact number hash or code, this salon, masked) — rate limiting not exercised.
- **Routing is owner-only today**: the settings PATCH requires `settings.edit` (managers don't hold it). The guide says owner/manager — granting managers is a permissions change for Kevin to decide.
- Only customer-display terminal capture records which terminal took the card; front-desk card charges never drive a terminal (routing applies only to the customer-display Pay button). Older payments show "Not linked".
- Gift-card items still open: unsalted number hashes (changing them breaks existing cards); no DB-level ledger immutability trigger; a ticket refund does not reverse the gift card; replace can take over an active card; expiry is not enforced; `resolveGiftCardCode` swallows a lookup error as "not found".
- Checkout refusals that carry a registry code reach the client through the platform exception filter's coded-error sink (the harness mirrors it).
