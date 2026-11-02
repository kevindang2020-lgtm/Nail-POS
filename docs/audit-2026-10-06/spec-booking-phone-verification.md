# `customer_booking_phone_verification` — spec vs code (Oct 6 2026, tree 7301539f)

Verdict: **PARTIAL, roughly 40% of the surface — and 0 of 3 remote channels can complete a verified booking end to end.**
Most backend pieces exist, but no tenant can turn the feature on through the product (the Verify Service SID can never be
saved or validated), the customer app loops on 428 forever, and every configuration audit is silently dropped.

Path legend: CB = `modules/booking/src/customer-booking/`, MIG = `apps/api/db/migrations/`, VB = `modules/ai/src/voice-booking/`.

## What the spec asks for
A six-digit code verified before any remote booking (public page, customer app, AI receptionist, kiosk) is finalized, when
the tenant's policy requires it. Twilio Verify preferred; hashed internal code as fallback. Each tenant (optionally branch)
uses its own Twilio account + Verify Service — no shared platform sender; enabling requires connecting and testing Twilio.
Flow: hold the slot → send → check → summary → confirm → create through the existing services; idempotent; release the hold
on failure/expiry. Deterministic policy resolver (platform emergency → Super Admin tenant require/block → tenant/branch →
channel → history → risk → provider) with versions. Tenant-scoped reuse windows (every booking, 24h, 7d, 30d); a changed
phone or a high-risk booking forces re-verification. Rate limits by phone/IP/session/tenant/device; fraud + SMS-pumping
detection; CAPTCHA adapter. Manual staff override: owner/manager only, reason required, labelled, never marks the phone
verified. Tenant settings + Twilio setup screen; Super Admin "Booking Verification Oversight". Webhooks, events, durable
jobs, notifications, usage reports, audit, retention, test matrix, 50-item completion list.

## Status by area
| Area | Requirement | Status | Evidence |
|---|---|---|---|
| Schema | `booking_holds` extension + no-overlap | DONE | MIG 367, 372 (EXCLUDE gist), 484 |
| Schema | `booking_verification_sessions` | PARTIAL | 367 (+370 IP/device); `booking_hold_id`, `correlation_id`, `policy_version`, `*_config_version` never written |
| Schema | `booking_verified_phones` UNIQUE(tenant, phone_hash) | DONE | 367; `last_booking_at`, `expires_at` never written |
| Schema | Twilio Verify SID, branch scope, validation time | PARTIAL | 368 adds `verify_service_sid`, `branch_id`, `last_validated_at` — **no code writes them**; MIG 311's full unique `(tenant_id, provider)` never dropped so branch rows cannot coexist |
| Schema | tenant/branch settings, platform policy, usage rollup | DONE | 368, 371 |
| Schema | attempts / events / rate-limit / fraud-alert / webhook-event tables | MISSING | fraud blocks go to `audit_logs` (CB `booking-verification-fraud.adapters.ts:101-108`) |
| Services | policy resolver | DONE | CB `booking-verification-policy.ts:165-252` |
| Services | one guard used by 3 channels | DONE | CB `booking-verification-guard.ts`; callers `apps/api/src/ai-booking/ai-booking-mutation.service.ts:93-98`, VB `voice-booking-write.service.ts:78`, CB `customer-booking.service.ts:263-282` |
| Services | Twilio Verify provider | DONE (code) | CB `booking-verification-provider.ts:75-128` (`Locale` never passed) |
| Services | tenant credential resolver, fails closed | PARTIAL | CB `booking-verification.kysely.ts:24-71`; without a Verify SID returns `internal_otp`; internal sender deliberately unbound (`customer-booking.module.ts:76-78`) → `twilio_not_configured` (`booking-verification.service.ts:174`) |
| Services | internal hashed-code fallback | PARTIAL (dead) | unbound; `findSession` always returns `codeHash: null` (kysely 202) |
| Services | send / check | DONE | 60 s cooldown, 5 attempts, 10-min expiry, enumeration-safe, masking, SMS-entitlement gate (139-154) |
| Services | hold service | PARTIAL | CB `booking-hold.kysely.ts:164-242`; `acquire`/`convert`/`release` never called by any booking path |
| Services | verified-booking completion | MISSING | the customer just retries `POST /customer/booking`; no session consumed |
| Services | settings | PARTIAL | CB `booking-verification-settings.service.ts`; missing countries, language, cooldown, max sends/attempts, lockout, recipients, high-risk rules; no booking path passes `risk` |
| Services | fraud engine | PARTIAL | `novelCountryForTenant` always false (adapters 93); failed-check count not by IP and counts only `failed`/`locked` (71-73) which a wrong code never produces; per-IP/device hard caps not applied here |
| Services | CAPTCHA | PARTIAL | adapters 118-160 fails closed; no client renders a widget → challenged requests always refused |
| Services | webhook | PARTIAL | CB `booking-verification-webhook.controller.ts`; updates `WHERE status='pending'` (115) but sessions are inserted `'sent'` (kysely 230) → never matches; no dedupe table/queue/DLQ |
| Services | retention / usage jobs | PARTIAL | in-process timers, off unless env flags; no durable queue |
| Services | manual override | PARTIAL (no effect) | CB `booking-verification-override.*` updates a session row no booking path reads; client token `bs.` vs UUID column → 500; `bypassBlocked` reuses `blocked_for_tenant` |
| Services | Super Admin oversight | PARTIAL | CB `booking-verification-oversight.service.ts`; no `module_enabled` setter |
| Services | transcript redaction | DONE | `ai-voice-transcription.service.ts:159` |
| Services | DTMF entry | PARTIAL (broken) | see bugs |
| Services | events / notifications | MISSING | — |
| Routes | `GET /customer/booking/verification/policy`, `POST send`, `POST check` | DONE | CB `booking-verification.controller.ts:166-229` (signed session token) |
| Routes | change phone / status / cancel / complete; tenant usage / alerts; webhook retry; public signed-link send/check; AI receptionist send; Twilio disconnect | MISSING | `ai-booking-public.controller.ts` has only availability + appointments; VB `ai-receptionist-verification.controller.ts` has only `twiml` + `dtmf` |
| Routes | `GET/PATCH /pos/settings/booking-phone-verification` (+ branches) | DONE | branch ownership not validated |
| Routes | connect / test / status Twilio | PARTIAL | `tenant-messaging.tenant.controller.ts`; no Verify SID field; test send does not set `last_validated_at` |
| Routes | Super Admin policy / tenants / health / emergency-disable / tenant override | DONE | `booking-verification-oversight.controller.ts`, step-up on emergency-disable |
| Permissions | settings via `settings.view/edit`; Super Admin domain | DONE | `platform-roles.ts:98` |
| Permissions | override permission | PARTIAL | `pos.booking.override_verification` not in rbac; collapses to `booking.manage` (TECHNICIAN and CUSTOMER hold it) — only a hard-coded OWNER/MANAGER check in the service (override 51,97) |
| UI | customer-web | PARTIAL | `PhoneVerificationStep.tsx` complete; `BookScreen.tsx:317-372` handles 428 but the flow is broken; no `onChangePhone` |
| UI | booking-html / booking-public | PARTIAL / MISSING | `apps/booking-html/index.html:166-195`; `apps/booking-public/index.html:165` says "call the salon" |
| UI | POS settings / Twilio setup / override | PARTIAL / MISSING | `POSBookingVerificationScreen.tsx` (copy at 170 claims the slot is held — false); `POSMessagingSetupScreen.tsx` no Verify SID/disconnect/status; no override UI |
| UI | owner-web; admin-web oversight; kiosk | MISSING | admin-web has only the kill switch (`KillSwitchesPanel.tsx:11`) |
| Security | tenant from server context; enumeration-safe; masked; no plaintext code; encrypted credentials | DONE | — |
| Security | session binding | PARTIAL | trust keyed only by phone hash (guard 92-95) — another session knowing a recently verified number can book through the public link |
| Tests | ~200 unit cases / 15 files; 24 Postgres tests; 10 `PhoneVerificationStep`; load script | PARTIAL | every test uses a fake gate/audit; none covers the real `adaptGate`, the audit signature, the voice request context, or booking end-to-end after verification; `BookScreen` tests have no verification case |

## Duplicate implementation
`apps/api/src/customer/customer.service.ts:87-104` (`/customer/verify/phone`, `customer.controller.ts:90-91`) is a second
code system sending through the platform's env Twilio or `MockSmsSender` (`customer.module.ts:18-21`), returning `ok: true`
even when nothing is delivered.

## Bugs (most severe first)
1. **Customer app loops forever.** `adaptGate.resolve` passes `customerPhone: null` (CB `customer-booking.module.ts:163`) →
   history never read; `isVerified` always false (171) → 428 again after a successful check.
2. **Customer app send fails first.** `ctxOf` uses `userId` as the customer id (`booking-verification.controller.ts:62,77`);
   `req.ctx` has no `customerId` (`tenant-context.middleware.ts:99`); `customer-phone-lookup.kysely.ts:24` misses;
   `BookScreen` sends `phone: ''` (320) → 400.
3. **Cannot be enabled.** Nothing writes `verify_service_sid` / `last_validated_at` → enabling always fails
   (`settings.service.ts:127-137`); a Super Admin "require for tenant" → every remote booking 503 (provider never healthy, policy 215).
4. **Config audits silently dropped.** `AuditService.record(ctx, input)` called with ONE argument at settings 171, override 130,
   oversight 116,160 → `buildAuditRow` throws (`audit.dto.ts:91`), swallowed.
5. **"Every booking" never satisfiable** (`policy.ts:235-237`); the POS option sets it (`POSBookingVerificationScreen.tsx:22-27,151-156`).
6. **AI receptionist broken ×4:** `needsVerification` checked (VB `ai-receptionist-gateway.controller.ts:165`) never set
   (`voice-booking-write.service.ts:88`); "temporarily unavailable" mapped to SLOT_UNAVAILABLE (178); `dtmf` reads `req.ctx`
   but the guard sets `req.voiceCtx` (`voice-auth.guard.ts:27`); Twilio Gather callback cannot present `x-voice-key`, raw session id instead of the signed token.
7. **Override does nothing** (above). 8. **Holds never created** while the UI claims the slot is held. 9. **Webhook never matches** (status mismatch).
10. Health/usage near zero (sessions never `expired`/`locked`; `markFailed` never called).
11. **Billed SMS can be lost:** `send()` calls Twilio before `createSession`; an insert failure (e.g. '' into UUID `branch_id` NOT NULL) leaves a billed code with no session.
12. Staff copilot bookings gated as "online" (`ai-booking.controller.ts:48` → `createAppointment` hard-codes channel `online`, mutation 95).
13. Dead settings toggles (front-desk/walk-in/kiosk; `module_enabled` ignored by the settings store).

## Build order
1. Twilio Verify configuration: Verify SID (+ API key) in the credentials API/UI; real "test Verify" that sets
   `last_validated_at`/`last_validation_error`; disconnect; replace the 311 unique index if branch overrides stay.
2. Customer app gate: resolve the customer's phone via `customers.user_id`; pass it in the gate adapter; session-scoped
   verification consumed on booking ("every booking" works).
3. Audit call signature (bug 4). 4. Holds: acquire/convert/release + `hold_seconds`.
5. Public link: guest send/check scoped by the signed link + OTP UI in `booking-public`.
6. AI receptionist: voice send route, `needsVerification` + masked phone, DTMF request context/auth/token.
7. Override: allow the booking, label the appointment, real permission, separate bypass-block flag, POS UI.
8. Session states + abuse controls (expired/locked/failed, per-IP/device caps, CAPTCHA widget).
9. Oversight + reporting (admin-web screen, `module_enabled` setter, tenant usage/failures, events, notifications, durable jobs).
10. Remove / merge `/customer/verify/phone`.
