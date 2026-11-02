# Communications → Email — Email Management & Delivery Center (Email Complete Build Guide, Oct 31 2026)

Route `/tenant/communications/email` (also `/tenant/integrations/email`), rebuilt in place. Migration **748**, applied to the local `aps`
template only. Nothing was pushed, deployed or sent: every send in tests and the harness went to the mock sender, and no provider,
DNS, key or webhook setting was touched. Secrets are referenced by **name only**: `SENDGRID_API_KEY`, `SENDGRID_FROM`,
`SENDGRID_WEBHOOK_VERIFICATION_KEY`, `EMAIL_UNSUBSCRIBE_SECRET`, `PUBLIC_API_BASE_URL`.

## Phase 1 — audit (what the code did before this guide)

| Area | Finding |
|---|---|
| "Send booking confirmations by email" | **Did nothing.** No code read `emailConfirmation`, and no booking confirmation email existed. |
| "Email receipts to customers" | **Did nothing.** Checkout's email receipt went **straight to SendGrid**: no ledger row, no opt-out check, no setting check, in no history. |
| Sender name | The page saved it into `senderBrand`, but every read of the settings **replaces `senderBrand` with the SMS (A2P) brand**, so the saved name came back different or blank. The email sender also never used it: SendGrid got a bare from-address. |
| SendGrid adapter (P0) | Declared `text/plain` while the send path hands it the **branded HTML layout**, so customers would read raw tags. |
| Delivery | No email event source existed. Email status could never become Delivered; "sent" was the provider's acceptance. |
| Marketing (campaign) email | Reached the ledger with **no purpose**, so it was treated as transactional: no physical address, no unsubscribe link or header. |
| Ledger | `notifications` (channel `email`) plus 741's delivery events, consent history and protected resend. These are reused, with no second store. |

## What was built

- **One email path:** `NotificationsService.sendEmail`, exposed as `TenantMessenger.sendEmail`.
  - Receipts, booking confirmations, staff sends, test sends, protected resends and campaigns all go through it.
  - **Order of checks:**
    1. The recipient address is valid; otherwise blocked `invalid_destination`.
    2. The salon's setting for the category; switched off, blocked `receipt_email_disabled` / `booking_email_disabled` and nothing is sent.
    3. **Claim-before-send** on the idempotency key (748 `email_send_keys`).
    4. Suppression by purpose.
    5. Credits (metered sends only) and provider configured.
    6. Marketing compliance.
    7. Provider call with the salon display name and reply-to beside the verified from-address.
    8. Ledger row.
  - "Sent" means *accepted by the provider*.
- **Adapter:**
  - HTML goes as `text/html` with a plain-text alternative.
  - Display name and subject are sanitized: no `< > " @` and no CR/LF, so no header or address smuggling.
  - `reply_to` and custom headers are supported.
  - `verify()` calls `GET /v3/scopes`, which never sends.
- **Settings:** `emailSenderName` and `emailReplyTo` are saved beside the SMS brand, never into it.
  - Server-side validation in `settings.service.ts`; the existing settings route and audit are reused.
  - The page reads the effective values from `GET /pos/email-center/settings` (defaults, then salon, then branch).
- **Booking confirmations:** `BookingConfirmationEmailConsumer` listens for `appointment.created`.
  - One email per appointment, keyed `booking_confirmation:<appointment id>`.
  - Built from the real appointment row: date and time in 12-hour format, services, technician, branch address, reference. English only.
  - Cancelled or no-show appointments, customers without an email, and appointments of another tenant are skipped (another tenant's appointment is refused as a security error).
- **Receipts:** Checkout's email receipt now goes through the messenger.
  - The receipt row stays the transaction-backed record.
  - A repeat email is a new receipt row and a new ledger row, never a second sale.
- **Signed provider events:** `POST /webhooks/email/sendgrid`.
  - ECDSA P-256 signature over timestamp + raw body, with a ±10 minute freshness window.
  - Returns **503** when no verification key is set: delivery is never inferred from an unsigned request.
  - Events:

    | Event | Effect |
    |---|---|
    | `delivered` | Delivered |
    | `bounce` / `dropped` | Failed (Bounced); a hard bounce suppresses the address for **all** email |
    | `spamreport` | Suppresses **all** email |
    | `unsubscribe` | Marketing-only suppression |
    | `processed` / `deferred` / `open` / `click` | Evidence only; never shown as "read" |

  - Deduplicated per (tenant, message id, provider status). The 741 state guard means a late bounce never regresses Delivered.
- **Suppression by purpose:** 748 `notification_opt_outs.scope`.
  - `marketing` (unsubscribe link) blocks marketing only.
  - `all` (STOP, bounce, complaint, staff) blocks everything.
  - The 741 resend and the Notifications detail now honour scope; this was a real bug the test found: a marketing unsubscribe blocked resending a receipt.
  - Campaign sends check suppression with purpose `marketing`.
- **Marketing compliance (CAN-SPAM):**
  - Footer with the salon's physical branch address and a one-click unsubscribe link, plus `List-Unsubscribe` and `List-Unsubscribe-Post` headers.
  - Public `GET`/`POST /public/email/unsubscribe` with an HMAC token. Marketing-only, idempotent, and it never reveals whether the address exists. The customer record's `marketing_email_opt_in` follows for that salon only.
  - With no branch address, or no secret / public base URL in production, marketing email is **refused**.
- **Center:** `pos/email-center/*`.
  - **KPIs:**
    - Accepted, Delivered, Failed / Bounced, Booking confirmations, Receipts, Delivery rate.
    - Delivered is **N/A, never 0**, when no verified events exist.
    - The rate's denominator excludes Unknown.
  - **Health by layer:** configuration, sender identity, provider health, delivery events, recent failures. Each layer has a next action.
    - Never green from a saved key; a test sender never reads Ready.
    - Last check and last successful check are shown separately.
    - Checks are append-only (748 `email_health_checks`) and rate-limited to one per minute.
  - **History:**
    - Server search across name, normalized phone digits, address, subject, provider id, booking reference, receipt number, and IDs.
    - Status and type filters.
    - Date basis: created, sent, provider event, booking date, or receipt date, with salon-local inclusive bounds.
    - Pages of 10/20/50, newest first.
    - Addresses are masked for roles without `pos.communications.manage`.
  - **Details:** from, reply-to, to, consent class, links, provider reference, events, the attempt chain, the safe plain body, and a protected Resend (741). Opening is audited.
  - **Test email:** staff of this salon only.
  - **Composer:** one customer, address from the record, confirmed, idempotent, metered.
  - The customer timeline links to Notifications with `?timeline=<id>`, the unified email + SMS timeline from 741.
- **Alerts:** the existing 5-minute messaging-incident job already evaluates email failures (one open incident per rule and channel).

## Handoff table (guide §17)

| Feature | Status | Evidence |
|---|---|---|
| Provider & health | IMPLEMENTED_NOT_VERIFIED (logic) / BLOCKED_EXTERNAL (real provider) | pgtest health cases; E2E step 3 (rejected key: Down + Correct credentials; test sender: Attention required). No real SendGrid account here: `verify()` against the real API was not run. |
| Email settings | COMPLETED_AND_VERIFIED | settings-core +6 cases (refused smuggled name / CR-LF / bad reply-to; saved beside the SMS brand; Front Desk forbidden); E2E step 1 (DB truth, Unsaved / Saved at / Save failed, toggle off really blocks a receipt). |
| History & search | COMPLETED_AND_VERIFIED | pgtest (name / phone / subject / provider id; 25 rows → 3 pages; newest first; masking); E2E step 5. |
| Monthly calendar | COMPLETED_AND_VERIFIED | Shared `PeriodBar` (month grid, presets, basis); pgtest inclusive salon-local bounds (23:30 in, 00:10 next day out) and reversed range refused. |
| Booking / receipt emails | IMPLEMENTED_NOT_VERIFIED (Checkout path) / COMPLETED_AND_VERIFIED (email path + confirmation consumer) | pgtest: one confirmation per appointment, replay sends nothing, cross-tenant refused, toggle off → blocked; receipt toggle. Checkout's `sendOne(email)` needs the Kysely query builder: CI. |
| Unified timeline | COMPLETED_AND_VERIFIED (reused 741) | Deep link `?timeline=`; 741 timeline tests. |
| Protected resend | COMPLETED_AND_VERIFIED | pgtest (one linked attempt, second refused, original kept); real-Postgres race (two staff at once → one attempt); E2E step 6. |
| Signed events / suppression | COMPLETED_AND_VERIFIED | pgtest (signature valid / tampered / wrong key / stale; delivered once; duplicate; late bounce no regression; bounce + complaint suppress all; unsubscribe marketing-only); race (same batch ×6 → one event per status). |
| Claim-before-send | COMPLETED_AND_VERIFIED | Race: 8 workers, one key → 1 provider call. **Mutation check:** claim disabled → that test fails (1/3). |
| 27-inch screen | IMPLEMENTED_NOT_VERIFIED | Browser 1920×945, 1536×864, 1440×900, 1366×768, 1024×768: no horizontal scroll, overlay Close visible. Physical ASUS: **not performed**. |
| Release readiness | BLOCKED_EXTERNAL | Migration 748 staging/production, provider account, DNS, webhook key: owner approval. |

## Tests (31 Oct 2026, stand-in runner + real Postgres 16 + Chromium)

| Suite | Result |
|---|---|
| `email-center.pgtest` | 20/20 |
| `email.postgres-race` (4 sessions) | 3/3; claim mutation → 2/3 |
| `settings-core` (incl. 6 new email cases) | 115/115 |
| Regression: customer-notifications 18/18, message-templates 17/17, reminder-center 19/19, ai-marketing-send 12/12 · adapters-core 7/7 · sweep 8/8, settings a2p 5/5 · templates 3/3, notifications package 6/6 · 2/2 · 2/2 | all pass |
| `messenger-events.pgtest` | 1/4: the same on unchanged HEAD (query builder: CI) |
| Browser `em` section (5 sizes, EN/VI, Front Desk) | 9/9 |
| Combined browser run `seg,cp,do,promo,cc,mg,mt,cn,pm,bv,ms,eod,fuq,rmd,em` | **162/162** (incl. the fixed EOD "Finn" step; one known harness page error after Open Booking: "not in the harness") |
| `comms` section | 12/12 |
| `POSEmailScreen.test.tsx` (rewritten) | IMPLEMENTED_NOT_VERIFIED (needs CI: no React types here) |

## Not verified / blocked / not built

- **BLOCKED_EXTERNAL:**
  - Real SendGrid send, `verify()` and signed event webhook (account, key, verification key).
  - Domain authentication (SPF / DKIM / DMARC: DNS).
  - `PUBLIC_API_BASE_URL` and `EMAIL_UNSUBSCRIBE_SECRET` in production (until set, production marketing email is refused by design).
  - Migration 748 on staging / production.
  - The physical ASUS 27″.
- **IMPLEMENTED_NOT_VERIFIED (CI):** POS / API type-check, the POS unit test, Checkout's receipt path through the messenger, and the 4 gates that can't run here.
- **NOT_IMPLEMENTED:**
  - A **scheduled** email health check (checks are manual; email failure alerts come from the existing 5-minute incident job).
  - Sender-identity verification readout from the provider (shown as Unknown with "Verify domain").
  - Per-branch sender override (the architecture has none; the salon setting is inherited, never invented).
  - Templates in the composer (Message Templates has no email-channel binding API for staff composition yet).
  - Email body full-text search (not indexed; by design).
- **Resend category:** the 741 resend re-sends through the staff path, so a resent receipt is category "manual". The receipts toggle does not gate a manual resend.

## Rollback

Migration 748 is additive. The rollback is in the file header: drop `email_health_checks` and `email_send_keys`, drop
`notification_opt_outs.scope`, and restore the consent-source check. Code rollback means reverting the commit.
- Receipts fall back to the direct provider path that was there before.
- The booking confirmation consumer disappears, and no email is sent.

## Open owner decisions

1. Provider account: keep the platform's SendGrid with the salon's display name and reply-to (current), or per-salon verified senders and domains?
2. Should a resent receipt also obey "Email receipts to customers"?
3. Turn on a scheduled email health check, and alert by email/SMS as well as in-app?
4. Who may see unmasked email addresses: today it's roles with `pos.communications.manage`, which includes Front Desk under your full-communications decision.
