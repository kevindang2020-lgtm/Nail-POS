# AI trial-expiry sweep — keep stored status honest

## The gap this closes
A subscription whose trial has lapsed is correctly **denied access** by the gate at read-time (it checks `trial_ends_at`).
But its **stored status stays `trialing`** until some event moves it — and nothing did, unless a provider happened to send
a trial-expiry event. So Super-Admin counts ("active trials") and MRR/active-trial metrics drift: a dead trial keeps being
counted as live. Access was right; the stored state and metrics were stale.

## The fix
A sweep flips lapsed trials to `expired` in storage by emitting a synthetic, idempotent `trial_expired` billing event per
trial — reusing the exact same state machine, idempotency ledger, and audit from the billing sync. No new transition
logic, no parallel path.

## Files
- `apps/api/src/ai/ai-trial-sweep.ts` (new) — `AiTrialSweepJob.sweep(now, limit)` + in-process `AiTrialSweepScheduler`
  (gated by `AI_TRIAL_SWEEP_CRON_ENABLED`, hourly, `unref`'d, non-overlapping) + `trialExpiryEventId`
- `apps/api/src/ai/ai-subscription-billing.repository.ts` — `listExpiredTrials(nowIso, limit)` (port + InMemory + Kysely)
- `apps/api/src/ai/ai-subscription-billing.service.ts` — secret-guarded `POST internal/ai-billing/sweep-trials`; job +
  scheduler registered in the module
- `apps/api/src/ai/ai-trial-sweep.vitest.spec.ts` (new) — 3 tests

## How it works
`listExpiredTrials` returns trialing subscriptions with `trial_ends_at <= now`. For each, the job calls the billing
service with `eventType: 'trial_expired'` and a **stable per-trial event id** (`trial_expiry:<tenant>:<package>:<YYYY-MM-DD>`),
so the state machine flips `trialing → expired`, the ledger dedupes re-runs, and an audit row is written. Idempotent by
construction: once flipped the row is no longer `trialing` (so it isn't re-listed), and even if it were, the event id is a
no-op. Off by default — dev/test/CI never sweep; ops can trigger a run via the secret-guarded route, or arm the hourly
scheduler with the env flag.

## Verification
API: `tsc` clean; **559 tests** (+3: a lapsed trial flips to `expired` while a still-current trial is untouched; a second
sweep is a no-op; stable event id + the cron flag defaults off); `RESULT: PASS`. Kysely path typecheck-verified.

## Notes
- This is the in-process counterpart to a provider's own trial-end webhook — if your provider sends one, both paths
  converge on the same idempotent event and the first one wins.
- It uses the same `AI_BILLING_WEBHOOK_SECRET` to guard the manual trigger as the other internal billing routes.

## Platform status
Backend **559** tests, admin-web **97**, owner-web **23**, pos-web **67** — all `tsc`/build clean. The remaining items are
still inherently environment-bound: a real LLM call (provider key), a real billing webhook (secret + mapping tuned to your
provider + a delivered event), the outbound charge-initiation flow for paid activation, and purpose-built surfaces for the
7 assistants with no POS home.
