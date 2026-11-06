# AI Calls & Voice Intelligence — Complete Build & Repair (guide 22, Oct 31 2026)

Screen: `/tenant/ai/receptionist/calls` (AI Center → AI Calls). API: `/pos/ai/calls-center/*`. Public webhook: `POST /webhooks/voice/retell`.
Migration: `755_ai_calls_center.sql` (additive; rollback in its header; local `aps` test template only). Nothing was pushed, deployed, called,
texted or charged. No Twilio / Retell setting, agent, number, route or webhook was touched.

## 1 · ROOT_CAUSE_NO_CALLS (guide §05, from code)

| Stage (§04) | Finding |
|---|---|
| 1–3 Customer → Twilio → Retell | Not verifiable from here (no provider access) — BLOCKED_EXTERNAL. AI Receptionist (guide 21) shows the salon's Twilio / Retell evidence. |
| **4 Webhook / event ingestion** | **No receiver existed for Retell's call lifecycle webhooks** (`call_started` / `call_ended` / `call_analyzed`). `voice_call_outcomes` was written ONLY by `POST /voice/calls/:id/outcome` — a custom function the agent itself must be configured to call. An agent that never calls it produces zero call history however many calls it answered. |
| 5 Canonical record | The outcome upsert overwrote every column on each post (a partial or later post could erase `ended_at`, the summary, the duration). |
| 6 UI | The page read the legacy `GET /tenant/ai/receptionist/calls` (50 newest, session branch only) — no search, no paging; an empty result was shown as a bare "No calls yet". |

Fixes: the signed event receiver + durable event store (§2), a non-destructive merge, and an empty state that says why and links to Check AI Calls
System (which reports "Signed call events: Not configured" when `RETELL_WEBHOOK_SIGNING_KEY` is absent — value never shown).

## 2 · Implementation (AI_CALLS_IMPLEMENTATION)

| Area | Files |
|---|---|
| Migration | `apps/api/db/migrations/755_ai_calls_center.sql` — `voice_call_events` (one row per provider event key; payload SHA-256 only; `deliveries` counts redeliveries; auth = provider_signature / integration_key; disposition applied / stale_kept_newer / failed), `voice_tool_executions` (request → result ledger, status CHECK), 5 sync columns on `voice_call_outcomes`, `ai_calls_health_runs` |
| Backend (new) | `modules/ai/src/voice-booking/ai-calls-ingest.ts` (parse, agent→salon resolution, event store, out-of-order merge, tool ledger), `ai-calls-public.controller.ts` (`POST /webhooks/voice/retell`), `ai-calls-center.ts`, `ai-calls-center.controller.ts`, `ai-calls-tokens.ts`; tests `ai-calls-center.pgtest.vitest.spec.ts`, `ai-calls.postgres-race.vitest.spec.ts` |
| Backend (changed) | `voice-booking.controller.ts` (tool request written before dispatch, result after; outcome post recorded as an event), `ai-receptionist-gateway.controller.ts` (a booking carrying `callId` → ledger: pending code / appointment created / failed), `voice-call-outcome.kysely.repository.ts` (non-destructive upsert), `voice-booking.module.ts`, `ai-lifecycles.ts` (`VOICE_TOOL_EXECUTION`), `request-schemas.ts` (`VOICE_RETELL_EVENT_BODY`), `packages/api-contracts/src/errors.ts` (`AI_CALLS_CHECK_RATE_LIMITED`, `VOICE_EVENTS_NOT_CONFIGURED`) |
| POS | `screens/POSAICallsScreen.tsx` (rebuilt in place) + `POSAICallsAndSettings.test.tsx` (calls part rewritten), `api/posAiCallsCenterApi.ts`, `api/posAiApi.ts` (unused `receptionistCalls` removed), `i18n/ns/aicalls.{en,vi}.ts` (196 keys), `ns/errors.{en,vi}.ts`, `ns/index.ts`, `styles.css` (`.aic-*`) |
| Generated | `kysely.types.ts`, ownership registry, state vocabularies, openapi manifest, attack surface, owner/tech error catalogs, response-exposure baseline (shrink), `list-queries.allowlist.json` (summary strip = one card set) |
| Harness | `tooling/catalog-one-screen/aic-extra.mjs`, `interact-aic.mjs`, `live-server.mjs` / `interact.mjs` wiring; screenshots `results/aic-e2e/` |

Event path (§14): Retell event → signature over rawBody+timestamp (5-minute replay window, constant-time) → salon from `ai_receptionist_agents.provider_agent_id`
(none → refused `agent_not_linked`; two salons → refused `agent_ambiguous`; payload metadata is never trusted) → `voice_call_events` (redelivery = same row,
`deliveries + 1`) → merge under a row lock: unknown facts are filled, newer facts overwrite, a stale event never rewinds start / end / a reported transfer.
An event whose branch cannot be resolved is kept as `failed` and listed in Reconciliation — no call is invented.

## 3 · Features (guide §21 statuses)

| Feature | Status |
|---|---|
| Root cause of the empty page; honest empty state with the reason + Check link | COMPLETED_AND_VERIFIED (E2E step 1) |
| Signed Retell lifecycle events: bad / missing signature refused, no key → 503, unknown / ambiguous agent refused | COMPLETED_AND_VERIFIED (pgtest PI-01, PI-04) |
| Duplicate delivery → one event (deliveries counted), one call; out-of-order converge; stale never overwrites newer | COMPLETED_AND_VERIFIED (pgtest PI-02/03, race 3/3, E2E step 2) |
| Agent outcome post never erases provider facts | COMPLETED_AND_VERIFIED (pgtest PI-05) |
| Tool ledger: requested ≠ succeeded ≠ verified business result; retried request = same row; finished rows never rewritten | COMPLETED_AND_VERIFIED (pgtest TL-01, race) |
| Summary strip: Total, Completed, Failed/missed, Verified AI bookings vs AI-reported, Handoffs requested/connected, Unresolved, Avg duration, in progress / stale; "—" for unknown | COMPLETED_AND_VERIFIED (pgtest KP-01/02; E2E = independent SQL) |
| History: scoped search (calls / customers / AI appointments / AI activity), status / outcome, date basis, From/To month calendar, 10/20/50, newest first, filters in URL (search text never) | COMPLETED_AND_VERIFIED (pgtest PG-01, E2E step 3) |
| Overlay: Overview · Customer · Summary/Transcript · Recording · Tool Activity · Booking · Handoff & Follow-Ups · Audit/Errors; Close; Open Booking / View Customer / View Follow-Ups | COMPLETED_AND_VERIFIED (E2E step 4) |
| Opening a call is audited (`ai_call.viewed`); transcript link for owners/managers only; recordings never linked | COMPLETED_AND_VERIFIED (pgtest CD-01, E2E steps 4–5) |
| Check AI Calls System (read-only, 7 groups, evidence / impact / next step / role / trace, recorded, 30 s rate limit showing the last result) | COMPLETED_AND_VERIFIED (pgtest HC-00/HC-01, E2E steps 1, 5) |
| Reconciliation (events without a call, calls only from the agent's post, calls with no end event) | COMPLETED_AND_VERIFIED; provider-side call log comparison BLOCKED_EXTERNAL |
| Missed-call & unresolved assistant (ReceptionistCenter priority list, suggestions only) | COMPLETED_AND_VERIFIED (reused from guide 21) |
| Cross-tenant: another salon cannot open, list or search calls | COMPLETED_AND_VERIFIED (pgtest SEC-01) |
| Front Desk POS EN/VI; 1920×945 … 1024×768 without sideways scroll | COMPLETED_AND_VERIFIED (E2E steps 6–7) |
| Live refresh over WebSocket/SSE | NOT_IMPLEMENTED — no realtime event for calls exists; Refresh button (filters and page kept) |
| Recording import / playback | BLOCKED_EXTERNAL (consent / retention policy + legal review); the page never guesses a recording URL |
| Real inbound call → Twilio → Retell → webhook round trip; registering the webhook URL on the Retell agent; setting `RETELL_WEBHOOK_SIGNING_KEY` | BLOCKED_EXTERNAL (provider accounts, owner approval) |
| 80/90/100 % voice usage warnings | NOT_IMPLEMENTED here (Plans & Usage owns AI usage) |
| POS / API type-check, `POSAICallsAndSettings.test.tsx` | IMPLEMENTED_NOT_VERIFIED (needs CI) |
| Physical ASUS 27″ at 100 % zoom | BLOCKED_EXTERNAL (browser viewports only) |
| Migration 755 on staging / production | BLOCKED_EXTERNAL (owner approval) |

## 4 · SECURITY_PRIVACY

Tenant from the session (POS) or the salon's agent mapping (webhook) — never the body. Webhook: HMAC over rawBody+timestamp, replay window, constant-time;
503 without a key. Stored: event type, provider ids, times, payload SHA-256 — no payload, phone number or transcript. Lists mask phones (`•••• 1234`);
shared phones are flagged, never merged. Transcript: link only, ai.manage only, audited (existing). Recording: never linked. Tool errors: sanitized
category only. A failed ledger write is logged (category only) and never breaks a live call.

## 5 · TEST_EVIDENCE (Oct 31 2026, stand-in runner on PostgreSQL 16, `aps` through 755)

| Suite | Result |
|---|---|
| `ai-calls-center.pgtest` (HC-00, PI-01…05, RC-01, TL-01, KP-01/02, CD-01, SEC-01, PG-01, HC-01) | 14/14 |
| `ai-calls.postgres-race` (real Postgres, 4 sessions): 8 deliveries → 1 event / 1 call; start / end / analyzed racing → 1 ended call; 6 identical tool requests → 1 row | 3/3 · with the ON CONFLICT de-duplication removed: 0/3 |
| Regression: voice-booking.controller 12/13 (the `get_deals` failure is identical on unchanged HEAD), gateway 19/19, gateway e2e 12/12, receptionist-center 16/16, voice-call-outcome 7/7, retell adapter 12/12, tenant-receptionist 5/5, isolation 6/6, voice-tools 3/3, business-setup-center 21/21, booking-verification 9/9 | pass |
| Browser `aic` (EN/VI, Owner + Front Desk, 5 viewports) | 7/7 |
| Combined browser run, 22 sections (`seg,cp,do,promo,cc,mg,mt,cn,pm,bv,ms,eod,fuq,rmd,em,wb,bd,rf,rv,bs,rcp,aic`) · `comms` | 227/227 · 12/12 (one known harness page error after Open Booking) |
| Gates | all 62 `check:*`: 52 via npm + 6 via the stand-in pass; lint, boot, api-contract, strict-bodies-types cannot run here |

## 6 · DEPLOY_ROLLBACK

Additive migration; no flag needed for reads. To receive events: set `RETELL_WEBHOOK_SIGNING_KEY` (platform operator) and point the Retell agent's
webhook at `/webhooks/voice/retell`; link each agent id in AI Receptionist. Rollback: unset the key (endpoint answers 503, nothing is written) and run the
migration header's rollback; existing features keep working.

## 7 · Hand-offs

- **23 AI Front Desk / 24 Reception Copilot**: human takeover and handoff queue read `ai_receptionist_handoffs`; the call overlay's Handoff tab shows requested / attempted / connected / failed.
- **25 AI Calendar**: confirmed AI bookings are only those Booking holds and the ledger links (`voice_tool_executions.related_type = 'appointment'`).
- **26 AI Follow-Ups**: failed / unresolved calls create follow-ups only through the guide-21 approval path.
- **27 AI Center**: tile can read `GET /pos/ai/calls-center/kpis` and `/health/last`.

## 8 · Open owner decisions

1. Approve setting `RETELL_WEBHOOK_SIGNING_KEY` and registering the webhook URL on each salon's Retell agent (production change).
2. Recording policy: import / play provider recordings at all? If yes, retention period and who may listen.
3. Should provider-error calls also appear in the missed-call assistant (today it lists missed / abandoned, failed transfers, person requests, code-pending bookings, follow-ups due)?

Found, out of scope: `email-public.controller.ts` (guide 15) calls `recordWebhook` with outcome strings the `WebhookOutcome` type does not allow
(`not_configured`, `bad_signature`, `ok`) — a CI type-check failure to fix; the frozen `catalog.en.ts` still holds the old literal `—` text for the
retired AI Calls empty-state key (no longer used by the page).

## Built Nov 6 2026 (A10)

- **Same call list as A15.** AI Calls reads the same list, so it gets the same additions:
  - Missed status.
  - Call ended and last update date bases.
  - Agent, direction and length filters.
  - Search by caller or dialed digits.
- **URL keys.** The new filters are saved in the address with the page's existing URL keys.
- **Labels.** "Missed / hung up" is now two statuses: **Missed** and **Hung up**.
- **Not built:**
  - A separate `call_links` table. Links stay in `voice_tool_executions`.
  - Server push (SSE).
  - A Twilio SID column. Search matches the stored provider call reference only.
