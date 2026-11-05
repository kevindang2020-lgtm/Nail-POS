# CHANGELOG_HANDOFF.md

## 🏆 Production Takeover & Whole-Platform Mandate (October 14, 2026)

Canonical takeover execution covering P0 Money & Security vulnerabilities, P1 Core Business Rules, P2 Completeness, and Full System Audits. Verified against all 47 CI gates, 13 integrity audits, and live database migrations.

### 1. P0 Money & Security Fixes
- **Gift Card Value Reload Atomic Transaction (§136):** Removed non-atomic reload vulnerability (`POST /tenant/gift-cards/:id/reload`). Enforced append-only `gift_card_ledger` write transactionally atomic with balance mutation.
- **Card Refund Idempotency & In-Flight Protection (§103):** Fixed `executeCardRefund` in `CheckoutKyselyRepository` using deterministic `buildIdempotencyKey`. Non-terminal processor timeouts now safely place refunds in `refund_pending_review` state rather than risking duplicate merchant debits.
- **Android Keystore Sanitization (§1):** Removed committed keystores (`*.jks`, `key.properties`) from `apps/{customer,owner,tech}-web/android/`. Securely archived to `~/.aps-mobile-credentials/` and enforced by `check:secrets` and `tooling/mobile/check-native-config.mjs`.

### 2. P1 Core Business Rules
- **Commission Rule Precedence (§121):** Restored missing scopes (`Service`, `Category`, `Branch+Category`) in `CompensationRuleLoader` and enforced hierarchical precedence: `Tech+Service` > `Tech+Category` > `Tech+Branch` > `Tech` > `Branch+Service` > `Branch+Category` > `Service` > `Category` > `Branch` > `Tenant`.
- **Booking Skills Guard (§51, §78):** Enforced required skill checking (`assertTechnicianHasRequiredSkills`) across all booking creation and rescheduling paths (customer-app, staff booking, and drag-and-drop moves).
- **Technician Time-Off Guard (§51):** Unified approved time-off validation in booking availability windows to prevent overlapping bookings during approved technician leaves.
- **Durable Staff Booking & Check-In Idempotency (§31):** Connected `api_idempotency` database table to staff appointment creation and queue check-ins to prevent double entries on network retries.
- **Processor Error Status Normalization (§232):** Clover/CardPointe retryable processor errors mapped to `provider_unavailable / processing`, preventing false "card declined" rejections.
- **Disaster Recovery Post-Restore Hold (§212):** Added `POST_RESTORE_HOLD=1` circuit breaker to prevent automated re-billing or outbox re-sending during disaster recovery database restorations.
- **Ephemeral Media Store Guard (§210):** Refuses production boot when `MEDIA_STORE=disk` or without configured S3 storage.

### 3. P2 Completeness & Edge Cases
- **Customer Booking Transactional Outbox Events (§51):** Emitted `appointment.created` and `appointment.rescheduled` transactionally inside `doInsertBookingAtomic` with `actorType: 'user'`.
- **Booking Conflict 409 Diagnostics (§52):** Returns structured machine code `APPOINTMENT_CONFLICT` and fresh availability slots on booking collision.
- **Queue Check-In Concurrency Race (§55):** Handled PostgreSQL partial unique index conflict (`23505`) by returning existing active queue ticket instead of unhandled 500.
- **Skill Approval Self-Dealing Guard (§79):** Prohibits managers from approving their own skill upgrade requests.
- **Unified Currency Arithmetic (§33):** Added canonical `taxCents(taxableCents, taxRatePercent)` to `@aipowersalon/money` package.
- **Mobile Viewport Accessibility (§220):** Removed `user-scalable=no` zoom lock across all web apps.
- **Navigation Gate Expansion (§218):** Added `manager-pay-web` to `check:nav` automated verification.

### 4. Canonical Mandate Takeover Reports Generated
- `ARCHITECTURE_STATUS.md` (§238): 32 domain architecture & service status.
- `SECURITY_REVIEW.md` (§243): Complete security threat model, isolation, auth, and secrets analysis.
- `INTEGRATION_STATUS.md` (§244): 10 external integrations categorized into authoritative statuses.
- `DATABASE_STATUS.md` (§245): Authoritative schema, 603 migrations, 726 tables, and index audit.
- `REALTIME_INVENTORY.md` (§247): 112 realtime events, audience, permissions, recovery.
- `FRONTEND_ROUTE_STATUS.md` (§248): 501 frontend routes/screens across 9 frontend apps with connected APIs.
- `docs/HOSTING_ACTIONS_FOR_KEVIN.md` (§262): External dependencies and operator actions checklist.

---

## 🔴 Critical — these were live

### 1. Face ID had no signature verification
`WebAuthnService`'s only verifier was a **test stub that always returned `ok: true`**, and
`@simplewebauthn/server` was installed but never imported. Mounting the module — the obvious fix for an orphaned
controller — would have accepted **any forged signature**: a complete authentication bypass dressed as biometric
security.
**Fixed:** real library, **fails closed**, 8 tests proving rejection. Now also **disabled by default**
(`FACE_ID_ENABLED`) until one real-device test on staging.

### 2. Session revocation revoked nothing
"Sign out other devices" and admin session-kill flipped a DB flag **no guard ever read**, and login never wrote a
session row. A "revoked" session kept working until expiry — **up to 30 days**.
**Fixed:** minted `sid`, checked at the auth chokepoint, logout revokes server-side, SSE streams terminate.
Guard: `session-sid-coverage`.

### 3. The Security dashboard was lying
It reads `login_attempts` — and **nothing ever wrote to it**. Every metric was permanently **zero**.
**Fixed:** success, failure and lockout are now recorded.

### 4. Production login was broken for every web app (CORS)
The apps deploy **cross-origin** from the API and fetch with `credentials: "include"`. CORS had
`credentials: isDev` → **false in production**. Per the Fetch spec the browser **discards** the response to a
credentialed request without `Access-Control-Allow-Credentials` — so **every authenticated call failed, including
login**, on every browser. The comment justified it as a security measure; the reasoning was inverted.
**Fixed:** `credentials: true` (safe — the origin allowlist is strict, never `*`). Guard added.

### 5. THREE live cross-tenant data leaks
All behind `TenantAuthGuard` — reachable by **any salon's staff**:
- **`campaign_compliance_flags`** — `WHERE 1=1`, no tenant filter. A manager at Salon A could **read every other
  salon's compliance flags**, and `resolveFlag` updated `WHERE id = ?` with no tenant check — a **cross-tenant
  write**.
- **`campaign_delivery_rollups`** — a query with **no `WHERE` clause at all**: every salon's delivery totals summed
  together and shown to whoever asked.
- **`message_templates`** — publish/read by id with no tenant check; Salon A could publish **Salon B's** template.

**Why nothing caught them:** the tenant-isolation guard derived its table list from the generated Kysely types,
which are missing **212 tenant-owned tables**. The tables were invisible, so the queries were.
**Fixed:** all three scoped (service **and** SQL), fail-closed, 14 isolation tests. Guard now derives from the
**migrations**.

### 6. Duplicate owner account for every salon
Super Admin's `createTenant` **always inserted a new `users` row** for the owner. Adding a second salon created a
**second owner account with a different password**. It also never wrote `user_branch_access`, so **the new salon
never appeared in the owner's portfolio** — they owned a salon they could not open.
**Fixed:** the owner is looked up by email/phone (scoped `role = 'OWNER'`, so a customer sharing an email is never
grabbed), and every new salon is granted into their portfolio. Proven against real Postgres: the old code gave one
person **3 accounts and 0 portfolio grants**.

## 🟠 High

- **`Branch is active` was never checked** — staff at a suspended branch could still sign in.
- **Per-user branch access was ignored at login** — an owner granted branches 1–2 could select branch 3.
- **Super Admin couldn't assign a merchant ID** — `tenant_payment_config.updated_by_user_id` exists in **no
  migration** but the repo writes it, so it **threw**. Fixed (migration 365).
- **Orphaned modules** — the OCR receipt controller (13 endpoints, a 17-table migration) was registered in no
  module; routes never loaded. Guard: `no-orphaned-controllers`.
- **The native apps could not authenticate at all.** In a Capacitor shell the origin is `capacitor://localhost`, so
  the `SameSite=Lax` cookie is never sent — and nothing ever gave the client a token. **Fixed:** Keychain-held
  bearer token, issued **only** to native clients (decided from the unforgeable `Origin` header, so XSS in a web
  app can never obtain one). CORS, Face ID (native biometrics, not WebAuthn) and the token lifecycle followed.
- **A native build without `VITE_API_BASE` is a dead app** — every call resolves against `capacitor://localhost`.
  Now **throws at start-up**, loudly, rather than failing silently on a customer's phone.

## 🟡 Correctness

- **Unattributed audit records** — two `audit_logs` inserts had a `tenantId` in scope and omitted it.
- **`>= -0`** in the queue lateness check (behaviourally fine, but nonsense — now `>= 0`).
- **INET columns** — `req.ip` behind a proxy is a comma-chain that Postgres rejects. Four INET columns were
  enumerated **from the schema** and all writes sanitized. A swallowed throw here silently lost every audit record,
  and in `sessions` it would have produced an **unrevocable session**.

## Guards added (12)

`tenant-isolation` · `no-orphaned-controllers` · `sql-schema-consistency` · `auth-boundary` · `image-assets` ·
`session-sid-coverage` · `session-401-coverage` · `native-auth-coverage` · `cors-native-origins` ·
`webauthn-wiring` · `auth-wiring` · `faceid-flag`

**Each verified non-vacuously** — the bug planted back, the guard confirmed to fail **by name**. *(Three of them
were vacuous on the first attempt and passed on deliberately broken code. One fired on a **comment**. That is why
this step is not optional.)*

**Guard blind-spots fixed:** the tenant-isolation guard was (1) reading a stale table list, (2) only scanning
`*.kysely.repository.ts` — six repos were invisible **purely because of how they were named** — and (3) truncating
SQL at **nested backticks**, hiding an entire syntactic class of leak.

## Features built

Multi-salon Owner Platform (portfolio, server-verified salon switching, role-per-salon, All-Salons dashboard) ·
owner portal login (no Store Code) · customer portal login + guest mode · global customer identity ·
customer activation (phone→OTP) · Salon Safety Community · native iOS/Android support · POS + customer login
screens.

## Housekeeping in this handoff pass

- **Lint: 0 errors** across the repo (was 25). Three suppressions, each with a written reason — including a
  **PII phone-redaction regex left intact** rather than risk breaking redaction for a cosmetic rule.
- Renamed `useSecureStore` → `setSecureStore` (the `use` prefix made eslint treat a plain setter as a React hook).
  **The `native-auth-coverage` guard caught the rename** and had to be updated — exactly what it is for.
- `.env.example` regenerated: **126 variables, enumerated from the source**, all placeholders, **zero real
  credentials**.

---

## Technician Skills / Helper / Earnings & Tip Allocation (2026-07-16)

Built against the existing compensation + technician + checkout modules (reuse-first; no duplicate engine, ticket, or payroll path). See `COMPLETION_REPORT.md` for the full §25 mapping.

- **Combined-tip 50/50 for two technicians** — `engineInputFromLines` (the single tip-method chokepoint) now defaults exactly-two-technician tickets to an equal split; explicit/customer-directed methods still win; odd cents deterministic (`1501 → 751/750`). Earnings stay per-line.
- **Configurable 3+ technician tip policy** — salon setting (`GET`/`PUT /owner/compensation/tip-policy`, stored in `tenant_settings`, audited): proportional by default, equal only when opted in.
- **Qualified-technician lookup + backend `isQualified` gate** — reuses `technician_services`; `GET /pos/technicians/qualified` and `GET /tech/help-requests/qualified`.
- **Request-Help workflow** — migration `400_technician_help_requests.sql`; `TechnicianHelpService` (create / accept / decline) with atomic transitions, per-line reassignment on accept (the earnings mechanism), audit + realtime events (`technician_help_*`, `ticket_line_technician_assigned`); wired at `/tech/help-requests`.
- **Frontend both sides** — tech-web `HelpRequestsCard` (accept/decline) + `RequestHelpModal` (request); pos-web `ReviewTechnicianSplit` on checkout (shown when >2 techs, with names).
- **Refund attribution reversal** — `CompensationService.reverseForRefund` wires the existing `buildRefundReversal` engine into the refund path (best-effort, non-throwing, approval-pending adjustments that never rewrite the frozen snapshot); closed payroll periods route to a future period (§9/§21).
- **Files:** `compensation/*`, `technician-help/*` (new module), `technicians/*`, `checkout/*`, `realtime/realtime-core.ts`, `tech/tech.module.ts`, `app.module.ts`, `database/kysely.types.ts`; tech-web + pos-web components/api. **Migration added:** `400`.
- **Verified:** api tsc 0; compensation 96, checkout 119, technicians 28, technician-help 16, realtime 18; di/sql/public/nav gates PASS; tech-web + pos-web tsc 0 + builds PASS. No existing tests weakened.

## Jul 19–20, 2026 — revenue model, compliance, and full-surface audit
- **Migration 415** `residual_applicable_costs` — Net-Revenue-first pool (`applicable_costs_cents` on residual statements).
- **Migration 416** `payment_surcharge_bucket` — per-payment `surcharge_cents` (first-class ledger bucket).
- `common/revenue-split.ts` += `computeLayeredResidualSplit` + `layeredFromFlat` (+6 engine tests incl. the exact $1,000/$100-costs → 585/315/225/360 example, cent reconciliation, cap, clawback).
- Rewired `calculatePartnerPayout` / `calculateTenantIncentive` / `reconcileStatement` to net-first layered math; layered breakdown in `calc_snapshot` + responses; statement import accepts `applicableCostsCents`; Super Admin Revenue & Residuals screen prints the layered line.
- Surcharge compliance: `CARD_SURCHARGE_CAP_PCT=3` + `CardFunding` exclusion in `splitCardSurchargeCents`; `computeTotals` routed through it; settings write-cap 4→3 (`settings.service` + harness case) + pos-web client check "(max 3)"; per-payment surcharge persisted in `recordPayment`/`recordSplitAtomic`/`payCard`.
- Compensation: `BonusRulesService.reviewPeriod` + owner endpoint + panel section. Mobile checkout: refund/void/listTicketPayments routes + manager-pay-web Payments card.
- Fixes: admin-web `giftCardSettlementApi.batch` wired ("View entries"); StaffOverviewScreen reads `?panel=` (Transfers/Payroll-Sync deep-links); POSCheckoutScreen 3 dead toggles → honest disabled; POSCustomersScreen dead `ePhone` removed (verified phone flow untouched); `useSystemStatus` degrades to "Status unavailable" on unreachable health check (+2 tests).
- Docs: `SUPER_ADMIN_WIRING_MATRIX.md` extended to all 30 Super Admin pages + processor/domain-integrity sections. Demo harness `apps/api/demo-revenue-layered.ts`.
- Fresh verification (Jul 20): all wiring gates green; tsc 0 across 8 workspaces; 416/416 migrations; API 5,725 vitest (+4 skipped) + 124 harness suites; frontends 258/114/261/46/754/695 — **0 failures anywhere**.

## Jul 20, 2026 — POS touch migration (Dell 24 EC24250 Touch)
- `pos-web/src/styles.css` += TOUCH section (touch-action, tap-highlight, user-select, `:active` parity, `@media (hover:none)` hover neutralization).
- `POSTechQueueScreen` board: tap-to-assign path (arms via existing `setDragGuest`; eligible techs get armed-target affordance; same assign endpoint) + updated hints; test +1 (tap→tap fires `/assign-technician`, no drag events) → 12.
- Input-type sweep for the Windows on-screen keyboard: `type="tel" inputMode="tel"` ×6 (QuickCheckInPanel ×2, Customers add, Booking form, ReceptionCopilot ×2), `type="email"` ×2 (Customers add/edit), `type="search" enterKeyHint="search"` ×12 (Checkout, Queue, Services, Customers, Booking, CustomerProfile, HelpCenter, CampaignCenter, ActivityLogs, VoiceTranscription, MapEditor, TopSearch).
- `MOBILE_CONVERSION_HANDOFF.md` added (native-app pivot brief) + §0 hardware update (Dell primary; Mac-for-Xcode unaffected).
- Verified: pos-web tsc 0, shards 212+285+199 = 696 green, vite build OK. No backend changes.

## Jul 25, 2026 — kysely.types.ts schema drift closed + permanent drift gate
- `src/database/kysely.types.ts`: +162 column declarations across 23 interfaces (website_leads, hardware_packages, payments, tickets, reviews, pos_queue_items, customers, tenants, branches, users, tenant_subscriptions, payment_settlements, chargebacks, tenant_ai_packages, global_tech_profiles, tech_salon_memberships, webauthn_credentials/challenges, password_reset_tokens, customer_phone_verifications, go_checkin_devices, tenant_checkin_settings, ocr_reviews). Generated from the live migrated schema; conventions matched; nothing existing modified.
- NEW `scripts/introspect-schema.mjs` + `npm run -s check:types-drift`: PGlite-migrated schema vs `DB` interface — exits 1 on any missing/ghost table or column. NEW `scripts/patch-kysely-types.py` (remediation).
- Verified: tsc 0 · di/sql/crosswire/dead-client/unreached/perms/public/nav/types-drift all PASS · 416/416 migrations · vitest shards 1481+1407+1415+1422 = **5,725 passed, 4 skipped, 0 failed** · 124 core harnesses passed. No frontend impact (types not imported outside apps/api).

## Jul 25, 2026 — push notifications made real (APNs + FCM v1) + New-Assignment trigger
- `push/push-providers.ts` rewritten: `ApnsPushProvider` (node:http2, ES256 JWT ieee-p1363, 45-min cache, per-app topic, sandbox/prod hosts, honest `apns_topic_not_configured`), `FcmV1PushProvider` (RS256 service-account JWT → OAuth2 → v1 messages:send, token cache, `UNREGISTERED`→`unregistered`), `CompositePushProvider` (ios→APNs, android/web→FCM), `NotConfiguredPushProvider` (production default without creds — no fabricated deliveries; legacy `FCM_SERVER_KEY` warns retired-June-2024 and selects nothing). Mock only outside production.
- `push.types.ts`/repos: provider targets carry the registering `app`; `push.service.ts` auto-revokes tokens on `unregistered`.
- Trigger: `queue.service.assignTechnician` + `tech-queue.service.reassign` dispatch a push to the technician's user (`technicianUserId` added to both ports, tenant-scoped in kysely, deterministic in the in-memory fakes); modules import `PushModule`. Best-effort, never blocks the money/assignment path.
- Tests: `push.vitest.spec.ts` 11→27 (JWTs verified cryptographically, FCM v1 request shape asserted, selection honesty, composite routing, auto-revoke); new `queue-assignment-push.vitest.spec.ts` (5). `.env.example` += APNS_*/FCM_SERVICE_ACCOUNT_* with the legacy-key retirement note.
- Verified: api tsc 0 · di/sql/crosswire/dead-client/unreached/perms/public/nav/types-drift PASS · shards 1481+1407+1422+1436 = **5,746 + 4 skipped, 0 failed** · queue/tech-queue core harnesses PASS. No migration; no new deps; frontends untouched.

## Jul 25, 2026 — push registration in customer-web / owner-web / manager-pay-web
- Each app: NEW `src/lib/push.ts` (mirror of tech-web's — lazy @capacitor/push-notifications, web no-op, persisted token, failed-revoke retains for retry) + NEW `src/api/pushApi.ts` (`/push/register` with `app: customer|owner|manager` matching `APNS_TOPIC_*`).
- customer/owner `AuthContext.tsx`: register-on-principal effect; `logout()` calls `unregisterPushToken()` BEFORE `authApi.logout()` (authenticated revoke — the tech-web incident ordering). manager-pay: register in `App.tsx` sign-in effect; revoke-first in `AccountScreen.onSignOut`.
- NEW `src/lib/push-unregister.test.ts` × 3 (revoke on sign-out, survives relaunch, failed revoke retains token, no-token no-call).
- Verified: tsc 0 × 3 · customer-web 265 / owner-web 262 / manager-pay-web 50 tests (each +4, 0 failures) · vite builds OK. No API/pos-web/tech-web changes.

## Jul 25, 2026 — push triggers: payroll-paid payout + check-in-ready
- `payroll.service.transition` (paid branch only): pushes to every technician with a line in the period via new tenant-scoped `PayrollRepositoryPort.technicianUserIds` (kysely + in-memory). Deliberately NO amounts in the push — a lock screen is not a payslip; the app shows figures. `finalized` sends nothing. PayrollService ctor gains optional structural push; `payroll.module` imports `PushModule`. Best-effort — never fails the transition.
- `queue.service.callNext`: check-in-ready push to the customer's account via new tenant-scoped `QueueRepositoryPort.customerUserId` (pos_queue_items → customers.user_id; walk-ins with no account → no push, call succeeds). Runs alongside the existing SMS notify path.
- Tests: `payroll-paid-push.vitest.spec.ts` (4 — incl. finalized≠payout, unlinked-tech skip, no-dollar-figures assertion) + `queue-assignment-push.vitest.spec.ts` +2 callNext cases.
- Verified: api tsc 0 · all 9 gates PASS · queue/tech-queue core harnesses PASS · shards 1481+1387+1444+1440 = **5,752 passed + 4 skipped, 0 failed** (+6 = exactly the new tests). No migration; no frontend change.

## Jul 25–26, 2026 — Website merge + Free-POS-Package application intake (Phases 1–5)
- **Website merged into the monorepo at `marketing/website/`** (editable source). Form rewired to the REAL endpoint
  `POST /public/website/applications` — the old `/public/tenant-applications` path never existed server-side (404).
  Added: idempotency key (reused on retry), consent_text + form_version, UTM capture, APS reference on success, and an
  HONEST failure state (previous code showed fake success when the fetch failed). `API_BASE` still `''` → mailto
  fallback until the live API origin is set. The WP theme zip predates these fixes — repackage from `marketing/website/`.
- **Migration 417** extends `tenant_applications` (33 cols): reference_number, owner first/last, address/zip,
  locations, `ein_encrypted`+`ein_last4`, referral_source, card_volume_band, contact prefs, applicant_message,
  consent evidence (given/text/at/ip/ua), form_version, utm, idempotency_key, duplicate score+reasons, priority,
  assigned reviewer, follow_up/last_contacted, approved/rejected/archived_at, onboarding_id, record_version.
- **Public intake hardened** (`publicCreateApplication`): required first/last+salon+email+phone+consent; EIN validated
  and AES-256-GCM-encrypted at rest (`src/common/field-encryption.ts`, env `APP_DATA_ENCRYPTION_KEY`; raw EIN never
  stored/logged; unkeyed → last-4 only); idempotent resubmission returns the same reference; duplicates flagged
  (reasons + score) never discarded, never revealed; response returns `APS-XXXX-XXXX`, not internal ids.
- **Lifecycle backend**: `applications-lifecycle-core.ts` — 16 canonical statuses + 3 legacy first-class, archived
  terminal, transition-enforced `setApplicationStatus` with stamps/history/record_version; endpoints for assign,
  priority, follow-up, contact-log, approve (note REQUIRED), reject (reason REQUIRED), duplicate/spam, archive, and an
  audited permission-gated EIN reveal. 12 `super_admin.applications.*` perms minted and enforced per-route.
- **Admin-web**: ApplicationsScreen rewritten — 12 status tabs, APS reference + dup-risk pill, dup-findings banner,
  consent line, masked EIN + Reveal, note-gated Approve / reason-gated Reject, assign/priority/follow-up/contact-log.
- **P5 conversion**: `POST applications/:id/convert-to-onboarding` opens the existing 14-stage onboarding case
  (`OnboardingService.createApplication`; double-start conflict-guarded), links `onboarding_id`, status →
  `converted_onboarding`; application stays the immutable source record; NO processor/hardware data in the conversion
  payload (payload-whitelist pinned by test). `markApplicationConverted` now transition-enforced + relink-guarded.
- **Gotchas recorded**: in-memory drivers return LIVE row objects (capture read-values BEFORE updates); TWO test files
  cover ApplicationsScreen (mock the FULL client surface or unrelated-looking failures appear).
- Verified end-state: api tsc 0 · 417/417 · ALL 9 gates PASS · API battery 1497+1401+1441+1428 = **5,767 + 4 skipped,
  0 failed** · admin-web tsc 0, build OK, 758 tests green (306+226+226 incl. the new conversion case).

## Jul 26, 2026 — Intake Phase 6: applicant confirmations
- `application-confirmation.ts` (super-admin-platform): named/versioned templates (email + SMS) — wording pinned by
  test to NEVER promise approval or hardware; `{{var}}` rendering; masked targets. Email on every fresh submission;
  SMS only under the recorded submission consent, E.164-normalized. Providers via the platform convention
  (SENDGRID_API_KEY/SENDGRID_FROM, TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM); when unconfigured the attempt is logged as
  'skipped' in notification_delivery_logs (tenant_id NULL) — no fake sends. Fire-and-forget from
  `publicCreateApplication` (fresh inserts only — idempotent replays never re-send; pinned by test). SA visibility:
  the existing Super Admin alerts feed already surfaces new applications; delivery rows appear in the Communications
  overview. `.env.example` documents APP_DATA_ENCRYPTION_KEY + the confirmation provider envs.
- Battery: 1497+1400+1442+1433 = **5,772 + 4 skipped, 0 failed** (+5 = confirmation spec; shard mixes reshuffle when
  spec files are added — compare totals). Platform suite 21 files / 115. All 9 gates OK, tsc 0.

## Jul 26, 2026 — Intake Phase 7: real metrics
- `GET /super-admin/platform/applications/metrics` (perm `super_admin.applications.view`; route declared BEFORE the
  `:id` routes): bounded projection (no notes/EIN), aggregated in the service — totals, 7/30-day received, by-status,
  open count, dup-flagged, spam, conversion rate, avg approval hours (from `approved_at`), follow-ups overdue
  (OPEN statuses only), by source/state/volume-band/POS/processor, reviewer workload. `avgFirstResponseHours` is
  honestly **null** — only the LATEST contact timestamp is stored today, so a first-response average can't be computed;
  the UI renders "—" (pinned by tests, incl. the empty-dataset zeros/nulls case).
- ApplicationsScreen: metrics strip above the tabs (tile 'Open review' — 'Open' collided with the row button).
  Gotcha: partial vi.mock factories crash resilient-less `.then` chains — the metrics fetch is now
  `Promise.resolve().then(...)`-wrapped and both screen test files mock the full client surface.
- Battery: 1497+1400+1442+1435 = **5,774 + 4 skipped, 0 failed** (+2). Platform suite 117. Gates 9/9. admin-web:
  both screen spec files 14 green, tsc 0, build OK (full 3-shard admin sweep queued next session-start).

## Jul 26, 2026 — Intake follow-ons: fraud signals + console correction
- **Correction to earlier notes**: the Onboarding & Approvals console EXISTS end-to-end — the HTTP surface lives
  inline in `onboarding.module.ts` (`OnboardingController`, /super-admin/onboarding, overview/list/approvals/export/
  create/detail/history/notes/documents/transition/assign/request-info/return-for-correction/decide/activate) and
  admin-web has `OnboardingScreen` (12 routes, sidebar submenu, 18 tests green). Earlier "module is headless" notes
  were an audit miss (the controller isn't in a *.controller.ts file). P5's conversion feeds it directly.
- **Fraud signals** (transparent — flagged, stored, shown to SA; NEVER auto-rejected, never revealed to applicants):
  disposable-email domains (named in the reason), suspicious phone patterns, per-IP submission velocity (≥3/24h via
  `countRecentApplicationsFromIp`), and existing-tenant email match (`activeTenantEmailExists`). Stored in
  `spam_score` + merged into the visible findings list; panel banner retitled "Risk findings — review before
  approving". Pinned: submissions save as `new`, response reveals nothing.
- Verified: platform 21 files/119 (+2), tsc both apps, 9/9 gates, screen tests 9, build OK, admin-web FULL sweep
  306+228+225 = **759 green**. Full API battery not rerun this pass — queued first thing next session.

## Jul 26, 2026 — ASUS V470 27" POS migration: validation pass + two production bugs found by REAL booting
- **PRODUCTION BUG #1 — sessions could not persist in any real browser.** The signed `aps_session` token embedded the
  full role permission list → the cookie was **6,986 bytes**, past the ~4,096-byte browser ceiling; Chromium/Edge
  silently dropped it, so login "worked" until the first reload, then `/auth/me` → 401 → back to the login screen.
  FIX (token diet, `src/auth/auth-session-token.ts`): `signSession` omits `permissions` on the wire when it set-equals
  `permissionsFor(role)`; `verifySession` re-derives it from the SIGNED role (cannot escalate — forged-role test).
  Non-default lists stay embedded verbatim (TECHNICIAN per-salon overrides; the reset flows' deliberately-empty lists);
  legacy full-list tokens still verify (no forced sign-out). Cookie now **408 bytes**; real-browser proof: stored,
  reload `/auth/me` → 200. 5 pinning tests added.
- **PRODUCTION BUG #2 — API refused to start with a database configured.** `WebAuthnModule` had no `imports`, so its
  optional `'SessionStore'` inject silently resolved undefined and the Face-ID boot guard (correctly) refused to start.
  Fix: `imports: [AuthModule]`. No static gate models Nest's module-scoped token resolution — found by the first real
  `dist/main.js` boot.
- **Viewport acceptance (the spec's hard requirement) — 60/60 PASS** via the new real-browser audit
  (`apps/api/scripts/pos-viewport-audit.mjs`, run as `AUDIT_ROUTES=first|second` halves): 10 operational screens ×
  1920×1080 @100% (primary) / 1536×864 (Win 125%) / 1280×720 (Win 150%) / 1600×900 / 1366×768 / 2560×1440 — zero
  horizontal overflow, sidebar+topbar visible, zero off-viewport controls, in the REAL logged-in app (PALACE seed).
- Layout system de-branded: "Mac-fit" → desktop-POS fixed shell (ASUS V470 primary target documented in styles.css);
  all iMac-era comments/test names swept (~12 files; mechanics unchanged — the shell was already viewport-based).
  Sidebar collapse toggle: tappable area 22×22 → 44×44 with the visible 22×22 chip preserved (::after technique).
- Harness upgrades: `browser-e2e.mjs` gained `E2E_HOLD=1`, PGlite extensions (pg_trgm/btree_gist), hardened cookie
  rewrite, and CURRENT login selectors ("Enter store code" etc. — the old ones were stale, so the click-through was
  broken against today's LoginScreen).
- End-state verification: api tsc 0 · auth suite 363 · FULL battery 1497+1400+1444+1440 = **5,781 + 4 skipped,
  0 failed** · 9/9 gates · pos-web tsc 0, build OK, full sweep **696 green**.
- Honest device-only remainder: drag-drop feel, Windows on-screen keyboard overlap, finger-scroll, touch/mouse
  switching — certify on the physical ASUS.

## Jul 26, 2026 — booking-reminder push channel (closes the last push §6.2 follow-on)
- The reminder sweep (`src/reminders/`) now ALSO pushes to the customer's app when a reminder reaches a terminal
  outcome: `dueCandidates` resolves the linked account (`customers.user_id`, tenant-scoped), and
  `RemindersService` fires `PushService.dispatchToUser` on `sent` and on `opted_out` (push is a separate,
  OS-level-consent channel — an SMS opt-out still gets the one app reminder). Retryable outcomes (provider error,
  over-limit) never push, and the `appointment_reminders_sent` set makes it at-most-once per appointment across
  runs. Walk-ins without a linked account are skipped silently; push failures never affect the SMS/email sweep;
  legacy construction without the push port is unchanged. Mirrors the payroll/queue push pattern
  (`ReminderPushLike`, optional 3rd ctor arg; `reminders.module` imports `PushModule`).
- Tests: `reminder-push.vitest.spec.ts` (5 — terminal-only firing, idempotency across runs, opt-out push,
  no-account skip, broken-transport safety) + `reminder-push.pgtest.vitest.spec.ts` (1 — real-schema resolution of
  `customerUserId` + tenant isolation of the query) + the pre-existing reminder core spec still 27/27.
- Verified: api tsc 0 · 9/9 gates · full battery 1497+1400+1435+1454 = **5,786 + 4 skipped, 0 failed** (+5 vs
  prior; the pgtest ran separately, 1 green). All push §6.2 triggers are now delivered code-side; on-device
  delivery still needs the owner-side APNs .p8 + Firebase SA.


## Jul 26, 2026 — community alert deep links now use the canonical portal resolution
- The pos.* vs app.* tenant-portal ambiguity is CLOSED in code (it was resolved earlier: `urls.tenant_portal`
  defaults to `https://pos.aipowersalon.com`, the host in DEPLOY_RUNBOOK / WEB_CORS_ORIGINS / Terraform, and
  `platform-urls-consistency.vitest.spec.ts` fails if the setting and the infra host ever drift apart again).
- Residual gap fixed: `tenant-safety-community/community-notify.ts` still carried the old "the repo is
  inconsistent" note and read ONLY `TENANT_PORTAL_URL`, ignoring the platform's canonical resolver. Its link base
  now resolves: explicit constructor arg → `TENANT_PORTAL_URL` → `common/platform-urls.tenantPortalBaseUrl`
  (APP_BASE_URL / PUBLIC_APP_URL / ADMIN_BASE_URL, else derived from the CORS allowlist) → RELATIVE path.
  The resolver's last-resort default is deliberately NOT used: it self-reports `guessed`, and a guessed hostname
  in a staff SMS is a fabricated link. Resolution moved from import-time to construction-time.
- Tests: +4 in `community-notify.vitest.spec.ts` (explicit env wins + slash-normalized; derived from CORS
  skipping admin/marketing origins; nothing configured → relative, never the guessed host; relative base still
  yields a usable link). Suites: tenant-safety-community 161, platform-urls + urls-consistency 15.
- Verified: api tsc 0 · 9/9 gates · full battery 1497+1404+1435+1455 = **5,791 + 4 skipped, 0 failed**.

## Jul 26, 2026 — POS-wide Custom Tip (audit-first; one shared calculation everywhere)
- AUDIT FIRST: most of the spec already existed and was REUSED, not rebuilt — backend `applyTip` (SetTipRequest
  tipType none|percent|custom + tipPercent + tipAmountCents + source; recomputes the subtotal FROM TICKET LINES,
  never trusting the client; `tipForPercent` + `validateCustomTip`; overwrite = replace-not-add; audited;
  `pos.checkout.add_tip` RBAC), `computeTotals` (card surcharge base correctly INCLUDES the tip), ticket-level
  authoritative tip in splits (segments must sum to the tip-inclusive due), payment idempotency-key replay,
  `ticket_tip_allocations` multi-tech distribution (UNTOUCHED), and the customer-display kiosk keypad.
- REAL GAPS CLOSED:
  · POS "Custom" was a browser `window.prompt()` → now the shared touch **TipKeypad** (packages/ui: 1-9/./0/⌫,
    $0.00 display, ≥48px keys, Cancel/Apply, cream/gold) opened as a modal in POSCheckoutScreen.
  · THREE float dollar parsers → ONE exact string parser `parseDollarsToCents` (packages/ui/money-input.ts, with
    `formatCentsUsd` + shared `keypadPress`); wired into pos-web, manager-pay-web (both float sites), and the
    customer-display kiosk keypad. `@aipowersalon/ui` aliased into all three apps (tsconfig + vite + — where the
    app has its own — vitest config; manager-pay's separate vitest.config otherwise breaks a test FILE).
  · No tip provenance persisted → migration **418**: `tickets.tip_type` (none|percent|custom) + `tip_percent`
    (0-100/NULL); `setTip` carries optional meta through port/kysely/InMemory; `applyTip` persists it + audits
    {tipCents, tipType, tipPercent, source}; all four inline pay-call tips tagged custom; the session-tip path
    tags custom too (no stale 'percent' labels); ticket reads expose tipType/tipPercent for receipts/reports.
  · **`applyTip` had NO finalized guard** → now refuses once the ticket is paid OR any payment is captured
    (partially-paid splits included): settled tips follow the refund/adjustment flow.
  · Receipts: SMS/email now show "$X (includes $Y tip)" via the exact `centsToUsd` (float `toFixed` removed).
- TESTS (new): `checkout-tip-matrix` (5 — preset 15/18/20/25% exact cents, custom $1/$17.50/$100, invalid
  negative/non-integer, replace/remove via the real service, split-with-tip pays exactly once then locks),
  `checkout-tip-provenance.pgtest` (5 on the REAL schema — percent→custom→none replaces with provenance, TENANT +
  BRANCH isolation, finalized guard, receipt body contains "$17.50 tip", payload exposure), packages/ui
  `money-input.test` (5 — every spec dollar example exact + invalid set + keystroke build), POSCheckoutScreen +2
  (keypad flow proves NO window.prompt; Cancel sends nothing). Mobile TTP verified same-calculation BY IMPORT
  (mobile-tip-split uses the canonical tipForPercent/validateCustomTip); retry-no-double pinned by the existing
  card-idempotency suite.
- HONESTLY DEFERRED: kiosk percent-presets reach the ticket as 'custom' provenance until the customer-display
  module threads true tip TYPE (amounts are exact today; display validates type server-side already).
- Verified: api tsc 0 · migrations 418/418 ✅ · 9/9 gates · full battery 1504+1405+1451+1441 =
  **5,801 + 4 skipped, 0 failed** · checkout 35 files/184 · pos-web tsc 0 + build + 212/285/201 + screen 15 ·
  manager-pay 50 · customer-display 43 · packages/ui 5.

## Jul 26, 2026 — display tip-TYPE threading (the Custom Tip arc's deferred item, now closed)
- The kiosk selection now carries TRUE provenance end-to-end. Migration **419**: `customer_display_sessions.selected_tip_type` (none|percent|custom) + `selected_tip_percent` (0-100/NULL). The customer-display
  service passes the guest's actual choice through `repo.applyTip` (session) AND a new
  `setTicketTipFromDisplay` (ticket: `tip_cents` + `tip_type` + `tip_percent`, `status != 'paid'` guarded) — a
  percent preset picked on the kiosk is no longer collapsed to 'custom', and the customer-pays terminal path can
  no longer leave `tickets.tip_cents` desynced from the payment row (the selection-time write settles both).
- Structural fakes lacking the new method are tolerated (defensive typeof check); the core spec's fake now
  records ticket-tip writes.
- Tests: `display-tip-provenance.pgtest` (2 on the REAL schema — session + ticket both show percent/20 then
  custom replacement; a PAID ticket is never touched). Seed gotcha: `customer_display_sessions.public_token_hash`
  is NOT NULL. `kysely.types` gained the session columns (types-drift gate enforced it, now OK).
- Verified: api tsc 0 · migrations **419/419** ✅ · 9/9 gates · customer-display core spec 36/36 · display +
  checkout suites 37 files/191 · full battery 1499+1410+1439+1455 = **5,803 + 4 skipped, 0 failed** (+2 = the new
  pgtest). The Custom Tip feature now has ZERO deferred items.

## Jul 26, 2026 — automated security audit workflow (audit-first; CI on every change + nightly full sweep)
- AUDIT FINDINGS FIRST: the repo already had MORE security gates than the standard 9-gate loop —
  `check:tenant` (tenant-isolation-check.mjs: every query on a tenant-scoped table must carry tenant_id in the
  WHERE or join through one), `check:impossible`, `check:sql:select`, `check:nav:deep` — all four PASS today and
  are now part of the orchestrated set. No new auth/guard/permission machinery was created (spec §21): the audit
  ORCHESTRATES what exists and adds only what was missing.
- NEW `scripts/security-audit.mjs` + npm scripts `security:fast` / `security:full` (api + root):
  · fast (every push/PR): 12 static security gates + committed-secret scan (5,266 files; values always REDACTED;
    Postgres-URL hits triaged — localhost/placeholder dev strings are suppressed, only real-looking host+password
    flags CRITICAL) + quick auth/permission suites. Verified end-to-end: exit 0, ~46s, report written.
  · full (nightly 1am + manual): fast + EVERY real-schema *.pgtest suite (52 files: tenant/branch isolation,
    provenance, payments) + per-workspace `npm audit` summary (counts only; NO auto-upgrades, spec §13).
  · Writes SECURITY_REPORT.md with spec-§19 statuses (PASSED/FAILED/NOT VERIFIED/…), severities on failures
    only, and an explicit NOT VERIFIED list (processor sandbox, live CORS/rate limiting, Twilio live, hardware).
- NEW `.github/workflows/security.yml` — Kevin's correction implemented: the fast lane runs on EVERY push and
  pull request (security regressions block at change time), the full sweep runs on the 1am cron + on demand;
  both upload SECURITY_REPORT.md as an artifact. (Cron note in-file: '0 1 * * *' is 1am runner/UTC.)
- First real run of the scanner produced a genuine triage exercise: 28 Postgres-URL hits, all verified to be
  localhost/placeholder documentation strings (README, runbooks, local scripts) — classified INFORMATIONAL and
  suppressed by rule, not by deletion. No real committed secrets found in the scanned set.
- Status at time of writing: fast lane VERIFIED (exit 0). The first full-mode run (52 pgtest suites + npm audits)
  was still executing when this entry was written — its result lands in SECURITY_REPORT.md; treat full-mode
  end-to-end as NOT YET VERIFIED until that report is read.

## Jul 26, 2026 — security audit: full-mode resharded + piecewise verification (continued)
- First-run lesson captured in-script: one vitest invocation over all 52 pgtest files thrashes (419-migration
  boot per file under worker contention, no incremental evidence). Full mode now REUSES the proven acceptance
  shape — the 4-shard battery — and gained composable flags (`--shards=`, `--skip=`, `--merge=`) so constrained
  environments can verify it piecewise while CI runs it one-shot.
- VERIFIED through the script itself: shard 1 = 1499 passed · shard 2 = 1410 · shard 3 = 1439 · shard 4 = 1455
  + 4 skipped → the full 5,803-test battery, 0 failed, each executed BY security-audit.mjs. Deny-path census
  ratchet added (RBAC-deny ≥15, scope-denial ≥25 assertions — coverage may grow, never silently shrink) and
  passing inside the fast lane (14 PASSED / 0 FAILED / 4 NOT VERIFIED).
- NOT VERIFIED (next session): the one-shot full run end-to-end (a ~15-minute single process — this environment
  kills background processes between tool calls, so it belongs to CI/cron, which is exactly the spec's
  "environments where scheduled automation is supported"); the `--merge=finalize` integrated-report path has a
  parsing bug (`--shards=` empty value) to fix; the per-workspace npm-audit summary has not yet produced a real
  run. Environment lesson recorded: `pkill -f`/`pgrep -f` with a pattern present in the calling command line
  match the caller's own shell — kill by explicit pid from `ps` instead.

## Jul 26, 2026 — security audit turn 3: dependency CVE fix + finalize protocol verified
- REAL RUNTIME FIX: **GHSA-cj7v-w2c7-cp7c (remote code execution via Content-Type header)** in
  `@nestjs/common <10.4.16` — bumped `@nestjs/common` / `core` / `platform-express` **10.3.0 → ^10.4.22**
  (in-major, non-breaking) + semver-safe `npm audit fix` at root and api. The bump duplicated rxjs
  (api-local 7.8.1 vs hoisted 7.8.2 → Observable type-identity errors); api now pins `rxjs ^7.8.2`, deduped.
- Post-fix dependency posture, runtime-only (`--omit=dev`): **critical 0 · high 12** — every remaining high is
  major-version-gated (Nest 11 chain incl. multer; kysely 0.29; the exceljs→archiver→glob/brace-expansion
  family) and DEFERRED by name per spec §13 (no risky auto-upgrades). The audit script's dependency check now
  gates on runtime criticals only while reporting dev findings in full (§20: listed, never hidden) — the
  ever-red "vitest critical (dev)" no longer masks real signals.
- Piecewise full-mode protocol VERIFIED: `--shards=` empty-value bug fixed ('' now means "run none"), env lines
  deduped in `--merge`; fresh append→finalize produced the integrated 26-check report with an honest exit 1.
  (Also recorded: the earlier "1-entry report" was terminal pipeline rc-masking — `timeout … | tail` hides the
  kill — not a merge failure.)
- Post-bump regression evidence: full battery **1499+1410+1439+1455 = 5,803 + 4 skipped, 0 failed** · **10
  gates OK** (`check:tenant` now part of the standard loop) · pos-web/admin/manager/display/customer-web tsc 0 ·
  pos-web build OK · orchestrated `security:fast` end-to-end: **15 PASSED / 0 FAILED / 4 NOT VERIFIED**, exit 0.

## Jul 26, 2026 — Security Audit Engine (persistent, in-platform: the production 1am architecture)
- Kevin's correction implemented: a scheduled prompt is not production security automation. The platform now has
  its own engine: **1:00 AM → run (advisory-locked) → checks → findings DEDUPLICATED by fingerprint → new
  critical/high findings escalate ONCE into the EXISTING security_incidents Super Admin workflow (review → fix →
  close, state machine from migration 265) → findings that stop appearing AUTO-RESOLVE (re-verify) → history.**
- Migration **420**: `security_audit_runs` + `security_audit_findings` (fingerprint UNIQUE; open/reopened/resolved;
  FKs to runs + incidents). New `src/super-admin-security/audit-engine.*` (core/repository/kysely/service/
  scheduler/controller) wired into the EXISTING SecurityModule — no duplicate module, guard, or review system.
- Semantics worth knowing: recurrences bump `occurrences` (no incident spam); a REOPEN never re-escalates (the
  incident is already open); a crashed check becomes a HIGH finding; a crashed run records an honest `failed` row;
  a >26h gap since the last completed run is itself a finding (failure detection); concurrent instances skip via
  `pg_try_advisory_lock` (the platform's existing lock idiom). Scheduler mirrors CustomerImportScheduler:
  `SECURITY_AUDIT_WORKER_ENABLED` gates it, fires in the 01:00 local hour when the last run is >20h old.
- Checks shipped: production env hygiene (default/weak AUTH_SESSION_SECRET **critical**, dev MFA_ENC_KEY
  **critical**, PAYMENTS_SANDBOX in prod **high**, missing APP_DATA_ENCRYPTION_KEY **high**), Super Admin
  accounts without confirmed MFA (**high**, spec §7), approved payments missing idempotency keys in 7 days
  (**medium**), schedule-gap (**medium**). Endpoints (SuperAdminGuard): `POST /super-admin/security/audit/run`,
  `GET …/runs`, `GET …/findings`.
- Verified: migrations **420/420** ✅ · engine unit spec **7/7** · real-schema pgtest **3/3** (5 findings
  FK-linked to real incident rows with correlation_id=fingerprint; dedupe across runs; fix + MFA enrollment →
  all auto-resolved) · security-module suite **61** · **10 gates OK** · full battery
  **1506+1413+1453+1441 = 5,813 + 4 skipped, 0 failed**.
- Harness note (documented in the pgtest): IncidentService's Kysely transaction does not commit under the PGlite
  test driver with all migrations loaded — raw and minimal-Kysely transactions both commit, so this is a test-
  harness interaction, NOT an observed production behavior; the pgtest inserts incident rows via raw SQL so the
  FK/correlation evidence stays real, and the IncidentService-on-PGlite path is marked NOT VERIFIED.
- NOT VERIFIED: live 1am firing + multi-instance lock contention (deployed environment only).

## Jul 26, 2026 — Security Audit Engine: Super Admin visibility (extends the EXISTING SecurityScreen)
- The Security & Compliance screen (route `security-compliance`) gained an "Automated Security Audit" section:
  recent runs (trigger/status/open/resolved), the deduplicated findings table (severity chip, status, occurrence
  count — one row per fingerprint, never a nightly spam list), and a "Run audit now" button wired to
  `POST /super-admin/security/audit/run`. An advisory-lock skip is surfaced honestly ("another instance is
  running…"), never shown as success. New `superAdminApi` methods: securityAuditRun/Runs/Findings.
- No new screen, route, or module — §21: the section lives inside the existing SecurityScreen next to the
  incidents workflow where critical/high findings already arrive.
- Verified: admin-web tsc 0 · build ✅ · SecurityScreen suite 6 (incl. the two new section tests) · full
  admin-web battery 306+228+227 = **761, 0 failed** · dead-client/crosswire/nav gates OK (the new client methods
  are provably reachable).

## Jul 26, 2026 — engine checks §6/§9 + a flake class fixed at the root (and a near-miss worth recording)
- Security Audit Engine gained two grounded check families: **webhook secret hygiene** (Twilio configured with a
  missing/placeholder TWILIO_AUTH_TOKEN → HIGH, since X-Twilio-Signature validation on inbound/status callbacks
  cannot work; AI billing webhook scheme enabled with a placeholder AI_BILLING_WEBHOOK_SECRET → HIGH) and **CORS
  allowlist sanity** (wildcard in production HIGH; non-TLS non-localhost origin MEDIUM; WEB_CORS_ORIGINS unset
  MEDIUM). Production-only, silent in dev. +3 unit blocks; both engine suites' fixtures updated — the pgtest now
  proves 6 findings with exactly 5 incident links (the medium CORS finding stays findings-only).
- Flake class root-caused and fixed: the clean-extract pgtest failure reproduced deterministically as **"Hook
  timed out in 10000ms"** — the 420-migration PGlite boot in beforeAll outgrew vitest's 10s default. Fix:
  `hookTimeout: 120_000` in apps/api/vitest.config.ts.
- NEAR-MISS (recorded so nobody repeats it): adding that timeout initially OVERWROTE the existing
  vitest.config.ts, which carries the include pattern (`src/**/*.vitest.spec.ts`) and node environment — losing
  it would have silently changed which files the battery runs. The original was recovered verbatim from the
  delivered zip and only the hookTimeout line merged in; the full battery re-run below is the proof of faithful
  restoration. Lesson: check `ls` output BEFORE `cat >` onto a config path.
- Battery note: the 4-way shards have outgrown this sandbox's per-call window — **8-way sharding is now the
  in-sandbox standard** (CI's one-shot runs are unaffected). Full battery, restored config + new checks:
  778+731+711+702+690+763+781+660 = **5,816 passed + 4 skipped, 0 failed** (+3 = the new engine tests) ·
  **10/10 gates OK** · `security:fast` 15 PASSED / 0 FAILED, exit 0 (38s).

## Jul 26, 2026 — Customer Identity: global identity, real-time duplicate prevention, 7 PM reconciliation
ARCHITECTURE (Kevin's rule is structural, not a policy note): `customers` remains THE TENANT RELATIONSHIP —
notes, loyalty, memberships, appointments, transactions, preferences all stay in the tenant's own row and
satellite tables and are NEVER copied between salons. The identity layer sits ABOVE it: one `global_customers`
row per real person, one `customer_global_links` row per (tenant, customer). Nothing in this arc writes tenant
data; only links and global identity fields move.

- Migration **421**: `global_customers` (PARTIAL UNIQUE on verified phone / verified email — the §8 concurrent
  duplicate race collapses at the database), `customer_global_links` (customer_id UNIQUE = idempotent),
  `customer_recon_runs` + `customer_recon_tenant_stats`, `customer_identity_conflicts` (fingerprint-deduped,
  masked values). Plus `ix_customers_tenant_updated` for the incremental cursor.
- **identity-core.ts** — one pure core. Phone normalization DELEGATES to the existing customer-activation
  normalizer (three other legacy normalizers exist; this adds no fourth). §6 confidence ladder (name-only never
  exceeds weak), §7 CASE A/B/C, §11 field ownership, §12 verified-over-unverified, §30 stale-write guard,
  timezone-correct 19:00 America/New_York scheduling, §38 missed-run detection.
- **Real-time prevention (§7/§8)** at every real customers-insert site: POS Customers, Check-In (both paths),
  Queue walk-in, Customer App registration (links AFTER the tx commits; ids never leak to the client). CSV
  import is deliberately reconciliation-owned (bulk insert returns a count, not ids) — documented in code.
  Every hook is best-effort: identity linking can never fail a salon's own workflow.
- **7 PM engine**: advisory-locked, INCREMENTAL (§29 — unlinked or changed-since-last-completed-run only, keyset
  pages of 200), per-tenant failure isolation → PARTIAL (§26), honest status ladder, fingerprint-deduplicated
  conflicts, §38 watchdog. Scheduler gated by `CUSTOMER_SYNC_WORKER_ENABLED`, timezone `PLATFORM_TIMEZONE`.
- **§9/§10/§12/§30 propagation**: verified phone changes (sms_otp ONLY — a manual confirmation is
  `active_unverified` and must never overwrite a verified global value) flow into the global identity; a value
  already held by another identity becomes a CONFLICT, never a merge; writes are version-guarded; casing-only
  changes are no-ops.
- **§24 merge**: explicit confirmation, legal holds consulted first, and REVERSIBLE — the source identity is
  retired (`status='merged'`, `merged_into_id`), never deleted, links repointed in one transaction. Preview shows
  masked values and relationship COUNTS only.
- **Super Admin** (§20/§21/§22/§35/§36/§37): eight endpoints inside the EXISTING Customer Data Oversight
  controller — no new sidebar module — with five granular `super_admin.customer_sync.*` permissions (§34; OWNER is
  "everything except super_admin.*", so tenant staff can never reach the global directory). Screen section shows
  dashboard, run history, tenant-by-tenant drill-down, conflicts, and manual/scoped re-sync.
- **§25 audit**: CUSTOMER_GLOBAL_CREATED / _LINKED / _DUPLICATE_PREVENTED / _DUPLICATE_FLAGGED /
  _CONFLICT_CREATED / _PHONE_UPDATED / _EMAIL_UPDATED via the existing AuditService — masked values, run id
  carried, best-effort so audit never breaks identity.
- VERIFIED: migrations **421/421** · api battery **5,872 + 4 skipped, 0 failed** (8 shards) · **10/10 gates** ·
  admin-web **764** (309+228+227) · all five frontends tsc 0 · identity + SA suites 19 files / 121 tests.

## Jul 27, 2026 — customer sync hardening: the four open items
- **(2) Concurrent runs — a second, DATABASE-enforced guard.** Real multi-instance contention could not be tested
  here (no installable Postgres; PGlite is one session and advisory locks are re-entrant within it — verified,
  not assumed). Investigating why the advisory lock could fail in production found a genuine hole:
  `pg_try_advisory_lock` is SESSION-scoped, and a transaction-pooling connection pooler can route the next
  statement to a different backend, making the lock invisible — two instances would both believe they hold it.
  Migration **422** (`ux_recon_single_running_all`) expresses the invariant where it cannot be bypassed: at most
  one RUNNING platform-wide run. A second insert fails and the caller reports an honest skip instead of
  double-processing the fleet. Scoped re-syncs are deliberately exempt so support is never blocked.
- **(3) Scale (§28) — measured on the real schema.** Seeded 1,000 tenants / 50,000 customers, then timed the exact
  queries the engine issues: cold page 2ms, incremental page (all linked, nothing changed) 4ms returning 0 rows,
  keyset page-2 2ms; identical at 200 tenants/10k. Cost tracks CHANGED rows, not total, and the plan uses a
  bitmap index scan on `customers` (via `ix_customers_tenant_updated`), not a sequential scan. CAVEAT: PGlite on
  one machine is not production Postgres under concurrent load — this proves the algorithm and index shape, not
  throughput on real hardware.
- **(4) Scoped RE-SYNC now forces re-examination** (was a no-op). `customersToReconcile` gained a `force` flag used
  by tenant/customer-scoped runs; the nightly platform pass stays incremental. Re-examination compares the record
  against its linked identity and raises a masked **LINK_MISMATCH** review row when the mapping no longer matches
  — surfaced for a human, never silently repointed.
- **(5) Imports link inline, bounded.** After a commit, up to 500 still-unlinked customers are linked before the
  response returns; the overflow stays for the nightly pass. The import result now carries `identityLinked` and
  `identityDeferred` so the operator sees what is actually linked rather than assuming.
- Also: the 7 PM scheduler gained an injectable clock, and `customer-sync-scheduler.vitest.spec.ts` drives the
  PRODUCTION `tick()` through simulated multi-day calendars — exactly one run per day inside the 19:00 local hour
  across **both DST transitions** (Nov 1 2026 and Mar 8 2026), `PLATFORM_TIMEZONE` honoured (19:00 Pacific proves
  it is not hardcoded to Eastern), one deduplicated watchdog alert, and no overlapping runs. Deployment runbook:
  `docs/handoff/VERIFY_7PM_CUSTOMER_SYNC.md`; env vars documented in `.env.example`.
- VERIFIED: migrations **422/422** · api battery **5,894 + 4 skipped, 0 failed** · **10/10 gates** · customer
  identity suites **12 files / 74 tests**.

## Jul 27, 2026 — Platform-wide real-time data synchronization standard (Kevin's 57-section spec)
AUDIT FIRST (§1): substantial infrastructure already existed and was REUSED, not duplicated — the SSE transport
(`/realtime/stream`, TenantAuthGuard, server-derived tenant+branch rooms, session-revocation guard, 25s heartbeat),
the REALTIME emitter port with in-process + Redis fan-out implementations (§22, env-gated), an event catalog with a
tested event→screens map, 68 emit sites across 15 modules, and a shared POS client + useRealtime hook on 11 screens.
This arc hardened that layer and closed the gaps:

- **§12/§19/§20 envelope + ordering**: standard EventEnvelope (eventId/type/tenant/branch/resource/updatedAt/
  version) with a recursive PII guard (phone/email/notes/card keys can never ride an event); EventTracker (LRU-
  bounded) drops duplicate eventIds and stale versions — version 10 after 11 is provably discarded; RefetchCoalescer
  turns a 15-event burst into ONE refetch (§31). Mirrored in both cores, tested in both.
- **§15-§18/§29/§30 client resilience (POS)**: the EventSource is now a MANAGED connection — owned reconnects with
  exponential full-jitter backoff (native fixed-interval retry is herd-prone), CONNECTED/RECONNECTING/OFFLINE/
  DEGRADED states with an invisible-until-needed status pill, reconcile-on-gap (§15, never assume no events were
  missed), ≥30s-hidden wake handling with a forced reopen (§16/§17 — a slept laptop's socket is dead but silent).
- **§14/§38 one hook = the whole default policy**: useRealtime gives every screen coalesced event refetches, an
  immediate reconcile refetch, and a 45s visible-only fallback; hidden/unmounted modules cost nothing. §39's
  prohibited pattern was found live (Live Technician Schedule polled everything every 10s) and removed. §5 reports:
  useReportCadence (2-min visible-only + event + Refresh button) adopted across ALL report screens. §4 dashboards
  ride the same hook.
- **§33/§34/§35 observability**: RealtimeMetrics lives inside the emitter (delivered/dropped, connections,
  Last-Event-ID reconnects, events/min, P50/P95/P99 of envelope-created→delivered); System Status gained the
  REAL-TIME SYNCHRONIZATION panel + per-tenant diagnostics ("my Booking page isn't updating") exposing room KEYS
  and event NAMES only — never tenant content. Scope is stated honestly: per-node metrics.
- **Missing emits closed**: Booking now actually publishes appointment_created/updated/cancelled (+rescheduled) —
  the catalog had the names, nothing sent them; tech-appointments likewise; customer_profile_updated added to both
  catalogs and emitted with an ID-ONLY envelope (§3 targeted invalidation — the changed phone/email never rides).
- **Owner + Tech apps ported** to the same resilience (jittered reconnects, reconcile, wake, visible-only
  fallbacks). Consumer-filter trap fixed: five screens filtering by event prefix would have DROPPED the reconcile
  signal — a woken owner tablet would never have caught up.
- **§46/§47/§50/§54 battery**: transport-level isolation (Tenant A → A only, B receives NOTHING; branch A ↛ branch
  B; multi-device; teardown honesty) + hook-level fallback/coalescing/immediate-reconcile.
- VERIFIED: api battery **5,910 + 4 skipped, 0 failed** (795+724+731+712+700+784+790+674) · 10/10 gates ·
  admin-web + pos-web builds · pos-web 703+9 · owner-web 262 · tech-web 114 · all apps tsc 0.
- NOT VERIFIED (deployed environment only): live SSE end-to-end on a real host; sleep/wake on physical hardware;
  §53 load/scale numbers (no 10,000-tenant readiness claim is made); multi-node Redis fan-out under real traffic;
  envelope adoption at the 68 pre-existing emit sites (incremental — the client passes unversioned frames through).

## Jul 27, 2026 — Login identifiers, phone invitations, and a platform-wide frontend cleanup
Two functional changes and one systematic cleanup pass. No new features; behavior was preserved everywhere,
never normalized away (optional stayed optional, required stayed required, minimum lengths stayed enforced).

### Email OR phone as a first-class login identifier
Sign-in always accepted both (the identifier is normalized, then matched against lower(email) or the E.164
`normalized_phone`, scoped to the store). **Setup did not**: the admin invite path only ever wrote `email`, so a
staff member "set up with a phone" could never sign in with it. Both invite paths now take an email, a phone, or
both — at least one required — normalizing the phone with the same function the login path uses, so any typed
format resolves to the one stored value. A same-salon duplicate phone is refused (it would make sign-in
ambiguous); the same number in a different salon is fine, because the lookup is tenant-scoped. The token
invitation path (accept-link) is phone-capable too and sends by SMS when only a phone is given; resend now uses
the invitation's own channel and address (it was hardcoded to email, so an SMS invite re-sent to an empty
string). No migration was needed — 379 had already made the schema phone-ready ahead of the code.

### Frontend cleanup (all five apps: POS, Admin, Owner, Tech, Customer)
- **Money parsing unified.** One exact string parser (regex-validated, integer math, null on invalid) now backs
  every dollars→cents input; the old `parseFloat × 100` path silently accepted `1e3`/`12.345` and, on several
  screens, sent NaN to the API. 29 sites migrated. Sites with downstream validity guards propagate null/NaN
  rather than defaulting to zero — a test caught that a bare `?? 0` would have created silent $0.00 records.
- **No native dialogs.** All 29 `window.prompt()` and 22 `window.confirm()` calls replaced by two shared,
  brand-styled components. The confirm dialog keeps native confirm's safety properties and adds the ones it
  lacked: the action fires only from the confirm tap, **Cancel holds focus** so a reflexive Enter can't destroy
  anything, Escape cancels, the scrim is inert, and destructive actions are visually distinct. This also removed
  two local helpers that returned "yes" when `window.confirm` was unavailable — destructive actions would have
  executed unprompted in any such environment.
- **Audits with no findings** (recorded so they aren't re-run blindly): every in-app navigation target resolves
  (198 routes, 0 dead, 0 duplicates); every referenced brand/icon asset exists; sidebar groups and top-bar
  controls match the reference mockups; colors are logo-true.

VERIFIED: api battery **5,925 + 4 skipped, 0 failed** · 10/10 gates · migrations 422/422 · pos-web 707 ·
admin-web 766 · owner-web 262 · tech-web 114 · customer-web 265 · all apps tsc 0 + builds clean.


## Jul 27, 2026 (late) — react-router v7 future flags opted in
All five frontends now mount `<BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>`.
This was trialled before it was applied: both flags were flipped in pos-web alone, the full suite and build were
run green, and the change was reverted — only then applied for real across the five apps.

Why it is safe here:
- **v7_relativeSplatPath is inert in this codebase.** It changes how relative paths resolve INSIDE splat routes.
  The only splat routes are the `path="*"` catch-alls that render `<Navigate>`, and nothing in any app resolves a
  relative path within one (no `useResolvedPath` / `useHref` / `to="../"` outside tests).
- **v7_startTransition** only wraps router state updates in `React.startTransition`.

What it buys: the console warnings disappear in the browser, and the eventual upgrade to react-router v8 becomes a
no-op instead of a behavioural change discovered at upgrade time.

What it does NOT do: silence the same warnings in test logs. Those come from the ~271 `MemoryRouter` renders inside
the test files themselves, not from the app entry points — silencing those would mean touching every test's router,
which is not worth it.

To revert: delete the `future` prop from the five `src/main.tsx` files. Nothing else depends on it.

VERIFIED under the flags: all five apps tsc 0 + production build; pos-web 707 (380+327), admin-web 766
(311+228+227), owner-web 262, tech-web 114, customer-web 265; 12/12 integrity gates.


## Jul 27, 2026 (late) — Retail products are sellable
The salon could stock retail, price it, and report on it — but could not sell it. Everything downstream of a
retail sale had existed for months (`line_kind='retail'` since migration 131, the compensation engine's separate
retail-commission treatment, Checkout's Upsell Mix and retail revenue slice, inventory's `retail_sale` movement
type). Nothing could ever WRITE one: the only ticket-line writer inserts a service line, and
`ticket_service_lines.service_id` was NOT NULL with no product column.

**Migration 423** — `service_id` nullable, new `product_id`, and a CHECK that a line is EITHER a service OR a
product (never neither). Additive: every existing row already has a service_id.

**Selling** — `POST /pos/serving/tickets/:id/add-retail`, behind the same permission as editing services. The
request names a product and a quantity; **the server prices the line from the salon's own catalog**. A product
with no retail price is refused rather than sold for $0, as are back-bar (non-retail) stock and another tenant's
products. A fractional quantity is rejected, not silently truncated. A retail line adds NO duration to the
appointment.

**Picking** — `GET /pos/serving/retail-catalog` returns only id/name/price, behind the same permission as the
sale. Deliberately NOT the inventory products endpoint, which requires `inventory.view` (a front-desk user may
not have it) and exposes cost. In the POS, each ticket gains a "Sell Product" button, and the previously stubbed
"Add Upsell" quick action — which only printed a message — now opens the real picker.

**Stock** — a sale consumes inventory units (stock is unit rows even for quantity-tracked products;
`quantity_on_hand` is a derived cache), oldest sealed first, flipped to a new `sold` status that the existing
count function already treats as off-hand. One `retail_sale` movement records the decrement against the ticket.
A short sale does NOT fail: the guest is at the counter and the money is real, so we consume what exists and
write the shortfall into the movement's reason rather than blocking the sale over a stale count. Stock moves
after the line is written, best-effort — inventory is never load-bearing for taking money.

**Tax** — tax is one salon-wide rate applied to the whole subtotal; there is no per-item taxability column. A
retail line is therefore taxed exactly like a service line, automatically. Whether products SHOULD be taxed
differently from services is a jurisdiction question for the salon's accountant, not a decision this code makes.

VERIFIED: api tsc 0 · 12/12 gates · migrations 423/423 · serving 35 · serving+checkout 220 · compensation+checkout
389 · pos-web 707 + build.


## Jul 27, 2026 (late) — Per-picture screen audit: all 19 POS screens vs the mockups
Asked whether every screen was "fixed and bug free", the honest answer was no: the SHELL had been verified
(sidebar wiring, top bar, colors) but no screen's BODY had ever been compared to its picture. This closes that.

**Scorecard.** 13 screens match their mockup (Check-In, Booking, Tech Queue, Serving, Service Done, Checkout,
Customer Queue, Customers, Team, Services & Products, Memberships, Devices & Integrations, Account). 2 are
thinner than the mockup (Communications, Help Center) — missing panels/metrics, not broken wiring. 4 differ
architecturally (Reports, Management, AI Center, Marketing & Growth): the mockups show one composite dashboard
per sidebar group, while the app splits each group across dedicated child screens.

**The defect class this found: controls that only print a message.** 30 of them, across 8 screens — an onClick
that calls setNote/setMsg/setToast and never touches an API or navigates. They are invisible to every existing
check: they render, they typecheck, tests pass, and no gate flags them. Some were honest ("isn't connected
yet"); the rest LIED — "Privacy-safe service ticket sent to the printer", "Receipt preview opens", "Staff alert
composer opens". The lying ones are the bug.

Fixed: three Serving controls wired to endpoints that already existed (Add Note → updateNotes, Move Tech →
assignTechnician, Add Upsell → the retail picker), and Memberships' "View All Plans" wired to
GET /pos/memberships/plans, which had been live all along behind a message promising "an upcoming release".
Every remaining message now states what is true and points at the real path where one exists.

Two further fake-control shapes were swept platform-wide and are clean everywhere: empty/void handlers and
href="#" (0), and unwired "View All" panel links (0 of 5).

NOT changed, deliberately: the architectural differences and the two thin screens are unbuilt features and a
product decision, not bugs — building them is the opposite of "fix bugs, do not build new".

VERIFIED: pos-web tsc 0 · build · 707 (380+327) · 12/12 gates.


## Jul 27, 2026 (late) — Marketing & Growth landing + honest missed-call displays
**Marketing & Growth has a home.** `/tenant/marketing` was the only sidebar group landing that was a bare
redirect (to Campaigns); every other group lands on something real. The new landing composes what already
exists — the marketing report (campaigns + promotions + reviews, already composed server-side), loyalty,
referrals, and gift cards — and **computes nothing**: every tile links to the screen that owns that metric.
A composite that re-derives its children's KPIs computes the same number twice and the copies drift; this is
also why only ONE of the four mockup dashboards was built. Management Overview and the AI Command Center already
are their group's dashboard, and Reports' finance-first strip is more useful to an owner than the mockup's.

Sections load independently — a loyalty outage cannot blank the campaign figures — and a section that fails says
so rather than rendering a zero. Loyalty "Points Outstanding" and gift-card "Outstanding Balance" are labelled
as liabilities, because that is what they are: money the salon owes.

**Missed-call displays now tell the truth.** An audit of the recommended Missed Call Recovery Queue found the
premise wrong: `voice_call_outcomes` deliberately stores NO caller number (metadata only; transcripts and
recordings are consent/retention-gated elsewhere), and nothing in the voice pipeline ever opens a
`communication_threads` row for a call. So the queue is a data-capture feature plus a privacy decision, not a
view over existing data — it was NOT built. What was fixed is the reporting that could never populate:
- the Overview's missed-calls tab said "No missed calls", which reads as a quiet phone; it now says tracking
  isn't connected, and the board carries an explicit availability flag with the reason;
- Communications' "Missed Calls" KPI counts threads a person marked missed, not lost phone calls — relabelled
  "Missed" / "Missed Threads", and the panel now names the actual blocker.

VERIFIED: pos-web tsc 0 · build · 710 (380+330) · 12/12 gates · api overview suite green.

## Jul 28, 2026 — Guarantee proration: zero-denominator fail-safe + real attendance facts
The open decision recorded Jul 27 ("a zero denominator must not silently prorate the guarantee to nothing —
forward-only recommended") is implemented as recommended. What was actually wrong: `prorateGuarantee` returned **$0**
on a zero/unknown denominator, `by_eligible_days` did the same, and payroll's auto-build passed no attendance facts at
all — so every hours/days-prorated guarantee (and every `min_hours_required` policy) silently zeroed out in a real
payroll build.

- **Fail-safe:** an unknown/zero denominator now pays the **FULL guarantee**, with `prorationNote` on the result
  saying why ("Scheduled hours not on record — full guarantee applied, not prorated"). "Cannot prorate" is not
  "prorate to nothing"; withholding a guarantee from someone who didn't work is the job of the eligibility levers
  (`require_clocked_in` / `min_hours_required`), not of a 0/0 ratio. The preview endpoint passes the whole result
  through, so the note surfaces there unchanged.
- **Real facts:** `AutoBuildPorts` gained an optional `periodFacts` port, implemented in `PayrollAutoBuildAdapter`
  from `technician_shifts` — worked hours from actual punches, eligible vs scheduled days, tenant+period+branch
  scoped, best-effort (a facts failure can never fail a payroll build; it just falls back to the fail-safe).
  `by_eligible_days` now prorates on real data. `scheduledHours` is **deliberately never supplied** — the schema
  models a shift as a date plus actual punches, so any scheduled-hours figure would be fabricated; the hours modes
  therefore fall back honestly with the note until scheduled hours are modeled (a product decision).
- **Eligibility now sees truth:** `min_hours_required` works on real worked hours (it previously always zeroed the
  guarantee, since hours never flowed). `require_clocked_in` flips from vacuous-true to real attendance — a
  technician with zero worked shifts is now correctly withheld. That is the one direction-reducing change, and it is
  the salon's explicitly configured lever doing its job.
- **Forward-only by construction:** guarantees are computed only when a **draft** period is built; finalized/paid
  periods are locked and untouched. No migration.

VERIFIED: api tsc 0 · 12/12 gates · full battery 8 shards **5,953 + 4 skipped, 0 failed** (+18 = exactly the new
tests: engine 2, guarantee 7, autobuild 5, real-PG pgtest 4) · compensation 223 · payroll 14. Frontends untouched.

## Jul 28, 2026 — phone normalizers consolidated: one per stored-data family + a real reset bug fixed
The customer-identity note said three legacy phone normalizers remained. The audit found the honest picture is TWO
stored-data families, and that blindly unifying them would break logins:

- **Staff family** (`users.normalized_phone` — login, invites, password reset): `auth/security.normalizeIdentifier`
  is the writer, so it is the source of truth. **Password reset now delegates to it.** Reset previously used a
  third, stricter US-only normalizer — so a staff member stored with a non-US number could sign in but never
  password-reset, and a "+"+10-digit input reset against a value that matched nothing stored. Both fixed; a phone
  that can sign in can now reset.
- **Customer family** (customers / global identity): `customer-activation-core.normalizePhone` (via
  `identity-core.normalizePhoneE164`) — already the single source; unchanged.
- **The two families deliberately stay separate.** They diverge on exactly one input — "+" followed by 10 digits
  (staff treats it as US; customer preserves the "+") — and each family must keep matching the values IT stored.
  Unifying the functions therefore requires re-normalizing stored data: an owner decision, not a refactor.
  `src/auth/phone-normalization-parity.vitest.spec.ts` (16 tests) pins reset===login across representative inputs
  and fails on any NEW cross-family drift beyond the single known case. The stale "mirrors" comment in
  customer-activation-core is corrected.
- **CSV import's `normalizeImportPhone` is not a legacy normalizer** — it is deliberately tolerant because import
  is reconciliation-owned (the 7 PM engine normalizes/links later). Now commented as such so it isn't "fixed".

VERIFIED: api tsc 0 · 12/12 gates · auth+activation+identity+customers suites 548 · full battery 8 shards
**5,969 + 4 skipped, 0 failed** (+16 = exactly the parity spec). No endpoint, migration, or frontend change.

## Jul 28, 2026 — scheduled hours derived from the EXISTING template + Memberships promoted per mockup 11
Two of the parked decisions executed. The scheduled-hours audit found the modeling already existed — since
**migration 003**: `technician_schedules` (weekly template: day_of_week 0=Sunday, TIME start/end, lunch window,
is_working, tenant/branch-scoped) plus `technician_blocked_times` (035), with a permission-gated write path
(`PATCH /pos/technicians/:id/schedule`) and the Staff Schedule screen. Nothing new was modeled; what was missing
was only the derivation into guarantee facts:

- New pure `compensation-scheduled-hours.ts`: scheduled hours/days for a period = the weekly template expanded
  across the period's dates, minus blocked windows per date; lunch subtracted when both bounds exist; same-weekday
  rows SUM (multi-branch schedules on a tenant-wide period); a day never goes negative; a fully blocked day drops
  out of scheduledDays. Returns **null** for an empty/non-working template — never a fabricated denominator.
- `PayrollAutoBuildAdapter.periodFacts` layers it in, separately guarded: template present → `scheduledHours` +
  template-derived `scheduledDays` (the true denominator); absent or failing → punch-derived facts stand and the
  Jul-28 fail-safe pays the full guarantee with its note. **The hours-based proration modes now genuinely prorate
  for any salon that has configured Staff Schedule**, and remain fail-safe for salons that haven't.
- **Memberships is now its own top-level sidebar group** (mockup 11), directly after CUSTOMERS. The route is
  unchanged (`/tenant/customers/memberships`) so deep links, tests, and the screen are untouched — placement only.

VERIFIED: api tsc 0 · 12/12 gates · scheduled-hours spec 8 + facts pgtest 6 · pos-web tsc 0 + 710 (380+330) ·
full api battery 8 shards **5,979 + 4 skipped, 0 failed** (+10 = exactly the new tests).

## Jul 28, 2026 — Help Center wired to the backend it always had
The screen's own header claimed "there is no ticketing system, articles CMS, video library or uptime monitor wired
up" — **stale**. All of it has existed server-side for months: `help_articles` with view counts (migration 130),
video guides, the full support-ticket system with SLA stats and priorities, a DB-probed platform status, and the
`product_updates` release feed (147, whose header says it exists FOR these Help Center panels). The screen was
entirely client-side and — an invariant §10 violation — hardcoded "System Status: Operational" in green.

Wired (client-only; zero backend changes): a real KPI strip (articles, video guides, open tickets, awaiting first
response, live overall status, updates count — loading `…`, failed `—` with "could not be loaded", never invented);
**Popular Articles** sorted by real view counts with an honest "no articles published yet" empty state; **Recent
Product Updates** from the release feed; a working **Submit a Support Ticket** form (subject required, priority,
posts to the real ticket system, prepends to "your tickets"); and a **System Status card driven by the real probe**
— components, incident count, and an explicit "status is unavailable" state instead of green when the probe itself
fails. The curated topic search and deep-nav quick actions were kept — they were the good part.

**The crosswire gate caught a real would-404 during this work**: the help controller mounts at `tenant/help`, and
the new client first called `/help/*`. Fixed before shipping; 1,910/1,910 calls wired, 0 orphaned.

VERIFIED: pos-web tsc 0 · Help screen suite 5 · full pos-web 713 (383+330) · production build · 12/12 gates.
API untouched — its 5,979-battery from earlier today stands.

## Jul 28, 2026 — Communications activity metrics (mockup 19's KPI strip, from real sources)
The Communications KPIs were thread-centric (total / open / unread / replied / missed). The mockup asks for
volume-and-quality metrics. Each is now read from a source that actually exists, via new
`GET /pos/communications/activity` (permission-gated, tenant-scoped, fail-soft per metric):

| Metric | Source |
|---|---|
| Messages Sent Today | `communication_messages` outbound today (migration 114) |
| Campaign Delivery Rate | `campaign_delivery_rollups` delivered ÷ attempted (241, tenant campaigns only) |
| AI Calls Handled | `voice_call_outcomes` in window (299) |
| Review Requests Sent | `review_requests` in sent/delivered/converted (343) |
| Avg Response Time | `communication_messages`: inbound → first outbound in the same thread |
| Rebooking Conversion | **none — reported unavailable by design** |

**The rule these are built on: an absent SOURCE must never render as a zero MEASUREMENT.** Every metric carries an
`available` flag with a reason, and the screen renders `—` plus "not tracked yet" rather than a number. Zero
attempted campaign messages is not a 0% delivery rate; nothing answered yet is not a 0-minute response time; and a
thread still awaiting a reply contributes nothing to the average, because it is neither a fast response nor a slow
one. Genuine zeros still show as zero — a salon that sent no messages today sees 0, not `—`.

Rebooking conversion is unavailable **even against a full database**: nothing links a rebooking to the campaign that
caused it (`ai_revenue_attributions` covers AI-influenced revenue only), so the figure would have to be invented.
Same stance as the missed-call displays. Building it means modelling campaign→booking attribution first.

VERIFIED: api tsc 0 · 12/12 gates · activity spec 12 + real-PG pgtest 5 (incl. cross-tenant isolation on every
metric) · communications module 36 · full api battery 8 shards **5,996 + 4 skipped, 0 failed** (+17 = exactly the
new tests) · pos-web tsc 0 + 714 (384+330).

## Jul 28, 2026 — customers.normalized_phone: one write semantic, tolerant reads (normalizer unification)
The remaining half of the normalizer work. The audit found the customer family had one canonical E.164 normalizer
**and four customer-creation sites that ignored it**: POS customer create, Queue walk-in, Check-In, and
Technician→customer each wrote `.replace(/[^\d+]/g,'')` into `customers.normalized_phone` — storing `5551234567`
where activation and the identity layer store `+15551234567`. Same column, two shapes.

**No live mismatch resulted**, and the reason is worth recording: the go-check-in lookup compares the last ten
digits rather than the whole string, and the customer-identity layer re-normalizes from `phone_display` at read
time, so neither path ever compared the two shapes directly. It was fragile rather than broken — the first
exact-match lookup added against that column would have silently missed half the rows.

Now: one writer, `toStoredCustomerPhone`, used by all four sites. It normalizes to E.164 when the input parses as a
phone and **falls back to the historical strip-only value when it doesn't** — a number the salon typed is never
nulled just because it won't parse. `phoneDigitsMatch` is the documented tolerant comparison for readers.

**Stored rows are deliberately NOT rewritten.** A migration would have to guess what the original typed input was
from a value that has already lost it — `5551234567` could be a US number or a truncated international one. Legacy
and new rows are proven to resolve to the same customer through the tolerant read instead, which is what makes
changing the writer safe without touching data.

VERIFIED: api tsc 0 · 12/12 gates · parity spec 21 (was 16; +5 write-semantic tests incl. legacy↔new matching) ·
customers/queue/technicians/check-in/activation/identity suites 241 · full battery 8 shards **6,001 + 4 skipped,
0 failed**.

## Jul 28, 2026 — eligible-expense list: itemized, attributable, conservative by default
`applicable_costs_cents` was one opaque number typed into statement import. The arithmetic was right, but nothing
recorded WHAT was deducted, so no reviewer could check a deduction against the signed agreement. The residuals notes
had this parked as "Kevin/attorney's call"; it now has a defensible default that makes every deduction visible.

New `residual-eligible-expenses.ts` (pure). **Eligible by default** — the pass-throughs a Schedule A normally lists:
interchange, card-network assessments, network/brand fees, authorization fees, settlement/batch fees, PCI
pass-through, and chargeback **fees**. **Not eligible by default**: chargeback **losses**, fines and penalties,
gateway/platform fees, equipment (hardware financing is its own accounting bucket and must never mix into
residuals), marketing, support labour, and anything uncategorized.

**The asymmetry is deliberate.** Wrongly deducting understates what the platform owes the salon; wrongly excluding
only understates the platform's own retention. So the default on doubt is "not deductible", and an unrecognized
category is named in the response and excluded — never silently deducted, never silently dropped.

Import now accepts either itemized `costLines` or the historical single `applicableCostsCents` total; itemized wins
and returns a full `costBreakdown` (eligible total, excluded total, per-line reason). `eligibilityOverrides` flips
any category in either direction per agreement — **the signed Schedule A always wins over these defaults, which are
a starting point and not legal advice.** The split engine is untouched: it still receives one total, and
itemization only decides which lines reach it. New `GET /super-admin/revenue-residuals/expense-categories` backs a
panel in the statement-import modal showing each category with the reason it is or isn't deductible.

VERIFIED: api tsc 0 · 12/12 gates · residuals module suite 47 (+12) · admin-web tsc 0 + 766 (311+228+227) ·
full api battery 8 shards **6,013 + 4 skipped, 0 failed** (+12 = exactly the new tests).

## Jul 28, 2026 — Super Admin honesty audit: seven controls that claimed what the system cannot do
The Jul-27 per-picture audit covered the 19 POS screens. **admin-web had never been through it.** Running the same
three fake-control detectors across all 143 Super Admin screens found seven defects of the same class — a control
whose message asserts an action that never happens:

- **AI Insights → Submit Feedback** claimed *"Feedback recorded against the selected insight"*. Nothing was
  recorded: there is no feedback endpoint and no feedback table. The same screen's own Model Feedback Log panel
  says the store isn't built — the screen contradicted itself, and the button was the half that lied.
- **AI Insights → "+ Review Insights" and "Review All Recommendations"** claimed *"Review queue opened"*. Nothing
  opens; the insight list below already is the queue.
- **System Status → Export Status Report** claimed the report was *exported and audit logged*. No export endpoint
  exists for that module.
- **Product Catalog → Export Report** described a scoped, server-generated, audited export. Same — none exists.
- **Customer Data Oversight → + Add Widget** claimed it *"uses your saved per-user widget preferences"*. Nothing
  adds a widget.
- **Billing → five tables** rendered a muted "View All" that looked like a link, had no target, and promised more
  rows on tables that already render everything the API returned. Replaced with an accurate row count.

All rewritten to the established pattern: say what is true, and point at the path that does work. Submit Feedback
now names the missing store *and* notes that Mark Reviewed / Assign Follow-Up / Dismiss genuinely are recorded and
audited — those three call real endpoints. **No feedback store was built**: that needs a table, an endpoint, and a
decision about whether feedback ever influences the model.

Also swept and CLEAN: dead controls (`onClick={() => {}}`, `href="#"`) 0 platform-wide; owner-web and customer-web
0 message-only controls; tech-web's 4 are honest policy explanations, not claims; admin's "All Systems Operational"
strings are all driven by a real `health.ok`; hardcoded metric literals in KPI tiles 0; the disabled Tenant/Branch/
Date-Range filters already carry the "(—)" unmodeled marker.

VERIFIED: admin-web tsc 0 · AI Insights suite 8 (+2 regression tests pinning that the old claims cannot return) ·
Status/Catalog/Oversight/Billing suites 47 · full admin-web **768** (311+230+227) · production build · 12/12 gates.
api untouched — the 6,013 battery stands.

## Jul 28, 2026 — the cross-wire gate was blind to two shipped apps; closed
Two production surfaces have no tests, no typecheck, and — it turns out — no cross-wire coverage either:
`go-check-in-kiosk` (the customer check-in kiosk, a 20KB single-file HTML app) and `go-check-in-admin` (the
device manager, 14KB). Both are real, shipped, and talk to the API.

`scripts/frontend-calls.js` **listed both in its APPS array** and carried a comment saying they had been added —
but two lines downstream defeated it: the file walker only accepted `.ts`/`.tsx`, and it only ever walked
`<app>/src`, which neither app has (their code is `index.html` at the app root and `www/index.html`). So they
contributed **zero calls**, and every audit built on that extractor reported "0 orphaned" over a set that silently
excluded them. **A listed-but-unscanned app is worse than an unlisted one: it looks covered.**

Fixed in the shared extractor, so every gate built on it benefits: the walker now accepts `.html` and walks each
app's root and `www/` alongside `src/`; a new base-path rule resolves the HTML apps' `const url = (p) =>
` + "`${API}/go-check-in${p}`" + `` helper; and a new call-style rule extracts the verb-first
`api('POST', ` + "`/session/${id}/complete`" + `)` form those apps use. **29 previously invisible API calls are now
audited** — 22 kiosk, 7 device manager.

Every one of them resolves to a real route (this was also checked by hand against the two go-check-in controllers
before the gate was touched, so the gate's verdict could be trusted rather than assumed): cross-wire now reports
**1,941/1,941 wired, 0 orphaned**, up from 1,912. The unreached-route audit improved too — 18 routes it listed as
never called are in fact called by these apps, dropping its "elsewhere" count from 302 to 284.

Still true and worth stating plainly: **both HTML apps remain untested and untypechecked.** They are hand-written
JS in a single file; the cross-wire gate is now the only automated check covering them.

VERIFIED: api tsc 0 · 12/12 gates · crosswire 1,941/1,941 0 orphaned · extractor per-app counts confirmed
(go-check-in-kiosk 22, go-check-in-admin 7, all six TS apps unchanged — no double-counting from the added roots).

## Jul 28, 2026 — realtime envelopes at the ports: the 68 legacy emit sites, closed at one chokepoint
The realtime arc's Jul-27 report left one code item open: 68 emit sites predate the event envelope and publish
ad-hoc payloads, so §19/§20 eventId dedupe/ordering and the §12 PII guard only covered the handful of migrated
sites. Editing 68 call sites was the wrong shape. Instead, **both emitter ports now seal every payload**
(`InProcessEmitter` and `RedisRealtimeEmitter`, via `ensureEnvelope` in realtime-core):

- A raw payload leaves the port as a **real envelope** — eventId, updatedAt, tenant/branch scope, original data
  preserved under `data`.
- An emit-site envelope (booking / customers / tech-appointments `announce` pattern) passes through **untouched —
  same eventId**. Wrapping is idempotent, and the envelope is created once, on the origin node, so the Redis
  fan-out carries **one identity across nodes** and client dedupe works everywhere.
- Forbidden keys (phone, email, notes, card, …) are **stripped recursively — arrays included — counted in a new
  `piiStripped` metric, and never thrown**: realtime stays non-load-bearing, and the keys simply never leave the
  process.
- Side effect worth having: the §33 latency reservoir reads `updatedAt`, so delivery latency is now measured for
  **every** event, not just the migrated sites.

Rich emit sites should still call `makeEnvelope` themselves to attach resourceType/resourceId/version — the port is
the floor, not the ceiling. No frontend change: the client already handles envelope frames, and a sweep of all five
apps found nothing reading event payload fields.

VERIFIED: api tsc 0 · 12/12 gates · realtime suite 7 files/37 (+6 = the new port spec: wrap, same-eventId
pass-through, recursive strip + meter, two-node single-identity) · booking/queue/serving/checkout/customers 351 ·
full api battery 8 shards **6,019 + 4 skipped, 0 failed** (+6 = exactly the new tests). Frontends untouched.
Unchanged from the Jul-27 report, deploy-only: live SSE end-to-end, physical sleep/wake, §53 load evidence,
multi-node Redis under real traffic.

## Jul 28, 2026 — AI Insights feedback store (migration 424): the button's claim is now true
The Super Admin honesty audit earlier today found Submit Feedback claiming "Feedback recorded against the selected
insight" with no endpoint and no table, while the same screen's Model Feedback Log panel admitted the store wasn't
built. That was made honest first; this builds the store, so the original claim becomes true.

**The safety stance is baked in, not documented alongside: feedback is recorded for HUMAN REVIEW ONLY and never
auto-retrains a model.** That sentence appears in the migration header, the service, the message the Super Admin
sees on success, and a test that pins it. Acting on an insight still happens through the relevant operational
module, by an authorized human — unchanged.

- **Migration 424 `ai_insight_feedback`**: verdict (`helpful` / `not_helpful` / `incorrect`, CHECK-enforced at the
  database), optional comment, FK to `ai_insights` with ON DELETE CASCADE, and a **snapshot of the insight's
  model_version + prompt_version at feedback time** — copied into the row, never joined through, so a later
  regeneration of the insight cannot change what the reviewer was actually looking at.
- **API**: `POST /super-admin/ai-insights/:id/feedback` and `GET /super-admin/ai-insights/feedback/recent`. The
  static route is declared before `:id` so Nest can never match `feedback` as an insight id. Verdict is validated in
  the service; feedback on a non-existent insight returns null rather than creating a dangling row.
- **Screen**: Submit Feedback opens a real inline form (verdict + optional comment, exactly one insight selected)
  and posts to the real endpoint; the **Model Feedback Log panel is live** — recent rows with verdict, title and
  date, with an honest "no feedback recorded yet" empty state. The stale "a feedback store is not built yet" line is
  gone because it stopped being true.
- **Both regression pins from this morning were flipped** rather than deleted: the tests now require a real API call
  behind the button, the never-auto-retrains wording on success, no recording without a selection, and a log refresh
  after submitting.

VERIFIED: api tsc 0 · 12/12 gates (check:sql validated 424 against the real schema; crosswire confirmed both new
routes have callers) · **migrations 424/424** · insights module 15 including a real-PG test that proves the version
snapshot survives a regeneration and that the verdict CHECK holds at the database · AiInsights screen 9 · admin-web
tsc 0 + 769 (311+231+227) · full api battery 8 shards **6,023 + 4 skipped, 0 failed** (+4 = exactly the new tests).

## Jul 28, 2026 — push readiness: the repository had no .gitignore
The recommended next step was the GitHub push, so the repo was audited for it. The finding was worse than
expected: **there was no `.gitignore` at all.** A first `git add .` would have committed roughly 762 installed
packages under `node_modules/`, five built `dist/` trees, and any real `.env` a developer later created —
permanently, in history, on the very first commit.

A `.gitignore` written from this repo's actual layout is now in place, and **it was verified by running a real
`git init && git add -A` on a scratch copy** rather than by reading the patterns: 5,520 files staged, **0**
node_modules/dist/env/log files staged, 35 MB. That test caught a bug in the first draft — git has no inline
comments, so `.security-audit-partial.json   # …` was parsed as a filename with the comment attached and silently
matched nothing. Fixed; the comment is on its own line.

Also verified before any push:
- **Secret scan over the exact file set git would track**: five `sk_live_…` matches, all deliberate fakes inside
  tests that assert credential masking and encryption (obvious placeholder values (`sk_live_` followed by strings like "ABCD…" and "supersecret…"), obvious placeholder values (`sk_live_` followed by strings like "ABCD…" and "supersecret…")).
  No real credential is in the repository. The tracked env files are placeholders-only examples/templates; the
  ignore rules keep those while excluding a real `.env`, plus `*.p8`, Firebase JSON/plist, and service accounts.
- **The CI passes today**: `npm run security:fast` — the exact command in `.github/workflows/security.yml` — ran
  green locally, **PASSED 15 · FAILED 0 · NOT VERIFIED 4** in 53s. `npm ci` will work; `package-lock.json` is
  committed. The 4 unverified entries are honest owner-side gaps (live processor, production CORS/TLS/rate
  limiting, live Twilio, physical devices), not failures.

New `PUSH_TO_GITHUB.md` carries the exact commands, the private-repo recommendation, the personal-access-token
note (GitHub no longer accepts passwords over HTTPS), the 1:00 AM UTC vs Eastern cron detail, and the plain
statement that a push is not a deployment.

## Jul 28, 2026 — a 13th gate: the two shipped HTML apps finally have automated coverage
`go-check-in-kiosk` (the customer check-in kiosk) and `go-check-in-admin` (the device manager) are production
surfaces written as single HTML files with hand-written JavaScript. They have no tsconfig and no test suite, so
`tsc` cannot see them and vitest has no entry point for them. Earlier today the cross-wire extractor was taught to
read `.html`, which covered their API paths — but nothing ever looked at the JavaScript itself.

New gate `check:html` (`scripts/audit-html-apps.js`) covers the failure modes that actually kill a single-file app:

1. **Syntax** — script blocks are extracted and run through `node --check`. A stray brace ships a blank kiosk to a
   salon floor; there is no compiler between the edit and the customer.
2. **Dangling element references** — every `getElementById('x')` / `querySelector('#x')` must have a matching id in
   the markup. Renaming an id and missing one reference fails at runtime, on a device nobody is watching.
3. **Hardcoded origins** — a pasted `localhost`/IP fails the gate; the API base must stay configurable
   (`?api=` / `window.APS_API_BASE`).
4. **Credentials** — no live-key patterns in files served to a browser.

**Both apps pass today** — audited first: 0 dangling references, both script blocks parse, all 29 API calls resolve
(verified by hand earlier against the two go-check-in controllers). So this gate is regression protection, not a
bug fix. **It was proven by sabotage rather than trusted**: a scratch copy with a renamed id, an injected
`http://localhost:3000` and a broken function produced exactly three failures and exit 1.

Wired into `security:fast` at MEDIUM (a broken kiosk is a salon that cannot check customers in), so it runs in CI on
every push — the lane is now **PASSED 16 · FAILED 0**. The gate battery is thirteen; README, DEVELOPER_HANDOFF,
PROJECT_STATUS and NEW_CLAUDE_INSTRUCTIONS updated.

**Still true, and worth repeating:** this is a static floor under two files that had nothing. Runtime DOM behavior
is not covered and those apps still deserve a real restructuring.

## Jul 28, 2026 — runtime browser coverage for the two HTML apps (`npm run e2e:html`)
The 13th gate gave the kiosk and device manager a static floor; this is the half the gate's own output said it
could not cover. `scripts/e2e-html-apps.mjs` drives **the real files in real Chromium** against a stub API:

- **Kiosk — the full guest journey**: boot → `/config` (salon name renders) → start-session → the phone keypad
  (formats as typed) → lookup → "Welcome back, Ava" tenant match → service selection → technician preference →
  walk-in check-in → "You're checked in!" with the 12-minute wait estimate from the response → **Done resets to a
  fresh session for the next guest**. The stub **asserts the walk-in payload server-side** — customerId, the chosen
  serviceIds, the chosen technicianId — so the app dropping a field fails the run even when the screen looks right.
  It also asserts call order: lookup and services must happen before the walk-in.
- **Device manager**: devices render from the API (name, type, status pill), and **Disable fires the real POST**,
  after which the reloaded list shows `disabled`.

13 assertions, 16 API calls verified. **Proven by sabotage before being trusted**: commenting out the technician
field in the kiosk's walk-in payload fails the run with exit 1 — and the first sabotage exposed that a stalled
journey died as an uncaught TimeoutError, so journeys are now wrapped to fail readably ("kiosk journey did not
complete: …"). One stub bug was caught by the harness itself: the device row keys off `d.deviceId`, not `d.id`.

Deliberately NOT in the vitest battery (needs a browser and ports; Chromium installs once via
`npx playwright install chromium-headless-shell`). Run `npm run e2e:html` after editing either file, alongside
`check:html`. Registered in package.json; README and NEW_CLAUDE_INSTRUCTIONS updated.

With this, both apps have syntax/reference/origin/credential gates **and** behavioral coverage of their primary
journeys. Still true: they deserve a real restructuring, and no automated journey replaces a human on the ASUS.

## Jul 28-29, 2026 — mobile ecosystem pass 1 of 4: TapPay vs the prototype
First comparison pass of the mobile-ecosystem arc. Kevin's TapPay prototype was driven in real Chromium (dc-runtime
+ React CDN) and every screen's content extracted from the markup; production manager-pay-web was compared screen by
screen. Five of six screens already matched — tip presets 15/20/25/Custom, receipt SMS/Email/App channels, honest
Tap-to-Pay states, backend-confirmed success, real history/reports. The prototype's Reports method-mix (61/27/12) is
sample data richer than real data supports (every mobile capture is tap) — recorded as not-a-defect.

**Two real gaps, fixed — as thin delegates to the canonical engines, the refund/void pattern:**
- **Add Retail Product**: GET /mobile-checkout/retail-catalog + POST tickets/:id/retail → ServingService.retailCatalog
  / addRetail. Price comes from the tenant catalog, never the request; quantity must be a whole number 1-99 (engine
  rules, unchanged). TicketScreen gained an inline picker (loading/empty/error states honest), reloads the canonical
  detail after the write.
- **Add Discount**: POST tickets/:id/discount → CheckoutService.applyDiscount (caps, reason, audit — engine
  unchanged). TicketScreen gained an inline dollars form parsed by parseDollarsToCents with a `?? NaN` guard —
  junk input BLOCKS with a message; it can never become $0.00.
MobileCheckoutService gained an optional ServingService (9th ctor param — every existing test harness untouched);
module imports ServingModule. New spec pins: ctx+search forwarded; price-shaped fields stripped; integer cents +
reason through the canonical discount; junk→0 for the engine to reject; a build without serving says so honestly.

**Battery caught a real bug of mine from earlier today**: the Communications pgtest seeded "today's" messages at
now()-110/160 minutes while the service counts from UTC midnight — green all day, red the moment the run crossed
00:00 UTC. Fixed by hour-proof seeding (response pairs pinned >24h ago; today's rows at 00:00:05 of the current day
in an inbound-less thread), preserving every assertion including the 15-minute response average.

VERIFIED: api tsc 0 · 13/13 gates (crosswire sees all 3 new client↔route pairs) · mobile-checkout composition spec 5
· manager-pay-web tsc 0 + **52** (was 50; TicketScreen 10) + build · full api battery 8 shards
**6,028 + 4 skipped, 0 failed** (+5 = exactly the new tests; shard 2 re-run green after the seed fix).
Matrix: all 6 TapPay rows filled with findings. Next passes: Customer (13) → Owner (12) → Tech (20). Zip deliberately
NOT rebuilt mid-arc.

## Jul 29, 2026 — mobile ecosystem pass 2 of 4: Customer app vs the prototype
All 13 prototype screens extracted and compared against customer-web. **Twelve of thirteen already matched**,
including both pre-flagged unknowns: **"AI Match Me" already exists** as a transparent relevance ranking over real
technician data that surfaces why each matched (the honest form of AI matching — no fabricated model), and **wallet
Top Up already exists**, charging a saved method against a real store-credit balance. Also confirmed present:
referral, Book This Look, live appointment status over the customer SSE stream, LiveQueue with SSE + 30s fallback,
and the real-data loyalty card on Home.

**The one real gap, fixed end-to-end: customer-added tips at in-app payment.** PayScreen only displayed a POS-set
tip; the design's $5/$10/$15/Other had nowhere to land.
- **Migration 425**: `payment_intents.customer_tip_cents`. The chosen tip is stored **on the intent at start**, and
  confirm charges bill + the STORED choice — the confirm request body cannot change it (tamper-proof, pinned by
  test). The no-intent confirm path validates a body tip exactly once.
- **Validation reuses the tenant's existing tip policy** — `validateCustomTip` + `maxTipPercent` from checkout
  settings, exposed through a repo-owned `maxTipPercent()` read. No new tip rules.
- POS-set and customer-added tips **combine** on the payment row (approved and declined paths both), so downstream
  technician attribution stays right.
- **PayScreen**: No Tip / $5 / $10 / $15 / Other chips; Other parses via `parseDollarsToCents` with a junk-blocks
  guard (never a silent $0.00); total, pay-button and method subtitle all show bill + tip; cash-to-technician path
  unchanged (a cash tip is handed physically).

Two of my own stumbles this pass, both caught by tests: a guessed confirm-mock shape (`approved` vs the screen's
real `paid`) and a kysely.types comment that the types-drift gate's parser read as a member named "425" — the gate
does not strip comments, so interface comments must avoid `token:` patterns; reworded colon-free.

VERIFIED: api tsc 0 · **13/13 gates** · **migrations 425/425** · skip-line tip spec 6 · PayScreen 6 · customer-web
tsc 0 + **267** + build · full api battery 8 shards **6,034 + 4 skipped, 0 failed** (+6 = exactly the tip spec).
Matrix: all 13 Customer rows filled. Remaining passes: Owner (12) → Tech (20).

## Jul 29, 2026 — mobile ecosystem pass 3 of 4: Owner app vs the prototype — verification-only, zero changes
All 14 prototype screen blocks extracted and compared against owner-web, on top of the July 18 audit that had
already mapped all 12 modules to routed, wired screens. **No gap found; no code changed.** The four risk points the
prototype raises all check out honest in production: payroll approval is a real PIN-gated endpoint (fresh
authentication, deliberately isolated unit); inventory shows real low-stock/reorder data with an honest empty state
and no pretend vendor ordering; the AI Center is **advisory-only by design** — the prototype's "apply
recommendation" was simulation, and the spec itself forbids AI autonomously making privileged changes; the
missed-call KPI renders through the honest {value, available} metric pattern. Multi-location switching remains
server-authorized and PIN-gated for protected salons (verified in the earlier audit; unchanged).
Matrix: all 12 Owner rows filled. Remaining: Tech pass (20 screens).

## Jul 29, 2026 — mobile ecosystem pass 4 of 4: Tech app vs the prototype
All 21 top-level screens of the merged Complete App prototype extracted and compared against tech-web. Nineteen of
twenty spec screens already matched, including the behaviors that matter: accept/decline with a reason modal and a
**server-authoritative expiry countdown**, the QR + manual-PIN cash-handoff confirmation, versioned terms
acceptance, and Start/End Break — which production places on the Queue screen where it operationally belongs
(workingStatus gates assignment) rather than the prototype's Profile placement; recorded as a layout difference.

**The one real gap, fixed: the dedicated Service History screen.** MoreScreen's "Service History" item was an alias
to Earnings; the design's screen — guest, service, date, and the guest's rating per completed visit — had no home.
- Backend: `GET /tech/service-history` (perm `tech.ticket.view`) on the tech module. The query returns only THIS
  technician's PAID service lines (other technicians' and other tenants' identical rows pinned invisible), names the
  guest first-name + last-initial ("Walk-in guest" when unlinked), and surfaces `tickets.satisfaction_rating`
  honestly — null renders as "Not rated", never a fabricated score. A distinct-services list feeds the filter.
- tech-web: new TechServiceHistoryScreen (All-Services filter, initials avatar, honest loading/empty/error states),
  a new nav push kind, and the MoreScreen item now opens it.
VERIFIED: api tsc 0 · 13/13 gates · real-table pgtest 3 · screen test 3 · tech-web tsc 0 + **117** (was 114) + build
· full api battery 8 shards **6,037 + 4 skipped, 0 failed** (+3 = exactly the history pgtest).
Matrix: all 20 Tech rows filled. **All four passes complete — 51/51 screens compared; 3 real gaps found and fixed
across the ecosystem (TapPay retail+discount, Customer in-app tip, Tech service history), everything else already
existed.** Next: single arc-close zip rebuild + clean-extract verification + the final report.

## Jul 29, 2026 — browser-e2e capstone re-verified at HEAD + selector-rot fix
The full authenticated click-through (real backend boot → migrations → PALACE seed → same-origin proxy → real
Chromium logs in through the actual form) had not been re-run since the mobile arc landed. Running it found real
rot: the Jul-27 login-identity unit changed the identifier placeholder to "Enter **your** email or phone number",
and both browser harnesses still waited on the old text — the e2e would time out for anyone who ran it. Fixed
drift-resistantly: both `browser-e2e.mjs` and `pos-viewport-audit.mjs` now select the login fields by their stable
input ids (`#aps-store` / `#aps-identifier` / `#aps-password`) instead of placeholder copy, so wording changes can
never rot them again. Re-run at HEAD: **login 200 → session cookie survives → authenticated shell renders with the
full sidebar → 3 authenticated GETs 200 → zero uncaught JS errors — PASSED in a real browser** (rc captured
directly, not through a pipe). Also re-run this session: `e2e:html` (both HTML apps green in Chromium, 16 API calls
verified) and `security:fast` (16 PASSED / 0 FAILED). No product code changed — harness-only fix.

## Jul 29, 2026 — deferred item closed: partial refunds now reverse technician commission (line-granular)
The helper-allocation arc's one real deferred item — "only FULL refunds auto-reverse; partial needs per-line refund
detail, an API-shape decision" — executed under Kevin's standing delegation of API-shape decisions. The engine
already modeled it (buildRefundReversal's 'partial' branch reverses each NAMED line whole; snapshot rows carry
service_line_id); only the API shape and wiring were missing.

**Shape shipped:** `RefundRequest` gains `serviceLineIds?: string[]` (which lines this partial refund covers) and
`tipRefunded?: boolean` (whether the tip on those lines was also refunded — default: tip stays). Behavior:
- Partial WITH lines → a `'partial'` reversal naming exactly the deduped lines; each named line's commission
  reverses whole (the caller names lines, never invents proportions).
- Partial WITHOUT lines → unchanged: nothing reverses automatically.
- Full refund → unchanged full/tip-reversed event; redundant lines are ignored.
- **A line id that doesn't belong to the payment's ticket fails the REQUEST before any money moves** — a typo'd id
  must not let the refund proceed while silently reversing nothing.
The mobile refund path inherits it automatically (body passthrough); the manager-pay client type is widened. No UI
line-picker yet — the capability is API-complete and reversals stay `pending` (approval-gated) as before.

VERIFIED: api tsc 0 · 13/13 gates · checkout suite 36 files/**189** (+5 = the new spec) · manager-pay-web tsc 0 + 52
· full battery 8 shards **6,042 + 4 skipped, 0 failed** (+5, summed from logs). Test-harness note: seed refundable
payments via `repo.recordPayment` with an explicit paymentId (the refund-atomic pattern) — `payCash`'s return does
not land where `findPayment` reads in the in-memory twin.

## Jul 29, 2026 — refund line-picker UI + TWO gate blind spots + a fixture-masked rendering bug
Building the front half of yesterday's partial-refund API surfaced three real defects, all fixed:

**1. `check:dialogs` and `check:money` scanned only five frontends** — manager-pay-web and customer-display were
invisible to both (same failure class as the crosswire blind spot: a gate that silently excludes a shipped surface
looks like coverage). Both gates now scan all seven. The widened dialogs gate immediately caught what it had been
missing: **TicketScreen's refund AND void flows used `window.prompt`** — live native-dialog violations of the
platform invariant, shipped since Jul 18.

**2. The prompts are gone.** Void now asks its reason through the mirrored `useInlineAsk` (InlineAsk + InlineConfirm
copied into manager-pay-web/src/components). Refund became a proper inline panel — reason (required), amount
(defaults to full; `parseDollarsToCents` with junk-blocks, capped at the captured amount), and **when the amount is
partial, a line picker** listing the ticket's services plus a "tip also refunded" toggle — feeding
`serviceLineIds`/`tipRefunded` into yesterday's API so technician commission on exactly the selected lines reverses.
A partial submitted with no lines selected says plainly that commission was not adjusted.

**3. Fixture-vs-wire drift had been hiding a real rendering bug**: the client typed services as `{ name }` while the
wire sends `{ serviceLineId, serviceName, … }` — so the live app rendered **blank service names** on the ticket,
while tests passed on fixtures shaped like the type instead of the wire. Type, screen, and fixtures all now match
the wire payload (which also delivers the line ids the picker needs). Lesson recorded: fixtures mirror the WIRE,
not the client type.

POSRefundsVoidsScreen audited: read-only review surface, no action to extend — the manager-pay panel is the refund
action UI. VERIFIED: manager-pay-web tsc 0 + **53** (was 52; refund tests rewritten to drive the panel and assert
`window.prompt` never fires, + partial-with-lines + cancel) + build · **13/13 gates with the widened coverage** ·
api untouched (no battery required; scripts + frontend only).

## Jul 29, 2026 — the last two spec remainders closed: intake fraud signals + receipt surcharge itemization
**Intake (the two signals deferred at the Jul-26 build, from Kevin's fraud-signal spec):** (1) links in the free-text
application message are now flagged by domain ("Message contains link(s): …", up to three named) — a classic spam
tell; (2) a coarse USPS first-3-digit ZIP↔state table flags "ZIP … does not appear to match state …". Both are
flag-only review reasons — nothing auto-rejects, unknown state formats never flag, and the table's coarseness can
only produce false negatives (enclave prefixes inside another state's range simply don't flag). Both merged into the
existing risk-findings list the Super Admin already sees.

**Receipts (the four-bucket pass's "itemization not verified" remainder):** when a card surcharge is part of the
total a receipt shows, both SMS and email receipts now itemize it — "(includes $X card surcharge)" — exactly like
the tip note. Zero surcharge → no note. Pre-payment disclosure already existed on the customer display; this closes
the receipt half of the Visa disclosure requirement.

VERIFIED: api tsc 0 · 13/13 gates · public-intake spec 12 (+2) · new checkout-receipt-surcharge spec 2 · full
battery 8 shards **6,046 + 4 skipped, 0 failed** (+4 = exactly the new tests, summed from logs). Test-harness note:
InMemorySuperAdminPlatformRepo stores rows privately — read via the public `applications({})` list, which returns
newest-FIRST; key assertions by submission email, not row position.

## Jul 29, 2026 — the seven "REMAINING_*" docs bannered as historical (fix Remaining, literally)
Seven root docs matching REMAINING/UNFINISHED were point-in-time reports from June–early-July that a new developer
would grep straight into. Each now opens with a dated STATUS banner: historical snapshot, do not work from it,
current truth lives in PROJECT_STATUS/CHANGELOG/NEW_CLAUDE_INSTRUCTIONS — plus a per-file correction naming exactly
which of its claims went stale: `ai_ocr_receipt` has since been built (9/9 AI modules wired); "Stripe & Square
implemented" predates their permanent removal; native `confirm()` was eliminated platform-wide; "Mac-fit/iMac" was
de-branded to the ASUS shell; "no Postgres in the sandbox" ended with PGlite running all 425 migrations; and the
split-payment-surcharge "deliberate limitation" was FIXED by the four-bucket pass (splitting no longer avoids the
surcharge). Kept honestly open in its banner: support-ticket attachments still have no frontend consumer (Low).
Content preserved verbatim below each banner — these are history, not trash. No code changed; 13/13 gates + tsc 0
re-confirmed at HEAD this session.

## Jul 29, 2026 — double-booking closed at the DATABASE (migration 426) + attachments frontend + a never-run spec repaired
"Build or fix any not finish" produced one real production hardening and closed the last open Low item.

**The double-booking hole.** A race pgtest found on disk (authored by a parallel session, never in any delivered
zip) had never once run: PGlite built with empty extensions, a nonexistent `tenants.name` column, length-invalid
UUIDs, missing NOT NULLs on the technician seed. All repaired — its two sequential-equivalence tests are green for
the first time. A literal Promise.all concurrency probe then demonstrated the real gap: **both simultaneous inserts
for one slot succeeded** — `pos_tech_appointments` had no database-level guard (migration 372 protects only booking
HOLDS), and the advisory lock is exactly the pooling-defeatable pattern migration 422 recorded for the recon lock.
Fix, same class as 422: **migration 426** adds a gist exclusion constraint on appointments — tenant + technician +
appt_date equal, minutes-of-day `int4range` overlap with half-open `[)` (back-to-back stays legal), exempting
cancelled/no_show/completed, **forward-only from 2026-07-30** (EXCLUDE cannot be NOT VALID; legacy overlaps must
never brick a deploy). Two authoring iterations: `::time` casts are not IMMUTABLE in index expressions — the range
is built from `split_part` + int casts. `insertBookingAtomic` now catches SQLSTATE 23P01 and maps it to the same
"no longer available" conflict return — a raced-out customer never sees a 500. The pgtest's third test attacks the
table DIRECTLY (raw insert, no lock, no pre-check → refused 23P01; `[)` boundary accepted; cancelled row exempt).
A literal two-session race remains NOT VERIFIED in-sandbox — single-session PGlite merges interleaved transactions
(now demonstrated empirically, not assumed); the constraint is precisely what makes that irrelevant in production.

**Attachments frontend** (the one honestly-open Low item): Help Center ticket rows gained an Attachments expander —
list, base64 upload (5 MB cap), download (blob save; the dead-client gate caught the method shipping button-less and
forced the wiring), remove, honest loading/failed/empty states. First frontend consumer of the backend CRUD that
had waited since the Support Center build.

VERIFIED: api tsc 0 · migrations **426/426** · **ALL 13 GATES PASS** · battery 8 shards
803+755+745+732+718+795+811+690 = **6,049 + 4 skipped, 0 failed** (+3 = exactly the race pgtest, summed from logs
after all eight returned) · pos-web Help screen 7/7 (+2) · pos-web tsc 0 + build OK.

## Jul 29, 2026 — repository initialized + pushable bundle (the local half of the GitHub blocker, executed)
The repo had no `.git`. Now it does: `security:fast` re-run at HEAD (16 PASSED / 0 FAILED) per the push doc's own
protocol, then `git init` + first commit `21ee2e0` (5,536 tracked files — the Jul-28 `.gitignore` held; no
node_modules, no dist, no real `.env`). A `git bundle` of all refs was created, `bundle verify`d, and proven by a
real clone (commit + full tree reproduce). Delivered as `AIPowerSalon-repo.bundle` beside the handoff zip: clone
it anywhere, add your GitHub remote, push — the first push activates the security CI. PUSH_TO_GITHUB.md now opens
with the shortened truth. Note: `git bundle create` cannot stream to the outputs mount (pack-objects fd error) —
build on local fs, then copy.

## Jul 29, 2026 — the pushed repo proven self-sufficient (bundle-clone verification)
What Kevin pushes must build on its own, so the bundle's clone was verified from scratch: `npm ci` clean, api tsc
0, migrations 426/426 on PGlite, ALL 13 GATES PASS, battery spot-shard 803/803, pos-web tsc 0 + production build —
all inside the clone, touching nothing from the working tree. The zip-vs-git delta is exactly one file and it is
correct: `.security-audit-partial.json` (piecewise security-run scratch state) is gitignored transient tooling and
SHOULD be absent from the pushed repo. Nothing the build needs lives outside git.

## Jul 29, 2026 — final-commit verification lanes: browser e2e PASSED; security:full honestly deferred to CI
The real-Chromium authenticated click-through re-ran at the final commit (api dist rebuilt first): login 200 →
session cookie → authenticated shell → data GETs 200 → 0 JS errors. PASSED. The harness lives at
`apps/api/scripts/browser-e2e.mjs` (repo-root path in older notes is wrong). security:full's single stamped report
is NOT producible in this sandbox: one shard alone exceeds the execution cap, and background processes are reaped
between calls (verified empirically — launched, gone, no checkpoint). Its CONTENT is already fully proven at this
exact commit: security:fast 16 PASSED / 0 FAILED plus the complete 8-shard battery (6,049 + 4, 0 failed), which is
a strict superset of the suites --full adds. The stamped full-mode report will come free from CI's nightly cron
after the first push — no call caps there. The stale Jul-26 `.security-audit-partial.json` was removed (transient
scratch, gitignored); tree and git now match at exactly 5,536 files.

## Jul 29, 2026 — 20-picture wiring re-verification: sidebars intact, two stale-false buttons fixed, System Status page built
Kevin sent all 20 dashboard mockups (4 tenant POS + 16 Super Admin) asking for a working-and-wiring check with one
rule: do not change the sidebar names. VERIFIED: every pictured Super Admin screen exists with sub-menus matching
the pictures item-for-item (Appointment/Customer-Data/Workforce Oversight, Booking & Check-In Monitor, Live Queue
Monitor, Catalog Management → Service Templates + Product Catalog, Plans, Onboarding, Tenants/Branches/Users,
Analytics, Live Operations, Overview) — these mockups are what the prior arcs were built to. Tenant side likewise,
with one structural gap and two REAL bugs found by re-running the fake-control detectors at HEAD:
(1) STALE-FALSE HONESTY — Communications' "Open AI Receptionist" and "Open Templates" still said "isn't connected
yet" while both screens have long been routed (/tenant/ai/receptionist, /tenant/communications/templates). The
honest-disclosure message had itself become the lie. Both now navigate; the regression test was REWRITTEN (not
deleted) to pin navigation as the new truth, with the history in its comment.
(2) PICTURE 3'S PAGE MISSING — the System Status mockup had no tenant page (only the sidebar footer pill + a Help
Center section). Built POSSystemStatusScreen as a view over the REAL GET /tenant/help/status: overall banner,
per-service status table, Active Alerts derived from unhealthy components + open incidents, Recent Incidents,
Refresh, client-side "Last checked". The mockup's response-time/uptime%/system-metrics figures are NOT measured
tenant-side and are NOT rendered — a caption says so. Entry = the EXISTING footer System Status card now routes to
it (label untouched; Help Center button unchanged). Zero sidebar renames anywhere. "Dashboard" appearing in some
mockup sidebars but not others = mockup inconsistency; Overview IS the dashboard — no duplicate built (recorded
product rule). Detector sweep otherwise clean: 0 dead handlers, 0 lying claims (41 message-only hits all honest).
VERIFIED: pos-web 719 (+3) tsc 0 build OK · ALL 13 GATES · api untouched (6,049 stands).

## Jul 29, 2026 — 20-picture audit completed at body depth: 5 descriptive-lie fixes; Overview + Live Operations MATCH
The stale-false triage extended to admin-web and caught the July class surviving in DESCRIPTIVE phrasing: Devices
and AI-Usage "Export" buttons described permission-respecting, audit-logged exports that never run; Customer-Data
and Product-Catalog "View" buttons described read-only audited views that never open; AI-Usage "+ Save
Configuration" implied a save it doesn't perform. All five rewritten to the honest form (not-connected with the
intended properties in parentheses, or an explicit redirect to the real per-section saves). Campaigns' "View
Failures" left alone — a real availability-gated Delivery Failures panel lives on the same screen. No test pinned
the old strings; affected suites 39/39, admin-web tsc 0 + build OK.
The two tenant screens never body-audited in July (the 19-screen audit covered the group screens) both MATCH their
mockups panel-for-panel: POSDashboardScreen ↔ picture 1 (Operations Snapshot, Live Salon Activity, AI Insights,
Revenue & Appointments Trend, Top Technicians/Services, Retention, Payment Mix, Multi-Location Snapshot, quick
actions) and POSOverviewScreen ↔ picture 2 (Arrivals & Check-In Queue, Live Tech Queue, Service Flow with Ready
for Assignment/Checkout, Today's Appointments, Communications with Reminders/Messages/Missed-Calls tabs, AI
Insights, Revenue Trend, Technician Performance, Retention, Payment Mix, Inventory Alerts). Route note: sidebar
"Live Operations" renders POSDashboardScreen — the mockups listing both "Dashboard" and "Live Operations" are two
names for this one screen, which also explains the earlier naming-revert history. All 20 pictures are now verified
at body depth: 16 SA + Overview + Live Operations + Memberships (July #11) + System Status (built prior turn).

## Jul 29, 2026 — deep sweep (fix-don't-remove): 3 orphans wired, unused-route inventory shipped
Five lanes beyond the gates, whole codebase. Lanes 1-3 came back ZERO: no handler-less buttons in seven React apps,
no TODO/FIXME/HACK/XXX anywhere outside tests, no empty catch blocks in the API. Lane 4 found exactly THREE orphan
exports, each fixed by WIRING, never removal: (1) techScheduleRequest was the ONLY iPad builder with zero
production callers (siblings: 8/3/2/1/1 sites) — the live technician-schedule preview now offers the same "Full
View" iPad open as Booking; (2) manager-pay's useInlineConfirm was mirrored in but never consumed — the
money-moving Submit Refund is now confirm-gated inline (tests click through the confirm; suite 53/53); (3)
rollupByTech was exported with no external consumer — it now has a unit test pinning the rollup math (keyed on
technicianId, most-pending-first ordering). Lane 5: crosswire gained an ADDITIVE reverse-report mode
(CROSSWIRE_UNUSED=1; gate behavior unchanged) and UNUSED_ROUTE_INVENTORY.md now lists the 630 routes with no
statically-extractable frontend caller (pos 285 · super-admin 176 · tenant 40 · api/agent 24 · …) — a REVIEW
inventory, not a defect list: the forward direction is proven 1,941/1,941, and the reverse mixes by-design
clientless surfaces with anything genuinely orphaned; triage rule recorded as wire-or-document, never delete.
VERIFIED: pos-web touched suites 4/4 + build; mpw 53/53 + tsc 0; ALL 13 GATES.

## Jul 29, 2026 — LIVE auth-matrix e2e: two real login bugs found and fixed (every portal proven)
A new harness (apps/api/scripts/auth-matrix-e2e.mjs) boots the REAL stack (PGlite socket + migrations + seed +
dist/main.js) and fires real HTTP at all four /auth/login portals — the login doors of all ten workspaces — with a
13-check positive+negative matrix. It found TWO bugs no unit test hit:
(1) TENANT/STAFF PORTAL COULD FIND A CUSTOMER — a role='CUSTOMER' row authenticated through the staff door, the
mirror of the isolation that's supposed to be structural (spec §11: the customer door already can't find staff).
Fixed in BOTH the Kysely repo (added `.where('role','<>','CUSTOMER')`) and the InMemory twin; pinned by a new unit
(staff-door lookup returns nothing for a customer, a real MANAGER at the same salon is still found — role-specific,
not blanket). Live matrix flipped that check 200→401.
(2) CUSTOMER PORTAL COULD 500 AND CRASH THE SERVER — findCustomersForLogin (the per-salon fallback) SELECTed
`u.totp_secret_enc`, a column that does not exist on users (TOTP lives in mfa_factors, loaded via loadTotpSecret
everywhere else). Any customer login reaching the fallback threw. Never caught because normal customer login uses
the identity path. Fixed: dropped the phantom column, load the secret per-candidate like every sibling lookup. Live
matrix flipped that check 500→200.
Two matrix reds were harness-seeding artifacts, not app bugs, and are noted for the record: the first-run seed
provisions the OWNER users row but no user_branch_access grant (findOwnerForLogin builds the portfolio from uba —
a real owner gets the grant from Add-Salon/invite; harness now seeds it) and the SA missing-MFA case returns a 200
carrying {outcome:'MFA_REQUIRED'} with NO cookie (a challenge, correctly refusing a session — the assertion was
tightened to inspect cookie+outcome, not raw status). Final: AUTH MATRIX 13/13 · api battery 829+742+755+741+726+
802+796+659 = **6,050 + 4 skipped, 0 failed** · ALL 13 GATES · auth folder 385.

## Jul 29, 2026 — SMS Verification Packages P1: schema + Super Admin CRUD (Kevin's 71-section spec)
Kevin's Twilio SMS Verification Packages & Tenant Billing spec landed (three SA-controlled packages, entitlement,
usage ledger, overage billing; his pricing-model decision — tenants pay own Twilio vs platform resells — stays
open and is why NOTHING here hardcodes a price). A parallel session filed the spec + §69 audit into shared memory;
this container executed P1 on that plan. Migration 427: sms_verification_packages (every §5 field SA-editable),
tenant_sms_subscriptions (one per tenant) + tenant_sms_package_changes (§8 history), tenant_sms_billing_cycles with
the §26 TERMS SNAPSHOT on the row (historical bills can never be recalculated by editing a package), and the
sms_usage_records LEDGER with the §12 cornerstone as a partial UNIQUE (provider, provider_message_id) — a Twilio
SID can never bill twice, enforced by Postgres, with NULL-SID pre-submission rows exempt. Seeds: exactly three
packages (§53) at price 0, self-service OFF, description honestly reading "not yet set by Super Admin".
SmsPackagesService/-Controller under /super-admin/sms-packages behind SuperAdminGuard + RolePermissionGuard with
NINE new §54 granular keys in rbac. Gate work the build demanded: 5 tables typed into kysely.types (types-drift),
and the SA cross-tenant tenant_count aggregate REVIEWED + baselined in the tenant-isolation check with its
justification inline. pgtest 5/5 first run: seeds, CRUD persist + before/after audit, nonsense rejection
(negative money, fractional counts, warning ≥ critical), enable/disable audited, and the SID double-bill refusal
straight from the database. VERIFIED: migrations 427/427 · ALL 13 GATES · api tsc 0 · DI OK · battery shard 1/8
829 green (full battery next session — P2 entitlement wiring continues the arc).

## Jul 29, 2026 — SMS Packages P2: centralized entitlement gate, wired into booking verification
Battery first per the standing rule: all 8 shards at P1's commit — **6,055 + 4 skipped, 0 failed** (829+742+755+
741+726+802+796+659). Then P2. New SmsEntitlementService (sms-packages) is the §14 single gate: precheck() before
every tenant-funded verification send, recordSubmission() after provider acceptance, recordFailure(), balance()
(the tenant-facing view P5's screen will consume). ROLLOUT-SAFE BY DESIGN and documented in-code: a tenant with NO
package assigned keeps verifying — allowed, billable:false, honestly ledgered with reason 'no_package_unbilled' —
so deploy day breaks no live salon; enforcement begins when Super Admin assigns a package. Hard limit (or overage
disabled, which is a hard limit by definition) refuses BEFORE the send with a clear message; soft limit flows into
overage priced from the CYCLE SNAPSHOT (§26), never today's package row. Calendar-month cycles open on first use
with terms snapshotted; ON CONFLICT guards the open. recordSubmission is idempotent on the provider SID (rides
427's partial UNIQUE — a duplicate returns duplicate:true and moves no counter). Counters advance by atomic
UPDATE; the ±1 race at a hard limit is tolerated and documented (ledger stays exact; P6 reconciliation trues up).
WIRED into the highest-volume caller: booking-verification.service precheck→send→record around the Twilio Verify
call, with the entitlement port added as the LAST optional constructor arg (first attempt inserted it mid-signature
and would have shifted every positional caller — caught by design review before tsc); customer-booking.module
imports SmsPackagesModule and injects the service. Billing can never break code delivery (record errors swallowed).
pgtest sms-entitlement 5/5 FIRST RUN (§60 no-package unbilled · §61 allowance→overage at snapshot 3¢ · §62 hard
refusal with zero new billable rows · §63 duplicate SID counted once · failures FAILED+unbilled). VERIFIED:
customer-booking + sms-packages folders 244 green · ALL 13 GATES · tsc 0 · DI OK. P2b next: customer-phone-update
+ activation senders join the same gate; PLATFORM_SECURITY (SA OTP) stays outside it forever.

## Jul 29, 2026 — SMS Packages P2b: purpose accuracy through the choke point; platform paths proven outside the gate
The P2b audit shrank the work twice, both by good architecture already in place: (1) the customer PHONE-UPDATE
flow was ALREADY entitled the moment P2 shipped — its PhoneVerificationPort wraps BookingVerificationService, so
every phone-change send passes through the gate (allowance, hard limit, SID dedupe). The only gap was §17 purpose
accuracy: those sends would have ledgered as BOOKING_VERIFICATION. (2) CUSTOMER-ACTIVATION correctly stays OUTSIDE
the gate: it sends with no tenant (tenantId:'') and resolves which salons a phone belongs to only AFTER
verification — platform identity traffic that §16 forbids billing to any salon. That is a documented boundary,
not missing wiring. The one real change: VerificationCtx gained an optional `purpose` field (an OBJECT field —
zero positional-arg risk, the lesson from P2's constructor), both entitlement call sites read ctx.purpose ??
'BOOKING_VERIFICATION', and the phone port names CUSTOMER_PHONE_CHANGE. Pinned by a new 3-test spec: default
purpose, caller-supplied purpose reaching BOTH precheck and the ledger record, and a throwing recordSubmission
never breaking code delivery (billing is subordinate to the send). §16 separation proven structurally: grep shows
ZERO entitlement imports in src/auth or src/customer-activation; exactly three files (sms-packages ×2 +
customer-booking.module) touch the service — the booking service itself uses only the SmsPurpose type.
VERIFIED: affected folders 344 + purpose pins 3/3 · ALL 13 GATES · FULL battery 829+734+758+725+736+800+804+677 =
**6,063 + 4 skipped, 0 failed** · tsc 0. P3 next: assignment/change service (§7-§8) + manual credits (§29).

## Jul 29, 2026 — SMS Packages P3: assignment, change policy, manual credit (spec §7/§8/§27/§28/§29)
Migration 428 adds the pending pair (pending_package_id, pending_effective_at) to tenant_sms_subscriptions — a
NEXT-CYCLE change is promoted LAZILY by the entitlement resolver at the first touch on/after the boundary (one
atomic UPDATE inside resolve(); no cron, no missed promotion: the code path that needs the truth applies it).
New SmsTenantPlanService + controller at /super-admin/sms-tenant-plan (own mount so nothing shadows the
package-id routes): tenantPlan() = the §7 panel (assignment + pending + live balance + last 10 changes with
reasons), assignPackage() with the documented no-proration semantics — IMMEDIATE flips the subscription AND
re-snapshots the OPEN cycle to the new terms with counters preserved (usage so far counts against the new
allowance; base-price billing treatment is P7's), NEXT_CYCLE sets the pending pair and the open cycle keeps its
old snapshot to the end (§26). The §28 DEFAULT when Super Admin omits `effective`: a downgrade (new included <
current) waits for next cycle, anything else is immediate — always overridable, and the audit row records when
the default was applied. addCredit() (§29) requires a positive whole amount + reason, lands on the OPEN cycle's
credit_allowance (expires at cycle end by construction; a custom expiry date is deliberately deferred — when
needed it becomes a credits table, not a column hack). Reason is REQUIRED on both operations; both write §55
audit rows; assignment also writes the tenant_sms_package_changes history row. Permissions reuse P1's §54 keys
(sms_tenant_plan.view/change, sms_usage.adjust). pgtest 5/5 FIRST RUN: first assignment · upgrade-immediate
re-snapshot with used_included surviving · downgrade default queues pending with cycle snapshot untouched ·
lazy promotion fires and clears the pair · credit grows allowance, rejects blank reason and negative amounts.
VERIFIED: migrations 428/428 · sms-packages + customer-booking folders 252 · ALL 13 GATES · tsc 0 · DI OK ·
types-drift covers the new columns. Full battery = next session's first step per the standing rule. P4 next:
the Super Admin screens (packages table + tenant panel + usage table §44).

## Jul 29, 2026 — SMS Packages P4: the Super Admin screens (spec §3-§5, §7 inline, §44)
Battery first per the standing rule: all 8 shards at fd3e7d2 — **6,069 + 4 skipped, 0 failed**. Then the screens.
Backend gained the §44 data source: SmsTenantPlanService.listTenantPlans() joins every tenant against active
subscription + package + OPEN cycle and returns per-tenant package, pending-change flag, total allowance
(included + credit + custom), used, overage, failed, % used, hard-limit flag, estimated bill in integer cents
FROM THE SNAPSHOT (base + overage × snapshot unit), cycle window, and last-SMS from the ledger; exposed as
GET /super-admin/sms-tenant-plan (declared above :tenantId — no shadowing) behind sms_tenant_plan.view; the
service joined the tenant-gate's reviewed baseline (SA cross-tenant by design). A transient tool re-run inserted
the endpoint twice — TS2393 caught it instantly; deduped.
admin-web: ONE new sidebar area per Kevin's §3 ("SMS Verification Packages", right after Plans & Feature Limits —
no duplicate modules), route + SmsVerificationPackagesScreen with two sections: (1) the §4 packages table with a
full §5 inline edit expander — every Super Admin number editable, prices typed as dollars and SENT AS INTEGER
CENTS via parseDollarsToCents, warning<critical enforced client-side before any call, Enable/Disable per row;
(2) the §44 tenant usage table with filter chips (All / No Package / Near Limit / Over Limit / Hard Limit),
honest em-dashes for package-less tenants, and a per-row Manage expander carrying Assign Package (reason REQUIRED
client-side; effective Default-per-§28 / Immediately / Next cycle), Add Credit (positive whole number + reason,
"expires at cycle end" stated), and the §7 Plan History (pending change + last 3 changes with their reasons) —
the dead-client gate actually forced that last wiring: tenantPlan() was declared without a caller and the gate
refused to pass until the screen consumed it, exactly what the gate is for. New api client superAdminSmsApi
(7 methods, all crosswire-matched). Screen suite 7/7: render + honest dashes, edit saves 2999 not 29.99,
threshold refusal with no API call, enable/disable flip, both filters slice correctly, assign blocks blank reason
then posts, credit rejects 2.5 then posts 50. VERIFIED: admin-web tsc 0 + build OK · ALL 13 GATES · sms folder 16.
Full battery = next session's first step. P5 next: tenant POS self-service (§9-§10 usage widget + upgrade,
§39 settings) on the balance() endpoint.

## Jul 29, 2026 — SMS Packages P5: tenant self-service (spec §9/§10/§38/§43)
Battery first per the standing rule: all 8 shards at af4774c — **6,069 + 4 skipped, 0 failed**. Then the tenant
side. Backend: SmsTenantPlanService gained actor-aware auditing (ctx.role recorded; audit action parameterized),
selfServicePackages() (active + self_service_available only, §43-safe fields — no margin, no provider cost), and
selfServiceChange() — refuses anything not marked self-service, reuses the same assignment mechanics, applies the
§28 default the TENANT CANNOT OVERRIDE (upgrades immediate, downgrades next cycle — that lever stays Super
Admin's), audits as tenant.sms_package_self_service_change with role TENANT and an auto reason. New
TenantSmsPlanController at /tenant/sms-plan: GET (settings.view) → balance + choosable packages; POST /upgrade
(settings.edit); tenant identity server-derived per the house pattern. pgtest grew two pins and hit two
order-coupling bugs OF MY OWN TEST'S MAKING — a non-UUID actor id, and a state change that broke a downstream §44
expectation — fixed by a UUID actor and relocating the new test to run last; 7/7.
pos-web: posSmsPlanApi client + SmsVerificationPanel embedded in Account — the §10 widget (progress bar,
1,425/2,000-style usage line, % and remaining, cycle window, overage line as count × snapshot rate = estimate in
exact cents, hard-limit note, next reset), the §9 change flow as inline Review → Confirm (no native dialogs)
posting only the packageId with the effective policy STATED to the tenant, an HONEST no-package state
("verification keeps working and is not billed") that still offers choices when Super Admin has made any
available, and §38 honesty — Twilio status is pointed to Communications, never fabricated as Ready. Panel suite
5/5 FIRST RUN (usage math · overage arithmetic · Review→Confirm posts · honest no-package copy · empty-choices
renders no upgrade UI). Existing Account suite unaffected (1/1). VERIFIED: pos-web FULL suite **726/726**
(391+335, sharded) · tsc 0 · build OK · ALL 13 GATES. Full battery = next session's first step. P6 next:
reconciliation (§58) + Super Admin tasks (§59) + threshold alerts (§31-§32).

## Jul 29, 2026 — SMS Packages P6: reconciliation, §59 dedupe, §31/§32 alerts
Battery first: all 8 shards at 877975f — **6,070 + 4 skipped, 0 failed**. Then the accounting safety net, built
on the house pattern the audit found (the customer-sync scheduler: env-gated 5-minute ticker, injectable clock,
findings filed for HUMANS — never auto-fixed). Migration 429: sms_reconciliation_findings with three types
(counter_ledger_mismatch / unbilled_usage_no_package / hard_limit_reached) and §59 DEDUPE ENFORCED STRUCTURALLY —
a partial unique allows at most ONE OPEN finding per (tenant, type, cycle); recurring issues update that row
night after night instead of minting 100 identical tasks. SmsReconciliationService.runDaily(): recounts the
LEDGER against every open cycle's counters and FILES disagreements with both numbers — §58's rule is in the
test: the corrupted counter stays corrupted after the run, a human resolves with the evidence. Package-less
traffic and hard-limit-stopped tenants are flagged for Super Admin (§32's deterministic alerts). The Twilio-side
comparison is an explicit ProviderUsageSource seam — without live creds the summary says providerComparison:
'unavailable' honestly instead of pretending. SmsReconciliationScheduler mirrors the house pattern exactly
(SMS_RECON_WORKER_ENABLED, fires once daily at 03:30, tick() exported so tests drive production's own path).
SA endpoints: GET reconciliation/findings (sms_usage.view) + POST :id/resolve (sms_usage.adjust). §31 tenant
alerts: balance() now carries the current package's warn/crit thresholds and the POS panel shows the spec's
EXACT texts one tier at a time — "used X%" at warn, "approaching" at crit, and at 100% "SMS verification limit
reached." for hard limits vs "Overage charges now apply." for soft. Admin screen gained the Reconciliation
Findings section (numbers inline, Resolve/Dismiss; honest empty state). Reconciliation pgtest 5/5 (healthy cycle
files NOTHING · corruption filed with ledger=2 vs counter=7 AND left untouched · second run updates the same row,
count 1 · resolve closes then a still-broken run files a FRESH finding · tick skips before 03:30, runs once, skips
the day). Panel 7/7 (two §31 pins) · SA screen 8/8 (findings pin; the filter test got scoped when the findings
table introduced a second "Over Salon") · builds OK both apps · sms folder 22 · ALL 13 GATES (the recon service
joined the tenant-gate baseline with its review note — a platform-wide nightly scan is cross-tenant by design).
Full battery = next session's first step. P7 next: billing integration (§47) + margin/revenue reporting (§22-§24).

## Jul 29, 2026 — SMS Packages P7: billing feed into the REAL engine, margin honesty, analytics (§47/§22-§24/§45)
Battery first: all 8 shards at 9a55d39 — **6,075 + 4 skipped, 0 failed** (+5 = P6's recon pgtest; shard shifts =
file rebalancing). The §47 audit answered the open question: a REAL invoice engine exists (super-admin-billing →
billing_invoices + billing_invoice_lines with kind/description/quantity/unit_price_cents/amount_cents). So SMS
charges ship as a FEED shaped exactly like those lines — GET /super-admin/sms-tenant-plan/billing/charges?month=
YYYY-MM returns per-tenant base (the SNAPSHOT monthly price of the month the tenant was actually on) + overage
(count × snapshot unit) + invoice-ready lines[] — the existing engine consumes them; nothing here mints its own
invoices, exactly as the spec forbids. GET billing/analytics (§22-§24 + §45): subscription + overage revenue,
per-package rollups (tenants, revenue, SMS sent/failed), usage by purpose over billable rows, raw status counts —
and the honesty rule as CODE: provider cost reports ONLY where provider_cost_micros was actually recorded
(10,000 micros = 1¢); zero recorded costs → costAvailable:false and the screen renders the spec's EXACT words
"Provider Cost Not Available"; margin exists only when both sides are real. Both endpoints behind
sms_billing.view. balance() gained the snapshot monthlyPriceCents so the tenant's §43 panel now shows
"Base $49.00/mo + $0.09 overage · Estimated total $49.09". Admin screen gained Revenue & Analytics (four KPIs,
per-package table, purposes/statuses line, and the charges feed as a collapsible invoice-line table). Billing
pgtest **4/4 FIRST RUN** (§68 exact math 4900+3=4903 with line shapes · cost-null honesty · 158,000 micros → 16¢
rounded, margin real · purpose grouping). Panel 8/8 (§43 pin) · SA screen 9/9 after scoping tenant-name lookups
(the charges table introduced a second "Palace Nails" — same lesson as P6's findings table) · both builds · sms
folder 26 · ALL 13 GATES (sms-billing.service joined the tenant-gate baseline — SA cross-tenant rollup by
design). Full battery = next session's first step. ALL SEVEN BUILD PHASES COMPLETE — next: the §71 final
verification report against the whole 71-section spec.

## Jul 29, 2026 — SMS Packages arc COMPLETE: the §71 final verification report
Battery first at be8258c: **6,079 + 4 skipped, 0 failed** (808+758+749+734+732+792+815+691 — +4 = P7's billing
pgtest). Then the arc's closing deliverable: SMS_PACKAGES_VERIFICATION_REPORT.md at repo root — the full §71
accounting: the seven phases with their commits, the reused-not-rebuilt inventory (§69), the schema with each
table's spec cornerstone, every §60-§68 proof with its exact numbers (4,903¢; 23505; ledger 2 vs counter 7 left
uncorrected; 158,000 micros → 16¢), the six design decisions as recorded in code, the honest NOT-VERIFIED list
(live sends, cost capture, external reconciliation, callback signatures — each waiting on an owner-side key), and
six explicit REMAINING items (pricing decision · Twilio creds · verify-callback→ledger status wiring ·
§42 free-trial credit · §40 platform-wide kill switch · custom credit expiry). Verification pillars stamped at
the foot. The arc that began as "three Twilio prices" ends as a package system where every number is Super Admin
data, every cent is snapshot-priced and double-bill-proof at the database, and every claim in this paragraph has
a green test behind it.

## Jul 29, 2026 — SMS Packages follow-up: §11 lifecycle closed on the ledger
The verification report's remaining item #3 was executable without Kevin, so it is done. The existing
signature-verified Twilio callback controller (reused, not rebuilt) now advances the sms-packages LEDGER beside
the session it already updates: DELIVERED on approved/delivered, UNDELIVERED/FAILED on the failure branch, with
delivered_at/failed_at stamped. Three deliberate properties, documented in the method: `billable` is NEVER
touched (the provider's ACCEPTANCE decided the money per our stated policy — a late delivery failure does not
un-bill and a callback must never rewrite money); the WHERE is TERMINAL-and-FORWARD-only so Twilio's retries and
out-of-order callbacks are idempotent exactly as they already are for the session; and write failures are
swallowed so a ledger update can never break callback handling. The tenant-isolation gate caught the first draft
matching on SID alone — correct to flag, and the better fix was available: the webhook has already resolved the
session, so the update is scoped to that tenant and a caller-supplied SID can never reach another salon's row
(no baseline needed). Pinned by a new lifecycle test: DELIVERED sticks, a late 'undelivered' retry is refused,
billable stays true, counters unmoved. VERIFIED: entitlement pgtest 6/6 · customer-booking 237 · booking+sms
folders 264 · ALL 13 GATES · tsc 0. The report's remaining list is now five items, all Kevin-gated or optional.

## Jul 29, 2026 — SMS Packages §40 master controls: the last non-Kevin item closed
Battery first at fe2043c: **6,080 + 4 skipped, 0 failed**. Then §40, the second executable item on the report's
remaining list. NO new table: the platform already has `platform_settings` (migration 202) with its own SA
repository, so migration 430 seeds four boolean rows in an 'sms_packages' group at their SAFE defaults (platform
ON, billing ON, enrollment ON, emergency OFF — deploying changes nobody's behaviour). All four are enforced in
ONE place, the entitlement precheck, and the ASYMMETRY is the design: Emergency Disable and Platform-off refuse
every tenant-funded send (returning the same shape as a hard limit, so every existing caller already handles it);
Billing-off does NOT stop sends — they continue unbilled and honestly ledgered, because a billing problem must
never become a customer-facing outage; Enrollment-off blocks a NEW subscription while existing tenants are never
disturbed. Platform-security OTP is unaffected by all of it because it never passes through the gate (§16).
Every change requires a reason and audits before/after. Admin screen gained a Master Controls section at the top
(engaged/off state, plain-language effect per control, inline confirm that states "takes effect immediately for
every salon"). pgtest **6/6 FIRST RUN** (safe defaults · emergency refusal · platform-off refusal · billing-pause
still sends · enrollment freeze blocks new but not existing · audit + unknown-key + blank-reason rejection).
Screen 10/10 (the stop button refuses to engage without a reason). Crosswire earned its keep AGAIN: my patch
anchor had eaten the `@Get()` decorator off the package-list route, and the gate caught the now-404ing client
call before commit — restored, 13/13 green. sms folder 33 · booking+sms 270 · builds OK · tsc 0. The report's
remaining list is now FOUR, all Kevin-gated or deliberately deferred.

## Jul 29, 2026 — root truth-docs re-synced after the SMS arc
Ten commits since the last sync left the four root docs behind — the exact staleness class this session has been
hunting, self-inflicted again. Battery re-run at 4835d9a for a real number rather than an inferred one:
**6,086 + 4 skipped, 0 failed** (808+758+749+734+732+792+816+697). README now says 430 migrations (and its
verify command expects 430/430); PROJECT_STATUS's verified block reads 6,086 and 430/430;
NEW_CLAUDE_INSTRUCTIONS says 430 migrations / 10 workspaces; TEST_REPORT gained a fresh dated "Current totals"
section with the live-harness line, its earlier tables explicitly marked history. The only surviving "6,049 /
426" strings sit inside a dated Jul-29 entry about the mobile arc, where they are correct as written and were
deliberately left alone.

## Jul 29, 2026 — SMS Packages: §41 + §46 built; the §71 report's own accounting gap closed
Self-review of the verification report found a completeness bug in the report ITSELF: spec §41 (default package
for new tenants) and §46 (per-tenant usage drill-down) were neither built nor listed as remaining. Both were
executable without Kevin, so both are done and the report carries a dated correction section owning the gap.
§41: migration 431 adds one more platform_settings row (safe default null = none). setDefaultPackageCode
validates the code against active packages, requires a reason, audits before/after; createTenant() — the ONE
choke point that both direct SA creation and application approval flow through (verified: the intake path calls
the same method) — fire-and-forgets applyDefaultForNewTenant(), which assigns with the audited reason "Default
package for new tenants (§41)" and swallows every failure, because a new salon must never fail to exist over an
SMS setting. The hook rides the existing assignPackage machinery (history row, cycle open, audit) — nothing
duplicated. §46: GET /super-admin/sms-tenant-plan/:tenantId/usage (declared above :tenantId) returns tenant-scoped
ledger rows with §21 masked recipients only; the Manage expander gained a Recent Usage table. Admin screen also
gained the Default Package section (None + active packages, reason required, plain-language note that "None"
means new salons verify unbilled). The multi-match lesson fired AGAIN — the new select's options duplicated
package names and broke the original render pin; scoped, recorded pattern held. VERIFIED: controls pgtest 8/8
(set/validate/audit · apply assigns w/ §41 reason · cleared default no-ops · §46 rows tenant-scoped + masked),
screen 12/12, sms + super-admin-tenants folders 81, ALL 13 GATES, both tsc 0, admin build OK, migrations 431/431.

## Jul 29, 2026 — final completion stamp
Full battery at 5bed41e: **6,088 + 4 skipped, 0 failed** (808+758+749+734+732+794+816+697; +2 = the §41/§46
pins). All 13 gates. Git clean. Truth-docs synced to 431 migrations / 6,088. Every unit executable in this
environment is built, tested, and packaged; the open items (SMS pricing numbers, Twilio + CommerceHub + APNs/
Firebase credentials, GitHub push, hosting envs, physical-device passes, Schedule-A sign-off) each require
Kevin's keys or decisions and are documented in PROJECT_STATUS, the SMS report, and PUSH_TO_GITHUB.md.

## Jul 29, 2026 — full-code bug sweep (Kevin's directive): classes the 13 gates don't cover
Six fresh detector classes run across api + all seven frontends; every real finding fixed and pinned.
FOUND & FIXED (1): sms-packages.service dynamic UPDATE — my own P1 code — built SQL by string with a hand-rolled
quote-escaper and no type validation on the two text fields. Not injectable as written (quotes were doubled), but
the wrong pattern where the house has a parameterized idiom: rewritten to sql.join of whitelisted-raw columns +
BOUND parameter values (the ai-admin pattern), name/description now type-validated (non-empty string / string-or-
null), the escaper deleted. Pinned by a round-trip test: "O'Brien's — Größte 'Salon' Päckchen" plus a description
carrying quotes, backslashes, semicolons and a SQL comment survives exactly, and nothing else on the row moves.
FOUND & HARDENED (3): three verifiers could THROW on malformed input instead of reporting in their own vocabulary
— webauthn's parseClientDataJSON (attacker-controlled browser JSON → now throws in-vocabulary
'clientdata_malformed' at both call sites), the session-token verifier and the signed-booking-context verifier
(both now return {valid:false, reason:'malformed'}; pinned by crafting VALIDLY-SIGNED non-JSON payloads via the
modules' own HMAC shape — signature passes, parse fails, the verifier reports instead of 500ing).
FOUND & FIXED (small): three radix-less parseInt in TenantsScreen → parseInt(x, 10).
SWEPT CLEAN (verified zero findings): raw-SQL audit of every sql.raw site (all others are allowlisted column maps
or internal constants; a2p's internal-keyed writer noted as acceptable) · unawaited .execute (all multi-line
awaited templates) · float arithmetic on *_cents · empty frontend catches · console.log in production paths (one,
deliberately flag-gated) · hardcoded localhost · forEach(async) · NaN comparisons · parseFloat(toFixed) round-
trips · unguarded JSON.parse elsewhere (all try-guarded or env-sourced) · duplicate migration numbers. The rbac
decorator-orphan sweep produced 130 candidates that are inline-checked tenant keys, not dead ones — noise, noted.
VERIFIED: sms-packages pgtest 6/6 (round-trip pin) · auth folder 401 (both malformed pins) · sms+booking 273 ·
TenantsScreen 16 · ALL 13 GATES · both tsc 0 · admin build OK. Full battery = next session's first step.

## Jul 29, 2026 — battery stamp for the bug-sweep commit
Full battery at f4cb8af: **6,091 + 4 skipped, 0 failed** (808+758+749+734+732+794+819+697 — exactly the three
sweep pins over the prior 6,088: the parameterized-update round-trip and the two signed-garbage verifier pins).
Truth-doc current totals stamped to match. Nothing else touched.


---

## Jul 30, 2026 — Developer-transfer handoff package (docs-only)
Executed Kevin's 55-section developer-handoff spec as a READ→AUDIT→VERIFY→DOCUMENT→ORGANIZE→PACKAGE pass — no
code changes (last code commit `f4cb8af`, battery-stamped `01eaad6`: 6,091+4, 0 failed). Created from measured
repo facts: `API_INVENTORY.md` (GENERATED — 265 controllers / 2,281 routes, re-runnable script),
`ENGINEERING_RULES.md`, `SECRETS_REQUIRED.md` (fresh clean scan), `LOCAL_DEVELOPMENT.md`,
`DATABASE_ARCHITECTURE.md` (618 tables / 1,826 indexes / 618 interfaces — corrected same day by live introspection; the earlier 577/1,033 were migration-grep undercounts), `AUTH_AND_SECURITY.md` (7 roles /
332 permission keys), `ARCHITECTURE.md` (mermaid + the four §39 flows), `PAYMENTS_INTEGRATION.md`,
`DEPLOYMENT.md`, `KNOWN_ISSUES.md`, `FRONTEND_BACKEND_GAPS.md`, `REMAINING_WORK.md`, `DEVELOPER_TASKS.md`
(APS-001…042), `HANDOFF_MANIFEST.md`. Refreshed: `DEVELOPER_HANDOFF.md` (new front door w/ §51 walkthrough),
`README.md`, `PROJECT_STATUS.md`. Six stale run/deploy docs got SUPERSEDED banners (kept for history).
Package: `AI-PowerSalon-Developer-Handoff-2026-07-30.zip`, clean-extract verified (see TEST_REPORT.md provenance rule).

---

## Jul 30, 2026 (later) — Enterprise-DB architecture arc (25-section spec)
Audit-first: the Jul-3 scaling program already covered most sections (measured at seeded 4M-row scale; sharding
+ multi-region measured NO-GOs; turn-on runbook). Gap deliverables shipped: `DB_ERD_AND_DOMAINS.md` +
`DB_INDEX_AUDIT.md` (both GENERATED from the live catalog via new re-runnable scripts — corrected the earlier
577/1,033 undercounts to the true 618 tables / 1,826 indexes), migration **432** dropping the one exact-duplicate
index found (75 prefix candidates left report-only with the measurement protocol),
`DB_TRANSACTIONS_AND_CONCURRENCY.md` (8 critical ops verified w/ pins), `DB_PARTITIONING_READINESS.md`
(design-only, per-family keys/triggers/runbook), `DB_ENTERPRISE_VERIFICATION_REPORT.md` (§25 — every claim
sourced; production-ready deliberately NOT claimed). Fresh full battery after mig 432: **6,091 + 4 skipped,
0 failed** (808+758+749+734+732+794+819+697) · 13/13 gates · 432/432 migrations.

---

## Jul 30, 2026 (later still) — Print features removed by owner decision + permanent gate
Kevin: remove Print Schedule / Print Queue / Print Service Ticket, block re-adding them, and tell the developer
they are not wanted. Removed 4 frontend-only controls (POSBookingScreen, POSTechQueueScreen, POSServingScreen,
POSServiceDoneScreen) — two called `window.print()`, two were placeholders showing "isn't connected yet". No
backend, route, table, permission, or event existed for any of them. Checkout **receipts** (including the
`print` receipt channel) are deliberately untouched. New gate `check:no-print`
(`apps/api/scripts/check-no-print.mjs`) is the **14th static gate** and is registered in the CI security lane —
it fails on the banned control labels and on any `window.print()`/`execCommand('print')` in a frontend. Gate
verified by re-adding a Print Queue button (failed with file:line), then removing it (green). Docs:
PRINT_FEATURES_REMOVED.md (new), ENGINEERING_RULES rule 17, KNOWN_ISSUES "not issues" section, REMAINING_WORK
not-on-this-list, FRONTEND_BACKEND_GAPS §4b, manifest + handoff walkthrough row.
VERIFIED: pos-web tsc 0 · pos-web suite **729 passed, 0 failed** (391+338) · production build OK · **14/14
gates** · security lane **17 PASSED / 0 FAILED** (was 16/20 checks → 21). API untouched (no battery owed).

---

## Aug 3, 2026 — Public booking page + the boot gate it exposed
NEW `apps/booking-html/index.html`: single-file public booking (register/sign-in → service/tech/date → real
availability → book), reusing the existing customer-booking API with NO backend additions. Wired into
`check:html` (third app; taught the gate the `$('id')` idiom — admin-web app went 0→15 verified refs) and given
a full REAL-Chromium journey in `e2e:html` incl. the 428 phone-verification path, server-side payload assertion
and call-order checks; sabotage-proven.
**Live-verified against real PostgreSQL 16 + the real API** (installed PG locally; 432/432 migrations; seeded):
registered a guest, booked twice, rows in `pos_tech_appointments`.
**TWO REAL DEFECTS FOUND BY LIVE RUNNING, both fixed:** (1) the API **could not boot** —
`SmsReconciliationScheduler` was a bare-class provider whose defaulted `() => Date` param Nest can't resolve;
6,091 unit tests never caught it because nothing ever instantiated AppModule in this environment. Fixed via
factory registration, repo swept for the same pattern (0 others). (2) technician names rendered `undefined`
(API returns `fullName`, page read `.name`).
**NEW GATE `check:boot` (15th)** — rebuilds and instantiates the REAL Nest AppModule; `check:di` is only a
static token check and passed on the broken module. A boot-check script existed but was wired to nothing; it is
now a gate + a CRITICAL check in the CI security lane, sabotage-proven against the exact bug.
VERIFIED: full battery **6,091 + 4 skipped, 0 failed** (8 shards, unchanged) · **15/15 gates** · e2e:html 3/3
apps · 432/432 migrations. Docs: BOOKING_PAGE.md (new) + manifest/README/handoff/status/tasks updated.


---

## Aug 3, 2026 (later) — NO-LOGIN guest booking page + an honest-error bug it exposed
NEW `apps/booking-public/index.html`: guest booking with **no account** — service → date → open times → name +
mobile → booked. Uses the EXISTING public surface with no new endpoints: the signed-link controller
(`api/ai-booking/v1/public/{availability/search,appointments}`) plus the public salon-services discovery route.
Sends `confirm:true` + a fresh idempotency key on every attempt (no unconfirmed writes, no double-booking on
retry). `AiBookingLinkService.mint()` now appends `&s=<tenantId>` to `bookingUrl` so a static page can list
services without a new endpoint (the salon id is already public on the discovery surface; the token is the
credential).
**BUG FIXED:** `AiBookingMutationService.mapError` didn't know `BookingPhoneNotVerifiedError` /
`BookingVerificationUnavailableError` / `BookingPhoneInvalidError`, so verification refusals on the PUBLIC link
returned `INTERNAL_ERROR` — a guest saw "the booking action could not be completed" instead of "verify your
phone", and the funnel logged internal errors. Now `PHONE_VERIFICATION_REQUIRED` /
`PHONE_VERIFICATION_UNAVAILABLE` / `INVALID_PHONE`, pinned by 3 new tests.
Wired into `check:html` (4th app) + a full real-Chromium guest journey in `e2e:html` (8 assertions incl. "no
login call happens" and "no fake success on a refused booking"); sabotage-proven by dropping `confirm:true`.
VERIFIED: battery **6,094 + 4 skipped, 0 failed** (+3 = exactly the new tests) · **15/15 gates** · e2e:html
**4/4 apps** · tsc 0. NOT VERIFIED: end-to-end against a real minted token (needs AI_BOOKING_LINK_SECRET).


---

## Sep 18, 2026 — design-picture audit, five built features, and silent-SQL hardening
Audited all 19 design pictures element-by-element against the code. **No requested module was missing.** 16
label mismatches fixed across POS Overview, Booking and Live Operations; every test that pinned an old label
rewritten to pin the new truth.

Built what the pictures showed and the code lacked: **More Filters** on Booking (branch · deposit status ·
conflicts-only — three filters the API always implemented and no screen surfaced), **Arriving Soon** as a
derived state with a one-line-configurable 15-minute window, and three Product Catalog panels — **Top Products
by Tenant Usage** (uncapped `GROUP BY`, after discovering the product projection is capped at 2,000 rows),
**Compare Tenant Product Configurations** (from `product_distributions`), **Product Version / Change History**
(from the four audited product actions). System Status gained **Last Check** — the only per-service metric with
a real source; Response Time and Uptime have none and were deliberately NOT invented.

Bugs found and fixed in work written this session: CSS specificity leaving a sign-in overlay swallowing clicks;
a `setTimeout` race loading services; the wrong audit entity type (`product` vs `product_master`); a
constructor argument in the wrong position; `product_distributions` has no `'completed'` status; `tenants` has
`display_name`, not `name` (twice).

That last class led to **`check:silent-sql`** and **`check:sql-identifiers`**, plus pgtests executing the
catalog, status, residuals, system-status and customer-data queries against the real migrated schema.

VERIFIED: api **6,113 + 4 skipped, 0 failed** · admin-web 781 · pos-web 733 · 13/13 gates · 432/432 migrations ·
e2e:html 5/5.

## Oct 6 2026 — 23-inch dual-screen display, Unit 1: the display follows the checkout and forgets the customer

Branch `work/dual-screen-display`. Spec audit and full record: `DUAL_SCREEN_DISPLAY_AUDIT.md`. Two fixes taken from the
removed `spec/checkin-display-oct5` branch because the new spec requires them (migrations 503, 505). New: four display
realtime events + a per-device channel; ticket changes mirrored to the ticket room; `payment_verifying`;
`POST /customer-display/device/release`; state `sessionId`/`version`; POS session start/update/cancel announced; the
display hook rebuilt (per-session stream, 15 s safety sync, fixed 3000 ms clear that destroys and releases). Found live
and fixed: POS tip/discount/promotion/deal/reward-code writes emitted nothing. Known gap: the display's tip still comes
from its session copy (Unit 2). Verified: 34/34 gates · API 1,702/0 · checkout 448 · queue 314 · race lane 95/0 ·
display 49 + build · live proof 20/20 (`apps/api/scripts/live-display-lifecycle.mjs`).

## Oct 6 2026 — 23-inch dual-screen display, Unit 2: every number on the display comes from the ticket

Branch `work/dual-screen-display`; record in `DUAL_SCREEN_DISPLAY_AUDIT.md`. New `CustomerDisplayCheckout` projection
built by the checkout module (`customer-display-projection.ts`) from the POS's own ticket, discount snapshot, totals and
payments — services/add-ons/products with first-name technicians, savings, tax, labelled fee, tip, payments, balance due,
payment status, points; the display renders it (`CheckoutTicket.tsx`, pinned totals). Display tip/method write the ticket.
Two real money bugs fixed: (1) the single-ticket loader never read `discount_snapshot`, so a new discount silently removed
the promotion/membership credit already on the ticket (live-proven); (2) the display's terminal charge used the session's
stale copy — a POS tip never charged, a partly gift-carded ticket charged in full, a paid ticket charged again (red on real
Postgres before the fix). Verified: 34/34 gates · API 1,707/0 · checkout 472 · race lane 98/0 · display 56 + build ·
live proof 28/28.

## Oct 6 2026 — found while running every suite: a dropped security event, and the server's UTC assumption

Separate commit; record in `DUAL_SCREEN_DISPLAY_AUDIT.md` Part D. (1) Since Oct 3 every `MFA_RECOVERY_CODES_GENERATED`
security event was refused by the database CHECK (the type was added to the code catalog only) and silently dropped —
migration 510 adds it; reproduced and fixed on real Postgres. (2) Seven module/app tests failed only because the machine
was on New York time: membership renewal and reminder dates and the billing catch-up assume a UTC process (production
and CI are UTC). `run-tests.mjs` now runs the suites in UTC; one analytics test fixed to be zone-independent.
Recommendation: set `TZ=UTC` on the API service. Verified: security-center 14/14 (red before); every module and app suite
green in UTC; the analytics test green in UTC, New York and Tokyo.

## Oct 6 2026 — 23-inch dual-screen display, Unit 3: the salon's own advertising (server, POS page, Super Admin)

Branch `work/dual-screen-display`; record in `DUAL_SCREEN_DISPLAY_AUDIT.md` (Part B, Unit 3). New domain module
`@aipowersalon/marketing` + migration 509 (ads, media, branch targeting, per-display switch, hourly display counts,
report batches; composite tenant keys). Statuses draft/scheduled/active/paused/expired/archived worked out in the
branch's time zone; all or selected branches, a manager only their own; image upload made in the owner's browser
(1920/1080/320 px copies) and checked on the server (magic bytes, MIME, extension, header dimensions, shape); controlled
text + QR codes with checked https destinations, no HTML; per-salon ad and storage limits under advisory locks; versioned
edits (VERSION_CONFLICT); audit on every change. Display routes `GET /customer-display/device/ads` (salon, branch and
display from the token; platform → plan → salon → branch → display) and `POST …/ads/displays`;
`customer_display_ads_updated` to the affected displays and POS screens. POS: Marketing & Growth → Customer Display
Advertising (Advertisements, Playlist, Schedule, Branches, 23-inch Display Preview, Analytics, Settings; simple mode).
Super Admin: General Settings panel for the limits; the on/off switch is the Feature Registry. Found and fixed: six web
apps had not built for production since Oct 4–5 (contracts read from source; new `frontend builds` audit); the owner
was refused on the new keys (coarse mapping). Verified: 35/35 gates · API 1,713/0 · modules 6,667/0 (marketing 88) ·
web apps 2,474/0 · race lane 102/0 · live proof 42/42 · browser proof 14/14 · 28 mutation checks caught.

## Oct 6 2026 — 23-inch dual-screen display, Unit 4: Kevin's layout — check-in left, a dynamic right panel

Branch `work/dual-screen-display`; record in `DUAL_SCREEN_DISPLAY_AUDIT.md` (Part B, Unit 4). The paired display on a
landscape screen is now one 23-inch screen: the salon's brand on top, phone keypad and appointment / walk-in check-in on
the left and centre, and a right panel that plays the salon's advertising until a checkout begins — then that
customer's live ticket takes it (the ad is gone, not covered), the payment status, the completed summary for 3 s, the
customer wiped, advertising again. The display plays its own playlist (`GET /customer-display/device/ads`), keeps the
list and pictures on the device for a network drop (until the new `validUntil`; never customer data), reports what it
showed, runs full-screen idle ads after 30 s untouched (the touch that ends them presses nothing), and shows the
check-in result in its footer for 5–10 s with what was typed cleared at once. Salon branding: the server builds the
header (name, the salon's own stored logo, tagline, branch name) — the Receipts & Branding logo used to live in process
memory and is now a checked file in the media store with one salon-wide row; POS Settings → Customer Display (tagline,
branch name, logo & tagline switch) and Receipts & Branding → Salon logo (shrunk in the browser to 800 px). A display
that restarts with its server unreachable shows the salon and its saved ads, then reconnects by itself. **Found and
fixed:** every display showing Go Check-In asked for services and technicians in a tight loop (a new hook object on
every render) — hundreds of requests a second, starving its checkout requests; the check-in vanished whenever a checkout
began (the slug came with the idle state only); a display in a branch without a kiosk was handed another branch's kiosk
(its guests landed in that branch's queue); the cleared state after payment dropped the salon's branding. Verified:
35/35 gates · API 1,725/0 · modules 6,678/0 · web apps 2,545/0 · harnesses 124/0 · race lane 102/0 · layout 204/204 at
three sizes · live browser proof 37/37 · 48 mutation checks caught (5 only after their tests were strengthened).

## Oct 6 2026 — 23-inch dual-screen display, Unit 6: the display as a device — pairing, registers, status, receipts

Branch `work/dual-screen-display`; record in `DUAL_SCREEN_DISPLAY_AUDIT.md` (Part B, Unit 6); migration 511. A display
now pairs itself: it shows an 8-digit code, the owner types it in POS → Devices → Customer Displays (the salon and branch
are the owner's session), and the display collects its credential once — only hashes on the server; the credential in
Keychain / Keystore or the browser's storage, sent in a header and never in an address (the stream is now a fetch-based
event stream). Registers (`pos_stations`): a display dedicated to a register or shared by the branch; Send to Display
picks the register's display, else a free shared one, online and in service only; Switch Display; DISPLAY_BUSY only when
every one is busy. The display's heartbeat (every 30 s) drives online (75 s) and the §85 state — REVOKED, MAINTENANCE,
OFFLINE, CHECKOUT, CHECK_IN, ADVERTISEMENT, ONLINE. POS Checkout's Customer Display card (Connected / Active "Showing
Mia's checkout" / Offline "continue checkout on the POS" / Maintenance; Send, Cancel, Refresh, Switch, Open on second
screen) and the §86 page (rename, register, maintenance, refresh, revoke, registers; the front desk operates, the owner
manages). The receipt step before the 3-second screen: text / email to masked destinations / no receipt, real providers
only, the salon's automatic choice after 45 s, recorded once, delivered by the POS's own Send Receipt. Second monitor:
Open on second screen places the window where the browser allows it; full screen is remembered and restored on the first
touch. **Found and fixed:** the front desk was refused (403) on Send to Display and Clear Display; a released checkout
stayed "on the display" until it expired; a cash customer's receipt quoted the card total with its surcharge; "Test"
stamped `last_seen_at`, so a switched-off display looked online, and the Devices overview called a display online for 5
minutes after it went silent; the Super Admin live queue counted a table nothing writes, without the salon filter.
**Removed:** the staff-side pairing / Test / status routes and the token-issuing admin route. Verified: 35/35 gates ·
API 1,778/0 · modules 6,693/0 · web apps 2,581/0 · packages 146/0 · harnesses 124/0 · race lane 105/0 (fresh DB) · live
browser proof 29/29 · Units 1, 3, 4 live proofs re-run 29/29, 42/42, 14/14, 37/37 · 52 mutation checks: 51 caught (3 only
after their tests were strengthened), 1 equivalent.

## Oct 6 2026 — 23-inch dual-screen display, Unit 7: the guest's own check-in — one device identity, the branch's menu, the visit

Branch `work/dual-screen-display`; record in `DUAL_SCREEN_DISPLAY_AUDIT.md` (Part B, Unit 7); migration 512. The display
now checks guests in with its OWN credential (`POST /customer-display/device/check-in/session`): the salon and branch are
the display's, no Go Check-In kiosk has to exist, a check-in session belongs to exactly one device (a kiosk or the
salon's own display), and a revoked or serviced display's check-in stops on the next request. One session per guest —
each gets 8 lookups and 3 new profiles (one session for the day refused the ninth lookup). The branch's own services
and prices (a two-branch salon showed both price lists); technicians working the rest of today and qualified for every
chosen service, asked again as services are picked, "From 12:00 PM" for a later shift, refused by the server otherwise;
the visit — every appointment and service with first names, compact with "+ N more", one "I'm Here" for all of it; the
quick walk-in — first name, phone, services, add-ons only with a service (one add-on rule for the POS and the guest), a
returning guest linked by phone, no service needed when the salon switched the choice off (such a salon took no self
check-in walk-ins at all); the queue engine's band shown as it came; a guest who walks away cleared after 90 s. The
standalone kiosk got the same. **Found and fixed:** the queue dropped a check-in's add-on and a POS price override's
reason on the way in (the in-memory store kept them, the database did not); the check-in KPIs and the wait counted the
UTC day, so after 8 pm in New York waiting guests vanished and the wait fell to zero; two simultaneous appointments
could hide one technician behind "+ 1 more"; the Unit 6 Full screen button was 33 px (§89: 44). Verified: 35/35 gates · API 1,786/0 · modules 6,728/0 · web apps 2,597/0
· packages 146/0 · harnesses 124/0 · race lane 105/0 (fresh DB) · layout 222/222 · HTML apps in Chromium · live browser
proof 39/39 · Units 1, 3, 4, 6 live proofs re-run 29/29, 42/42, 14/14, 37/37, 29/29 · 58 mutation checks: 57 caught, 1
only after its test was strengthened.

## Oct 6 2026 — 23-inch dual-screen display, Unit 8: the journeys end to end, isolation, recovery, and the final report

Branch `work/dual-screen-display`; record in `DUAL_SCREEN_DISPLAY_AUDIT.md` (Part B, Unit 8); the §131 report is
`DUAL_SCREEN_FINAL_REPORT.md`. No product code changed. A live proof drives both journeys of §117–§118 in real browsers
against the real API and database — phone → appointment → I'm Here → queue (the POS Queue screen updates live) → service →
service done → checkout → Send to Display (the ad is gone) → a POS discount and the guest's tip on the display → payment →
receipt → 3 s → ads; the walk-in with two services, an add-on and a preferred technician — checking every rendered frame
for the previous customer (§107), one screen element throughout, a display restart mid-checkout (§103), the API going
down and coming back (§102), the branch's other display and the other salon's display (§100, §119), a Main-only ad
(§120) and check-in isolation. A scan keeps the reference picture's sample data and mock ads out of shipped code. Proofs
now remove their branch and everything in it (a soft-deleted branch still showed in the POS branch switcher); the
leftovers of earlier runs were removed. **Found:** a server handing a display any active checkout went unnoticed by the
first journeys run (displays ask on a timer) — the proof now restarts the other displays mid-checkout. Verified: 35/35
gates · web apps 2,606/0 · journeys 43/43 · check-in proof 39/39 · layout 222/222 · HTML apps in Chromium · 3 mutation
checks, 1 only after the proof was strengthened.


## Oct 6 2026 — Unit 9: "today" is the salon's day everywhere a salon reads it; the Tech App's minutes

Branch `work/dual-screen-display`; record in `DUAL_SCREEN_DISPLAY_AUDIT.md` (Part B, Unit 9). The two bugs the §131 report
recorded. Postgres's `now()` / `current_date` and the server's own date are UTC — after 8 pm in New York they are already
tomorrow — and 29 salon-facing files counted "today" (or "this month") that way: the POS Overview and Dashboard, Service
Done, Serving, the Tech Queue (and its hourly chart's hours), Checkout, the **cash drawer** (evening cash went to the next
day's drawer: tonight short, tomorrow over), the technician's cash hand-off, the Technicians screen, the live technician
schedule, the Tech App, the Payment App's Reports, Memberships, the Owner App's month and hourly chart, messaging limits
(a second month's allowance from 8 pm on the 31st), the AI Center, Call Intelligence, the forecast's demand series and the
"vs yesterday" KPI snapshot. All now use the branch's zone (the salon's main location for salon-wide counts) through
`dayStartMs` / `monthStartMs` (date-time) and `tenantTimeZone` / `safeZoneName` (database); a new architecture ratchet
counts the UTC-day idioms per file and lets them only go down. The Tech App read a queue line's minutes and price from
fields the queue does not write (0 minutes, the list price) — fixed. **Found and fixed on the way:** the POS Dashboard
counted revenue only for `completed` / `paid` / `captured` payments, and checkout writes `approved` — so it missed every
payment the POS took; the Overview's revenue trend sent dates as "Mon Oct 05 2026 …". **Left on purpose:** Super Admin's
platform-wide screens and three platform jobs (verification usage roll-up, help-view de-duplication, the once-a-day
forecast guard). Verified: 35/35 gates · API 1,786/0 · modules 6,767/0 (+39) · web apps 2,606/0 · packages 181/0 ·
harnesses 124/0 · race lane 105/0 (fresh DB) · live proof 13/13 on the real API (a branch whose date differs from UTC's) ·
Units 1, 7, 8 live proofs re-run 29/29, 39/39, 43/43 · 31 mutation checks, 31 caught, plus the ratchet's two.

## Oct 6 2026 — Unit 10: Kevin's two decisions — sign once on the Clover; the chosen technician is assigned

Branch `work/dual-screen-display`; record in `DUAL_SCREEN_DISPLAY_AUDIT.md` (Part B, Unit 10); migration 513.
**Signature:** the customer display no longer asks for one (it asked after every approved card payment, while the
terminal call sent `includeSignature:"false"` — a Clover that asked on its own made customers sign twice). The display's
terminal charge now asks the Clover (`includeSignature:"true"`), decodes what the terminal returns (CardPointe's
gzip-compressed bitmap, or a plain bitmap / PNG / JPEG; nothing else, nothing over 2 MB) and keeps it on the approved
payment as before, `captured_on = 'terminal'`; POS Checkout → View Signature shows it and says where it was signed. The
display's signature pad, its two routes and its sessionless exemptions are gone; receipt and release no longer wait on a
signature. Still to confirm with a powered-on Clover: that `authCard` returns the signature and its encoding — the UAT
probe `bolt_uat_roundtrip.py --tap` now reports both. The wire-level terminal proof (`verify-terminal-capture.ts`) had
gone stale (PGlite could not apply every migration; its tickets had no lines since Unit 2) — it now runs on a real,
disposable Postgres. **Technician:** a guest's choice stays the ASSIGNED technician (as the POS walk-in records it);
now pinned by a real-schema test.
Verified: 35/35 gates · API 1,785/0 · modules 6,771/0 · web apps 2,609/0 · packages 146/0 · harnesses 124/0 · race lane
105/0 (fresh DB) · signature real-schema test 6/6 · wire-level terminal proof 17/17 · live proofs re-run 13/13, 29/29,
29/29, 43/43 · layout 222/222 · 17 mutation checks, 16 caught at once, 1 after its test was strengthened.

## Oct 6 2026 — Unit 11: one payment per ticket; Hold / Move; card terminals on registers; the outside database login removed

Branch `work/dual-screen-display`; record in `DUAL_SCREEN_DISPLAY_AUDIT.md` (Part B, Unit 11); migration 514.
**One payment at a time per ticket:** the display's card charge and every front-desk payment now take the ticket's one
checkout lock (the lock the manager's phone already used; new source `display`). While the customer pays on the
terminal, front-desk cash / card / gift card / split get 409 `PAYMENT_IN_PROGRESS` ("The customer is paying for this
ticket by card on the terminal right now") and nothing is recorded; while the front desk records one, the display's
charge does not start. Found with it: a ticket paid in cash was still charged the card-fee difference by the display —
it now skips a paid ticket. **Hold Ticket / Move to Front Desk** were messages only: Hold sets the ticket aside ("On
Hold", out of the ready queue, everything kept, a filter, Resume; paying clears it); Move lists the location's registers
and moves the ticket to one (another location's, a retired one, a paid ticket refused). **Card terminals on registers:**
the register is chosen from the location's registers when pairing and can be changed in Devices, which shows its name;
the display's charge uses its register's terminal and says why when there is none. **The outside database login:** 35
tracked files carried an outside Postgres server's login or address, most as the default when `DATABASE_URL` was unset
(`scripts/clean-bookings.mjs` with no environment emptied tables there). Each now requires `DATABASE_URL` and stops
without it; the new `db credentials` audit keeps any real server address or login out. **Still in the git history —
rotate that password and close port 5432.**
Verified: 36/36 gates · API 1,790/0 · modules 6,788/0 · web apps 2,614/0 · packages 181/0 · harnesses 124/0 · race lane
105/0 (fresh DB) · live proof 26/26 on the real API · wire-level terminal proof 17/17 · live proofs re-run 13/13, 29/29,
29/29, 43/43 · layout 222/222 · 18 mutation checks, 18 caught.

## Oct 6 2026 — Unit 12: UTC in the process; which gift card paid; the display's typefaces; shared check-in allowances

Branch `work/dual-screen-display`; record in `DUAL_SCREEN_DISPLAY_AUDIT.md` (Part B, Unit 12); migrations 515, 516.
**UTC:** the API and the worker import `common/utc-clock.ts` first and run in UTC whatever the host is set to (about 140
places use local-time date methods; a New York host shifted renewals and billing). Setting `TZ=UTC` in Railway is no
longer required. **Gift cards:** the redemption's ledger row now names its ticket and its payment (columns that existed
since migration 033 and were never written), and the payment keeps the card's last four (`payments.gift_card_last4`,
migration 515) — single, split and network-card payments. The customer display shows "Gift card ending 4321" on a
part-paid ticket; the POS refund screen says which card a refund goes back to. **Typefaces:** the display's Google Fonts
link asked for "Hanken Grotesque", a family that does not exist, so its sans face never loaded; both faces are now
bundled (`@fontsource`, OFL), no font CDN, offline restarts look the same. The real face exposed clipped add-on chips,
cut-off descenders in every service tile and the salon name, and a four-line ticket a few px short at 1366×768 — fixed;
the layout proof now checks the faces load from the app and that no text is cut off. **Not fixed (Kevin's call):** the
same misspelling is in the brand tokens and every other app, which have only ever shown the system sans. **Allowances:**
a check-in session's 8 lookups / 3 profiles are counted on its row (migration 516, atomic, salon-scoped), not per API
instance. Verified: 36/36 gates · API 1,793/0 · modules 6,798/0 · web apps 2,615/0 · packages 181/0 · harnesses 124/0 ·
race lane 106/0 (fresh DB) · live 30/30 (API started on New York time) · layout 255/255 · live proofs re-run 17/17,
13/13, 29/29, 29/29, 43/43, 39/39 · 23 mutation checks, 22 caught (the four allowance ones re-run after a new test file that had not compiled was fixed), 1
after its check was strengthened.

## Oct 6 2026 — Unit 13: a visit of several appointments is checked in all or nothing

Branch `work/dual-screen-display`; record in `DUAL_SCREEN_DISPLAY_AUDIT.md` (Part B, Unit 13). "I'm Here" checked a
visit's appointments in one at a time, so a failure between two left it half checked in until the guest tapped again.
`CheckInService.visitCheckIn` + `KyselyCheckInRepository.createVisitRecords` now record the whole visit in one
transaction (queue entries with their events, the appointments' "checked in", the change log in a savepoint). Already
checked-in appointments come back as duplicates; if another display checks the same visit in at the same moment, this
tap rolls back whole and re-reads the other's entries — no error for the guest, never two entries for an appointment.
The display's check-in makes one call per visit. The two after-hours-limited browser proofs gained `PROOF_TZ` (their
proof branch's zone). Verified: 36/36 gates · API 1,793/0 · modules 6,802/0 · web apps 2,615/0 · packages 181/0 ·
harnesses 124/0 · race lane 108/0 (fresh DB; +2: six displays on one visit at once; a mid-visit failure on real
Postgres) · live proofs 17/17, 13/13, 29/29, 29/29, 255/255, 30/30, 39/39, 43/43 · 6 mutation checks caught (1 only by
the real-Postgres test — PGlite's single connection could not tell).

## Oct 12–13 2026 — Merge of three lineages + the four mandates (Fair Turn, Technician Profile, Payroll, Dual-Screen) + Kevin's Oct 12 items

Full account for the developer: `DEVELOPER_HANDOFF_2026-10-13.md`. Inputs: the developer's tree as of Oct 6 (Power-Salon-main.zip),
the other Claude chat's Oct 12 package (330 files: Technician Profile phases 1–3, booking concurrency, Tech App, owner / Super Admin
features), and four mandates. Method: a merge contract; five port agents (developer delta · technician profile · payroll · booking ·
auth / Tech App API), each classifying every hunk ALREADY / PORT / CONFLICT and porting into the module layout (our structure wins,
their behaviour and fixes carried over); then five agents for the mandates' remaining work (Fair Turn Engine · payroll gaps ·
dual-screen line-by-line · the merged screens · a deep scan of Super Admin and the whole repo); then integration fixes.

Security: the developer's Oct 6 tree still contains the hidden `eslint.config.mjs` payload (Sep 29 finding) and a NEW obfuscated
`api.js` that its `package.json` build / dev scripts execute, plus a committed Firebase private key — none brought over; the developer's
machine and accounts must be treated as compromised. Refused from his tree: an unauthenticated push-token registration route,
client-supplied tenant / role ids, cleartext in customer-web.

Built (migrations 569–631): multi-technician routing; booking holds for the AI receptionist and copilot; replica-safe ticket status;
server-enforced POS auto-lock (on, 60 min, full sign-in after 8 h); Technician Profile (workforce state, breaks, time off, exact-service
eligibility, certifications, revocation chain, Tech App self-service, owner Live Team, Super Admin masking + support mode, favourites
first, Book This Look); Payroll (service sessions, commission provenance, review / approve / finalize / paid with step-up + hash,
payouts, audited export, locked-period refunds, exceptions + recovery, pay plans, inquiries); Fair Turn Engine (modes, versioned
policy, turn units, turn state + append-only events, skips that keep position, protection buffer, break policy, tie-breakers,
starvation boost, overrides with reason, daily reset, fairness dashboard, simulation); Dual-Screen (display state model, offline
check-in, standard codes, telemetry, EN / VI, display settings, Windows setup). Deep scan: 17 fixes (3 HIGH).

Found and fixed: existing salons' technicians would all have been refused on accept / start after deploy (migration 631 back-compat);
processor and payroll date bugs (periods split at UTC and lost their last day; a retail reversal dropped by a unique index); a race
when two helpers accept one line; first clock-in never entered the rotation; the display's phone-code screen could cover a payment;
go-check-in settings saved with a view permission; POS New Booking booked "tomorrow" after 8 pm on the east coast; gift-card
redemption could debit with no ledger row; commission-oversight history always empty (SQL type error); time-of-day and time-zone
dependent tests (time clock, unique-index review). POS safety refresh briefly 45 s, restored to 15 s on Kevin's Oct 13 instruction.

Verified: 45 gates + 13 audits · API 2,829/0 · 27 module suites · 8 web-app suites · 20 package suites · harnesses 124/0 · race lane
275/0 on a fresh DB · every live proof incl. Fair Turn 22/22, payroll 23/23, multi-technician 21/21, auto-lock 25/25 · programme DoD MET.

## Oct 10 2026 — Build Phase 15 (of 15): close-out — the programme is complete on the code side

`BUILD_PHASES_REPORT.md` (Phase 15) and `PROGRAMME_FINAL_REPORT_2026-10-10.md`. Five agents, then two short rounds for real
bugs the first round surfaced. Now: an events producer gate (155 events, all produced; `visit.started`, `checkout.started`,
`payment.authorized` retired; `customer.merged` and `visit.completed` produced); realtime NO PRODUCER and unclassified events
fail the build; `go-check-in-admin`, `booking-html`, `booking-schedule-html`, `_MERGE_ARTIFACTS/`, `HANDOFF/` and the nested
lockfiles removed (each with its wired replacement) and blocked from returning; the 96 unique indexes without `tenant_id`
reviewed (`docs/UNIQUE_INDEX_TENANT_REVIEW.md` + gate); START-HERE, DEPLOYMENT, API_INVENTORY and seven status documents
corrected; every DoD line DONE, HOSTING or DECIDED (`programme-dod.mjs`: 283 DONE · 18 HOSTING · 2 DECIDED of 303).
**Found and fixed:** processor webhook events from two salons with the same event id collided — the second salon's settlement
or refund was never recorded (567 / 568); card-testing fraud incidents for a second salon the same day were dropped;
customer-display terminal payments wrote no payment / checkout / visit events and could be charged twice by two racing taps;
terminal-paid tickets skipped the post-payment work (gift cards sold on the ticket never activated, deals not redeemed, no
compensation snapshot); POS live card payments wrote no `payment.captured` (no loyalty points) and could leave a
charged-but-open ticket; "first available" bookings failed on every real-database channel.
Verified: 45 gates + 12 audits · API 2,784/0 · modules, web apps, packages all passed · harnesses 124/0 · race lane 244/0 on a
fresh DB (560 migrations) · every live proof, drill and `e2e:html` · four DoD scripts MET.
Kevin's: the consolidated list in the final report §5 — E2 (rotate the external DB password, close 5432) and E3 (Android
keystores) first.

## Oct 9 2026 — Build Phase 14 (of 15): Constitutions 11 (Observability) and 12 (Security), completed on the code side

`BUILD_PHASES_REPORT.md` (Phase 14). Five agents against a lead-written contract (the container restarted mid-run; each
agent resumed its own section from disk). Now: a Postgres log + trace store (561) with request / correlation / trace search
and trace↔log linking in Super Admin "Request search", split into aggregate and sensitive telemetry permissions; process,
queue and storage metrics; seven System Operations dashboards; branch health every 15 minutes (562) with an owner card; an
on-call chain that escalates unacknowledged alerts by email / SMS / push with a signed single-use acknowledge link (563);
SLO validation; synthetic probes that say "not configured" until set up; backup staleness alerting and a backup job
template; security spikes into `security_incidents`; least-privilege `aps_api` / `aps_worker` database logins (provisioning
script + real-Postgres proof); a per-caller limit on guessing gift-card / coupon / reward codes (564); webhook dedupe proven
per provider (565); a support-session expiry guard; tenant-filtered AI retrieval wired into Reception Copilot with 60
prompt-injection evals in CI; a ClamAV adapter; an IDOR suite over 158 cross-salon routes (0 leaks); DoD predicates that
point at real evidence.
**Found and fixed:** card-processor webhook re-deliveries racing the original wrote duplicate refunds and settlements;
integration webhooks ran handlers 3× under concurrent drains; billing ingest answered 400 to concurrent re-deliveries; a
re-delivered call transcription was charged again every time; four routes answered 500 to another salon's id; jobs lost
their request's correlation id; (integration) the new code limit refused ordinary "apply a listed deal" and code-less
split payments under load (Phase 5 load proof: 3 of 40 got through) — it now engages only when a code is sent; (integration)
security signals wrote incident categories outside the platform vocabulary.
Verified: 42 gates + 12 audits · API 2,833 (5 integration-guard failures fixed; affected suites re-run 1,897/0) · modules
all 26 passed · web apps 3,229/0 · packages 19/19 suites · harnesses 124/0 · race lane 235/0 on a fresh DB · telemetry
22/22, IDOR 8/8, deals 39/39 and every earlier live proof and drill · DoD §396 70 DONE · 6 HOSTING · 0 NOT DONE; §324 71
DONE · 11 HOSTING · 0 NOT DONE · ~145 mutation checks, 4 equivalent.
Kevin's: provision the database logins (D1); clamd (D2); test salon + sandbox credentials (D3/D4); on-call contacts +
`ALERT_ACK_SECRET` (D5); backup cron then `BACKUP_REPORTS_REQUIRED=1` (D6); penetration test, real devices, backup access (D7–D9).

## Oct 9 2026 — Build Phase 13 (of 15): Constitution 6 (Mobile), completed on the code side — one transport, live on native, versioned, offline-safe, push and Face ID done right

`BUILD_PHASES_REPORT.md` (Phase 13). Five agents against a lead-written contract with the open decisions as defaults
(bundle ids = the native projects; TanStack Query; no crash vendor; manager-pay stays; EN / VI); no second round.
Now: native apps receive live updates (a single-use 60-second stream ticket — bug 1, they had fallen back to a 15-second
poll); ONE transport in the four apps (client headers, timeout classes, GET-only retry, idempotency keys, network state);
each app's version from one source, `GET /app-config` (version policy, flags, maintenance and kill-switch notices) and a
426 UPDATE_REQUIRED gate for native builds below the minimum only, with a Super Admin Mobile App Versions screen;
TanStack Query with a tenant-scoped offline read cache and a journal that replays an offline start / complete exactly
once (bookings, approvals and payments stay online-only); one push module in all four apps with no customer names in any
payload (13 producers); deep-link files served from env; Face ID rebuilt on an OS-protected device credential (it was the
15-minute access token behind a JavaScript check); release builds without arbitrary loads, cleartext or backups; privacy
screen and auto-lock; telemetry with app / version / platform and no PII; EN / VI with a real language setting; 82 local
money / date formatters on the shared packages; a mobile CI workflow; `MOBILE_ARCHITECTURE_AUDIT.md`.
**Found and fixed:** a signed-out or revoked session's open live stream never ended (web too); Face ID credential revocation
outside a state machine (hidden by a stale snapshot); three password-change paths never stamped the change time.
**Security finding for Kevin:** three Android upload keystores and their password files are committed (from the Sep 28
upload) — new keys via Play App Signing, then purge from history.
Verified: 42 gates + 12 audits · API 2,498/0 · modules 9,095/0 · web apps 3,192/0 · packages 991/0 · harnesses 124/0 · race lane 223/0 on a fresh DB · native realtime 17/17, app version 17/17, offline 13/13, and every earlier live proof incl. the dual-screen set · 137 mutation checks, 132 caught, 5 equivalent.
Kevin's: Mac + Apple signing / entitlements / APNs; Firebase + FCM; Android re-keying; one GitHub run of `mobile.yml`;
real-device checks, then `FACE_ID_ENABLED=1`; store URLs and minimum versions in Super Admin.

## Oct 9 2026 — Build Phase 12 (of 15): Constitution 5 (API), completed — validated, filtered, async, versioned, every status change explicit

`BUILD_PHASES_REPORT.md` (Phase 12). Two rounds of five agents (round 1 built each mechanism against a lead-written
contract; round 2 adopted validation and state machines module by module), then the lead integrated. `API_DEFINITION_OF_DONE.md`
now 55 / 57 DONE, 1 by ruling, only #53 (load at scale on real infrastructure — Kevin's) open.
Now: a business domain on every route (2,834); ONE plan-feature entitlement decision + `@RequireFeature` on 45 plan-gated
routes (enforcement in OBSERVE mode — no salon loses access; Kevin flips `FEATURE_ENTITLEMENT_ENFORCEMENT=enforce` after
`feature-gate-preview.mjs`); request bodies validated on 1,124 of 1,128 body routes (the 4 left are provider webhooks
signed over the raw body); one filter / sort / date-range syntax on 524 of 532 list endpoints (unknown filter / sort → 400,
every range capped); 199 state machines with 465 of 471 status writes going through them (~40 dangerous moves now
refused — a completed appointment cancelled, a refunded payment marked settled by a late callback, a gift card revived,
a count applied twice…); a 202 + status + download contract with all 37 file-building exports on it (re-authorized from
current grants when the worker runs, files in the private store); one upload policy on 16 of 16 upload routes; sensitive
whole-row reads 18 → 0; every app on `/api/v1`, legacy paths kept with Deprecation / Sunset headers.
**Found and fixed:** a chargeback outcome recorded twice counted the recovered money twice; the async worker silently
dropped controller guards; the tech app's "complete" wrote a status the database refused (error swallowed); POS and
owner screens of salons outside the Safety Community were refused every minute; a Phase 9 test that would fail for ever
after Oct 9 13:00 UTC.
Verified: 41 gates + 9 audits · API 2,429/0 · modules 9,059/0 · web apps 3,149/0 · packages 810/0 · harnesses 124/0 · race lane 223/0 on a fresh DB · live async 21/21, `/api/v1` browser 19/19, deals 39/39, the whole 23-inch dual-screen set, tracing, three drills, and every earlier phase's live proof · 237 mutation checks, 235 caught, 2 equivalent.

## Oct 8 2026 — Build Phase 11 (of 15): Constitution 4 (Infrastructure), completed on the code side — traced, metered, drilled, every hosting step written down

`BUILD_PHASES_REPORT.md` (Phase 11). Lead-written contract (reserved env names + migration numbers), then FIVE agents in
parallel (tracing + `/metrics` / runtime safety switches / container + CI/CD + media + Terraform / documents + drills /
flags, quotas, noisy neighbour, cost, webhook counters, tenant-partitioned scheduling); no second round.
Now: W3C tracing across HTTP → DB → outgoing calls → jobs → event consumers with an OTLP exporter (no new dependency);
`GET /metrics` behind `METRICS_TOKEN`; a stranded-payment sweep that only ever acts on the processor's own answer;
break-glass maintenance from the environment that works with the database down; schema version in System Ops and
`/health`; the per-salon rate limiter ON (ceiling re-derived from real POS load); production refuses multi-instance
without Redis; the container runs as `node`, migrations move to Railway's pre-deploy step; CI builds, boots and scans the
image (Trivy + IaC + SBOM), CD exists and is off by default; media storage without a hard-coded bucket, tenant/env key
prefixes and a lifecycle job; Terraform marked legacy and fixed; `DISASTER_RECOVERY.md`, `INFRASTRUCTURE_AUDIT.md`,
dependency inventory, diagrams, `DEPLOYMENT.md` for Railway, `docs/HOSTING_ACTIONS_FOR_KEVIN.md`; four drills run here
(restore, worker loss, Redis loss, DB failover); flag rollouts, tenant quotas, load and cost views, webhook counters, and
the three heaviest schedulers now one queue job per salon.
**Found by the drills and fixed:** sign-in answered 500 for a whole Redis outage; a cache miss took > 10 s while Redis was
down (commands now time out at 500 ms, pub-sub exempt); a worker booted while Redis was unreachable crashed at start; a
Phase 10 CHECK would have refused every mobile Tap-to-Pay transition.
Verified: 34 gates + 9 audits · API 2,152/0 · modules 7,819/0 · web apps 3,110/0 · packages 720/0 · harnesses 124/0 · race lane 207/0 on a fresh DB · live tracing 16/16 · drills redis-loss 13/13, worker-loss 13/13, restore 11/11, db-failover 10/10 + 9/9 · Phase 10 31/31, RLS 20/20, Phase 9 28/28, Phase 1 10/10, Phase 6 33/33, Phase 7 31/31, Phase 8 25/25 · 106 mutation checks, 106 caught.
Kevin's: every row of `docs/HOSTING_ACTIONS_FOR_KEVIN.md` (backups, PITR, WAF, staging, Redis, replicas + worker
service, the GitHub `production-image` environment, `METRICS_TOKEN` + a scraper, an OTLP backend, the bucket lifecycle,
unit prices for cost estimates).

## Oct 8 2026 — Build Phase 10 (of 15): Constitution 1 (Database), completed on the code side — every table owned, every constraint validated, the checkout board bounded

`BUILD_PHASES_REPORT.md` (Phase 10). The lead wrote the shared rules first (migration 534: the deferral ledger
`schema_deferred_constraints` + `schema_backfills`; `apps/api/db/migration-sql.mjs`; `-- migrate: no-transaction` files for
`CREATE INDEX CONCURRENTLY`), then FIVE agents built in parallel (ownership registry + runner + pre-flight + backfill
helper / indexes + constraints + versions + triggers + id types / duplicates + loyalty ledger + summaries + audit fields /
actor stamps + retention executor + pools + RLS / Super Admin Database page + EXPLAIN pass + live proof); no second round.
Now: all 705 tables classified (gate `check:db-ownership`); `db-preflight.mjs` before every start; a constraint existing
data breaks is deferred with its retry statement instead of failing a deploy; 0 tenant tables without a tenant-leading
index (was 81); the core FKs, `users` unique email / phone, unique loyalty profile, webhook and SMS uniques, 64 status
vocabularies; every NOT VALID constraint from Phases 7–9 validated (547); versions on stock and schedules; `updated_by` /
`deleted_by` + an actor-stamp plugin; ONE loyalty ledger for every balance change; Super Admin daily summaries actually
written; support sessions 3 → 1, idempotency stores 3 → 1, three dead audit tables and the plaintext webhook token
dropped; a central retention executor + written soft-delete policy; per-role pools + a worker pool; RLS on 10 core tables
(still OFF by default) proved by a live trial; the Super Admin Database page; a 31-shape EXPLAIN pass.
**Found and fixed:** the checkout board loaded every ticket a branch ever had (41.7 s per request at ~6,700 tickets) — now
open + today only, ≈ 0.4 s; the production image would not have started (runner import not copied); saving a retention
rule silently saved nothing; 15 test files replayed migrations with errors swallowed.
Verified: 34 gates + 9 audits · API 2,053/0 · modules 7,801/0 · web apps 3,101/0 · packages 676/0 · harnesses 124/0 · race lane 188/0 on a fresh DB · **live proof 31/31** + RLS trial 20/20 + Phase 9 28/28, Phase 1 10/10, Phase 6 33/33, Phase 7 31/31, Phase 8 25/25 · 90 mutation checks, 90 caught.
Kevin's (in the report): turning `DB_TENANT_RLS` on (staging first), PgBouncer, a least-privilege worker login, PITR +
off-primary backups + a restore drill, load on target infrastructure, phone encryption, which customer identity root wins.
On existing databases run once: `db-backfill-summaries.mjs`, `db-backfill-customer-identity.mjs`, and
`seal-bank-webhook-secrets.mjs` if 542 deferred.

## Oct 8 2026 — Build Phase 9 (of 15): Constitution 2 (Permissions & Authorization), completed — every staff route keyed, one decision, changes reach live sessions

`BUILD_PHASES_REPORT.md` (Phase 9). The lead wrote the shared pieces first (migrations 530–531: authorization versions
bumped by triggers, per-user ALLOW / DENY / temporary overrides, `user_branch_access` CHECKs + FKs, the append-only
authorization audit, the denial log; the wire types `tenant/authorization.ts`; the new keys, events and realtime names;
Kevin's open decisions as defaults), then FIVE agents built in parallel (authorization core / registry + role-check purge +
governance + matrix / keying all 324 unkeyed routes / the tenant approvals engine / Roles & Permissions UI + live proof);
no second round.
Now: **unkeyed staff routes 324 → 0 and default deny ON**; `decide()` returns `{ allowed, reason, scope }` (inactive,
realm, explicit DENY, template, ALLOW, temporary, scope, typed policies) and 403s carry the reason; every request checks
the session's authorization version (≤ 30 s cache, reloaded when the session is newer) — **a demotion stops the manager's
very next request on the same session**; template scope enforced at sign-in, branch selection and per request; salon-side
branch access; per-user overrides with expiry; last-owner protection (409) + ownership transfer; ONE salon approvals
engine (per-salon versioned thresholds, maker / checker, refunds / deal publishing / purchase orders moved) with a POS
Approvals screen and the owner Approval Center; access review, high-risk report, dormant-account alerts, denial metrics,
`worker:<job>` principals, export snapshots on 37 export routes; `PERMISSION_REGISTRY` → `docs/PERMISSIONS.md`; role-name
comparisons 218 → 151, each allowlisted with a reason (gate blocks new ones); a committed per-role ALLOW / DENY matrix
(2,672 routes × 17 principals).
**Found by the live proofs and integration and fixed:** switching branches mid-session always landed on the first branch
(the middleware stripped the `branchId` the request was about — pre-existing); a narrowed manager kept paying for up to
30 s after a refresh (stale cache re-authorized the fresh session); the denial report dropped today; non-front-desk
templates lost their own profile + Help Center; an override's branch could never arrive (field now `scopeBranchId`). The
first full lane run then caught a swallowed fixture error, a `'*'` that was never a wildcard, three new schedulers that
bypassed `runTick`, and two proofs without real permissions — all fixed, affected lanes re-run.
Verified: 31 gates + 9 audits · API 1,977/0 · modules 7,741/0 · web apps 3,091/0 · packages 642/0 · harnesses 124/0 · race lane 171/0 on a fresh DB · **live proof 28/28** + Phase 1 refresh 10/10, Phase 6 33/33, Phase 7 31/31, Phase 8 browser 25/25 under default deny · role matrix 0 diff · 125 mutation checks, 125 caught.
Decided / not done (in the report): one template per person; field-level rules stay per domain; 151 role-name checks remain
(allowlisted); privileged grants, access requests, OCR, residuals, payroll and community advisories keep their own
approval flows; a direct DB change without a session refresh reaches a cached request within 30 s. Who lost / gained
access is listed in the report (technicians lost unkeyed AI copilot / billing / credential reads; front desk is confined
to the home branch unless granted more).

## Oct 8 2026 — Build Phase 8 (of 15): `tenant_safety_community`, completed — drafted, approved, moderated, published to other salons, in a real browser

`BUILD_PHASES_REPORT.md` (Phase 8). The lead wrote the shared pieces first (migration 529, Kysely types, every wire type —
tenant `community.ts`, platform `community-moderation.ts` — permission keys, event + realtime names, the ports between the
backend halves, the module wiring), then FIVE agents built in parallel (core backend / moderation backend / interactions
backend / POS + owner UI / Super Admin Moderation Center + the browser proof); no second round. The audit found the API
unusable in production (every tenant user mapped to "technician", the moderator's identity undefined, fabricated
moderation cases), moderation able to publish from any state, other salons' ids in every response, evidence that could
never be uploaded, and no UI at all. Now: real roles; the moderator from the session under real cases; transitions from
the real status; one safe response shape (an author LABEL, never another salon's ids); tenant settings (versioned), rules
acknowledgment, the full workflow (drafts, re-scan, receptionist → approval, withdraw, return with a note, edit a
published advisory with versions, updates, resolve, reports, disputes decided by a moderator, appeals, private incidents
with explicit sanitized promotion); feed with full-text search, filters, sort, paging, input validation, name / DOB
redaction; threaded comments, similar experiences, follows, presigned evidence upload + scan + logged access; the
fan-out (one alert event per recipient salon, in-app, push, email, SMS only for critical with opt-in); related /
duplicate detection; per-salon jobs; the risk store behind the platform flag; the Super Admin Moderation API (queues, 22
actions, cases, restrictions, audit trail, analytics, settings — step-up + reason on every write). UI: POS Safety Community
(feed, deep link `/community/posts/:id`, editor, my advisories, approvals, incidents, settings, rules modal, emergency
banner), owner card + settings, Super Admin Safety Community Moderation (18 tabs).
**The browser proof found three things every unit test missed:** the emergency banner took the POS screen's grid row (every
screen broke while an alert was up); the comment box never showed before the rules were accepted; the privacy scan
redacted ordinary words after "login" / "pin". Also fixed at integration: salon-wide events reached only the owner room
(branch ids now carried), the risk store was never called, `/community` missing from the dev proxies, the schema guard's
set-returning functions.
Verified: 38/38 gates · API 1,867/0 · modules 7,622/0 · web apps 3,028/0 · packages 598/0 · harnesses 124/0 · race lane 167/0 on a fresh DB (+3 Phase 8 files) · **real-browser proof 25/25 (new: receptionist draft → manager approval → Super Admin moderation → published → another salon's feed, deep link and comment)** · 131 mutation checks, 130 caught, 1 equivalent.
Decided / not done (in the report): the 34-item completion list is not in this workspace (checked against the audit); AI
writing help stays 503 until a community task is registered; no automatic image redaction (a moderator review step); the
evidence upload has never hit a real S3 bucket; no load test; no tech-app screen.

## Oct 8 2026 — Build Phase 7 (of 15): `ai_scheduling_optimizer`, completed — reviewed, customer-approved, applied through the booking service

`BUILD_PHASES_REPORT.md` (Phase 7). The lead wrote the shared pieces first (migration 528, Kysely types, every wire type in
`@aipowersalon/api-contracts`, permission keys, event + realtime names, the engine ↔ operations ports), then three agents
built against them in parallel (engine + tenant API / operations / every UI) — no second agent round; the live proof ran
before the one full lane run. The audit found every review decision answering 409, `generate` claiming a constraint check
it never ran, a "simulation" returning the client's numbers, `PUT settings` ignoring its body, technicians able to apply,
and nine of fourteen tables never written. Now: recommendations are stored `review_required`; `generate` runs the hard
gate and the simulation on the server and derives "touches a confirmed appointment"; every status change is
compare-and-set on the version (409 `VERSION_CONFLICT`); apply uses the stored proposal + snapshot (moved appointment →
409 `STALE_SCHEDULE`, never overwritten), passes the appointment version to booking, retries with a versioned key;
rollback; settings versioned with rule versions and kill switches (location, salon, platform); own permissions
`ai_scheduling.*` (technicians see only what touches them). Real data feed: per-technician shifts, breaks, blocked times,
time off (new table), buffers + per-service setup / cleanup, one block per service with the learned-duration hierarchy,
group size, manual / deposit / in-service locks. Options with the full payload and booking holds; Reception Copilot and the
AI receptionist on the same `findOptions`. Customer proposals (original kept until approved; customer app approve /
decline; staff phone decision; manager notified). Runs with gaps / conflicts / understaffing; duration / staffing /
availability insights with approval; 13 `schedule.*` events through the outbox + realtime projection; per-location jobs;
template / LLM explanations with usage metering; an automation runner limited to internal actions; CSV export; owner
summary; tech changes; Super Admin overview / detail behind a support session / retry / rollback / disable / platform
switch (step-up). UI: the POS optimizer screen rebuilt (10 tabs), booking calendar overlay, the LLM "Optimize schedule"
button removed, one nav entry; owner card, tech badges, customer proposals screen, Super Admin oversight screen.
Integration fixes: audit rows from system contexts were lost (non-uuid actor) and mislabelled; a stale permission pin.
Verified: 38/38 gates · API 1,860/0 · modules 7,450/0 · web apps 2,880/0 · packages 598/0 · harnesses 124/0 · race lane 164/0 on a fresh DB (+2 Phase 7 files) · live proof **31/31 (new: Phase 7 — generated, reviewed, customer-approved in the customer app and applied through the booking service)** · 104 mutation checks, 103 caught, 1 equivalent.
Decided / not done (in the report): the ~70-item checklist is not in this workspace (checked against the audit); stations /
equipment constraints dormant (no service-station data); no browser E2E or load test; the voice / copilot controllers do
not pass `hold` yet; branch-week / multi-branch scopes not exposed.

## Oct 7 2026 — Build Phase 6 (of 15): `ai_queue_assignment`, completed — one engine, assignments through the queue, no overwrite

`BUILD_PHASES_REPORT.md` (Phase 6). Built by five agents in parallel against one contract, then integrated and proved
here. The audit found the requested technician, appointment protection and stuck detection silently broken, four
recommenders / two detection engines / three auto-assign switches side by side, decisions that never assigned, and an
auto-run that could overwrite staff. Now: data plumbing (requested + previous technician, appointment start in the
branch zone, real `updated_at` on every write, no 20-row page, availability / shift end / break / rotation signals);
ONE engine behind Queue "Best Match", Tech Queue best match and Auto Balance (`QUEUE_RECOMMENDER`); ONE detection core
shared with the Super Admin live-queue monitor; ONE versioned settings source (salon → location, stale save 409) with
the retired toggles removed. Migrations 524–527: queue version + status history (trigger on every writer), locks,
parties, per-service technicians, salon settings + versions, alert types, notified severity. Decisions (accept / reject
with reason / override / keep unassigned) and the auto-run act ONLY through the queue's assign with the expected
technician + version + idempotency key; the auto-run honours exclusions, delay, cap, the location / salon / Super Admin
(step-up) kill switches and the platform `ai.auto_actions` switch, never takes a tie or a guest who asked for someone else.
Domain events through the outbox, per-location scan / auto-run jobs, owner + manager notifications (once per severity, no
guest data), analytics, branch comparison, CSV exports, usage, role matrix (front desk assigns; managers override / set
rules / run automation / export). UI: the POS AI screen rebuilt (per-guest panel, overview, history, alerts with repair,
settings, rotation, auto), Queue / Tech Queue on the engine (reorder, locks, parties, Send Break real, every assign sends
the expected technician); Super Admin → AI Queue Assignment (new); owner comparison card; tech-app assignment badges;
customer app + kiosk "another technician is free sooner" with accept.
**The live proof found what every unit test missed:** the AI module injected the outbox writer as optional without
importing its provider, so in the running API no decision, auto-assign or settings event was ever written (fixed; a new
guard makes an optional or unprovided writer fail CI). Also fixed: a second direct realtime emission site (§343), a
flaky race test that hoped for an order instead of making it, a tenant-code collision between two race files, the kiosk
test not running in CI.
Verified: 38/38 gates · API 1,853/0 · modules 7,293/0 · web apps 2,814/0 (kiosk now in the lane) · packages 598/0 · harnesses 124/0 · race lane 161/0 on a fresh DB (+3 Phase 6 files) · live proof **33/33 (new: Phase 6 — real queue entries; the auto-run and three receptionists on one guest at once → one assignment)** · 263 mutation checks, 254 caught (every real survivor closed by a stronger test; 2 equivalent / by design; 1 not run, documented).
Decided (in the report): the ~60-item DoD is not in this workspace — checked against the audit's status table, its
three parallel implementations and its 16 bugs; not built: preference levels / language / accessibility, multi-technician
routing at serving time, side-by-side party assignment, what-if simulation, the platform feature key `ai_queue_assignment`;
no browser run of the new screens against the live API (jsdom against mocked responses).

## Oct 7 2026 — Build Phase 5 (of 15): the deals engine, completed — one domain, no oversell, deal-aware refunds

`BUILD_PHASES_REPORT.md` (Phase 5). The audit found five parallel discount stores and live money bugs. Now ONE deals
domain (migration 522 expands `deals` and carries `salon_promotions` → coupons with hashed codes, `tenant_promotions` →
automatic promotions, `customer_deals` → announcements; 523 freezes the legacy tables — the drop is one release later)
sits behind every surface, with the old routes as adapters. A **capacity ledger** (every use holds one place, counted under
the deal's lock) makes oversell impossible — proved on real Postgres under concurrency at the booking door and at the
register; an **application ledger** puts a deal on a ticket (`applied`), redeems it when the ticket is paid and reverses
it on a refund (whole ticket, or just the services it covered). One pricing engine: fixed calculation order, the salon's
stacking policy (best single / stack all / groups / exclusive), best deal, price floor, max total, budgets reserved
atomically, per-line snapshots with the locked terms. Eligibility with every reason (members, new customers, per
customer, min spend, day/time in the branch's zone, lead time, technician, service, channel) and a 13-rule AND/OR rule
builder with a simulator. Receptionists apply deals (`deals.apply`; a manual discount stays a manager's); hashed
single-use / bulk codes with lookup limits; persisted checkout audit; 16 new events; lifecycle + salon-local daily
aggregation jobs; plan feature/limit + per-salon platform switch. UI: POS checkout panel (eligible, why-not, best deal,
remove, codes/QR), refunds by service, Deals dashboard / wizard / codes / settings / history; customer app (salon, nearby,
saved, coupons wallet, deal page, estimate; guests browse); tech app (own services, catalog price); owner app (net
discounts, approvals); Super Admin → **Deals Oversight** (suspend with reason; booked places given back; per-salon switch
and limit). Integrations: loyalty and membership (stacking switches), wallet QR, marketing codes, the customer-app and
phone AI receptionist (`get_deals`), scheduling rules, CSV export.
**The live proof, the lanes and the gates found defects the unit tests could not** — among them: the phone agent's tool
webhook (`/voice/tool`) answered every call 401 "No session"; a customer cancelling in the app emitted no
`appointment.canceled` (a booked deal's place stayed taken); a refund of a service kept the customer's tax; full deals
were still advertised; the dashboard counted UTC days. All fixed with tests.
Verified: 38/38 gates · API 1,844/0 · modules 7,080/0 · web apps 2,713/0 · packages 598/0 · harnesses 124/0 · race lane 148/0 on a fresh DB (+7 deals) · live proof **39/39 (new: Phase 5 — oversell under concurrency at the booking door and the register, refund reversal, load)** · 23 mutation checks, 23 caught (two after strengthening the tests).
Decided (in the report): the 71-item checklist is not in this workspace — checked against the audit's status table and
its 21 bugs; legacy tables frozen, dropped next release; not built: BOGO/buy-X-get-Y and other extra deal types,
threshold approvals, clone, the AI deal builder, a queue badge, forecasting input, a campaign-editor link to code batches.

## Oct 7 2026 — Build Phase 4 (of 15): booking phone verification, completed — all three remote channels

`BUILD_PHASES_REPORT.md` (Phase 4). The audit's verdict was **0 of 3 remote channels able to finish a verified
booking**. Now one flow admits every remote booking (`VerifiedBookingFlow`): the slot is HELD while the customer verifies,
a proof is claimed by exactly ONE appointment, the appointment is labelled (`verified` / `recently_verified` /
`staff_override`), the hold becomes it; migration 521. Customer app (its own number; the 428 loop gone; "verify every
booking" works), the signed public link (send/check/captcha/services on the link; a code step in booking-public) and the
AI receptionist (code texted on refusal, DTMF keypad callback with its own sealed credential) all book end to end.
Verify Service SID + API key, a real "Test Verify", disconnect and branch credentials; session states with lock and
expiry (the expiry runs in the 20 s reconciliation); atomic attempt budget; per-IP/device caps across salons; fraud
counters fixed; CAPTCHA widget on three clients; the manager override made real (own permission tier, own platform
switch, labelled, no trust granted, owner alerted, POS waiting list); Twilio status callbacks deduped on the job queue;
`booking.phone_*` events; owner alerts; a POS usage panel; Super Admin → **Booking Verification Oversight** (module +
emergency switches with step-up, per-salon require/block/forbid-override); the duplicate `/customer/verify/phone` removed.
**The live proof and the race lane found eleven defects the unit tests could not** — among them: the entire AI
receptionist gateway answered every voice-platform call 401 "No session"; the sealed booking session was stripped from
every 428 by the error envelope's JWT-leak filter; no public booking page could load a single service; every single-file
HTML page was dead under its own generated CSP (inline scripts now allowed by sha256, never `unsafe-inline`); and five
simultaneous wrong codes could all be checked (the attempt limit did not hold under concurrency). All fixed with tests.
Verified: 38/38 gates · API 1,832/0 · modules 6,956/0 · web apps 2,673/0 · packages 596/0 · harnesses 124/0 · race lane 141/0 on a
fresh DB (+6) · live proofs 10/10, 22/22, 48/48, **54/54 (new: Phase 4 — customer app, public link incl. the page in
Chromium, AI receptionist, override, webhook, oversight)** · 23 mutation checks: 22 caught, 1 equivalent.
Decided (in the report): no new attempt/event tables (session row + outbox + job queue); the kiosk makes no bookings (its
switch removed with front desk / walk-in); owner-web unchanged (the POS settings screen is the owner's surface); the
group/deposit/high-value re-verify switches hidden (no booking path can feed them). Not proved against the real Twilio
(unreachable here). Found, not in scope: a public-link / voice booking with no technician fails in the staff engine
(now logged).

## Oct 7 2026 — Build Phase 3 (of 15): customer phone number management, completed

`BUILD_PHASES_REPORT.md` (Phase 3). **No SMS-verified phone change had ever activated** (E1: the session never
remembered its pending row; a swallowed error became a false version conflict) — migration 520 (`new_phone_id`,
deadlines, approval and display columns; masked `phone_display` rows repaired) and a DB-backed start → verify → activate
test. Sessions now end (deadline, expiry job on the Phase 2 queue, one open change per customer, idempotent replay);
`phone_display` is the readable number (it was the MASK — the POS list and the AI receptionist's caller-ID were broken);
`phone_verified_at` follows the proof; the OLD number's booking verification is revoked; future appointments, today's
open queue entries and reminders follow the number; a customer's SMS STOP carries to the new number. The sign-in
number moves only with the password, a fresh own SMS proof, a warning to the old number first, and every session ended.
Manager approval and duplicate resolution (new routes), branch policies, `customers.phone_manage`, `customer.phone_*`
events + realtime, old-number and owner notifications, failed synchronisations retried on the queue. New: POS editor
(proof label, country selector, approval, manager resolve/confirm, resend countdown, Open Twilio Settings, sync retry,
code on the customer display), customer-app password/countdown/sign-in-number step, a code pad on the customer display,
Super Admin → Customer Phone Oversight (counts only, sweep with a reason). The legacy verify route uses the canonical
service. **The live proof found six defects the unit tests could not** (empty-string branch → 500 on every customer-app
change; customer changes could not send their code; salon settings and branch policies silently ignored; the old number
not told when both end in the same four digits; legacy status without a mask; the display's code route refused as a
non-device route) — all fixed with tests. Twilio Verify is proved against a loopback fake (`TWILIO_VERIFY_BASE_URL`,
ignored in production).
Verified: 38/38 gates · API 1,813/0 · modules 6,898/0 · web apps 2,654/0 · packages 594/0 · harnesses 124/0 · race lane 135/0 on a
fresh DB (+1 file: phone concurrency) · live proofs 17/17, 13/13, 29/29, 29/29, 43/43, 255/255, 30/30, 39/39, 10/10, 22/22,
**48/48 (new: Phase 3 phone)** · 34/34 mutation checks caught. Not proved against the real Twilio (unreachable here; the
pilot salon is the first real check).

## Oct 7 2026 — Build Phase 2 (of 15): schedulers single-owner, one job queue, the tenant messenger, one circuit breaker

`BUILD_PHASES_REPORT.md` (Phase 2). Thirty-one background schedulers ran once PER PROCESS — now each tick takes a lease
in `scheduler_runs` (migration 518; one statement, minimum gap between starts) through `runTick`. One durable job queue
(migration 519 `jobs`: six classes, P0–P3, salon on every job, idempotency, SKIP LOCKED with a per-salon cap, lease +
reaper, backoff with jitter, dead letters, operator retry/cancel) with a worker per class; new Super Admin screen
**Jobs & Dead Letters** (also the event dead letters, which had no screen) and a self-test. The tenant messenger
(`TENANT_MESSENGER`, `NotificationsService.sendSms`): the salon's number/account, opt-outs, ledger and
`communication.sms_sent` / `sms_delivery_failed` in the same transaction; `communication.push_sent` with the push log.
**Bug found: customer activation codes were never texted** (empty tenant → refused → 503) — fixed. Receipts, customer
phone verification, gift-card claim links, password resets, the Super Admin OTP and the old-number warning now go
through the messenger. One circuit breaker (`circuit-breaker.ts`) for the provider chokepoint, the AI router and the
integration connections — and at `instrumentedFetch` it now REFUSES an open circuit without a network call (per
provider + host; the card terminal opts out); the integration half-open probe is claimed atomically.
Verified: 38/38 gates · API 1,805/0 · modules 6,831/0 · web apps 2,622/0 · packages 593/0 · harnesses 124/0 · race lane
132/0 on a fresh DB (515 migrations) · live proofs 17/17, 13/13, 29/29, 29/29, 43/43, 255/255, 30/30, 39/39, 10/10,
22/22 (new: two API processes) · 21/21 mutation checks caught. Not in scope (stated in the report): email behind the
messenger, migrating the per-feature job tables, the 5 remaining producer-less events (Phase 15).

## Oct 7 2026 — Build Phase 1 (of 15): cross-cutting production bugs from the 20-document audit

Kevin asked whether the code is a 100% completed build of the 13 constitutions + 7 module specs. It is not:
`FULL_BUILD_AUDIT_2026-10-06.md` (verdicts), `docs/audit-2026-10-06/` (file:line evidence), `BUILD_PLAN_2026-10-06.md`
(15 phases). Phase 1, recorded in `BUILD_PHASES_REPORT.md`: seven services' audit records were silently dropped (typed
`AuditSink` + `auditSinkFor`, `recordPlatform`, gate `check:audit-wiring`); `''` reached UUID branch columns (a billed,
uncheckable SMS; 500s) — `branchOrNull`; a database restart crashed every instance (pool error listener + timeouts +
close on shutdown); SIGTERM hung with live SSE clients (drain before the HTTP server closes; readiness 503 while shutting
down); provider calls had no timeout (per-provider timeouts at `instrumentedFetch`); replicas raced the migrations
(advisory lock + lock_timeout); migration 517 (tenant-consistency trigger and customers RLS use the index); a narrowed
manager could re-escalate themselves (no self-assignment, grants capped at what the actor holds); `users/:id/role` could
mint platform accounts and demote the last owner; "Edit price" was hidden from everyone; a token refresh kept stale
permissions (re-derived every refresh; suspended/moved accounts end the session); mobile clients (no localhost native
default, per-call base, bearer on uploads, `VITE_APP_VERSION` stamped, Tap-to-Pay Face ID button removed). Also: package
tests now run in CI (one had been failing unseen); admin-web's own build was failing at tsc (gate "app types").
Verified: 38/38 gates · API 1,802/0 · modules 6,821/0 · web apps 2,615/0 · packages 587/0 · harnesses 124/0 · race lane
115/0 on a fresh DB (513 migrations) · live proofs 17/17, 13/13, 29/29, 29/29, 43/43, 255/255, 30/30, 39/39, 10/10 (new)
· 15/15 mutation checks caught.


## Oct 13 2026 — Wave 3: Tap to Pay payment app, Payments / Clover / Fiserv / Twilio, Smooth Refresh, Technician Profile, Fair Turn → payroll chain

Kevin's four Oct 13 attachments audited section by section (ledgers: 224 + 191 + 123 + 183 sections, 0 NOT DONE) and every gap built
on the existing systems (one checkout, one payment domain, one payroll, one realtime). Tap to Pay on iPhone finished on
`apps/manager-pay-web` + `mobile-checkout` (claims, versions, device trust, unknown-state recovery, customer handoff, split / partial,
receipts, history / reports, branch switch, kill switches; Apple / Fiserv access BLOCKED_EXTERNAL); branch merchant accounts, terminal
registry with a real connection test, Twilio Messaging Service per salon, segment accounting, campaign cost preview; booking
create AND move blocked by the database on every path (15 s POS sync / 20 s reconciliation kept); technician employment history,
public-profile approval, transfer, portfolio → Nail Showcase, CSV import; 8 duplicate commission formulas merged onto the one
compensation authority. P0s fixed: customer web Pay screen sent the typed card number as a token (purge script for production);
any salon could take over another salon's SMS number. Migrations 638–641, 646–647, 660–661. Live money chain 24/24.
Verified: 45 gates + 13 audits · API 2,843/0 · 27 module suites · all web-app suites · race lane 294/0 · every live proof · DoD MET.
Details: `DEVELOPER_HANDOFF_2026-10-13.md` §2a.

## Oct 13 2026 — One payroll calculation (Kevin: "make into one only")

Commission, tip shares, technician earnings and payroll amounts are now calculated ONLY in `modules/workforce/src/compensation`
+ `modules/workforce/src/payroll` (integer helpers `percentOfCents` / `splitByPercent` in `packages/money`). 14 more places that did
their own math moved onto it (22 in all): Tech App estimate fallback, POS roster estimated commission / payroll snapshot (today's
sales × current rate, tips 0), three formulas inside the engine, commission report fallback, hard-coded 15 % on Service Done /
Serving, whole ticket tip to the primary technician (Tech Queue, owner dashboard, tip notifications), queue's own rate rules, the
membership split, a POS screen computing the technician share. New gate `check:one-payroll-calculation` (8 rules, frontends
included, 10 sabotage cases caught). Also: membership renewal dates were computed / printed in the server's time zone (UTC now).
Verified: 46 gates + 13 audits · API 2,844/0 · all module + app suites · race lane 294/0 · money chain 25/25 · payroll 23/23 · Fair Turn 22/22.

## Oct 13–14 2026 — Wave 4: deep scan of every module, pilot day, every gap fixed, malware clean-up kit

Route sweep (2,913 routes, PostgreSQL-log check for swallowed failures), event wiring proof and a full pilot day (74/74, onboarding
to payroll lock, real API + DB + apps in Chromium). ≈ 50 defects fixed with failing tests first — AI settings refused everyone,
AI booking link never booked, Customer App stream refused customers, POS commission never reached payroll, category/membership
rules never applied, surcharge not recorded, owner finance $0, POS Reports invented numbers, commission report $0 after 8 pm in
the US, audit and settings-audit rows lost, membership renewals never scheduled, mock SMS could run in production, owners can now
invite staff (managers with step-up). Developer malware: `tooling/security/clean-developer-tree.sh` + `docs/security/
DEVELOPER_MALWARE_CLEANUP.md`; gate `check:supply-chain-injection`; ten stray root scripts and three committed test exports removed.
Migrations 662–663. Verified: 47 gates + 13 audits · API 2,852/0 · all suites · race 294/0 · pilot 74/74 · sweep 14/14 · wiring 17/17 · DoD MET.
