# Card Payment / Checkout — Security & Correctness Audit

Pre-launch audit of the path where real card money moves (POS checkout, Skip-the-Line, refunds), complementing
`CASH_SECURITY_AUDIT.md`. Method: code + schema inspection plus the existing adversarial guard specs.

## Results — critical money-safety properties are SOUND
| Risk | Result | Why |
|---|---|---|
| **Double-charge** | ✅ Protected | Two layers: a SELECT-by-`idempotency_key` pre-check **and** a DB constraint — `payments` carries `UNIQUE (tenant_id, idempotency_key)` (migration 017) plus the partial unique index `payments_tenant_idem_uq` (migration 034, confirmed live). Even two truly-concurrent same-key submits cannot both insert. |
| **Over-refund / double-refund** | ✅ Protected | `refund()` caps cumulative refunds at the captured amount: `refundable = amountCents − alreadyRefunded`, rejects `amount > refundable`, rejects non-approved/partial originals, and rejects negative/zero/fractional amounts. Dedicated adversarial spec (`checkout-refund-guard`) covers full-refund, no-double-refund, no-over-refund, and bad amounts. |
| **Tenant isolation** | ✅ Sound | Every payment read/write is `.scoped(...)` / `.where('tenant_id','=',ctx.tenantId)`; the unique key itself is per-tenant. |
| **Amount validation** | ✅ Sound | Integer cents throughout; positive whole-cent guards on refunds. |
| **Authorization** | ✅ Sound | Taking payment requires `pos.checkout.take_payment`; refund requires `pos.checkout.refund` (`this.need(ctx, …)`). |
| **Surcharge math** | ✅ Tested | Dedicated specs `checkout-split-surcharge` and `checkout-split-card-compensation` exercise the split-payment card-surcharge math. |

## Finding (fixed this session) — idempotency returned a placeholder id under concurrency
**Gap:** in `checkout.recordPayment`, when a concurrent charge with the **same** `idempotency_key` won the unique-constraint
race, the losing insert was caught as `undefined` and the method returned the **client-supplied placeholder** `paymentId`
rather than the real persisted row id. Money stayed safe (only one payment row, no double charge), but a subsequent
refund/void using that returned id could fail to locate the real payment until a retry resolved it.

**Fix:** on a rejected insert with an idempotency key, re-select the real persisted payment and return it (mapping shared
with the pre-check). Idempotency now returns the **real** row even under a concurrent collision. Build clean; checkout
guard specs 31/31; full API suite 444/444.

## Noted, not changed (your call)
- The Skip-the-Line `recordPaymentAndCloseTicket` handles the same rare collision by **throwing** (the insert uses
  `executeTakeFirstOrThrow` inside a transaction). That's money-safe and self-heals on retry (the retry's pre-check
  returns the existing payment), but a packaged build would surface a transient error on a true simultaneous collision.
  Making it gracefully return the existing row requires catching the violation **outside** the aborted transaction and
  re-selecting on a fresh connection — a slightly riskier change to critical code, so it's flagged for your review rather
  than changed unilaterally.
- The split-surcharge / tax behavior itself remains a product decision (see `MONEY_PATH_QA.md`), not a defect.

## Bottom line
The card-money path's critical safety properties — no double-charge, no over-refund, tenant isolation, authorization —
hold. The one concurrency-correctness gap found is fixed. Safe to take real card payments on these dimensions.

---

# Addendum — PCI / Card-Data Handling

The highest-stakes area for a payment platform: how raw card data is stored, transmitted, and logged.

## Results — card-data handling is PCI-conscious
| Control | Result | Evidence |
|---|---|---|
| **No PAN stored** | ✅ | `customer_payment_methods` (mig 047) and the hardware path (mig 078) store a gateway **token** + display-only `brand/last4/exp_month/exp_year` — no card-number/PAN/CVV columns. `customer-payments.service` derives `last4` for display and explicitly never stores the PAN. |
| **No CVV stored** | ✅ | CVV exists only transiently on the processor-request port (`cvv?`) and is sent to CardPointe as `cvv2` for authorization. It is never written to any table. |
| **No card data logged** | ✅ | The CardPointe client logs no request/response bodies (only a path + error string on failure); no `console.log` of bodies anywhere in the payment/checkout code. |
| **Stored webhook payloads scrubbed** | ✅ (hardened) | `safePayload` drops any `secret/password/cvv/account/pan/card/apikey` key before a webhook payload is persisted as `payload_json_safe`. |
| **Tenant scope** | ✅ | Saved cards are `(tenant_id, customer_id)`-scoped. |

## Finding (fixed this session) — the payload scrubber was shallow
**Gap:** `safePayload` only stripped **top-level** keys, so secret-looking fields nested inside an object or array
(e.g. `{ transaction: { cvv, card } }`) would have been persisted unscrubbed. Processor webhooks rarely nest raw card
data, so real exposure was low — but a PCI scrubber must be thorough.

**Fix:** `safePayload` now **recurses** into nested objects and arrays, removing sensitive keys at every depth. Added an
adversarial unit test (top-level, nested, and in-array secrets all stripped; tokens/primitives preserved). payments
tests 39/39; full API suite **446/446**.

## Bottom line (card-data)
Tokenization-first, no PAN/CVV at rest, no card data in logs, and stored webhook payloads now scrubbed at every depth.
PCI posture is sound for these dimensions. (Formal PCI SAQ scope still depends on your hosting + processor integration
model — out of code scope.)
