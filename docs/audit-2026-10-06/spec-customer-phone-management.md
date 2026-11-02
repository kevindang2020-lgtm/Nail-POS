# `customer_phone_number_management` — spec vs code (Oct 6 2026, tree 7301539f)

Verdict: **PARTIAL, about 45%.** The code has moved well past `CUSTOMER_PHONE_MANAGEMENT_AUDIT.md` (drivers, sync, routes,
POS/app/settings UI, the login-phone change and Super Admin oversight now exist). But the core happy path — SMS-verified
activation — fails in production (E1), every audit write is silently dropped (E3), activation writes the MASK into
`customers.phone_display` (E4), and the login credential can move to an unverified number (E5).

Path legend: CP = `modules/booking/src/customer-phone/`, MIG = `apps/api/db/migrations/`, POS = `apps/pos-web/src/`,
CW = `apps/customer-web/src/`.

## What the spec asks for
Two update paths (POS staff, customer app), one canonical service, no per-frontend logic. Staff may save
`pending_verification`; the app verifies first, then activates. 10-value status model, update sessions, version-guarded
swap, old number retired (`replaced`) not deleted. Duplicates classified (incl. shared family phones), never auto-merged,
manager review when needed, no cross-tenant leakage. Tenant-owned Twilio 6-digit code; old verification invalidated; manual
confirmation off by default, managers only, labelled "OTP not completed". Sync: central identity, tenant/branch records, app
profile, booking, caller-ID/AI receptionist, reminders, consent preserved; durable retry, events, notifications, audit.
Login-phone change: reauth, verify first, rotate tokens, notify the old number. Screens: tenant settings, Super Admin
"Customer Phone Verification Oversight", POS editor, app screen, customer-display verification. Rate limits per
phone/user/device/IP, idempotency, test matrix, DoD (spec lines 1708–1802).

## Status by area
| Area | Requirement | Status | Evidence |
|---|---|---|---|
| Schema | `customer_phones` status model | DONE | MIG 373:30-84; `country_code`/`risk_status` never written; existing numbers never backfilled |
| Schema | update sessions, idempotency, one-open, `customers.record_version` | PARTIAL | 373:91-156; no column links a session to its pending phone row (root of E1); `proposed_phone` stores the mask |
| Schema | `tenant_customer_phone_settings` + branch rows | PARTIAL | 373:158-185; no expiry/cooldown/max-attempts/Twilio status; `require_manager_approval`, `require_reauthentication` never read |
| Schema | update_events, sync_jobs/failures, change_approvals, security_notifications | MISSING | — |
| Schema | hash | PARTIAL | unsalted truncated sha256 (`customer-activation-core.ts:90`) |
| Services | pure rules core | DONE | CP `customer-phone-core.ts` |
| Services | canonical start/send/verify/manual-confirm/cancel | PARTIAL (activation broken) | CP `customer-phone-update.service.ts:138-526` |
| Services | staff no-SMS → `active_unverified` | DONE | 224-280 |
| Services | optimistic locking | PARTIAL | start 163; guard kysely 208-218; POS never passes `recordVersion` (`POSCustomersScreen.tsx:566-572`) |
| Services | duplicates / family phones | PARTIAL | tenant-scoped (kysely 84-104); manager-review bypass (E6); no same/different/merge choices |
| Services | Twilio routing + OTP reuse | DONE | module 51-64 → BookingVerificationService |
| Services | sync to `customers` + tenant CUSTOMER `users` | DONE | kysely 258-300 |
| Services | central identity | PARTIAL | `applyVerifiedPhone` SMS-verified only, best-effort (`customer-identity.service.ts:84-129`) |
| Services | caller-ID, AI receptionist, reminders, search index, future appointments | MISSING | — |
| Services | background sync retry | PARTIAL | CP `customer-phone-sync.scheduler.ts`; off unless `CUSTOMER_PHONE_SYNC_CRON_ENABLED`; no backoff/limit/DLQ |
| Services | expiry / stale-session job | MISSING | — |
| Services | login-credential change | PARTIAL | CP `customer-identity-phone.service.ts`: reauth, revoke sessions, old-number SMS; no proof the new number was verified (E5) |
| Services | invalidate old number's booking verification | MISSING | E7 |
| Services | events `customer.phone_*` | MISSING | only the legacy flow emits `customer.phone_verified` (`apps/api/src/customer/customer.kysely.repository.ts:560`) |
| Routes | POS `POST /pos/customers/:customerId/phone`, `/:sessionId/send|verify|cancel|manual-confirm` | DONE | CP `customer-phone.controller.ts:35-79` |
| Routes | app `POST /customer/profile/phone`, `/:sessionId/send|verify|cancel`, `/login-number` | DONE | CP `customer-phone-app.controller.ts` |
| Routes | `GET/PATCH /pos/settings/customer-phone`; `GET /super-admin/customer-phone/oversight` | DONE | CP `customer-phone-settings.controller.ts` |
| Routes | status / sync-status / retry-sync / activate / duplicate review / branch settings / Super Admin actions | MISSING | — |
| Routes | old direct-write paths closed | DONE | `customers.kysely.repository.ts:293-316`; `customer.kysely.repository.ts:144-158` (`phone_display` still editable) |
| Permissions | edit routes `pos.customers.edit` + service role matrix | DONE | — |
| Permissions | `pos.customers.phone.manual_confirm` | PARTIAL | not in the catalog; collapses to `customers.edit` (reception holds it) — only the service role check protects it |
| Permissions | settings edit | PARTIAL | needs `settings.edit`, which MANAGER lacks, though the service and nav say managers can |
| UI | POS editor | PARTIAL | POS `screens/POSCustomerPhoneEditor.tsx` only from the Customers list row; no country selector/sync status/manual-confirm/"Open Twilio Settings"; no-SMS bug (E9); profile shows legacy "✓ Verified" (`POSCustomerProfileScreen.tsx:222`) |
| UI | POS settings | PARTIAL | `POSCustomerPhoneSettingsScreen.tsx` (App.tsx:327, nav 177) — 7 toggles |
| UI | customer app | PARTIAL | CW `screens/ChangePhoneScreen.tsx` via `EditProfileScreen` 157-168,277; no reauth, no resend countdown, send failures not shown (48-52), no login-number UI |
| UI | display / kiosk / Super Admin | MISSING | oversight route unreached (`UNUSED_ROUTE_INVENTORY.md:240`) |
| Notifications | customer + tenant-admin | MISSING | `notify` passed `undefined` (module 71); `notifyOldNumber` never read |
| Notifications | login-number old-number SMS | PARTIAL | platform Twilio env or a silent in-memory mock (module 34-40) |
| Sync | reminders use the new number | MISSING | reminders read `a.customer_phone` (`reminders.kysely.repository.ts:54`) |
| Security | E.164, tenant-scoped, OTP expiry/attempts/cooldown, no stored OTP, session+phone binding | DONE | update.service 326,364 |
| Security | per-user/device/IP limits; idempotency replay; reauth for app contact change | MISSING / PARTIAL | repeated key → raw 500; clients send no key |
| Tests | core, service (mocked store), no-sms, bypass, http, settings, identity-phone, store pgtest; tenant isolation | PARTIAL | `tenant-isolation.pgtest.vitest.spec.ts:218-252` |
| Tests | DB-backed start→verify→activate; controllers; scheduler; oversight; booking/caller-ID/reminder wiring; concurrency; frontend; load | MISSING | — |

## Duplicates
1. Legacy `/customer/verify/phone/request|confirm` (`customer.service.ts:87-105`) on `customer_phone_verifications` + platform
   Twilio; codes go to the customer-editable `phone_display`; stamps `customers.phone_verified_at`; CW `EditProfileScreen.tsx:64-94`
   still calls it → three sources of "verified" (`customer_phones.status`, `phone_verified_at`, `booking_verified_phones`).
2. Three phone normalizers (activation-core E.164, identity-core `normalizePhoneE164`, AI receptionist 10-digit
   `voice-caller-verify-core.ts:16`).
3. Two central identities written by different paths (`global_customers`, `customer_identities`).
4. Settings query/defaults duplicated (kysely 25-60 vs settings.service 25, settings.kysely 12-31).

## Bugs
- **E1 (critical) — verified activation always fails.** `newPhoneId: (s as any).newPhoneId ?? ''` (update.service 409) but
  `session()` never returns it (kysely 140-160) → `id <> ''` invalid uuid → `.catch(() => false)` → false 409 VERSION_CONFLICT;
  session stuck at `phone_verified`. Same for manual confirm. Tests miss it (pgtest passes the id; service tests mock the store).
- **E2 (high) — one stuck session blocks the customer forever.** `completed_at` set only for 3 terminal states (kysely 167);
  no expiry job; `createSession` does not handle the unique conflict (126-138) → next start 500. CW "Change number" never cancels.
- **E3 (high) — all phone-module audits dropped.** `audit.record({...})` one object; `AuditService.record(ctx, input)` builds
  the row from `input` (undefined) → throws, swallowed; `audit as any` (module 71,98,109) hides it.
- **E4 (high) — activation writes the mask into `customers.phone_display`** (kysely 211) → POS list shows it
  (`customers.kysely.repository.ts:77`); AI receptionist `verifyCaller` matches on it (`voice-manage.service.ts:52-54`);
  identity reconciliation reads it (`customer-identity.repository.ts:114-123`).
- **E5 (high, security) — login phone can move to an unverified number:** `changeLoginPhone` accepts any valid E.164 after
  the password check; `not_verified` never thrown (the test at `customer-identity-phone.vitest.spec.ts:149-157` checks only a malformed number).
- **E6** receptionist bypasses manager review (core 265 vs 275); no manager resolve route (update.service 190-197).
- **E7** old number stays verified (`booking_verified_phones` never revoked; guard hard-codes `phoneChanged:false`
  (`booking-verification-guard.ts:94`); `phone_verified_at` never cleared).
- **E8** reminders go to the replaced number. **E9** POS editor false error in no-SMS mode (`send('')` → `/phone//send`).
- **E10** branch overrides unreachable (middleware strips `branchId`, `tenant-context.middleware.ts:116-117`).
- **E11** canceled pending rows cause false duplicates (`matchesByHash` includes pending, kysely 89).
- **E12** `branchId ?? ''` into `booking_verification_sessions.branch_id` UUID NOT NULL (update.service 331,369) after the SMS was sent.
- **E13** oversight numbers wrong (`duplicateConflicts` always 0; no-SMS counted as manual; enabled-tenants ignores defaults).
- **E14** unverified number becomes the account-claim key in no-SMS mode (`customer-activation.repository.ts:58,126`).
- **E15** no ownership check: neither controller checks the session belongs to the resolved/path customer.

## Build order
1. E1 (`new_phone_id` on sessions, persisted in `start()`, returned by `session()`; DB-backed start→verify→activate test).
2. E3 audit adapter. 3. E4 + E7 (no mask in `phone_display`; derive/clear `phone_verified_at`).
4. Session lifecycle (E2, E11): expiry/cleanup job, already-open handling, idempotent replay, retire canceled pending rows.
5. E5 login-number proof (completed session for this customer+number; UI; tenant Twilio; no prod mock).
6. Old-number invalidation (revoke `booking_verified_phones`, real `phoneChanged`, future appointments, caller-ID status-aware).
7. Policy enforcement (manager bypass, resolve route, manager-approval + reauth settings, branch settings route).
8. Events, realtime, notifications. 9. Status/sync/retry routes; scheduler on with backoff/limit/DLQ.
10. Remaining UI (Super Admin page + actions, POS profile integration, country selector, display/kiosk screen).
11. Merge the legacy verify flow. 12. Missing tests (API, e2e, frontend, load).
