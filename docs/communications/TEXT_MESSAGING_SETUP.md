# Text Messaging Setup & SMS Readiness — build handoff (guide 11 of 20, Oct 31 2026)

Route: `/tenant/communications/messaging-setup` (POS, EN + VI staff UI). Built **on top of** the existing Phone & Messaging work
(credentials store 311+, readiness 721, registration sync 725, branch overrides, masked SIDs + audited reveal, two-step number
purchase, confirmed idempotent test SMS) — no second credential store, sender, test path or registration flow.

**First priority (guide p.1): verified.** The Account SID is masked everywhere (`AC…1234`); the Auth Token / API secret is never
returned; "Connected" is only the *Account* part — six parts are judged independently, and the E2E shows a Connected account
with Registration **Pending** and overall **Attention required**, never Ready.

## What was built (guide §25 owner priorities)

| # | Priority | Implementation |
|---|---|---|
| 1 | One-click SMS Health Check | "Check SMS System" (the existing read-only `POST tenant/messaging/health-check`) + a **six-part panel**: Account · Sender · Registration (10DLC or toll-free, never both) · Inbound (only a signature-verified inbound webhook makes it Ready) · Delivery (status callback configured AND reports arriving; failures in 24 h; texts waiting > 2 h ⇒ Unknown) · Booking Verify (separate from texting; "Off" is a salon choice, not an error). Each part: state (Ready / Attention required / Pending / Failed / Unknown / Off), evidence, source, time, exact next action, link to the card that fixes it. Controlled **nightly** read-only run (env `MESSAGING_HEALTH_SCHEDULE_ENABLED`, **OFF by default**): one job per salon per salon-local night (02:00–05:00), records a `scheduled` check, opens/updates ONE de-duplicated owner alert per failing part (`owner_alerts`, category `messaging_failure`, `dedupeKey sms_setup:<part>` — the Customer Notifications incidents list acknowledges/resolves it). Never sends, buys, registers or changes a credential. |
| 2 | Messaging Setup Wizard | 7 steps (scope → connect → number → registration → webhooks → booking verify & test → summary) derived from the same evidence; resumes at the first unfinished step; "Go to this step" opens the EXISTING card (manual/advanced setup untouched); a pending/skipped registration or approval is never "Done"; the summary stays "Not complete" while anything is open. |
| 3 | Branch-level number management | "Branch senders": every branch the actor may act for — inherited vs own Twilio, masked account, sender + type, registration and the six part states; "Configure" switches the page's existing scope selector to that branch (branch tests already use the branch's effective config, PM-01). Precedence shown: platform prohibition > salon setting > branch's own Twilio > salon default > Setup Required. |
| — | §14–§16 history | "Setup history": test texts, health checks, registration checks, number quotes/purchases. Server search (sender, last 4 of the masked recipient, provider id, error code, record id) — stored secrets are never selected so they can't be searched; kind / status / branch filters; Today/Week/Month/Year/Custom month calendar with date basis (created / last status change / delivered) on salon-local inclusive days (DST-safe in Postgres); newest first (`created_at DESC, id DESC`); Previous 1 2 … Next with 10/20/50 and an exact total; View detail overlay with Close. Search text stays in component state (never the URL). |
| — | §10 test text | Editable test text (plain, ≤ 160 chars; control characters refused `TEST_SMS_TEXT_INVALID` before any send); cost shown as **Cost unavailable** (no per-message rate is configured — nothing invented). Confirmation + idempotency key + readiness gate + hourly limit unchanged. |

## Code & migrations

- **Backend (new):** `modules/communications/src/tenant-messaging/messaging-setup-center.ts` (six parts, wizard, delivery evidence, branches, activity union, detail, nightly dispatcher/job, de-duplicated alerts) · `messaging-setup-center.controller.ts` (`GET tenant/messaging/setup/{overview, overview/branches/:id, branches, activity, activity/:kind/:id}`, settings.view; `MessagingHealthScheduler`).
- **Backend (changed):** `tenant-messaging-readiness.service.ts` (`healthCheck(..., { trigger })` — only MANUAL checks are rate-limited) · `messaging-health.ts` (trigger `scheduled`) · `tenant-messaging-credentials.service.ts` (`testMessageText`, `DEFAULT_TEST_TEXT`) · `tenant-messaging.tenant.controller.ts` + `request-schemas.ts` (`message`) · `tenant-messaging.module.ts` · `errors.ts` (+3 codes: `TEST_SMS_TEXT_INVALID`, `MESSAGING_SETUP_INVALID_FILTER`, `MESSAGING_ACTIVITY_NOT_FOUND`).
- **Migration `744_text_messaging_setup_center.sql`** (additive): `ck_tmhc_trigger` accepts `scheduled`; five history indexes. Applied twice to the local `aps` template only. Rollback: the widened CHECK accepts every old value; DROP INDEX is safe.
- **POS:** `screens/messagingSetupCenter.tsx` (new) · `POSMessagingSetupScreen.tsx` (panel, wizard button, Check SMS System label, branch senders, history, test text + cost) · `api/posMessagingSetupApi.ts` (new) · `api/posPhoneApi.ts` (`testSms(..., message)`) · `i18n/ns/smssetup.{en,vi}.ts` (new) · `ns/errors.{en,vi}.ts` · `ns/index.ts` · `styles.css`.
- **Harness:** `comms-extra.mjs` (setup controller routes + 14 seeded history texts) · `interact-ms.mjs` (new) · `interact.mjs` (section `ms`).

## Tests (31 Oct 2026, this workspace; stand-in runner + PostgreSQL 16 + Chromium)

| Suite | Result |
|---|---|
| `messaging-setup-center.pgtest` | **14/14** — six parts (nothing configured; Connected ≠ ready; inbound only from a verified webhook; delivery attention/pending/unknown/ready), wizard resume + summary blocked, test text ≤ 160 / control char refused before send, history (page sizes, newest first, search beyond page 1 by last 4 and by provider SID, kind/state/branch filters, delivered basis, invalid filters), salon-local day edge (23:30 New York = Oct 20), tenant isolation incl. detail, branch-confined actor (hidden rows, 403 on another branch), branch senders, nightly run (not rate-limited, one alert per failing part, re-run updates), foreign-tenant job refused, dispatcher once per salon-local night |
| `messaging-setup-center.postgres-race` (real Postgres, 4 sessions) | **1/1** — 8 concurrent raises → exactly one open alert per failing part, none fails; **mutation**: without the `on conflict` guard it FAILS |
| Regression | phone-messaging-readiness 31/31 · round2 28/28 · credentials 10/10 · number-isolation 6/6 · tenant controller 9/9 (expectations updated for `message`) · controller 4/4 · tenant-messaging 8/8 · customer-notifications 18/18 · booking-verification-center 14/14 · phone-center 13/13 · message-templates 17/17 |
| Browser `ms` (Chromium, 5 sizes, EN/VI) | **8/8** |
| Combined browser run `seg,cp,do,promo,cc,mg,mt,cn,pm,bv,ms` | **130/130** (one known harness page error "not in the harness", as before) |
| Browser `comms` (existing) | 11/12 — the failing step ("dashboard renders in VI", expects "Trung tâm", gets "Quản lý số điện thoại") **fails identically on the unchanged HEAD** (verified by stashing this work and re-running) — pre-existing, not touched here |
| Gates | 51 `check:*` via npm + 6 via the stand-in (sql-prepare, types-drift 857 tables, sql-identifiers, db-ownership, unique-review, actor-stamp) — **all pass**; 4 can't run here (lint, boot, api-contract, strict-bodies-types) |

## Status (guide §26 words)

| Item | Status |
|---|---|
| Six-part readiness, Check SMS System, wizard, branch senders, history, test text | **COMPLETED_AND_VERIFIED** (pgtest + real-Postgres race + browser E2E in this workspace) |
| POS type-check, `POSMessagingSetupScreen.test.tsx`, lint/boot/api-contract/strict-bodies-types | **IMPLEMENTED_NOT_VERIFIED** — need CI (no npm registry here) |
| `platform-messaging-provisioner.pgtest` | 0/11 here — the test shim lacks `mockClear`; spec and code unchanged by this work → CI |
| Nightly health run in staging | **IMPLEMENTED_NOT_VERIFIED** (OFF by default; enabling it is an owner/ops decision) |
| Real carrier (10DLC / toll-free) approval, real delivery reports, real inbound webhook, live test text, number purchase | **BLOCKED_EXTERNAL** — need the salon's real Twilio account, paid registration approval and owner authorization; only the fake Twilio was used |
| Physical ASUS 27" at 100% zoom | **BLOCKED_EXTERNAL** — browser viewports 1920×945, 1536×864, 1440×900, 1366×768, 1024×768 only |
| Migration 744 on staging / production | **BLOCKED_EXTERNAL** — owner approval |

## Hand-offs to later guides

- **14 Appointment Reminders / 12–13 Follow-Ups:** read the same six parts (`GET tenant/messaging/setup/overview`) before promising sends; the Delivery part already counts failed customer texts in 24 h.
- **15 Email:** an Email readiness panel can follow the same part model (`ReadinessPart`).
- **20 AI Center:** can link "Check SMS System" results; nothing here calls an AI provider.

## Open owner decisions

1. Turn on the nightly read-only health run (`MESSAGING_HEALTH_SCHEDULE_ENABLED=on`)? It makes read-only Twilio API calls per salon per night.
2. Is there an approved per-message SMS rate to show as the test text's estimated cost? Until then it says "Cost unavailable".
3. Booking Verify "Off" is shown as a salon choice (not an error). Confirm, or should Off be "Attention required"?
