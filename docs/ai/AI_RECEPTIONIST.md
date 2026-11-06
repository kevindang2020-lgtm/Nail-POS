# AI Receptionist — Complete Build & Repair (guide 21, Oct 31 2026)

Screen: `/tenant/ai/receptionist` (AI Center → AI Receptionist). API: `/pos/ai/receptionist-center/*`. Migration: `754_ai_receptionist_center.sql`
(additive; rollback in the file header). Nothing was pushed, deployed, called, texted or charged. No Twilio/Retell setting, agent, number or webhook
was touched.

## 1 · Root cause of the photographed state (guide §03, from code)

| Shown | Why (code) | Now |
|---|---|---|
| Twilio **Connected** | `resolveTelephonyProvider(process.env)` returned the live adapter when the **platform's** `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` env vars existed; `TwilioTelephonyProvider.status()` is hard-coded `connected`. Not the salon's account, no number, no voice route. | Salon account read from `tenant_messaging_credentials` (checked / never checked / failed); the inbound route is READY only when calls actually arrived (`voice_call_outcomes`); the platform env is named and never used for a salon. |
| Retell **Not connected** | `RETELL_API_KEY` absent. When present, `RetellVoiceProvider.status()` said `connected` from key presence alone. | Key absent → FAILED with the remedy; key present → WARNING "configured, not tested" — never "connected" (no network check is made from here). |
| Integration key **Not issued** | no un-revoked row in `voice_integration_keys` | issued / expired / revoked / not issued, each explicit; the key is not a provider password. |
| Booking **Handoff-only** | the process-wide env switch `VOICE_WRITE_TOOLS_ENABLED` was off; there was **no per-salon control** | write tools need the platform switch **and** this salon's armed flag (`ai_receptionist_control.booking_armed`), enforced in `VoiceBookingController.dispatch` + `AiReceptionistGatewayController.requireWrites`. Arming is refused until the gates pass. |
| Setup **13%** | steps 2, 4, 5, 7, 8 were hard-coded (`pending` / `action_needed`); 1 of 8 "done" | every step computed from evidence: verified / configured / blocked / not done. |

The legacy `GET /tenant/ai/receptionist/overview` (still read by Phone & Caller ID) now reports the center's stage, steps and connections when the
center is available; it no longer calls the receptionist "ready" from hours + a key.

## 2 · Stages and states

Stage (never higher than the evidence): `not_configured → configured → ready_for_test → test_call_verified → live`, or `degraded` when activated but a
gate now fails. Dependency states: READY · WARNING · FAILED · NOT_CONFIGURED · DISABLED · UNKNOWN · BLOCKED_EXTERNAL. "Ready for test" ≠ production
verified (VO-07). A **verified test call** must be a call the provider recorded for this salon in the last 7 days with no error; an owner/manager
marks it (reason required). **Activation** needs every gate (entitlement, salon Twilio, proven route, agent, key, business setup) + the verified
test call; disarming booking or clearing the test call ends activation. Every change: version-checked, idempotent (request key), audited in the same
transaction, and recorded append-only with before/after (`ai_receptionist_control_events`, trigger refuses UPDATE/DELETE).

## 3 · Files

| Area | Files |
|---|---|
| Migration | `apps/api/db/migrations/754_ai_receptionist_center.sql` (control, control events, health runs, actions; 2 call-history indexes) |
| Backend (new) | `modules/ai/src/voice-booking/receptionist-center.ts`, `receptionist-center.controller.ts`, `receptionist-center.pgtest.vitest.spec.ts`, `receptionist-center.postgres-race.vitest.spec.ts` |
| Backend (changed) | `voice-booking.module.ts` (provider), `voice-booking.controller.ts` + `ai-receptionist-gateway.controller.ts` (per-salon arming), `tenant-receptionist.service.ts` (legacy overview from evidence), `ai-lifecycles.ts` (`AI_RECEPTIONIST_ACTION`), `packages/api-contracts/src/errors.ts` (14 `AI_RCPT_*` codes) |
| POS | `screens/POSAIReceptionistScreen.tsx` (rebuilt in place) + test, `api/posAiReceptionistCenterApi.ts`, `i18n/ns/rcpt.{en,vi}.ts` (243 keys), `ns/errors.{en,vi}.ts`, `ns/index.ts`, `styles.css` (`.rcp-*`) |
| Generated | `kysely.types.ts`, `actor-columns.generated.ts`, ownership registry, state vocabularies, openapi manifest, attack surface, owner/tech error catalogs, `list-queries.allowlist.json` (KPI route = one card set) |
| Harness | `tooling/catalog-one-screen/rcp-extra.mjs`, `interact-rcp.mjs`, `live-server.mjs` / `interact.mjs` wiring; screenshots `results/rcp-e2e/` |

## 4 · Features (guide §21 statuses)

| Feature | Status |
|---|---|
| Root cause for Twilio / Retell / key / handoff-only, honest connection states | COMPLETED_AND_VERIFIED (pgtest VO-01…04, E2E step 1) |
| 8 original setup steps computed from evidence; 5 cards; Connections; 7 Quick Actions (same routes); Recent Calls | COMPLETED_AND_VERIFIED (E2E steps 1, 8) |
| Per-salon booking arming (handoff-only until armed; platform switch is the master) | COMPLETED_AND_VERIFIED (pgtest + race) |
| Verified test call + activation gates; append-only control history | COMPLETED_AND_VERIFIED with a **recorded harness call**; a real authorized test call is BLOCKED_EXTERNAL |
| Check AI Receptionist System (read-only, per-dependency evidence / impact / remedy / role, recorded, 10-second limit) | COMPLETED_AND_VERIFIED |
| KPI cards with period (salon-local whole days, DST-safe), definitions, — without a denominator | COMPLETED_AND_VERIFIED (pgtest across the Nov 2 2025 DST end; E2E = independent SQL) |
| Call history: server search (call id, summary, outcome, error, caller last-4), status/outcome filters, date basis, From/To month calendar, 10/20/50, newest first | COMPLETED_AND_VERIFIED |
| Scoped search: customers (masked, shared phone flagged, never merged) / AI appointments / AI activity | COMPLETED_AND_VERIFIED (customers, isolation); appointments + activity: pgtest-level only |
| Call overlay: Close, generated summary flagged, masked caller + identity status, appointments, follow-ups, handoffs (requested / attempted / completed / failed), AI actions, transcript link for managers only (audited), Open Booking with the customer | COMPLETED_AND_VERIFIED |
| Priority list (urgent + oldest first; missed calls, failed transfers, person requests, code-pending bookings, follow-ups due) | COMPLETED_AND_VERIFIED |
| Action approval: Front Desk prepares a follow-up task (awaiting confirmation, nothing executed); owner/manager confirms → task created once; texts / booking changes refused here | COMPLETED_AND_VERIFIED (pgtest + race + E2E) |
| Live provider reachability (Retell / Twilio APIs), webhook signature traces, real inbound routing | BLOCKED_EXTERNAL (no provider calls from here; owner + accounts) |
| Usage warnings 80/90/100 % and invoice reconciliation on this page | NOT_IMPLEMENTED here (Plans & Usage owns AI usage; voice minutes shown as a secondary metric) |
| Live push for new calls | NOT_IMPLEMENTED (manual Refresh; no realtime event for call outcomes exists yet) |
| POS / API type-check, rewritten `POSAIReceptionistScreen.test.tsx` | IMPLEMENTED_NOT_VERIFIED (needs CI) |
| Physical ASUS 27″ at 100 % zoom | BLOCKED_EXTERNAL (browser viewports only) |
| Migration 754 on staging / production | BLOCKED_EXTERNAL (owner approval) |

## 5 · Test evidence (Oct 31 2026, stand-in runner on PostgreSQL 16, `aps` template through 754)

| Suite | Result |
|---|---|
| `receptionist-center.pgtest` (VO-01/02/03/04/07, BK-05, KPI + DST, PG-01, SR-01/02, SEC-01, UI-04, PG-02/OPS-01, AI-01/02, HL-01/02) | 16/16 |
| `receptionist-center.postgres-race` (real Postgres, 4 sessions): 8 AI holds on one slot → 1; two managers arm at the same version → 1; prepare double-tap → 1 open action; two confirms → 1 follow-up | 3/3 · with the action row lock removed: 2/3 |
| Regression: voice-booking.controller 12/13, gateway 19/19, gateway e2e 12/12, tenant-receptionist 5/5, audit 3/3, isolation 6/6, voice-tools 3/3, business-setup-center 21/21, booking-verification 9/9, provisioning 4/4 | pass; the 1 controller failure (`get_deals`) and voice-holds 4/6 + 0/4, voice-booking-write 6/7, voice-branch-info 2/3 fail **identically on unchanged HEAD** (stand-in has no query builder) |
| Browser `rcp` (EN/VI, Front Desk vs Owner, 5 viewports incl. 1920×945 with the five cards on one row) | 8/8 |
| Combined browser run, 21 sections (`seg,cp,do,promo,cc,mg,mt,cn,pm,bv,ms,eod,fuq,rmd,em,wb,bd,rf,rv,bs,rcp`) | 220/220 · `comms` 12/12 (one known harness page error after Open Booking: "not in the harness") |
| Gates | see CONTINUE_HERE / report: all 62 `check:*` pass or can't run here (lint, boot, api-contract, strict-bodies-types) |

## 6 · Hand-offs to the later AI guides

- **22 AI Calls**: call logs / transcripts / customer-linked history — reuse `ReceptionistCenter.calls` / `callDetail` and the masked identity rules.
- **23 AI Front Desk / 24 Reception Copilot**: human handoff queue and takeover — the priority list reads `ai_receptionist_handoffs` (requested vs connected).
- **25 AI Calendar**: availability truth stays in Booking; the AI hold race is covered here.
- **26 AI Follow-Ups**: the priority list creates `ai_receptionist_follow_ups` only through owner/manager confirmation.
- **27 AI Center**: read `GET /pos/ai/receptionist-center/readiness` for the receptionist tile (stage + steps).

## 7 · Open owner decisions

1. Should Front Desk be able to confirm a prepared follow-up task itself (today owner/manager only)?
2. Verified-test-call window: 7 days — keep?
3. Show voice-minute cost on this page once a per-minute rate is approved (none exists in code)?

## Built Nov 6 2026 (A15 — Kevin: "continue finish all")

- **New call statuses:**
  - **Missed:** the caller hung up in under 15 s (`MISSED_SECONDS`). Hang-ups of 15 s or more stay **Hung up / Abandoned**.
  - **In progress:** the call has no end and started less than 2 h ago (`STALE_HOURS`). An older open call shows **No end recorded**
    (on AI Calls: **Unknown**). It is never shown as live.
- **New filters:** agent (this salon's agents), service (words in the intents, tool calls or summary), direction, and length
  (under 1 min, 1–5 min, over 5 min). If the shortest length is longer than the longest, the request is refused with
  `AI_RCPT_INVALID_FILTER`.
- **Number called column.** Shows the salon number that was dialed, masked. Search now also matches caller digits and dialed digits.
- **More date bases:** call started, call ended, recorded, last update.
- **URL filters.** All of the above are saved in the address (`rp*` keys).
- **Live updates.** The list, the KPIs and the priorities re-read every 30 s while the tab is visible, and again when the tab comes
  back into view. The page says so. This is polling, not server push.
- **Tests:**
  - `receptionist-center.pgtest` (17)
  - `POSAIReceptionistScreen.test` (2)

## Built Nov 6 2026 (A9 Receptionist Settings — Kevin: "continue finish all")

- **Recording-notice approval.** Migration 829 adds `ai_receptionist_consent_approvals`.
  - Approval is append-only and covers one exact text (sha256), approved by an **owner** for the salon or for one branch.
  - These saves are refused with `AI_RCPT_CONSENT_NOT_APPROVED` until the effective notice text is approved:
    - turning recording on;
    - changing the notice while recording is on.
  - Other saves never trip on this check.
  - A manager who tries to approve is refused with `AI_RCPT_OWNER_ONLY`.
  - The page shows Approved / Not approved / Changed — needs approval, and has an "Approve this notice (owner)" button.
  - Each approval is audited (`settings.consent_approved`).
- **Check Receptionist Settings.** `POST …/settings/check` reports six parts: read, consent, notice words, timing, history, live use.
  - Each run is recorded in `ai_receptionist_settings_checks`, and the last run is shown on the page.
  - The check is read-only: it changes no setting and calls no provider.
- **Not built (external).** Live calls do not read these settings yet; the voice agent keeps its own Retell configuration. The page
  says this, and the "Live calls use these settings" part of the check is always a WARNING until the agent configuration push is built
  and tested against a real Retell agent.
- **Tests:**
  - `ai-settings.pgtest`
  - `ai-settings.vitest`
  - `POSAICallsAndSettings.test` (4)
