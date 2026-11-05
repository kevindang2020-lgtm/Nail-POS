# Void path money-integrity fix (found while hardening Clover)

While verifying that both remaining processors (Fiserv and Clover) are production-correct, the **void** path turned up a
real money bug. Clover's Ecommerce API has no native void, so its `voidTransaction` maps to a full **refund** — which made
a latent flaw in the checkout void path actually move money.

## The bug
On void, the service inserted a *new* zero-amount `'voided'` row but **never updated the original payment**, which stayed
`'approved'`. Two consequences, same root cause:

1. **Revenue overstatement.** The reports query counts rows with `status in (approved, partial, paid, captured, refunded)`
   as revenue. After a void, the original `approved` row still matched — so a **voided sale kept counting toward gross
   revenue**, and the zero-amount void row offset nothing. (It also kept counting in the ticket's paid-total, so a voided
   ticket still looked fully paid.)
2. **Double reversal.** The refund/void guards read the *original* payment's status (`approved`) and `refundedTotalCents`
   (still 0 after a void). So the same payment could be **voided again, or refunded after being voided** — the void-guard
   spec only covered re-voiding a row that was *itself* a void, not re-reversing the original. For Fiserv this was caught
   downstream (the processor declines a second reversal), but for **Clover (void = refund) a second reversal actually
   returns money again**.

## The fix
Added a tenant-scoped `markPaymentVoided(ctx, paymentId)` to the checkout repository port (+ in-memory and Kysely
implementations) and call it in both void branches (live processor and sandbox) to mark the **original** payment
`'voided'`. This single change fixes both symptoms:
- `'voided'` is not in the revenue status set → the sale **drops out of reported revenue**, and `paidTotalCents`
  (approved/partial only) no longer counts it → the ticket's paid-total correctly reverses.
- The existing status guards (`only an approved/partial payment can be voided/refunded`) now **block any second
  void or refund** of that payment at the POS, instead of relying on the processor to decline.

The zero-amount void row is still recorded (audit trail with the processor's void/refund reference); it has no effect on
money math.

## Tests (`checkout-void-guard.vitest.spec.ts`, +3 → 9 total)
- Voiding the **same payment twice** is rejected (proves the original is marked, not just a new row added).
- **Refunding after a void** is rejected (no double money-return — the Clover case).
- A voided payment **no longer counts toward the ticket paid-total** (5000 → 0 after void).

## Verification
- Backend: **622 tests + harness, RESULT: PASS** (was 619; +3). `apps/api` `tsc` clean.

## Note on refunds (verified, not a bug)
Full refunds already guard correctly via `refundedTotalCents` (cumulative refunds capped at the captured amount, and
void-after-refund blocked). Reported "total revenue" is gross with refunds shown as a separate line — a deliberate
accounting choice, unlike voids, which represent a cancelled sale and so are now correctly excluded from gross.

---

## Addendum — ticket returns to a payable state on void

Completing the void fix surfaced a follow-on the reversal exposed. The checkout queue lists tickets where
`status != 'paid' && status != 'failed'`, so once the original payment is reversed, a ticket left marked `'paid'` would be
**hidden from the checkout list AND un-payable in the UI** — even though its balance is now fully outstanding (the payment
gate keys off `due = totalDue − paidTotal`, which reopened correctly, but the cashier couldn't find the ticket to act on
it).

**Fix:** after a void, if the ticket is still marked `'paid'` but its captured funds no longer cover the total due, the
service returns it to `'ready_for_payment'` (`reopenIfNoLongerPaid`, called from both void branches). It's a safe no-op
when the ticket is still fully covered (e.g. voiding one of several payments) or not loaded. Re-payment already worked via
the `due` recomputation; this makes the ticket **visible** again so it can actually be re-paid or closed.

**Test (+1 → 10 total in `checkout-void-guard.vitest.spec.ts`):** pay a seeded ticket in full (→ `'paid'`), void the
payment, and assert the ticket is back to `'ready_for_payment'` with a zero paid-total.

**Updated verification:** backend **623 tests + harness, RESULT: PASS** (was 622; +1). `apps/api` `tsc` clean.
