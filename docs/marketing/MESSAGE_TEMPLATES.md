# Message Templates & Automation Center — guide 7 handoff (31 Oct 2026)

Route `/tenant/communications/templates` (POS → Communications → Message Templates). Built on the salon's EXISTING template store,
extended in place — no second template system, no new sender. Nothing was pushed, deployed or sent; migration 740 is applied to
the local test template only.

## What was found (guide §05 discovery)

| Question | Answer from the code |
|---|---|
| Where do the screen's templates live? | `pos_message_templates` (017a; tenant uuid since 539) via `GET/POST pos/settings/notifications-reminders/templates` (`modules/tenants/src/settings/settings.templates.kysely.ts`). |
| Is "No templates yet" real? | Yes for this salon in the test data — now **verified, not assumed**: DB, API and screen agree (E2E step 1, pgtest P0), and the health check says "verified: the query returned zero rows for this salon". |
| Other template stores? | `message_templates` + `message_template_versions` (183/280): the **Super Admin / platform** store (`{{token}}` syntax), offered beside the salon's own in the SMS Inbox composer. `campaign_templates` (242): Campaign Center's own. `reminder_templates` (282): Super Admin Smart Reminders. None replaced; the salon store is the one this screen owns. |
| Does any workflow consume the salon's templates? | The **SMS Inbox composer** (`inbox.repository.templates`) — but it pasted the raw body: `[name]` / `{name}` were **never filled in** (P0 defect, fixed). |
| How do automations build their text? | Appointment reminders: built-in text (`reminder-core.buildReminderMessage`). Booking reschedule / cancel: hard-coded in `booking.service`. Membership: built-in. EOD follow-ups: technician drafts + manager approval. Campaigns: own approved message. **No booking-confirmation sender exists.** |
| Customer language | `customerMessageLanguage()` returns English for everyone (POSLanguage mandate, 28 Oct): customer messages are English; Vietnamese is the POS staff UI only. The guide does not ask otherwise — no conflict. |

## Implementation (guide §24 "Code change list")

| Area | Files | Status |
|---|---|---|
| Migration 740 (additive) | `apps/api/db/migrations/740_message_templates_center.sql` — `pos_message_templates` + category / subject / description / branch / status / current_version / record_version / created_by / updated_by / timestamps / archived_at / last_used_at; new `pos_message_template_versions` (append-only; existing rows backfilled as v1, `backfilled = true`), `_bindings`, `_usage`, `_tests`. Existing rows: status `active`, `created_at` NULL = "date unknown" (never guessed). Applied twice to the `aps` template (idempotent). Rollback: drop the 4 new tables; older code ignores the added columns. | COMPLETED_AND_VERIFIED (local template); staging/production BLOCKED_EXTERNAL (owner approval) |
| Variables + renderer (pure) | `modules/communications/src/templates/template-variables.ts`: allowlist registry (customer / salon / appointment / follow-up / receipt groups, per category), legacy `[name]` / `{name}` alias, `{{token}}` platform syntax, forbidden tokens (codes, card, pay), category rules, STOP line for marketing SMS, HTML escaping, GSM-7 / UCS-2 segments (`estimateSmsSegments`) | COMPLETED_AND_VERIFIED |
| Service + routes | `templates/message-templates.ts`, `.controller.ts`, `.module.ts` — `pos/message-templates/*`: summary, list (search / filters / date basis / sorts / pages), detail, create, update (optimistic `recordVersion`, new version per content change), duplicate, status (SALON_MESSAGE_TEMPLATE machine; deactivate / archive of a bound template refused unless a valid replacement is confirmed — bindings move in the same transaction), preview (never sends; sample data or a real customer with customer access, audited), test send (separate, `confirm: true`, Idempotency-Key, salon's OWN Twilio only, opt-outs apply, sample data only), connections / connect / disconnect, usage history, health check, render-for-thread | COMPLETED_AND_VERIFIED |
| Lifecycles | `communications-lifecycles.ts`: `SALON_MESSAGE_TEMPLATE`, `MESSAGE_TEMPLATE_TEST` | COMPLETED_AND_VERIFIED |
| SMS Inbox (P0 consumer) | `inbox.repository.ts` (only ACTIVE salon templates, branch scope), `inbox.service.ts` + `inbox.controller.ts` (reply accepts `templateId`; records the usage row with the exact version, text sent, message + notification ids), `POSCommunicationsScreen.tsx` + `posCommunicationsApi.ts` (a picked template is filled in by the server for the conversation's customer) | COMPLETED_AND_VERIFIED |
| Appointment Reminders reads its binding | `reminders.service.ts`, `reminders.module.ts`, `reminders.kysely.repository.ts`, `reminders.repository.ts`, `reminder-core.ts`: an active binding replaces the built-in text; a missing value / unknown token for one customer keeps the built-in text; the SMS keeps the STOP line; each send writes a usage row | COMPLETED_AND_VERIFIED |
| Legacy settings route | `settings.templates.kysely.ts` (versions written, archived refused, list excludes archived), `settings.controller.ts` (writes need `pos.communications.manage`, was `settings.view`; marked DEPRECATED, on the `check:unreached` ledger — owner rule "deprecate, do not remove") | COMPLETED_AND_VERIFIED |
| POS screen | `POSMessageTemplatesScreen.tsx` (rebuilt in place, original form kept), `posMessageTemplatesApi.ts`, `ns/mtemplates.{en,vi}.ts` (252 keys), `ns/commsinbox.{en,vi}.ts`, `ns/errors.{en,vi}.ts`, `styles.css` (`.mt*`) | COMPLETED_AND_VERIFIED (browser); type-check IMPLEMENTED_NOT_VERIFIED (CI) |
| Error codes | 30 codes in `packages/api-contracts/src/errors.ts` + EN/VI text | COMPLETED_AND_VERIFIED |
| Generated | `kysely.types.ts`, `actor-columns.generated.ts`, ownership registry, state vocabularies, openapi manifest, attack surface, owner/tech error catalogs, `unreached-routes.baseline.json` (+2 deprecated routes) | COMPLETED_AND_VERIFIED |

## The three owner upgrades (guide §25)

| Upgrade | What exists | Status |
|---|---|---|
| 1. One-Click Preview & Test | Preview tab: version picker, sample data by default ("Nothing is sent"), real customer search (customer access, audited), SMS encoding / characters / parts. Test Send: typed recipient + explicit tick + one key per intended test → the salon's own Twilio; result Submitted / Recorded only / Blocked / Failed; delivery only from the notifications row. | COMPLETED_AND_VERIFIED |
| 2. Smart Variable Assistant | Searchable palette beside the editor showing only the variables the chosen category can fill; click inserts at the cursor; live server-rendered preview; unknown / forbidden / wrong-category tokens flagged and block activation; `[name]` keeps working. | COMPLETED_AND_VERIFIED |
| 3. Automation Connection Center | Every workflow found in the code with its real text source; only workflows that READ a binding are connectable (today: Appointment Reminders); version strategy latest / pinned; last use; disconnect; a bound template cannot be deactivated / archived without a confirmed replacement. | COMPLETED_AND_VERIFIED for Appointment Reminders; other workflows NOT_IMPLEMENTED (hand-offs below) |

## Tests (31 Oct 2026, ~05:50 UTC)

| Suite | Result |
|---|---|
| `templates/message-templates.pgtest` (P0 create → render with the real customer → Inbox reply records version; validation; versions + conflict; duplicate; archive; preview no-send; test send idempotent / own sender / opt-out / no salon Twilio → blocked; connections; reminders use the binding + fallback; replacement on archive; search / pages / DST calendar; usage search beyond page 1; tenant + branch isolation; health) | 17/17 |
| `templates/message-templates.postgres-race` (real PostgreSQL, 4 sessions: 8 simultaneous saves → 1 wins / 7 conflicts; one Test Send key × 6 → 1 provider call; 6 simultaneous connects → 1 active binding) | 3/3 — with the edit guard removed the save race fails |
| Regression: inbox pgtest 19/19, inbox-core 14/14, reminders (push pgtest 1/1, service-core 27/27, core 14/14, ladder 4/4, language 3/3, 400 1/1, push 5/5), settings-templates 3/3, campaign-center 14/14, segments 13/13, notifications-core 29/29 | all pass |
| Message Templates E2E in Chromium (`interact.mjs mt-e2e mt`: empty state is real, original form creates, assistant + live preview, overlay activate / preview / one test send, conflict → v2, connection + archive protection, **P0 in the real SMS Inbox**, usage history search, pages + calendar, Vietnamese + Technician 403, health, 5 viewports) | 11/11 — `tooling/catalog-one-screen/results/mt-e2e/` |
| Combined marketing E2E (`seg,cp,do,promo,cc,mg,mt`) | 91/91 |
| SMS Inbox E2E (template step now waits for the server-filled draft) | 17/17 |
| Gates: 51 `check:*` via npm + 6 via the stand-in (sql-prepare 0 errors, types-drift 854, sql-identifiers, db-ownership 854, unique-review, actor-stamp) | 57 pass, 0 fail |

## Not verified / blocked (guide §24 "External blockers")

- **IMPLEMENTED_NOT_VERIFIED (needs CI):** POS + API type-check; `POSMessageTemplatesScreen.test.tsx` (rewritten; the `.403` test folded in); gates `lint`, `boot`, `api-contract`, `strict-bodies-types` (packages not installable here). Pre-existing environment limits unchanged: `sms-segments.pgtest`, `communications-list-query.pgtest`, `request-schemas.vitest` need the Kysely query builder / packages.
- **BLOCKED_EXTERNAL:** live SMS / email from a real provider (only the fake Twilio was used; the salon's real Twilio credentials and sender verification are the owner's); email sending needs `SENDGRID_API_KEY` (absent here → health says so); migration 740 to staging / production (owner approval); physical ASUS 27″ at 100% (only browser viewports ran).
- **NOT_IMPLEMENTED (handed off):** booking confirmations (no sender exists — Booking / Booking Phone Verification guides), reschedule / cancel texts, End-of-Day Follow-Ups, missed-call follow-up, membership, receipts reading a binding (each guide can call `resolveBoundTemplate(db, tenant, branch, workflow, channel)` + `recordTemplateUsage(...)`, exactly as Appointment Reminders does); campaign messages from a template (Campaign Center keeps its own approved message); realtime push of template changes (the screen polls with the shared realtime hook's fallback).

## Hand-offs to guides 8–15

| Guide | Use |
|---|---|
| Notifications, Text Messaging Setup, Phone Numbers | the health check already reads the salon's Twilio row (no secret); sending stays in NotificationsService |
| Booking Phone Verification | the six-digit code is NOT a template variable (`{otp}` / `{code}` are refused) — keep it in the Verify service |
| End-of-Day Follow-Ups, Follow-Up Queue | add a bindable workflow key + call `resolveBoundTemplate` / `recordTemplateUsage`; categories `customer_follow_up`, `missed_call_follow_up` and the follow-up variables already exist |
| Appointment Reminders | already reads its binding; lead times, ladder and quiet hours stay in that guide |
| Email | email templates already require a subject and render escaped; `send` goes through NotificationsService |

## Open owner decisions

1. **DECIDED by the owner, Oct 31 2026:** Front Desk keeps FULL control of templates (FRONT_DESK keeps `communications.manage`). No code change.
2. **DECIDED by the owner, Oct 31 2026:** NO second-person approval for changing a template an automation uses. No code change.
3. Still open: the two deprecated settings routes. Retire them once no outside client uses them, or keep them? (The owner's answer was cut off; asked again.)
