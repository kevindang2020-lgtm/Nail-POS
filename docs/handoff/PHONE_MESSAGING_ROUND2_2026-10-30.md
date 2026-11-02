# Phone & Messaging — Round 2 handoff (Oct 30 2026): PM-01 … PM-04, OPS-01, OPS-02

Guide: *Complete the Four Unfinished POS Modules* (Four-Module Completion Guide, Oct 30 2026), §1–2, §6–7, §15–19.
Extends round 1 (`docs/handoff/PHONE_MESSAGING_2026-10-30.md`, migration 721): there is still ONE credential store
(`tenant_messaging_credentials`) and ONE readiness read; nothing was rewritten or duplicated.
Migration: **725** (`apps/api/db/migrations/725_messaging_registration_sync.sql`). Commit: local only, never pushed.

Nothing here sent a real SMS, bought a number, submitted/resubmitted a registration, called Twilio or touched production.
Every provider call in tests and in the browser harness went to an injected **fake** Twilio (`http` property on the services).

Status vocabulary (CONVENTIONS round 2): **Verified** (a test I ran here proves it) · **Implemented but Unverified** ·
**Blocked - External Setup** · **Not Built**.

---

## 1. Audit — what round 1 left open (the starting point)

| # | Where | Gap |
|---|---|---|
| G1 | `credentials/test` | Test SMS only through the salon default; a branch could not be tested; `sms_test_events.branch_id` always NULL. |
| G2 | `getMasked` (POS + Super Admin GET) | Full Account SID and API key SID returned in ordinary reads; `readiness.account.apiKey.sid` full. |
| G3 | readiness / POS A2P status | A2P state came only from `tenant_a2p_registrations`, which Super Admin writes — a submission (or a stale record) could show **Approved** without any provider confirmation; no outage state, no last-success time. |
| G4 | toll-free | detected by prefix but "not tracked" (a warning only); no verification status, no next action. |
| G5 | API key probe | any 401/403 → "rejected", so a Restricted key lacking the numbers-read permission was refused on save. |
| G6 | env | `PUBLIC_API_BASE_URL` / `TWILIO_STATUS_CALLBACK_URL` never validated; only the sender number's inbound URL was checked. |

## 2. What was built

### PM-01 Branch-specific test SMS
- `POST /tenant/messaging/credentials/branches/:branchId/test` (settings.edit). The branch is a PATH parameter (the session
  middleware strips scope from bodies). **Authorization**: `allowedBranchesOf(ctx)` — an actor whose role template confines
  them (`authz.scope` BRANCH / SELECTED_BRANCHES) may act only for `authz.branchIds` (else their session branch); any
  other branch of the same salon → **403 `BRANCH_ACCESS_DENIED`**. Another salon's branch → **`BRANCH_NOT_FOUND`** (service).
  The same rule now guards `readiness/branches/:id` and `health-check/branches/:id`; readiness returns
  `scope.authorizedBranches` (each with `source` branch_override / tenant_default), and the setup page's scope selector
  offers only those.
- Effective configuration (`TenantMessagingCredentialsService.effective`): the branch's own row, else the tenant default —
  never another branch's row. Readiness required = a fresh check **of that configuration** (branch row → its own checks;
  inherited → the default's); a check of a different config never counts.
- `sms_test_events` now records `branch_id` (requested branch), `config_source`, `account_sid_last4`, `sender_kind` (725).
- Display states: `requested / accepted / sent / delivered / undelivered / failed / unknown` (`testDisplayState`: sending
  > 10 min or accepted/sent > 24 h without a callback → unknown; provider refusal → failed). Delivered only from the signed callback.
- UI (Text Messaging Setup → Send a test message): selected branch/salon + source, effective account (`AC…1234`),
  sender / Messaging Service, capabilities, readiness pill; a branch the user may not act for shows a notice and no Send.

### PM-02 Consistent SID masking
- `maskSid` → `AC…1234` / `SK…5678` in every ordinary response: credentials GET (POS **and** Super Admin, same service),
  `readiness.account.accountSidMasked` / `apiKey.sid`, test results (`accountSidMasked`), platform-managed `messagingServiceSid`.
  Audit metadata carries last 4 only (`accountSidLast4`, `apiKeySidLast4`); logs never printed SIDs.
- Full SID only via **`POST /tenant/messaging/credentials[/branches/:id]/reveal-sid`** — settings.edit + `@RequireStepUp`,
  fail-closed audit `tenant_credentials.sid_revealed` (metadata = scope + last 4). UI: "Show full SID".
- Edit form keeps working: a blank or masked (`AC…1234`) Account SID / API key SID on save = **keep the stored one**
  (Super Admin's form, which echoes the GET value, keeps working too). Auth Token / API secret never returned (unchanged).

### PM-03 Twilio 10DLC status sync
- Provider client `twilio-registration-client.ts` (injectable http, GET only): BrandRegistrations/{BN}, Services/{MG}/Compliance/Usa2p
  (us_app_to_person), Services/{MG}, Services/{MG}/PhoneNumbers, IncomingPhoneNumbers (PN sid), Tollfree/Verifications.
  Account = the salon's own default credentials; a salon without its own account uses the platform ISV env account.
- `TenantRegistrationSyncService.refresh` writes one **append-only** snapshot per item to
  `tenant_messaging_registration_snapshots`: provider id, sanitized raw status token (A–Z/_ ≤ 40), normalized state,
  `verified` (provider confirmed in this read), source, account source, error class
  (auth / not_found / rate_limited / provider_unavailable / network / unexpected), `checked_at`, `last_success_at`
  (carried forward on failure), `retry_count` + `next_retry_at` (5 min × 2^(n−1), cap 6 h). Run rows in
  `tenant_messaging_registration_sync_runs` (unique per salon + idempotency key → a replay reads nothing twice).
- Rules (`registration-model.ts` + readiness model): approved **only** from a fresh (≤ 72 h) provider-verified snapshot;
  Super Admin record "APPROVED" without one → **Unknown — not verified** (`NOT_VERIFIED_WITH_PROVIDER`); failed read →
  Unknown with last successful check; known pending/not-started steps outrank "unverified" (they block texting).
  Brand, campaign, Messaging Service and number association are separate items.
- Manual **Refresh Status** `POST /tenant/messaging/registration/refresh` (settings.edit, body `{idempotencyKey}`,
  1 per salon per 60 s by DB clock → `REGISTRATION_REFRESH_RATE_LIMITED` 429). Audited (`registration.status_refreshed`,
  `registration.status_changed` on any state change).
- Scheduled refresh: `MessagingRegistrationSyncScheduler` — handler `messaging.registration.refresh` on the durable job
  queue; the hourly dispatcher (`runTick`, job class standard) is **OFF unless `MESSAGING_REGISTRATION_SYNC_ENABLED=1`**.
  Enqueues one job per due salon (cadence 12 h; failed reads at their retry time), idempotency key = salon + due minute,
  staggered 0–10 min, job bound to its tenant (payload checked), outage recorded (not thrown); internal error throws → queue
  retries with backoff → dead (visible).
- Consumers: readiness (`a2p.*` items with `verified`, `lastSuccessAt`, `retryCount`, `providerVerified`, `lastRun`), POS
  A2P status (`settings.a2p.kysely.ts`: `registered` only with provider-confirmed brand + campaign; `providerVerified`),
  both pages (Registration card / section).

### PM-04 Toll-free verification
- Number type: NANP 800/833/844/855/866/877/888 (or a provider-reported type) → toll-free (`numberTypeOf`).
- Tracked separately (`tollfree_verification` snapshot): verification id (last 4 shown), normalized status
  (TWILIO_APPROVED / PENDING_REVIEW, IN_REVIEW / TWILIO_REJECTED / none → approved / pending / rejected / not_started),
  submitted date, last checked, rejection code + digit-scrubbed reason, `editAllowed`, **next action**
  (SUBMIT_IN_TWILIO_CONSOLE / WAIT_FOR_REVIEW / EDIT_AND_RESUBMIT_IN_TWILIO_CONSOLE / CONTACT_TWILIO_SUPPORT / REFRESH_STATUS).
- Readiness rule: a toll-free sender does **not** need 10DLC (A2P = Not applicable); not approved → blocker
  `TOLL_FREE_<STATE>`; never read / outage → warning `TOLL_FREE_UNABLE_TO_VERIFY`; checklist step "registration" follows it.
- No submission/resubmission from the app (the fake refuses any POST; tests assert none was made).

### OPS-01 (software part)
- `messaging-config-diagnostics.ts`: PUBLIC_API_BASE_URL / TWILIO_STATUS_CALLBACK_URL — absolute https, public host (not
  localhost / private IPv4 / single label / IP literal), no credentials / query / fragment, status callback path =
  `/webhooks/twilio/sms/status`, host vs base (warning). In `readiness.config`; invalid → outbound warning
  `MESSAGING_CONFIG_INVALID`. Shown in the Webhooks section (origin + path only).
- Per-number inbound webhook check: health check reads every active registered number (≤ 10) and compares its SMS URL
  (`numbers_inbound` on the check row, `readiness.inbound.numbers`).
- API key scope: 403 / Twilio 70051 / 20403 → `limited` (authenticated, cannot read numbers) → saved without
  "save unverified", `apiKey.scope = 'insufficient'`, warning `API_KEY_SCOPE_INSUFFICIENT`; 401 still = rejected.
- Signed callback tests extended: branch routing (branch token verifies, default token cannot), replay idempotent,
  final state never regresses, cross-salon account refused, signed STOP opt-out idempotent, forged STOP ignored.

### OPS-02 Owner checklist — **Blocked - External Setup** (none of this can be done by the app or by Claude)
1. API environment: set `PUBLIC_API_BASE_URL` (https, public) and `TWILIO_STATUS_CALLBACK_URL` =
   `<PUBLIC_API_BASE_URL>/webhooks/twilio/sms/status`; confirm the Webhooks section shows both **Valid**.
2. Each salon number's Messaging webhook → `<PUBLIC_API_BASE_URL>/webhooks/twilio/sms/inbound` (Health check shows each number).
3. 10DLC (local numbers): Customer Profile → Brand → Campaign → Messaging Service + number via Super Admin → A2P. **Fees**:
   Twilio/TCR brand registration + vetting and a monthly campaign fee (see Twilio's current price page — not estimated
   here); review takes days to weeks. Approval is final only when **Refresh Status** shows "Confirmed by Twilio".
4. Toll-free numbers: submit Toll-free Verification in the Twilio console (business info, opt-in proof, use case);
   review typically days–weeks; on rejection fix and resubmit there. The app only shows status + next step.
5. API keys: Standard or Restricted keys both allowed; a Restricted key must permit sending (Messages) — the app reports
   "Limited permission" if it cannot read numbers.
6. Optional: set `MESSAGING_REGISTRATION_SYNC_ENABLED=1` on the worker to refresh registration status every 12 h.
7. **One owner-approved test send**: the owner chooses the recipient (their own phone), runs Health check, then sends
   ONE test from Text Messaging Setup (salon, then one branch with its own Twilio if any) and confirms it reaches
   **Delivered** (needs step 1). Not done here — needs the owner's approval and a live account.

## 3. API routes (all `/api/v1`, TenantAuthGuard, tenant from the session)

| Route | Permission | New / changed |
|---|---|---|
| `POST tenant/messaging/credentials/branches/:branchId/test` | settings.edit (+ branch authorization) | **new** |
| `POST tenant/messaging/credentials/reveal-sid` · `…/branches/:branchId/reveal-sid` | settings.edit + step-up | **new** |
| `POST tenant/messaging/registration/refresh` | settings.edit | **new**, rate-limited |
| `GET tenant/messaging/credentials[/branches/:id]` (+ Super Admin `super-admin/tenants/:tenantId/messaging-credentials`) | settings.view | changed: SIDs masked |
| `PUT tenant/messaging/credentials[/branches/:id]` | settings.edit + step-up | changed: blank/masked SID = keep; limited key accepted |
| `GET tenant/messaging/readiness[/branches/:id]`, `POST …/health-check[/branches/:id]` | settings.view / edit | changed: branch authorization, `authorizedBranches`, `tollFree`, `config`, provider-backed `a2p`, `inbound.numbers` |
| `GET pos/settings/notifications-reminders/a2p-status` | settings.view | changed: provider-confirmed `registered` |

New registry code: `REGISTRATION_REFRESH_RATE_LIMITED` (429; POS errors EN+VI; owner/tech catalogues re-synced).
`openapi --manifest` and `attack-surface` regenerated (4 new routes).

## 4. Migration 725 + recovery
New tables `tenant_messaging_registration_sync_runs`, `tenant_messaging_registration_snapshots` (append-only trigger);
nullable columns on `sms_test_events` (config_source, account_sid_last4, sender_kind) + an index, and on
`tenant_messaging_health_checks` (numbers_inbound, api_key_scope). Applied **twice** to the `aps` template (idempotent,
notices only). **Rollback**: revert the code — the new tables/columns are then unread and harmless; forward-fix only.
Re-applied/verified after the Postgres restarts at ~13:17 and ~14:18 (tables present).

## 5. Tests and evidence actually run (this worktree, Oct 30 2026)

Stand-in runner (`tooling/full-system-test/unit-standin/run.sh`, PGlite stand-in on the `aps` template):
- `phone-messaging-round2.pgtest` **28/28** (new): PM-01 default vs override account+sender (asserted on the fake's
  Authorization user, URL account and `From`), branch check isolation, other-salon branch refused (nothing sent/stored),
  confined actor → 403 through the real controller + services; display states; OPS-01 branch callback routing / replay /
  no regress / cross-salon, STOP opt-out idempotent, forged STOP ignored, config validation cases, readiness config
  warning, Restricted key "limited" saved + reported, per-number inbound (match / mismatch); PM-03 fixtures **approved /
  pending / rejected / outage** (Unknown + last success + retry 1 → 2), Super Admin "approved" never green, stale
  confirmation, idempotent + rate-limited refresh, dispatcher idempotency + tenant-bound job, append-only, isolation;
  PM-04 prefix mapping (7 prefixes + provider type), states + next actions, rejection reason scrubbed, approved needs no
  10DLC, no POST to registration APIs, only toll-free items read; PM-02 masked echo keeps the SID, audited reveal,
  **secret-safety scan** of 30+ credentials/readiness/status/refresh/test responses + all audit rows + audit calls (no
  `AC/SK[32 hex]`, no token / key secret, no ciphertext).
- `phone-messaging-readiness.pgtest` **31/31** (A2P case now goes through the provider sync), `tenant-messaging-credentials.pgtest`
  10/10, `tenant-messaging.tenant.controller.vitest` **9/9** (+2: branch 403 / reveal / refresh need settings.edit),
  `tenant-messaging.vitest` 8/8, `tenant-number-isolation.pgtest` 6/6, `tenant-number.vitest` 6/6,
  `twilio-tenant-binding.pgtest` 11/11, `settings-a2p-status.pgtest` **5/5** (+ provider-confirmed / outage / stale),
  `settings-core.spec` 47 + 110, `tenant-a2p.vitest` 10/10, `twilio-subaccount-client.vitest` 8/8.
- Environment-only (unchanged, query-builder stand-in): `settings-audit-entity.pgtest` 0/2.
- **pos-web vitest cannot run here.** `POSMessagingSetupScreen.test.tsx` (+8 cases: branch effective config + branch route,
  unauthorized branch, masked SID echo, reveal call, page secret-safety scan, Refresh Status outage, toll-free, webhook
  config) and `POSPhoneScreen.test.tsx` (+1: masked account + toll-free card) were **syntax-checked** (esbuild) and
  type-checked for undefined names / bad props (tsc: none in these files) — **not executed**.
- **Browser harness** (`tooling/catalog-one-screen`, real POS bundle rebuilt with `tooling/checkout-one-screen/build.mjs`,
  real controller/services/SQL, fake Twilio): `interact.mjs … comms` **12/12 PASS** (the 9 round-1 steps + PM-02 masked
  everywhere + audited reveal, PM-03 Refresh Status → provider snapshots "Confirmed by Twilio", PM-01 branch test with
  the effective config → `sms_test_events` row branch/source/last4 + other salon's branch 404). `measure.mjs
  phone,messaging-setup` **24/24 PASS** (2 pages × pilot/en, pilot/vi, empty/en × 4 viewports: no horizontal scroll, 0
  targets < 44 px, min font 13 px, no console errors). Result folders deleted from the repo; copies + 12 screenshots in the
  session scratchpad `pm2/evidence/` (not committed). Earlier attempts were discarded: one hit another agent's harness on the
  shared port, one ran before the bundle was built, one during a Postgres restart.
- Gates (run here): list-queries, tenant-isolation, as-any, role-checks, validated-bodies, async-exports,
  audit-select-columns, impossible-predicate, unreached-routes, silent-catch, audit-writers, vi-glossary, inert-controls,
  dead-client, error-text, response-exposure (1 new reviewed read: registration-sync.service.ts), outbound hosts,
  openapi (`--check` after regeneration), i18n — **pass**. Full `node tooling/ci/run-gates.mjs`: besides the 12 known
  environment-only failures, three failed on **another module's committed code, which this work did not touch**:
  `check:error-codes` (AI_ALERT_NOT_FOUND in super-admin/tenant-ai/ai-usage-screen.controller.ts), `check:state-transitions`
  (ai-usage-screen.repository.ts) and `pos-i18n` (POSAiUsageScreen.tsx). `packages/permissions/dist` and
  `packages/api-contracts/dist` (git-ignored) were copied from the main checkout and `dist/errors.js` rebuilt from this
  branch so the harness could load.

## 6. Acceptance matrix (guide §18 rows for this scope)

| ID | Status | Evidence / blocker |
|---|---|---|
| PM-01 Branch-specific test SMS | **Verified** (backend + harness E2E) / screen test Implemented but Unverified | round2 pgtest PM-01 block; controller spec; E2E step "PM-01". Real delivery to a phone: Blocked - External Setup (OPS-02 #7) |
| PM-02 Consistent SID masking | **Verified** | round2 secret-safety scan + masked echo + audited reveal; E2E page scan + reveal; screen secret scan written, not executed |
| PM-03 Twilio 10DLC status sync | **Verified against fixtures** (approved/pending/rejected/outage); real provider **Blocked - External Setup** | round2 PM-03 block; E2E Refresh Status. Field names follow Twilio's documented API; not yet checked against a live account. Scheduler ships OFF |
| PM-04 Toll-free verification tracking | **Verified against fixtures**; real provider **Blocked - External Setup** | round2 PM-04 block (sender-type tests, state mapping, readiness rule, no submission) |
| OPS-01 Twilio inbound/callback configuration | Software **Verified**; deployment **Blocked - External Setup** | config validation, per-number webhook, key scope, signed callback / routing / idempotency tests; real public reachability needs the deployed env |
| OPS-02 Registration + owner test-send checklist | **Blocked - External Setup** | checklist §2 OPS-02; needs fees, carrier approval and the owner's approved test send |
| §17 PM must-pass scenarios | 1–4 **Verified** (fixtures); 5 **Verified** | tenant default vs override + unauthorized; masked SID; submitted vs provider-approved + outage; toll-free rule; webhooks signature/tenant/idempotency/opt-out |
| QA-01 CI | **Blocked - External Setup** | no push allowed → no CI run. Commands: the stand-in lines in §5, `node tooling/ci/run-gates.mjs`, `pnpm --filter pos-web vitest run src/screens/POSMessagingSetupScreen.test.tsx src/screens/POSPhoneScreen.test.tsx` |
| QA-04 Physical ASUS touchscreen | **Blocked - External Setup** | Physical hardware verification pending (CSS viewports measured only) |

## 7. Residual risks / gaps
- Provider field names (brand `status`, Usa2p `compliance[].campaign_status`, service `us_app_to_person_registered`,
  Tollfree `verifications[]`) are from Twilio's public docs and only exercised against a fake.
- Account resolution: a registration Super Admin created under the ISV account for a salon that ALSO has its own Twilio is
  read with the salon's account → `not_found` → Unknown (honest, but it would stay Unknown). Owner/ISV decision needed.
- Super Admin `super-admin/tenants/:tenantId/messaging-credentials` GET is now masked; the Super Admin form re-saves the masked value
  (kept by the server). No Super Admin reveal button was added.
- `sms_test_events.status` CHECK unchanged (sending/rejected map to requested/failed for display).
- pos-web screen tests not executed (no vitest/jsdom here); backend full type-check not runnable (stand-in transpile + runtime only).
- The scheduler dispatcher is cross-tenant by design (one job per salon, each carrying its own tenant id).

## 8. Safe rollout
(1) apply 725 in staging (additive, idempotent); (2) deploy API + POS together (old POS still works: masked SID echo is kept,
the branch test route is additive); (3) staging smoke with a Twilio test account: Refresh Status on one 10DLC and one toll-free
salon, compare with the Twilio console, check the Webhooks section shows both URLs Valid; (4) only then enable
`MESSAGING_REGISTRATION_SYNC_ENABLED` on one worker; (5) OPS-02 owner steps. Rollback trigger: wrong registration state
vs the console → disable the env flag and revert the code; snapshots stay as evidence.

## 9. Files
Backend: `modules/communications/src/tenant-messaging/{registration-model,registration-sync.service,twilio-registration-client,messaging-config-diagnostics}.ts` (new),
`{messaging-readiness-model,tenant-messaging-readiness.service,tenant-messaging-credentials.service,tenant-messaging.tenant.controller,tenant-messaging.module,messaging-health,twilio-account-probe}.ts`,
`modules/communications/src/request-schemas.ts`, `modules/tenants/src/settings/settings.a2p.kysely.ts`, `packages/api-contracts/src/{errors,tenant-twilio}.ts`, migration 725.
Tests: `phone-messaging-round2.pgtest.vitest.spec.ts` (new), updated readiness / credentials / controller / vitest specs, `settings-a2p-status.pgtest`.
Frontend: `apps/pos-web/src/screens/{POSMessagingSetupScreen,POSPhoneScreen,phoneMessagingParts}.tsx`, `phoneMessagingTestKit.ts`, both screen tests,
`api/posPhoneApi.ts`, `i18n/ns/phonemessaging2.{en,vi}.ts` (70 keys, new) + `phonemessaging.*` (1 changed) + `errors.*` (1) + `ns/index.ts`, `styles.css` (round-2 pmc block).
Harness: `tooling/catalog-one-screen/{comms-extra,interact-comms}.mjs`. Generated: `apps/api/openapi/manifest.txt`, `docs/security/*attack-surface*`,
owner/tech `errors.generated.ts`, `tooling/ci/response-exposure.allowlist.json`. Docs: this file, `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` (A51).
