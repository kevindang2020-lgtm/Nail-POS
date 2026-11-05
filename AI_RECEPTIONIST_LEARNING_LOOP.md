# AI Receptionist — human-approved learning loop (2026-07-03)

Built the controlled improvement loop (Phase 25). Its whole reason to exist in code is a safety property: the AI never
autonomously changes production. Every change is human-reviewed, versioned, and reversible — and operational fields
(prices/hours/policies/permissions/booking-validation) are untouchable by this pipeline entirely. No LLM/account needed
for the core (the deterministic evaluator flags calls; an optional LLM scorer can plug in later).

## The safety invariants (encoded + tested)
1. **Capture ≠ change.** A call outcome may generate an `open` suggestion; nothing is applied.
2. **Approval only drafts.** Approving a prompt suggestion creates a `draft` prompt version derived from the current
   active one — it does NOT go live.
3. **Activation is explicit + human.** A version becomes live only via `activatePromptVersion(...)`; a `draft` can never
   transition straight to `active` (state machine forbids it).
4. **One active version per (tenant, scope).** Enforced in the service (archive-then-activate) AND at the DB (partial
   unique index) — proven on real Postgres (a 2nd active insert is rejected).
5. **Operational fields are off-limits.** `price/hours/cancellation_policy/deposit_rules/refund_rules/schedules/
   security/permissions/booking_validation` are refused as suggestion targets — the loop only touches
   prompt/faq/knowledge/pronunciation/tool_description.
6. **Rollback.** Re-activates the prior version.

## What was built
- Migration `300_voice_learning.sql`: `voice_prompt_versions` (draft|pending_review|active|archived, partial unique
  active index) + `voice_improvement_suggestions` (open|approved|rejected|applied). Applied cleanly on real PG.
- `voice-learning-core.ts` (pure): allowed/forbidden target guards, the prompt state machine (`canTransition`), and a
  deterministic `evaluateOutcome` (tool failures, repeated questions, interruptions, abandonment, failed booking).
- `voice-learning.service.ts` (+ kysely + in-memory repos): `suggestFromOutcome`, `createSuggestion`,
  `approveSuggestion` (drafts only), `rejectSuggestion`, `submitForReview`, `activatePromptVersion` (explicit),
  `rollback`, `activePrompt`.

## Verification (fresh runs)
- **Real Postgres:** migration applies; the single-active partial unique index rejects a 2nd active version and allows a
  different scope.
- Unit tests **10/10**: guards; state machine (draft can't go live); deterministic evaluator; capture-doesn't-apply;
  approval-only-drafts; forbidden-target refusal; explicit activation + single-active; rollback; no double-approve.
- voice-booking suite **66 tests / 8 files**; typecheck 0; lint 0; **full api suite 2668/2668 across 422 files**; build
  clean.

## Files created / changed
- NEW migration `300_voice_learning.sql`; NEW `voice-learning-core.ts`, `voice-learning.service.ts`,
  `voice-learning.kysely.repository.ts`, `voice-learning.vitest.spec.ts`
- CHANGED `voice-booking.module.ts` (provide the learning service + repo)

## Receptionist status
Built + verified with no external account: audit → read gateway (callable) → key auth → provider port + Retell adapter
→ pilot-safe write path (dark) → call-outcome store → **human-approved learning loop**. The backend spine is complete.

## Deliberately NOT built (needs your input / accounts)
- LLM-based conversation scoring (optional add-on to the deterministic evaluator) — needs an LLM key.
- Admin UI to review suggestions / approve+activate prompt versions (the API is ready; this is frontend work).
- Reschedule/cancel policy, consent-gated customer creation, transcript/recording retention (legal review).
- Provider account wiring (Retell/Twilio).

## Rollback
Additive: two new tables + a service. Skip migration 300 (idempotent) and revert the module edit. No behavior change to
existing routes.
