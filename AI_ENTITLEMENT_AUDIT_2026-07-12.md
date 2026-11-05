# AIPowerSalon — Part 5: AI entitlement enforcement, audited across every module (2026-07-12)

Part 4 found OCR running with no subscription check. The obvious question: **is it the only one?**

I audited all 14 billable AI modules. The answer is **no — but it is also not the disaster my first pass
suggested**, and the story of getting to the right answer is worth telling, because I was wrong twice.

---

## My first two passes were wrong. Here is what actually happens.

**Pass 1** looked for `evaluateAiAccess()` and reported **13 of 14 billable modules ungated** — implying a
catastrophic revenue leak. That was a **false alarm**, and I want to be explicit about it rather than bury it.

**Pass 2** found that voice-transcription gates through its own `VoiceEntitlementPort`, not the shared gate.
So "doesn't call `evaluateAiAccess`" ≠ "ungated". Down to 10.

**Pass 3 — the correct model.** `AiAssistantService.run()` **is** the platform's gate: it loads the access
snapshot, calls `evaluateAiAccess()`, blocks **before** the provider call, and writes `ai_usage_logs` in the
package's own unit. Any module routing model calls through it is gated and metered for free. `ai-business`
does exactly that, via an injected port — which is why my grep missed it.

So the real question was never "does it call the gate function". It is:

> **Does this module make a MODEL call that reaches past the gate?**

A module with no model call has no provider cost, and needs no gate to protect it.

| | |
|---|---|
| gated via `AiAssistantService` | ai-business, (now) ai-marketing |
| gated via a bespoke port | ai-money-protection, ai-queue-assignment, ai-voice-transcription |
| gated via `evaluateAiAccess` directly | ai-ocr-receipt (Part 4) |
| **no model call at all** — nothing to leak | ai-analytics-forecasting, ai-booking, ai-checkout-upsell, ai-customer-profile, ai-inventory, ai-review-reputation, ai-scheduling-optimizer, voice-booking |

**Real leaks: 1.**

---

## The one real leak: `ai-marketing`

`ai-marketing.module.ts` bound its completion port straight to the raw provider:

```ts
{ provide: 'AiMarketingCompletionPort', useFactory: () => new AiGatewayService(resolveAiProvider()) }
```

and `ai-marketing-content.service.ts` called `this.gateway.complete({ system, prompt })` — **a real LLM call,
billed to us, checked against nothing.** No subscription check. No trial-expiry check. No usage limit. No usage
row.

The package is **$59/mo with 500 generations included**. A tenant whose Marketing subscription was **cancelled
could keep generating drafts indefinitely, for free** — and it appeared on **no** usage screen, so nobody would
ever have noticed.

### Why it bypassed the gate (and why the fix is not marketing-specific)

`AiAssistantService.run()` takes a single `prompt`. There is **nowhere to put a module's own SYSTEM prompt.**
Marketing's draft generator builds `{ system, prompt }` — so it *couldn't* use the gated path, and reached for
the raw gateway instead. The bypass was structural, not careless.

So the fix is the missing shape, not a patch:

**`ai/ai-gated-completion.ts` — `GatedAiCompletion`.** Same gate (`evaluateAiAccess`), same meter
(`ai_usage_logs`, in the catalog's own unit), but it **carries `system` through**. Any module that needs its own
system prompt should now depend on this rather than on `AiGatewayService`.

`ai-marketing` is rebound to it. Any future module with a bespoke system prompt has a gated path to reach for —
which is the actual repair, since the next one would have made exactly the same choice.

---

## Behaviour

- **Denied → the model is never called.** An unentitled tenant costs us nothing. Asserted for: no subscription,
  cancelled, expired, suspended tenant, and package-disabled-by-super-admin.
- **429 vs 403.** Over-limit is a different problem with a different remedy ("buy overage / wait for the period
  to roll") from unpaid ("fix your subscription"). Collapsing both into one status tells the tenant nothing
  actionable.
- **Blocked attempts are recorded** (`blocked_limit` / `blocked_unpaid`) but consume **no allowance**.
- **A failed provider call is recorded** (`provider_error`) — it may still have been billed to us — but also
  consumes no allowance, because the tenant got nothing for it.
- **`costMicroUsd` is 0**, not an invented figure. Per-provider token pricing is not modelled in this codebase,
  and a fabricated cost on a billing screen is worse than an absent one.
- **A broken usage logger cannot fail a call that already succeeded.**

---

## Tests

| Spec | Result |
|---|---|
| `ai/ai-gated-completion.vitest.spec.ts` (new) | **14/14** |
| `ai-marketing-content.vitest.spec.ts` (the file I changed) | **14/14 — no regression** |
| all other `ai/` specs | **green** |
| whole OCR suite (Parts 1–4) | **102/102** |
| route-collision + sidebar↔route invariants | **3/3, 7/7** |

Routes: **2,188, 0 collisions.** DI: **192/192 modules, 272/272 controllers, 97/97 services.**

Unchanged caveat: `npm install` does not complete in this sandbox, so the real vitest runner and `tsc --noEmit`
did not execute. **Run `npm run typecheck && npm test` locally.**

---

## Files changed (4)

```
apps/api/src/ai/ai-gated-completion.ts                    NEW — gated + metered completion, carries `system`
apps/api/src/ai/ai-gated-completion.vitest.spec.ts        NEW — 14 tests
apps/api/src/ai-marketing/ai-marketing.module.ts          binds GatedAiCompletion instead of the raw gateway
apps/api/src/ai-marketing/ai-marketing-content.service.ts port carries tenantId/userId (a gate must know who asks)
```

---

## What I did NOT change, and why

**The 8 modules with no model call are left alone.** They have no provider cost, so an unentitled tenant using
them costs us nothing — and gating them is a **product decision about whether the feature should be withheld
from a lapsed subscriber**, not a bug fix. That is your call, not mine. But note the consequence as it stands:

> A tenant who cancels `ai_scheduling_optimizer` ($39/mo) or `ai_analytics_forecasting` ($79/mo) **keeps using
> them**. Their usage limits (1000 runs, 500 runs) are unenforceable because nothing meters them. They are
> effectively free after the first month.

That is a **pricing/packaging** question, not a leak. If the intent is that a cancelled subscription removes the
feature, these eight need the gate too — and the honest way to do it is one shared decorator on their
controllers rather than eight bespoke checks. I'd want your call before doing that, because it changes what
existing tenants can do.
