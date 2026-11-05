# AI Receptionist — call analytics rollup (2026-07-03)

Built the operator analytics over the call-outcome store: raw call rows → the metrics an operator watches (booking
conversion, handoff rate, abandonment, tool-failure rate, avg duration, top intents). Reads real data; the backend
aggregation is fully tested (unit + real Postgres); the UI panel has the usual frontend verification caveat.

## What was built
- `voice-analytics-core.ts` (pure): `summarizeOutcomes(rows)` — honest math. Rates use the real call count as
  denominator and read **null when there's no data** (never a fabricated 0%). Top intents ranked by frequency.
- `VoiceCallOutcomeService.summary(tenantId, {branchId})` — aggregates the tenant's recorded calls via the pure core.
- `GET /super-admin/voice/analytics?tenantId=&branchId=` (SuperAdminGuard).
- admin-web: `superAdminVoiceApi.analytics(...)` + a "Call analytics" metric strip on the AI Receptionist screen
  (Calls, Booked %, Handoffs %, Abandoned %, Tool failures %, Avg duration, Top intents), with an honest empty state.

## Metrics
totalCalls, booked + bookingRate%, handoffs + handoffRate%, abandoned + abandonmentRate%, callsWithToolFailure +
toolFailureRate%, followUpsNeeded, avgDurationSeconds (over calls that reported a duration), topIntents[].

## Verification (fresh runs)
- **Real Postgres:** aggregation counts verified (total/booked/handoffs) over inserted rows; `handoff_outcome='none'`
  correctly excluded from handoffs.
- Unit tests **7/7** (null-not-zero on empty; correct rates + denominators; tool-failure + follow-up counts; top-intent
  ranking; tenant isolation; 'none' handoff excluded). Admin controller + screen tests updated.
- api lint 0, tsc 0, **api suite 2697/2697 across 425 files**, build clean.
- admin-web tsc 0, lint 0, **suite 722/722 across 119 files**, build clean.

## Files created / changed
- NEW `voice-analytics-core.ts`, `voice-analytics.vitest.spec.ts`
- CHANGED `voice-call-outcome.service.ts` (+summary), `super-admin-voice.controller.ts` (+analytics endpoint),
  `admin-web/src/api/superAdminVoiceApi.ts`, `admin-web/src/screens/AiReceptionistScreen.tsx` (+ metric strip), and the
  affected tests.

## Rollback
Additive: new pure module + one service method + one endpoint + one UI panel. Revert to remove. No schema change.

## Receptionist status
The operator surface is now complete: keys, call history, learning review, AND analytics — all over real stores. The
software side of the AI receptionist is feature-complete and dark by default. The only remaining items are external
(Retell/Twilio/LLM accounts) or legal (recording/transcript retention).
