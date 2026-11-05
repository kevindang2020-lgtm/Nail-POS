# Checkout Money-Path QA

Re-audit of the checkout money math (subtotal → tax → tip → card surcharge → split tenders). Scope: correctness of
every cent that moves, server-side authority (no client-trusted totals), and the prior three flagged findings.

## How the money is computed (the single source of truth)

All amounts are integer cents. The pure helpers in `checkout-display.dto.ts` are the backend truth and are shared by
both the POS checkout repo and the customer-display kiosk, so the two never diverge:

- **Subtotal** = sum of service line prices (`subtotalFromLines`).
- **Tax** = `round(subtotal × taxRate%)` — `computeTotals`.
- **Tip** = `round(subtotal × tip%)` on the **pre-tax** subtotal (`tipForPercent`); custom tips validated non-negative,
  integer, and within `maxTipPercent` (`validateCustomTip`).
- **Card surcharge** (card method only) = `round((subtotal + tip + tax) × surcharge%)`; cash/gift = 0.
- **Total** = `subtotal + tip + tax + surcharge`.

Tenant settings drive all of it. `resolveCheckoutSettings()` reads the `tenant_settings` JSONB (`tips`, `tax`,
`payments-checkout`), with **branch-level overriding tenant-level**, and every missing key falling back to
`DEFAULT_CHECKOUT_SETTINGS`. The `7.75%` / `3.0%` constants are **fallback defaults only**, not hardcoded rates.

## Server-side authority (anti-tamper)

Every payment method recomputes the total server-side via `repo.totalsFor(ctx, ticketId, method)` and charges
`due = totalDue − alreadyPaid`. The client's totals are never trusted. `payCard` locks the total
(`lockTotal`) and uses an idempotency key. `paySplit` requires the segments to **sum exactly to the base due** or it
rejects, so a split can neither under- nor over-collect.

## Prior findings — status

1. **Split surcharge avoidance — RESOLVED ("Option A").** A split surcharges the **card portion** only:
   `cardBase = Σ(card segments)`, `cardSurcharge = round(cardBase × surcharge%)`, captured on the card segment on top of
   its base. Cash/gift dollars are never surcharged, and a fully cash/gift split owes nothing extra — so splitting a
   sale no longer dodges the surcharge the card dollars would otherwise carry. Disclosed pre-payment and returned in the
   split response. (`checkout-split-surcharge.vitest.spec.ts`, `checkout-split-card-compensation.vitest.spec.ts`.)
2. **Hardcoded tax/surcharge ignoring tenant settings — RESOLVED.** `resolveCheckoutSettings()` reads tenant/branch
   settings; `computeTotals`/`paySplit` consume the resolved values. Defaults apply only when unset.
3. **Loose settings schema — RESOLVED.** The resolver coerces every field through `num`/`bool`/`str` guards
   (non-finite/negative numbers, wrong types, and empty strings all fall back safely), and `taxRatePercent` is forced to
   `0` when tax is disabled.

## New findings — FIXED this pass

**1. Multi-card split under-charge.** `SplitPaymentRequest.segments` allowed more than one `card` segment, but the
processor capture in `paySplit` only charged the **first** card segment (`find(method==='card')`), while
`recordSplitAtomic` recorded **all** segments as paid. A two-card split would therefore mark the ticket paid while the
second card's dollars were never captured — real money never collected. Fix: `paySplit` now rejects any split with more
than one card segment **before** charging anything; covered by a test asserting the rejection and that the processor is
never called.

**2. `void` was missing all money-integrity guards.** The `refund` path enforces "approved/partial only, positive
whole cents, cumulative ≤ captured," and its comment says these "apply to **every method**" — but `void` enforced
none. It checked only permission + reason, so you could void a `declined`, `not_configured`, already-`voided`, or
already-`refunded` payment. In the pilot's non-connected mode there is no processor to reject it, so it would simply
record a bogus void row. Fix: `void` now rejects any payment whose status isn't `approved`/`partial`, and any payment
that has already been refunded (`refundedTotalCents > 0`) — mirroring the refund guards. Covered by a new
`checkout-void-guard` suite plus a harness assertion that voiding a refunded payment is rejected.

## Verification

- **`checkout-core.spec.ts`** (Nest-free harness, run by `scripts/run-core-specs.sh`): **77/77** — tax on subtotal,
  surcharge card-only, cash has no surcharge, tip math, custom-tip max, locked totals, gift application, refund +
  void honesty, and "cannot void an already-refunded payment".
- **Checkout vitest suite**: **31/31** across `checkout-split-surcharge`, `checkout-split-card-compensation`,
  `checkout-payment-guard`, `checkout-giftcard-guard`, `checkout-refund-guard`, and the new `checkout-void-guard`.
- **Live (this session)**: the customer display rendered a real Postgres ticket as Subtotal $50.00, Tax $3.88, Card
  Surcharge $1.62 (= round(53.88 × 3%)), Total $55.50, confirming the math end-to-end on the kiosk path.

## Refund path — audited, sound

The refund path was audited and is correct: refunds operate on the captured (tax + surcharge-inclusive) total, are
tracked in a separate ledger so cumulative partial refunds accumulate and can never exceed the capture (also blocking
double-refunds), cash/gift refunds settle without a gateway, and card refunds require the gateway + the original
transaction reference (honest `not_configured` otherwise). No changes were needed.
