# AIPowerSalon — Part 6: the AI entitlement guard (shipped in OBSERVE mode) — 2026-07-12

Part 5 closed the one real leak (`ai-marketing`) and flagged the remaining question as **yours, not mine**:

> Eight AI modules do pure computation, so they cost us nothing per call. But a tenant who **cancels** one keeps
> using it, and their included-usage limits are unenforceable because nothing meters them. Effectively free
> after month one.

You said keep going. So I built the enforcement — **but I did not turn it on.**

---

## Why this ships OFF by default

Enforcing **revokes a feature from live, paying-yesterday tenants**. That is a pricing decision with customer
consequences, and it is not one an engineer should make silently inside a refactor. So the guard ships in a mode
that changes **nobody's access**:

| `AI_ENTITLEMENT_ENFORCEMENT` | behaviour |
|---|---|
| `off` | the guard does nothing |
| **`observe`** *(default)* | **the call still runs** — but a tenant who is unsubscribed / expired / over-limit is recorded in `ai_usage_logs` as `action='would_block'`, `status=blocked_*` |
| `enforce` | actually deny: **403** unpaid/cancelled/expired, **429** over-limit |

**Observe mode is the entire point.** Run it for one billing period and the question *"should we gate these?"*
stops being a guess and becomes a number you read off the AI Usage screen: exactly who would break, how often,
and on which package — **before a single tenant loses anything.**

Then you flip one env var, with your eyes open.

---

## What it is

`common/guards/ai-entitlement.guard.ts` — one shared guard, registered once as a global `APP_GUARD`.

`RolePermissionGuard` answers *who you are* (RBAC). Nothing answered *have you paid*. This does, using the same
`evaluateAiAccess()` the rest of the platform already trusts.

It **no-ops on any handler without `@RequiresAiPackage(...)`**, so one registration covers everything and it can
never accidentally gate something it shouldn't. Eight controllers now carry the decorator.

---

## What I deliberately did NOT gate

| | why |
|---|---|
| `ai-booking-public.controller.ts` | genuinely public — no auth guard at all |
| `ai-receptionist-gateway.controller.ts` | external API-key surface, not a tenant session |
| `voice-booking.controller.ts` (`/voice`) | **live telephony.** A mid-call denial drops a real customer's phone call. Billing must never do that. |
| `SUPER_ADMIN` (everywhere) | support and oversight must keep working on a **lapsed** tenant — which is precisely when they're needed |

---

## It fails OPEN, deliberately

A repo error, a DB blip, or an unbound gate → **the tenant is let through.**

This is the exact opposite of the malware-scan rule in Part 2, and the inversion is on purpose. There, a false
`clean` means a live threat reaches a reviewer. Here, a false *deny* means **breaking a customer who paid us,
because a lookup timed out.** The asymmetry of harm points the other way, so the failure mode does too.

Other honesty rules: a denial (real or hypothetical) consumes **no allowance**; observe mode logs **only**
would-be denials, not every successful call (it is a signal, not a firehose).

---

## Tests

| Spec | Result |
|---|---|
| `common/guards/ai-entitlement.guard.vitest.spec.ts` (new) | **17/17** |
| `ai/ai-gated-completion.vitest.spec.ts` (Part 5) | **14/14** |
| OCR suite (Parts 1–4) | **102/102** |
| `ai-marketing-content`, `ai-backbone`, `ai-pricing` (regression) | **green** |
| route-collision + sidebar↔route invariants | **3/3, 7/7** |

**Entitlement audit: 14/14 modules gated. Zero ungated. Zero model-call leaks.**

Routes: **2,188, 0 collisions.** DI: **192/192 modules, 272/272 controllers, 98/98 services.**

Unchanged caveat: `npm install` does not complete in this sandbox, so the real vitest runner and `tsc --noEmit`
did not run. **`npm run typecheck && npm test` locally.** Worth noting: a syntax parse would *not* have caught
the missing `DATABASE` import I introduced in `app.module.ts` and then found by hand — only a real typecheck
does that, which is exactly why the local run matters.

---

## Files changed (11)

```
apps/api/src/common/guards/ai-entitlement.guard.ts               NEW — the shared gate (off/observe/enforce)
apps/api/src/common/guards/ai-entitlement.guard.vitest.spec.ts   NEW — 17 tests
apps/api/src/app.module.ts                                       registers it once as a global APP_GUARD
apps/api/src/ai-analytics-forecasting/…controller.ts             @RequiresAiPackage('ai_analytics_forecasting')
apps/api/src/ai-booking/ai-booking.controller.ts                 @RequiresAiPackage('ai_booking_assistant')
apps/api/src/ai-checkout-upsell/…controller.ts                   @RequiresAiPackage('ai_checkout_upsell_assistant')
apps/api/src/ai-customer-profile/…controller.ts                  @RequiresAiPackage('ai_customer_profile_assistant')
apps/api/src/ai-inventory/…controller.ts                         @RequiresAiPackage('ai_inventory_assistant')
apps/api/src/ai-review-reputation/…controller.ts                 @RequiresAiPackage('ai_review_reputation_assistant')
apps/api/src/ai-scheduling-optimizer/ai-scheduling.controller.ts @RequiresAiPackage('ai_scheduling_optimizer')
apps/api/src/voice-booking/tenant-receptionist.controller.ts     @RequiresAiPackage('ai_phone_call_assistant')
.env.example                                                     documented AI_ENTITLEMENT_ENFORCEMENT
```

---

## The one thing I still want from you

**Run `observe` for a billing period, then look at the numbers before you set `enforce`.**

The reason to wait is not caution for its own sake — it is that you currently have **no idea how many tenants
are using AI packages they no longer pay for.** It could be zero. It could be most of them, because the limits
have never been enforced and people have quietly built habits around features they think are free. Enforcing
blind converts an unknown into a support incident.

Observe mode makes that a number first. That is the only reason it exists.
