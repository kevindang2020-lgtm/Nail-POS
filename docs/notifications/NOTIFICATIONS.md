# Customer Notifications — build handoff (guide 8 of 15)

Guide: *AI PowerSalon Customer Notifications Complete Build Guide* (30 Oct 2026). Route kept: `/tenant/communications/notifications`
(Communications → Customer Notifications). Migration **741_customer_notifications.sql** (additive; applied to the local `aps`
test template only). Built 31 Oct 2026; nothing pushed, deployed or sent. The only "provider" used anywhere is the fake
Twilio of the test harness and the pgtests.

Status words (guide §16): **COMPLETED_AND_VERIFIED** (built + executed here) · **IMPLEMENTED_NOT_VERIFIED** (built, needs CI /
staging) · **BLOCKED_EXTERNAL** (needs an outside account / approval / device) · **NOT_IMPLEMENTED**.

## 1. Repository inventory (what existed, what was reused)

| Thing | Where | Used as |
|---|---|---|
| The one message ledger | `notifications` (one row per send attempt: status, provider id, provider status / error code, delivered_at, purpose) | the attempt record; a resend is a NEW row with `retry_of_notification_id` |
| The one send path | `NotificationsService.sendSms` (TENANT_MESSENGER) / `.send` | the ONLY way a resend reaches a customer |
| Status lifecycle | `NOTIFICATION` machine (`communications-lifecycles.ts`): sent → delivered / failed; monotonic `canMoveToSql` | unchanged; late callbacks still never regress |
| Signed Twilio webhooks | `twilio-inbound.service.ts` (inbound STOP/START/HELP + status callbacks, per-tenant signature check) | callbacks now also land in `notification_delivery_events` |
| Opt-out state | `notification_opt_outs` (checked by every sender) | current state; history added beside it |
| Messaging readiness | `TenantMessagingReadinessService` (Phone & Messaging guide) | health panel + "Check health" (no copy of its tables) |
| Owner alerts | `owner_alerts` + `OWNER_ALERT` machine + `/owner/alerts/:id/acknowledge|resolve` | messaging incidents (category `messaging_failure`) |
| Old screen | `POSNotificationsScreen.tsx` (last 50 rows + opt-outs + staff "Re-subscribe") | rebuilt in place |

## 2. P0 — the failures in the reference photo (§08)

The production rows are **not** in this workspace (no production access, by design). The photo is legible enough to read
five failure rows; the sixth counted by the card is cut off. Each was reproduced with the same provider text in tests and
classified by evidence:

| # | Photo row (masked) | Provider text (as shown) | Family / root cause | Code fix | Resend | Still true in production? |
|---|---|---|---|---|---|---|
| 1 | Oct 22 · •••9622 | "authentication failed, auth token is not valid for account AC…" | `auth` — the credentials used do not belong to / are not valid for that account | text now stored sanitized; Twilio's code (20003) is kept (`SmsProviderError.providerCode`) | blocked until Messaging Setup is re-checked after the failure (`NOTIFICATION_RETRY_SETUP_NOT_FIXED`) | **BLOCKED_EXTERNAL** — run the Phone & Messaging health check on staging/production |
| 2 | Oct 19 · 7876299624 | "Permission to send an SMS has not been enabled for the region indicated by the 'To' number: 7876299624" | **not a geo-permission problem**: the number has no `+country code`; Twilio read the leading `7` as country code +7 and refused that region. The same customer's `+917876299624` rows were Sent. | **real defect fixed**: `sendSms` (receipts, reminders, follow-ups, inbox) never validated E.164 — a non-E.164 number is now `blocked` / `invalid_destination` and never reaches the provider; the number is never guessed or rewritten | never (fix the customer's number) | COMPLETED_AND_VERIFIED in code; the bad customer record must be corrected by the salon |
| 3 | Oct 19 · 7876299624 | same as 2 | same as 2 | same | never | same |
| 4 | Oct 15 · +91…(legible part only) | region refusal for an E.164 number | `geo_permission` — India (or that region) not enabled in the salon's Twilio Geo Permissions | none needed (account setting); never changed automatically | never from here | **BLOCKED_EXTERNAL** — owner enables the region in Twilio (paid / compliance decision) |
| 5 | Oct 15 · +1800000000x | "invalid 'To' phone number" | `invalid_destination` (a placeholder / toll-free test number) | none (correct refusal) | never | history only |
| 6 | not legible in the photo | — | — | — | — | needs the production row id |

Historic rows are **never rewritten**: their category, sanitized text and resend policy are derived at read time
(`notification-failures.ts`). "All Systems Operational" in the sidebar is the platform's own status — the page now shows
separate Twilio / sender / registration / webhooks / email / provider-report states (§04).

## 3. What was built

**Backend**
- `modules/communications/src/notifications/notification-failures.ts` — pure rules: failure families by Twilio code → our reason
  word → provider text (`auth`, `geo_permission`, `invalid_destination`, `opted_out`, `registration`, `sender`, `carrier_filtered`,
  `over_limit`, `not_configured`, `rate_limit`, `transient`, `email_bounce`, `email_sender`, `unknown`), resend policy
  (never / after_fix / allowed), sanitizer (SIDs, phones, emails, tokens), display state (Sent ≠ Delivered; 24 h without a
  report = Unknown), alert rules (§12 defaults, salon-configurable, clamped).
- `customer-notifications.ts` + `.controller.ts` + `.module.ts` — `pos/customer-notifications/*`:
  `GET summary` · `GET records` (search name / phone digits / email / notification id / provider SID / receipt number / source id;
  tabs; type; branch; date basis created / delivered / last provider report; salon-local inclusive days; 10/20/50; newest first) ·
  `GET records/:id` (identity, masked/unmasked by permission, timing, sanitized diagnosis, provider events, attempt chain,
  resend requests, links; audited when the full recipient/body is shown) · `POST records/:id/retry` (Idempotency-Key, confirm) ·
  `GET failures` (grouped by root cause) · `GET opt-outs` (current + history) · `GET customers/:id/timeline` ·
  `GET health` · `POST health/check` (the readiness check — sends nothing) · `GET incidents` · `GET|PUT alert-settings`.
- Re-subscribe stays on the ONE existing route `POST /pos/notifications/opt-in`, now with the consent rules below.
- `MessagingIncidentsJob` — every 5 min, `reconciliation` job class, single owner; `CUSTOMER_NOTIFICATION_ALERTS=off` stops it.
- Send path: `sendSms` refuses non-E.164 (P0); the Twilio sender keeps Twilio's error code (`SmsProviderError`); failure text is
  sanitized before it is stored; branch + source (appointment / ticket / thread / retry / manual) recorded on new rows
  (receipts, reminders, inbox, staff sends); verified callbacks are kept append-only (`notification_delivery_events`, deduped,
  `applied` says whether it moved the row; queued/sending callbacks are kept as freshness evidence).
- Consent: every opt-out / opt-in writes `notification_consent_events` (source: customer STOP / START, staff with a consent note,
  phone change, system, legacy backfill). A customer's STOP (or one carried from their previous number) can only be undone by
  the customer texting START (`NOTIFICATION_OPTIN_CUSTOMER_STOP`); any other staff re-opt-in needs a consent note
  (`NOTIFICATION_OPTIN_NOTE_REQUIRED`). The old "Re-subscribe" button that silently overrode a STOP is gone; the old
  Messages screen now links to this page for re-subscribing.
- Resend rules (§10): only failed / blocked rows; not marketing (Campaign Center), not one-time codes, not older than 3 days,
  never to an invalid recipient, never to an opted-out recipient, never when the customer's current contact changed, setup
  families only after the readiness check passed AFTER the failure; one successful resend per row (DB unique index), same
  request id replays the same answer; refusals are recorded and audited.
- 18 new error codes (EN + VI POS text).

**Database (741)** — `notifications` + `branch_id`, `source_type`, `source_id`, `retry_of_notification_id` (+ 6 indexes) ·
`notification_delivery_events` (append-only) · `notification_consent_events` (append-only, existing opt-outs backfilled as
`legacy_backfill`) · `notification_retry_requests` · partial unique index: one OPEN `messaging_failure` alert per dedupe key.
Rollback: drop the three tables + the index; the columns are nullable and ignored by older code.

**POS** — `POSNotificationsScreen.tsx` rebuilt in place (EN/VI `ns/custnotif.*`): six KPIs (Sent / Delivered / Failed / Blocked /
Pending (+Unknown) / Opt-Outs) with the window, basis, zone and definitions; the old two cards' meaning kept as a legacy line;
server search (never in the URL) + month calendar + basis; tabs incl. Pending / Unknown / Opt-outs; numbered pages 10/20/50;
details overlay with Close, sanitized diagnosis, provider reports, attempt chain, safe links (customer, booking, SMS
conversation, reminders, follow-ups, the fix) and a confirmed one-time Resend; Review Failures; customer timeline (SMS,
email, inbound replies, appointments, reminder attempts, follow-ups, receipts — one customer only, shared phones not merged);
messaging health; messaging alerts (acknowledge / resolve through the existing owner-alert lifecycle); alert settings;
opt-outs current + history with the consent-note dialog.

## 4. Metric semantics (§05)
Sent = accepted by the provider (`sent`, `delivered`, or a carrier failure after acceptance) — never "delivered". Delivered = a
provider delivery report. Failed / Blocked separate. Pending = accepted < 24 h ago with no report; Unknown = accepted ≥ 24 h
ago with no report (never green). Test sends (`simulated`, development mock) are listed but not counted as Sent. Opt-Outs =
current suppressions (all time) + new in the window. Delivery rate only when every accepted message has a provider outcome.
Counts are distinct ledger rows (never callbacks / attempts), salon-scoped, branch when chosen.

## 5. Tests (31 Oct 2026, ~07:05 UTC, cloud workspace, PostgreSQL 16 `aps` through 741)

| Suite | Command | Result |
|---|---|---|
| Pure rules (six-failure texts, codes, sanitizer, states, alert rules) | `FST_PG_TEMPLATE=aps REPO_ROOT=$PWD bash tooling/full-system-test/unit-standin/run.sh $PWD modules/communications/src/notifications/notification-failures.vitest.spec.ts` | 14/14 |
| Customer Notifications pgtest (P0 send path, KPIs, search, salon-zone / DST days, pages, masking + audit, callbacks, failures, resend + refusals, opt-out rules + history, timeline, alerts, health) | same runner, `customer-notifications.pgtest.vitest.spec.ts` | 18/18 |
| Real-Postgres race, 4 sessions (6 concurrent resends → 1 text; 8 duplicate callbacks → 1 evidence row; 4 evaluator ticks → 1 incident) | `PG_RACE_URL=postgres://postgres@127.0.0.1:55432/<db> … customer-notifications.postgres-race.vitest.spec.ts` | 3/3 — with the row lock removed, the resend race FAILS (mutation check) |
| Browser E2E (Chromium; real controllers + SQL; fake Twilio) | `node tooling/catalog-one-screen/interact.mjs cn-e2e cn` | 12/12, twice; screenshots `tooling/catalog-one-screen/results/cn-e2e/` |
| Combined marketing + notifications E2E | `interact.mjs mkt-combined seg,cp,do,promo,cc,mg,mt,cn` | 103/103 |
| SMS Inbox E2E | `interact.mjs inbox-e2e inbox` | 17/17 |
| Regression | notifications-core (updated: staff re-opt-in needs a note) 30/30 · inbox pgtest 19/19 · message-templates 17/17 · campaign-center 14/14 · segments 13/13 · customer-phone 9/9 · reminders-service-core 27/27 · reminder-core 14/14 · reminder ladder / push / 400 · twilio-tenant-binding 11/11 · sender tests · notifications package tests | all pass |
| Unchanged environment failures (identical on the untouched HEAD in a separate worktree) | customer-phone-flow 4/35 · twilio-inbound.vitest 0/11 · twilio-webhook-dedupe 3/4 · messenger-events 1/4 · sms-segments 0/5 | need CI (query builder / module set) |
| Default harness sections | `interact.mjs default-regress` | 77/85 — the same 8 Services / Pricing / Categories / Team-round-2 steps fail identically on the untouched HEAD (not this work) |

Gates (61 `check:*`): **51 pass** via `npm run`, **6 pass** via the stand-in (sql-prepare 0 schema errors, types drift 857 tables,
sql-identifiers, db-ownership 857, unique review, actor-stamp 364), **4 can't run here** (lint, boot, api-contract,
strict-bodies-types — packages not installable here; CI). This build's own first run failed tenant / unreached / dead-client /
silent-catch / list-queries / response-exposure; all six were fixed, not baselined.

## 6. Acceptance checklist (§17)

| Item | Status | Evidence |
|---|---|---|
| Screenshot modules, counters, fields, sidebar, top controls remain | COMPLETED_AND_VERIFIED | E2E step 1 (legacy line, columns, tabs) |
| 27-inch shell at 100%, no sideways scroll | IMPLEMENTED_NOT_VERIFIED on the device; COMPLETED_AND_VERIFIED in Chromium 1920×945 / 1366×768 / 1280×720 / 1024×768 | E2E step 12; physical ASUS = **BLOCKED_EXTERNAL** |
| Sent / Delivered / Failed / Blocked / Pending / Opt-Out accurate + scope-labelled | COMPLETED_AND_VERIFIED | pgtest KPIs; E2E step 1 (= DB) |
| Six visible failures investigated + classified with evidence | COMPLETED_AND_VERIFIED for the 5 legible rows' text; production rows BLOCKED_EXTERNAL | §2 table |
| Name / phone / email / booking / message ID search across all records | COMPLETED_AND_VERIFIED | pgtest search; E2E step 3 |
| Month From/To calendar, salon zone, date basis | COMPLETED_AND_VERIFIED | pgtest (Oct 9/10 boundary, DST Nov 1); E2E step 4 |
| Previous \| 1 \| 2 \| 3 \| Next + 10/20/50, newest first | COMPLETED_AND_VERIFIED | pgtest pages; E2E steps 3–4 |
| Detail overlay with customer, message, events, reason, safe actions, Close | COMPLETED_AND_VERIFIED | E2E steps 2, 5, 12 |
| Delivery states reflect provider evidence; unknown stays unknown | COMPLETED_AND_VERIFIED (SMS); email delivery reports **NOT_IMPLEMENTED** (no email webhook exists — shown as Unknown, "not connected") | pgtest callbacks; health |
| Opt-outs, unsubscribe, suppression, valid re-opt-in enforced | COMPLETED_AND_VERIFIED | pgtest; E2E step 8 |
| Smart Failed Notification Recovery | COMPLETED_AND_VERIFIED | pgtest + race + E2E steps 5–6 |
| Unified Customer Notification Timeline | COMPLETED_AND_VERIFIED | pgtest; E2E step 7 |
| Automatic failure alerts (dedupe, ack/resolve, cooldown, audit) | COMPLETED_AND_VERIFIED for detection / dedupe / cooldown; acknowledge/resolve reuse `/owner/alerts/*` (not served by the harness → IMPLEMENTED_NOT_VERIFIED in the browser) | pgtest + race + E2E step 10 |
| Booking / SMS Inbox / Email / Reminders / Follow-Ups navigation | COMPLETED_AND_VERIFIED (links); Booking screen APIs not served by the harness | E2E steps 5, 7 |
| Tenant isolation, permissions, masking, credential security, audit | COMPLETED_AND_VERIFIED | pgtest (other salon 404 / invisible, view-only masked, audit rows); tenant gate |
| CI, staging, migration, screenshots; device status honest | IMPLEMENTED_NOT_VERIFIED (CI / staging) | §5 |

## 7. Not verified / blocked
- **IMPLEMENTED_NOT_VERIFIED (CI):** POS + API type-checks; `POSNotificationsScreen.test.tsx` (rewritten; the old `.403` test was
  folded in); the 4 gates above; the suites listed as environment failures.
- **BLOCKED_EXTERNAL:** the production rows behind the photo (ids, current account state); real SMS / email sends and real
  provider callbacks on staging (only authorized test numbers, after the owner approves); enabling a region in Twilio Geo
  Permissions; the physical ASUS 27″ at 100% zoom; migration 741 on staging / production (owner approval).
- **NOT_IMPLEMENTED:** email delivery / bounce webhooks (no email event source exists — email stays Unknown and the health panel
  says so); SMS / email escalation of alerts (in-app owner alerts only, as the guide's baseline); a recipient export.

## 8. Hand-offs to the next guides
| Guide | What it can use now |
|---|---|
| Phone Number Management | `invalid_destination` + `missing_country_code` rows link to `/tenant/customers/phone-management`; phone change already writes a `phone_change` consent event |
| Booking Phone Verification | account / OTP texts are never resent from here (`NOTIFICATION_RETRY_ACCOUNT_CODE`); OTP verification is never treated as marketing consent |
| Text Messaging Setup | the `auth` / `sender` / `registration` / `not_configured` families point to Messaging Setup; resend waits for its health check |
| End-of-Day Follow-Ups / Follow-Up Queue | pass `source: { type: 'follow_up', id }` to `sendSms` so rows link back; timeline already reads `service_follow_up_tasks` |
| Appointment Reminders | reminder sends already record `purpose: 'reminder'` + `source: appointment`; reminder attempts show in the timeline |
| Email | email failures are classified (`email_bounce` / `email_sender`); an email event webhook would feed `notification_delivery_events` the same way |

## 9. Open owner decisions
1. Every POS role (incl. Front Desk and Reception) holds `communications.manage` in the current role policy, so they see full
   contact details and can resend. Keep that, or make Front Desk view-only here (masked, no resend)?
2. Should alert escalation also go by email/SMS to the owner (only when that channel is healthy), beyond the in-app alert?
3. Confirm the resend window (3 days) and the alert defaults (3 same failures / 15 min; > 25 % of ≥ 5 / 30 min; reports
   stopped 24 h; 20 texts waiting > 2 h).
