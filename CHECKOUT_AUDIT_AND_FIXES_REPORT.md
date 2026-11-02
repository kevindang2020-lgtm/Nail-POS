# CHECKOUT_AUDIT_AND_FIXES_REPORT.md — POS Checkout (2026-07-03)

_Audited the Checkout screen (the terminal money-path step) against the flow the reference images trace. Found and
fixed two disconnected header filters and one real render crash, then locked the money-path wiring with tests.
Verification numbers are fresh runs on this tree._

## 1. Modules and boxes found / audited
Header (Checkout title, **All Payment Types** filter, date pill, **status** filter, Live, Auto Refresh) · 12-KPI
strip (Ready for Payment, Today's Revenue, Tips Captured, Card Surcharge, Tax Collected, Paid Tickets, Failed
Payments, Customer Display Sessions, Receipt Delivery Rate, Avg Checkout Time, Gift/Loyalty Redemptions, Upsell) ·
Transactions Needing Attention · Available Front Desk / Ready Technicians · Revenue Trend · Payment Mix · Potential
Revenue in Queue · AI Checkout Insights · Checkout Queue (ticket list) · **Checkout Workspace** (guest, line items,
server-truth totals, payment-method tabs, Quick Tip, Split Payment, discount, receipt channels, Complete Checkout) ·
Quick Actions.

## 2. Problems discovered
- **Dead "All Payment Types" filter.** Rendered as a functional-looking `<select>` but with a frozen value
  (`value={method === 'card' ? '' : ''}`) and a no-op handler (`onChange={() => undefined}`). Clicking changed
  nothing — a UI-only control, exactly the checklist's "fix broken dropdowns."
- **Disconnected status filter.** Had state (`statusFilter`) and updated on change, but nothing consumed it —
  `loadState` only passed `search`, and the client-side list filter only matched search text. Selecting a status did
  nothing.
- **Real Checkout Workspace crash (latent).** `MembershipCoveragePanel` read `cov.coveredLines.length` /
  `cov.memberDiscounts.length` and several `*.Cents` numeric fields **without guards**. A coverage API response that
  omits any of those fields (a partial/empty payload) throws `Cannot read properties of undefined (reading
  'length')`, which unmounts the **entire** Checkout Workspace — the receptionist would lose the payment UI mid-
  checkout. Reproduced deterministically in a render test.
- **Pre-existing dead declarations** (7 lint warnings, none introduced here): an unused `Donut` component and unused
  `setSearch`/`setGiftCode`/`setNoTip`/`sendToDisplay`/`clearDisplay` handlers — capabilities defined but not wired to
  any control. Left in place and documented (see §9) rather than guessing UI placement without a reference.

## 3. Frontend files fixed
- `apps/pos-web/src/screens/POSCheckoutScreen.tsx` — wired the payment-type filter to real `payTypeFilter` state;
  threaded `status` + `paymentMethod` through `loadState` and the load effect's deps so both filters drive a real
  server refetch; preserved both filters on incidental reloads (`refreshAll`, customer-display send/clear).
- `apps/pos-web/src/screens/MembershipCoveragePanel.tsx` — guarded every coverage field access (`coveredLines`,
  `memberDiscounts`, `coveredTotalCents`, `upgradeChargeCents`, `dollarCreditAvailableCents`) against a partial
  payload and marked those fields optional in the `Coverage` type to reflect the real contract. Fixes the crash.
- `apps/pos-web/src/screens/POSCheckoutScreen.test.tsx` — +4 tests.

## 4. Backend files fixed
**None needed.** The checkout controller already accepts `status` and `paymentMethod`
(`filtersFrom` → `svc.getState(ctx, filters)`), and both repositories apply them
(in-memory `query()` filters on `f.status` / `f.paymentMethod`; the Kysely repo does the same). The frontend simply
wasn't sending them. Guards, permission (`pos.checkout.view`), and session-derived tenant/branch scope unchanged.

## 5. Routes and APIs repaired
No routes added or changed. `GET /pos/checkout/state` now receives the `status` and `paymentMethod` query params it
already supported. Payment-processor isolation preserved: card/gift/split still surface `{ configured:false,
disabledReason }` honestly when Fiserv isn't live — no fake capture, no Stripe/Square anywhere.

## 6. Database changes
None. The two filters narrow existing tenant + branch-scoped queries; money stays integer cents.

## 7. How each module is wired
Both header filters → `loadState({ search, status, paymentMethod })` → `GET /pos/checkout/state?…` → guarded
controller → `CheckoutService.getState` → `repo.query(ctx, filters)` (tenant+branch scoped, applies status +
method) → the queue re-renders from the filtered `tickets.items`. The Checkout Workspace loads a selected ticket via
`GET /pos/checkout/tickets/:id`; tip/discount/recalculate/pay-cash/pay-card/pay-gift/pay-split/receipt each POST to
their real `…/tickets/:id/…` route through `run()` with busy + error handling; split enforces segments summing to
the amount due before submit; cash reports change due; card/split honor `configured:false`. `MembershipCoveragePanel`
reads `…/coverage` and now degrades safely on any partial payload.

## 8. Test, typecheck, lint, and build results (fresh, this tree)
- **Typecheck:** pos-web `tsc` **0 errors**.
- **Tests:** Checkout screen **6/6** (2 prior + 4 new: payment-type filter refetches `paymentMethod=`, status filter
  refetches `status=`, tip-percent hits `apply-tip`, card payment surfaces `configured:false`); MembershipCoveragePanel
  **2/2** (existing, still green with the guards). Full pos-web suite **251/251 (63 files)**; the lone exit-1 is the
  pre-existing jsdom `scrollIntoView` notice in POSBookingScreen.test.tsx — unrelated. Backend checkout suite
  **110/110 (23 files)** confirms the filter params are handled server-side.
- **Lint:** POSCheckoutScreen.tsx + MembershipCoveragePanel.tsx → **0 errors**, 7 pre-existing warnings (see §9).
- **Build:** pos-web production build **clean**.

## 9. Honest remaining issues
- **7 pre-existing dead declarations** in POSCheckoutScreen.tsx: `Donut` (unused chart component) and the
  `setNoTip` / `sendToDisplay` / `clearDisplay` / `setSearch` / `setGiftCode` handlers/setters have no UI trigger.
  These represent capabilities (a No-Tip button, send/clear customer-display controls, a search box, a gift-card
  input) that exist in code but aren't surfaced. Wiring them is a genuine follow-up, but their placement should match
  a reference so I didn't guess; the underlying endpoints already exist. Note `giftCode`/`gift_card` payment still
  works when the method tab is set — only the standalone setter is unused.
- The `MembershipCoveragePanel` coverage endpoint wasn't exercised against live Postgres this session (no DB); the
  guard makes the panel robust to any shape, and the in-memory path covers dev/test.
- Donuts/sparklines render from real arrays; pixel geometry isn't unit-asserted (DOM presence + data binding are).
