# AI Receptionist — call-outcome store (2026-07-03)

Built the structured per-call outcome store — the foundation the call-history UI, analytics, and the human-reviewed
learning loop all read from. No external account or policy decision needed. Records metadata + a short summary only —
NOT raw transcripts/recordings (those are consent/retention-gated and stored separately).

## What was built
### Migration `299_voice_call_outcomes.sql`
One row per call: provider_call_id (dedup key), prompt_version, start/end/duration, language, intents (jsonb),
tool_calls (jsonb [{name,ok}]), booking/handoff outcome, sentiment, error_category, interruption/repeated-question
counts, abandoned, follow_up_required, summary. **Unique (tenant_id, provider_call_id)** for idempotent upsert; indexed
for newest-first call-history reads per tenant/branch. Applied cleanly on real Postgres 16.

### `voice-call-outcome-core.ts` — pure, honest normalization
Absent/unmodeled fields become null (never fabricated); counts clamp to >= 0; intents/tool_calls are sanitized and
bounded; summary is length-capped. Throws only if the dedup key is missing.

### `voice-call-outcome.service.ts` (+ kysely + in-memory repos)
`record(ctx, provider, input)` → idempotent upsert by (tenant, providerCallId); `get`, `list` (for history/analytics).
tenant/branch always come from the VoiceContext (the integration key), never the payload.

### Endpoint `POST /voice/calls/:callId/outcome` (guarded)
Records the outcome using the guard-resolved tenant/branch. The provider (a Retell end-of-call custom function or a
key-bearing webhook) posts here; a retry safely updates the same row.

## Verification (fresh runs)
- **Real Postgres:** a retried upsert hits the SAME row (count stays 1) and updates the outcome — idempotent dedup
  proven.
- Unit tests **8/8**: normalization (null-not-fabricated, clamping, sanitization); record + read-back; idempotent
  retry (no duplicate); cross-tenant isolation. Controller test: the endpoint records with guard context.
- voice-booking suite **56 tests / 7 files**; typecheck 0; lint 0; **full api suite 2658/2658 across 421 files**; build
  clean.

## Files created / changed
- NEW migration `299_voice_call_outcomes.sql`
- NEW `voice-call-outcome-core.ts`, `voice-call-outcome.service.ts`, `voice-call-outcome.kysely.repository.ts`,
  `voice-call-outcome.vitest.spec.ts`
- CHANGED `voice-booking.controller.ts` (outcome endpoint), `voice-booking.module.ts` (provide the service + repo)

## Receptionist status
Built + verified, no external account: Phase 0 (audit), 1a (read gateway, callable), 1b (pilot-safe write path, dark by
default), 2 (key auth), 3 (provider port + Retell adapter + tools), **call-outcome store**. The full booking loop plus
outcome capture works end-to-end.

## Deliberately NOT built (needs your input)
- Transcript/recording storage — consent/retention-gated; needs your policy + legal review.
- The learning loop's evaluator/suggestion pipeline (reads this store) — buildable next, though the scoring step may
  want an LLM key.
- AI reschedule/cancel (caller-verification policy) and consent-gated customer creation.
- Config/history UI + analytics dashboards (read this store) — buildable, larger frontend work.
- Provider account wiring (Retell/Twilio/LLM).

## Rollback
Additive: new table + service + endpoint. Skip migration 299 (idempotent `IF NOT EXISTS`) and revert the
controller/module edits. No behavior change to existing routes.
