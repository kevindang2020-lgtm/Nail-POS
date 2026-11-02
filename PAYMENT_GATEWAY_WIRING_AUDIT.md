# Payment-Gateway Deep Wiring Audit

Goal: trace every layer of the payment gateway end-to-end, skeptically, and fix any real bugs. One serious bug was found
and fixed; the rest of the wiring was verified correct. All findings below are grounded in the code, not assumed.

## Verification
- Backend: **637 tests + harness, RESULT: PASS** (was 634; +3 new regression tests below).
- `apps/api` `tsc --noEmit`: clean. The dead `processorFor` helper was fully removed (no lingering references).

---

## BUG FOUND & FIXED — POS charge gate keyed off platform env instead of the tenant gateway

**Severity: high (a salon with a real, active gateway could not take card payments; and sandbox mode simulated every
tenant's cards regardless of their real gateway).**

### What was wrong
`payCard` / `paySplit` / `refund` / `void` decided whether to run a real charge by reading `settings.fiservStatus`. That
value comes from `resolvePaymentStatus()`, which is **purely platform-env-derived**:

```
resolvePaymentStatus() = cardPointeConfigured() ? 'connected'
                       : process.env.PAYMENTS_SANDBOX === '1' ? 'sandbox' : 'not_configured'
cardPointeConfigured() = cardPointeConfigFromEnv() !== null   // checks platform ENV FISERV creds — NOT the tenant config
```

The per-tenant resolved `processor` was correctly plumbed into `processorFor(ctx)` and used *inside* the real-charge
branch — but that branch was gated on `fiservStatus === 'connected'`, which only becomes true when the **platform** has
env credentials, never because a **tenant** activated their own gateway in `tenant_payment_config` (what the Configure
Gateway screen writes).

Consequences in the intended per-tenant production model (platform sets no env FISERV creds; each salon configures its
own gateway):
- `cardPointeConfigured()` → false → `fiservStatus` → `not_configured` → a salon with a fully configured, **active**
  gateway is told *"Card processor is not configured yet."* Real charges were impossible.
- With `PAYMENTS_SANDBOX=1`, `fiservStatus` → `sandbox` → **every** tenant's card payments were auto-approved as
  simulated, ignoring their real gateway.
- The whole real-charge branch was effectively unreachable dead code in production.

This violated the core rule *"POS checkout must always use the selected tenant's active gateway."*

### The fix
Re-grounded the charge/refund/void decision on the **resolved tenant gateway**, via a single helper that returns both the
processor and the effective status:

```ts
private async payProc(ctx, settings): { processor; status } {
  if (this.gateway) {                                   // production: tenant gateway is the source of truth
    const g = await this.gateway.resolve(ctx.tenantId);
    if (g.processor) return { processor: g.processor, status: 'connected' };   // active gateway → real authorize/capture
    return { processor: undefined, status: process.env.PAYMENTS_SANDBOX === '1' ? 'sandbox' : 'not_configured' };
  }
  return { processor: this.processor, status: settings.fiservStatus };          // in-memory/dev/tests: unchanged
}
```

`resolve()` returns a `processor` **only** when the tenant gateway is `status === 'active'` and its credentials decrypt,
so `g.processor` present is a faithful "this tenant can take real cards" invariant. All four money paths (`payCard`,
`paySplit`, `refund`, `void`) now use `payProc`; the dead `processorFor` was removed.

Behavior after the fix:
- Active tenant gateway → real `authorizeAndCapture` against that tenant's own processor (sandbox or production base URL,
  as configured) — never a synthesized approval.
- No usable tenant gateway → `not_configured` (the charge is blocked), unless `PAYMENTS_SANDBOX=1` explicitly enables a
  local-dev simulation. The simulation is now the *only* synthetic path and never shadows a real gateway.
- **Corollary:** because `resolve()` yields no processor for any non-`active` status, **pausing or disabling a gateway now
  actually stops POS card charges** for that tenant. Previously those Super Admin controls had no effect on the charge
  path (which keyed off env).

The no-resolver path (used by every existing test, which injects a spy processor and overrides `settings()`) is byte-for-
byte unchanged, so all prior payment tests pass as-is.

### Regression tests added (`checkout/checkout-tenant-gateway-charge.vitest.spec.ts`, +3)
Driven with a fake per-tenant resolver while the in-memory repo reports `fiservStatus: 'not_configured'` (the env
default), proving the decision now comes from the gateway:
1. **Active tenant gateway authorizes+captures for real** even though env `fiservStatus` is `not_configured` — the
   processor is actually called and charges the exact amount due. *(This test fails against the old env-gated code, which
   would return `not_configured`.)*
2. **Unconfigured tenant gateway blocks the charge** — returns not-configured, processor never called, no fake approval.
3. **With no usable gateway, `PAYMENTS_SANDBOX=1` simulates** (`sbx_` txn) — the only synthetic path, still no real
   processor call.

---

## Layers traced and verified CORRECT (no bug)

**Inbound webhook (`payment-webhook.service.ts` + controller).** Order: resolve tenant → verify signature → idempotency →
apply. Each guarantee holds:
- *Tenant isolation:* tenant is resolved **only** by the webhook's merchant id via `resolveTenantByMerchantId`, which
  returns null for an unknown **or ambiguous** MID (`rows.length !== 1`) — a shared/ambiguous merchant id resolves to no
  tenant and is rejected (`400 unknown_merchant`), never borrowing another tenant's gateway.
- *Signature:* processor-aware (`stripe` timestamped w/ replay window, `square` url+body base64, generic HMAC-SHA256 hex),
  all timing-safe; verified against **that tenant's** decrypted webhook secret; invalid → `401`, nothing applied.
- *Idempotency:* an `event_id` already processed (`processed_at IS NOT NULL`) short-circuits with `{ duplicate: true }`.
- *Money application:* payment status updates are scoped to `WHERE tenant_id = <resolved> AND processor_transaction_id =
  <txn>` — a webhook for tenant A can't touch tenant B even if it references B's txn id. Refunds/settlements/chargebacks
  land in tenant-scoped ledgers, each with its own dup guard (`processor_refund_id` / `settlement_id` / `chargeback_id`).
- *No secret persistence:* `safePayload` strips any secret-looking key (secret/password/cvv/account/pan/card/apikey) at
  any depth before the payload is stored.
- *Raw body:* the controller prefers `req.rawBody`; `PAYMENTS_WEBHOOK_RAW_BODY=1` makes raw capture **mandatory** in
  production (rejects rather than verifying over a re-serialized JSON copy).

**Secret handling (no leakage).** `decryptSecret` is called in exactly two internal places — to build a tenant-bound
processor, and to HMAC-verify a webhook — and the decrypted value is never put in any response. Every client-facing
shape uses masked values or presence booleans: `getMasked` (masked MID + status only), `verifyCredentials` (`!!_enc`
booleans, never decrypts), the command-center row (`credsPresent: !!(…_enc)` only — raw `_enc` columns are selected for
the boolean but never emitted), `testConnection` (honest: states no live round-trip, returns no secret).

**Status transitions.** `gatewayStatusTransition` rejects every invalid move (pause-when-paused/disabled,
disable-when-disabled, resume-when-active, any action when `not_configured`); the controller throws `BadRequest` **before**
any write, then updates status + writes an audit row.

**Resolver → processor construction.** `resolve()` builds a per-tenant processor from decrypted creds for the configured
processor type (fiserv/cardpointe-bolt/clover/square/stripe), returns `processor: undefined` + `status: 'error'` if a
client can't be built, and only returns a usable processor at `status: 'active'`. `envFallback` yields a platform-env
processor **only** behind an explicit `PAYMENTS_ALLOW_ENV_FALLBACK=1` opt-in (else `NOT_CONFIGURED`).

---

## Minor notes (not bugs; flagged honestly, not "fixed" to avoid churn)
1. **Webhook duplicate-delivery race.** Sequential processor retries are correctly caught by the `event_id` idempotency
   check, and each ledger insert has its own dup guard, so realistic retries never double-apply. Only a truly *concurrent*
   identical delivery (same `event_id`, same millisecond, before either commits `processed_at`) could double-insert a
   ledger row — which real processors don't do (they retry sequentially after a timeout). Hardening to defend even that
   race = DB unique constraints (`tenant_id, event_id`) + `ON CONFLICT`, which is a migration; deferred as defense-in-depth.
2. **Webhook amount units.** `pickNum` prefers cents-named keys (`amountCents`/`feeCents`/…) and rounds. If a specific
   processor sends a bare `amount` in **dollars**, that mapping needs its exact webhook schema to disambiguate — verify
   against the real processor sandbox payloads.
3. **Partial refund via webhook** sets the matched payment's status to `refunded` wholesale. POS-initiated partial refunds
   are tracked correctly with `refundedCents`; the webhook is a status reflection only.
4. **Invalid-signature response** returns `scheme` + `reason` (e.g. `timestamp_out_of_tolerance`) as a debugging aid; no
   secret is revealed and the compare is timing-safe. Could be made generic if you'd rather not hint to a caller.

Items 1–2 are appropriately gated on the live processor sandbox (the same dependency already documented for exact
signature header/scheme). None blocks the per-tenant gateway from working correctly.

---

## Addendum — adapter money conversion (verified correct) + surcharge reporting (fixed)

Continuing the sweep into the two remaining money areas.

### Processor adapter money conversion — verified correct, no bug
Audited the request amount units **and** response parsing in all five adapters. Each matches its processor's documented
convention exactly:
- **CardPointe / CardPointe-Bolt** (Fiserv CardConnect gateway): send a **dollar string** via `toDollars` (e.g. 1250¢ →
  `"12.50"`, 11098¢ → `"110.98"`) and parse the response dollar amount back with `×100`. Round-trip consistent.
- **Stripe / Square / Clover** (modern JSON APIs, smallest currency unit): send **integer cents** directly
  (`amount: 1250` / `amount_money:{amount:1250}`) and read cents back. No dollar conversion.

This is exactly right — a mismatch would be a 100× error. It is also **fully regression-locked**: every adapter spec
asserts the precise wire amount in both directions, with explicit comments distinguishing dollar-string from integer-cents
(`expect(amount).toBe('12.50')` vs `expect(amount).toBe(1250)` "NOT a dollar string"). Nothing to fix.

### Revenue / surcharge reporting — asymmetry investigated; revenue was correct; cosmetic breakout fixed
The handoff noted a possible revenue asymmetry ("single-card surcharge folded into `amount_cents`, split surcharge not").
Traced it to ground truth:
- `recordSplitAtomic` folds the card-portion surcharge **into the card payment row's `amount_cents`**
  (`method==='card' ? amount+surcharge : amount`); single-card `amount_cents` already includes it. So **both** payment
  types store `amount_cents` inclusive of surcharge.
- The reports builder computes revenue as `gross = sum(grossCents)` where `grossCents = amount_cents`, and **never** adds
  `surchargeCents` on top (it flows only into the standalone `cardSurchargeCents` breakout). `net = gross − discounts`,
  no surcharge term.

**Conclusion: revenue totals were already correct and consistent for single vs split — no miscount.** The only real gap
was cosmetic: the Kysely reports query hardcoded `surchargeCents: 0`, so the "card surcharge collected" breakout read **$0**
in production even though `tickets.surcharge_cents` holds the value.

**Fix (safe, contained — not the broad refactor that was deferred):** the reports query now attributes each ticket's
surcharge to exactly **one** card payment row, via a pure, exported helper `attributeCardSurcharge` (paymentId →
surchargeCents). A split's multiple rows are credited once (first non-refund card row), so the breakout is accurate
without double-counting. Revenue is provably unaffected because `surchargeCents` is never summed into gross/net.

**Tests (`reports-core.spec.ts`, +8):** the helper — single card credited; split credits the card row only; two card rows
on one ticket credited once; refund row not credited; zero/again null ticket → 0 — plus a builder check proving
`totalRevenueCents` equals the sum of gross (surcharge **not** added on top) while the `cardSurchargeCents` breakout sums
the attributed surcharge once per ticket.

**Updated verification:** backend **637 tests + harness, RESULT: PASS** (reports-core harness 39 → 47); `apps/api` `tsc`
clean.

### Net result of the payment-gateway audit
One serious bug found and fixed (POS charge gate keyed off env instead of the tenant gateway) plus one cosmetic reporting
gap fixed (surcharge breakout). Every other layer — webhook isolation/signature/idempotency/money application, secret
handling, status transitions, ambiguous-MID rejection, and adapter money conversion across all five processors — was
traced and verified correct (and, for the adapters, already test-locked).
