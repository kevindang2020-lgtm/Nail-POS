# SECURITY_ATTACK_SURFACE.md — every way in (mandate §3)

**Generated** by `node apps/api/scripts/attack-surface.mjs` from the OpenAPI route manifest (which `check:openapi` keeps
equal to the code) — do not edit by hand; `--check` fails CI when this file drifts. Full per-route table:
[attack-surface-routes.csv](attack-surface-routes.csv) (4032 rows: method, path, file:line, realm, auth, permission,
step-up, idempotency, guards, class, body limit, rate limit). Hosting is Railway (no AWS): there is no cloud WAF, IMDS or IAM layer.

## 1. Counts

| | routes |
|---|---|
| all HTTP routes | 4032 |
| realm `customer` | 165 |
| realm `shared` | 285 |
| realm `staff` | 2387 |
| realm `super_admin` | 1195 |
| public (no session; each one reviewed by `check:public`) | 126 |
| integration key / OAuth (`auth=api_key`) | 13 |
| with `@RequireStepUp` (fresh password + code) | 193 |
| with an idempotency contract | 59 |
| webhooks | 9 |
| multipart uploads | 9 |
| server-sent event streams | 13 |
| service / scheduler endpoints (`/internal`, `/jobs`) | 15 |

## 2. Layers every request passes (in order)

1. **Edge** — Railway's proxy (TLS). *No WAF / bot / DDoS layer exists yet: REQUIRES KEVIN (Cloudflare or equivalent in front of api / admin / app hosts).*
2. **Express** (apps/api/src/main.ts) — exact trust-proxy hop count; security headers (CSP `default-src 'none'`, HSTS, nosniff, frame-ancestors none, no-store on authenticated); CORS: credentialed app origins only, marketing site non-credentialed (`common/allowed-origins.ts`); CSRF origin check on every cookie-authenticated unsafe method (`csrfVerdict`, CSRF_REJECTED); body parsers per request (`common/request-body-limits.ts`: 256 KB anonymous, 25 MB credentialed, form bodies only on provider callback paths); platform lockdown + maintenance break-glass.
3. **TenantContextMiddleware** — deny by default: every route except the reviewed public list needs a signed, unrevoked session (session row re-read, fail CLOSED on platform and money routes), authorization version re-derived per request, tenant / branch from the session only (client tenantId / branchId stripped).
4. **Global guards** — RealmGuard (customer ≠ staff ≠ platform), RolePermissionGuard (default-deny), PlatformDomainGuard (every /super-admin route keyed), StepUpGuard (critical actions — gate `check:critical-step-up`), SuspendedAccessGuard, MfaEnrollmentGuard, TenantRateLimitGuard.
5. **ValidatedBody** schemas (unknown fields stripped, prototype keys refused) — `check:validated-bodies`.
6. **Domain services** — `scoped()` tenant + branch predicates, lifecycle state machines, idempotency keys, unknown payment ≠ declined.
7. **PostgreSQL** — tenant_id on every tenant table, same-tenant triggers, optional RLS (`DB_TENANT_RLS`), least-privilege roles (`db-provision-roles.mjs`; boot posture check warns on a superuser / BYPASSRLS login).

## 3. Public routes (no session)

| method | path | handler | class | rate limit |
|---|---|---|---|---|
| GET | `/.well-known/apple-app-site-association` | apps/api/src/mobile-links/mobile-links.controller.ts:20 | public | static / cacheable content — not rate limited by design (edge WAF REQUIRES KEVIN) |
| GET | `/.well-known/assetlinks.json` | apps/api/src/mobile-links/mobile-links.controller.ts:28 | public | static / cacheable content — not rate limited by design (edge WAF REQUIRES KEVIN) |
| POST | `/api/ai-booking/v1/public/appointments` | apps/api/src/ai-booking/ai-booking-public.controller.ts:77 | public | AnonRateLimit 20 / 15 min per IP + AnonRateLimit 300 / 5 min per IP (bucket ai-booking-public) [class] |
| POST | `/api/ai-booking/v1/public/availability/search` | apps/api/src/ai-booking/ai-booking-public.controller.ts:69 | public | AnonRateLimit 60 / 1 min per IP + AnonRateLimit 300 / 5 min per IP (bucket ai-booking-public) [class] |
| POST | `/api/ai-booking/v1/public/services` | apps/api/src/ai-booking/ai-booking-public.controller.ts:59 | public | AnonRateLimit 300 / 5 min per IP (bucket ai-booking-public) [class] |
| GET | `/api/ai-booking/v1/public/verification/captcha` | apps/api/src/ai-booking/ai-booking-public.controller.ts:108 | public | AnonRateLimit 300 / 5 min per IP (bucket ai-booking-public) [class] |
| POST | `/api/ai-booking/v1/public/verification/check` | apps/api/src/ai-booking/ai-booking-public.controller.ts:127 | public | AnonRateLimit 30 / 15 min per IP + AnonRateLimit 300 / 5 min per IP (bucket ai-booking-public) [class] |
| POST | `/api/ai-booking/v1/public/verification/send` | apps/api/src/ai-booking/ai-booking-public.controller.ts:111 | public | AnonRateLimit 10 / 15 min per IP + AnonRateLimit 300 / 5 min per IP (bucket ai-booking-public) [class] |
| POST | `/api/ai-receptionist/v1/verification/dtmf` | modules/ai/src/voice-booking/ai-receptionist-verification.controller.ts:107 | public | VoiceKeyRateLimitGuard 120 / min per key (RATE_LIMIT_STORE=redis) |
| GET | `/api/ai-receptionist/v1/verification/twiml` | modules/ai/src/voice-booking/ai-receptionist-verification.controller.ts:90 | public | VoiceKeyRateLimitGuard 120 / min per key (RATE_LIMIT_STORE=redis) |
| GET | `/app-config` | apps/api/src/mobile-config/app-config.controller.ts:25 | public | per-IP + per-instance WindowLimiter (app-config.controller.ts) |
| GET | `/app-links/{path}` | ? | public | static / cacheable content — not rate limited by design (edge WAF REQUIRES KEVIN) |
| POST | `/auth/biometric/login` | modules/identity/src/auth/biometric.controller.ts:68 | public | AnonRateLimit 120 / 5 min per IP (bucket auth-biometric-login) |
| GET | `/auth/biometric/status` | modules/identity/src/auth/biometric.controller.ts:52 | public | AnonRateLimit 300 / 5 min per IP |
| POST | `/auth/change-temporary-password` | modules/identity/src/auth/system-reset.controller.ts:84 | public | Postgres attempt budget: 5 failures / 15 min per account (auth-attempt-budget.ts) |
| POST | `/auth/login` | modules/identity/src/auth/auth.controller.ts:91 | public | login throttle 5 / 15 min per (portal, salon, identifier, IP) + credential-stuffing detector (LOGIN_THROTTLE_STORE) |
| POST | `/auth/logout` | modules/identity/src/auth/auth.controller.ts:317 | public | AnonRateLimit 600 / 5 min per IP (bucket auth-logout) |
| POST | `/auth/password-reset/complete` | modules/identity/src/auth/password-reset.controller.ts:26 | public | reset counts in Postgres per identifier + IP |
| POST | `/auth/password-reset/request` | modules/identity/src/auth/password-reset.controller.ts:16 | public | reset counts in Postgres per identifier + IP |
| POST | `/auth/password-reset/temp-login` | modules/identity/src/auth/password-reset.controller.ts:21 | public | reset counts in Postgres per identifier + IP |
| POST | `/auth/refresh` | modules/identity/src/auth/auth.controller.ts:214 | public | AnonRateLimit 600 / 5 min per IP (bucket auth-refresh) |
| POST | `/auth/super-admin/forgot-password` | modules/identity/src/auth/system-reset.controller.ts:24 | public | reset counts in Postgres per identifier + IP |
| POST | `/auth/temp-password-login` | modules/identity/src/auth/system-reset.controller.ts:59 | public | Postgres attempt budget: 5 failures / 15 min per account (auth-attempt-budget.ts) |
| POST | `/auth/webauthn/authenticate/begin` | modules/identity/src/auth/webauthn.controller.ts:108 | public | AnonRateLimit 120 / 5 min per IP (bucket auth-webauthn-authenticate) |
| POST | `/auth/webauthn/authenticate/finish` | modules/identity/src/auth/webauthn.controller.ts:114 | public | AnonRateLimit 120 / 5 min per IP (bucket auth-webauthn-authenticate) |
| GET | `/auth/webauthn/status` | modules/identity/src/auth/webauthn.controller.ts:86 | public | AnonRateLimit 300 / 5 min per IP |
| POST | `/client-telemetry/errors` | apps/api/src/observability/client-errors.controller.ts:91 | public | per-IP + per-instance WindowLimiter; always 204 (client-errors / client-events controllers) |
| POST | `/client-telemetry/events` | apps/api/src/observability/client-events.controller.ts:35 | public | per-IP + per-instance WindowLimiter; always 204 (client-errors / client-events controllers) |
| GET | `/customer-display/checkout/{sessionId}` | apps/api/src/customer-display/customer-display.controller.ts:72 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/checkout/{sessionId}/method` | apps/api/src/customer-display/customer-display.controller.ts:82 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/checkout/{sessionId}/pay` | apps/api/src/customer-display/customer-display.controller.ts:87 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/checkout/{sessionId}/rating` | apps/api/src/customer-display/customer-display.controller.ts:92 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/checkout/{sessionId}/receipt` | apps/api/src/customer-display/customer-display.controller.ts:98 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| GET | `/customer-display/checkout/{sessionId}/stream` | apps/api/src/customer-display/customer-display.controller.ts:103 | stream | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/checkout/{sessionId}/tip` | apps/api/src/customer-display/customer-display.controller.ts:77 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| GET | `/customer-display/device/ads` | apps/api/src/customer-display/customer-display.controller.ts:186 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/device/ads/displays` | apps/api/src/customer-display/customer-display.controller.ts:192 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/device/check-in/session` | apps/api/src/customer-display/customer-display.controller.ts:165 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| GET | `/customer-display/device/current` | apps/api/src/customer-display/customer-display.controller.ts:118 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/device/heartbeat` | apps/api/src/customer-display/customer-display.controller.ts:157 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/device/method` | apps/api/src/customer-display/customer-display.controller.ts:128 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/device/pay` | apps/api/src/customer-display/customer-display.controller.ts:133 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/device/phone-code` | apps/api/src/customer-display/customer-display.controller.ts:150 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/device/rating` | apps/api/src/customer-display/customer-display.controller.ts:138 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/device/receipt` | apps/api/src/customer-display/customer-display.controller.ts:144 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/device/release` | apps/api/src/customer-display/customer-display.controller.ts:180 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| GET | `/customer-display/device/stream` | apps/api/src/customer-display/customer-display.controller.ts:197 | stream | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/device/tip` | apps/api/src/customer-display/customer-display.controller.ts:123 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/pairing` | apps/api/src/customer-display/customer-display.controller.ts:58 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer-display/pairing/{pairingId}/poll` | apps/api/src/customer-display/customer-display.controller.ts:66 | public | AnonRateLimit 1200 / 5 min per IP (bucket customer-display) [class] |
| POST | `/customer/auth/activation/request-code` | modules/booking/src/customer-activation/customer-activation.controller.ts:41 | public | OTP source throttle + resend cooldown (customer-activation.service.ts) |
| POST | `/customer/auth/activation/resend-code` | modules/booking/src/customer-activation/customer-activation.controller.ts:47 | public | OTP source throttle + resend cooldown (customer-activation.service.ts) |
| POST | `/customer/auth/activation/select-salon` | modules/booking/src/customer-activation/customer-activation.controller.ts:60 | public | OTP source throttle + resend cooldown (customer-activation.service.ts) |
| POST | `/customer/auth/activation/verify-code` | modules/booking/src/customer-activation/customer-activation.controller.ts:53 | public | OTP source throttle + resend cooldown (customer-activation.service.ts) |
| POST | `/customer/auth/register` | modules/identity/src/customer-registration/customer-registration.controller.ts:14 | public | AnonRateLimit 20 / 1 h per IP |
| GET | `/customer/deals/nearby` | modules/deals/src/deals/deals.customer.controller.ts:46 | public | AnonRateLimit 60 / 1 min per IP (bucket customer-deals-guest) |
| GET | `/customer/deals/public/{id}` | modules/deals/src/deals/deals.customer.controller.ts:57 | public | AnonRateLimit 60 / 1 min per IP (bucket customer-deals-guest) |
| POST | `/customer/deals/public/{id}/estimate` | modules/deals/src/deals/deals.customer.controller.ts:64 | public | AnonRateLimit 60 / 1 min per IP (bucket customer-deals-guest) |
| GET | `/customer/salons/{salonId}` | modules/customers/src/customer-salons/customer-salons.controller.ts:47 | public | AnonRateLimit 30 / 1 min per IP (bucket customer-salons) |
| GET | `/customer/salons/{salonId}/services` | modules/customers/src/customer-salons/customer-salons.controller.ts:54 | public | AnonRateLimit 30 / 1 min per IP (bucket customer-salons) |
| GET | `/customer/salons/{salonId}/services/{serviceId}/technicians` | modules/workforce/src/tech-profile/customer-tech.controller.ts:75 | public | AnonRateLimit 30 / 1 min per IP (bucket customer-techs) |
| GET | `/customer/salons/{salonId}/technicians` | modules/workforce/src/tech-profile/customer-tech.controller.ts:68 | public | AnonRateLimit 30 / 1 min per IP (bucket customer-techs) |
| GET | `/customer/salons/nearby` | modules/customers/src/customer-salons/customer-salons.controller.ts:32 | public | AnonRateLimit 30 / 1 min per IP (bucket customer-salons) |
| GET | `/customer/techs/{publicSlug}` | modules/workforce/src/tech-profile/customer-tech.controller.ts:61 | public | AnonRateLimit 30 / 1 min per IP (bucket customer-techs) |
| GET | `/customer/techs/nearby` | modules/workforce/src/tech-profile/customer-tech.controller.ts:50 | public | AnonRateLimit 30 / 1 min per IP (bucket customer-techs) |
| GET | `/go-check-in/{slug}/config` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:32 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| POST | `/go-check-in/{slug}/start-session` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:33 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| POST | `/go-check-in/session/{sessionId}/accept-alternate` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:51 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| POST | `/go-check-in/session/{sessionId}/check-in-appointment` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:44 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| GET | `/go-check-in/session/{sessionId}/check-in-status` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:55 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| POST | `/go-check-in/session/{sessionId}/check-in-walk-in` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:52 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| POST | `/go-check-in/session/{sessionId}/complete` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:57 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| POST | `/go-check-in/session/{sessionId}/confirm-customer` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:39 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| POST | `/go-check-in/session/{sessionId}/create-customer` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:40 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| POST | `/go-check-in/session/{sessionId}/heartbeat` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:35 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| POST | `/go-check-in/session/{sessionId}/lookup-phone` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:38 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| GET | `/go-check-in/session/{sessionId}/place-in-line` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:56 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| GET | `/go-check-in/session/{sessionId}/services` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:47 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| POST | `/go-check-in/session/{sessionId}/technician/clock-in` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:61 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| POST | `/go-check-in/session/{sessionId}/technician/clock-out` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:62 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| POST | `/go-check-in/session/{sessionId}/technician/identify` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:60 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| GET | `/go-check-in/session/{sessionId}/technicians` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:49 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| GET | `/go-check-in/session/{sessionId}/today-appointments` | modules/queue/src/go-check-in/go-check-in.public.controller.ts:43 | public | kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min |
| GET | `/health` | apps/api/src/health/health.controller.ts:35 | public | probe / metrics token — not rate limited by design (edge WAF REQUIRES KEVIN) |
| GET | `/health/live` | apps/api/src/health/health.controller.ts:42 | public | probe / metrics token — not rate limited by design (edge WAF REQUIRES KEVIN) |
| GET | `/health/ready` | apps/api/src/health/health.controller.ts:46 | public | probe / metrics token — not rate limited by design (edge WAF REQUIRES KEVIN) |
| POST | `/integrations/inbound/{connectionId}` | modules/super-admin/src/super-admin-integrations/integration-webhook.controller.ts:29 | public | provider-signed; no rate limit (signature first, before any work) |
| POST | `/internal/ai-billing/cardpointe` | modules/ai/src/ai/ai-subscription-billing.service.ts:114 | service | service secret (no anonymous access); not rate limited |
| POST | `/internal/ai-billing/event` | modules/ai/src/ai/ai-subscription-billing.service.ts:85 | service | service secret (no anonymous access); not rate limited |
| POST | `/internal/ai-billing/sweep-trials` | modules/ai/src/ai/ai-subscription-billing.service.ts:106 | service | service secret (no anonymous access); not rate limited |
| POST | `/internal/ai-billing/webhook` | modules/ai/src/ai/ai-subscription-billing.service.ts:42 | webhook | service secret (no anonymous access); not rate limited |
| POST | `/internal/backups/recovery-points` | apps/api/src/backup-center/backup-center.controller.ts:74 | service | service secret (no anonymous access); not rate limited |
| POST | `/internal/backups/recovery-points/{id}/verification` | apps/api/src/backup-center/backup-center.controller.ts:76 | service | service secret (no anonymous access); not rate limited |
| POST | `/internal/backups/report` | apps/api/src/observability/backup-reports.ts:109 | service | service secret (no anonymous access); not rate limited |
| POST | `/internal/hardware-payment/run-monthly` | modules/payments/src/hardware-payment/hardware-payment.cron.controller.ts:24 | service | service secret (no anonymous access); not rate limited |
| POST | `/internal/membership-billing/apply` | modules/memberships/src/membership-billing.controller.ts:47 | service | service secret (no anonymous access); not rate limited |
| POST | `/internal/membership-billing/cardpointe` | modules/memberships/src/membership-billing.controller.ts:40 | service | service secret (no anonymous access); not rate limited |
| POST | `/internal/membership-billing/proration-preview` | modules/memberships/src/membership-billing.controller.ts:54 | service | service secret (no anonymous access); not rate limited |
| POST | `/internal/membership-billing/run-reminders` | modules/memberships/src/membership-billing.controller.ts:34 | service | service secret (no anonymous access); not rate limited |
| POST | `/internal/membership-billing/run-renewals` | modules/memberships/src/membership-billing.controller.ts:28 | service | service secret (no anonymous access); not rate limited |
| POST | `/internal/scheduled-reports/run-due` | modules/super-admin/src/super-admin-platform/scheduled-reports.cron.controller.ts:20 | service | service secret (no anonymous access); not rate limited |
| POST | `/internal/tenant-warnings/dispatch` | modules/super-admin/src/super-admin-tenant-warnings/tenant-warning-dispatch.cron.controller.ts:20 | service | service secret (no anonymous access); not rate limited |
| POST | `/jobs/appointment-reminders` | modules/communications/src/reminders/reminders.controller.ts:22 | service | service secret (no anonymous access); not rate limited |
| GET | `/media/{path}` | ? | public | static / cacheable content — not rate limited by design (edge WAF REQUIRES KEVIN) |
| GET | `/metrics` | apps/api/src/health/metrics.controller.ts:31 | public | probe / metrics token — not rate limited by design (edge WAF REQUIRES KEVIN) |
| POST | `/oauth/revoke` | apps/api/src/oauth/oauth.controller.ts:45 | public | AnonRateLimit 60 / 1 min per IP |
| POST | `/oauth/token` | apps/api/src/oauth/oauth.controller.ts:38 | public | AnonRateLimit 60 / 1 min per IP |
| GET | `/platform/branding` | modules/tenants/src/branding/branding.controller.ts:22 | public | AnonRateLimit 600 / 5 min per IP |
| GET | `/public/alert-ack` | apps/api/src/observability/oncall.ts:195 | public | AnonRateLimit 30 / 15 min per IP [class] |
| POST | `/public/alert-ack` | apps/api/src/observability/oncall.ts:150 | public | AnonRateLimit 30 / 15 min per IP [class] |
| GET | `/public/email/unsubscribe` | modules/communications/src/email/email-public.controller.ts:40 | public | AnonRateLimit 60 / 15 min per IP (bucket email-unsubscribe) |
| POST | `/public/email/unsubscribe` | modules/communications/src/email/email-public.controller.ts:51 | public | AnonRateLimit 60 / 15 min per IP (bucket email-unsubscribe) |
| POST | `/public/mfa-recovery/confirm` | modules/identity/src/auth/mfa-recovery.controller.ts:54 | public | 5 failures burn the recovery token |
| POST | `/public/mfa-recovery/start` | modules/identity/src/auth/mfa-recovery.controller.ts:39 | public | 5 failures burn the recovery token |
| POST | `/public/security/approve-device` | modules/identity/src/auth/platform-device-approval.controller.ts:25 | public | AnonRateLimit 20 / 15 min per IP (bucket platform-device-approve) |
| POST | `/public/security/not-me` | modules/identity/src/auth/security-not-me.controller.ts:15 | public | AnonRateLimit 20 / 15 min per IP |
| POST | `/public/website/applications` | modules/super-admin/src/super-admin-platform/public-website.controller.ts:21 | public | 5 / min per IP, 10-minute lock |
| POST | `/public/website/invitations/accept` | modules/super-admin/src/super-admin-platform/public-website.controller.ts:23 | public | 5 / min per IP, 10-minute lock |
| POST | `/public/website/leads` | modules/super-admin/src/super-admin-platform/public-website.controller.ts:20 | public | 5 / min per IP, 10-minute lock |
| POST | `/webhooks/bank/{token}` | modules/payments/src/deposit-reconciliation/deposit-reconciliation.webhook.controller.ts:17 | webhook | provider-signed; no rate limit (signature first, before any work) |
| POST | `/webhooks/email/sendgrid` | modules/communications/src/email/email-public.controller.ts:26 | webhook | provider-signed; no rate limit (signature first, before any work) |
| POST | `/webhooks/payments/{processor}` | modules/payments/src/payments/payment-webhook.controller.ts:18 | webhook | provider-signed; no rate limit (signature first, before any work) |
| POST | `/webhooks/twilio/booking-verification/status` | modules/booking/src/customer-booking/booking-verification-webhook.controller.ts:62 | webhook | provider-signed; no rate limit (signature first, before any work) |
| POST | `/webhooks/twilio/sms/inbound` | modules/communications/src/messaging-inbound/twilio-inbound.controller.ts:22 | webhook | provider-signed; no rate limit (signature first, before any work) |
| POST | `/webhooks/twilio/sms/status` | modules/communications/src/messaging-inbound/twilio-inbound.controller.ts:39 | webhook | provider-signed; no rate limit (signature first, before any work) |
| POST | `/webhooks/voice/retell` | modules/ai/src/voice-booking/ai-calls-public.controller.ts:21 | webhook | provider-signed; no rate limit (signature first, before any work) |

## 4. Webhooks (authenticity before any effect)

| method | path | handler | auth |
|---|---|---|---|
| POST | `/internal/ai-billing/webhook` | modules/ai/src/ai/ai-subscription-billing.service.ts:42 | public |
| POST | `/voice-transcription/webhook` | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts:170 | api_key |
| POST | `/webhooks/bank/{token}` | modules/payments/src/deposit-reconciliation/deposit-reconciliation.webhook.controller.ts:17 | public |
| POST | `/webhooks/email/sendgrid` | modules/communications/src/email/email-public.controller.ts:26 | public |
| POST | `/webhooks/payments/{processor}` | modules/payments/src/payments/payment-webhook.controller.ts:18 | public |
| POST | `/webhooks/twilio/booking-verification/status` | modules/booking/src/customer-booking/booking-verification-webhook.controller.ts:62 | public |
| POST | `/webhooks/twilio/sms/inbound` | modules/communications/src/messaging-inbound/twilio-inbound.controller.ts:22 | public |
| POST | `/webhooks/twilio/sms/status` | modules/communications/src/messaging-inbound/twilio-inbound.controller.ts:39 | public |
| POST | `/webhooks/voice/retell` | modules/ai/src/voice-booking/ai-calls-public.controller.ts:21 | public |

Authenticity: payment webhooks — per-tenant HMAC over the raw body, timing-safe, processor bound to the merchant's configured processor, event claim before effects (E7); bank deposits — path token + timestamped signature; Twilio — tenant resolved from the To number / message first, then THAT tenant's token (E2); integrations — signature + replay window.

## 5. Uploads

| method | path | handler | permission |
|---|---|---|---|
| POST | `/auth/avatar` | modules/workforce/src/tech-profile/staff-avatar.controller.ts:23 |  |
| POST | `/customer/nail-showcase/posts/{postId}/photos` | modules/workforce/src/nail-showcase/nail-showcase.controller.ts:85 |  |
| POST | `/customer/profile/avatar` | apps/api/src/customer/customer.controller.ts:118 |  |
| POST | `/customer/social/me/avatar` | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts:64 |  |
| POST | `/owner/profile/avatar` | modules/analytics/src/owner/owner.controller.ts:253 | owner.dashboard.view |
| POST | `/tech/profile/avatar` | modules/workforce/src/tech-profile/tech-profile.controller.ts:62 | tech.profile.edit |
| POST | `/tech/profile/cover` | modules/workforce/src/tech-profile/tech-profile.controller.ts:68 | tech.profile.edit |
| POST | `/tech/profile/photos` | modules/workforce/src/tech-profile/tech-profile.controller.ts:77 | tech.profile.edit |
| POST | `/tech/skills/upload-document` | modules/queue/src/tech/tech.controller.ts:119 | tech.profile.edit |

All uploads go through `packages/media/src/upload-policy.ts` (size, magic bytes, extension + MIME family, pixel cap, metadata strip, random server key, quota). Malware scan: ClamAV when `CLAMAV_HOST` is set; in production a non-image document that could not be scanned is refused (`SCAN_UNAVAILABLE`) unless `UNSCANNED_DOCUMENTS=allow`. Base64-in-JSON uploads ride the credentialed 25 MB JSON limit.

## 6. Streams (SSE)

| path | handler | realm | auth |
|---|---|---|---|
| `/customer-display/checkout/{sessionId}/stream` | apps/api/src/customer-display/customer-display.controller.ts:103 | shared | public |
| `/customer-display/device/stream` | apps/api/src/customer-display/customer-display.controller.ts:197 | shared | public |
| `/customer/stream` | apps/api/src/domain-streams/customer-realtime.controller.ts:20 | customer | session |
| `/owner/stream` | apps/api/src/domain-streams/owner-realtime.controller.ts:22 | staff | session |
| `/pos/ai/front-desk/events` | modules/ai/src/voice-booking/front-desk-center.controller.ts:118 | staff | session |
| `/pos/audit/events` | modules/audit/src/audit.controller.ts:28 | staff | session |
| `/pos/campaign-center/campaigns/{id}/events` | modules/communications/src/campaigns/campaign-center.controller.ts:74 | staff | session |
| `/pos/customer-timeline/customers/{id}/events` | modules/customers/src/customer-timeline/customer-timeline-center.controller.ts:59 | staff | session |
| `/realtime/stream` | apps/api/src/realtime/realtime.controller.ts:39 | shared | session |
| `/super-admin/hardware-packages/events` | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts:34 | super_admin | session |
| `/super-admin/integrations/webhooks/events` | modules/super-admin/src/super-admin-integrations/super-admin-integrations.controller.ts:34 | super_admin | session |
| `/super-admin/stream` | apps/api/src/super-admin-system-status/super-admin-realtime.controller.ts:18 | super_admin | session |
| `/tech/stream` | apps/api/src/domain-streams/tech-realtime.controller.ts:18 | staff | session |

Rooms are derived from the session server-side; revocation and authorization changes are re-checked every 15 s and end the stream; display / device streams re-check their token every 15 s (C11).

## 7. Service and scheduler endpoints

| method | path | handler | auth |
|---|---|---|---|
| POST | `/internal/ai-billing/cardpointe` | modules/ai/src/ai/ai-subscription-billing.service.ts:114 | public |
| POST | `/internal/ai-billing/event` | modules/ai/src/ai/ai-subscription-billing.service.ts:85 | public |
| POST | `/internal/ai-billing/sweep-trials` | modules/ai/src/ai/ai-subscription-billing.service.ts:106 | public |
| POST | `/internal/backups/recovery-points` | apps/api/src/backup-center/backup-center.controller.ts:74 | public |
| POST | `/internal/backups/recovery-points/{id}/verification` | apps/api/src/backup-center/backup-center.controller.ts:76 | public |
| POST | `/internal/backups/report` | apps/api/src/observability/backup-reports.ts:109 | public |
| POST | `/internal/hardware-payment/run-monthly` | modules/payments/src/hardware-payment/hardware-payment.cron.controller.ts:24 | public |
| POST | `/internal/membership-billing/apply` | modules/memberships/src/membership-billing.controller.ts:47 | public |
| POST | `/internal/membership-billing/cardpointe` | modules/memberships/src/membership-billing.controller.ts:40 | public |
| POST | `/internal/membership-billing/proration-preview` | modules/memberships/src/membership-billing.controller.ts:54 | public |
| POST | `/internal/membership-billing/run-reminders` | modules/memberships/src/membership-billing.controller.ts:34 | public |
| POST | `/internal/membership-billing/run-renewals` | modules/memberships/src/membership-billing.controller.ts:28 | public |
| POST | `/internal/scheduled-reports/run-due` | modules/super-admin/src/super-admin-platform/scheduled-reports.cron.controller.ts:20 | public |
| POST | `/internal/tenant-warnings/dispatch` | modules/super-admin/src/super-admin-tenant-warnings/tenant-warning-dispatch.cron.controller.ts:20 | public |
| POST | `/jobs/appointment-reminders` | modules/communications/src/reminders/reminders.controller.ts:22 | public |

Service callers present a short-lived scoped service token (`SERVICE_TOKEN_SECRET`, timing-safe, fails closed). Durable jobs run in the worker (apps/api/src/worker.ts) — 5 job files under apps/api/src/jobs; tenant comes from job metadata, never from a request.

## 8. Critical actions protected by step-up

| method | path | realm |
|---|---|---|
| POST | `/auth/admin/reset-user-password` | shared |
| POST | `/auth/devices/{id}/approve-platform` | shared |
| POST | `/mobile-checkout/devices/{deviceId}/approve` | shared |
| POST | `/mobile-checkout/devices/{deviceId}/branches` | shared |
| POST | `/mobile-checkout/devices/{deviceId}/compromised` | shared |
| POST | `/mobile-checkout/devices/{deviceId}/disable` | shared |
| POST | `/mobile-checkout/devices/{deviceId}/reassign` | shared |
| POST | `/mobile-checkout/devices/{deviceId}/rename` | shared |
| POST | `/mobile-checkout/devices/{deviceId}/revoke` | shared |
| POST | `/mobile-checkout/devices/pairings` | shared |
| POST | `/mobile-checkout/payments/{paymentId}/refund` | shared |
| POST | `/mobile-checkout/payments/{paymentId}/void` | shared |
| POST | `/mobile-checkout/tickets/{ticketId}/refund` | shared |
| POST | `/pos/access/invitations` | staff |
| PUT | `/pos/access/members/{userId}/branches` | staff |
| POST | `/pos/access/members/{userId}/end-employment` | staff |
| POST | `/pos/access/members/{userId}/overrides` | staff |
| PUT | `/pos/access/members/{userId}/role` | staff |
| POST | `/pos/access/overrides/{id}/revoke` | staff |
| POST | `/pos/access/ownership/transfer` | staff |
| POST | `/pos/api-keys` | staff |
| POST | `/pos/api-keys/{id}/rotate` | staff |
| PUT | `/pos/approvals/policies` | staff |
| POST | `/pos/checkout/gift-cards/{cardId}/adjust` | staff |
| POST | `/pos/checkout/gift-cards/{cardId}/void-card` | staff |
| POST | `/pos/checkout/payments/{paymentId}/refund` | staff |
| POST | `/pos/checkout/payments/{paymentId}/void` | staff |
| POST | `/pos/checkout/tickets/{ticketId}/refund` | staff |
| POST | `/pos/checkout/tickets/{ticketId}/refunds/{refundId}/settle` | staff |
| POST | `/pos/deposit-reconciliation/workspace/bank-accounts` | staff |
| POST | `/pos/deposit-reconciliation/workspace/bank-accounts/{bankAccountId}` | staff |
| POST | `/pos/loyalty/network/earning/activate` | staff |
| POST | `/pos/loyalty/network/purchases` | staff |
| POST | `/pos/payroll/adjustments/{adjId}/decide` | staff |
| POST | `/pos/payroll/pay-plans` | staff |
| POST | `/pos/payroll/pay-plans/{planId}/archive` | staff |
| POST | `/pos/payroll/paychecks/payouts/{payoutId}/cash/acknowledge-dual` | staff |
| POST | `/pos/payroll/paychecks/payouts/{payoutId}/cash/prepare` | staff |
| POST | `/pos/payroll/paychecks/payouts/{payoutId}/cash/resolve` | staff |
| POST | `/pos/payroll/paychecks/payouts/{payoutId}/check/deliver` | staff |
| POST | `/pos/payroll/paychecks/payouts/{payoutId}/check/issue` | staff |
| POST | `/pos/payroll/paychecks/payouts/{payoutId}/check/void` | staff |
| POST | `/pos/payroll/paychecks/periods/{id}/approve` | staff |
| POST | `/pos/payroll/paychecks/periods/{id}/cancel` | staff |
| POST | `/pos/payroll/paychecks/schedule` | staff |
| POST | `/pos/payroll/paychecks/statements/{statementId}/approve` | staff |
| POST | `/pos/payroll/paychecks/statements/{statementId}/payouts` | staff |
| POST | `/pos/payroll/payouts/{payoutId}/status` | staff |
| POST | `/pos/payroll/periods/{id}/finalize` | staff |
| POST | `/pos/payroll/periods/{id}/pay` | staff |
| POST | `/pos/payroll/periods/{id}/payouts` | staff |
| POST | `/pos/payroll/periods/{id}/reopen` | staff |
| POST | `/pos/security/access-reviews/{id}/decisions` | staff |
| PATCH | `/pos/settings/payments-checkout` | staff |
| POST | `/pos/settings/payments-checkout/terminals/{id}/assign-location` | staff |
| POST | `/pos/settings/payments-checkout/terminals/{id}/disable` | staff |
| POST | `/pos/settings/payments-checkout/terminals/{id}/enable` | staff |
| POST | `/pos/settings/payments-checkout/terminals/{id}/register` | staff |
| POST | `/pos/settings/payments-checkout/terminals/{id}/unpair` | staff |
| POST | `/pos/settings/payments-checkout/terminals/pair` | staff |
| PATCH | `/pos/settings/roles-permissions-security` | staff |
| PATCH | `/pos/settings/security` | staff |
| POST | `/pos/staff-roles` | staff |
| POST | `/pos/staff-roles/{id}/archive` | staff |
| POST | `/pos/team-onboarding/staff` | staff |
| PATCH | `/pos/technicians/{technicianId}/app-access` | staff |
| PATCH | `/pos/technicians/{technicianId}/permissions` | staff |
| POST | `/pos/webhooks` | staff |
| POST | `/pos/webhooks/{id}/rotate-secret` | staff |
| PUT | `/super-admin/advertising/policy` | super_admin |
| POST | `/super-admin/ai-queue-assignment/tenants/{tenantId}/auto-kill` | super_admin |
| PUT | `/super-admin/ai-scheduling-optimizer/platform-switch` | super_admin |
| POST | `/super-admin/ai-scheduling-optimizer/tenants/{tenantId}/disable` | super_admin |
| POST | `/super-admin/ai-scheduling-optimizer/tenants/{tenantId}/recommendations/{id}/retry` | super_admin |
| POST | `/super-admin/ai-scheduling-optimizer/tenants/{tenantId}/recommendations/{id}/rollback` | super_admin |
| POST | `/super-admin/approvals/{id}/approve` | super_admin |
| POST | `/super-admin/approvals/policies/{action}` | super_admin |
| POST | `/super-admin/backups/restore-plans/{id}/approve` | super_admin |
| POST | `/super-admin/backups/restore-plans/{id}/execute` | super_admin |
| POST | `/super-admin/booking-verification/emergency-disable` | super_admin |
| POST | `/super-admin/booking-verification/module` | super_admin |
| POST | `/super-admin/commission-auth-code/generate` | super_admin |
| POST | `/super-admin/communications/platform-announcements/{id}/archive` | super_admin |
| POST | `/super-admin/communications/platform-announcements/{id}/pause` | super_admin |
| POST | `/super-admin/communications/platform-announcements/{id}/publish` | super_admin |
| POST | `/super-admin/communications/platform-announcements/{id}/resume` | super_admin |
| POST | `/super-admin/communications/providers/{id}/rotate-credential` | super_admin |
| POST | `/super-admin/community-moderation/appeals/{id}/decide` | super_admin |
| POST | `/super-admin/community-moderation/cases` | super_admin |
| PATCH | `/super-admin/community-moderation/cases/{id}` | super_admin |
| POST | `/super-admin/community-moderation/comments/{id}/actions` | super_admin |
| POST | `/super-admin/community-moderation/disputes/{id}/decide` | super_admin |
| GET | `/super-admin/community-moderation/evidence/{id}/access` | super_admin |
| POST | `/super-admin/community-moderation/evidence/{id}/review` | super_admin |
| POST | `/super-admin/community-moderation/incidents/{id}/access` | super_admin |
| POST | `/super-admin/community-moderation/posts/{id}/actions` | super_admin |
| POST | `/super-admin/community-moderation/reports/{id}/resolve` | super_admin |
| PUT | `/super-admin/community-moderation/settings` | super_admin |
| POST | `/super-admin/community-moderation/tenants/{tenantId}/actions` | super_admin |
| POST | `/super-admin/database/backends/{pid}/cancel` | super_admin |
| POST | `/super-admin/database/deferred-constraints/{id}/retry` | super_admin |
| POST | `/super-admin/database/tables/{table}/vacuum-analyze` | super_admin |
| PATCH | `/super-admin/deals/tenants/{tenantId}` | super_admin |
| PATCH | `/super-admin/features/{key}` | super_admin |
| PUT | `/super-admin/features/{key}/rollout` | super_admin |
| POST | `/super-admin/integrations/connections/{id}/credentials` | super_admin |
| POST | `/super-admin/integrations/connections/{id}/credentials/rotate` | super_admin |
| POST | `/super-admin/kill-switches/{key}` | super_admin |
| POST | `/super-admin/loyalty-network/enrollments/{tenantId}` | super_admin |
| POST | `/super-admin/loyalty-network/fraud-alerts/{id}/account-status` | super_admin |
| POST | `/super-admin/loyalty-network/global-rules` | super_admin |
| POST | `/super-admin/loyalty-network/global-rules/{id}/cancel` | super_admin |
| POST | `/super-admin/loyalty-network/payables/{id}/eligible` | super_admin |
| POST | `/super-admin/loyalty-network/payables/{id}/hold` | super_admin |
| POST | `/super-admin/loyalty-network/payables/{id}/payout` | super_admin |
| POST | `/super-admin/loyalty-network/program` | super_admin |
| POST | `/super-admin/loyalty-network/purchases/{id}/sandbox-advance` | super_admin |
| POST | `/super-admin/membership-programs/support-sessions` | super_admin |
| POST | `/super-admin/merchant-accounts/{tenantId}/activation` | super_admin |
| POST | `/super-admin/merchant-accounts/{tenantId}/deactivation` | super_admin |
| POST | `/super-admin/merchant-accounts/{tenantId}/funding-update` | super_admin |
| POST | `/super-admin/merchant-accounts/{tenantId}/mid-assignment` | super_admin |
| POST | `/super-admin/merchant-accounts/{tenantId}/rates` | super_admin |
| POST | `/super-admin/merchant-accounts/{tenantId}/surcharge-enrollment` | super_admin |
| POST | `/super-admin/merchant-accounts/{tenantId}/suspension` | super_admin |
| POST | `/super-admin/merchant-accounts/{tenantId}/terminals` | super_admin |
| PUT | `/super-admin/mobile-versions/{app}/{platform}` | super_admin |
| POST | `/super-admin/oncall/contacts` | super_admin |
| PUT | `/super-admin/oncall/contacts/{id}` | super_admin |
| POST | `/super-admin/oncall/contacts/{id}/remove` | super_admin |
| PUT | `/super-admin/oncall/synthetic` | super_admin |
| POST | `/super-admin/platform-staff/{userId}/reset-mfa` | super_admin |
| POST | `/super-admin/platform-staff/{userId}/revoke-sessions` | super_admin |
| POST | `/super-admin/platform-staff/{userId}/role` | super_admin |
| POST | `/super-admin/platform-staff/{userId}/status` | super_admin |
| POST | `/super-admin/platform/access-requests/{id}/approve` | super_admin |
| POST | `/super-admin/platform/invitations` | super_admin |
| POST | `/super-admin/platform/support-sessions` | super_admin |
| POST | `/super-admin/platform/support-sessions/{id}/extend` | super_admin |
| POST | `/super-admin/platform/users/{id}/disable` | super_admin |
| POST | `/super-admin/platform/users/{id}/enable` | super_admin |
| POST | `/super-admin/platform/users/{id}/mfa` | super_admin |
| POST | `/super-admin/platform/users/{id}/resend-invite` | super_admin |
| POST | `/super-admin/platform/users/{id}/reset-password` | super_admin |
| POST | `/super-admin/platform/users/{id}/revoke-sessions` | super_admin |
| POST | `/super-admin/platform/users/{id}/role` | super_admin |
| POST | `/super-admin/platform/users/branch-access` | super_admin |
| POST | `/super-admin/platform/users/branch-access/revoke` | super_admin |
| POST | `/super-admin/platform/users/invite` | super_admin |
| POST | `/super-admin/queue/support-session` | super_admin |
| POST | `/super-admin/revenue-residuals/partner-payouts/{id}/approve` | super_admin |
| POST | `/super-admin/security/ip-blocks` | super_admin |
| DELETE | `/super-admin/security/ip-blocks/{id}` | super_admin |
| POST | `/super-admin/security/ip-blocks/allowlist` | super_admin |
| POST | `/super-admin/security/lockdowns/{id}/cancel` | super_admin |
| POST | `/super-admin/security/lockdowns/{id}/confirm` | super_admin |
| POST | `/super-admin/security/lockdowns/{id}/execute` | super_admin |
| POST | `/super-admin/security/lockdowns/{id}/lift` | super_admin |
| PATCH | `/super-admin/security/mfa-policy` | super_admin |
| PATCH | `/super-admin/security/password-policy` | super_admin |
| POST | `/super-admin/security/privileged-access/{id}/approve` | super_admin |
| PATCH | `/super-admin/security/session-policy` | super_admin |
| POST | `/super-admin/sms-packages/platform-controls` | super_admin |
| PUT | `/super-admin/system/cost/prices` | super_admin |
| PUT | `/super-admin/system/quotas/plans/{planId}` | super_admin |
| PUT | `/super-admin/system/quotas/tenants/{tenantId}` | super_admin |
| POST | `/super-admin/tenants/{id}/lifecycle` | super_admin |
| PATCH | `/super-admin/tenants/{id}/payment-gateway` | super_admin |
| POST | `/super-admin/tenants/{id}/payment-gateway` | super_admin |
| POST | `/super-admin/tenants/{id}/payment-gateway/branches/{branchId}` | super_admin |
| POST | `/super-admin/tenants/{id}/payment-gateway/branches/{branchId}/status` | super_admin |
| POST | `/super-admin/tenants/{id}/payment-gateway/disable` | super_admin |
| POST | `/super-admin/tenants/{id}/payment-gateway/pause` | super_admin |
| POST | `/super-admin/tenants/{id}/payment-gateway/resume` | super_admin |
| POST | `/super-admin/tenants/{id}/payment-gateway/webhooks/rotate-secret` | super_admin |
| PUT | `/super-admin/tenants/{id}/pos-language` | super_admin |
| POST | `/super-admin/tenants/{id}/reactivate` | super_admin |
| POST | `/super-admin/tenants/{id}/reset-owner-password` | super_admin |
| PATCH | `/super-admin/tenants/{id}/status` | super_admin |
| POST | `/super-admin/tenants/{id}/support-access` | super_admin |
| POST | `/super-admin/tenants/{id}/suspend` | super_admin |
| PUT | `/super-admin/tenants/{tenantId}/messaging-credentials` | super_admin |
| POST | `/super-admin/tenants/{tenantId}/messaging-credentials/reveal-sid` | super_admin |
| POST | `/super-admin/tenants/{tenantId}/messaging/platform-offboard` | super_admin |
| POST | `/super-admin/tenants/{tenantId}/messaging/platform-provision` | super_admin |
| POST | `/super-admin/tenants/bulk-status` | super_admin |
| DELETE | `/tenant/messaging/credentials` | staff |
| PUT | `/tenant/messaging/credentials` | staff |
| DELETE | `/tenant/messaging/credentials/branches/{branchId}` | staff |
| PUT | `/tenant/messaging/credentials/branches/{branchId}` | staff |
| POST | `/tenant/messaging/credentials/branches/{branchId}/reveal-sid` | staff |
| POST | `/tenant/messaging/credentials/reveal-sid` | staff |
| POST | `/tenant/messaging/number/buy` | staff |

## 9. Non-HTTP surface

| Surface | Where | Control |
|---|---|---|
| PostgreSQL | DATABASE_URL (API), PG_WORKER_DATABASE_URL (worker), MIGRATE_DATABASE_URL (deploy) | TLS required for non-private hosts (boot check on every *DATABASE_URL); least-privilege roles aps_api / aps_worker (REQUIRES KEVIN to switch); port 5432 never public (REQUIRES KEVIN to confirm the old external DB is closed) |
| Redis (optional) | REDIS_URL | rate-limit / login-throttle store across replicas; private network only |
| Object storage | MEDIA_STORE=s3, PRIVATE_FILES_* | private bucket, signed URLs ≤ 1 h, presigned PUT ≤ 10 min, server-chosen keys |
| ClamAV | CLAMAV_HOST (Railway private network) | REQUIRES KEVIN to deploy |
| Outbound — tenant / admin supplied URLs | webhooks, processor base URLs | `packages/security/src/safe-outbound.ts`: https only, the connection's own DNS answer checked against every special-purpose range, no redirects, timeout + size cap; processor hosts allowlisted (`PROCESSOR_URL_POLICIES`) |
| Outbound — fixed providers | Twilio, SendGrid, OpenAI, Anthropic, Google (Gemini, Maps, FCM, Business Profile), Apple APNs, Retell, CardPointe / Fiserv, Clover | hosts hard-coded or from env; provider secrets server-side only |
| Mobile shells | Capacitor 8.5.3 (customer, tech, owner, manager-pay; display + kiosk on iPad) | https scheme, no cleartext in release, tokens in Keychain / Keystore, FLAG_SECURE |
| CI/CD | .github/workflows (SHA-pinned actions), Railway build from Dockerfile | least-privilege token, gated image publish, Trivy, SBOM, gitleaks, CodeQL, npm audit gate |
