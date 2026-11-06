# Reception Copilot — Complete Build & Repair (guide 24, Oct 31 2026)

Route `/tenant/ai/copilot` (unchanged). Every original module is kept (Queue Now, AI Phone Receptionist activity, Explain a
Service, Waitlist / Standby, Caller Lookup, duplicate candidates, Find Open Times + holds, Check for Conflicts, Cancel,
Copilot Settings, Send a Text, Book, Reschedule, chat). Migration **757** (additive) — local `aps` template only.

## P0 audit — what the code did before

| # | Finding | Fix |
|---|---|---|
| 1 | **Double execution.** The action ledger was *find → run → record*: two simultaneous confirms of one request both executed (two texts / two cancels). | The ledger now **claims** the key (`state='pending'`, `INSERT … ON CONFLICT DO NOTHING`) before the booking / messaging service runs, then records `succeeded / failed / unknown`. Race spec: 8 confirms over 4 real sessions → domain runs once; with the claim removed 0/2 pass. |
| 2 | **Texts silently swallowed.** The screen keyed a text by `phone + first 40 characters`, so the same "Running late" text to the same customer later was answered "already processed" and never sent. Cancel / reschedule sent no key at all. | Prepare issues a fresh request key per review (sealed in the token); a double tap replays, a new review sends. |
| 3 | **Settings failed open.** If Copilot settings could not be read, the action gate was skipped. | Unreadable settings → `ACTION_DISABLED` (prepare and spine). |
| 4 | **No entitlement on actions.** Only the chat went through the AI package gate. | `@RequiresAiPackage('ai_reception_copilot')` on the new controller and on the hold routes (global guard; honours `AI_ENTITLEMENT_ENFORCEMENT`, default *observe*). |
| 5 | **"Done" from a click.** Success was shown from the action reply only. | Confirm re-reads the persisted appointment / notification and shows the real state + reference. |
| 6 | One-step `POST /tenant/ai/center/copilot/action` let any client confirm without a server preview. | **Retired.** All four actions go `actions/prepare` → `actions/confirm`. |

## How an action runs now (guide §06)

1. **Identify / Prepare** — `POST /pos/ai/copilot-center/actions/prepare` re-reads the canonical record (tenant- and branch-scoped), checks role + Copilot switches (fail closed), shows *Now* vs *Proposed*, warnings (overlap, deposit, shared phone, no salon Twilio) and notices. **No side effect.** Returns a token sealed for this salon, this staff member and this exact payload, valid 5 minutes, carrying a fresh request key.
2. **Confirm** — `POST …/actions/confirm` with the same action + token (a changed payload → `COPILOT_PREPARE_MISMATCH`, another staff member / tampered → `COPILOT_PREPARE_INVALID`, late → `COPILOT_PREPARE_EXPIRED`). Runs the existing spine: Copilot permission + domain permission, switches, claim-before-run ledger, BookingService / NotificationsService, audit.
3. **Verify** — re-reads the record: `completed`, `pending_verification`, `submitted` (test sender), `provider_accepted`, `delivered` (only with a provider report), `failed`, `unknown`.

Texts: number must be E.164 (`+country`); opted-out numbers are refused; GSM-7 / UCS-2 segment estimate shown; "Delivered" never claimed without provider evidence.

## Added (guide §09 — all three)

* **Check Copilot System** (`POST …/health`): 8 read-only areas — AI entitlement, Copilot switches, your action permissions (+ stuck / unknown actions), customer search, booking data, live queue, Twilio sender, background (callbacks, undelivered texts). Ready / Warning / Failed / Not configured / Disabled / Unknown with evidence and next step; recorded; a repeat within 30 s returns the same run. Sends, books and calls nothing.
* **Full Customer & Reception Activity Overlay** (`GET …/customers/:id`): Overview, Appointments, Calls & Messages, Copilot Actions, Consent, Audit; masked contact; shared phones flagged (never merged); Close, Open Booking (`/booking/new?customerId=…&from=copilot`), View communications. **The view itself is audited.**
* **Smart Front Desk Priority Assistant** (`GET …/priorities`): unassigned waiting customers, bookings due within 30 min, AI calls needing a callback, overbooked overlaps (the database refuses any other overlap), failed Copilot actions, failed texts — each with reason + evidence + proposal. Most urgent first, then oldest. A proposal with an action opens **Prepare**; nothing executes without a person.

Also: live status strip with "as of" + Refresh + 45 s fallback; scoped search (customers / appointments / technicians / calls / activity, server-side, page 1/2/3, 10/20/50); Copilot activity history (newest first, state + action filters, salon-local From/To month calendar, refreshes when an action completes). The live queue is never re-ordered.

## Files

* Migration `757_reception_copilot_center.sql` — ledger: `state` (inline CHECK pending/succeeded/failed/unknown), `actor_user_id`, `payload_hash`, `correlation_id`, `error_code`, `summary`, `finished_at`, `updated_at`, `updated_by`; legacy rows backfilled finished; `reception_copilot_health_runs`.
* Backend: `modules/ai/src/ai-center/reception-copilot-center.ts`, `reception-copilot-center.controller.ts` (new); `reception-copilot-action.service.ts` (claim/finish, fail-closed settings, payload hash), `ai-center.controller.ts` (retired route, entitlement on holds), `ai-center.module.ts`, `ai-lifecycles.ts` (`RECEPTION_COPILOT_ACTION`), `errors.ts` (7 `COPILOT_*` codes).
* POS: `POSReceptionCopilotScreen.tsx` (four flows rewired, new panels), `receptionCopilotCenter.tsx` (new), `api/posCopilotCenterApi.ts` (new), `posAiApi.ts` (4 retired methods removed), `i18n/ns/rcc.{en,vi}.ts` (149 keys each), `ns/errors.{en,vi}.ts`, `ns/index.ts`, `styles.css`; tests `POSReceptionCopilotScreen.test.tsx`, `POSReceptionCopilotHold.test.tsx` updated.
* Tests: `reception-copilot-center.pgtest.vitest.spec.ts`, `reception-copilot-center.postgres-race.vitest.spec.ts`; `copilot-holds.controller` spec (constructor), `request-schemas` spec (retired route).
* Harness: `tooling/catalog-one-screen/rcc-extra.mjs`, `interact-rcc.mjs`, wiring in `live-server.mjs` / `interact.mjs`; screenshots `results/rcc-e2e/`.
* Generated: `kysely.types.ts`, `actor-columns.generated.ts`, ownership registry, state vocabularies, openapi manifest, attack surface, error catalogs.

## Acceptance tests (guide §12)

| Test | Status | Evidence |
|---|---|---|
| CP01 physical ASUS 27″ at 100% | BLOCKED_EXTERNAL | browser viewports only |
| CP02 no sideways scroll; overlays scroll | COMPLETED_AND_VERIFIED | E2E `rcc` 1920×945, 1366×768, 1280×720, 1024×768 |
| CP03 navigation + all original modules kept | COMPLETED_AND_VERIFIED | E2E step 1 |
| CP04 search by name / full name / phone / email / ID | COMPLETED_AND_VERIFIED | pgtest "customers by partial name…"; E2E step 7 |
| CP05 shared phone → distinct profiles, no merge | COMPLETED_AND_VERIFIED | pgtest + E2E (flag shown) |
| CP06 no cross-tenant disclosure | COMPLETED_AND_VERIFIED | pgtest "tenant isolation" |
| CP07 appointments / technicians / calls / AI history search | COMPLETED_AND_VERIFIED | scoped search (pgtest customers; others same code path, harness) |
| CP08 From/To month calendar | COMPLETED_AND_VERIFIED | E2E step 6 (shared `RangeCalendar`) |
| CP09 inclusive end date, salon timezone, cross-year | COMPLETED_AND_VERIFIED | pgtest activity window (`2025-12-31 → 2026-01-01`) |
| CP10 pages + 10/20/50, newest first | COMPLETED_AND_VERIFIED | pgtest paging; E2E step 6 |
| CP11 new entry on page 1, queue order untouched | COMPLETED_AND_VERIFIED | activity refreshes on `rcc:action-done`; priorities oldest-first |
| CP12 queue counts match Tech Queue | IMPLEMENTED_NOT_VERIFIED | reads `queueSummary` (QueueService needs the query builder → CI); harness counts SQL |
| CP13 service explanation from real catalogue | IMPLEMENTED_NOT_VERIFIED | existing explainer unchanged; Book preview uses real name / minutes / price (pgtest) |
| CP14 Find Open Times excludes breaks / holds | IMPLEMENTED_NOT_VERIFIED | existing availability path unchanged (needs builder) |
| CP15 concurrent booking cannot double-book | COMPLETED_AND_VERIFIED (DB) | database exclusion `pos_tech_appointments_no_overlap` refused the move in pgtest + E2E; claim race spec |
| CP16 booking review: customer, service, time, price | COMPLETED_AND_VERIFIED | pgtest "book: real catalogue…" |
| CP17 / CP18 SMS-verified booking pending / hold expiry | IMPLEMENTED_NOT_VERIFIED | verify step reports `pending_verification`; guide 10 covers the holds |
| CP19 booking committed through the backend; real ID | COMPLETED_AND_VERIFIED (with stated fake) | confirm returns the persisted appointment id |
| CP20 reschedule revalidates; failure keeps original | COMPLETED_AND_VERIFIED | pgtest + E2E step 3 |
| CP21 reminders follow the move exactly once | IMPLEMENTED_NOT_VERIFIED | guide 14 keys reminders by date/time; not re-run here |
| CP22 cancel needs reason + review + confirm; no refund | COMPLETED_AND_VERIFIED | pgtest + E2E step 2 |
| CP23 duplicate cancel idempotent | COMPLETED_AND_VERIFIED | race spec (8 at once → 1) |
| CP24 SMS preview cannot send; consent / number validated | COMPLETED_AND_VERIFIED | pgtest + E2E step 4 |
| CP25 accepted / delivered / failed / unknown distinct | COMPLETED_AND_VERIFIED (states) / BLOCKED_EXTERNAL (live callbacks) | verify mapping; live Twilio reports external |
| CP26 retries deduplicated, opt-outs respected | COMPLETED_AND_VERIFIED | race spec (6 reviews → 6 sends); opt-out refused |
| CP27 settings persist; API refuses disabled actions | COMPLETED_AND_VERIFIED | pgtest switches + fail-closed |
| CP28 expired AI subscription blocks execution | IMPLEMENTED_NOT_VERIFIED | `@RequiresAiPackage` guard (observe mode by default — enforcement is a platform switch) |
| CP29 overlay: history, Close, Booking | COMPLETED_AND_VERIFIED | pgtest + E2E step 7 |
| CP30 duplicates need human review | COMPLETED_AND_VERIFIED | review-only list unchanged; no merge path |
| CP31 priority assistant from real sources | COMPLETED_AND_VERIFIED | pgtest priorities |
| CP32 AI proposal cannot silently act | COMPLETED_AND_VERIFIED | pgtest + E2E step 8 (review only, nothing written) |
| CP33 health per dependency, no send / booking | COMPLETED_AND_VERIFIED | pgtest + E2E step 5 |
| CP34 AI phone empty vs not-ready not conflated | IMPLEMENTED_NOT_VERIFIED | existing panel unchanged; health "Twilio sender" separates not-configured |
| CP35 server-side tenant / role denial | COMPLETED_AND_VERIFIED | pgtest isolation + role-blocked prepare |
| CP36 malicious note / transcript cannot override permissions | COMPLETED_AND_VERIFIED (by design) | actions run only from the reviewed structured payload + sealed token; no text is executed |
| CP37 realtime / fallback without duplicates | IMPLEMENTED_NOT_VERIFIED | 45 s strip refresh; no new realtime event |
| CP38 audit: actor, tenant, target, prepare/confirm, outcome | COMPLETED_AND_VERIFIED | ledger row (actor, payload hash, summary, state, error) + spine audit |
| CP39 CI type-check / unit / UI | IMPLEMENTED_NOT_VERIFIED | needs CI |
| CP40 staging end-to-end Book / Reschedule / Cancel / Text | BLOCKED_EXTERNAL | no staging access; harness used a raw-SQL booking fake and the test sender |
| CP41 physical touchscreen | BLOCKED_EXTERNAL | — |
| CP42 flag rollout / rollback | IMPLEMENTED_NOT_VERIFIED | migration additive with rollback header; retired route has no client |

Harness stubs (stated in `rcc-extra.mjs`): booking create / reschedule / cancel are raw-SQL writes (BookingService needs the
Kysely query builder), texts go to a test sender, the queue is counted from today's appointments.

## Rollback

Revert the commit; run the rollback in the migration header. The ledger keeps working for the old route if it is restored
(`ok` keeps its meaning; `state` is additive).

## Handoffs

* **AI Calendar (25):** Find Open Times / availability and hold expiry belong there; prepare already re-reads conflicts.
* **AI Follow-Ups (26):** priority items "callback needed" can feed its queue.
* **AI Center (27):** entitlement and usage counters (80/90/100% alerts) are not shown here.

## Owner decisions (DECIDED Oct 31 2026, 17:19)

1. **Front Desk confirms Copilot cancels: YES.** No permission change was needed. The default FRONT_DESK grants already hold both checks a Copilot cancel makes: `reception_copilot.cancel_appointment` (via COPILOT_OPS) and `pos.booking.cancel`, which maps to `booking.manage` (via POS_MANAGE). Nothing in the POS hides the action. A tenant DENY override can still remove it per salon. Proven by the pgtest "Front Desk confirms a Copilot cancel with its DEFAULT role grants", which uses the real `ROLE_PERMISSIONS.FRONT_DESK`.
2. **An expired AI package BLOCKS Copilot actions: YES.**
   - **Mechanism:** a new handler marker, `@EnforceAiPackage()` (in `ai-entitlement.guard.ts`). `routeEnforcementMode()` raises the platform default `observe` to `enforce` on marked routes only.
   - **Marked routes:** `pos/ai/copilot-center/actions/prepare` and `actions/confirm`, plus `tenant/ai/center/copilot/hold` and `copilot/hold/release`.
   - **Unchanged:** every other AI route keeps the platform mode. The global `AI_ENTITLEMENT_ENFORCEMENT=off` kill switch still wins, and a DB lookup failure still fails open, because a timeout is not an expired package.
   - **Refusal:** 403 `AI_PACKAGE_REQUIRED`, now registered with English and Vietnamese POS text ("This AI package is not active for your salon. Renew it in Plans & Usage …").
   - **Tests:** guard spec 24/24, including expired→refused, active→allowed, unmarked→observe only, and off wins.
   - **Note:** read-only Copilot routes (overview, search, priorities) and drafting stay in the platform mode.
3. **Review expiry stays 5 minutes: YES.** No change.

## Built Nov 6 2026 (A8 / A16 — Kevin: "continue finish all")

- **Name pickers.** Check for Conflicts asks for a technician name and Cancel asks for a customer name, phone or date. Both search
  with the scoped search and pass the chosen record's ID. Nothing is picked automatically, and a pasted ID still matches.
- **URL filters.** The workspace tab, search scope, search words, page and page size are saved in the address
  (`rctab`, `rcscope`, `rcq`, `rcpage`, `rcsize`).
- **Who fixes it.** Every Check Copilot System part names who is responsible for fixing it (`CC_RESPONSIBLE`):
  - Owner: package, switches, Twilio.
  - Manager: roles, booking data.
  - Front desk: customer lookup, queue.
  - AIPowerSalon support: background tasks.
- **Tabbed workspace.** The tabs are All, Front desk, Actions, History & search and Settings. "All" is the default and keeps the
  one-page view salons use today; nothing was removed. The chosen tab is saved in the address (`?rcview=`).
- **Texts search scope.** Finds sent SMS by their words, by the recipient's phone digits, or by the provider or notification ID.
  The number is masked, results are newest first, and only this salon and branch are searched.
- **Tests:**
  - `reception-copilot-center.pgtest` (15)
  - `POSReceptionCopilotScreen.test` (19)
