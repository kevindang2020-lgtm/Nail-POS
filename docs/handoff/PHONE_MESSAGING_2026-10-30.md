# Phone & Messaging Center + Text Messaging Setup — handoff (Oct 30 2026)

Owner guide: *AI PowerSalon — Phone & Messaging + Text Messaging Setup* (combined Claude build guide, Oct 30 2026).
Routes kept: `/tenant/communications/phone` (Phone & Caller ID → now the **Phone & Messaging Center** dashboard) and
`/tenant/communications/messaging-setup` (Text Messaging Setup). Communications sidebar unchanged.
Migration: **721** (`apps/api/db/migrations/721_messaging_readiness_checks.sql`). Commit: local only, never pushed.

Nothing in this work sent a real SMS, bought a real number, called Twilio, or touched production. Every provider call in tests
and in the browser harness went to an injected **fake** Twilio (`http` property on the services).

---

## 1. Audit — defects found in the existing code

| # | Where | Defect |
|---|---|---|
| D1 | `tenant-messaging-credentials.service.ts set()` | Only format checks. Wrong token / wrong account / suspended account / number not on the account were saved as "configured" — and replaced a working setup. |
| D2 | same | Number registry written **before** the credentials, outside a transaction; audit written best-effort (`.catch(() => undefined)`) after. A failure between the two left half a change. |
| D3 | same | API key pairing: a **changed** API key SID kept the **old** key's stored secret (a SID alone was accepted as "complete"); a secret with no SID was silently dropped. |
| D4 | same | A different Account SID with a blank token re-used the previous account's token. |
| D5 | `settings.controller.ts:149` → `settings.integrations.ts MessagingSenderService` | POS A2P status came from an **in-memory map**: brand defaulted to the platform's "AIPowerSalon", a POS "register" invented `pending`, a restart forgot it. The stored notifications JSON is seeded `a2pStatus: "registered"` (a false green shown on POS Settings / Account). The real record (`tenant_a2p_registrations`, Super Admin A2P flow) was never read. |
| D6 | `POSPhoneScreen` | "Connected" = credentials row present; no authenticated provider check, no last-checked time, no stale rule. |
| D7 | Number search | One click on "Buy" bought immediately from the search list; no price, no confirmation, no idempotency. |
| D8 | Test SMS | No confirmation, no idempotency, not stored; the full destination phone went into audit metadata; "sent" was presented as success; status callbacks for it were ignored (`unknown_message`). |
| D9 | Webhooks | No per-salon evidence that inbound / status webhooks actually reach the app. |
| D10 | Setup page | One 520 px column; most of a 1920 px window blank. |

## 2. What was built

**A. Shared readiness (one store, many independent statuses)** — `TenantMessagingReadinessService`
(`modules/communications/src/tenant-messaging/tenant-messaging-readiness.service.ts`) + pure model
`messaging-readiness-model.ts`. Both pages call `GET /tenant/messaging/readiness[/branches/:branchId]`. Each status has
`state · lastCheckedAt · reasonCode (safe) · fixLink`:
- **account** connected / invalid / unknown / stale / not_configured — *connected only from an authenticated provider check of the
  CURRENT configuration*: each check row stores a SHA-256 fingerprint of SIDs + the secrets' ciphertext; any change → Unknown.
- **sender** assigned / not_owned / missing / unknown + capabilities (SMS/Voice/MMS) + sender type (10DLC / toll-free / short code / Messaging Service).
- **a2p** brand, campaign, Messaging-Service association (from `tenant_a2p_registrations`) → not_started / pending / approved / rejected / suspended / not_applicable (toll-free, short code, Verify-only) / unable_to_verify.
- **outbound** ready_to_attempt / blocked / degraded with blocker + warning codes; `deliveryTracking` false when no status callback is configured.
- **inbound** configured (number's SMS URL = ours) / verified (a **signature-verified inbound event** for this salon, ≤ 30 days) / failed (URL elsewhere / not set) / untested; **status callback** configured / verified / untested.
- **verify** (booking codes) ready / disabled / misconfigured = platform policy (kill switch, module off, blocked, required) + salon toggle + provider validation (`last_validated_at`). Independent of A2P.
- **voice**: the number's voice capability; the AI Receptionist status is read on the dashboard from the existing `/tenant/ai/receptionist/overview` (read-only, its own permission).
- **checklist** (5 steps, deep links), **diagnostics** (last 5 checks + last 5 test SMS), branch inheritance (source, overrides, branches inheriting), last changed.
- **Stale threshold: 24 h** (`CHECK_STALE_AFTER_MS`) — an older check is "Stale", never green. A2P non-final state older than 7 days is flagged. Webhook evidence older than 30 days no longer counts.

**B. Health check** — `POST /tenant/messaging/health-check[/branches/:branchId]` (settings.edit). Authenticated GETs only
(`twilio-account-probe.ts`): account (`/Accounts/{sid}.json`), API key pair (`IncomingPhoneNumbers?PageSize=1` signed with the key),
sender ownership + capabilities + SMS URL, Verify Service (existing `probeVerifyService`). Result appended to
`tenant_messaging_health_checks` with safe codes; the Verify probe outcome is recorded exactly as "Test Verify" does. **Rate limit:
one manual check per salon per 20 s**, measured by the database clock. HTTP injectable (`svc.http`); tests use fakes.

**C. Credentials save** — validate first, then **one transaction** (number registry → credentials row with optimistic
`config_version` → check row → fail-closed `recordAuditStrict`). Refusals carry registry codes (422 unless noted):
`TWILIO_API_KEY_SECRET_REQUIRED`, `TWILIO_API_KEY_SID_REQUIRED`, `TWILIO_AUTH_TOKEN_REQUIRED_FOR_NEW_ACCOUNT`, `TWILIO_AUTH_FAILED`,
`TWILIO_ACCOUNT_NOT_FOUND`, `TWILIO_ACCOUNT_SUSPENDED`, `TWILIO_WRONG_ACCOUNT`, `TWILIO_API_KEY_REJECTED`, `TWILIO_NUMBER_NOT_ON_ACCOUNT`,
`MESSAGING_NUMBER_TAKEN` (409), `MESSAGING_PROVIDER_UNREACHABLE` (503 — nothing saved; the UI offers "Save without checking", which
sends `confirmUnverified: true` and records the check as unreachable → the account shows Unknown, never Connected), `VERSION_CONFLICT`.
Leave-blank-keep-token preserved; secrets never returned; audit metadata = SID last 4, flags, never a secret.

**D. Number purchase** — search unchanged (now shows capabilities). `POST /tenant/messaging/number/quote` re-checks the exact
number is still available, fetches the **provider-quoted** monthly local price from the Twilio Pricing API (or `price: null` →
"Price not returned by provider"), and issues a 5-minute single-use confirmation bound to salon + number (stored as SHA-256 in
`tenant_number_purchase_quotes`). `POST /tenant/messaging/number/buy` (now also step-up) buys only with that confirmation; the claim
is atomic; a replay returns the recorded result (idempotent). Codes: `NUMBER_PURCHASE_CONFIRMATION_REQUIRED`, `NUMBER_QUOTE_INVALID`,
`NUMBER_QUOTE_EXPIRED`, `NUMBER_PURCHASE_IN_PROGRESS`, `NUMBER_NO_LONGER_AVAILABLE`. Audited (`number.purchase_quoted`, `number.purchased`).

**E. Test SMS** — `POST /tenant/messaging/credentials/test` now requires `confirm: true` + `idempotencyKey`, E.164, a fresh connected
check of the current configuration (`TEST_SMS_NOT_READY` otherwise), ≤ 10 per salon per hour (`TEST_SMS_RATE_LIMITED`). Each attempt is an
`sms_test_events` row (masked destination `•••1234`, a salted hash, sender, provider SID, status, safe error code, warnings such as
`A2P_NOT_APPROVED_MAY_BE_FILTERED` / `DELIVERY_NOT_TRACKED`). Status: `sending → accepted` at send time; `sent / delivered / failed /
undelivered` **only** from the signed status callback (`twilio-inbound.service.ts` now resolves a test SMS SID to its salon, verifies
the signature with that salon's token, and moves the row forward only — a final state is never overwritten). Audit no longer carries the full number.

**F. POS A2P status** — `settings.a2p.kysely.ts` reads `tenant_a2p_registrations` (registered only when brand AND campaign are
approved; rejected for failed/rejected/suspended; pending while submitted; else not_registered; brand = the salon's own business
name from the registration inputs, never the platform's). Wired into `PosSettingsService` (also overlays the seeded
`notifications.a2pStatus/senderBrand`, go-live readiness and receipt test). With the real record wired, the POS "register" no longer invents `pending`.

**G. UI** (cream/gold kit, EN + VI, `ns/phonemessaging.*`, 264 keys + 21 `errors.*` codes):
- **Phone & Messaging Center** (`POSPhoneScreen.tsx`): header (salon/branch + source, last refreshed, Refresh, Run health check,
  Open Messaging Setup, branch selector), four cards (Assigned Number · Twilio Connection · Carrier Registration · Messaging Readiness),
  Guided setup 1–5 with Fix deep links + Next step, Booking verification readiness, AI Receptionist / Voice (separate, link), Recent diagnostics, Number details.
- **Text Messaging Setup** (`POSMessagingSetupScreen.tsx`): scope selector + status summary; left column Account credentials (SID,
  token leave-blank, API key SID + secret side by side with the pairing rule), Number assignment (From number, capabilities, ownership,
  registry), Verify configuration (SID, status, Test Verify) + Save / Disconnect bar with dirty state; right column Registration &
  Messaging Service, Inbound & status webhooks, number search → **Review & buy** dialog, Test SMS → **confirm dialog** + latest results;
  bottom Diagnostics, Related communications (8 links), Audit & last changed. Disconnect = dialog with the impact list (branches
  inheriting, booking verification, the number, AI receptionist, nothing deleted at Twilio) + typed confirmation word. Step-up flows kept.
  Deep-link anchors: `#credentials #number #verify #registration #webhooks #search #test`.
- Shared parts: `phoneMessagingParts.tsx` (status pill = colour + words, reason-code text, checklist, tables).

## 3. API routes (all `/api/v1`, TenantAuthGuard, tenant from the session)

| Route | Permission | New / changed |
|---|---|---|
| `GET tenant/messaging/readiness` · `…/readiness/branches/:branchId` | settings.view | new |
| `POST tenant/messaging/health-check` · `…/health-check/branches/:branchId` | settings.edit | new, rate-limited |
| `POST tenant/messaging/number/quote` | settings.edit | new |
| `POST tenant/messaging/number/buy` | settings.edit + step-up | changed: needs `confirmationToken` |
| `PUT tenant/messaging/credentials[/branches/:id]` | settings.edit + step-up | changed: validate-before-save, atomic, `confirmUnverified` |
| `POST tenant/messaging/credentials/test` | settings.edit | changed: confirm + idempotencyKey + readiness + stored |
| `GET pos/settings/notifications-reminders/a2p-status` | settings.view | changed: real registration record |
| `POST webhooks/twilio/sms/inbound` · `…/status` | Twilio signature | changed: verified-event stamp; test SMS status |

## 4. Migration 721 + recovery

New tables only (`CREATE … IF NOT EXISTS`, applied twice to the template DB — idempotent): `tenant_messaging_health_checks`
(append-only trigger), `sms_test_events` (no-delete trigger; unique per salon + idempotency key; unique provider SID),
`tenant_messaging_webhook_activity`, `tenant_number_purchase_quotes`. All carry `tenant_id` (FK tenants). **Rollback**: revert the code;
the tables are then unread and harmless. Dropping them is not required and would destroy evidence — forward-fix only.

## 5. Tests and gates actually run (this worktree, Oct 30 2026)

Stand-in runner (`tooling/full-system-test/unit-standin/run.sh`, PGlite on the `aps` template):
- `phone-messaging-readiness.pgtest` **31/31** (new; fake Twilio): save validation + atomicity (wrong token, number not on account,
  another salon's number inside the transaction, unreachable → refused / confirmed-unverified = Unknown), leave-blank token, new account
  needs token, API-key pairing (new SID w/o secret, secret w/o SID, same SID keeps secret, changed SID refused, rejected key), health
  check + Verify, rate limit per salon, stale > 24 h, invalid token, A2P pending → approved, toll-free / nothing-configured, booking
  Verify ready vs platform kill switch, branch inheritance, tenant isolation, append-only, test SMS (fresh check required, idempotent,
  masked), signed status callback → Delivered (forged other-salon callback ignored, late "sent" never regresses), signed inbound →
  inbound Verified, purchase (quote, no price, wrong number / other salon / missing token refused, single buy + idempotent replay, expiry).
- `tenant-messaging-credentials.pgtest` **10/10** (updated: fake Twilio, audit now in `audit_events`), `twilio-tenant-binding.pgtest` **11/11**,
  `tenant-number-isolation.pgtest` 6/6, `tenant-messaging.vitest` 8/8, `tenant-number.vitest` 6/6, `tenant-messaging.tenant.controller.vitest` **7/7** (extended),
  `settings-a2p-status.pgtest` **4/4** (new), `settings-core.spec` 47 + 110 passed.
- Environment-only failures (same before this change; the stand-in lacks `mockClear` / the Kysely query builder / decorator metadata):
  `twilio-inbound.vitest` 0/11 (`mockClear is not a function`), `platform-messaging-provisioner.pgtest` 0/11 (same),
  `twilio-webhook-dedupe.pgtest` 3/4 (query builder), `request-schemas.vitest` 0/58 (all routes, unrelated).
- **pos-web vitest cannot run here** (no vitest/jsdom). `POSPhoneScreen.test.tsx` (6 cases) and `POSMessagingSetupScreen.test.tsx`
  (10 cases) were rewritten/extended and only **syntax-checked** (esbuild) + undefined-name checked (tsc TS2304/TS2552: none).
- **Browser harness** (`tooling/catalog-one-screen`, real POS bundle + real controller/services/SQL, `comms-extra.mjs` fake Twilio):
  `measure.mjs phone,messaging-setup` — **24/24 PASS** (2 pages × pilot/en, pilot/vi, empty/en × 1920×945, 1536×729, 1440×765,
  1366×633): no horizontal scroll, modules painted, 0 touch targets < 44 px, min data font 13 px, no console errors.
  `interact.mjs … comms` — **9/9 PASS** (statuses = server, health check row written, deep link, API-key pairing blocked, wrong token
  refused with DB unchanged, search ≠ buy → review price → single purchase, test SMS confirm → Accepted (not Delivered) with a
  masked row, isolation + Vietnamese, disconnect impact + typed word). Result folders were deleted as instructed (copies of
  measurements, E2E results and 5 screenshots: scratchpad `pm/evidence/`, not committed). One early measure run hit another
  agent's harness on the shared port 4397 and was discarded.
- Gates: list-queries, tenant-isolation, as-any, role-checks, validated-bodies, async-exports, audit-select-columns,
  impossible-predicate, unreached-routes, silent-catch, audit-writers, pos-i18n, vi-glossary, inert-controls, dead-client, error-codes,
  error-text, response-exposure (2 new reviewed reads, reasons in the allowlist), outbound hosts (`pricing.twilio.com` reviewed),
  i18n, v1-clients — **pass**. `openapi --manifest` and `attack-surface` regenerated; owner/tech error catalogues re-synced.
  Full `node tooling/ci/run-gates.mjs`: **12 failed — exactly the known environment-only set** (check:sql, types-drift,
  sql-identifiers, lint, api-contract, strict-bodies-types, db-ownership, actor-stamp, unique-tenant-review, architecture tests,
  frontend builds, app types); every other gate passed. (db-ownership could not run here; note the tenants module now READS
  `tenant_a2p_registrations`, a communications table — read-only, like `customers/retention.repository.ts` already does.)
  Note: `packages/permissions/dist` and `packages/api-contracts/dist` (git-ignored) were copied from the main checkout, and
  `api-contracts/dist/errors.js` rebuilt from this branch's `errors.ts`, so the gates/harness could load them.

## 6. Final acceptance checklist (guide §18)

| Item | Status | Evidence / note |
|---|---|---|
| Both original routes and Communications sidebar remain usable | **Done** | routes + sidebar unchanged; E2E opens both |
| All original setup inputs, selectors and actions preserved or safely improved | **Done** | every field/button kept; Buy became Review → Confirm; Disconnect gained impact + typed word |
| Phone status dashboard and setup page share one authoritative configuration | **Done** | both read `GET /tenant/messaging/readiness` over `tenant_messaging_credentials`; no second store |
| Page fills available width; no large single-column dead zone | **Done** | two columns + bottom row; measured |
| 27-inch touchscreen at 100 % zoom, vertical scroll if needed | **Partial** | 1920×945 CSS viewport measured in Chromium; not run on the physical ASUS touchscreen |
| Tenant default / branch inheritance implemented and explained | **Done** | source label, inherit warning, overrides count, disconnect impact; branch-scoped readiness + health check. (Test SMS stays salon-default only, as before.) |
| Account SID not exposed in full without need; Auth Token / API secrets never reappear | **Partial** | secrets never returned (pgtest asserts); dashboard/readiness show SID last 4; the edit form still shows the full SID (existing GET; needed to re-save) |
| Credential validation is real; API key SID requires valid matching secret | **Done (code)** | provider check before save + pairing rules; proven against a fake only — not against real Twilio |
| Number belongs to tenant account; E.164 / capabilities validated | **Done** | ownership lookup on save + health check; capabilities shown; one-salon registry kept |
| Number Search works and cannot purchase without explicit confirmation | **Done** (salon route) | Super Admin `POST super-admin/tenants/:id/number/buy` unchanged (still direct) |
| Brand, Campaign and number registration states distinct and provider-backed | **Partial** | distinct states from `tenant_a2p_registrations` (filled by the Super Admin A2P flow); this work does not poll Twilio itself; toll-free verification not tracked |
| Ordinary SMS readiness differs from Verify-only and from AI voice | **Done** | separate models + panels |
| Outbound test SMS: confirmation, safe status tracking, diagnostics | **Done** | Delivered needs `TWILIO_STATUS_CALLBACK_URL` set (owner action) |
| Incoming SMS and status webhooks signed, tenant-scoped, idempotent | **Done** | existing E2 signature path + verified-event stamp + forward-only test status (pgtest) |
| Tenant/global Booking Verify toggles and 6-digit verification work as configured | **Partial** | readiness reflects policy + toggle + validation; the toggle screen and OTP flow are unchanged and were not re-run end to end here |
| No cross-tenant credentials, phone ownership, messages or webhook routing | **Done** | pgtest isolation cases + E2E |
| Existing SMS Inbox, Messages, Reminder, Caller ID, AI Receptionist routes still work | **Partial** | untouched; not regression-run (pos-web vitest unavailable) |
| Automated and UI tests pass or failures honestly reported | **Done** | §5 |
| No production deployment or chargeable external action without approval | **Done** | fakes only |

## 7. Guide §19 items

- **Defects**: §1. **Files**: see the commit (backend: `modules/communications/src/tenant-messaging/*`, `messaging-inbound/twilio-inbound.service.ts`,
  `request-schemas.ts`, `modules/tenants/src/settings/settings.{a2p.kysely,service,module}.ts`, `packages/api-contracts/src/errors.ts`;
  frontend: `apps/pos-web/src/screens/{POSPhoneScreen,POSMessagingSetupScreen,phoneMessagingParts,phoneMessagingTestKit}.tsx/ts`,
  `api/posPhoneApi.ts`, `i18n/ns/phonemessaging.*`, `i18n/ns/errors.*`, `styles.css` (`pmc-` block); harness: `tooling/catalog-one-screen/{comms-extra,interact-comms}.mjs` + wiring).
- **Migrations + rollback**: §4. **Screenshots**: harness screenshots at 100 % zoom (before = the guide's photos; after = `pm/evidence/*.png` in the session scratchpad, not committed).
- **Provider evidence**: **mocked only** (fake Twilio). No live account was contacted.
- **Tenant isolation**: pgtest (branch of another salon refused, no cross-salon check/test/number in a readiness view, forged status callback signed with another salon's token ignored, other salon's number refused inside the save transaction) + E2E.
- **New UI links**: dashboard cards/checklist → `/tenant/communications/messaging-setup#…`; Open Booking Phone Verification; Open AI Receptionist; Related communications (8 pages).
- **Owner actions needed** (none were done here):
  1. API env: `PUBLIC_API_BASE_URL` (inbound URL shown/compared) and `TWILIO_STATUS_CALLBACK_URL` (without it a text can never show Delivered — the UI says so).
  2. Each salon number's Messaging webhook → `<PUBLIC_API_BASE_URL>/webhooks/twilio/sms/inbound` (a purchase through the app sets it).
  3. A2P 10DLC: Customer Profile → Brand → Campaign → Messaging Service + number via Super Admin → A2P (carrier vetting, fees, days–weeks). Toll-free senders: Twilio toll-free verification in the Twilio console (not tracked by the app).
  4. Booking codes: a Verify Service in each salon's Twilio account; API keys must be **Standard** keys (a Restricted key may fail the IncomingPhoneNumbers probe and show as rejected).
  5. After deploy: run **Health check** per salon, then one Test SMS to an owner phone.
- **Unresolved / gaps**: Super Admin credential save now also validates with Twilio but its controller does not forward `confirmUnverified` (an unreachable Twilio blocks a Super Admin save); Super Admin number buy has no confirmation step; A2P not polled from Twilio here; toll-free verification not tracked; Account SID full in the edit form; branch-level Test SMS not offered; pos-web screen tests not executed; backend type-check not runnable in this environment (only esbuild transpile + runtime tests).
- **Safe production rollout**: (1) apply migration 721 (additive, idempotent) in staging, then prod; (2) deploy API + POS together (the POS buy now sends a confirmation token; an old POS against the new API gets `NUMBER_PURCHASE_CONFIRMATION_REQUIRED`, an old API rejects nothing new); (3) set the two env vars; (4) staging smoke with a Twilio **test** account: health check, wrong-token save (expect refusal, no change), quote without buying, one test SMS to a staff phone, confirm the status callback moves it to Delivered; (5) prod: no automatic action — salons see Unknown until a health check runs (expected; it is not a regression of sending, which never depended on these tables).
