# Communications / SMS Inbox (`/tenant/communications/sms`): handoff, 2026-10-30

Guide: *AI PowerSalon, Communications Full Claude Build Guide (Updated)*, including Addendum §4.1 Unified Customer Conversation History, §4.2 Unread & Follow-Up Priority and §4.3 One-Click Reply & Booking.
Branch `merge-github-main`. Committed locally only. **Not pushed** (owner rule: no push before K-12 steps 1–5).

Status words follow guide §20: **Verified Complete** (built and proven by tests or browser runs in this workspace), **Implemented / Not Verified**, **Blocked by External Setup**, **Not Implemented**.
"Verified" here means *verified in the local workspace* (Postgres 16 + browser harness). CI, staging and the physical 27-inch ASUS test have **not** been run. See §6.

---

## 1. What changed for the salon

| Before | After |
|---|---|
| Replying recorded the message as "sent" but **never actually sent a text**. | Reply goes through the salon's own Twilio sender (the same send path as reminders): readiness gate, opt-out check, one message per Send even on a double click. The salon sees the real delivery state (Submitted → Delivered/Failed) from Twilio's signed callback. |
| A normal customer text (anything other than STOP/HELP/START) was **dropped**. | Every verified inbound text lands in the inbox (keywords too). It is matched to a customer only when exactly one customer in that salon has the number. Otherwise it stays an Unknown Contact or a possible match and is never linked by guess. |
| One flat list; no search, no paging, no priority. | A split inbox with one search box (name, phone in any format, email, customer id, message text), filters, a monthly From/To calendar in the salon's time zone, pages of 10/20/50, and 4 sorts: Newest, Unread first, Longest unanswered, Follow-up due. |
| No customer history. | A Timeline tab joins SMS, email, reminders and notifications, review requests, AI-call summaries, AI follow-ups and appointments in time order, with channel tags and no duplicates. |
| Not live. | New texts and delivery updates arrive live. A draft, the open conversation and the scroll position are never disturbed. |
| English only. | Full Vietnamese (248 keys, `ns/commsinbox.vi.ts`). |

## 2. Feature status (guide §20 template)

| Feature | Status | Evidence |
|---|---|---|
| Full-screen / scroll | **Verified Complete** (browser harness). Physical 27-inch: **not tested** | 20/20 layout measurements PASS at 1920×945, 1536×729, 1440×765, 1366×633 in EN, VI and empty: no horizontal overflow, list and thread scroll on their own, lower modules reached by page scroll (`measurements-list.json`, `measurements-thread.json`, `screens/`) |
| Inbox usability: list, details, persistent composer, empty state | **Verified Complete** | E2E steps 1, 5, 16; pgtest "KPIs …" |
| Unified history (§9.1 / Addendum 4.1) | **Verified Complete** for SMS, notifications/reminders, review requests, AI-call summaries (only when the transcript is retained), AI follow-ups and appointments. **Email entries: Blocked by External Setup** (inbound email is not configured, so only outbound email notifications appear) | pgtest "joins the canonical records chronologically…"; E2E step 5 |
| Unread / priority (§9.2 / Addendum 4.2) | **Verified Complete**: Unread first, Longest unanswered, Follow-up due, Newest; waiting time with urgency bands; mark read/unread; assign; follow-up date | pgtests "Oldest Unanswered…", "a new customer text moves that thread to page 1…", "assign / status / follow-up…"; E2E steps 4, 12 |
| One-click Reply & Booking (§9.3 / Addendum 4.3) | **Verified Complete** in the harness. **Live sending: Blocked by External Setup** (needs the salon's Twilio number and carrier registration, and owner approval for live SMS) | pgtests "sends through the salon sender…", "S8", "S9", "S11", "a salon with no sender of its own is refused"; E2E steps 7–10 |
| Search / calendar (§6–7) | **Verified Complete** | pgtests "the shared phone finds only this salon's conversation…", "custom ranges … year end and DST"; E2E steps 3, 13 |
| Pagination (§8) | **Verified Complete** | pgtest "25 threads page 10 / 10 / 5, disjoint, stable"; E2E step 2 |
| KPI / lower modules / 7 quick actions (§4, §11, §12) | **Verified Complete**, with one **Not Implemented** metric: *Rebooking conversion* shows **Unavailable** (no rebooking attribution source exists, so a false 0 % is never shown) | E2E steps 1, 15; activity pgtest 5/5 |
| AI Communication Insights | **Implemented / Not Verified as AI**: the panel is an honestly labelled link to the AI screens. It does **not** generate suggestions, and nothing is sent without staff action | E2E step 1 |
| Safety: consent, provider status, tenant isolation, branch permissions, audit | **Verified Complete** | pgtests "S9", "a branch manager sees their branch…", "the branch number routes to its branch; another salon's number never lands…", "a correctly signed customer text reaches the inbox once; a forged one does not…" |
| Verification: CI / staging / physical device | **Not run**: no CI or staging access from this workspace; the physical ASUS test is the owner's | §6 |

## 3. Acceptance scenarios (guide §18)

| # | Scenario | Result | Proof |
|---|---|---|---|
| 1 | Two salons share a customer phone; salon A search shows only salon A | PASS | pgtest "the shared phone finds only this salon's…"; E2E 3 |
| 2 | 10+ threads; pages 2 and 3 work; a new inbound moves the thread to page 1 under Newest | PASS | pgtests "25 threads…", "a new customer text moves…"; E2E 2 |
| 3 | Inbound arrives while typing; the draft and the open thread stay; the unread mark updates | PASS | E2E 6 |
| 4 | Longest unanswered ranks an old unanswered text above a recent answered one | PASS | pgtest "Oldest Unanswered…"; E2E 4 |
| 5 | The timeline merges SMS, email, reminders and the AI-call summary in order, tagged, with no duplicates | PASS (email = outbound notifications only, see §2) | pgtest "joins the canonical records…"; E2E 5 |
| 6 | Book Appointment opens the existing booking flow with the customer selected; nothing is created until submit | PASS | E2E 10. Only the customer id is passed; an unlinked number must be linked first |
| 7 | Custom From/To across DST and year end uses the salon's local dates | PASS | pgtest "custom ranges include the whole local end day…"; E2E 13 |
| 8 | Twilio reports queued, then failed: the screen never shows Delivered; the event history is kept | PASS | pgtest "S8"; E2E 9 (error 30007 shown) |
| 9 | Unauthorized send denied; opted-out recipient excluded; audit names the actor | PASS | pgtest "S9"; E2E 16 (a technician is refused) |
| 10 | 1920×1080 at 100 % zoom: usable, lower modules reached by scroll, no horizontal overflow | PASS in a browser viewport (1920×945 = 1080 minus browser chrome). **Physical device not tested** | measurements |
| 11 | API or provider down: the screen shows Unknown/Unavailable, never a false zero or green | PASS | pgtest "S11"; activity metrics carry `available:false` |
| 12 | Original modules and the 7 quick actions still work | PASS | E2E 1, 15 |

## 4. What was built

**Database**: `apps/api/db/migrations/730_communications_inbox.sql` (additive; no drops of tables or columns):
- `communication_threads`: `contact_normalized`, `customer_match` (none / exact_phone / manual / ambiguous / legacy), `last_inbound_at`, `last_outbound_at`, `awaiting_reply_since`, `follow_up_due_at`, `record_version`, `closed_at`, plus indexes (including trigram search).
- `communication_messages`: `notification_id`, `provider_message_sid` (unique per salon for inbound), `idempotency_key` (unique per salon), `author_kind`, `media_count`, `error_code`; status values now include `pending` and `blocked`.
- New `communication_thread_events` table (assignment, status, follow-up and link history).
- `notifications.purpose`, which includes `conversation`.
- A bounded backfill of the new columns from existing rows.

**API** (`pos/communications/inbox/*`, all behind `TenantAuthGuard` + `RolePermissionGuard` + feature `communications`):
- `GET` routes: `threads`, `summary`, `templates`, `customers`, `staff`, `threads/:id`, `threads/:id/messages`, `threads/:id/timeline`.
- `POST` routes: `threads/:id/reply` (Idempotency-Key required), `read`, `unread`, `assign`, `status`, `follow-up`, `link-customer`, `conversations`.
- Permissions: `pos.communications.view`, `.send` and `.manage`.
- Every query is scoped to the session's salon and authorized branches. Changes are version-checked (409 on conflict), audited in the same transaction, and status changes go through the state machines (`COMMUNICATION_THREAD`, new `COMMUNICATION_MESSAGE`).

**Legacy routes**:
- `POST pos/communications/threads/:id/reply` now sends for real through the same path.
- `GET threads/:id` and `POST threads/:id/read` were **removed**. No screen called them after the rewrite (`check:unreached`), and the inbox routes replace them.

**Sending**:
- `NotificationsService.sendSms` takes `purpose:'conversation'`, the branch, and `requireOwnAccount`.
- A salon with no sender of its own is refused. The platform's Twilio is **never** borrowed.
- A branch with its own number sends from that number.

**Receiving**:
- `twilio-inbound.service.ts` records every verified inbound text (keywords included, and STOP still opts out).
- A repeated MessageSid is stored once.
- A forged signature is rejected.
- Delivery callbacks update the message and push a live update.

**Live updates**: new event `conversation_updated` (catalog regenerated), sent to the branch room. Salon-wide conversations go to every branch room. The event carries ids only, no message text.

**POS screen**: `apps/pos-web/src/screens/POSCommunicationsScreen.tsx` (rewritten), `commsInboxCore.ts` (pure rules), `api/posCommunicationsApi.ts`, `i18n/ns/commsinbox.{en,vi}.ts`, `.ci-*` styles. Booking returns to the conversation after the appointment is created (`POSNewBookingScreen.tsx`).

**Shared contract**: `packages/api-contracts/src/tenant/communications.ts` adds `InboxPeriod`, `InboxTimelineSource` and `InboxTimelineEvent`, used by both the API and the POS.

**Error codes added**: `INBOX_BRANCH_NOT_AUTHORIZED`, `INBOX_VERSION_CONFLICT`, `INBOX_ASSIGNEE_INVALID`, `INBOX_IDEMPOTENCY_REUSED`, `INBOX_CHANNEL_NOT_SUPPORTED`, `INBOX_BODY_TOO_LONG`.

**Regenerated**: `apps/api/openapi/manifest.txt` (3443 routes), `docs/security/attack-surface-routes.csv` + `SECURITY_ATTACK_SURFACE.md`, `apps/api/db/state-vocabularies.generated.json`, `REALTIME_EVENT_CATALOG.md`.

## 5. Tests actually run (this workspace)

Evidence folder: `docs/handoff/evidence/communications-2026-10-30/`

| What | Result |
|---|---|
| `inbox.pgtest.vitest.spec.ts` (real Postgres) | 19 / 19 |
| `inbox-core.vitest.spec.ts` | 14 / 14 |
| `commsInboxCore.test.ts` (screen rules) | 8 / 8 |
| Communications regression: activity pgtest 5, activity 12, communications 7, tenant binding pgtest 11, webhook counters 1, sender-not-configured 3, notifications core 29, sender numbers 2, messaging metrics 2 | all pass |
| Phone & Messaging pgtests (round 2: 28, readiness: 31), retention round 2 pgtest 14, realtime core 4 | all pass |
| Browser E2E (`interact-inbox.mjs`, real API code over Postgres; Twilio replaced by a fake that records calls) | 17 / 17 PASS (`e2e/results.json`, 10 step screenshots) |
| Layout measurements | 20 / 20 PASS |
| Migration 730 rehearsal on a throwaway copy of the test DB | dry run, re-apply and second re-apply all exit 0; 0 destructive lines (`migration-rehearsal.txt`) |
| Full gate suite (`tooling/ci/run-gates.mjs`) | see `run-gates-full.txt` and §6 |

Notes on the E2E output:
- The single `errors` entry and the `unhandled` list in `results.json` come from the quick-action step. That step opens the *other* real screens (Campaigns, Reminders, AI Receptionist, Reports, Booking), and the one-screen harness does not serve their data. The step checks that each action navigates to its screen, not that those screens load.
- `POST /auth/session-activity` is the idle-timer heartbeat.

Four older specs fail here **both with and without this work**, with identical messages (the stand-in DB has no query builder): `twilio-inbound.vitest`, `twilio-webhook-dedupe`, `sms-segments`, `messenger-events`. They were checked against a clean baseline worktree. They are not regressions, but they need a real `npm ci` run to be confirmed green.

## 6. Gates, CI, staging and device: honest status

- **Gates that only fail because this workspace cannot run `npm ci`** (the package registry is unreachable, so `vite`, `eslint` and others are missing): `check:sql`, `check:types-drift`, `check:sql-identifiers`, `check:lint`, `check:api-contract`, `check:strict-bodies-types`, `check:db-ownership`, `check:actor-stamp`, `check:unique-tenant-review`, architecture tests, frontend builds, app types. These have to be confirmed in CI.
- **`check:state-transitions`** reports 20 findings in code from the earlier round-2 guides (Retention SMS, Team data alerts and training, Setup health, commission review, AI billing, SMS test events, number purchase quotes, product usage). These status writes have no declared state machine. They surfaced when the vocabulary file was regenerated and are **not** Inbox code. They are being fixed in the gap sweep, not baselined.
- `check:unreached` and `inert controls` failed on the first full run (2 dead legacy routes and a no-op calendar Clear button). Both were **fixed** and re-run green.
- **Architecture tests** first showed three findings from this work. All three are fixed:
  - Two frontend types mirrored API types. `InboxPeriod` and `InboxTimelineEvent` now live once, in `@aipowersalon/api-contracts/tenant`.
  - Two direct realtime pushes. They are marked with the repo's documented `§343 exempt` (ids-only refetch signal; the stored row and audit are the fact), the same as Service Done and Checkout.
  - One UTC-day date idiom. The appointment date is now formatted in SQL, which also fixes a possible one-day shift.

  The architecture check still fails here for two reasons that do not come from this work:
  - The TypeScript 6 toolchain in this workspace rejects `moduleResolution=node10` (an environment issue).
  - Older debt that the clean bundle HEAD `9e41a970` reports identically: 11 mirrored types, 1 direct push in `service-done`, 16 UTC-day idioms, a UTC "today", 2 hand-built system contexts and 1 provider directory. These are listed for the gap sweep.
- **CI**: not run (no CI access from this workspace). **Staging**: not run. **Physical 27-inch ASUS**: not run; the owner needs to do this.

## 7. Blocked by external setup / needs owner approval

1. **Live SMS**: needs the salon's own Twilio number, completed carrier (A2P 10DLC) registration, and owner approval. Until then the composer truthfully says why sending is blocked (E2E step 7).
2. **Twilio inbound and status webhooks** on the production number must point at the existing `/webhooks/twilio/*` routes. These are unchanged; the inbound handler now also stores the text.
3. **Inbound email** is not configured, so email conversations show "replies by email are not set up" and the composer is disabled with that reason.
4. **Production migration 730**: needs owner approval. It is additive and rehearsed.
5. **Production deploy**: needs owner approval.

## 8. Known limits and follow-ups

- *Rebooking conversion* shows Unavailable. A real metric needs attribution of bookings to a message.
- AI Communication Insights is a link, not AI-generated content.
- The POS **Message Templates** settings screen keeps templates in memory only (`settings.integrations.ts`), so they are lost on restart. This is a separate, older defect. The inbox reads published templates from `message_templates`. To be fixed in the gap sweep.
- MMS: the media count is shown, but media is not displayed.
- Search is server-side. The search text is never put in the URL because it is often a phone number.
