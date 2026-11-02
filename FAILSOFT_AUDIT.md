# FAIL-SOFT AUDIT — the pattern underneath every bug found today (2026-07-13)

Five of the six schema bugs found today failed **silently**, and four of them through the same construct:

```ts
.catch(() => 0)
```

That pattern is load-bearing in two **opposite** ways, and nothing in the code distinguishes them:

| | |
|---|---|
| **Benign** | A sidebar badge. A missing count must not break the page. `0` is a fine answer. |
| **Dangerous** | A number someone makes a decision from. `0` is not "unknown" — it is a **confident, wrong answer, indistinguishable from a real zero.** |

The difference is never the catch. It is **what the value feeds.**

---

## Narrowing to the fallback that actually lies

I first flagged every fail-soft catch: **706**, of which my keyword heuristic called 405 "dangerous". That is not
judgment, it is noise, and it would have wasted your time.

So I narrowed to the one that lies:

> **`[]` and `null` are *shaped* like nothing.** A caller receiving them has a chance of noticing, and a UI
> rendering an empty list says "empty" rather than a number.
>
> **`0` is different in kind.** It is a real, plausible, confident answer. *"0 appointments will be affected by
> this branch transfer"* reads exactly like a fact.

**`.catch(() => 0)`: 37 sites.** That is reviewable by a human, which is the point.

---

## The one that mattered

### `ai/ai-access.kysely.repository.ts` — one flaky query removed EVERY tenant's usage cap

```ts
used = await sql`select coalesce(sum(usage_amount),0)::int n from ai_usage_logs …`
  .execute(d).then(…).catch(() => 0);          // ← a failed count looks like a tenant who used nothing
```

And the gate decides the limit with:

```ts
if (!unlimited && s.usage.used + requested > limit)   // 0 + 1 > 500 is false. For every tenant. Always.
```

So a single failed count meant **`limit_exceeded` could never fire** — every tenant, every package. They kept
consuming AI **past their limit, for free,** until a human happened to notice. Nothing errored. Nothing alerted.
The number was simply wrong, **in the direction that costs money.**

This is also the snapshot that the `AiEntitlementGuard` and `GatedAiCompletion` I built earlier today both sit on.

### The fix is NOT "fail closed"

Blocking a paying tenant because a `COUNT` timed out is the **worse** error — the same reasoning that makes the
entitlement guard fail open on a lookup failure. So the call is still **allowed**.

What changes is that the uncertainty is no longer **laundered into a number**:

* `usageUnknown: true` on the snapshot and the decision — it says so out loud
* `limitExceeded: false` now means **unknown**, not "within limit"
* `remainingUsage: null` — **not `-1`**. See the correction below.

A caller can log it, alert on it, or refuse to bill against it. **It can no longer mistake it for a fact.**

Tests pin that unknown usage never becomes a **back-door block** either, and never excuses an unpaid or suspended
tenant — it is evaluated at step 6, after the subscription gates have had their say.

### A correction — my first fix had the same bug in it

Kevin asked: *"are you setting my AI packages unlimited right now?"* Good question, and worth answering in two
parts.

**No.** On the normal path the limit is enforced exactly as before — 500/500 → **denied**. Nothing was relaxed.

**But the first cut of my fix returned `remainingUsage: -1` for the unknown case — and in this codebase, `-1`
means UNLIMITED.** `remainingUsage` flows straight out through `ai-center.controller` and `tenant-ai.service`, so
a billing screen would have rendered *"Unlimited"* at a tenant who simply could not be counted.

**That is the same failure as `.catch(() => 0)`, wearing a different number** — laundering "we don't know" into a
confident value, in the one direction that costs money. I had spent an hour criticising exactly that.

Fixed: unknown is now **`null`**.

| value | meaning |
|---|---|
| `-1` | **unlimited** — a promise: there is no cap |
| `null` | **unknown** — an admission: we could not find out |
| `n` | that many left |

`null` cannot be mistaken for a quantity. Any caller doing arithmetic on it **fails loudly** instead of rendering
a comfortable falsehood — and the typechecker found the one consumer the instant the type changed, which is the
whole argument for using a type the compiler can see rather than a magic number it cannot.

---

## One I did NOT "fix", and why

`checkout/checkout.service.ts:72` — `paidTotalCents(…).catch(() => 0)` — looks alarming (money, `0`) and is
**fine**. It feeds `visitValueCents` on a **post-visit review request**, inside a block whose own comment says
*"a failure here can never affect the captured payment."* A review email with a `0` value is harmless.

Flagging it would have been noise. **A checker that cries wolf is a checker people learn to ignore**, which is
how the real ones get through.

---

## Verification

| | |
|---|---|
| `ai/` + `guards/` + `ai-ocr-receipt/` + `tenant-ai/` (the whole entitlement path) | **1,121 / 1,121** |
| `npm run check:sql` | **1,767 statements · 0 schema errors** |
| `tsc --noEmit` | **0 errors** |
| DI graph | **192/192 modules, 274/274 controllers** |

## Files changed

```
apps/api/src/ai/ai-access-gate.ts                  + usageUnknown; unknown ≠ zero in the limit decision
apps/api/src/ai/ai-access.kysely.repository.ts     stops laundering a failed count into `0`
apps/api/src/ai/ai-usage-unknown.vitest.spec.ts    NEW — pins it, both directions
```

---

## The durable fix — DONE: two constructs, not one

`common/failsoft.ts`:

| | for | on failure |
|---|---|---|
| `orZero()` | a badge, a chip, a count nobody decides from | `0` — and a missing count must not break the page |
| `orUnknown()` | money, impact previews, limits, quotas | **`null`** — 0 is not an acceptable answer |
| `coalesceUnknown(v, { onUnknown })` | when a caller must produce a number | the decision is a **visible argument at the call site** |

You can still write the wrong one. **You can no longer write it without saying so** — which is the difference,
because every bug today was written by someone reaching for the safe-looking idiom they had seen everywhere else.

### Applied where it mattered most: the branch transfer

The impact preview said **"0 appointments will be affected"** before an **irreversible** move. Now:

* an unmeasurable count is **`null`**, not `0`
* `transferPreflight` turns it into a **blocker**: *"Could not measure the impact on: appointments. Transfer is
  blocked until these can be counted."*
* `transferRequest` **refuses outright** — because the impact snapshot is the record a **reviewer approves from,
  weeks later, by someone who was not in the room.** A `null` serialised into it would be silently re-read as a
  zero by exactly the person least able to catch it.

**The typechecker found that second call site the instant the counts became nullable, and I had not thought of
it.** That is the entire argument for a type the compiler can see over a magic value it cannot: the first
consumer was obvious, the second was not — and the second was the more dangerous.

> Refusing costs a Super Admin a retry. Guessing costs a salon.

---

## Verification (final)

| | |
|---|---|
| `common/` + `super-admin-platform/` + `ai/` | **1,205 / 1,205** |
| `npm run check:sql` | **0 schema errors** |
| `tsc --noEmit` | **0 errors** |
| DI · routes | **192/192 modules · 0 route collisions** |
