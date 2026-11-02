# API_INVENTORY.md

**GENERATED FROM CODE — do not hand-edit.** Regenerate with:
`cd apps/api && node scripts/generate-api-inventory.mjs > ../../API_INVENTORY.md`

Generated 2026-10-22. Source of truth: the route extractor behind the OpenAPI manifest (`apps/api/scripts/audit-routes.js` + `openapi.mjs`), which reads every controller under `apps/api/src` and `modules/*/src`. The reviewed, gate-checked form of the same list is `apps/api/openapi/manifest.txt` (`check:openapi`).

- **Controller files:** 345
- **Routes:** 3085 (public: 120; signed-in routes with no permission key: 195 — /customer 144, /auth 27, /api 11, /ai 6, /me 4, /push 2, /realtime 1; customer and self-service routes scoped to the caller's own session, integration routes, and handlers that check a permission themselves (e.g. `/ai/dashboard/settings` requires `ai.settings.manage` in the handler). Staff routes without a key are frozen in `apps/api/openapi/api-contract.unkeyed.baseline.txt` by `check:api-contract`, which may only shrink)
- **Authentication:** every non-public route passes the global session middleware (server-derived ctx); the enforcing guards are listed per route; `/super-admin` routes without a declared key get a key derived from their path domain (PlatformDomainGuard), shown as "(derived)".
- **Tenant scope:** `tenant/*` and POS/app mounts derive tenantId/branchId SERVER-SIDE from the session — never from the client. Cross-tenant aggregation exists only in reviewed super-admin services (see the tenant-isolation gate's baseline in `apps/api/scripts/tenant-isolation-check.mjs`).
- **Wiring status:** the `check:crosswire` gate proves every frontend call has a matching route and flags orphans; routes with no static frontend caller are catalogued in `UNUSED_ROUTE_INVENTORY.md` (wire-or-document, never delete).

## Routes per mount

| Mount | Routes |
| --- | ---: |
| /super-admin | 1139 |
| /pos | 1034 |
| /tenant | 183 |
| /owner | 161 |
| /customer | 159 |
| /tech | 140 |
| /mobile-checkout | 45 |
| /auth | 42 |
| /community | 42 |
| /api | 29 |
| /customer-display | 22 |
| /go-check-in | 18 |
| /internal | 13 |
| /public | 8 |
| /ai | 7 |
| /webhooks | 5 |
| /me | 4 |
| /oauth | 4 |
| /realtime | 4 |
| /technician | 4 |
| /health | 3 |
| /promotions | 3 |
| /.well-known | 2 |
| /client-telemetry | 2 |
| /push | 2 |
| /voice | 2 |
| /app-config | 1 |
| /app-links | 1 |
| /integrations | 1 |
| /jobs | 1 |
| /media | 1 |
| /metrics | 1 |
| /platform | 1 |
| /voice-transcription | 1 |

## Full route table

| Method | Route | Auth | Permission | Domain | Guards | Controller |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/.well-known/apple-app-site-association` | public | — | operations | — | mobile-links/mobile-links.controller.ts |
| GET | `/.well-known/assetlinks.json` | public | — | operations | — | mobile-links/mobile-links.controller.ts |
| POST | `/ai/{packageCode}` | session | — | ai | — | modules/ai/src/ai/ai-assistant.controller.ts |
| GET | `/ai/dashboard` | session | — | ai | — | modules/ai/src/ai/ai-control-plane.controller.ts |
| GET | `/ai/dashboard/feedback` | session | — | ai | — | modules/ai/src/ai/ai-control-plane.controller.ts |
| POST | `/ai/dashboard/feedback` | session | — | ai | — | modules/ai/src/ai/ai-control-plane.controller.ts |
| GET | `/ai/dashboard/settings` | session | — | ai | — | modules/ai/src/ai/ai-control-plane.controller.ts |
| POST | `/ai/dashboard/settings` | session | — | ai | — | modules/ai/src/ai/ai-control-plane.controller.ts |
| POST | `/ai/ocr/scan-receipt` | session | inventory.create | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai/ai-assistant.controller.ts |
| POST | `/api/ai-booking/v1/appointments` | session | — | ai | TenantAuthGuard | ai-booking/ai-booking.controller.ts |
| GET | `/api/ai-booking/v1/appointments/{appointmentId}` | session | — | ai | TenantAuthGuard | ai-booking/ai-booking.controller.ts |
| POST | `/api/ai-booking/v1/appointments/{appointmentId}/cancel` | session | — | ai | TenantAuthGuard | ai-booking/ai-booking.controller.ts |
| POST | `/api/ai-booking/v1/appointments/{appointmentId}/confirm` | session | — | ai | TenantAuthGuard | ai-booking/ai-booking.controller.ts |
| POST | `/api/ai-booking/v1/appointments/{appointmentId}/reschedule` | session | — | ai | TenantAuthGuard | ai-booking/ai-booking.controller.ts |
| POST | `/api/ai-booking/v1/availability/search` | session | — | ai | TenantAuthGuard | ai-booking/ai-booking.controller.ts |
| POST | `/api/ai-booking/v1/context` | session | — | ai | TenantAuthGuard | ai-booking/ai-booking.controller.ts |
| POST | `/api/ai-booking/v1/conversion-events` | session | — | ai | TenantAuthGuard | ai-booking/ai-booking.controller.ts |
| GET | `/api/ai-booking/v1/conversion/metrics` | session | — | ai | TenantAuthGuard | ai-booking/ai-booking.controller.ts |
| GET | `/api/ai-booking/v1/conversion/summary` | session | — | ai | TenantAuthGuard | ai-booking/ai-booking.controller.ts |
| POST | `/api/ai-booking/v1/public/appointments` | public | — | ai | — | ai-booking/ai-booking-public.controller.ts |
| POST | `/api/ai-booking/v1/public/availability/search` | public | — | ai | — | ai-booking/ai-booking-public.controller.ts |
| POST | `/api/ai-booking/v1/public/services` | public | — | ai | — | ai-booking/ai-booking-public.controller.ts |
| GET | `/api/ai-booking/v1/public/verification/captcha` | public | — | ai | — | ai-booking/ai-booking-public.controller.ts |
| POST | `/api/ai-booking/v1/public/verification/check` | public | — | ai | — | ai-booking/ai-booking-public.controller.ts |
| POST | `/api/ai-booking/v1/public/verification/send` | public | — | ai | — | ai-booking/ai-booking-public.controller.ts |
| POST | `/api/ai-booking/v1/recommendations` | session | — | ai | TenantAuthGuard | ai-booking/ai-booking.controller.ts |
| POST | `/api/ai-receptionist/v1/appointments` | api_key | — | ai | VoiceAuthGuard + VoiceKeyRateLimitGuard | modules/ai/src/voice-booking/ai-receptionist-gateway.controller.ts |
| GET | `/api/ai-receptionist/v1/appointments/{appointmentId}` | api_key | — | ai | VoiceAuthGuard + VoiceKeyRateLimitGuard | modules/ai/src/voice-booking/ai-receptionist-gateway.controller.ts |
| POST | `/api/ai-receptionist/v1/appointments/{appointmentId}/cancel` | api_key | — | ai | VoiceAuthGuard + VoiceKeyRateLimitGuard | modules/ai/src/voice-booking/ai-receptionist-gateway.controller.ts |
| POST | `/api/ai-receptionist/v1/appointments/{appointmentId}/reschedule` | api_key | — | ai | VoiceAuthGuard + VoiceKeyRateLimitGuard | modules/ai/src/voice-booking/ai-receptionist-gateway.controller.ts |
| GET | `/api/ai-receptionist/v1/availability` | api_key | — | ai | VoiceAuthGuard + VoiceKeyRateLimitGuard | modules/ai/src/voice-booking/ai-receptionist-gateway.controller.ts |
| POST | `/api/ai-receptionist/v1/customers/lookup-or-create` | api_key | — | ai | VoiceAuthGuard + VoiceKeyRateLimitGuard | modules/ai/src/voice-booking/ai-receptionist-gateway.controller.ts |
| POST | `/api/ai-receptionist/v1/handoff` | api_key | — | ai | VoiceAuthGuard + VoiceKeyRateLimitGuard | modules/ai/src/voice-booking/ai-receptionist-gateway.controller.ts |
| GET | `/api/ai-receptionist/v1/hours` | api_key | — | ai | VoiceAuthGuard + VoiceKeyRateLimitGuard | modules/ai/src/voice-booking/ai-receptionist-gateway.controller.ts |
| GET | `/api/ai-receptionist/v1/services` | api_key | — | ai | VoiceAuthGuard + VoiceKeyRateLimitGuard | modules/ai/src/voice-booking/ai-receptionist-gateway.controller.ts |
| POST | `/api/ai-receptionist/v1/verification/dtmf` | public | — | ai | — | modules/ai/src/voice-booking/ai-receptionist-verification.controller.ts |
| POST | `/api/ai-receptionist/v1/verification/send` | api_key | — | ai | VoiceAuthGuard + VoiceKeyRateLimitGuard | modules/ai/src/voice-booking/ai-receptionist-verification.controller.ts |
| GET | `/api/ai-receptionist/v1/verification/twiml` | public | — | ai | — | modules/ai/src/voice-booking/ai-receptionist-verification.controller.ts |
| GET | `/app-config` | public | — | operations | — | mobile-config/app-config.controller.ts |
| GET | `/app-links/{path}` | public | — | operations | — | mobile-links/mobile-links.controller.ts |
| GET | `/auth/activity` | session | — | identity | SignedInUserGuard | modules/identity/src/auth/auth-activity.controller.ts |
| POST | `/auth/admin/reset-user-password` | public | — | identity | — | modules/identity/src/auth/system-reset.controller.ts |
| DELETE | `/auth/avatar` | session | — | workforce | StaffSessionGuard | modules/workforce/src/tech-profile/staff-avatar.controller.ts |
| POST | `/auth/avatar` | session | — | workforce | StaffSessionGuard | modules/workforce/src/tech-profile/staff-avatar.controller.ts |
| POST | `/auth/biometric/enroll` | session | — | identity | SignedInUserGuard | modules/identity/src/auth/biometric.controller.ts |
| POST | `/auth/biometric/login` | public | — | identity | — | modules/identity/src/auth/biometric.controller.ts |
| POST | `/auth/biometric/revoke` | session | — | identity | SignedInUserGuard | modules/identity/src/auth/biometric.controller.ts |
| GET | `/auth/biometric/status` | public | — | identity | — | modules/identity/src/auth/biometric.controller.ts |
| GET | `/auth/branches` | session | — | identity | — | modules/identity/src/auth/auth.controller.ts |
| POST | `/auth/change-password` | session | — | identity | — | modules/identity/src/auth/account.controller.ts |
| POST | `/auth/change-temporary-password` | public | — | identity | — | modules/identity/src/auth/system-reset.controller.ts |
| GET | `/auth/devices` | session | — | identity | SignedInUserGuard | modules/identity/src/auth/auth-devices.controller.ts |
| POST | `/auth/devices/{id}/block` | session | — | identity | SignedInUserGuard | modules/identity/src/auth/auth-devices.controller.ts |
| POST | `/auth/devices/{id}/revoke` | session | — | identity | SignedInUserGuard | modules/identity/src/auth/auth-devices.controller.ts |
| POST | `/auth/devices/{id}/trust` | session | — | identity | SignedInUserGuard | modules/identity/src/auth/auth-devices.controller.ts |
| POST | `/auth/devices/{id}/unblock` | session | — | identity | SignedInUserGuard | modules/identity/src/auth/auth-devices.controller.ts |
| POST | `/auth/lock` | session | — | identity | StaffSessionGuard | modules/identity/src/auth/auth.controller.ts |
| GET | `/auth/lock-status` | session | — | identity | StaffSessionGuard | modules/identity/src/auth/auth.controller.ts |
| POST | `/auth/login` | public | — | identity | — | modules/identity/src/auth/auth.controller.ts |
| POST | `/auth/logout` | public | — | identity | — | modules/identity/src/auth/auth.controller.ts |
| GET | `/auth/me` | session | — | identity | — | modules/identity/src/auth/auth.controller.ts |
| POST | `/auth/mfa/confirm` | session | — | identity | — | modules/identity/src/auth/mfa.controller.ts |
| POST | `/auth/mfa/enroll` | session | — | identity | — | modules/identity/src/auth/mfa.controller.ts |
| GET | `/auth/mfa/recovery-codes` | session | — | identity | SignedInUserGuard | modules/identity/src/auth/mfa.controller.ts |
| POST | `/auth/mfa/recovery-codes` | session | — | identity | SignedInUserGuard | modules/identity/src/auth/mfa.controller.ts |
| GET | `/auth/mfa/status` | session | — | identity | — | modules/identity/src/auth/mfa.controller.ts |
| POST | `/auth/password-reset/complete` | public | — | identity | — | modules/identity/src/auth/password-reset.controller.ts |
| POST | `/auth/password-reset/request` | public | — | identity | — | modules/identity/src/auth/password-reset.controller.ts |
| POST | `/auth/password-reset/temp-login` | public | — | identity | — | modules/identity/src/auth/password-reset.controller.ts |
| POST | `/auth/refresh` | public | — | identity | — | modules/identity/src/auth/auth.controller.ts |
| POST | `/auth/select-branch` | session | — | identity | — | modules/identity/src/auth/auth.controller.ts |
| POST | `/auth/session-activity` | session | — | identity | StaffSessionGuard | modules/identity/src/auth/auth.controller.ts |
| POST | `/auth/set-pin` | session | — | identity | StaffSessionGuard | modules/identity/src/auth/auth.controller.ts |
| POST | `/auth/step-up` | session | — | security | SignedInUserGuard | common/step-up.ts |
| POST | `/auth/super-admin/forgot-password` | public | — | identity | — | modules/identity/src/auth/system-reset.controller.ts |
| POST | `/auth/temp-password-login` | public | — | identity | — | modules/identity/src/auth/system-reset.controller.ts |
| POST | `/auth/verify-pin` | session | — | identity | StaffSessionGuard | modules/identity/src/auth/auth.controller.ts |
| POST | `/auth/webauthn/authenticate/begin` | public | — | identity | — | modules/identity/src/auth/webauthn.controller.ts |
| POST | `/auth/webauthn/authenticate/finish` | public | — | identity | — | modules/identity/src/auth/webauthn.controller.ts |
| POST | `/auth/webauthn/register/begin` | session | — | identity | — | modules/identity/src/auth/webauthn.controller.ts |
| POST | `/auth/webauthn/register/finish` | session | — | identity | — | modules/identity/src/auth/webauthn.controller.ts |
| GET | `/auth/webauthn/status` | public | — | identity | — | modules/identity/src/auth/webauthn.controller.ts |
| POST | `/client-telemetry/errors` | public | — | operations | — | observability/client-errors.controller.ts |
| POST | `/client-telemetry/events` | public | — | operations | — | observability/client-events.controller.ts |
| POST | `/community/advisories` | session | community.advisory.draft | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| PUT | `/community/advisories/{id}` | session | community.advisory.draft | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| POST | `/community/advisories/{id}/approve` | session | community.advisory.approve | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| POST | `/community/advisories/{id}/return` | session | community.advisory.approve | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| POST | `/community/advisories/{id}/submit` | session | community.advisory.draft | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| POST | `/community/advisories/{id}/withdraw` | session | community.advisory.draft | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| POST | `/community/advisories/assist` | session | community.advisory.draft | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| GET | `/community/alerts/active` | session | community.feed.view | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| GET | `/community/analytics` | session | community.settings.manage | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| GET | `/community/appeals` | session | community.appeal.create | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| DELETE | `/community/comments/{id}` | session | community.comment.create | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| PUT | `/community/comments/{id}` | session | community.comment.create | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| POST | `/community/comments/{id}/report` | session | community.report.create | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| GET | `/community/evidence/{id}/access` | session | community.evidence.upload | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| POST | `/community/evidence/{id}/complete` | session | community.evidence.upload | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| POST | `/community/evidence/uploads` | session | community.evidence.upload | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| GET | `/community/feed` | session | community.feed.view | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| GET | `/community/follows` | session | community.follow | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| POST | `/community/follows` | session | community.follow | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| DELETE | `/community/follows/{id}` | session | community.follow | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| GET | `/community/incidents` | session | community.incident.create | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| POST | `/community/incidents` | session | community.incident.create | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| GET | `/community/incidents/{id}` | session | community.incident.create | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| GET | `/community/mine` | session | community.advisory.draft | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| GET | `/community/mine/{id}` | session | community.advisory.draft | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| GET | `/community/posts/{id}` | session | community.feed.view | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| PUT | `/community/posts/{id}` | session | community.advisory.submit | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| POST | `/community/posts/{id}/appeal` | session | community.appeal.create | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| GET | `/community/posts/{id}/comments` | session | community.feed.view | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| POST | `/community/posts/{id}/comments` | session | community.comment.create | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| POST | `/community/posts/{id}/dispute` | session | community.dispute.create | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| GET | `/community/posts/{id}/evidence` | session | community.evidence.upload | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| DELETE | `/community/posts/{id}/follow` | session | community.follow | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| POST | `/community/posts/{id}/follow` | session | community.follow | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| POST | `/community/posts/{id}/report` | session | community.report.create | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| POST | `/community/posts/{id}/resolve` | session | community.advisory.submit | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| POST | `/community/posts/{id}/similar` | session | community.report.create | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community-interactions.controller.ts |
| POST | `/community/posts/{id}/updates` | session | community.advisory.submit | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| POST | `/community/rules/acknowledge` | session | community.feed.view | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| GET | `/community/search` | session | community.feed.view | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| GET | `/community/settings` | session | community.feed.view | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| PUT | `/community/settings` | session | community.settings.manage | support | RolePermissionGuard + TenantAuthGuard | modules/safety/src/tenant-safety-community/community.controller.ts |
| GET | `/customer-display/checkout/{sessionId}` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/checkout/{sessionId}/method` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/checkout/{sessionId}/pay` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/checkout/{sessionId}/rating` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/checkout/{sessionId}/receipt` | public | — | operations | — | customer-display/customer-display.controller.ts |
| GET | `/customer-display/checkout/{sessionId}/stream` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/checkout/{sessionId}/tip` | public | — | operations | — | customer-display/customer-display.controller.ts |
| GET | `/customer-display/device/ads` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/device/ads/displays` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/device/check-in/session` | public | — | operations | — | customer-display/customer-display.controller.ts |
| GET | `/customer-display/device/current` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/device/heartbeat` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/device/method` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/device/pay` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/device/phone-code` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/device/rating` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/device/receipt` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/device/release` | public | — | operations | — | customer-display/customer-display.controller.ts |
| GET | `/customer-display/device/stream` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/device/tip` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/pairing` | public | — | operations | — | customer-display/customer-display.controller.ts |
| POST | `/customer-display/pairing/{pairingId}/poll` | public | — | operations | — | customer-display/customer-display.controller.ts |
| GET | `/customer/addresses` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/addresses` | session | — | customers | — | customer/customer.controller.ts |
| DELETE | `/customer/addresses/{id}` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/addresses/{id}/default` | session | — | customers | — | customer/customer.controller.ts |
| GET | `/customer/appointments` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/appointments/{id}/cancel` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/appointments/{id}/check-in` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/auth/activation/request-code` | public | — | identity | — | modules/booking/src/customer-activation/customer-activation.controller.ts |
| POST | `/customer/auth/activation/resend-code` | public | — | identity | — | modules/booking/src/customer-activation/customer-activation.controller.ts |
| POST | `/customer/auth/activation/select-salon` | public | — | identity | — | modules/booking/src/customer-activation/customer-activation.controller.ts |
| POST | `/customer/auth/activation/verify-code` | public | — | identity | — | modules/booking/src/customer-activation/customer-activation.controller.ts |
| POST | `/customer/auth/register` | public | — | identity | — | modules/identity/src/customer-registration/customer-registration.controller.ts |
| POST | `/customer/booking` | session | — | booking | — | modules/booking/src/customer-booking/customer-booking.controller.ts |
| GET | `/customer/booking/appointments/{id}/deposit` | session | — | booking | — | modules/booking/src/deposits/customer-deposit.controller.ts |
| POST | `/customer/booking/appointments/{id}/deposit` | session | — | booking | — | modules/booking/src/deposits/customer-deposit.controller.ts |
| POST | `/customer/booking/appointments/{id}/reschedule` | session | — | booking | — | modules/booking/src/customer-booking/customer-booking.controller.ts |
| GET | `/customer/booking/availability` | session | — | booking | — | modules/booking/src/customer-booking/customer-booking.controller.ts |
| GET | `/customer/booking/options` | session | — | booking | — | modules/booking/src/customer-booking/customer-booking.controller.ts |
| GET | `/customer/booking/service-technicians` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| GET | `/customer/booking/verification/captcha` | session | — | booking | — | modules/booking/src/customer-booking/booking-verification.controller.ts |
| POST | `/customer/booking/verification/check` | session | — | booking | — | modules/booking/src/customer-booking/booking-verification.controller.ts |
| GET | `/customer/booking/verification/policy` | session | — | booking | — | modules/booking/src/customer-booking/booking-verification.controller.ts |
| POST | `/customer/booking/verification/send` | session | — | booking | — | modules/booking/src/customer-booking/booking-verification.controller.ts |
| GET | `/customer/deals` | session | — | customers | — | customer/customer.controller.ts |
| GET | `/customer/deals/{id}` | session | — | deals | — | modules/deals/src/deals/deals.customer.controller.ts |
| POST | `/customer/deals/{id}/estimate` | session | — | deals | — | modules/deals/src/deals/deals.customer.controller.ts |
| DELETE | `/customer/deals/{id}/save` | session | — | deals | — | modules/deals/src/deals/deals.customer.controller.ts |
| POST | `/customer/deals/{id}/save` | session | — | deals | — | modules/deals/src/deals/deals.customer.controller.ts |
| GET | `/customer/deals/nearby` | public | — | deals | — | modules/deals/src/deals/deals.customer.controller.ts |
| GET | `/customer/deals/public/{id}` | public | — | deals | — | modules/deals/src/deals/deals.customer.controller.ts |
| POST | `/customer/deals/public/{id}/estimate` | public | — | deals | — | modules/deals/src/deals/deals.customer.controller.ts |
| GET | `/customer/deals/salon` | session | — | deals | — | modules/deals/src/deals/deals.customer.controller.ts |
| GET | `/customer/deals/saved` | session | — | deals | — | modules/deals/src/deals/deals.customer.controller.ts |
| GET | `/customer/deals/wallet` | session | — | deals | — | modules/deals/src/deals/deals.customer.controller.ts |
| GET | `/customer/follow-ups` | session | — | marketing | — | modules/communications/src/end-of-day-followups/end-of-day-followups.customer.controller.ts |
| GET | `/customer/follow-ups/{id}` | session | — | marketing | — | modules/communications/src/end-of-day-followups/end-of-day-followups.customer.controller.ts |
| POST | `/customer/follow-ups/{id}/rebook` | session | — | marketing | — | modules/communications/src/end-of-day-followups/end-of-day-followups.customer.controller.ts |
| POST | `/customer/follow-ups/{id}/reply` | session | — | marketing | — | modules/communications/src/end-of-day-followups/end-of-day-followups.customer.controller.ts |
| POST | `/customer/follow-ups/{id}/respond` | session | — | marketing | — | modules/communications/src/end-of-day-followups/end-of-day-followups.customer.controller.ts |
| GET | `/customer/gift-cards` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/gift-cards/{id}/report-lost` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/gift-cards/{id}/send` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/gift-cards/claim` | session | — | customers | — | customer/customer.controller.ts |
| GET | `/customer/home` | session | — | customers | — | customer/customer.controller.ts |
| GET | `/customer/invoices` | session | — | finance | — | modules/payments/src/invoices/customer-invoices.controller.ts |
| GET | `/customer/invoices/{id}` | session | — | finance | — | modules/payments/src/invoices/customer-invoices.controller.ts |
| POST | `/customer/invoices/{id}/pay` | session | — | finance | — | modules/payments/src/invoices/customer-invoices.controller.ts |
| GET | `/customer/loyalty` | session | — | customers | — | customer/customer.controller.ts |
| GET | `/customer/me/active-bill` | session | — | checkout | — | modules/checkout/src/skip-line-checkout/customer-skip-line.controller.ts |
| POST | `/customer/me/delete-account-request` | session | — | identity | — | account/account.controllers.ts |
| GET | `/customer/me/favorite-salons` | session | — | customers | — | modules/customers/src/customer-salons/customer-favorites.controller.ts |
| DELETE | `/customer/me/favorite-salons/{salonId}` | session | — | customers | — | modules/customers/src/customer-salons/customer-favorites.controller.ts |
| POST | `/customer/me/favorite-salons/{salonId}` | session | — | customers | — | modules/customers/src/customer-salons/customer-favorites.controller.ts |
| GET | `/customer/me/home-salon` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/me/home-salon` | session | — | customers | — | customer/customer.controller.ts |
| GET | `/customer/me/locale` | session | — | identity | — | account/language.controller.ts |
| GET | `/customer/me/privacy-export` | session | — | identity | — | account/account.controllers.ts |
| POST | `/customer/me/security/password/change` | session | — | security | CustomerAuthGuard | modules/identity/src/customer-security/customer-security.controller.ts |
| POST | `/customer/me/security/password/create` | session | — | security | CustomerAuthGuard | modules/identity/src/customer-security/customer-security.controller.ts |
| GET | `/customer/me/security/sessions` | session | — | security | CustomerAuthGuard | modules/identity/src/customer-security/customer-security.controller.ts |
| POST | `/customer/me/security/sessions/{id}/revoke` | session | — | security | CustomerAuthGuard | modules/identity/src/customer-security/customer-security.controller.ts |
| POST | `/customer/me/security/sessions/revoke-others` | session | — | security | CustomerAuthGuard | modules/identity/src/customer-security/customer-security.controller.ts |
| GET | `/customer/me/security/status` | session | — | security | CustomerAuthGuard | modules/identity/src/customer-security/customer-security.controller.ts |
| GET | `/customer/membership` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/membership/join` | session | — | customers | — | customer/customer.controller.ts |
| GET | `/customer/messages` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| GET | `/customer/messages/{threadId}` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| POST | `/customer/messages/{threadId}` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| POST | `/customer/messages/{threadId}/block` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| POST | `/customer/messages/{threadId}/report` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| GET | `/customer/my-photo-consents` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-photo-consent.controller.ts |
| POST | `/customer/my-photo-consents/{photoId}/withdraw` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-photo-consent.controller.ts |
| DELETE | `/customer/nail-showcase/comments/{commentId}` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| POST | `/customer/nail-showcase/comments/{commentId}/report` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| GET | `/customer/nail-showcase/feed` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| GET | `/customer/nail-showcase/leaderboard` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| GET | `/customer/nail-showcase/me/rank` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| POST | `/customer/nail-showcase/posts` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| DELETE | `/customer/nail-showcase/posts/{postId}` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| GET | `/customer/nail-showcase/posts/{postId}` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| PATCH | `/customer/nail-showcase/posts/{postId}` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| GET | `/customer/nail-showcase/posts/{postId}/comments` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| POST | `/customer/nail-showcase/posts/{postId}/comments` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| POST | `/customer/nail-showcase/posts/{postId}/photos` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| DELETE | `/customer/nail-showcase/posts/{postId}/reaction` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| POST | `/customer/nail-showcase/posts/{postId}/reaction` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| POST | `/customer/nail-showcase/posts/{postId}/report` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| GET | `/customer/notifications` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/notifications/read` | session | — | customers | — | customer/customer.controller.ts |
| GET | `/customer/operations` | session | — | operations | CustomerAuthGuard | common/async-export/operations.controller.ts |
| GET | `/customer/operations/{id}` | session | — | operations | CustomerAuthGuard | common/async-export/operations.controller.ts |
| GET | `/customer/operations/{id}/download` | session | — | operations | CustomerAuthGuard | common/async-export/operations.controller.ts |
| GET | `/customer/payment-methods` | session | — | payments | — | modules/payments/src/customer-payments/customer-payments.controller.ts |
| POST | `/customer/payment-methods` | session | — | payments | — | modules/payments/src/customer-payments/customer-payments.controller.ts |
| DELETE | `/customer/payment-methods/{id}` | session | — | payments | — | modules/payments/src/customer-payments/customer-payments.controller.ts |
| POST | `/customer/payment-methods/{id}/default` | session | — | payments | — | modules/payments/src/customer-payments/customer-payments.controller.ts |
| GET | `/customer/payment-methods/tokenizer` | session | — | payments | — | modules/payments/src/customer-payments/customer-payments.controller.ts |
| POST | `/customer/payments/{invoiceId}/confirm` | session | — | checkout | — | modules/checkout/src/skip-line-checkout/customer-skip-line.controller.ts |
| POST | `/customer/payments/{invoiceId}/pay-cash-to-tech` | session | — | checkout | — | modules/checkout/src/skip-line-checkout/customer-skip-line.controller.ts |
| POST | `/customer/payments/{invoiceId}/start` | session | — | checkout | — | modules/checkout/src/skip-line-checkout/customer-skip-line.controller.ts |
| GET | `/customer/payments/{paymentId}/status` | session | — | checkout | — | modules/checkout/src/skip-line-checkout/customer-skip-line.controller.ts |
| GET | `/customer/profile` | session | — | customers | — | customer/customer.controller.ts |
| PATCH | `/customer/profile` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/profile/avatar` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/profile/phone` | session | — | identity | — | modules/booking/src/customer-phone/customer-phone-app.controller.ts |
| POST | `/customer/profile/phone/{sessionId}/cancel` | session | — | identity | — | modules/booking/src/customer-phone/customer-phone-app.controller.ts |
| POST | `/customer/profile/phone/{sessionId}/send` | session | — | identity | — | modules/booking/src/customer-phone/customer-phone-app.controller.ts |
| POST | `/customer/profile/phone/{sessionId}/verify` | session | — | identity | — | modules/booking/src/customer-phone/customer-phone-app.controller.ts |
| POST | `/customer/profile/phone/login-number` | session | — | identity | — | modules/booking/src/customer-phone/customer-phone-app.controller.ts |
| GET | `/customer/profile/phone/status` | session | — | identity | — | modules/booking/src/customer-phone/customer-phone-app.controller.ts |
| POST | `/customer/profile/phone/verify-current/confirm` | session | — | identity | — | modules/booking/src/customer-phone/customer-phone-app.controller.ts |
| POST | `/customer/profile/phone/verify-current/request` | session | — | identity | — | modules/booking/src/customer-phone/customer-phone-app.controller.ts |
| GET | `/customer/queue` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/queue/{queueItemId}/accept-alternate` | session | — | booking | — | modules/queue/src/queue/queue.controller.ts |
| GET | `/customer/queue/{queueItemId}/alternates` | session | — | booking | — | modules/queue/src/queue/queue.controller.ts |
| GET | `/customer/receipts` | session | — | customers | — | customer/customer.controller.ts |
| GET | `/customer/referral` | session | — | customers | — | customer/customer.controller.ts |
| GET | `/customer/rewards` | session | — | customers | — | customer/customer.controller.ts |
| POST | `/customer/rewards/{id}/redeem` | session | — | customers | — | customer/customer.controller.ts |
| GET | `/customer/salon` | session | — | customers | — | customer/customer.controller.ts |
| GET | `/customer/salons/{salonId}` | public | — | customers | — | modules/customers/src/customer-salons/customer-salons.controller.ts |
| GET | `/customer/salons/{salonId}/services` | public | — | customers | — | modules/customers/src/customer-salons/customer-salons.controller.ts |
| GET | `/customer/salons/{salonId}/services/{serviceId}/technicians` | public | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| GET | `/customer/salons/{salonId}/technicians` | public | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| GET | `/customer/salons/nearby` | public | — | customers | — | modules/customers/src/customer-salons/customer-salons.controller.ts |
| GET | `/customer/schedule-proposals` | session | — | ai | CustomerAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling-proposals.customer.controller.ts |
| POST | `/customer/schedule-proposals/{id}/approve` | session | — | ai | CustomerAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling-proposals.customer.controller.ts |
| POST | `/customer/schedule-proposals/{id}/reject` | session | — | ai | CustomerAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling-proposals.customer.controller.ts |
| GET | `/customer/service-progress` | session | — | customers | — | customer/customer.controller.ts |
| DELETE | `/customer/social/block/{customerId}` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| POST | `/customer/social/block/{customerId}` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| DELETE | `/customer/social/follow/{customerId}` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| POST | `/customer/social/follow/{customerId}` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| POST | `/customer/social/me/avatar` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| GET | `/customer/social/me/blocked` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| GET | `/customer/social/me/following-feed` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| GET | `/customer/social/me/profile` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| PATCH | `/customer/social/me/profile` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| GET | `/customer/social/profile/{customerId}` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| GET | `/customer/social/profile/{customerId}/followers` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| GET | `/customer/social/profile/{customerId}/following` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| GET | `/customer/social/profile/{customerId}/posts` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| POST | `/customer/social/profile/{customerId}/report` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase-social.controller.ts |
| GET | `/customer/stream` | session | — | operations | CustomerAuthGuard | domain-streams/customer-realtime.controller.ts |
| GET | `/customer/tech-favorites` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| POST | `/customer/tech-favorites` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| DELETE | `/customer/tech-favorites/{publicSlug}` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| GET | `/customer/tech-ratings/pending` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| GET | `/customer/techs/{publicSlug}` | public | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| POST | `/customer/techs/{publicSlug}/event` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| POST | `/customer/techs/{publicSlug}/message` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| GET | `/customer/techs/nearby` | public | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| GET | `/customer/tickets/{ticketId}/nail-showcase-eligibility` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| POST | `/customer/tickets/{ticketId}/nail-showcase-post` | session | — | workforce | — | modules/workforce/src/nail-showcase/nail-showcase.controller.ts |
| POST | `/customer/tickets/{ticketId}/technician-ratings` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| PATCH | `/customer/tickets/{ticketId}/technician-ratings/{ratingId}` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| GET | `/customer/tickets/{ticketId}/technician-ratings/mine` | session | — | workforce | — | modules/workforce/src/tech-profile/customer-tech.controller.ts |
| GET | `/customer/wallet` | session | — | payments | — | modules/customers/src/wallet/customer-wallet.controller.ts |
| POST | `/customer/wallet/top-up` | session | — | payments | — | modules/payments/src/customer-payments/customer-payments.controller.ts |
| GET | `/go-check-in/{slug}/config` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| POST | `/go-check-in/{slug}/start-session` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| POST | `/go-check-in/session/{sessionId}/accept-alternate` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| POST | `/go-check-in/session/{sessionId}/check-in-appointment` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| GET | `/go-check-in/session/{sessionId}/check-in-status` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| POST | `/go-check-in/session/{sessionId}/check-in-walk-in` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| POST | `/go-check-in/session/{sessionId}/complete` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| POST | `/go-check-in/session/{sessionId}/confirm-customer` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| POST | `/go-check-in/session/{sessionId}/create-customer` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| POST | `/go-check-in/session/{sessionId}/heartbeat` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| POST | `/go-check-in/session/{sessionId}/lookup-phone` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| GET | `/go-check-in/session/{sessionId}/place-in-line` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| GET | `/go-check-in/session/{sessionId}/services` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| POST | `/go-check-in/session/{sessionId}/technician/clock-in` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| POST | `/go-check-in/session/{sessionId}/technician/clock-out` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| POST | `/go-check-in/session/{sessionId}/technician/identify` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| GET | `/go-check-in/session/{sessionId}/technicians` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| GET | `/go-check-in/session/{sessionId}/today-appointments` | public | — | booking | — | modules/queue/src/go-check-in/go-check-in.public.controller.ts |
| GET | `/health` | public | — | operations | — | health/health.controller.ts |
| GET | `/health/live` | public | — | operations | — | health/health.controller.ts |
| GET | `/health/ready` | public | — | operations | — | health/health.controller.ts |
| POST | `/integrations/inbound/{connectionId}` | public | — | operations | — | modules/super-admin/src/super-admin-integrations/integration-webhook.controller.ts |
| POST | `/internal/ai-billing/cardpointe` | public | — | ai | — | modules/ai/src/ai/ai-subscription-billing.service.ts |
| POST | `/internal/ai-billing/event` | public | — | ai | — | modules/ai/src/ai/ai-subscription-billing.service.ts |
| POST | `/internal/ai-billing/sweep-trials` | public | — | ai | — | modules/ai/src/ai/ai-subscription-billing.service.ts |
| POST | `/internal/ai-billing/webhook` | public | — | ai | — | modules/ai/src/ai/ai-subscription-billing.service.ts |
| POST | `/internal/backups/report` | public | — | operations | — | observability/backup-reports.ts |
| POST | `/internal/hardware-payment/run-monthly` | public | — | payments | — | modules/payments/src/hardware-payment/hardware-payment.cron.controller.ts |
| POST | `/internal/membership-billing/apply` | public | — | memberships | — | modules/memberships/src/membership-billing.controller.ts |
| POST | `/internal/membership-billing/cardpointe` | public | — | memberships | — | modules/memberships/src/membership-billing.controller.ts |
| POST | `/internal/membership-billing/proration-preview` | public | — | memberships | — | modules/memberships/src/membership-billing.controller.ts |
| POST | `/internal/membership-billing/run-reminders` | public | — | memberships | — | modules/memberships/src/membership-billing.controller.ts |
| POST | `/internal/membership-billing/run-renewals` | public | — | memberships | — | modules/memberships/src/membership-billing.controller.ts |
| POST | `/internal/scheduled-reports/run-due` | public | — | operations | — | modules/super-admin/src/super-admin-platform/scheduled-reports.cron.controller.ts |
| POST | `/internal/tenant-warnings/dispatch` | public | — | support | — | modules/super-admin/src/super-admin-tenant-warnings/tenant-warning-dispatch.cron.controller.ts |
| POST | `/jobs/appointment-reminders` | public | — | communications | — | modules/communications/src/reminders/reminders.controller.ts |
| GET | `/me/access-requests` | session | — | identity | — | modules/super-admin/src/super-admin-platform/my-access-requests.controller.ts |
| POST | `/me/access-requests` | session | — | identity | — | modules/super-admin/src/super-admin-platform/my-access-requests.controller.ts |
| POST | `/me/access-requests/{id}/cancel` | session | — | identity | — | modules/super-admin/src/super-admin-platform/my-access-requests.controller.ts |
| GET | `/me/privacy-export` | session | — | identity | — | account/account.controllers.ts |
| GET | `/media/{path}` | public | — | workforce | — | modules/workforce/src/tech-profile/media.controller.ts |
| GET | `/metrics` | public | — | operations | — | health/metrics.controller.ts |
| GET | `/mobile-checkout/capability` | session | mobile_checkout.login | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/claims` | session | pos.checkout.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/device/heartbeat` | session | mobile_checkout.login | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/device/register` | session | mobile_checkout.login | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/devices` | session | mobile_checkout.login | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/devices/{deviceId}/approve` | session | mobile_checkout.login | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/devices/{deviceId}/compromised` | session | mobile_checkout.login | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/devices/{deviceId}/disable` | session | mobile_checkout.login | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/devices/{deviceId}/reassign` | session | mobile_checkout.login | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/devices/{deviceId}/revoke` | session | mobile_checkout.login | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/devices/status` | session | pos.checkout.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/payment-attempts/{idempotencyKey}` | session | mobile_checkout.tap_to_pay | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/payment-attempts/{idempotencyKey}/cancel` | session | mobile_checkout.tap_to_pay | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/payment-attempts/{idempotencyKey}/capture-result` | session | mobile_checkout.tap_to_pay | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/payment-attempts/{idempotencyKey}/device-session` | session | mobile_checkout.tap_to_pay | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/payment-attempts/{idempotencyKey}/readiness` | session | mobile_checkout.tap_to_pay | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/payment-attempts/{idempotencyKey}/reconcile` | session | mobile_checkout.tap_to_pay | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/payment-attempts/{idempotencyKey}/verify` | session | mobile_checkout.tap_to_pay | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/payments` | session | mobile_checkout.view_history | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/payments/{paymentId}/refund` | session | pos.checkout.refund | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/payments/{paymentId}/void` | session | pos.checkout.void | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/queue` | session | mobile_checkout.view_queue | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/readiness` | session | mobile_checkout.login | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/reports` | session | mobile_checkout.view_reports | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/reports/sales` | session | mobile_checkout.view_reports | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/retail-catalog` | session | mobile_checkout.open_ticket | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/tap-to-pay/onboarding` | session | mobile_checkout.login | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/tickets/{ticketId}` | session | mobile_checkout.open_ticket | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/tickets/{ticketId}/balance` | session | mobile_checkout.tap_to_pay | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/tickets/{ticketId}/cash-tender` | session | mobile_checkout.split_payment | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/tickets/{ticketId}/discount` | session | mobile_checkout.open_ticket | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/tickets/{ticketId}/lock` | session | mobile_checkout.open_ticket | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/tickets/{ticketId}/lock` | session | mobile_checkout.open_ticket | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/tickets/{ticketId}/lock/refresh` | session | mobile_checkout.open_ticket | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/tickets/{ticketId}/lock/release` | session | mobile_checkout.open_ticket | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/tickets/{ticketId}/lock/takeover` | session | mobile_checkout.open_ticket | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/tickets/{ticketId}/payment-attempts` | session | mobile_checkout.view_history | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/tickets/{ticketId}/payment-attempts` | session | mobile_checkout.tap_to_pay | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/tickets/{ticketId}/payments` | session | mobile_checkout.open_ticket | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/tickets/{ticketId}/proceed-to-payment` | session | mobile_checkout.tap_to_pay | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/tickets/{ticketId}/receipt` | session | pos.receipts.send | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/tickets/{ticketId}/refund` | session | pos.checkout.refund | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/mobile-checkout/tickets/{ticketId}/refund-preview` | session | pos.checkout.refund | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/tickets/{ticketId}/retail` | session | mobile_checkout.open_ticket | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| POST | `/mobile-checkout/tickets/{ticketId}/send-to-device` | session | pos.checkout.take_payment | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/mobile-checkout/mobile-checkout.controller.ts |
| GET | `/oauth/authorize` | session | settings.edit | identity | — | oauth/oauth.controller.ts |
| POST | `/oauth/authorize` | session | settings.edit | identity | — | oauth/oauth.controller.ts |
| POST | `/oauth/revoke` | public | — | identity | — | oauth/oauth.controller.ts |
| POST | `/oauth/token` | public | — | identity | — | oauth/oauth.controller.ts |
| POST | `/owner/activity` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/ai-center` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/ai-queue-assignment/summary` | session | owner.dashboard.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-owner.controller.ts |
| GET | `/owner/ai-scheduling/summary` | session | owner.dashboard.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling-owner.ts |
| GET | `/owner/alerts` | session | owner.alerts.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/alerts/{alertId}/acknowledge` | session | owner.alerts.resolve | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/alerts/{alertId}/dismiss` | session | owner.alerts.resolve | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/alerts/{alertId}/resolve` | session | owner.alerts.resolve | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/alerts/summary` | session | owner.alerts.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/approvals` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/approvals/policies` | session | approvals.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/approvals/approvals.controller.ts |
| GET | `/owner/approvals/requests` | session | approvals.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/approvals/approvals.controller.ts |
| POST | `/owner/approvals/requests/{id}/decide` | session | approvals.decide | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/approvals/approvals.controller.ts |
| GET | `/owner/attention` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/audit` | session | owner.settings.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/bookings/{appointmentId}` | session | owner.bookings.details | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/bookings/drill-down` | session | owner.bookings.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/bookings/overview` | session | owner.bookings.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/bookings/trend` | session | owner.bookings.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/branch-context` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/branch-health` | session | owner.dashboard.view | operations | RolePermissionGuard + TenantAuthGuard | observability/branch-health.ts |
| GET | `/owner/branches` | session | owner.branches.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/branches/{branchId}/performance` | session | owner.branches.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/branches/comparison` | session | owner.branches.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/branches/performance` | session | owner.branches.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/cash-drawer` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/cash-handoffs` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/cash-summary` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/compensation/agreements` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/agreements` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| GET | `/owner/compensation/bonus-rules` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/bonus-rules` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/bonus-rules/{id}/archive` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/bonus-rules/approve` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/bonus-rules/period-review` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/bonus-rules/preview` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| GET | `/owner/compensation/classifications` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| PUT | `/owner/compensation/classifications/{technicianId}` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/compliance-period-review` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/compliance-preview` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/guarantee/preview` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/preview` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| GET | `/owner/compensation/reports/commission` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| GET | `/owner/compensation/reports/supply` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| GET | `/owner/compensation/reports/tips` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| GET | `/owner/compensation/retail-policy` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| PUT | `/owner/compensation/retail-policy` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| GET | `/owner/compensation/rules` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/rules` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/rules/{id}/versions` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/rules/seed-default` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/supply/preview` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| GET | `/owner/compensation/tier-plans` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/tier-plans` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/tier-plans/{id}/archive` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/tier-plans/preview` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| GET | `/owner/compensation/tip-policy` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| PUT | `/owner/compensation/tip-policy` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/validate` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/versions/{id}/activate` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/versions/{id}/approve` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| POST | `/owner/compensation/versions/{id}/cancel` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| GET | `/owner/compensation/wage-config` | session | compensation.view_all | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| PUT | `/owner/compensation/wage-config` | session | compensation.manage | finance | — | modules/workforce/src/compensation/compensation.controller.ts |
| GET | `/owner/context` | session | owner.portfolio.view | tenants | OwnerPortfolioGuard | modules/tenants/src/owner-portfolio/owner-portfolio.controller.ts |
| POST | `/owner/context/select` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/context/switch` | session | owner.portfolio.view | tenants | OwnerPortfolioGuard | modules/tenants/src/owner-portfolio/owner-portfolio.controller.ts |
| GET | `/owner/customers` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/dashboard/state` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/deals/{id}/approve` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.owner.controller.ts |
| POST | `/owner/deals/{id}/pause` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.owner.controller.ts |
| POST | `/owner/deals/{id}/reject` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.owner.controller.ts |
| GET | `/owner/deals/summary` | session | owner.dashboard.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.owner.controller.ts |
| GET | `/owner/expenses` | session | owner.expenses.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/expenses` | session | owner.expenses.manage | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| DELETE | `/owner/expenses/{id}` | session | owner.expenses.manage | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| PATCH | `/owner/expenses/{id}` | session | owner.expenses.manage | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/expenses/summary` | session | owner.expenses.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/finance/dashboard` | session | owner.expenses.view | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| GET | `/owner/finance/expense-categories` | session | owner.expenses.view | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expense-categories` | session | owner.expenses.categories.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| PATCH | `/owner/finance/expense-categories/{key}` | session | owner.expenses.categories.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| GET | `/owner/finance/expense-rules` | session | owner.expenses.view | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expense-rules` | session | owner.expenses.categories.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| DELETE | `/owner/finance/expense-rules/{id}` | session | owner.expenses.categories.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| GET | `/owner/finance/expense-settings` | session | owner.expenses.view | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| PUT | `/owner/finance/expense-settings` | session | owner.expenses.categories.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| GET | `/owner/finance/expenses` | session | owner.expenses.view | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses` | session | owner.expenses.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| DELETE | `/owner/finance/expenses/{id}` | session | owner.expenses.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| GET | `/owner/finance/expenses/{id}` | session | owner.expenses.view | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| PATCH | `/owner/finance/expenses/{id}` | session | owner.expenses.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/{id}/approve` | session | owner.expenses.approve | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/{id}/archive` | session | owner.expenses.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/{id}/bill-payments` | session | owner.expenses.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/{id}/documents` | session | owner.expenses.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/{id}/duplicate-decision` | session | owner.expenses.approve | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/{id}/reimbursement` | session | owner.expenses.view | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/{id}/reject` | session | owner.expenses.approve | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/{id}/restore` | session | owner.expenses.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/{id}/return-to-draft` | session | owner.expenses.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/{id}/submit` | session | owner.expenses.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/{id}/void` | session | owner.expenses.approve | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/batch/approve` | session | owner.expenses.approve | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/batch/categorize` | session | owner.expenses.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/check-duplicates` | session | owner.expenses.view | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| GET | `/owner/finance/expenses/export` | session | owner.expenses.export | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/import` | session | owner.expenses.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| POST | `/owner/finance/expenses/recommend-category` | session | owner.expenses.view | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| GET | `/owner/finance/payment-mix` | session | owner.finance.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/finance/reports` | session | owner.expenses.view | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| GET | `/owner/finance/summary` | session | owner.finance.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/finance/vendors/{vendorId}/spend` | session | owner.expenses.view | finance | RolePermissionGuard + TenantAuthGuard | modules/finance/src/expense.controller.ts |
| GET | `/owner/gift-cards/report` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/hardware-payment/autopay-consent` | session | settings.edit | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/hardware-payment/hardware-payment.owner.controller.ts |
| GET | `/owner/hardware-payment/invoices` | session | settings.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/hardware-payment/hardware-payment.owner.controller.ts |
| GET | `/owner/hardware-payment/ledger` | session | settings.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/hardware-payment/hardware-payment.owner.controller.ts |
| POST | `/owner/hardware-payment/payment-method` | session | settings.edit | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/hardware-payment/hardware-payment.owner.controller.ts |
| GET | `/owner/hardware-payment/plan` | session | settings.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/hardware-payment/hardware-payment.owner.controller.ts |
| GET | `/owner/hardware-payment/tokenizer` | session | settings.edit | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/hardware-payment/hardware-payment.owner.controller.ts |
| GET | `/owner/inventory` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/live` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/marketing` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/me/delete-account-request` | session | self.profile.edit | identity | — | account/account.controllers.ts |
| PUT | `/owner/me/language` | session | self.profile.edit | identity | — | account/language.controller.ts |
| GET | `/owner/me/locale` | session | self.profile.view | identity | — | account/language.controller.ts |
| GET | `/owner/me/privacy-export` | session | self.profile.view | identity | — | account/account.controllers.ts |
| GET | `/owner/memberships/overview` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/operations` | session | self.operations.view | operations | TenantAuthGuard | common/async-export/operations.controller.ts |
| GET | `/owner/operations/{id}` | session | self.operations.view | operations | TenantAuthGuard | common/async-export/operations.controller.ts |
| GET | `/owner/operations/{id}/download` | session | self.operations.view | operations | TenantAuthGuard | common/async-export/operations.controller.ts |
| GET | `/owner/payments` | session | owner.finance.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/payroll` | session | owner.finance.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/payroll/paychecks/periods/{id}` | session | owner.finance.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/payroll/paychecks/periods/{id}/approve` | session | payroll.approve | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/payroll/paychecks/periods/{id}/reject` | session | payroll.approve | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/payroll/paychecks/periods/{id}/return` | session | payroll.approve | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/payroll/paychecks/statements/{statementId}/approve` | session | payroll.approve | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/payroll/paychecks/summary` | session | owner.finance.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/payroll/periods/{id}` | session | owner.finance.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/payroll/periods/{id}/approve` | session | payroll.manage | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/payroll/periods/{id}/lock` | session | payroll.manage | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/payroll/periods/{id}/reopen` | session | payroll.manage | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/portfolio` | session | owner.portfolio.view | tenants | OwnerPortfolioGuard | modules/tenants/src/owner-portfolio/owner-portfolio.controller.ts |
| GET | `/owner/portfolio/revenue-series` | session | owner.portfolio.view | tenants | OwnerPortfolioGuard | modules/tenants/src/owner-portfolio/owner-portfolio.controller.ts |
| GET | `/owner/portfolio/summary` | session | owner.portfolio.view | tenants | OwnerPortfolioGuard | modules/tenants/src/owner-portfolio/owner-portfolio.controller.ts |
| GET | `/owner/profile` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/profile/avatar` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/reports` | session | owner.reports.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/reports/{reportId}/export` | session | owner.reports.export | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/salons/overview` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/security` | session | owner.settings.edit | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| POST | `/owner/security/access-code` | session | owner.settings.edit | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/settings` | session | owner.settings.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/staff/{technicianId}/earnings` | session | owner.staff.earnings.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/staff/{technicianId}/performance` | session | owner.staff.performance.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/staff/attendance` | session | owner.staff.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/staff/performance` | session | owner.staff.performance.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/stream` | session | owner.dashboard.view | operations | TenantAuthGuard | domain-streams/owner-realtime.controller.ts |
| GET | `/owner/tickets` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/owner/tickets/{ticketId}/history` | session | owner.dashboard.view | analytics | — | modules/analytics/src/owner/owner.controller.ts |
| GET | `/platform/branding` | public | — | tenants | — | modules/tenants/src/branding/branding.controller.ts |
| GET | `/pos/access/audit` | session | roles.view | identity | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/team-permissions/access.controller.ts |
| GET | `/pos/access/catalog` | session | roles.view | identity | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/team-permissions/access.controller.ts |
| POST | `/pos/access/invitations` | session | roles.manage | identity | RolePermissionGuard + TenantAuthGuard | modules/super-admin/src/super-admin-platform/salon-staff-invitations.controller.ts |
| GET | `/pos/access/members` | session | roles.view | identity | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/team-permissions/access.controller.ts |
| GET | `/pos/access/members/{userId}` | session | roles.view | identity | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/team-permissions/access.controller.ts |
| PUT | `/pos/access/members/{userId}/branches` | session | branch_access.manage | identity | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/team-permissions/access.controller.ts |
| GET | `/pos/access/members/{userId}/effective` | session | roles.view | identity | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/team-permissions/access.controller.ts |
| POST | `/pos/access/members/{userId}/end-employment` | session | roles.manage | identity | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/team-permissions/access.controller.ts |
| POST | `/pos/access/members/{userId}/overrides` | session | permissions.override | identity | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/team-permissions/access.controller.ts |
| PUT | `/pos/access/members/{userId}/role` | session | roles.manage | identity | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/team-permissions/access.controller.ts |
| POST | `/pos/access/overrides/{id}/revoke` | session | permissions.override | identity | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/team-permissions/access.controller.ts |
| POST | `/pos/access/ownership/transfer` | session | ownership.transfer | identity | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/team-permissions/access.controller.ts |
| POST | `/pos/access/preview` | session | roles.view | identity | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/team-permissions/access.controller.ts |
| GET | `/pos/access/roles` | session | roles.view | identity | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/team-permissions/access.controller.ts |
| GET | `/pos/account/overview` | session | self.profile.view | identity | TenantAuthGuard | pos-account/pos-account.controller.ts |
| GET | `/pos/ai-analytics/accuracy` | session | pos.ai_analytics.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-analytics-forecasting/ai-analytics-forecasting.controller.ts |
| GET | `/pos/ai-analytics/anomalies` | session | pos.ai_analytics.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-analytics-forecasting/ai-analytics-forecasting.controller.ts |
| GET | `/pos/ai-analytics/busy-periods` | session | pos.ai_analytics.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-analytics-forecasting/ai-analytics-forecasting.controller.ts |
| GET | `/pos/ai-analytics/forecast/appointments` | session | pos.ai_analytics.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-analytics-forecasting/ai-analytics-forecasting.controller.ts |
| GET | `/pos/ai-analytics/forecast/product/{productId}` | session | pos.ai_analytics.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-analytics-forecasting/ai-analytics-forecasting.controller.ts |
| GET | `/pos/ai-analytics/forecast/revenue` | session | pos.ai_analytics.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-analytics-forecasting/ai-analytics-forecasting.controller.ts |
| GET | `/pos/ai-analytics/no-show-risk` | session | pos.ai_analytics.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-analytics-forecasting/ai-analytics-forecasting.controller.ts |
| GET | `/pos/ai-analytics/seasonal-trends` | session | pos.ai_analytics.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-analytics-forecasting/ai-analytics-forecasting.controller.ts |
| GET | `/pos/ai-business/alerts` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| POST | `/pos/ai-business/alerts` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| DELETE | `/pos/ai-business/alerts/{id}` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| PATCH | `/pos/ai-business/alerts/{id}` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| POST | `/pos/ai-business/alerts/{id}/evaluate` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| GET | `/pos/ai-business/appointments/metrics` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| POST | `/pos/ai-business/ask` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| GET | `/pos/ai-business/branches/compare` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| GET | `/pos/ai-business/customers/growth` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| GET | `/pos/ai-business/daily-brief` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| GET | `/pos/ai-business/metrics` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| GET | `/pos/ai-business/metrics/{id}` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| GET | `/pos/ai-business/metrics/{id}/freshness` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| GET | `/pos/ai-business/reports` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| POST | `/pos/ai-business/reports` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| GET | `/pos/ai-business/reports/{id}` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| GET | `/pos/ai-business/revenue/explain-change` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| GET | `/pos/ai-business/revenue/summary` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| GET | `/pos/ai-business/saved-questions` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| POST | `/pos/ai-business/saved-questions` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| DELETE | `/pos/ai-business/saved-questions/{id}` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| POST | `/pos/ai-business/saved-questions/{id}/use` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| GET | `/pos/ai-business/technicians/performance` | session | pos.ai_business.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/ai-business/ai-business.controller.ts |
| POST | `/pos/ai-checkout-upsell/checkout/{checkoutId}/addons/{addOnId}/add` | session | pos.ai_checkout_upsell.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/ai-checkout-upsell/ai-checkout-upsell.controller.ts |
| GET | `/pos/ai-checkout-upsell/checkout/{checkoutId}/context` | session | pos.ai_checkout_upsell.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/ai-checkout-upsell/ai-checkout-upsell.controller.ts |
| POST | `/pos/ai-checkout-upsell/checkout/{checkoutId}/dismiss` | session | pos.ai_checkout_upsell.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/ai-checkout-upsell/ai-checkout-upsell.controller.ts |
| POST | `/pos/ai-checkout-upsell/checkout/{checkoutId}/feedback` | session | pos.ai_checkout_upsell.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/ai-checkout-upsell/ai-checkout-upsell.controller.ts |
| POST | `/pos/ai-checkout-upsell/checkout/{checkoutId}/loyalty/{rewardId}/redeem` | session | pos.ai_checkout_upsell.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/ai-checkout-upsell/ai-checkout-upsell.controller.ts |
| POST | `/pos/ai-checkout-upsell/checkout/{checkoutId}/membership/{planId}/enroll` | session | pos.ai_checkout_upsell.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/ai-checkout-upsell/ai-checkout-upsell.controller.ts |
| POST | `/pos/ai-checkout-upsell/checkout/{checkoutId}/next-appointment/{serviceId}` | session | pos.ai_checkout_upsell.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/ai-checkout-upsell/ai-checkout-upsell.controller.ts |
| POST | `/pos/ai-checkout-upsell/checkout/{checkoutId}/promotions/{promotionId}/apply` | session | pos.ai_checkout_upsell.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/ai-checkout-upsell/ai-checkout-upsell.controller.ts |
| GET | `/pos/ai-checkout-upsell/checkout/{checkoutId}/recommendations` | session | pos.ai_checkout_upsell.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/ai-checkout-upsell/ai-checkout-upsell.controller.ts |
| GET | `/pos/ai-checkout-upsell/settings` | session | pos.ai_checkout_upsell.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/ai-checkout-upsell/ai-checkout-upsell.controller.ts |
| PUT | `/pos/ai-checkout-upsell/settings/{level}` | session | pos.settings.edit | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/ai-checkout-upsell/ai-checkout-upsell.controller.ts |
| GET | `/pos/ai-customer-profile/customers/{id}/branch-preference` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/customers/{id}/call-summary` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/customers/{id}/churn` | session | pos.ai_customer_profile.churn | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/customers/{id}/completeness` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/customers/{id}/copilot-context` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/customers/{id}/inactivity` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/customers/{id}/overview` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/customers/{id}/rebooking` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/customers/{id}/recommendations` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/customers/{id}/service-preferences` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/customers/{id}/technician-preference` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/customers/{id}/timeline` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/customers/{id}/visit-summary` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/duplicates` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| POST | `/pos/ai-customer-profile/duplicates/{groupId}/merge` | session | pos.customers.merge | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/duplicates/{groupId}/preview` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/settings` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| PUT | `/pos/ai-customer-profile/settings/{level}` | session | pos.ai_customer_profile.churn | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/tenant-overview` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| POST | `/pos/ai-customer-profile/tenant-overview/refresh` | session | pos.ai_customer_profile.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-customer-profile/usage` | session | pos.ai_customer_profile.churn | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-customer-profile/ai-customer-profile.controller.ts |
| GET | `/pos/ai-inventory/context` | session | pos.ai_inventory.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-inventory/ai-inventory.controller.ts |
| GET | `/pos/ai-inventory/low-stock` | session | pos.ai_inventory.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-inventory/ai-inventory.controller.ts |
| GET | `/pos/ai-inventory/positions` | session | pos.ai_inventory.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-inventory/ai-inventory.controller.ts |
| GET | `/pos/ai-inventory/positions/{productId}` | session | pos.ai_inventory.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-inventory/ai-inventory.controller.ts |
| GET | `/pos/ai-inventory/recipes` | session | pos.ai_inventory.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-inventory/ai-inventory.controller.ts |
| POST | `/pos/ai-inventory/recipes` | session | ai_inventory.manage_recipes | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-inventory/ai-inventory.controller.ts |
| GET | `/pos/ai-inventory/recipes/{id}` | session | pos.ai_inventory.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-inventory/ai-inventory.controller.ts |
| POST | `/pos/ai-inventory/recipes/{id}/approve` | session | ai_inventory.manage_recipes | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-inventory/ai-inventory.controller.ts |
| POST | `/pos/ai-inventory/recipes/{id}/archive` | session | ai_inventory.manage_recipes | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-inventory/ai-inventory.controller.ts |
| GET | `/pos/ai-inventory/reorder-recommendations` | session | pos.ai_inventory.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-inventory/ai-inventory.controller.ts |
| GET | `/pos/ai-inventory/slow-moving` | session | pos.ai_inventory.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-inventory/ai-inventory.controller.ts |
| POST | `/pos/ai-marketing/audience/preview` | session | pos.marketing.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-marketing/ai-marketing.controller.ts |
| POST | `/pos/ai-marketing/campaigns` | session | pos.marketing.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-marketing/ai-marketing.controller.ts |
| POST | `/pos/ai-marketing/campaigns/{id}/approve` | session | pos.marketing.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-marketing/ai-marketing.controller.ts |
| POST | `/pos/ai-marketing/campaigns/{id}/cancel` | session | pos.marketing.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-marketing/ai-marketing.controller.ts |
| GET | `/pos/ai-marketing/campaigns/{id}/results` | session | pos.marketing.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-marketing/ai-marketing.controller.ts |
| POST | `/pos/ai-marketing/content/draft` | session | pos.marketing.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-marketing/ai-marketing.controller.ts |
| GET | `/pos/ai-marketing/state` | session | pos.marketing.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-marketing/ai-marketing.controller.ts |
| GET | `/pos/ai-money-protection/alerts` | session | ai_money_protection.view_alerts | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-money-protection/ai-money-protection.controller.ts |
| POST | `/pos/ai-money-protection/alerts/{id}/explain` | session | ai_money_protection.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-money-protection/ai-money-protection.controller.ts |
| POST | `/pos/ai-money-protection/evaluate` | session | ai_money_protection.manage_rules | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-money-protection/ai-money-protection.controller.ts |
| GET | `/pos/ai-money-protection/investigations` | session | ai_money_protection.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-money-protection/ai-money-protection.controller.ts |
| POST | `/pos/ai-money-protection/investigations` | session | ai_money_protection.investigate | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-money-protection/ai-money-protection.controller.ts |
| GET | `/pos/ai-money-protection/investigations/{id}` | session | ai_money_protection.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-money-protection/ai-money-protection.controller.ts |
| POST | `/pos/ai-money-protection/investigations/{id}/assign` | session | ai_money_protection.investigate | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-money-protection/ai-money-protection.controller.ts |
| POST | `/pos/ai-money-protection/investigations/{id}/notes` | session | ai_money_protection.investigate | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-money-protection/ai-money-protection.controller.ts |
| POST | `/pos/ai-money-protection/investigations/{id}/resolve` | session | ai_money_protection.resolve | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-money-protection/ai-money-protection.controller.ts |
| POST | `/pos/ai-money-protection/investigations/{id}/status` | session | ai_money_protection.investigate | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-money-protection/ai-money-protection.controller.ts |
| GET | `/pos/ai-money-protection/rules` | session | ai_money_protection.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-money-protection/ai-money-protection.controller.ts |
| GET | `/pos/ai-money-protection/settings` | session | ai_money_protection.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-money-protection/ai-money-protection.controller.ts |
| POST | `/pos/ai-money-protection/settings/{ruleId}` | session | ai_money_protection.manage_settings | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-money-protection/ai-money-protection.controller.ts |
| GET | `/pos/ai-money-protection/state` | session | ai_money_protection.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-money-protection/ai-money-protection.controller.ts |
| GET | `/pos/ai-ocr-receipt/documents` | session | pos.ai_ocr_receipt.view | ai | RolePermissionGuard + TenantAuthGuard | modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts |
| GET | `/pos/ai-ocr-receipt/documents/{id}` | session | pos.ai_ocr_receipt.view | ai | RolePermissionGuard + TenantAuthGuard | modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts |
| POST | `/pos/ai-ocr-receipt/documents/{id}/approve` | session | pos.ai_ocr_receipt.approve | ai | RolePermissionGuard + TenantAuthGuard | modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts |
| POST | `/pos/ai-ocr-receipt/documents/{id}/correct-field` | session | pos.ai_ocr_receipt.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts |
| POST | `/pos/ai-ocr-receipt/documents/{id}/extract` | session | pos.ai_ocr_receipt.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts |
| POST | `/pos/ai-ocr-receipt/documents/{id}/post` | session | pos.ai_ocr_receipt.post | ai | RolePermissionGuard + TenantAuthGuard | modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts |
| GET | `/pos/ai-ocr-receipt/documents/{id}/preview-url` | session | pos.ai_ocr_receipt.view | ai | RolePermissionGuard + TenantAuthGuard | modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts |
| POST | `/pos/ai-ocr-receipt/documents/{id}/reject` | session | pos.ai_ocr_receipt.approve | ai | RolePermissionGuard + TenantAuthGuard | modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts |
| POST | `/pos/ai-ocr-receipt/documents/{id}/rescan` | session | pos.ai_ocr_receipt.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts |
| POST | `/pos/ai-ocr-receipt/documents/{id}/return` | session | pos.ai_ocr_receipt.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts |
| POST | `/pos/ai-ocr-receipt/documents/{id}/start-review` | session | pos.ai_ocr_receipt.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts |
| GET | `/pos/ai-ocr-receipt/settings` | session | pos.ai_ocr_receipt.view | ai | RolePermissionGuard + TenantAuthGuard | modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts |
| PUT | `/pos/ai-ocr-receipt/settings` | session | pos.ai_ocr_receipt.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts |
| POST | `/pos/ai-ocr-receipt/upload` | session | pos.ai_ocr_receipt.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.controller.ts |
| GET | `/pos/ai-queue-assignment/alerts` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.controller.ts |
| POST | `/pos/ai-queue-assignment/alerts/{id}/acknowledge` | session | ai_queue_assignment.resolve_alerts | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.controller.ts |
| POST | `/pos/ai-queue-assignment/alerts/{id}/repair` | session | ai_queue_assignment.resolve_alerts | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.controller.ts |
| POST | `/pos/ai-queue-assignment/alerts/{id}/resolve` | session | ai_queue_assignment.resolve_alerts | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.controller.ts |
| POST | `/pos/ai-queue-assignment/alerts/scan` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.controller.ts |
| GET | `/pos/ai-queue-assignment/analytics` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.controller.ts |
| GET | `/pos/ai-queue-assignment/auto-config` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| PUT | `/pos/ai-queue-assignment/auto-config` | session | ai_queue_assignment.manage_auto | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| POST | `/pos/ai-queue-assignment/auto/kill` | session | ai_queue_assignment.manage_auto | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| POST | `/pos/ai-queue-assignment/auto/run` | session | ai_queue_assignment.manage_auto | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| POST | `/pos/ai-queue-assignment/auto/unkill` | session | ai_queue_assignment.manage_auto | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| GET | `/pos/ai-queue-assignment/decisions` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| GET | `/pos/ai-queue-assignment/decisions/analytics` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| GET | `/pos/ai-queue-assignment/entries/{queueEntryId}/decisions` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| GET | `/pos/ai-queue-assignment/entries/{queueEntryId}/panel` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| POST | `/pos/ai-queue-assignment/entries/{queueEntryId}/plan` | session | ai_queue_assignment.recommend | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| POST | `/pos/ai-queue-assignment/entries/{queueEntryId}/recommend` | session | ai_queue_assignment.recommend | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| GET | `/pos/ai-queue-assignment/entries/{queueEntryId}/recommendation` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| GET | `/pos/ai-queue-assignment/export` | session | ai_queue_assignment.export | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.controller.ts |
| POST | `/pos/ai-queue-assignment/fair-turn/simulate` | session | turn_queue.read | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| POST | `/pos/ai-queue-assignment/groups/{groupId}/plan` | session | ai_queue_assignment.recommend | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| GET | `/pos/ai-queue-assignment/overview` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.controller.ts |
| POST | `/pos/ai-queue-assignment/plans/{recommendationId}/decision` | session | ai_queue_assignment.assign | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| GET | `/pos/ai-queue-assignment/recommendations/{id}` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| POST | `/pos/ai-queue-assignment/recommendations/{id}/decision` | session | ai_queue_assignment.assign | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| GET | `/pos/ai-queue-assignment/recommendations/{id}/explanation` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| GET | `/pos/ai-queue-assignment/rotation-policy` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| PUT | `/pos/ai-queue-assignment/rotation-policy` | session | ai_queue_assignment.manage_rules | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment.controller.ts |
| GET | `/pos/ai-queue-assignment/settings` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.controller.ts |
| PUT | `/pos/ai-queue-assignment/settings` | session | ai_queue_assignment.manage_rules | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.controller.ts |
| GET | `/pos/ai-queue-assignment/settings/versions` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.controller.ts |
| GET | `/pos/ai-queue-assignment/usage` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.controller.ts |
| GET | `/pos/ai-queue-assignment/wait-thresholds` | session | ai_queue_assignment.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.controller.ts |
| PUT | `/pos/ai-queue-assignment/wait-thresholds` | session | ai_queue_assignment.manage_rules | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.controller.ts |
| GET | `/pos/ai-review-reputation/{id}` | session | pos.ai_review_reputation.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| POST | `/pos/ai-review-reputation/{id}/approve` | session | pos.ai_review_reputation.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| POST | `/pos/ai-review-reputation/{id}/draft` | session | pos.ai_review_reputation.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| POST | `/pos/ai-review-reputation/{id}/notes` | session | pos.ai_review_reputation.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| POST | `/pos/ai-review-reputation/{id}/publish` | session | pos.ai_review_reputation.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| POST | `/pos/ai-review-reputation/{id}/recovery` | session | pos.ai_review_reputation.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| POST | `/pos/ai-review-reputation/{id}/reject` | session | pos.ai_review_reputation.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| POST | `/pos/ai-review-reputation/{id}/request-approval` | session | pos.ai_review_reputation.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| GET | `/pos/ai-review-reputation/analytics` | session | pos.ai_review_reputation.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| GET | `/pos/ai-review-reputation/branch-comparison` | session | pos.ai_review_reputation.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| POST | `/pos/ai-review-reputation/escalations/{id}/acknowledge` | session | pos.ai_review_reputation.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| POST | `/pos/ai-review-reputation/escalations/{id}/assign` | session | pos.ai_review_reputation.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| POST | `/pos/ai-review-reputation/escalations/{id}/resolve` | session | pos.ai_review_reputation.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| GET | `/pos/ai-review-reputation/escalations/urgent` | session | pos.ai_review_reputation.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| GET | `/pos/ai-review-reputation/inbox` | session | pos.ai_review_reputation.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| GET | `/pos/ai-review-reputation/integration-status` | session | pos.ai_review_reputation.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| GET | `/pos/ai-review-reputation/settings` | session | pos.ai_review_reputation.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| PUT | `/pos/ai-review-reputation/settings` | session | pos.ai_review_reputation.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| POST | `/pos/ai-review-reputation/sync` | session | pos.ai_review_reputation.manage | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-review-reputation/ai-review-reputation.controller.ts |
| GET | `/pos/ai-scheduling-optimizer/calendar` | session | ai_scheduling.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| GET | `/pos/ai-scheduling-optimizer/export` | session | ai_scheduling.export | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling-ops.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/holds/{holdId}/release` | session | ai_scheduling.generate | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| GET | `/pos/ai-scheduling-optimizer/insights` | session | ai_scheduling.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling-ops.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/insights/{kind}/{id}/approve` | session | ai_scheduling.approve | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling-ops.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/insights/{kind}/{id}/reject` | session | ai_scheduling.approve | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling-ops.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/insights/refresh` | session | ai_scheduling.approve | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling-ops.controller.ts |
| GET | `/pos/ai-scheduling-optimizer/locks` | session | ai_scheduling.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| DELETE | `/pos/ai-scheduling-optimizer/locks/{appointmentId}` | session | ai_scheduling.review | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| PUT | `/pos/ai-scheduling-optimizer/locks/{appointmentId}` | session | ai_scheduling.review | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/options` | session | ai_scheduling.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| GET | `/pos/ai-scheduling-optimizer/recommendations` | session | ai_scheduling.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| GET | `/pos/ai-scheduling-optimizer/recommendations/{id}` | session | ai_scheduling.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/recommendations/{id}/accept` | session | ai_scheduling.review | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/recommendations/{id}/apply` | session | ai_scheduling.apply | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/recommendations/{id}/customer-decision` | session | ai_scheduling.review | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/recommendations/{id}/explain` | session | ai_scheduling.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/recommendations/{id}/proposal/resend` | session | ai_scheduling.review | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/recommendations/{id}/reject` | session | ai_scheduling.review | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/recommendations/{id}/retry` | session | ai_scheduling.apply | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/recommendations/{id}/return` | session | ai_scheduling.review | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/recommendations/{id}/rollback` | session | ai_scheduling.apply | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/recommendations/generate` | session | ai_scheduling.generate | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| GET | `/pos/ai-scheduling-optimizer/recommendations/own` | session | ai_scheduling.view_own | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| GET | `/pos/ai-scheduling-optimizer/runs` | session | ai_scheduling.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/runs` | session | ai_scheduling.generate | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| GET | `/pos/ai-scheduling-optimizer/runs/{id}` | session | ai_scheduling.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| GET | `/pos/ai-scheduling-optimizer/service-profiles` | session | ai_scheduling.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| PUT | `/pos/ai-scheduling-optimizer/service-profiles/{serviceId}` | session | ai_scheduling.configure | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| GET | `/pos/ai-scheduling-optimizer/settings` | session | ai_scheduling.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| PUT | `/pos/ai-scheduling-optimizer/settings` | session | ai_scheduling.configure | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| GET | `/pos/ai-scheduling-optimizer/settings/versions` | session | ai_scheduling.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| GET | `/pos/ai-scheduling-optimizer/time-off` | session | ai_scheduling.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| POST | `/pos/ai-scheduling-optimizer/time-off` | session | technicians.edit | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| DELETE | `/pos/ai-scheduling-optimizer/time-off/{id}` | session | technicians.edit | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling.controller.ts |
| GET | `/pos/ai-scheduling-optimizer/usage` | session | ai_scheduling.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling-ops.controller.ts |
| POST | `/pos/ai-voice-transcription/consent` | session | ai_voice_transcription.manage_settings | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| POST | `/pos/ai-voice-transcription/ingest` | session | ai_voice_transcription.manage_rules | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| GET | `/pos/ai-voice-transcription/overview` | session | ai_voice_transcription.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| GET | `/pos/ai-voice-transcription/settings` | session | ai_voice_transcription.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| PUT | `/pos/ai-voice-transcription/settings` | session | ai_voice_transcription.manage_settings | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| GET | `/pos/ai-voice-transcription/transcripts` | session | ai_voice_transcription.view_transcripts | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| DELETE | `/pos/ai-voice-transcription/transcripts/{id}` | session | ai_voice_transcription.delete | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| GET | `/pos/ai-voice-transcription/transcripts/{id}` | session | ai_voice_transcription.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| GET | `/pos/ai-voice-transcription/transcripts/{id}/intelligence` | session | ai_voice_transcription.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| POST | `/pos/ai-voice-transcription/transcripts/{id}/legal-hold` | session | ai_voice_transcription.manage_settings | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| GET | `/pos/ai-voice-transcription/transcripts/{id}/raw` | session | ai_voice_transcription.view_raw | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| POST | `/pos/ai-voice-transcription/transcripts/{id}/summary` | session | ai_voice_transcription.view | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| GET | `/pos/ai-voice-transcription/transcripts/search` | session | ai_voice_transcription.view_transcripts | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| GET | `/pos/ai-voice-transcription/unresolved` | session | ai_voice_transcription.view_transcripts | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| GET | `/pos/api-keys` | session | pos.api_keys.view | operations | RolePermissionGuard + TenantAuthGuard | api-webhooks/api-webhooks.controller.ts |
| POST | `/pos/api-keys` | session | pos.api_keys.manage | operations | RolePermissionGuard + TenantAuthGuard | api-webhooks/api-webhooks.controller.ts |
| POST | `/pos/api-keys/{id}/revoke` | session | pos.api_keys.manage | operations | RolePermissionGuard + TenantAuthGuard | api-webhooks/api-webhooks.controller.ts |
| POST | `/pos/api-keys/{id}/rotate` | session | pos.api_keys.manage | operations | RolePermissionGuard + TenantAuthGuard | api-webhooks/api-webhooks.controller.ts |
| GET | `/pos/approvals` | session | approvals.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/approvals/approvals.controller.ts |
| POST | `/pos/approvals` | session | approvals.request | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/approvals/approvals.controller.ts |
| GET | `/pos/approvals/{id}` | session | approvals.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/approvals/approvals.controller.ts |
| POST | `/pos/approvals/{id}/cancel` | session | approvals.request | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/approvals/approvals.controller.ts |
| POST | `/pos/approvals/{id}/decide` | session | approvals.decide | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/approvals/approvals.controller.ts |
| GET | `/pos/approvals/policies` | session | approvals.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/approvals/approvals.controller.ts |
| PUT | `/pos/approvals/policies` | session | approvals.manage_policies | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/approvals/approvals.controller.ts |
| GET | `/pos/audit/events` | session | audit.view | audit | RolePermissionGuard + TenantAuthGuard | modules/audit/src/audit.controller.ts |
| GET | `/pos/booking/appointments` | session | pos.booking.view | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| POST | `/pos/booking/appointments` | session | pos.booking.create | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| GET | `/pos/booking/appointments/{appointmentId}` | session | pos.booking.view | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| PATCH | `/pos/booking/appointments/{appointmentId}` | session | pos.booking.edit | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| POST | `/pos/booking/appointments/{appointmentId}/arrived` | session | pos.booking.check_in | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| POST | `/pos/booking/appointments/{appointmentId}/assign-technician` | session | pos.booking.assign_technician | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| POST | `/pos/booking/appointments/{appointmentId}/cancel` | session | pos.booking.cancel | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| POST | `/pos/booking/appointments/{appointmentId}/check-in` | session | pos.booking.check_in | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| POST | `/pos/booking/appointments/{appointmentId}/move-to-queue` | session | pos.queue.create | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| POST | `/pos/booking/appointments/{appointmentId}/move-to-tech-queue` | session | pos.tech_queue.create | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| POST | `/pos/booking/appointments/{appointmentId}/no-show` | session | pos.booking.no_show | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| POST | `/pos/booking/appointments/{appointmentId}/reschedule` | session | pos.booking.reschedule | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| POST | `/pos/booking/appointments/{appointmentId}/start-service` | session | pos.serving.start | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| GET | `/pos/booking/availability` | session | pos.booking.view | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| POST | `/pos/booking/blocked-times` | session | pos.booking.edit | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| DELETE | `/pos/booking/blocked-times/{blockId}` | session | pos.booking.edit | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| GET | `/pos/booking/changes` | session | pos.booking.view | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| POST | `/pos/booking/conflicts/check` | session | pos.booking.view | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| GET | `/pos/booking/day-grid` | session | pos.booking.view | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| GET | `/pos/booking/drafts` | session | pos.booking.view | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking-drafts.controller.ts |
| POST | `/pos/booking/drafts` | session | pos.booking.create | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking-drafts.controller.ts |
| DELETE | `/pos/booking/drafts/{draftId}` | session | pos.booking.create | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking-drafts.controller.ts |
| GET | `/pos/booking/drafts/{draftId}` | session | pos.booking.view | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking-drafts.controller.ts |
| POST | `/pos/booking/drafts/{draftId}/converted` | session | pos.booking.create | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking-drafts.controller.ts |
| GET | `/pos/booking/integration-status` | session | pos.booking.view | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| GET | `/pos/booking/kpis` | session | pos.booking.view | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| GET | `/pos/booking/permissions` | session | pos.booking.view | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| GET | `/pos/booking/state` | session | pos.booking.view | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/booking/booking.controller.ts |
| POST | `/pos/booking/verification-override` | session | pos.booking.override_verification | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-booking/booking-verification-override.controller.ts |
| GET | `/pos/booking/verification-override/pending` | session | pos.booking.verification_pending | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-booking/booking-verification-override.controller.ts |
| GET | `/pos/bundles` | session | pos.bundles.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/bundles/bundles.controller.ts |
| POST | `/pos/bundles` | session | pos.bundles.create | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/bundles/bundles.controller.ts |
| GET | `/pos/bundles/{bundleId}` | session | pos.bundles.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/bundles/bundles.controller.ts |
| PATCH | `/pos/bundles/{bundleId}` | session | pos.bundles.edit | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/bundles/bundles.controller.ts |
| POST | `/pos/bundles/{bundleId}/archive` | session | pos.bundles.archive | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/bundles/bundles.controller.ts |
| POST | `/pos/bundles/{bundleId}/reactivate` | session | pos.bundles.archive | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/bundles/bundles.controller.ts |
| GET | `/pos/bundles/kpis` | session | pos.bundles.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/bundles/bundles.controller.ts |
| GET | `/pos/bundles/state` | session | pos.bundles.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/bundles/bundles.controller.ts |
| GET | `/pos/campaigns` | session | pos.marketing.view | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| POST | `/pos/campaigns` | session | pos.marketing.manage | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/pos/campaigns/{id}` | session | pos.marketing.view | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| PATCH | `/pos/campaigns/{id}` | session | pos.marketing.manage | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| POST | `/pos/campaigns/{id}/activate` | session | pos.marketing.manage | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| POST | `/pos/campaigns/{id}/cancel` | session | pos.marketing.manage | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| POST | `/pos/campaigns/{id}/complete` | session | pos.marketing.manage | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/pos/campaigns/{id}/cost-preview` | session | pos.marketing.view | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| POST | `/pos/campaigns/{id}/schedule` | session | pos.marketing.manage | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/pos/campaigns/state` | session | pos.marketing.view | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/pos/cash-drawer` | session | pos.checkout.view | payments | — | modules/checkout/src/cash-drawer/cash-drawer.pos.controller.ts |
| POST | `/pos/cash-drawer/movement` | session | checkout.process_payment | payments | — | modules/checkout/src/cash-drawer/cash-drawer.pos.controller.ts |
| POST | `/pos/cash-drawer/movement/void` | session | checkout.process_payment | payments | — | modules/checkout/src/cash-drawer/cash-drawer.pos.controller.ts |
| GET | `/pos/cash-drawer/movements` | session | pos.checkout.view | payments | — | modules/checkout/src/cash-drawer/cash-drawer.pos.controller.ts |
| POST | `/pos/cash-drawer/open` | session | checkout.process_payment | payments | — | modules/checkout/src/cash-drawer/cash-drawer.pos.controller.ts |
| POST | `/pos/cash-drawer/reconcile` | session | checkout.process_payment | payments | — | modules/checkout/src/cash-drawer/cash-drawer.pos.controller.ts |
| GET | `/pos/cash-handoffs` | session | pos.checkout.view | payments | — | modules/workforce/src/tech-cash-handoff/tech-cash-handoff.pos.controller.ts |
| GET | `/pos/cash-handoffs/{technicianId}` | session | pos.checkout.view | payments | — | modules/workforce/src/tech-cash-handoff/tech-cash-handoff.pos.controller.ts |
| POST | `/pos/cash-handoffs/{technicianId}/reconcile` | session | checkout.process_payment | payments | — | modules/workforce/src/tech-cash-handoff/tech-cash-handoff.pos.controller.ts |
| GET | `/pos/check-in/{checkInId}` | session | pos.check_in.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| POST | `/pos/check-in/{checkInId}/assign-technician` | session | pos.check_in.assign_technician | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| POST | `/pos/check-in/{checkInId}/cancel` | session | pos.check_in.cancel | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| POST | `/pos/check-in/{checkInId}/move-to-queue` | session | pos.check_in.move_to_queue | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| POST | `/pos/check-in/{checkInId}/move-to-tech-queue` | session | pos.check_in.move_to_tech_queue | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| POST | `/pos/check-in/{checkInId}/start-service` | session | pos.check_in.start_service | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| POST | `/pos/check-in/{checkInId}/update-services` | session | pos.check_in.edit | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| POST | `/pos/check-in/{checkInId}/update-wait-estimate` | session | pos.check_in.edit | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| POST | `/pos/check-in/appointment/{appointmentId}` | session | pos.check_in.appointment | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| GET | `/pos/check-in/appointments-ready` | session | pos.check_in.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| GET | `/pos/check-in/appointments/search` | session | pos.check_in.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| POST | `/pos/check-in/create-customer` | session | pos.customers.create | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| GET | `/pos/check-in/customers/search` | session | pos.customers.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| GET | `/pos/check-in/kpis` | session | pos.check_in.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| GET | `/pos/check-in/recent` | session | pos.check_in.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| GET | `/pos/check-in/state` | session | pos.check_in.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| GET | `/pos/check-in/wait-estimate` | session | pos.check_in.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| POST | `/pos/check-in/walk-in` | session | pos.check_in.walk_in | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/check-in/check-in.controller.ts |
| POST | `/pos/checkout/gift-cards` | session | pos.checkout.gift_card_issue | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| GET | `/pos/checkout/gift-cards/{code}` | session | pos.checkout.gift_card_payment | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/gift-cards/{code}/void` | session | pos.checkout.gift_card_issue | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/gift-cards/lookup` | session | pos.checkout.gift_card_payment | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/gift-cards/replace` | session | pos.checkout.gift_card_payment | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| GET | `/pos/checkout/kpis` | session | pos.checkout.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/payments/{paymentId}/refund` | session | pos.checkout.refund | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/payments/{paymentId}/void` | session | pos.checkout.void | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| GET | `/pos/checkout/settings` | session | pos.checkout.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| GET | `/pos/checkout/skip-line/state` | session | checkout.view | checkout | — | modules/checkout/src/skip-line-checkout/pos-skip-line.controller.ts |
| GET | `/pos/checkout/state` | session | pos.checkout.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| GET | `/pos/checkout/tickets` | session | pos.checkout.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| GET | `/pos/checkout/tickets/{ticketId}` | session | pos.checkout.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/apply-deal` | session | pos.deals.apply | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/apply-discount` | session | pos.checkout.apply_discount | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/apply-promotion` | session | pos.deals.apply | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/apply-tip` | session | pos.checkout.add_tip | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/gift-card-reload` | session | pos.checkout.gift_card_issue | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/gift-card-sale` | session | pos.checkout.gift_card_issue | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/hold` | session | pos.checkout.take_payment | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/move` | session | pos.checkout.take_payment | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| GET | `/pos/checkout/tickets/{ticketId}/offers` | session | pos.checkout.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/offers` | session | pos.deals.apply | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/offers/{redemptionId}/remove` | session | pos.deals.apply | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/offers/best` | session | pos.deals.apply | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/pay/card` | session | pos.checkout.take_payment | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/pay/card/verify` | session | pos.checkout.take_payment | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/pay/cash` | session | pos.checkout.take_payment | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/pay/gift-card` | session | pos.checkout.take_payment | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/pay/split` | session | pos.checkout.take_payment | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/rating` | session | pos.checkout.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/recalculate` | session | pos.checkout.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/receipt/app` | session | pos.receipts.send | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/receipt/email` | session | pos.receipts.send | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/receipt/send-all` | session | pos.receipts.send | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/receipt/sms` | session | pos.receipts.send | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/refund` | session | pos.checkout.refund | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| GET | `/pos/checkout/tickets/{ticketId}/refund-preview` | session | pos.checkout.refund | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/refunds/{refundId}/settle` | session | pos.checkout.refund | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| GET | `/pos/checkout/tickets/{ticketId}/refunds/unsettled` | session | pos.checkout.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/reopen-service` | session | pos.checkout.reopen_service | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/resume` | session | pos.checkout.take_payment | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/review` | session | pos.checkout.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/reward-code` | session | pos.checkout.redeem_reward | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/reward-code/remove` | session | pos.checkout.redeem_reward | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/checkout/tickets/{ticketId}/send-to-customer-display` | session | pos.customer_display.operate | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| GET | `/pos/checkout/tickets/{ticketId}/signature` | session | pos.checkout.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| GET | `/pos/checkout/tickets/{ticketId}/technician-split` | session | pos.checkout.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| GET | `/pos/commission-report/state` | session | pos.reports.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/commission-report/commission-report.controller.ts |
| GET | `/pos/communications/activity` | session | pos.communications.view | communications | RolePermissionGuard + TenantAuthGuard | modules/communications/src/communications/communications.controller.ts |
| GET | `/pos/communications/state` | session | pos.communications.view | communications | RolePermissionGuard + TenantAuthGuard | modules/communications/src/communications/communications.controller.ts |
| POST | `/pos/communications/threads` | session | pos.communications.send | communications | RolePermissionGuard + TenantAuthGuard | modules/communications/src/communications/communications.controller.ts |
| GET | `/pos/communications/threads/{id}` | session | pos.communications.view | communications | RolePermissionGuard + TenantAuthGuard | modules/communications/src/communications/communications.controller.ts |
| POST | `/pos/communications/threads/{id}/assign` | session | pos.communications.manage | communications | RolePermissionGuard + TenantAuthGuard | modules/communications/src/communications/communications.controller.ts |
| POST | `/pos/communications/threads/{id}/read` | session | pos.communications.view | communications | RolePermissionGuard + TenantAuthGuard | modules/communications/src/communications/communications.controller.ts |
| POST | `/pos/communications/threads/{id}/reply` | session | pos.communications.send | communications | RolePermissionGuard + TenantAuthGuard | modules/communications/src/communications/communications.controller.ts |
| POST | `/pos/communications/threads/{id}/status` | session | pos.communications.manage | communications | RolePermissionGuard + TenantAuthGuard | modules/communications/src/communications/communications.controller.ts |
| GET | `/pos/connected-apps` | session | settings.edit | identity | — | oauth/oauth.controller.ts |
| POST | `/pos/connected-apps/{id}/revoke` | session | settings.edit | identity | — | oauth/oauth.controller.ts |
| GET | `/pos/customer-display/devices` | session | pos.customer_display.operate | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/customer-display/sessions` | session | pos.customer_display.operate | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| PATCH | `/pos/customer-display/sessions/{sessionId}` | session | pos.customer_display.operate | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| POST | `/pos/customer-display/sessions/{sessionId}/cancel-terminal` | session | pos.customer_display.operate | operations | RolePermissionGuard + TenantAuthGuard | customer-display/terminal-cancel.controller.ts |
| POST | `/pos/customer-display/sessions/{sessionId}/close` | session | pos.customer_display.operate | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/checkout.controller.ts |
| GET | `/pos/customer-displays` | session | pos.customer_display.operate | operations | RolePermissionGuard + TenantAuthGuard | customer-display/display-devices.controller.ts |
| PATCH | `/pos/customer-displays/{deviceId}` | session | pos.customer_display.manage | operations | RolePermissionGuard + TenantAuthGuard | customer-display/display-devices.controller.ts |
| POST | `/pos/customer-displays/{deviceId}/refresh` | session | pos.customer_display.operate | operations | RolePermissionGuard + TenantAuthGuard | customer-display/display-devices.controller.ts |
| POST | `/pos/customer-displays/{deviceId}/revoke` | session | pos.customer_display.manage | operations | RolePermissionGuard + TenantAuthGuard | customer-display/display-devices.controller.ts |
| POST | `/pos/customer-displays/pair` | session | pos.customer_display.manage | operations | RolePermissionGuard + TenantAuthGuard | customer-display/display-devices.controller.ts |
| POST | `/pos/customer-displays/stations` | session | pos.customer_display.manage | operations | RolePermissionGuard + TenantAuthGuard | customer-display/display-devices.controller.ts |
| DELETE | `/pos/customer-displays/stations/{stationId}` | session | pos.customer_display.manage | operations | RolePermissionGuard + TenantAuthGuard | customer-display/display-devices.controller.ts |
| PATCH | `/pos/customer-displays/stations/{stationId}` | session | pos.customer_display.manage | operations | RolePermissionGuard + TenantAuthGuard | customer-display/display-devices.controller.ts |
| GET | `/pos/customers` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| POST | `/pos/customers` | session | pos.customers.create | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/{customerId}` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| PATCH | `/pos/customers/{customerId}` | session | pos.customers.edit | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/{customerId}/appointments` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| POST | `/pos/customers/{customerId}/archive` | session | pos.customers.archive | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/{customerId}/gift-cards` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/{customerId}/loyalty` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| PATCH | `/pos/customers/{customerId}/loyalty` | session | pos.customers.loyalty.edit | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| POST | `/pos/customers/{customerId}/loyalty-adjust` | session | pos.customers.loyalty.edit | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/{customerId}/loyalty-ledger` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/{customerId}/membership` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| PATCH | `/pos/customers/{customerId}/membership` | session | pos.customers.membership.edit | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/{customerId}/notes` | session | pos.customers.notes.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| PATCH | `/pos/customers/{customerId}/notes` | session | pos.customers.notes.edit | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/{customerId}/payment-methods` | session | pos.customers.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/customer-payments/pos-customer-payments.controller.ts |
| POST | `/pos/customers/{customerId}/phone` | session | pos.customers.edit | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone.controller.ts |
| POST | `/pos/customers/{customerId}/phone/{sessionId}/approve` | session | pos.customers.phone.approve | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone.controller.ts |
| POST | `/pos/customers/{customerId}/phone/{sessionId}/cancel` | session | pos.customers.edit | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone.controller.ts |
| POST | `/pos/customers/{customerId}/phone/{sessionId}/manual-confirm` | session | pos.customers.phone.manual_confirm | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone.controller.ts |
| POST | `/pos/customers/{customerId}/phone/{sessionId}/retry-sync` | session | pos.customers.phone.retry_sync | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone.controller.ts |
| POST | `/pos/customers/{customerId}/phone/{sessionId}/send` | session | pos.customers.edit | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone.controller.ts |
| POST | `/pos/customers/{customerId}/phone/{sessionId}/to-display` | session | pos.customers.edit | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone.controller.ts |
| POST | `/pos/customers/{customerId}/phone/{sessionId}/verify` | session | pos.customers.edit | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone.controller.ts |
| POST | `/pos/customers/{customerId}/phone/resolve` | session | pos.customers.phone.resolve | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone.controller.ts |
| GET | `/pos/customers/{customerId}/phone/status` | session | pos.customers.view | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone.controller.ts |
| POST | `/pos/customers/{customerId}/reactivate` | session | pos.customers.archive | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/{customerId}/receipts` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/{customerId}/tags` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| PATCH | `/pos/customers/{customerId}/tags` | session | pos.customers.edit | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/{customerId}/tickets` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/{customerId}/visits` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/duplicates` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| POST | `/pos/customers/duplicates/{duplicateGroupId}/decision` | session | pos.customers.merge | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| POST | `/pos/customers/duplicates/{duplicateGroupId}/merge` | session | pos.customers.merge | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/export` | session | pos.customers.export | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| POST | `/pos/customers/import` | session | pos.customers.import | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| POST | `/pos/customers/import/commit` | session | pos.customers.import | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| POST | `/pos/customers/import/preview` | session | pos.customers.import | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/kpis` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/search` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/customers/state` | session | pos.customers.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/customers/customers.controller.ts |
| GET | `/pos/dashboard/alerts` | session | pos.dashboard.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/dashboard/dashboard.controller.ts |
| GET | `/pos/dashboard/appointments` | session | pos.dashboard.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/dashboard/dashboard.controller.ts |
| GET | `/pos/dashboard/checkout` | session | pos.dashboard.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/dashboard/dashboard.controller.ts |
| GET | `/pos/dashboard/customers` | session | pos.dashboard.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/dashboard/dashboard.controller.ts |
| GET | `/pos/dashboard/insights` | session | pos.dashboard.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/dashboard/dashboard.controller.ts |
| GET | `/pos/dashboard/kpis` | session | pos.dashboard.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/dashboard/dashboard.controller.ts |
| GET | `/pos/dashboard/operations` | session | pos.dashboard.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/dashboard/dashboard.controller.ts |
| GET | `/pos/dashboard/payment-mix` | session | pos.dashboard.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/dashboard/dashboard.controller.ts |
| GET | `/pos/dashboard/queue` | session | pos.dashboard.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/dashboard/dashboard.controller.ts |
| GET | `/pos/dashboard/revenue-trend` | session | pos.dashboard.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/dashboard/dashboard.controller.ts |
| GET | `/pos/dashboard/serving` | session | pos.dashboard.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/dashboard/dashboard.controller.ts |
| GET | `/pos/dashboard/state` | session | pos.dashboard.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/dashboard/dashboard.controller.ts |
| GET | `/pos/dashboard/top-services` | session | pos.dashboard.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/dashboard/dashboard.controller.ts |
| GET | `/pos/dashboard/top-technicians` | session | pos.dashboard.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/dashboard/dashboard.controller.ts |
| GET | `/pos/deals` | session | pos.marketing.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| POST | `/pos/deals` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| GET | `/pos/deals/{id}` | session | pos.marketing.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| PATCH | `/pos/deals/{id}` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| POST | `/pos/deals/{id}/approve` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| POST | `/pos/deals/{id}/archive` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| POST | `/pos/deals/{id}/cancel` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| GET | `/pos/deals/{id}/coupons` | session | pos.marketing.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| POST | `/pos/deals/{id}/coupons/{codeId}/revoke` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| POST | `/pos/deals/{id}/coupons/generate` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| POST | `/pos/deals/{id}/pause` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| POST | `/pos/deals/{id}/publish` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| POST | `/pos/deals/{id}/reject` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| POST | `/pos/deals/{id}/resume` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| POST | `/pos/deals/{id}/submit` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| GET | `/pos/deals/{id}/versions` | session | pos.marketing.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| GET | `/pos/deals/analytics` | session | pos.marketing.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| GET | `/pos/deals/dashboard` | session | pos.marketing.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| GET | `/pos/deals/export` | session | pos.marketing.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| POST | `/pos/deals/preview` | session | pos.marketing.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| GET | `/pos/deals/settings` | session | pos.marketing.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| PATCH | `/pos/deals/settings` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/deals/deals.controller.ts |
| GET | `/pos/deployments` | session | pos.deployments.view | operations | RolePermissionGuard + TenantAuthGuard | deployments/deployments.controller.ts |
| POST | `/pos/deployments` | session | pos.deployments.manage | operations | RolePermissionGuard + TenantAuthGuard | deployments/deployments.controller.ts |
| POST | `/pos/deployments/{id}/advance` | session | pos.deployments.manage | operations | RolePermissionGuard + TenantAuthGuard | deployments/deployments.controller.ts |
| GET | `/pos/deposit-reconciliation/adjustments` | session | reconciliation.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| GET | `/pos/deposit-reconciliation/bank-accounts` | session | reconciliation.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| POST | `/pos/deposit-reconciliation/bank-accounts` | session | reconciliation.manage | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| GET | `/pos/deposit-reconciliation/deposits` | session | reconciliation.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| POST | `/pos/deposit-reconciliation/deposits` | session | reconciliation.manage | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| POST | `/pos/deposit-reconciliation/deposits/{id}/link` | session | reconciliation.manage | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| GET | `/pos/deposit-reconciliation/duplicates` | session | reconciliation.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| GET | `/pos/deposit-reconciliation/exceptions` | session | reconciliation.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| POST | `/pos/deposit-reconciliation/exceptions` | session | reconciliation.manage | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| POST | `/pos/deposit-reconciliation/exceptions/{id}/assign` | session | reconciliation.manage | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| POST | `/pos/deposit-reconciliation/exceptions/{id}/reopen` | session | reconciliation.manage | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| POST | `/pos/deposit-reconciliation/exceptions/{id}/resolve` | session | reconciliation.approve | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| POST | `/pos/deposit-reconciliation/exceptions/{id}/transition` | session | reconciliation.manage | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| POST | `/pos/deposit-reconciliation/explain/settlement/{id}` | session | reconciliation.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| GET | `/pos/deposit-reconciliation/fee-reconciliation` | session | reconciliation.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| GET | `/pos/deposit-reconciliation/fee-schedules` | session | reconciliation.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| POST | `/pos/deposit-reconciliation/fee-schedules` | session | reconciliation.manage | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| GET | `/pos/deposit-reconciliation/periods` | session | reconciliation.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| POST | `/pos/deposit-reconciliation/periods` | session | reconciliation.manage | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| GET | `/pos/deposit-reconciliation/periods/{id}/check-close` | session | reconciliation.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| POST | `/pos/deposit-reconciliation/periods/{id}/close` | session | reconciliation.approve | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| POST | `/pos/deposit-reconciliation/periods/{id}/reopen` | session | reconciliation.manage | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| GET | `/pos/deposit-reconciliation/reports/daily` | session | reconciliation.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| GET | `/pos/deposit-reconciliation/reports/daily/export` | session | reconciliation.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| GET | `/pos/deposit-reconciliation/reports/summary` | session | reconciliation.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| POST | `/pos/deposit-reconciliation/rescan` | session | reconciliation.manage | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| GET | `/pos/deposit-reconciliation/state` | session | reconciliation.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/deposit-reconciliation/deposit-reconciliation.controller.ts |
| GET | `/pos/devices/overview` | session | pos.devices.view | operations | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/devices/devices.controller.ts |
| GET | `/pos/follow-ups` | session | customers.edit | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/end-of-day-followups/end-of-day-followups.pos.controller.ts |
| POST | `/pos/follow-ups/{id}/approve` | session | customers.edit | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/end-of-day-followups/end-of-day-followups.pos.controller.ts |
| POST | `/pos/follow-ups/{id}/send` | session | customers.edit | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/end-of-day-followups/end-of-day-followups.pos.controller.ts |
| POST | `/pos/follow-ups/{id}/skip` | session | customers.edit | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/end-of-day-followups/end-of-day-followups.pos.controller.ts |
| GET | `/pos/follow-ups/daily` | session | customers.edit | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/end-of-day-followups/end-of-day-followups.pos.controller.ts |
| POST | `/pos/follow-ups/generate-daily` | session | customers.edit | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/end-of-day-followups/end-of-day-followups.pos.controller.ts |
| POST | `/pos/follow-ups/generate-now` | session | customers.edit | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/end-of-day-followups/end-of-day-followups.pos.controller.ts |
| GET | `/pos/follow-ups/settings` | session | customers.edit | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/end-of-day-followups/end-of-day-followups.pos.controller.ts |
| PATCH | `/pos/follow-ups/settings` | session | customers.edit | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/end-of-day-followups/end-of-day-followups.pos.controller.ts |
| GET | `/pos/follow-ups/technicians/{technicianId}` | session | customers.edit | marketing | RolePermissionGuard + TenantAuthGuard | modules/communications/src/end-of-day-followups/end-of-day-followups.pos.controller.ts |
| GET | `/pos/gift-cards/liability` | session | pos.reports.view | payments | RolePermissionGuard + TenantAuthGuard | modules/gift-cards/src/gift-cards/gift-cards.controller.ts |
| GET | `/pos/gift-cards/state` | session | pos.checkout.view | payments | RolePermissionGuard + TenantAuthGuard | modules/gift-cards/src/gift-cards/gift-cards.controller.ts |
| GET | `/pos/gift-cards/stock` | session | pos.checkout.gift_card_issue | payments | RolePermissionGuard + TenantAuthGuard | modules/gift-cards/src/gift-card-stock/gift-card-stock.controller.ts |
| POST | `/pos/gift-cards/stock/{id}/void` | session | pos.checkout.gift_card_issue | payments | RolePermissionGuard + TenantAuthGuard | modules/gift-cards/src/gift-card-stock/gift-card-stock.controller.ts |
| POST | `/pos/gift-cards/stock/register` | session | pos.checkout.gift_card_issue | payments | RolePermissionGuard + TenantAuthGuard | modules/gift-cards/src/gift-card-stock/gift-card-stock.controller.ts |
| POST | `/pos/invoices` | session | pos.checkout.process_payment | finance | RolePermissionGuard + TenantAuthGuard | modules/payments/src/invoices/invoices.controller.ts |
| GET | `/pos/invoices/{id}` | session | pos.checkout.view | finance | RolePermissionGuard + TenantAuthGuard | modules/payments/src/invoices/invoices.controller.ts |
| POST | `/pos/invoices/{id}/status` | session | pos.checkout.process_payment | finance | RolePermissionGuard + TenantAuthGuard | modules/payments/src/invoices/invoices.controller.ts |
| GET | `/pos/invoices/state` | session | pos.checkout.view | finance | RolePermissionGuard + TenantAuthGuard | modules/payments/src/invoices/invoices.controller.ts |
| GET | `/pos/logs` | session | pos.logs.view | operations | RolePermissionGuard + TenantAuthGuard | logs/logs.controller.ts |
| POST | `/pos/loyalty/rewards` | session | pos.settings.edit | loyalty | RolePermissionGuard + TenantAuthGuard | modules/loyalty/src/loyalty.controller.ts |
| PATCH | `/pos/loyalty/rewards/{rewardId}` | session | pos.settings.edit | loyalty | RolePermissionGuard + TenantAuthGuard | modules/loyalty/src/loyalty.controller.ts |
| GET | `/pos/loyalty/state` | session | pos.customers.view | loyalty | RolePermissionGuard + TenantAuthGuard | modules/loyalty/src/loyalty.controller.ts |
| GET | `/pos/marketing-report/state` | session | pos.marketing.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/marketing-report/marketing-report.controller.ts |
| POST | `/pos/marketing/display-ads` | session | pos.customer_display_ads.create | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| DELETE | `/pos/marketing/display-ads/{id}` | session | pos.customer_display_ads.archive | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| GET | `/pos/marketing/display-ads/{id}` | session | pos.customer_display_ads.view | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| PATCH | `/pos/marketing/display-ads/{id}` | session | pos.customer_display_ads.update | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| POST | `/pos/marketing/display-ads/{id}/archive` | session | pos.customer_display_ads.archive | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| POST | `/pos/marketing/display-ads/{id}/pause` | session | pos.customer_display_ads.pause | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| POST | `/pos/marketing/display-ads/{id}/publish` | session | pos.customer_display_ads.publish | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| POST | `/pos/marketing/display-ads/{id}/restore` | session | pos.customer_display_ads.update | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| GET | `/pos/marketing/display-ads/analytics` | session | pos.customer_display_ads.view | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| GET | `/pos/marketing/display-ads/branches/{branchId}/analytics` | session | pos.customer_display_ads.view | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| GET | `/pos/marketing/display-ads/branches/{branchId}/playlist` | session | pos.customer_display_ads.view | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| PATCH | `/pos/marketing/display-ads/branches/{branchId}/settings` | session | pos.customer_display_ads.update | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| PATCH | `/pos/marketing/display-ads/devices/{deviceId}` | session | pos.customer_display_ads.update | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| POST | `/pos/marketing/display-ads/media` | session | pos.customer_display_ads.create | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| PATCH | `/pos/marketing/display-ads/settings` | session | pos.customer_display_ads.update | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| GET | `/pos/marketing/display-ads/state` | session | pos.customer_display_ads.view | marketing | RolePermissionGuard + TenantAuthGuard | modules/marketing/src/display-advertising/display-ads.controller.ts |
| DELETE | `/pos/me/avatar` | session | self.profile.edit | identity | TenantAuthGuard | profile/profile.controller.ts |
| PATCH | `/pos/me/avatar` | session | self.profile.edit | identity | TenantAuthGuard | profile/profile.controller.ts |
| GET | `/pos/me/backup` | session | settings.view | identity | TenantAuthGuard | profile/profile.controller.ts |
| POST | `/pos/me/backup/run` | session | settings.edit | identity | TenantAuthGuard | profile/profile.controller.ts |
| GET | `/pos/me/billing` | session | settings.view | identity | TenantAuthGuard | profile/profile.controller.ts |
| PUT | `/pos/me/language` | session | self.profile.edit | identity | — | account/language.controller.ts |
| GET | `/pos/me/locale` | session | self.profile.view | identity | — | account/language.controller.ts |
| GET | `/pos/me/login-alerts` | session | self.profile.view | identity | TenantAuthGuard | profile/profile.controller.ts |
| PATCH | `/pos/me/login-alerts` | session | self.profile.edit | identity | TenantAuthGuard | profile/profile.controller.ts |
| GET | `/pos/me/notification-prefs` | session | self.notifications | identity | TenantAuthGuard | profile/profile.controller.ts |
| PATCH | `/pos/me/notification-prefs` | session | self.notifications | identity | TenantAuthGuard | profile/profile.controller.ts |
| GET | `/pos/me/profile` | session | self.profile.view | identity | TenantAuthGuard | profile/profile.controller.ts |
| GET | `/pos/me/sessions` | session | self.profile.view | identity | TenantAuthGuard | profile/profile.controller.ts |
| POST | `/pos/me/sessions/{id}/revoke` | session | self.profile.edit | identity | TenantAuthGuard | profile/profile.controller.ts |
| POST | `/pos/me/sessions/revoke-all` | session | self.profile.edit | identity | TenantAuthGuard | profile/profile.controller.ts |
| GET | `/pos/me/ui-prefs` | session | self.profile.view | identity | TenantAuthGuard | profile/profile.controller.ts |
| PATCH | `/pos/me/ui-prefs` | session | self.profile.edit | identity | TenantAuthGuard | profile/profile.controller.ts |
| POST | `/pos/memberships/cancel` | session | pos.memberships.manage | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/membership-enroll.controller.ts |
| POST | `/pos/memberships/comms/members/{membershipId}/reminder` | session | pos.memberships.manage | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/membership-comms.controller.ts |
| POST | `/pos/memberships/comms/reminders/run` | session | pos.memberships.manage | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/membership-comms.controller.ts |
| POST | `/pos/memberships/compensation/book/{ticketId}` | session | pos.memberships.manage | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/membership-compensation.controller.ts |
| GET | `/pos/memberships/coverage/{ticketId}` | session | pos.memberships.view | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/membership-enroll.controller.ts |
| GET | `/pos/memberships/customers/{customerId}/memberships` | session | pos.memberships.view | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/membership-enroll.controller.ts |
| POST | `/pos/memberships/enroll` | session | pos.memberships.manage | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/membership-enroll.controller.ts |
| GET | `/pos/memberships/export/members` | session | pos.memberships.view | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/memberships.controller.ts |
| GET | `/pos/memberships/export/payments` | session | pos.memberships.view | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/memberships.controller.ts |
| GET | `/pos/memberships/export/redemptions` | session | pos.memberships.view | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/memberships.controller.ts |
| GET | `/pos/memberships/members/{membershipId}/benefits` | session | pos.memberships.view | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/membership-enroll.controller.ts |
| POST | `/pos/memberships/members/by-customers` | session | pos.memberships.view | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/membership-enroll.controller.ts |
| GET | `/pos/memberships/overview` | session | pos.memberships.view | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/memberships.controller.ts |
| POST | `/pos/memberships/pause` | session | pos.memberships.manage | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/membership-enroll.controller.ts |
| GET | `/pos/memberships/plans` | session | pos.memberships.view | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/memberships.controller.ts |
| POST | `/pos/memberships/plans` | session | pos.memberships.manage | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/memberships.controller.ts |
| GET | `/pos/memberships/plans/{planId}` | session | pos.memberships.view | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/memberships.controller.ts |
| POST | `/pos/memberships/plans/{planId}/versions` | session | pos.memberships.manage | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/memberships.controller.ts |
| POST | `/pos/memberships/redeem` | session | pos.memberships.manage | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/membership-enroll.controller.ts |
| POST | `/pos/memberships/release` | session | pos.memberships.manage | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/membership-enroll.controller.ts |
| POST | `/pos/memberships/reserve` | session | pos.memberships.manage | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/membership-enroll.controller.ts |
| POST | `/pos/memberships/resume` | session | pos.memberships.manage | memberships | RolePermissionGuard + TenantAuthGuard | modules/memberships/src/membership-enroll.controller.ts |
| GET | `/pos/menu-insights` | session | pos.services.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/menu-insights/menu-insights.controller.ts |
| GET | `/pos/menu-insights/state` | session | pos.services.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/menu-insights/menu-insights.controller.ts |
| PATCH | `/pos/nail-showcase/comments/{commentId}/hide` | session | customers.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/nail-showcase/nail-showcase.pos.controller.ts |
| GET | `/pos/nail-showcase/posts` | session | customers.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/nail-showcase/nail-showcase.pos.controller.ts |
| PATCH | `/pos/nail-showcase/posts/{postId}/approve` | session | customers.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/nail-showcase/nail-showcase.pos.controller.ts |
| PATCH | `/pos/nail-showcase/posts/{postId}/hide` | session | customers.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/nail-showcase/nail-showcase.pos.controller.ts |
| GET | `/pos/nail-showcase/reports` | session | customers.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/nail-showcase/nail-showcase.pos.controller.ts |
| PATCH | `/pos/nail-showcase/reports/{reportId}` | session | customers.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/nail-showcase/nail-showcase.pos.controller.ts |
| GET | `/pos/notifications` | session | communications.view | communications | TenantAuthGuard | modules/communications/src/notifications/notifications.controller.ts |
| POST | `/pos/notifications/opt-in` | session | communications.manage | communications | TenantAuthGuard | modules/communications/src/notifications/notifications.controller.ts |
| POST | `/pos/notifications/opt-out` | session | communications.manage | communications | TenantAuthGuard | modules/communications/src/notifications/notifications.controller.ts |
| GET | `/pos/notifications/opt-outs` | session | communications.view | communications | TenantAuthGuard | modules/communications/src/notifications/notifications.controller.ts |
| POST | `/pos/notifications/send` | session | communications.manage | communications | TenantAuthGuard | modules/communications/src/notifications/notifications.controller.ts |
| GET | `/pos/operations` | session | self.operations.view | operations | TenantAuthGuard | common/async-export/operations.controller.ts |
| GET | `/pos/operations/{id}` | session | self.operations.view | operations | TenantAuthGuard | common/async-export/operations.controller.ts |
| GET | `/pos/operations/{id}/download` | session | self.operations.view | operations | TenantAuthGuard | common/async-export/operations.controller.ts |
| GET | `/pos/overview/alerts` | session | pos.overview.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/overview/overview.controller.ts |
| GET | `/pos/overview/board` | session | pos.overview.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/overview/overview-board.controller.ts |
| GET | `/pos/overview/insights` | session | pos.overview.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/overview/overview.controller.ts |
| GET | `/pos/overview/kpis` | session | pos.overview.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/overview/overview.controller.ts |
| GET | `/pos/overview/payment-mix` | session | pos.overview.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/overview/overview.controller.ts |
| GET | `/pos/overview/revenue-trend` | session | pos.overview.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/overview/overview.controller.ts |
| GET | `/pos/overview/state` | session | pos.overview.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/overview/overview.controller.ts |
| GET | `/pos/overview/today-summary` | session | pos.overview.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/overview/overview.controller.ts |
| GET | `/pos/overview/top-services` | session | pos.overview.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/overview/overview.controller.ts |
| GET | `/pos/overview/top-technicians` | session | pos.overview.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/analytics/src/overview/overview.controller.ts |
| GET | `/pos/payment-gateway/status` | session | settings.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/checkout/pos-payment-gateway.controller.ts |
| GET | `/pos/payments/overview` | session | pos.reports.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/payments/payment-reconciliation.controller.ts |
| GET | `/pos/payments/reconciliation` | session | pos.reports.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/payments/payment-reconciliation.controller.ts |
| GET | `/pos/payments/split-payments/state` | session | pos.checkout.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/split-payments/split-payments.controller.ts |
| GET | `/pos/payroll/adjustments` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/adjustments/{adjId}/decide` | session | payroll.approve | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/deduction-types` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/deduction-types` | session | compensation.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/exceptions` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/exceptions/{exId}/action` | session | pos.payroll.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/inquiries` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/inquiries/{inqId}/respond` | session | pos.payroll.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/pay-plans` | session | compensation.view_all | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/pay-plans` | session | compensation.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/pay-plans/{planId}/archive` | session | compensation.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/open-week` | session | pos.payroll.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/payouts/{payoutId}/cash/acknowledge-pin` | session | payroll.cash_handoff | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/payouts/{payoutId}/cash/handoff` | session | payroll.cash_handoff | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/payouts/{payoutId}/cash/prepare` | session | payroll.cash_handoff | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/payouts/{payoutId}/cash/resolve` | session | payroll.cash_handoff | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/payouts/{payoutId}/check/clear` | session | payroll.issue_check | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/payouts/{payoutId}/check/deliver` | session | payroll.issue_check | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/payouts/{payoutId}/check/issue` | session | payroll.issue_check | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/payouts/{payoutId}/check/void` | session | payroll.issue_check | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/paychecks/periods/{id}` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/periods/{id}/apply-default` | session | pos.payroll.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/periods/{id}/approve` | session | payroll.approve | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/periods/{id}/calculate` | session | pos.payroll.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/periods/{id}/reject` | session | payroll.approve | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/periods/{id}/return` | session | payroll.approve | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/periods/{id}/submit` | session | pos.payroll.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/paychecks/reports` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/paychecks/schedule` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/schedule` | session | payroll.approve | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/paychecks/statements/{statementId}` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/statements/{statementId}/approve` | session | payroll.approve | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/statements/{statementId}/payout-plan` | session | pos.payroll.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/paychecks/statements/{statementId}/payouts` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/paychecks/summary` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/payouts/{payoutId}/status` | session | payouts.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/periods` | session | pos.payroll.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/periods/{id}` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/periods/{id}/adjustments` | session | payroll.adjust | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/periods/{id}/build-from-sales` | session | pos.payroll.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/periods/{id}/export` | session | payroll.export | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/periods/{id}/exports` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/periods/{id}/finalize` | session | payroll.approve | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/periods/{id}/pay` | session | payouts.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/periods/{id}/payouts` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/periods/{id}/payouts` | session | payouts.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/periods/{id}/prepare` | session | pos.payroll.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/periods/{id}/reopen` | session | payroll.approve | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/periods/{id}/send-back` | session | pos.payroll.manage | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/periods/{id}/technicians/{techId}` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/payroll/periods/{id}/technicians/{techId}/carry-forward` | session | payroll.adjust | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/periods/{id}/validation` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/provider` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| GET | `/pos/payroll/state` | session | pos.payroll.view | finance | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/pos/platform-announcements/{id}/acknowledge` | session | pos.login | communications | RolePermissionGuard + TenantAuthGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| POST | `/pos/platform-announcements/{id}/delivered` | session | pos.login | communications | RolePermissionGuard + TenantAuthGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| POST | `/pos/platform-announcements/{id}/dismiss` | session | pos.login | communications | RolePermissionGuard + TenantAuthGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| GET | `/pos/platform-announcements/active` | session | pos.login | communications | RolePermissionGuard + TenantAuthGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| GET | `/pos/project-status` | session | pos.reports.view | support | RolePermissionGuard + TenantAuthGuard | pos-project-status/pos-project-status.controller.ts |
| GET | `/pos/project-status/module/{moduleKey}` | session | pos.reports.view | support | RolePermissionGuard + TenantAuthGuard | pos-project-status/pos-project-status.controller.ts |
| PATCH | `/pos/project-status/module/{moduleKey}/recheck` | session | pos.reports.view | support | RolePermissionGuard + TenantAuthGuard | pos-project-status/pos-project-status.controller.ts |
| GET | `/pos/project-status/modules` | session | pos.reports.view | support | RolePermissionGuard + TenantAuthGuard | pos-project-status/pos-project-status.controller.ts |
| POST | `/pos/queue/auto-balance/apply` | session | pos.queue.assign_technician | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/auto-balance/preview` | session | pos.queue.assign_technician | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| GET | `/pos/queue/groups` | session | pos.queue.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/groups` | session | pos.queue.edit | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/groups/{groupId}/move-to-tech-queue` | session | pos.queue.move_to_tech_queue | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| GET | `/pos/queue/items` | session | pos.queue.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items` | session | pos.queue.create | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| GET | `/pos/queue/items/{queueItemId}` | session | pos.queue.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| PATCH | `/pos/queue/items/{queueItemId}` | session | pos.queue.edit | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items/{queueItemId}/assign-technician` | session | pos.queue.assign_technician | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items/{queueItemId}/call-next` | session | pos.queue.call_next | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items/{queueItemId}/cancel` | session | pos.queue.cancel | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items/{queueItemId}/change-requested-technician` | session | pos.queue.assign_technician | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| GET | `/pos/queue/items/{queueItemId}/history` | session | pos.queue.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items/{queueItemId}/lock` | session | pos.queue.assign_technician | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items/{queueItemId}/move-to-serving` | session | pos.queue.move_to_serving | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items/{queueItemId}/move-to-tech-queue` | session | pos.queue.move_to_tech_queue | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items/{queueItemId}/notify-customer` | session | pos.queue.edit | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items/{queueItemId}/remove` | session | pos.queue.remove | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| PUT | `/pos/queue/items/{queueItemId}/service-assignments` | session | pos.queue.assign_technician | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items/{queueItemId}/start-service` | session | pos.queue.move_to_serving | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items/{queueItemId}/unassign-technician` | session | pos.queue.assign_technician | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items/{queueItemId}/unlock` | session | pos.queue.assign_technician | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items/{queueItemId}/update-priority` | session | pos.queue.update_priority | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/items/{queueItemId}/update-services` | session | pos.queue.edit | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| GET | `/pos/queue/kpis` | session | pos.queue.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/plans/assign` | session | pos.queue.assign_technician | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/queue/reorder` | session | pos.queue.update_priority | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| GET | `/pos/queue/state` | session | pos.queue.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| GET | `/pos/queue/technicians/availability` | session | pos.queue.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| GET | `/pos/queue/wait-estimate` | session | pos.queue.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/queue/queue.controller.ts |
| POST | `/pos/referrals/{id}/reward` | session | pos.marketing.manage | loyalty | RolePermissionGuard + TenantAuthGuard | modules/customers/src/pos-referrals/pos-referrals.controller.ts |
| POST | `/pos/referrals/record` | session | pos.marketing.manage | loyalty | RolePermissionGuard + TenantAuthGuard | modules/customers/src/pos-referrals/pos-referrals.controller.ts |
| GET | `/pos/referrals/state` | session | pos.marketing.view | loyalty | RolePermissionGuard + TenantAuthGuard | modules/customers/src/pos-referrals/pos-referrals.controller.ts |
| GET | `/pos/refunds-voids/state` | session | pos.checkout.view | payments | RolePermissionGuard + TenantAuthGuard | modules/payments/src/refunds-voids/refunds-voids.controller.ts |
| GET | `/pos/reminders` | session | communications.view | communications | TenantAuthGuard | modules/communications/src/reminders/reminders.controller.ts |
| PATCH | `/pos/reminders` | session | communications.manage | communications | TenantAuthGuard | modules/communications/src/reminders/reminders.controller.ts |
| GET | `/pos/reports/booking` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/customers` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/detail/{kind}/{id}` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/discounts` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/export` | session | pos.reports.export | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/kpis` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/payments` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/queue` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/revenue-trend` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/sales` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/services` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/state` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/surcharge` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/tax` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/technicians` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/tips` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| GET | `/pos/reports/transactions` | session | pos.reports.view | analytics | RolePermissionGuard + TenantAuthGuard | modules/reports/src/reports/reports.controller.ts |
| POST | `/pos/reviews/{id}/visibility` | session | pos.marketing.manage | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/reviews/reviews.controller.ts |
| GET | `/pos/reviews/state` | session | pos.marketing.view | customers | RolePermissionGuard + TenantAuthGuard | modules/customers/src/reviews/reviews.controller.ts |
| POST | `/pos/salon-promotions` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/salon-promotions/salon-promotions.controller.ts |
| POST | `/pos/salon-promotions/{id}/status` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/salon-promotions/salon-promotions.controller.ts |
| POST | `/pos/salon-promotions/redeem` | session | pos.marketing.manage | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/salon-promotions/salon-promotions.controller.ts |
| GET | `/pos/salon-promotions/state` | session | pos.marketing.view | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/salon-promotions/salon-promotions.controller.ts |
| GET | `/pos/search` | session | global_search.use | analytics | RolePermissionGuard + TenantAuthGuard | pos/pos-search.controller.ts |
| POST | `/pos/search/open` | session | global_search.use | analytics | RolePermissionGuard + TenantAuthGuard | pos/pos-search.controller.ts |
| GET | `/pos/security/access-reviews` | session | access_review.view | security | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/access-governance/access-governance.controller.ts |
| POST | `/pos/security/access-reviews` | session | access_review.manage | security | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/access-governance/access-governance.controller.ts |
| GET | `/pos/security/access-reviews/{id}` | session | access_review.view | security | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/access-governance/access-governance.controller.ts |
| POST | `/pos/security/access-reviews/{id}/complete` | session | access_review.manage | security | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/access-governance/access-governance.controller.ts |
| POST | `/pos/security/access-reviews/{id}/decisions` | session | access_review.manage | security | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/access-governance/access-governance.controller.ts |
| GET | `/pos/security/denials` | session | security_reports.view | security | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/access-governance/access-governance.controller.ts |
| GET | `/pos/security/dormant` | session | security_reports.view | security | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/access-governance/access-governance.controller.ts |
| GET | `/pos/security/high-risk` | session | security_reports.view | security | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/access-governance/access-governance.controller.ts |
| POST | `/pos/service-add-ons` | session | pos.services.edit | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/service-add-ons/service-add-ons.controller.ts |
| PATCH | `/pos/service-add-ons/{addOnId}` | session | pos.services.edit | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/service-add-ons/service-add-ons.controller.ts |
| POST | `/pos/service-add-ons/{addOnId}/archive` | session | pos.services.edit | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/service-add-ons/service-add-ons.controller.ts |
| POST | `/pos/service-add-ons/{addOnId}/reactivate` | session | pos.services.edit | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/service-add-ons/service-add-ons.controller.ts |
| GET | `/pos/service-add-ons/state` | session | pos.services.view | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/service-add-ons/service-add-ons.controller.ts |
| GET | `/pos/service-done/kpis` | session | pos.service_done.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/service-done/service-done.controller.ts |
| GET | `/pos/service-done/state` | session | pos.service_done.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/service-done/service-done.controller.ts |
| GET | `/pos/service-done/technicians` | session | pos.service_done.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/service-done/service-done.controller.ts |
| GET | `/pos/service-done/tickets` | session | pos.service_done.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/service-done/service-done.controller.ts |
| GET | `/pos/service-done/tickets/{ticketId}` | session | pos.service_done.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/service-done/service-done.controller.ts |
| POST | `/pos/service-done/tickets/{ticketId}/assign-helper` | session | pos.service_done.assign_technician | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/service-done/service-done.controller.ts |
| POST | `/pos/service-done/tickets/{ticketId}/assign-technician` | session | pos.service_done.assign_technician | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/service-done/service-done.controller.ts |
| POST | `/pos/service-done/tickets/{ticketId}/mark-ready-for-checkout` | session | pos.service_done.send_to_checkout | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/service-done/service-done.controller.ts |
| POST | `/pos/service-done/tickets/{ticketId}/notify-customer` | session | pos.service_done.notify_customer | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/service-done/service-done.controller.ts |
| POST | `/pos/service-done/tickets/{ticketId}/quality-check` | session | pos.service_done.quality_check | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/service-done/service-done.controller.ts |
| POST | `/pos/service-done/tickets/{ticketId}/reopen-service` | session | pos.service_done.reopen | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/service-done/service-done.controller.ts |
| POST | `/pos/service-done/tickets/{ticketId}/send-to-checkout` | session | pos.service_done.send_to_checkout | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/service-done/service-done.controller.ts |
| POST | `/pos/service-done/tickets/{ticketId}/update-notes` | session | pos.service_done.update_notes | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/service-done/service-done.controller.ts |
| GET | `/pos/services` | session | pos.services.view | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| POST | `/pos/services` | session | pos.services.create | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| GET | `/pos/services/{serviceId}` | session | pos.services.view | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| PATCH | `/pos/services/{serviceId}` | session | pos.services.edit | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| GET | `/pos/services/{serviceId}/add-ons` | session | pos.services.view | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| PATCH | `/pos/services/{serviceId}/add-ons` | session | pos.services.edit | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| POST | `/pos/services/{serviceId}/archive` | session | pos.services.archive | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| GET | `/pos/services/{serviceId}/commission` | session | pos.services.view | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| PATCH | `/pos/services/{serviceId}/commission` | session | pos.services.commission.edit | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| POST | `/pos/services/{serviceId}/reactivate` | session | pos.services.archive | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| GET | `/pos/services/{serviceId}/tax` | session | pos.services.view | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| PATCH | `/pos/services/{serviceId}/tax` | session | pos.services.edit | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| GET | `/pos/services/{serviceId}/technician-mapping` | session | pos.services.view | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| PATCH | `/pos/services/{serviceId}/technician-mapping` | session | pos.services.technician_mapping.edit | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| GET | `/pos/services/{serviceId}/technicians` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| GET | `/pos/services/categories` | session | pos.services.view | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| POST | `/pos/services/categories` | session | pos.services.edit | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| PATCH | `/pos/services/categories/{categoryId}` | session | pos.services.edit | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| POST | `/pos/services/categories/{categoryId}/archive` | session | pos.services.edit | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| POST | `/pos/services/categories/reorder` | session | pos.services.edit | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| GET | `/pos/services/export` | session | pos.services.export | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| POST | `/pos/services/import` | session | pos.services.import | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| POST | `/pos/services/import/commit` | session | pos.services.import | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| POST | `/pos/services/import/preview` | session | pos.services.import | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| GET | `/pos/services/kpis` | session | pos.services.view | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| GET | `/pos/services/search` | session | pos.services.view | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| GET | `/pos/services/state` | session | pos.services.view | catalog | RolePermissionGuard + TenantAuthGuard | modules/catalog/src/services/services.controller.ts |
| POST | `/pos/serving/change-requests/{id}/decision` | session | pos.serving.edit_services | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| GET | `/pos/serving/change-requests/pending` | session | pos.serving.edit_services | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| GET | `/pos/serving/kpis` | session | pos.serving.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| GET | `/pos/serving/retail-catalog` | session | serving.manage | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| GET | `/pos/serving/services` | session | pos.serving.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| GET | `/pos/serving/state` | session | pos.serving.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| GET | `/pos/serving/technicians` | session | pos.serving.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| GET | `/pos/serving/tickets` | session | pos.serving.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| GET | `/pos/serving/tickets/{ticketId}` | session | pos.serving.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| POST | `/pos/serving/tickets/{ticketId}/add-retail` | session | pos.serving.edit_services | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| POST | `/pos/serving/tickets/{ticketId}/add-service` | session | pos.serving.edit_services | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| POST | `/pos/serving/tickets/{ticketId}/assign-helper` | session | pos.serving.assign_helper | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| POST | `/pos/serving/tickets/{ticketId}/assign-technician` | session | pos.serving.assign_technician | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| POST | `/pos/serving/tickets/{ticketId}/clear-delay` | session | pos.serving.report_delay | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| POST | `/pos/serving/tickets/{ticketId}/mark-service-done` | session | pos.serving.mark_done | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| POST | `/pos/serving/tickets/{ticketId}/pause` | session | pos.serving.pause_resume | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| POST | `/pos/serving/tickets/{ticketId}/remove-service` | session | pos.serving.edit_services | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| POST | `/pos/serving/tickets/{ticketId}/reopen` | session | pos.serving.send_to_service_done | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| POST | `/pos/serving/tickets/{ticketId}/report-delay` | session | pos.serving.report_delay | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| POST | `/pos/serving/tickets/{ticketId}/resume` | session | pos.serving.pause_resume | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| GET | `/pos/serving/tickets/{ticketId}/revisions` | session | pos.serving.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| POST | `/pos/serving/tickets/{ticketId}/send-to-service-done` | session | pos.serving.send_to_service_done | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| PATCH | `/pos/serving/tickets/{ticketId}/services/{serviceLineId}` | session | pos.serving.edit_services | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| POST | `/pos/serving/tickets/{ticketId}/start` | session | pos.serving.start | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| POST | `/pos/serving/tickets/{ticketId}/update-notes` | session | pos.serving.update_notes | checkout | RolePermissionGuard + TenantAuthGuard | modules/queue/src/serving/serving.controller.ts |
| GET | `/pos/settings/audit-logs` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/booking-appointments` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/booking-appointments` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/booking-phone-verification` | session | settings.view | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-booking/booking-verification-settings.controller.ts |
| PATCH | `/pos/settings/booking-phone-verification` | session | settings.edit | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-booking/booking-verification-settings.controller.ts |
| PATCH | `/pos/settings/booking-phone-verification/branches/{branchId}` | session | settings.edit | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-booking/booking-verification-settings.controller.ts |
| GET | `/pos/settings/booking-phone-verification/usage` | session | settings.view | booking | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-booking/booking-verification-settings.controller.ts |
| GET | `/pos/settings/business-branch` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/business-branch` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/customer-display-devices` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/customer-display-devices` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/customer-phone` | session | settings.view | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone-settings.controller.ts |
| PATCH | `/pos/settings/customer-phone` | session | pos.customers.phone.settings | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone-settings.controller.ts |
| DELETE | `/pos/settings/customer-phone/branches/{branchId}` | session | pos.customers.phone.settings | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone-settings.controller.ts |
| GET | `/pos/settings/customer-phone/branches/{branchId}` | session | settings.view | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone-settings.controller.ts |
| PATCH | `/pos/settings/customer-phone/branches/{branchId}` | session | pos.customers.phone.settings | identity | RolePermissionGuard + TenantAuthGuard | modules/booking/src/customer-phone/customer-phone-settings.controller.ts |
| GET | `/pos/settings/gift-card-settings` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/gift-card-settings` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/go-check-in` | session | settings.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/go-check-in/go-check-in.admin.controller.ts |
| PATCH | `/pos/settings/go-check-in` | session | settings.edit | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/go-check-in/go-check-in.admin.controller.ts |
| GET | `/pos/settings/go-live-readiness` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/loyalty-memberships` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/loyalty-memberships` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/notifications-reminders` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/notifications-reminders` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/settings/notifications-reminders/a2p-register` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/notifications-reminders/a2p-status` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/notifications-reminders/templates` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/settings/notifications-reminders/templates` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/online-google-ai-booking` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/online-google-ai-booking` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/settings/online-google-ai-booking/ai` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/settings/online-google-ai-booking/connect-google` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/settings/online-google-ai-booking/disconnect-google` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/online-google-ai-booking/status` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/payments-checkout` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/payments-checkout` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/payments-checkout/terminals` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/settings/payments-checkout/terminals/{id}/disable` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/settings/payments-checkout/terminals/{id}/enable` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/settings/payments-checkout/terminals/{id}/register` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/settings/payments-checkout/terminals/{id}/rename` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/payments-checkout/terminals/{id}/test` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/settings/payments-checkout/terminals/{id}/unpair` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/settings/payments-checkout/terminals/pair` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/payments-checkout/test-connection` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/queue-workflow` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/queue-workflow` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/receipts-branding` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/receipts-branding` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/receipts-branding/logo` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/settings/receipts-branding/logo` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/settings/receipts-branding/logo/remove` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/receipts-branding/preview` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/settings/receipts-branding/send-test` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/roles-permissions-security` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/roles-permissions-security` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/security` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/security` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/services-pricing` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/services-pricing` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/skip-line-checkout` | session | checkout.view | checkout | — | modules/checkout/src/skip-line-checkout/skip-line-settings.controller.ts |
| PATCH | `/pos/settings/skip-line-checkout` | session | checkout.process_payment | checkout | — | modules/checkout/src/skip-line-checkout/skip-line-settings.controller.ts |
| GET | `/pos/settings/state` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/store-hours-auto-logout` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/store-hours-auto-logout` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/subscription-plan` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/tax` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/tax` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/technicians-staff` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/technicians-staff` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| GET | `/pos/settings/tips` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| PATCH | `/pos/settings/tips` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/settings/settings.controller.ts |
| POST | `/pos/social-posts` | session | pos.marketing.manage | marketing | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/pos-social/pos-social.controller.ts |
| POST | `/pos/social-posts/{id}/status` | session | pos.marketing.manage | marketing | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/pos-social/pos-social.controller.ts |
| GET | `/pos/social-posts/state` | session | pos.marketing.view | marketing | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/pos-social/pos-social.controller.ts |
| POST | `/pos/staff-roles` | session | roles.manage | identity | RolePermissionGuard + TenantAuthGuard | modules/identity/src/staff-roles/staff-roles.controller.ts |
| POST | `/pos/staff-roles/{id}/archive` | session | roles.manage | identity | RolePermissionGuard + TenantAuthGuard | modules/identity/src/staff-roles/staff-roles.controller.ts |
| GET | `/pos/team` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/pos-team/pos-team.controller.ts |
| GET | `/pos/team/member/{userId}` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/pos-team/pos-team.controller.ts |
| GET | `/pos/team/permissions/state` | session | pos.technicians.view | identity | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/team-permissions/team-permissions.controller.ts |
| GET | `/pos/team/state` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/pos-team/pos-team.controller.ts |
| GET | `/pos/tech-appointments/appointments` | session | pos.tech_appointments.view | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| POST | `/pos/tech-appointments/appointments` | session | pos.tech_appointments.create | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| GET | `/pos/tech-appointments/appointments/{appointmentId}` | session | pos.tech_appointments.view | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| PATCH | `/pos/tech-appointments/appointments/{appointmentId}` | session | pos.tech_appointments.edit | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| POST | `/pos/tech-appointments/appointments/{appointmentId}/assign-technician` | session | pos.tech_appointments.assign_technician | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| POST | `/pos/tech-appointments/appointments/{appointmentId}/cancel` | session | pos.tech_appointments.cancel | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| POST | `/pos/tech-appointments/appointments/{appointmentId}/check-in` | session | pos.tech_appointments.check_in | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| POST | `/pos/tech-appointments/appointments/{appointmentId}/move-to-queue` | session | pos.queue.create | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| POST | `/pos/tech-appointments/appointments/{appointmentId}/move-to-tech-queue` | session | pos.tech_queue.create | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| POST | `/pos/tech-appointments/appointments/{appointmentId}/no-show` | session | pos.tech_appointments.no_show | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| POST | `/pos/tech-appointments/appointments/{appointmentId}/reschedule` | session | pos.tech_appointments.reschedule | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| POST | `/pos/tech-appointments/appointments/{appointmentId}/start-service` | session | pos.serving.start | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| POST | `/pos/tech-appointments/conflicts/check` | session | pos.tech_appointments.view | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| GET | `/pos/tech-appointments/kpis` | session | pos.tech_appointments.view | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| GET | `/pos/tech-appointments/state` | session | pos.tech_appointments.view | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| GET | `/pos/tech-appointments/technicians` | session | pos.tech_appointments.view | booking | RolePermissionGuard + TenantAuthGuard | modules/appointments/src/tech-appointments/tech-appointments.controller.ts |
| GET | `/pos/tech-queue/kpis` | session | pos.tech_queue.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| GET | `/pos/tech-queue/state` | session | pos.tech_queue.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| GET | `/pos/tech-queue/technician-lanes` | session | pos.tech_queue.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| GET | `/pos/tech-queue/tickets` | session | pos.tech_queue.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| GET | `/pos/tech-queue/tickets/{techQueueTicketId}` | session | pos.tech_queue.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| POST | `/pos/tech-queue/tickets/{techQueueTicketId}/accept` | session | pos.tech_queue.accept | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| POST | `/pos/tech-queue/tickets/{techQueueTicketId}/cancel` | session | pos.tech_queue.reassign | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| POST | `/pos/tech-queue/tickets/{techQueueTicketId}/clear-delay` | session | pos.tech_queue.report_delay | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| POST | `/pos/tech-queue/tickets/{techQueueTicketId}/decline` | session | pos.tech_queue.decline | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| POST | `/pos/tech-queue/tickets/{techQueueTicketId}/move-to-serving` | session | pos.tech_queue.move_to_serving | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| POST | `/pos/tech-queue/tickets/{techQueueTicketId}/notify-customer` | session | pos.tech_queue.notify_customer | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| POST | `/pos/tech-queue/tickets/{techQueueTicketId}/notify-technician` | session | pos.tech_queue.notify_technician | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| POST | `/pos/tech-queue/tickets/{techQueueTicketId}/reassign-technician` | session | pos.tech_queue.reassign | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| POST | `/pos/tech-queue/tickets/{techQueueTicketId}/report-delay` | session | pos.tech_queue.report_delay | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| POST | `/pos/tech-queue/tickets/{techQueueTicketId}/start-service` | session | pos.tech_queue.move_to_serving | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| POST | `/pos/tech-queue/tickets/{techQueueTicketId}/update-priority` | session | pos.tech_queue.update_priority | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| POST | `/pos/tech-queue/tickets/{techQueueTicketId}/update-services` | session | pos.tech_queue.update_services | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech-queue/tech-queue.controller.ts |
| GET | `/pos/technician-certifications/{technicianId}` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech/technician-certifications.controller.ts |
| POST | `/pos/technician-certifications/{technicianId}/{certificationId}/verify` | session | pos.technicians.skills.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech/technician-certifications.controller.ts |
| POST | `/pos/technician-clock/breaks/{breakId}/adjust` | session | pos.technicians.manage | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technician-clock-pin/technician-clock-management.controller.ts |
| POST | `/pos/technician-clock/technicians/{technicianId}/clock-pin/reset` | session | pos.technicians.manage | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technician-clock-pin/technician-clock-management.controller.ts |
| POST | `/pos/technician-clock/timecards/{shiftId}/adjust` | session | pos.technicians.manage | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technician-clock-pin/technician-clock-management.controller.ts |
| GET | `/pos/technician-membership/requests` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| POST | `/pos/technician-membership/requests/{requestId}/approve` | session | pos.technicians.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| POST | `/pos/technician-membership/requests/{requestId}/reject` | session | pos.technicians.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| GET | `/pos/technician-profile-changes` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| POST | `/pos/technician-profile-changes/{requestId}/approve` | session | pos.technicians.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| POST | `/pos/technician-profile-changes/{requestId}/reject` | session | pos.technicians.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| GET | `/pos/technician-profile-policy` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| PATCH | `/pos/technician-profile-policy` | session | pos.technicians.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| GET | `/pos/technicians` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| POST | `/pos/technicians` | session | pos.technicians.create | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/{technicianId}` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| PATCH | `/pos/technicians/{technicianId}` | session | pos.technicians.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| POST | `/pos/technicians/{technicianId}/activate` | session | pos.technicians.status_change | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/{technicianId}/app-access` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| PATCH | `/pos/technicians/{technicianId}/app-access` | session | pos.technicians.app_access.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| POST | `/pos/technicians/{technicianId}/archive` | session | pos.technicians.status_change | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| POST | `/pos/technicians/{technicianId}/block-time` | session | pos.technicians.block_time | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/live-technician-schedule/live-technician-schedule.controller.ts |
| GET | `/pos/technicians/{technicianId}/commission` | session | technicians.view_pay | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| PATCH | `/pos/technicians/{technicianId}/commission` | session | pos.technicians.commission.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/{technicianId}/commission-history` | session | technicians.view_pay | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/{technicianId}/employment-history` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| POST | `/pos/technicians/{technicianId}/end-break` | session | pos.technicians.manage_status | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/live-technician-schedule/live-technician-schedule.controller.ts |
| PATCH | `/pos/technicians/{technicianId}/feature` | session | pos.technicians.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| GET | `/pos/technicians/{technicianId}/live-detail` | session | pos.technicians.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/live-technician-schedule/live-technician-schedule.controller.ts |
| POST | `/pos/technicians/{technicianId}/membership/deactivate` | session | pos.technicians.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| GET | `/pos/technicians/{technicianId}/payroll-summary` | session | technicians.view_pay | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/{technicianId}/permissions` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| PATCH | `/pos/technicians/{technicianId}/permissions` | session | pos.technicians.permissions.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| PATCH | `/pos/technicians/{technicianId}/portfolio-photos/{photoId}/approve` | session | pos.technicians.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| PATCH | `/pos/technicians/{technicianId}/portfolio-photos/{photoId}/hide` | session | pos.technicians.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| GET | `/pos/technicians/{technicianId}/profile` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| PATCH | `/pos/technicians/{technicianId}/profile` | session | pos.technicians.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| GET | `/pos/technicians/{technicianId}/ratings` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| PATCH | `/pos/technicians/{technicianId}/ratings/{ratingId}/hide` | session | pos.technicians.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/tech-profile/pos-tech-profile.controller.ts |
| POST | `/pos/technicians/{technicianId}/reactivate` | session | pos.technicians.status_change | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/{technicianId}/schedule` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| PATCH | `/pos/technicians/{technicianId}/schedule` | session | pos.technicians.schedule.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/{technicianId}/services` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| PATCH | `/pos/technicians/{technicianId}/services` | session | pos.technicians.skills.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/{technicianId}/shifts` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| PATCH | `/pos/technicians/{technicianId}/shifts` | session | pos.technicians.schedule.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/{technicianId}/skills` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| PATCH | `/pos/technicians/{technicianId}/skills` | session | pos.technicians.skills.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| POST | `/pos/technicians/{technicianId}/start-break` | session | pos.technicians.manage_status | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/live-technician-schedule/live-technician-schedule.controller.ts |
| POST | `/pos/technicians/{technicianId}/suspend` | session | pos.technicians.status_change | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/{technicianId}/time-off` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-off/technician-time-off.controller.ts |
| POST | `/pos/technicians/{technicianId}/time-off` | session | pos.technicians.schedule.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-off/technician-time-off.controller.ts |
| POST | `/pos/technicians/{technicianId}/time-off/{id}/decision` | session | pos.technicians.schedule.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-off/technician-time-off.controller.ts |
| GET | `/pos/technicians/export` | session | pos.technicians.export | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| POST | `/pos/technicians/import` | session | pos.technicians.import | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/kpis` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/live-schedule/board` | session | pos.technicians.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/live-technician-schedule/live-technician-schedule.controller.ts |
| GET | `/pos/technicians/live-schedule/kpis` | session | pos.technicians.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/live-technician-schedule/live-technician-schedule.controller.ts |
| POST | `/pos/technicians/live-schedule/open-slots/{slotId}/book` | session | pos.booking.create | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/live-technician-schedule/live-technician-schedule.controller.ts |
| GET | `/pos/technicians/live-schedule/state` | session | pos.technicians.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/live-technician-schedule/live-technician-schedule.controller.ts |
| GET | `/pos/technicians/live-schedule/week` | session | pos.technicians.view | booking | RolePermissionGuard + TenantAuthGuard | modules/queue/src/live-technician-schedule/live-technician-schedule.controller.ts |
| POST | `/pos/technicians/lookup` | session | pos.technicians.create | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/qualified` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/salon-commission` | session | technicians.view_pay | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| PATCH | `/pos/technicians/salon-commission` | session | pos.technicians.commission.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/search` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/state` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/technicians/technicians.controller.ts |
| GET | `/pos/technicians/time-off/pending` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-off/technician-time-off.controller.ts |
| GET | `/pos/tickets/{id}/tip-allocation` | session | tips.adjust | finance | — | modules/workforce/src/compensation/compensation-tip-allocation.controller.ts |
| POST | `/pos/tickets/{id}/tip-allocation` | session | tips.adjust | finance | — | modules/workforce/src/compensation/compensation-tip-allocation.controller.ts |
| POST | `/pos/tickets/{ticketId}/cancel-app-payment` | session | checkout.process_payment | checkout | — | modules/checkout/src/skip-line-checkout/pos-skip-line.controller.ts |
| GET | `/pos/tickets/{ticketId}/history` | session | pos.serving.view | checkout | RolePermissionGuard + TenantAuthGuard | modules/checkout/src/ticket-history/ticket-history.controller.ts |
| POST | `/pos/tickets/{ticketId}/move-to-front-desk-checkout` | session | checkout.process_payment | checkout | — | modules/checkout/src/skip-line-checkout/pos-skip-line.controller.ts |
| GET | `/pos/tickets/{ticketId}/payment-status` | session | checkout.view | checkout | — | modules/checkout/src/skip-line-checkout/pos-skip-line.controller.ts |
| POST | `/pos/tickets/{ticketId}/send-app-payment` | session | checkout.process_payment | checkout | — | modules/checkout/src/skip-line-checkout/pos-skip-line.controller.ts |
| POST | `/pos/time-clock/break-end` | session | pos.technicians.manage_status | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-clock/time-clock.controller.ts |
| POST | `/pos/time-clock/break-interrupt` | session | pos.technicians.manage_status | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-clock/time-clock.controller.ts |
| GET | `/pos/time-clock/break-policy` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-clock/time-clock.controller.ts |
| PUT | `/pos/time-clock/break-policy` | session | payroll.manage | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-clock/time-clock.controller.ts |
| POST | `/pos/time-clock/break-start` | session | pos.technicians.manage_status | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-clock/time-clock.controller.ts |
| POST | `/pos/time-clock/clock-in` | session | pos.technicians.manage | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-clock/time-clock.controller.ts |
| POST | `/pos/time-clock/clock-out` | session | pos.technicians.manage | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-clock/time-clock.controller.ts |
| GET | `/pos/time-clock/state` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-clock/time-clock.controller.ts |
| GET | `/pos/turn-queue/board` | session | turn_queue.read | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| POST | `/pos/turn-queue/day/close` | session | turn_queue.adjust | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| GET | `/pos/turn-queue/fairness` | session | turn_queue.history.read | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| GET | `/pos/turn-queue/floor-health` | session | turn_queue.read | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| POST | `/pos/turn-queue/guest-declined` | session | turn_queue.assign | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| GET | `/pos/turn-queue/history` | session | turn_queue.history.read | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| GET | `/pos/turn-queue/reports/team` | session | turn_queue.history.read | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| GET | `/pos/turn-queue/rules` | session | turn_queue.read | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| POST | `/pos/turn-queue/rules` | session | turn_queue.settings.manage | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| POST | `/pos/turn-queue/rules/{ruleKey}/retire` | session | turn_queue.settings.manage | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| GET | `/pos/turn-queue/settings` | session | turn_queue.read | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| POST | `/pos/turn-queue/settings/preview` | session | turn_queue.settings.manage | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| POST | `/pos/turn-queue/technicians/{technicianId}/adjust` | session | turn_queue.adjust | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| POST | `/pos/turn-queue/technicians/{technicianId}/hold` | session | turn_queue.hold | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| POST | `/pos/turn-queue/technicians/{technicianId}/join` | session | turn_queue.join | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| POST | `/pos/turn-queue/technicians/{technicianId}/release` | session | turn_queue.hold | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| POST | `/pos/turn-queue/technicians/{technicianId}/reorder` | session | turn_queue.reorder | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| GET | `/pos/turn-queue/technicians/{technicianId}/summary` | session | technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| GET | `/pos/webhooks` | session | pos.webhooks.view | operations | RolePermissionGuard + TenantAuthGuard | api-webhooks/api-webhooks.controller.ts |
| POST | `/pos/webhooks` | session | pos.webhooks.manage | operations | RolePermissionGuard + TenantAuthGuard | api-webhooks/api-webhooks.controller.ts |
| GET | `/pos/webhooks/{id}/deliveries` | session | pos.webhooks.view | operations | RolePermissionGuard + TenantAuthGuard | api-webhooks/api-webhooks.controller.ts |
| POST | `/pos/webhooks/{id}/disable` | session | pos.webhooks.manage | operations | RolePermissionGuard + TenantAuthGuard | api-webhooks/api-webhooks.controller.ts |
| POST | `/pos/webhooks/{id}/pause` | session | pos.webhooks.manage | operations | RolePermissionGuard + TenantAuthGuard | api-webhooks/api-webhooks.controller.ts |
| POST | `/pos/webhooks/{id}/resume` | session | pos.webhooks.manage | operations | RolePermissionGuard + TenantAuthGuard | api-webhooks/api-webhooks.controller.ts |
| POST | `/pos/webhooks/{id}/rotate-secret` | session | pos.webhooks.manage | operations | RolePermissionGuard + TenantAuthGuard | api-webhooks/api-webhooks.controller.ts |
| POST | `/pos/webhooks/{id}/test` | session | pos.webhooks.manage | operations | RolePermissionGuard + TenantAuthGuard | api-webhooks/api-webhooks.controller.ts |
| POST | `/pos/webhooks/process` | session | pos.webhooks.manage | operations | RolePermissionGuard + TenantAuthGuard | api-webhooks/api-webhooks.controller.ts |
| GET | `/pos/workforce-status` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/workforce-status/workforce-status.controller.ts |
| GET | `/pos/workforce-status/{technicianId}` | session | pos.technicians.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/workforce-status/workforce-status.controller.ts |
| POST | `/pos/workforce-status/{technicianId}/unavailable` | session | pos.technicians.manage_status | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/workforce-status/workforce-status.controller.ts |
| POST | `/promotions/redeem` | session | pos.checkout.apply_discount | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/promotions/promotions.controller.ts |
| POST | `/promotions/redemptions/{id}/reverse` | session | pos.checkout.apply_discount | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/promotions/promotions.controller.ts |
| POST | `/promotions/validate` | session | pos.checkout.apply_discount | deals | RolePermissionGuard + TenantAuthGuard | modules/deals/src/promotions/promotions.controller.ts |
| GET | `/public/alert-ack` | public | — | operations | — | observability/oncall.ts |
| POST | `/public/alert-ack` | public | — | operations | — | observability/oncall.ts |
| POST | `/public/mfa-recovery/confirm` | public | — | identity | — | modules/identity/src/auth/mfa-recovery.controller.ts |
| POST | `/public/mfa-recovery/start` | public | — | identity | — | modules/identity/src/auth/mfa-recovery.controller.ts |
| POST | `/public/security/not-me` | public | — | identity | — | modules/identity/src/auth/security-not-me.controller.ts |
| POST | `/public/website/applications` | public | — | support | — | modules/super-admin/src/super-admin-platform/public-website.controller.ts |
| POST | `/public/website/invitations/accept` | public | — | marketing | — | modules/super-admin/src/super-admin-platform/public-website.controller.ts |
| POST | `/public/website/leads` | public | — | marketing | — | modules/super-admin/src/super-admin-platform/public-website.controller.ts |
| POST | `/push/register` | session | — | communications | — | modules/communications/src/push/push.controller.ts |
| POST | `/push/unregister` | session | — | communications | — | modules/communications/src/push/push.controller.ts |
| GET | `/realtime/presence` | session | pos.login | operations | RolePermissionGuard + TenantAuthGuard | realtime/presence.controller.ts |
| POST | `/realtime/presence` | session | pos.login | operations | RolePermissionGuard + TenantAuthGuard | realtime/presence.controller.ts |
| GET | `/realtime/stream` | session | pos.login | operations | RolePermissionGuard + TenantAuthGuard | realtime/realtime.controller.ts |
| POST | `/realtime/stream-ticket` | session | — | operations | TenantAuthGuard | realtime/stream-ticket.controller.ts |
| GET | `/super-admin/ai-business/overview` | session | super_admin.ai.view (derived) | analytics | SuperAdminGuard | modules/analytics/src/ai-business/ai-business-admin.controller.ts |
| GET | `/super-admin/ai-checkout-upsell/overview` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-checkout-upsell/super-admin-ai-checkout-upsell.controller.ts |
| GET | `/super-admin/ai-checkout-upsell/tenants/{tenantId}` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-checkout-upsell/super-admin-ai-checkout-upsell.controller.ts |
| GET | `/super-admin/ai-customer-profile/overview` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-customer-profile/super-admin-ai-customer-profile.controller.ts |
| GET | `/super-admin/ai-customer-profile/tenants/{tenantId}` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-customer-profile/super-admin-ai-customer-profile.controller.ts |
| GET | `/super-admin/ai-forecasting/overview` | session | super_admin.ai.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-forecasting/forecasting-oversight.controller.ts |
| GET | `/super-admin/ai-forecasting/tenants` | session | super_admin.ai.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-forecasting/forecasting-oversight.controller.ts |
| GET | `/super-admin/ai-insights` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-insights/super-admin-ai-insights.module.ts |
| GET | `/super-admin/ai-insights/{id}` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-insights/super-admin-ai-insights.module.ts |
| POST | `/super-admin/ai-insights/{id}/dismiss` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-insights/super-admin-ai-insights.module.ts |
| POST | `/super-admin/ai-insights/{id}/feedback` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-insights/super-admin-ai-insights.module.ts |
| POST | `/super-admin/ai-insights/bulk-assign` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-insights/super-admin-ai-insights.module.ts |
| POST | `/super-admin/ai-insights/bulk-review` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-insights/super-admin-ai-insights.module.ts |
| GET | `/super-admin/ai-insights/feedback/recent` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-insights/super-admin-ai-insights.module.ts |
| GET | `/super-admin/ai-insights/overview` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-insights/super-admin-ai-insights.module.ts |
| GET | `/super-admin/ai-narrative-model-versions` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/narrative-provenance.controller.ts |
| POST | `/super-admin/ai-narrative-model-versions` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/narrative-provenance.controller.ts |
| POST | `/super-admin/ai-narrative-model-versions/{id}/activate` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/narrative-provenance.controller.ts |
| GET | `/super-admin/ai-ocr-receipt/overview` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-ocr-receipt/super-admin-ai-ocr-receipt.controller.ts |
| GET | `/super-admin/ai-ocr-receipt/tenants/{tenantId}` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-ocr-receipt/super-admin-ai-ocr-receipt.controller.ts |
| GET | `/super-admin/ai-plans` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai/ai-plans-admin.controller.ts |
| PATCH | `/super-admin/ai-plans/{code}` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai/ai-plans-admin.controller.ts |
| POST | `/super-admin/ai-plans/{code}/assign` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai/ai-plans-admin.controller.ts |
| POST | `/super-admin/ai-plans/{code}/convert` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai/ai-plans-admin.controller.ts |
| PATCH | `/super-admin/ai-plans/{code}/unassign` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai/ai-plans-admin.controller.ts |
| POST | `/super-admin/ai-plans/convert-expired-trials` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai/ai-plans-admin.controller.ts |
| GET | `/super-admin/ai-plans/tenant/{tenantId}` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai/ai-plans-admin.controller.ts |
| GET | `/super-admin/ai-platform/models` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/ai/src/ai/ai-control-plane.controller.ts |
| GET | `/super-admin/ai-platform/overview` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/ai/src/ai/ai-control-plane.controller.ts |
| GET | `/super-admin/ai-platform/providers` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/ai/src/ai/ai-control-plane.controller.ts |
| GET | `/super-admin/ai-platform/routing` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/ai/src/ai/ai-control-plane.controller.ts |
| GET | `/super-admin/ai-platform/tenants` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/ai/src/ai/ai-control-plane.controller.ts |
| GET | `/super-admin/ai-queue-assignment/overview` | session | super_admin.operations.view | ai | SuperAdminGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-superadmin.controller.ts |
| GET | `/super-admin/ai-queue-assignment/tenants` | session | super_admin.operations.view | ai | SuperAdminGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-superadmin.controller.ts |
| GET | `/super-admin/ai-queue-assignment/tenants/{tenantId}` | session | super_admin.operations.view | ai | SuperAdminGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-superadmin.controller.ts |
| POST | `/super-admin/ai-queue-assignment/tenants/{tenantId}/auto-kill` | session | super_admin.ai.manage | ai | SuperAdminGuard | modules/ai/src/ai-queue-assignment/ai-queue-assignment-superadmin.controller.ts |
| POST | `/super-admin/ai-report-deliveries/{id}/retry` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/report-delivery.controller.ts |
| GET | `/super-admin/ai-report-schedules` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/report-schedule.controller.ts |
| POST | `/super-admin/ai-report-schedules` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/report-schedule.controller.ts |
| PATCH | `/super-admin/ai-report-schedules/{id}/pause` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/report-schedule.controller.ts |
| PATCH | `/super-admin/ai-report-schedules/{id}/resume` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/report-schedule.controller.ts |
| GET | `/super-admin/ai-report-templates` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/report-template.controller.ts |
| POST | `/super-admin/ai-report-templates` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/report-template.controller.ts |
| POST | `/super-admin/ai-report-templates/{id}/archive` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/report-template.controller.ts |
| POST | `/super-admin/ai-report-templates/{id}/publish` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/report-template.controller.ts |
| POST | `/super-admin/ai-reports/generate` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/report-run.controller.ts |
| GET | `/super-admin/ai-reports/overview` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/ai-reports.controller.ts |
| GET | `/super-admin/ai-reports/runs/{id}` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/report-run.controller.ts |
| POST | `/super-admin/ai-reports/runs/{runId}/deliver` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/report-delivery.controller.ts |
| GET | `/super-admin/ai-reports/runs/{runId}/deliveries` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/report-delivery.controller.ts |
| GET | `/super-admin/ai-reports/runs/{runId}/narrative` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/report-template.controller.ts |
| POST | `/super-admin/ai-reports/runs/{runId}/narrative/commit` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/narrative-provenance.controller.ts |
| GET | `/super-admin/ai-reports/runs/{runId}/narrative/provenance` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-reports/narrative-provenance.controller.ts |
| GET | `/super-admin/ai-review-reputation/overview` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-review-reputation/super-admin-ai-review-reputation.controller.ts |
| GET | `/super-admin/ai-review-reputation/tenants/{tenantId}` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-review-reputation/super-admin-ai-review-reputation.controller.ts |
| GET | `/super-admin/ai-scheduling-optimizer/overview` | session | super_admin.operations.view | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-scheduling-optimizer/super-admin-ai-scheduling-optimizer.controller.ts |
| PUT | `/super-admin/ai-scheduling-optimizer/platform-switch` | session | super_admin.ai.manage | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-scheduling-optimizer/super-admin-ai-scheduling-optimizer.controller.ts |
| GET | `/super-admin/ai-scheduling-optimizer/tenants` | session | super_admin.operations.view | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-scheduling-optimizer/super-admin-ai-scheduling-optimizer.controller.ts |
| GET | `/super-admin/ai-scheduling-optimizer/tenants/{tenantId}` | session | super_admin.operations.view | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-scheduling-optimizer/super-admin-ai-scheduling-optimizer.controller.ts |
| POST | `/super-admin/ai-scheduling-optimizer/tenants/{tenantId}/disable` | session | super_admin.ai.manage | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-scheduling-optimizer/super-admin-ai-scheduling-optimizer.controller.ts |
| POST | `/super-admin/ai-scheduling-optimizer/tenants/{tenantId}/recommendations/{id}/retry` | session | super_admin.ai.manage | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-scheduling-optimizer/super-admin-ai-scheduling-optimizer.controller.ts |
| POST | `/super-admin/ai-scheduling-optimizer/tenants/{tenantId}/recommendations/{id}/rollback` | session | super_admin.ai.manage | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-scheduling-optimizer/super-admin-ai-scheduling-optimizer.controller.ts |
| GET | `/super-admin/ai-usage/overview` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-usage/super-admin-ai-usage.module.ts |
| GET | `/super-admin/ai-usage/prompts` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-usage/super-admin-ai-usage.module.ts |
| POST | `/super-admin/ai-usage/prompts` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-usage/super-admin-ai-usage.module.ts |
| POST | `/super-admin/ai-usage/providers` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-usage/super-admin-ai-usage.module.ts |
| POST | `/super-admin/ai-usage/providers/status` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai-usage/super-admin-ai-usage.module.ts |
| GET | `/super-admin/ai/packages` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai/ai-admin.controller.ts |
| GET | `/super-admin/ai/packages/{code}/tenants` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai/ai-admin.controller.ts |
| GET | `/super-admin/ai/readiness` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/ai/src/ai-readiness/ai-readiness.service.ts |
| POST | `/super-admin/ai/tenants/{tenantId}/subscriptions` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai/ai-admin.controller.ts |
| DELETE | `/super-admin/ai/tenants/{tenantId}/subscriptions/{code}` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai/ai-admin.controller.ts |
| PATCH | `/super-admin/ai/tenants/{tenantId}/subscriptions/{code}` | session | super_admin.ai.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai/ai-admin.controller.ts |
| GET | `/super-admin/ai/usage/stats` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai/ai-admin.controller.ts |
| GET | `/super-admin/ai/usage/summary` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-ai/ai-admin.controller.ts |
| GET | `/super-admin/alerts` | session | super_admin.system_operations.view (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-alerts/alerts.controller.ts |
| GET | `/super-admin/alerts/{id}` | session | super_admin.system_operations.view (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-alerts/alerts.controller.ts |
| POST | `/super-admin/alerts/{id}/notes` | session | super_admin.system.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-alerts/alerts.controller.ts |
| PATCH | `/super-admin/alerts/{id}/status` | session | super_admin.system.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-alerts/alerts.controller.ts |
| POST | `/super-admin/alerts/mark-all-read` | session | super_admin.system.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-alerts/alerts.controller.ts |
| GET | `/super-admin/alerts/recent` | session | super_admin.system_operations.view (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-alerts/alerts.controller.ts |
| GET | `/super-admin/alerts/summary` | session | super_admin.system_operations.view (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-alerts/alerts.controller.ts |
| POST | `/super-admin/alerts/sync` | session | super_admin.system.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-alerts/alerts.controller.ts |
| GET | `/super-admin/alerts/unread-count` | session | super_admin.system_operations.view (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-alerts/alerts.controller.ts |
| GET | `/super-admin/analytics` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-analytics/super-admin-analytics.controller.ts |
| GET | `/super-admin/analytics/export` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-analytics/super-admin-analytics.controller.ts |
| GET | `/super-admin/appointment-oversight/change-history` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-appointment-oversight/super-admin-appointment-oversight.controller.ts |
| GET | `/super-admin/appointment-oversight/correction/preview` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-appointment-oversight/super-admin-appointment-oversight.controller.ts |
| GET | `/super-admin/appointment-oversight/data-integrity` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-appointment-oversight/super-admin-appointment-oversight.controller.ts |
| GET | `/super-admin/appointment-oversight/duplicates` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-appointment-oversight/super-admin-appointment-oversight.controller.ts |
| GET | `/super-admin/appointment-oversight/failures` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-appointment-oversight/super-admin-appointment-oversight.controller.ts |
| GET | `/super-admin/appointment-oversight/history` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-appointment-oversight/super-admin-appointment-oversight.controller.ts |
| GET | `/super-admin/appointment-oversight/missing-info` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-appointment-oversight/super-admin-appointment-oversight.controller.ts |
| GET | `/super-admin/appointment-oversight/overlapping` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-appointment-oversight/super-admin-appointment-oversight.controller.ts |
| GET | `/super-admin/appointment-oversight/overview` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-appointment-oversight/super-admin-appointment-oversight.controller.ts |
| GET | `/super-admin/appointment-oversight/rescheduled` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-appointment-oversight/super-admin-appointment-oversight.controller.ts |
| GET | `/super-admin/appointment-oversight/search` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-appointment-oversight/super-admin-appointment-oversight.controller.ts |
| GET | `/super-admin/approvals` | session | super_admin.tenants.view | platform | SuperAdminGuard | modules/platform/src/platform-approvals/platform-approvals.ts |
| POST | `/super-admin/approvals/{id}/approve` | session | super_admin.tenants.edit (derived) | platform | SuperAdminGuard | modules/platform/src/platform-approvals/platform-approvals.ts |
| POST | `/super-admin/approvals/{id}/reject` | session | super_admin.tenants.edit (derived) | platform | SuperAdminGuard | modules/platform/src/platform-approvals/platform-approvals.ts |
| GET | `/super-admin/approvals/policies` | session | super_admin.tenants.view | platform | SuperAdminGuard | modules/platform/src/platform-approvals/platform-approvals.ts |
| POST | `/super-admin/approvals/policies/{action}` | session | super_admin.platform_roles.manage | platform | SuperAdminGuard | modules/platform/src/platform-approvals/platform-approvals.ts |
| GET | `/super-admin/audit-events` | session | super_admin.audit_logs.view (derived) | audit | SuperAdminGuard | modules/audit/src/audit.controller.ts |
| GET | `/super-admin/audit-logs/evidence-packs` | session | super_admin.audit_logs.view (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| GET | `/super-admin/audit-logs/evidence-packs/{id}` | session | super_admin.audit_logs.view (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/audit-logs/evidence-packs/{id}/download` | session | super_admin.audit.manage (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/audit-logs/evidence-packs/{id}/verify` | session | super_admin.audit.manage (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| GET | `/super-admin/audit-logs/export-flags` | session | super_admin.audit_logs.view (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/audit-logs/export-flags/{id}/review` | session | super_admin.audit.manage (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/audit-logs/export-flags/scan` | session | super_admin.audit.manage (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/audit-logs/exports` | session | super_admin.audit.manage (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| GET | `/super-admin/audit-logs/investigations` | session | super_admin.audit_logs.view (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/audit-logs/investigations` | session | super_admin.audit.manage (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| GET | `/super-admin/audit-logs/investigations/{id}` | session | super_admin.audit_logs.view (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/audit-logs/investigations/{id}/events` | session | super_admin.audit.manage (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/audit-logs/investigations/{id}/notes` | session | super_admin.audit.manage (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/audit-logs/investigations/{id}/status` | session | super_admin.audit.manage (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| GET | `/super-admin/audit-logs/legal-holds` | session | super_admin.audit_logs.view (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/audit-logs/legal-holds` | session | super_admin.audit.manage (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/audit-logs/legal-holds/{id}/release` | session | super_admin.audit.manage (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| GET | `/super-admin/audit-logs/overview` | session | super_admin.audit_logs.view (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| GET | `/super-admin/audit-logs/retention-policies` | session | super_admin.audit_logs.view (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/audit-logs/retention-policies` | session | super_admin.audit.manage (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| GET | `/super-admin/audit-logs/retention-policies/{category}/history` | session | super_admin.audit_logs.view (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| GET | `/super-admin/audit-logs/tamper-controls` | session | super_admin.audit_logs.view (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/audit-logs/tamper-controls` | session | super_admin.audit.manage (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/audit-logs/tamper-controls/{key}/verify` | session | super_admin.audit.manage (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-audit-logs/audit-logs.module.ts |
| POST | `/super-admin/automation-rules/exceptions` | session | super_admin.ai.manage (derived) | platform | SuperAdminGuard | modules/platform/src/super-admin-automation/super-admin-automation.controller.ts |
| POST | `/super-admin/automation-rules/failures/{id}/retry` | session | super_admin.ai.manage (derived) | platform | SuperAdminGuard | modules/platform/src/super-admin-automation/super-admin-automation.controller.ts |
| GET | `/super-admin/automation-rules/overview` | session | super_admin.ai.view (derived) | platform | SuperAdminGuard | modules/platform/src/super-admin-automation/super-admin-automation.controller.ts |
| POST | `/super-admin/automation-rules/rules` | session | super_admin.ai.manage (derived) | platform | SuperAdminGuard | modules/platform/src/super-admin-automation/super-admin-automation.controller.ts |
| POST | `/super-admin/automation-rules/rules/{id}/status` | session | super_admin.ai.manage (derived) | platform | SuperAdminGuard | modules/platform/src/super-admin-automation/super-admin-automation.controller.ts |
| POST | `/super-admin/automation-rules/rules/{id}/test` | session | super_admin.ai.manage (derived) | platform | SuperAdminGuard | modules/platform/src/super-admin-automation/super-admin-automation.controller.ts |
| POST | `/super-admin/automation-rules/test` | session | super_admin.ai.manage (derived) | platform | SuperAdminGuard | modules/platform/src/super-admin-automation/super-admin-automation.controller.ts |
| GET | `/super-admin/billing` | session | super_admin.billing.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| PATCH | `/super-admin/billing/{tenantId}/subscription` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/change-requests/{changeId}/review` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/credits/apply` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/cycle/run` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing-cycle.controller.ts |
| POST | `/super-admin/billing/discounts` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/exports` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/exports/jobs` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| GET | `/super-admin/billing/exports/jobs/{token}` | session | super_admin.billing.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| GET | `/super-admin/billing/exports/jobs/{token}/download` | session | super_admin.billing.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/exports/jobs/process` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/invoices` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/invoices/{invoiceNumber}/finalize` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/payments/retry` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| GET | `/super-admin/billing/subscriptions-overview` | session | super_admin.billing.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/subscriptions/add-ons` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/subscriptions/cancel` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/subscriptions/change-plan` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/subscriptions/extend-trial` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/subscriptions/pause` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/subscriptions/resume` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| GET | `/super-admin/billing/tenants/{tenantId}/profile` | session | super_admin.billing.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| POST | `/super-admin/billing/webhooks/ingest` | session | super_admin.billing.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-billing/billing.controller.ts |
| GET | `/super-admin/booking-checkin/ai-handoffs` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-booking-checkin/super-admin-booking-checkin.controller.ts |
| GET | `/super-admin/booking-checkin/booking-sources` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-booking-checkin/super-admin-booking-checkin.controller.ts |
| GET | `/super-admin/booking-checkin/check-in-performance` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-booking-checkin/super-admin-booking-checkin.controller.ts |
| GET | `/super-admin/booking-checkin/devices` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-booking-checkin/super-admin-booking-checkin.controller.ts |
| GET | `/super-admin/booking-checkin/export` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-booking-checkin/super-admin-booking-checkin.controller.ts |
| GET | `/super-admin/booking-checkin/failed-events` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-booking-checkin/super-admin-booking-checkin.controller.ts |
| POST | `/super-admin/booking-checkin/failed-events/{id}/retry` | session | super_admin.operations.manage (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-booking-checkin/super-admin-booking-checkin.controller.ts |
| GET | `/super-admin/booking-checkin/overview` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-booking-checkin/super-admin-booking-checkin.controller.ts |
| GET | `/super-admin/booking-checkin/wait-time-analysis` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-booking-checkin/super-admin-booking-checkin.controller.ts |
| POST | `/super-admin/booking-verification/emergency-disable` | session | super_admin.operations.manage (derived) | booking | SuperAdminGuard | modules/booking/src/customer-booking/booking-verification-oversight.controller.ts |
| GET | `/super-admin/booking-verification/health` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/booking/src/customer-booking/booking-verification-oversight.controller.ts |
| POST | `/super-admin/booking-verification/module` | session | super_admin.operations.manage (derived) | booking | SuperAdminGuard | modules/booking/src/customer-booking/booking-verification-oversight.controller.ts |
| GET | `/super-admin/booking-verification/policy` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/booking/src/customer-booking/booking-verification-oversight.controller.ts |
| GET | `/super-admin/booking-verification/tenants` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/booking/src/customer-booking/booking-verification-oversight.controller.ts |
| PATCH | `/super-admin/booking-verification/tenants/{tenantId}` | session | super_admin.operations.manage (derived) | booking | SuperAdminGuard | modules/booking/src/customer-booking/booking-verification-oversight.controller.ts |
| GET | `/super-admin/branch-health` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/branch-health.ts |
| GET | `/super-admin/campaigns` | session | super_admin.communications.view (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/super-admin/campaigns/announcements` | session | super_admin.communications.view (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| POST | `/super-admin/campaigns/announcements` | session | super_admin.communications.manage (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| POST | `/super-admin/campaigns/announcements/{id}/cancel` | session | super_admin.communications.manage (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| POST | `/super-admin/campaigns/announcements/{id}/schedule` | session | super_admin.communications.manage (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| POST | `/super-admin/campaigns/announcements/{id}/send` | session | super_admin.communications.manage (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/super-admin/campaigns/compliance/alerts` | session | super_admin.communications.view (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/super-admin/campaigns/compliance/flags` | session | super_admin.communications.view (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/super-admin/campaigns/compliance/limits` | session | super_admin.communications.view (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| POST | `/super-admin/campaigns/compliance/limits` | session | super_admin.communications.manage (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| POST | `/super-admin/campaigns/compliance/pause` | session | super_admin.communications.manage (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/super-admin/campaigns/delivery-failures` | session | super_admin.communications.view (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/super-admin/campaigns/delivery-summary` | session | super_admin.communications.view (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/super-admin/campaigns/marketing-overview` | session | super_admin.communications.view (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/super-admin/campaigns/performance-trend` | session | super_admin.communications.view (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/super-admin/campaigns/promotions` | session | super_admin.communications.view (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/super-admin/campaigns/state` | session | super_admin.communications.view (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/super-admin/campaigns/templates` | session | super_admin.communications.view (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| POST | `/super-admin/campaigns/templates` | session | super_admin.communications.manage (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| POST | `/super-admin/campaigns/templates/{id}/publish` | session | super_admin.communications.manage (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/super-admin/campaigns/templates/{id}/versions` | session | super_admin.communications.view (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| POST | `/super-admin/campaigns/templates/{id}/versions` | session | super_admin.communications.manage (derived) | marketing | SuperAdminGuard | modules/communications/src/campaigns/campaigns.controller.ts |
| GET | `/super-admin/catalog/categories` | session | super_admin.catalog.view (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| POST | `/super-admin/catalog/categories` | session | super_admin.catalog.manage (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| PATCH | `/super-admin/catalog/categories/{code}` | session | super_admin.catalog.manage (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| PATCH | `/super-admin/catalog/deployments/{deploymentId}/customizable` | session | super_admin.catalog.manage (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| GET | `/super-admin/catalog/service-templates` | session | super_admin.catalog.view (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| POST | `/super-admin/catalog/service-templates` | session | super_admin.catalog.manage (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| GET | `/super-admin/catalog/service-templates/{id}` | session | super_admin.catalog.view (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| PATCH | `/super-admin/catalog/service-templates/{id}` | session | super_admin.catalog.manage (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| GET | `/super-admin/catalog/service-templates/{id}/comparison` | session | super_admin.catalog.view (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| POST | `/super-admin/catalog/service-templates/{id}/deploy` | session | super_admin.catalog.manage (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| GET | `/super-admin/catalog/service-templates/{id}/deploy-preview` | session | super_admin.catalog.view (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| POST | `/super-admin/catalog/service-templates/{id}/publish` | session | super_admin.catalog.manage (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| POST | `/super-admin/catalog/service-templates/{id}/retire` | session | super_admin.catalog.manage (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| GET | `/super-admin/catalog/service-templates/export` | session | super_admin.catalog.view (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| GET | `/super-admin/catalog/service-templates/overview` | session | super_admin.catalog.view (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-catalog/service-templates.controller.ts |
| GET | `/super-admin/checkin/overview` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-checkin/super-admin-checkin.controller.ts |
| POST | `/super-admin/commission-auth-code/generate` | session | super_admin.tenants.edit | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| GET | `/super-admin/commission-oversight` | session | super_admin.tenants.view | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| GET | `/super-admin/communications/announcements` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| POST | `/super-admin/communications/announcements` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| GET | `/super-admin/communications/announcements/eligible-roles` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| GET | `/super-admin/communications/overview` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| GET | `/super-admin/communications/platform-announcements` | session | super_admin.communications.view | communications | SuperAdminGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| POST | `/super-admin/communications/platform-announcements` | session | super_admin.communications.manage | communications | SuperAdminGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| GET | `/super-admin/communications/platform-announcements/{id}` | session | super_admin.communications.view | communications | SuperAdminGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| PATCH | `/super-admin/communications/platform-announcements/{id}` | session | super_admin.communications.manage | communications | SuperAdminGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| POST | `/super-admin/communications/platform-announcements/{id}/archive` | session | super_admin.communications.manage | communications | SuperAdminGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| POST | `/super-admin/communications/platform-announcements/{id}/duplicate` | session | super_admin.communications.manage | communications | SuperAdminGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| POST | `/super-admin/communications/platform-announcements/{id}/pause` | session | super_admin.communications.manage | communications | SuperAdminGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| POST | `/super-admin/communications/platform-announcements/{id}/publish` | session | super_admin.communications.manage | communications | SuperAdminGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| POST | `/super-admin/communications/platform-announcements/{id}/resume` | session | super_admin.communications.manage | communications | SuperAdminGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| GET | `/super-admin/communications/platform-announcements/audience/tenants` | session | super_admin.communications.view | communications | SuperAdminGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| GET | `/super-admin/communications/platform-announcements/audience/tenants/{tenantId}/branches` | session | super_admin.communications.view | communications | SuperAdminGuard | modules/communications/src/platform-announcements/platform-notice.controller.ts |
| GET | `/super-admin/communications/providers` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| POST | `/super-admin/communications/providers` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| GET | `/super-admin/communications/providers/{id}` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| PATCH | `/super-admin/communications/providers/{id}` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| POST | `/super-admin/communications/providers/{id}/rotate-credential` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| POST | `/super-admin/communications/providers/{id}/test` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| GET | `/super-admin/communications/state` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| GET | `/super-admin/communications/templates` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| POST | `/super-admin/communications/templates` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| GET | `/super-admin/communications/templates/{id}` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| POST | `/super-admin/communications/templates/{id}/versions` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| POST | `/super-admin/communications/templates/{id}/versions/{version}/publish` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| POST | `/super-admin/communications/templates/preview` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| GET | `/super-admin/communications/tenants/{tenantId}/limits` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| POST | `/super-admin/communications/tenants/{tenantId}/limits` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/communications/src/communications/communications.controller.ts |
| GET | `/super-admin/community-moderation/actions` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/analytics` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/appeals` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| POST | `/super-admin/community-moderation/appeals/{id}/decide` | session | super_admin.technicians.manage (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/cases` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| POST | `/super-admin/community-moderation/cases` | session | super_admin.technicians.manage (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/cases/{id}` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| PATCH | `/super-admin/community-moderation/cases/{id}` | session | super_admin.technicians.manage (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| POST | `/super-admin/community-moderation/comments/{id}/actions` | session | super_admin.technicians.manage (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/disputes` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| POST | `/super-admin/community-moderation/disputes/{id}/decide` | session | super_admin.technicians.manage (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/evidence` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/evidence/{id}/access` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| POST | `/super-admin/community-moderation/evidence/{id}/review` | session | super_admin.technicians.manage (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| POST | `/super-admin/community-moderation/incidents/{id}/access` | session | super_admin.technicians.manage (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/overview` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/posts` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/posts/{id}` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| POST | `/super-admin/community-moderation/posts/{id}/actions` | session | super_admin.technicians.manage (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/posts/{id}/comments` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/reports` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| POST | `/super-admin/community-moderation/reports/{id}/resolve` | session | super_admin.technicians.manage (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/restrictions` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/settings` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| PUT | `/super-admin/community-moderation/settings` | session | super_admin.technicians.manage (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/tenants` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/community-moderation/tenants/{tenantId}` | session | super_admin.technicians.view (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| POST | `/super-admin/community-moderation/tenants/{tenantId}/actions` | session | super_admin.technicians.manage (derived) | support | SuperAdminGuard | modules/safety/src/tenant-safety-community/community-moderation.controller.ts |
| GET | `/super-admin/compensation/overview` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-compensation/super-admin-compensation.controller.ts |
| GET | `/super-admin/copilot/system-status` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/ai/src/ai-center/super-admin-copilot.controller.ts |
| GET | `/super-admin/copilot/usage` | session | super_admin.ai.view (derived) | ai | SuperAdminGuard | modules/ai/src/ai-center/super-admin-copilot.controller.ts |
| GET | `/super-admin/customer-data-oversight/audit` | session | super_admin.customers.view (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| GET | `/super-admin/customer-data-oversight/deletions` | session | super_admin.customers.view (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| POST | `/super-admin/customer-data-oversight/deletions` | session | super_admin.customers.manage (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| POST | `/super-admin/customer-data-oversight/deletions/{id}/approve` | session | super_admin.customers.manage (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| POST | `/super-admin/customer-data-oversight/deletions/{id}/execute` | session | super_admin.customers.manage (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| POST | `/super-admin/customer-data-oversight/deletions/{id}/reject` | session | super_admin.customers.manage (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| GET | `/super-admin/customer-data-oversight/imports` | session | super_admin.customers.view (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| POST | `/super-admin/customer-data-oversight/imports` | session | super_admin.customers.manage (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| POST | `/super-admin/customer-data-oversight/imports/{id}/approve` | session | super_admin.customers.manage (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| POST | `/super-admin/customer-data-oversight/imports/{id}/reject` | session | super_admin.customers.manage (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| POST | `/super-admin/customer-data-oversight/imports/{id}/retry` | session | super_admin.customers.manage (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| POST | `/super-admin/customer-data-oversight/imports/process` | session | super_admin.customers.manage (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| GET | `/super-admin/customer-data-oversight/legal-holds` | session | super_admin.customers.view (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| POST | `/super-admin/customer-data-oversight/legal-holds` | session | super_admin.customers.manage (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| POST | `/super-admin/customer-data-oversight/legal-holds/{id}/release` | session | super_admin.customers.manage (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| GET | `/super-admin/customer-data-oversight/merges` | session | super_admin.customers.view (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| GET | `/super-admin/customer-data-oversight/overview` | session | super_admin.customers.view (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| GET | `/super-admin/customer-data-oversight/sync/conflicts` | session | super_admin.customer_sync.review | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| POST | `/super-admin/customer-data-oversight/sync/conflicts/{id}/status` | session | super_admin.customer_sync.resolve_conflict | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| GET | `/super-admin/customer-data-oversight/sync/dashboard` | session | super_admin.customer_sync.view | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| POST | `/super-admin/customer-data-oversight/sync/merge` | session | super_admin.customer_sync.merge | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| GET | `/super-admin/customer-data-oversight/sync/merge-preview` | session | super_admin.customer_sync.review | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| POST | `/super-admin/customer-data-oversight/sync/run` | session | super_admin.customer_sync.run | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| GET | `/super-admin/customer-data-oversight/sync/runs` | session | super_admin.customer_sync.view | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| GET | `/super-admin/customer-data-oversight/sync/runs/{id}` | session | super_admin.customer_sync.view | customers | SuperAdminGuard | modules/super-admin/src/super-admin-customer-data/super-admin-customer-data.controller.ts |
| GET | `/super-admin/customer-phone/oversight` | session | super_admin.customers.view (derived) | identity | SuperAdminGuard | modules/booking/src/customer-phone/customer-phone-settings.controller.ts |
| GET | `/super-admin/customer-phone/oversight/tenants` | session | super_admin.customers.view (derived) | identity | SuperAdminGuard | modules/booking/src/customer-phone/customer-phone-settings.controller.ts |
| POST | `/super-admin/customer-phone/sweep` | session | super_admin.customers.manage | identity | SuperAdminGuard | modules/booking/src/customer-phone/customer-phone-settings.controller.ts |
| GET | `/super-admin/dashboard` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-dashboard/dashboard.controller.ts |
| GET | `/super-admin/database/activity` | session | super_admin.database.view | operations | SuperAdminGuard | modules/super-admin/src/super-admin-database/database.controller.ts |
| POST | `/super-admin/database/backends/{pid}/cancel` | session | super_admin.database.manage | operations | SuperAdminGuard | modules/super-admin/src/super-admin-database/database.controller.ts |
| POST | `/super-admin/database/deferred-constraints/{id}/retry` | session | super_admin.database.manage | operations | SuperAdminGuard | modules/super-admin/src/super-admin-database/database.controller.ts |
| GET | `/super-admin/database/growth` | session | super_admin.database.view | operations | SuperAdminGuard | modules/super-admin/src/super-admin-database/database.controller.ts |
| GET | `/super-admin/database/indexes` | session | super_admin.database.view | operations | SuperAdminGuard | modules/super-admin/src/super-admin-database/database.controller.ts |
| GET | `/super-admin/database/overview` | session | super_admin.database.view | operations | SuperAdminGuard | modules/super-admin/src/super-admin-database/database.controller.ts |
| GET | `/super-admin/database/retention-runs` | session | super_admin.database.view | operations | SuperAdminGuard | modules/super-admin/src/super-admin-database/database.controller.ts |
| GET | `/super-admin/database/schema-health` | session | super_admin.database.view | operations | SuperAdminGuard | modules/super-admin/src/super-admin-database/database.controller.ts |
| GET | `/super-admin/database/slow-queries` | session | super_admin.database.view | operations | SuperAdminGuard | modules/super-admin/src/super-admin-database/database.controller.ts |
| POST | `/super-admin/database/snapshots` | session | super_admin.database.manage | operations | SuperAdminGuard | modules/super-admin/src/super-admin-database/database.controller.ts |
| GET | `/super-admin/database/tables` | session | super_admin.database.view | operations | SuperAdminGuard | modules/super-admin/src/super-admin-database/database.controller.ts |
| POST | `/super-admin/database/tables/{table}/vacuum-analyze` | session | super_admin.database.manage | operations | SuperAdminGuard | modules/super-admin/src/super-admin-database/database.controller.ts |
| GET | `/super-admin/deals` | session | super_admin.marketing.view (derived) | deals | SuperAdminGuard | modules/deals/src/deals/deals.super-admin.controller.ts |
| POST | `/super-admin/deals/{id}/suspend` | session | super_admin.marketing.manage (derived) | deals | SuperAdminGuard | modules/deals/src/deals/deals.super-admin.controller.ts |
| GET | `/super-admin/deals/overview` | session | super_admin.marketing.view (derived) | deals | SuperAdminGuard | modules/deals/src/deals/deals.super-admin.controller.ts |
| GET | `/super-admin/deals/tenants` | session | super_admin.marketing.view (derived) | deals | SuperAdminGuard | modules/deals/src/deals/deals.super-admin.controller.ts |
| PATCH | `/super-admin/deals/tenants/{tenantId}` | session | super_admin.marketing.manage (derived) | deals | SuperAdminGuard | modules/deals/src/deals/deals.super-admin.controller.ts |
| GET | `/super-admin/device-management/devices` | session | super_admin.system_operations.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-device-management/super-admin-device-management.module.ts |
| GET | `/super-admin/device-management/devices/{id}` | session | super_admin.system_operations.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-device-management/super-admin-device-management.module.ts |
| GET | `/super-admin/device-management/overview` | session | super_admin.system_operations.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-device-management/super-admin-device-management.module.ts |
| GET | `/super-admin/disputes` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| GET | `/super-admin/disputes/{id}` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| GET | `/super-admin/disputes/{id}/evidence` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| POST | `/super-admin/disputes/{id}/evidence` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| POST | `/super-admin/disputes/{id}/evidence/{evidenceId}/review` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| POST | `/super-admin/disputes/{id}/evidence/request` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| POST | `/super-admin/disputes/{id}/notify-tenant` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| POST | `/super-admin/disputes/{id}/outcome` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| GET | `/super-admin/disputes/{id}/review` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| POST | `/super-admin/disputes/{id}/submit` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| GET | `/super-admin/disputes/deadlines` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| POST | `/super-admin/disputes/exports` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| GET | `/super-admin/disputes/high-risk-merchants` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| POST | `/super-admin/disputes/merchant-risk/{tenantId}/flag` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| GET | `/super-admin/disputes/overview` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| GET | `/super-admin/disputes/patterns` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-disputes/disputes.controller.ts |
| GET | `/super-admin/events/dead-letters` | session | super_admin.system_operations.view (derived) | operations | EventPermissionGuard + SuperAdminGuard | events/event-ops.controller.ts |
| POST | `/super-admin/events/dead-letters/{id}/discard` | session | super_admin.system.manage (derived) | operations | EventPermissionGuard + SuperAdminGuard | events/event-ops.controller.ts |
| POST | `/super-admin/events/dead-letters/{id}/retry` | session | super_admin.system.manage (derived) | operations | EventPermissionGuard + SuperAdminGuard | events/event-ops.controller.ts |
| GET | `/super-admin/events/health` | session | super_admin.system_operations.view (derived) | operations | EventPermissionGuard + SuperAdminGuard | events/event-ops.controller.ts |
| POST | `/super-admin/events/replay` | session | super_admin.system.manage (derived) | operations | EventPermissionGuard + SuperAdminGuard | events/event-ops.controller.ts |
| GET | `/super-admin/events/replay/consumers` | session | super_admin.system_operations.view (derived) | operations | EventPermissionGuard + SuperAdminGuard | events/event-ops.controller.ts |
| POST | `/super-admin/events/replay/preview` | session | super_admin.system.manage (derived) | operations | EventPermissionGuard + SuperAdminGuard | events/event-ops.controller.ts |
| GET | `/super-admin/events/search` | session | super_admin.system_operations.view (derived) | operations | EventPermissionGuard + SuperAdminGuard | events/event-ops.controller.ts |
| GET | `/super-admin/features` | session | super_admin.plans.view | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/feature-registry.ts |
| PATCH | `/super-admin/features/{key}` | session | super_admin.plans.manage | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/feature-registry.ts |
| GET | `/super-admin/features/{key}/resolve` | session | super_admin.plans.view | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/feature-registry.ts |
| GET | `/super-admin/features/{key}/rollout` | session | super_admin.plans.view | platform | SuperAdminGuard | common/platform-flags.ts |
| PUT | `/super-admin/features/{key}/rollout` | session | super_admin.plans.manage | platform | SuperAdminGuard | common/platform-flags.ts |
| GET | `/super-admin/features/rollouts` | session | super_admin.plans.view | platform | SuperAdminGuard | common/platform-flags.ts |
| GET | `/super-admin/gift-cards/programs` | session | super_admin.marketing.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-gift-card-programs/gift-card-programs.controller.ts |
| POST | `/super-admin/gift-cards/programs` | session | super_admin.marketing.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-gift-card-programs/gift-card-programs.controller.ts |
| PATCH | `/super-admin/gift-cards/programs/{id}` | session | super_admin.marketing.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-gift-card-programs/gift-card-programs.controller.ts |
| POST | `/super-admin/gift-cards/programs/{id}/members` | session | super_admin.marketing.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-gift-card-programs/gift-card-programs.controller.ts |
| PATCH | `/super-admin/gift-cards/programs/{id}/members/{tenantId}` | session | super_admin.marketing.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-gift-card-programs/gift-card-programs.controller.ts |
| GET | `/super-admin/gift-cards/settlement` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-gift-card-settlement/gift-card-settlement.controller.ts |
| POST | `/super-admin/gift-cards/settlement/batches` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-gift-card-settlement/gift-card-settlement.controller.ts |
| GET | `/super-admin/gift-cards/settlement/batches/{id}` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-gift-card-settlement/gift-card-settlement.controller.ts |
| PATCH | `/super-admin/gift-cards/settlement/batches/{id}` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-gift-card-settlement/gift-card-settlement.controller.ts |
| GET | `/super-admin/hardware-packages` | session | super_admin.billing.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| POST | `/super-admin/hardware-packages` | session | super_admin.billing.manage (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| GET | `/super-admin/hardware-packages/{packageId}` | session | super_admin.billing.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| PATCH | `/super-admin/hardware-packages/{packageId}` | session | super_admin.billing.manage (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| POST | `/super-admin/hardware-packages/{packageId}/cancel` | session | super_admin.billing.manage (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| POST | `/super-admin/hardware-packages/{packageId}/devices` | session | super_admin.billing.manage (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| POST | `/super-admin/hardware-packages/{packageId}/notes` | session | super_admin.billing.manage (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| PATCH | `/super-admin/hardware-packages/{packageId}/payment-status` | session | super_admin.billing.manage (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| POST | `/super-admin/hardware-packages/{packageId}/return` | session | super_admin.billing.manage (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| PATCH | `/super-admin/hardware-packages/{packageId}/status` | session | super_admin.billing.manage (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| PATCH | `/super-admin/hardware-packages/{packageId}/tracking` | session | super_admin.billing.manage (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| GET | `/super-admin/hardware-packages/activity/recent` | session | super_admin.billing.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| GET | `/super-admin/hardware-packages/events` | session | super_admin.billing.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| GET | `/super-admin/hardware-packages/export` | session | super_admin.billing.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| GET | `/super-admin/hardware-packages/package-types` | session | super_admin.billing.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| GET | `/super-admin/hardware-packages/state` | session | super_admin.billing.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| GET | `/super-admin/hardware-packages/status-breakdown` | session | super_admin.billing.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| GET | `/super-admin/hardware-packages/summary` | session | super_admin.billing.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| GET | `/super-admin/hardware-packages/tenants` | session | super_admin.billing.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| GET | `/super-admin/hardware-payment/reports` | session | super_admin.billing.view (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| POST | `/super-admin/hardware-payment/run-monthly` | session | super_admin.billing.manage (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| GET | `/super-admin/hardware-payment/settings` | session | super_admin.billing.view (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| PATCH | `/super-admin/hardware-payment/settings` | session | super_admin.billing.manage (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| POST | `/super-admin/help/sla-sweep` | session | super_admin.support.manage (derived) | support | SuperAdminGuard | modules/support/src/help/sla-sweep.controller.ts |
| GET | `/super-admin/integrations/alerts` | session | super_admin.integrations.view (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/super-admin-integrations.controller.ts |
| GET | `/super-admin/integrations/connected` | session | super_admin.integrations.view (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/super-admin-integrations.controller.ts |
| GET | `/super-admin/integrations/connections` | session | super_admin.integrations.view (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-lifecycle.controller.ts |
| POST | `/super-admin/integrations/connections` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-lifecycle.controller.ts |
| POST | `/super-admin/integrations/connections/{id}/auth/refresh` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-lifecycle.controller.ts |
| POST | `/super-admin/integrations/connections/{id}/circuit/reset` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/provider-reliability.controller.ts |
| GET | `/super-admin/integrations/connections/{id}/credentials` | session | super_admin.integrations.view (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-lifecycle.controller.ts |
| POST | `/super-admin/integrations/connections/{id}/credentials` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-lifecycle.controller.ts |
| POST | `/super-admin/integrations/connections/{id}/credentials/rotate` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-lifecycle.controller.ts |
| POST | `/super-admin/integrations/connections/{id}/disable` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/super-admin-integrations.controller.ts |
| POST | `/super-admin/integrations/connections/{id}/enable` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/super-admin-integrations.controller.ts |
| POST | `/super-admin/integrations/connections/{id}/lifecycle-disable` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-lifecycle.controller.ts |
| POST | `/super-admin/integrations/connections/{id}/oauth/begin` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-lifecycle.controller.ts |
| POST | `/super-admin/integrations/connections/{id}/oauth/complete` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-lifecycle.controller.ts |
| GET | `/super-admin/integrations/connections/{id}/reliability` | session | super_admin.integrations.view (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/provider-reliability.controller.ts |
| POST | `/super-admin/integrations/connections/{id}/sync` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-sync.controller.ts |
| GET | `/super-admin/integrations/connections/{id}/syncs` | session | super_admin.integrations.view (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-sync.controller.ts |
| POST | `/super-admin/integrations/connections/{id}/test` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-lifecycle.controller.ts |
| GET | `/super-admin/integrations/connections/{id}/webhook-events` | session | super_admin.integrations.view (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-webhook.controller.ts |
| GET | `/super-admin/integrations/errors` | session | super_admin.integrations.view (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/super-admin-integrations.controller.ts |
| GET | `/super-admin/integrations/export` | session | super_admin.integrations.view (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/super-admin-integrations.controller.ts |
| GET | `/super-admin/integrations/marketplace` | session | super_admin.integrations.view (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/super-admin-integrations.controller.ts |
| GET | `/super-admin/integrations/overview` | session | super_admin.integrations.view (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/super-admin-integrations.controller.ts |
| GET | `/super-admin/integrations/providers` | session | super_admin.integrations.view (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-lifecycle.controller.ts |
| POST | `/super-admin/integrations/scheduler/tick` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-scheduler.controller.ts |
| POST | `/super-admin/integrations/sync/{jobId}/retry` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-sync.controller.ts |
| POST | `/super-admin/integrations/sync/drain` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-sync.controller.ts |
| GET | `/super-admin/integrations/tenant-usage` | session | super_admin.integrations.view (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/super-admin-integrations.controller.ts |
| POST | `/super-admin/integrations/webhook-events/{eventId}/retry` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-webhook.controller.ts |
| POST | `/super-admin/integrations/webhook/drain` | session | super_admin.integrations.manage (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/integration-webhook.controller.ts |
| GET | `/super-admin/integrations/webhooks/events` | session | super_admin.integrations.view (derived) | operations | IntegrationPermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-integrations/super-admin-integrations.controller.ts |
| GET | `/super-admin/jobs` | session | super_admin.system_operations.view | operations | SuperAdminGuard | jobs/jobs.controller.ts |
| POST | `/super-admin/jobs/{id}/cancel` | session | super_admin.system.manage | operations | SuperAdminGuard | jobs/jobs.controller.ts |
| POST | `/super-admin/jobs/{id}/retry` | session | super_admin.system.manage | operations | SuperAdminGuard | jobs/jobs.controller.ts |
| POST | `/super-admin/jobs/self-test` | session | super_admin.system.manage | operations | SuperAdminGuard | jobs/jobs.controller.ts |
| GET | `/super-admin/jobs/stats` | session | super_admin.system_operations.view | operations | SuperAdminGuard | jobs/jobs.controller.ts |
| GET | `/super-admin/kill-switches` | session | super_admin.system_operations.view | platform | SuperAdminGuard | modules/super-admin/src/super-admin-kill-switches/kill-switches.ts |
| POST | `/super-admin/kill-switches/{key}` | session | super_admin.system.manage | platform | SuperAdminGuard | modules/super-admin/src/super-admin-kill-switches/kill-switches.ts |
| GET | `/super-admin/loyalty/config` | session | super_admin.marketing.view (derived) | loyalty | SuperAdminGuard | modules/super-admin/src/super-admin-loyalty/super-admin-loyalty.controller.ts |
| PUT | `/super-admin/loyalty/config` | session | super_admin.marketing.manage (derived) | loyalty | SuperAdminGuard | modules/super-admin/src/super-admin-loyalty/super-admin-loyalty.controller.ts |
| GET | `/super-admin/loyalty/corrections` | session | super_admin.marketing.view (derived) | loyalty | SuperAdminGuard | modules/super-admin/src/super-admin-loyalty/super-admin-loyalty.controller.ts |
| POST | `/super-admin/loyalty/corrections/{id}/review` | session | super_admin.marketing.manage (derived) | loyalty | SuperAdminGuard | modules/super-admin/src/super-admin-loyalty/super-admin-loyalty.controller.ts |
| POST | `/super-admin/loyalty/corrections/detect` | session | super_admin.marketing.manage (derived) | loyalty | SuperAdminGuard | modules/super-admin/src/super-admin-loyalty/super-admin-loyalty.controller.ts |
| GET | `/super-admin/loyalty/dashboard` | session | super_admin.marketing.view (derived) | loyalty | SuperAdminGuard | modules/super-admin/src/super-admin-loyalty/super-admin-loyalty.controller.ts |
| GET | `/super-admin/loyalty/export` | session | super_admin.marketing.view (derived) | loyalty | SuperAdminGuard | modules/super-admin/src/super-admin-loyalty/super-admin-loyalty.controller.ts |
| GET | `/super-admin/loyalty/export-xlsx` | session | super_admin.marketing.view (derived) | loyalty | SuperAdminGuard | modules/super-admin/src/super-admin-loyalty/super-admin-loyalty.controller.ts |
| GET | `/super-admin/loyalty/overview` | session | super_admin.marketing.view (derived) | loyalty | SuperAdminGuard | modules/super-admin/src/super-admin-loyalty/super-admin-loyalty.controller.ts |
| GET | `/super-admin/loyalty/suspicious` | session | super_admin.marketing.view (derived) | loyalty | SuperAdminGuard | modules/super-admin/src/super-admin-loyalty/super-admin-loyalty.controller.ts |
| POST | `/super-admin/loyalty/suspicious/{id}/transition` | session | super_admin.marketing.manage (derived) | loyalty | SuperAdminGuard | modules/super-admin/src/super-admin-loyalty/super-admin-loyalty.controller.ts |
| POST | `/super-admin/loyalty/suspicious/detect` | session | super_admin.marketing.manage (derived) | loyalty | SuperAdminGuard | modules/super-admin/src/super-admin-loyalty/super-admin-loyalty.controller.ts |
| GET | `/super-admin/loyalty/templates` | session | super_admin.marketing.view (derived) | loyalty | SuperAdminGuard | modules/super-admin/src/super-admin-loyalty/super-admin-loyalty.controller.ts |
| POST | `/super-admin/loyalty/templates` | session | super_admin.marketing.manage (derived) | loyalty | SuperAdminGuard | modules/super-admin/src/super-admin-loyalty/super-admin-loyalty.controller.ts |
| GET | `/super-admin/membership-programs/billing-failures` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| GET | `/super-admin/membership-programs/cancellations` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| GET | `/super-admin/membership-programs/controls` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| POST | `/super-admin/membership-programs/corrections` | session | super_admin.marketing.manage (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| GET | `/super-admin/membership-programs/credits-summary` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| GET | `/super-admin/membership-programs/duplicate-charges` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| POST | `/super-admin/membership-programs/enabled` | session | super_admin.marketing.manage (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| POST | `/super-admin/membership-programs/exports` | session | super_admin.marketing.manage (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| POST | `/super-admin/membership-programs/limits` | session | super_admin.marketing.manage (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| GET | `/super-admin/membership-programs/members` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| GET | `/super-admin/membership-programs/overview` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| POST | `/super-admin/membership-programs/plan-gating` | session | super_admin.marketing.manage (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| GET | `/super-admin/membership-programs/programs` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| POST | `/super-admin/membership-programs/programs/{id}/disable` | session | super_admin.marketing.manage (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| GET | `/super-admin/membership-programs/programs/{id}/impact` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| GET | `/super-admin/membership-programs/revenue` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| POST | `/super-admin/membership-programs/rules` | session | super_admin.marketing.manage (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| POST | `/super-admin/membership-programs/support-sessions` | session | super_admin.marketing.manage (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| POST | `/super-admin/membership-programs/support-sessions/{id}/exit` | session | super_admin.marketing.manage (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| GET | `/super-admin/membership-programs/support-sessions/active` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| GET | `/super-admin/membership-programs/suspicious` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| POST | `/super-admin/membership-programs/templates` | session | super_admin.marketing.manage (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| PATCH | `/super-admin/membership-programs/templates/{id}` | session | super_admin.marketing.manage (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-membership-programs/membership-programs.controller.ts |
| GET | `/super-admin/memberships/members/{membershipId}` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-memberships/super-admin-memberships.controller.ts |
| GET | `/super-admin/memberships/overview` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-memberships/super-admin-memberships.controller.ts |
| GET | `/super-admin/memberships/plans/{planId}` | session | super_admin.marketing.view (derived) | memberships | SuperAdminGuard | modules/super-admin/src/super-admin-memberships/super-admin-memberships.controller.ts |
| GET | `/super-admin/merchant-accounts` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-merchant-accounts/super-admin-merchant-accounts.controller.ts |
| POST | `/super-admin/merchant-accounts/{tenantId}/activation` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-merchant-accounts/super-admin-merchant-accounts.controller.ts |
| POST | `/super-admin/merchant-accounts/{tenantId}/deactivation` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-merchant-accounts/super-admin-merchant-accounts.controller.ts |
| POST | `/super-admin/merchant-accounts/{tenantId}/funding-update` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-merchant-accounts/super-admin-merchant-accounts.controller.ts |
| POST | `/super-admin/merchant-accounts/{tenantId}/mid-assignment` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-merchant-accounts/super-admin-merchant-accounts.controller.ts |
| POST | `/super-admin/merchant-accounts/{tenantId}/rates` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-merchant-accounts/super-admin-merchant-accounts.controller.ts |
| POST | `/super-admin/merchant-accounts/{tenantId}/suspension` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-merchant-accounts/super-admin-merchant-accounts.controller.ts |
| POST | `/super-admin/merchant-accounts/{tenantId}/terminals` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-merchant-accounts/super-admin-merchant-accounts.controller.ts |
| GET | `/super-admin/merchant-accounts/export` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-merchant-accounts/super-admin-merchant-accounts.controller.ts |
| GET | `/super-admin/merchant-accounts/overview` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-merchant-accounts/super-admin-merchant-accounts.controller.ts |
| GET | `/super-admin/messaging/readiness` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/communications/src/messaging-readiness/messaging-readiness.service.ts |
| GET | `/super-admin/mobile-versions` | session | super_admin.mobile_versions.view | operations | SuperAdminGuard | mobile-config/app-config.controller.ts |
| PUT | `/super-admin/mobile-versions/{app}/{platform}` | session | super_admin.mobile_versions.manage | operations | SuperAdminGuard | mobile-config/app-config.controller.ts |
| PATCH | `/super-admin/nail-showcase/comments/{commentId}/remove` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/workforce/src/nail-showcase/nail-showcase.super-admin.controller.ts |
| PATCH | `/super-admin/nail-showcase/posts/{postId}/remove` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/workforce/src/nail-showcase/nail-showcase.super-admin.controller.ts |
| PATCH | `/super-admin/nail-showcase/profiles/{customerId}/suspend` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/workforce/src/nail-showcase/nail-showcase.super-admin.controller.ts |
| PATCH | `/super-admin/nail-showcase/profiles/{customerId}/unsuspend` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/workforce/src/nail-showcase/nail-showcase.super-admin.controller.ts |
| GET | `/super-admin/nail-showcase/reported-profiles` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/workforce/src/nail-showcase/nail-showcase.super-admin.controller.ts |
| GET | `/super-admin/nail-showcase/reports` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/workforce/src/nail-showcase/nail-showcase.super-admin.controller.ts |
| PATCH | `/super-admin/nail-showcase/reports/{reportId}` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/workforce/src/nail-showcase/nail-showcase.super-admin.controller.ts |
| GET | `/super-admin/observability/correlations/{correlationId}` | session | super_admin.telemetry.view | operations | SuperAdminGuard | observability/telemetry-store.ts |
| GET | `/super-admin/observability/logs` | session | super_admin.telemetry.view | operations | SuperAdminGuard | observability/telemetry-store.ts |
| GET | `/super-admin/observability/requests` | session | super_admin.telemetry.view | operations | SuperAdminGuard | observability/telemetry-store.ts |
| GET | `/super-admin/observability/requests/{requestId}` | session | super_admin.telemetry.view | operations | SuperAdminGuard | observability/telemetry-store.ts |
| GET | `/super-admin/observability/traces/{traceId}` | session | super_admin.telemetry.view | operations | SuperAdminGuard | observability/telemetry-store.ts |
| GET | `/super-admin/onboarding/{id}` | session | super_admin.onboarding.view (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| POST | `/super-admin/onboarding/{id}/activate` | session | super_admin.onboarding.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| POST | `/super-admin/onboarding/{id}/approvals` | session | super_admin.onboarding.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| PATCH | `/super-admin/onboarding/{id}/assign` | session | super_admin.onboarding.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| GET | `/super-admin/onboarding/{id}/documents` | session | super_admin.onboarding.view (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| GET | `/super-admin/onboarding/{id}/history` | session | super_admin.onboarding.view (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| GET | `/super-admin/onboarding/{id}/notes` | session | super_admin.onboarding.view (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| POST | `/super-admin/onboarding/{id}/notes` | session | super_admin.onboarding.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| POST | `/super-admin/onboarding/{id}/request-info` | session | super_admin.onboarding.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| POST | `/super-admin/onboarding/{id}/return-for-correction` | session | super_admin.onboarding.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| PATCH | `/super-admin/onboarding/{id}/transition` | session | super_admin.onboarding.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| GET | `/super-admin/onboarding/applications` | session | super_admin.onboarding.view (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| POST | `/super-admin/onboarding/applications` | session | super_admin.onboarding.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| GET | `/super-admin/onboarding/approvals` | session | super_admin.onboarding.view (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| PATCH | `/super-admin/onboarding/approvals/{approvalId}` | session | super_admin.onboarding.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| PATCH | `/super-admin/onboarding/documents/{documentId}` | session | super_admin.onboarding.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| GET | `/super-admin/onboarding/export` | session | super_admin.onboarding.view (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| GET | `/super-admin/onboarding/overview` | session | super_admin.onboarding.view (derived) | support | SuperAdminGuard | modules/super-admin/src/onboarding/onboarding.module.ts |
| GET | `/super-admin/oncall/alerts` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/oncall.ts |
| POST | `/super-admin/oncall/alerts/{id}/acknowledge` | session | super_admin.system.manage | operations | SuperAdminGuard | observability/oncall.ts |
| GET | `/super-admin/oncall/backups` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/oncall.ts |
| GET | `/super-admin/oncall/contacts` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/oncall.ts |
| POST | `/super-admin/oncall/contacts` | session | super_admin.system.manage | operations | SuperAdminGuard | observability/oncall.ts |
| PUT | `/super-admin/oncall/contacts/{id}` | session | super_admin.system.manage | operations | SuperAdminGuard | observability/oncall.ts |
| POST | `/super-admin/oncall/contacts/{id}/remove` | session | super_admin.system.manage | operations | SuperAdminGuard | observability/oncall.ts |
| GET | `/super-admin/oncall/slos` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/oncall.ts |
| GET | `/super-admin/oncall/synthetic` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/oncall.ts |
| PUT | `/super-admin/oncall/synthetic` | session | super_admin.system.manage | operations | SuperAdminGuard | observability/oncall.ts |
| GET | `/super-admin/operations` | session | super_admin.tenants.view (derived) | operations | SuperAdminGuard | common/async-export/operations.controller.ts |
| GET | `/super-admin/operations/{id}` | session | super_admin.tenants.view (derived) | operations | SuperAdminGuard | common/async-export/operations.controller.ts |
| GET | `/super-admin/operations/{id}/download` | session | super_admin.tenants.view (derived) | operations | SuperAdminGuard | common/async-export/operations.controller.ts |
| GET | `/super-admin/overview/aggregate` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-overview-aggregate/overview-aggregate.controller.ts |
| GET | `/super-admin/overview/monthly-sales-volume` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-overview/overview.controller.ts |
| POST | `/super-admin/overview/snapshot` | session | super_admin.analytics.manage (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-overview/overview.controller.ts |
| GET | `/super-admin/overview/state` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-overview/overview.controller.ts |
| GET | `/super-admin/owners` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-owners/super-admin-owners.module.ts |
| GET | `/super-admin/owners/{ownerId}` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-owners/super-admin-owners.module.ts |
| GET | `/super-admin/owners/{ownerId}/activity` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-owners/super-admin-owners.module.ts |
| POST | `/super-admin/owners/{ownerId}/branches` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-owners/super-admin-owners.module.ts |
| DELETE | `/super-admin/owners/{ownerId}/branches/{branchId}` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-owners/super-admin-owners.module.ts |
| PATCH | `/super-admin/owners/{ownerId}/branches/{branchId}` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-owners/super-admin-owners.module.ts |
| DELETE | `/super-admin/owners/{ownerId}/branches/{branchId}/pin` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-owners/super-admin-owners.module.ts |
| POST | `/super-admin/owners/{ownerId}/branches/{branchId}/pin` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-owners/super-admin-owners.module.ts |
| GET | `/super-admin/owners/{ownerId}/portfolio` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-owners/super-admin-owners.module.ts |
| POST | `/super-admin/owners/{ownerId}/salons` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-owners/super-admin-owners.module.ts |
| GET | `/super-admin/payroll/state` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/workforce/src/payroll/payroll.controller.ts |
| POST | `/super-admin/plans` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/plans.controller.ts |
| PATCH | `/super-admin/plans/{id}` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/plans.controller.ts |
| PUT | `/super-admin/plans/{id}/limits` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/plans.controller.ts |
| POST | `/super-admin/plans/{id}/pricing` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/plans.controller.ts |
| GET | `/super-admin/plans/{id}/versions` | session | super_admin.plans.view (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/plans.controller.ts |
| GET | `/super-admin/plans/grandfathered` | session | super_admin.plans.view (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/grandfather.controller.ts |
| POST | `/super-admin/plans/grandfathered` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/grandfather.controller.ts |
| POST | `/super-admin/plans/overage/recompute` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/overage.controller.ts |
| GET | `/super-admin/plans/overage/rules` | session | super_admin.plans.view (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/overage.controller.ts |
| PUT | `/super-admin/plans/overage/rules` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/overage.controller.ts |
| GET | `/super-admin/plans/overview` | session | super_admin.plans.view (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/plans.controller.ts |
| POST | `/super-admin/plans/scheduled-changes/process` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/scheduled-changes.controller.ts |
| GET | `/super-admin/plans/tenants/{tenantId}/check/{metric}` | session | super_admin.plans.view (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/entitlements.controller.ts |
| GET | `/super-admin/plans/tenants/{tenantId}/entitlements` | session | super_admin.plans.view (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/entitlements.controller.ts |
| PUT | `/super-admin/plans/tenants/{tenantId}/features` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/entitlements.controller.ts |
| PUT | `/super-admin/plans/tenants/{tenantId}/limits` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/entitlements.controller.ts |
| POST | `/super-admin/plans/tenants/{tenantId}/offers/add-ons` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/tenant-offers.controller.ts |
| POST | `/super-admin/plans/tenants/{tenantId}/offers/add-ons/cancel` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/tenant-offers.controller.ts |
| POST | `/super-admin/plans/tenants/{tenantId}/offers/promotions` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/tenant-offers.controller.ts |
| POST | `/super-admin/plans/tenants/{tenantId}/offers/trials` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/tenant-offers.controller.ts |
| GET | `/super-admin/plans/tenants/{tenantId}/subscription` | session | super_admin.plans.view (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/subscription-change.controller.ts |
| POST | `/super-admin/plans/tenants/{tenantId}/subscription/change` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/subscription-change.controller.ts |
| GET | `/super-admin/plans/tenants/{tenantId}/subscription/changes` | session | super_admin.plans.view (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/subscription-change.controller.ts |
| POST | `/super-admin/plans/tenants/{tenantId}/subscription/preview` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/subscription-change.controller.ts |
| POST | `/super-admin/plans/tenants/{tenantId}/usage` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/entitlements.controller.ts |
| GET | `/super-admin/plans/usage-alerts` | session | super_admin.plans.view | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/usage-alerts.ts |
| GET | `/super-admin/plans/utilization` | session | super_admin.plans.view (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/utilization.controller.ts |
| POST | `/super-admin/plans/utilization/snapshot` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/utilization.controller.ts |
| GET | `/super-admin/plans/utilization/trend` | session | super_admin.plans.view (derived) | finance | SuperAdminGuard | modules/platform/src/super-admin-plans/utilization.controller.ts |
| GET | `/super-admin/platform-search` | session | super_admin.tenants.view (derived) | platform | SuperAdminGuard | modules/super-admin/src/super-admin-platform-search/platform-search.ts |
| GET | `/super-admin/platform-staff` | session | super_admin.users.view | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform-staff/platform-staff.controller.ts |
| POST | `/super-admin/platform-staff/{userId}/reset-mfa` | session | super_admin.platform_roles.manage | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform-staff/platform-staff.controller.ts |
| POST | `/super-admin/platform-staff/{userId}/revoke-sessions` | session | super_admin.platform_roles.manage | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform-staff/platform-staff.controller.ts |
| POST | `/super-admin/platform-staff/{userId}/role` | session | super_admin.platform_roles.manage | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform-staff/platform-staff.controller.ts |
| GET | `/super-admin/platform-staff/{userId}/sessions` | session | super_admin.users.view | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform-staff/platform-staff.controller.ts |
| POST | `/super-admin/platform-staff/{userId}/status` | session | super_admin.platform_roles.manage | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform-staff/platform-staff.controller.ts |
| GET | `/super-admin/platform/access-requests` | session | super_admin.users.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/access-requests` | session | super_admin.users.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/access-requests/{id}/approve` | session | super_admin.users.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/access-requests/{id}/cancel` | session | super_admin.users.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/access-requests/{id}/reject` | session | super_admin.users.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/access-requests/{id}/review` | session | super_admin.users.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/ai-packages` | session | super_admin.ai.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/ai-packages/{tenantId}` | session | super_admin.ai.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/ai-packages/{tenantId}/features` | session | super_admin.ai.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/app-flags/{tenantId}` | session | super_admin.plans.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/app-flags/{tenantId}` | session | super_admin.plans.manage (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/applications` | session | super_admin.onboarding.view (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/applications` | session | super_admin.onboarding.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/applications/{id}/approve` | session | super_admin.applications.approve | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/applications/{id}/archive` | session | super_admin.applications.archive | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/applications/{id}/assign` | session | super_admin.applications.assign | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/applications/{id}/contact-log` | session | super_admin.applications.contact | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/applications/{id}/convert-to-onboarding` | session | super_admin.applications.convert | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/applications/{id}/converted` | session | super_admin.onboarding.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/applications/{id}/duplicate` | session | super_admin.applications.review | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/applications/{id}/ein` | session | super_admin.applications.view_sensitive | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/applications/{id}/follow-up` | session | super_admin.applications.review | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/applications/{id}/notes` | session | super_admin.onboarding.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/applications/{id}/priority` | session | super_admin.applications.review | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/applications/{id}/reject` | session | super_admin.applications.reject | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/applications/{id}/spam` | session | super_admin.applications.review | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/applications/{id}/status` | session | super_admin.applications.update_status | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/applications/metrics` | session | super_admin.applications.view | support | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/appointments` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/audit-logs` | session | super_admin.audit_logs.view (derived) | audit | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/automations` | session | super_admin.ai.view (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/branches` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/branches` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/branches-dashboard` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/branches/{id}/assignable-managers` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/branches/{id}/devices` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/branches/{id}/devices/allocate` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/branches/{id}/hours` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/branches/{id}/hours` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/branches/{id}/manager` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/branches/{id}/status` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/branches/{id}/transfer` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/branches/{id}/transfer-options` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/branches/{id}/transfer-preflight` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/branches/bulk-status` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/branches/export` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/brands` | session | super_admin.catalog.view (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/categories` | session | super_admin.catalog.view (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/customer-duplicates` | session | super_admin.customers.view (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/customers` | session | super_admin.customers.view (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/customers/merge` | session | super_admin.customers.manage (derived) | customers | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/devices` | session | super_admin.system_operations.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/hardware` | session | super_admin.billing.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/hardware` | session | super_admin.billing.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/hardware/{id}` | session | super_admin.billing.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/integrations` | session | super_admin.integrations.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/invitations` | session | super_admin.users.view (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/invitations` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/invitations/{id}/cancel` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/invitations/{id}/resend` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/leads` | session | super_admin.onboarding.view (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/leads` | session | super_admin.onboarding.manage (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/leads/{id}/convert` | session | super_admin.onboarding.manage (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/leads/{id}/status` | session | super_admin.onboarding.manage (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/payment-gateways` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/payment-gateways/analytics/status-breakdown` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/payment-gateways/analytics/top-processors` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/payment-gateways/export` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/payment-gateways/recent-activity` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/payment-gateways/recent-events` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/payment-gateways/state` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/payments` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/payments-transactions` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/payments-transactions/{id}` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/payments-transactions/{id}/authorization-history` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/privacy-requests` | session | super_admin.customers.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/privacy-requests` | session | super_admin.customers.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/privacy-requests/{id}/status` | session | super_admin.customers.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/product-categories/merge` | session | super_admin.catalog.manage (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/products` | session | super_admin.catalog.view (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/reminders` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/report-exports` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/reports` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/roles` | session | super_admin.users.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/scheduled-reports` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/scheduled-reports` | session | super_admin.analytics.manage (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| DELETE | `/super-admin/platform/scheduled-reports/{id}` | session | super_admin.analytics.manage (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/scheduled-reports/{id}/run-now` | session | super_admin.analytics.manage (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/scheduled-reports/{id}/toggle` | session | super_admin.analytics.manage (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/security` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/service-categories` | session | super_admin.catalog.view (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/service-categories/merge` | session | super_admin.catalog.manage (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/services` | session | super_admin.catalog.view (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/sessions/{id}/revoke` | session | super_admin.users.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/state` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/suppliers` | session | super_admin.catalog.view (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/support-sessions` | session | super_admin.support.view (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/support-sessions` | session | super_admin.support.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/support-sessions/{id}/action` | session | super_admin.support.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/support-sessions/{id}/customer-action` | session | super_admin.support.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/support-sessions/{id}/end` | session | super_admin.support.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/support-sessions/{id}/extend` | session | super_admin.support.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/support-sessions/mine` | session | super_admin.support.view (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/tenant-performance` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/tenant-product-categories` | session | super_admin.catalog.view (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/tenant-service-categories` | session | super_admin.catalog.view (derived) | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/tenant-users-branches` | session | super_admin.tenants.view (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/top-performing-tenants` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/usage-limits` | session | super_admin.plans.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/usage-limits/{tenantId}` | session | super_admin.plans.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/users` | session | super_admin.users.view (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/users` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/users-dashboard` | session | super_admin.analytics.view (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/users/{id}/cancel-invite` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/users/{id}/disable` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/users/{id}/enable` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/users/{id}/mfa` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/users/{id}/resend-invite` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/users/{id}/reset-password` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/users/{id}/revoke-sessions` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/users/{id}/role` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/users/{id}/sessions` | session | super_admin.users.view (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/users/branch-access` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/users/branch-access/revoke` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/platform/users/export` | session | super_admin.users.view (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| POST | `/super-admin/platform/users/invite` | session | super_admin.users.manage (derived) | identity | SuperAdminGuard | modules/super-admin/src/super-admin-platform/super-admin-platform.controller.ts |
| GET | `/super-admin/product-catalog/distributions` | session | super_admin.catalog.view (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-product-catalog/super-admin-product-catalog.controller.ts |
| POST | `/super-admin/product-catalog/distributions` | session | super_admin.catalog.manage (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-product-catalog/super-admin-product-catalog.controller.ts |
| GET | `/super-admin/product-catalog/imports` | session | super_admin.catalog.view (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-product-catalog/super-admin-product-catalog.controller.ts |
| POST | `/super-admin/product-catalog/imports` | session | super_admin.catalog.manage (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-product-catalog/super-admin-product-catalog.controller.ts |
| POST | `/super-admin/product-catalog/imports/{id}/approve` | session | super_admin.catalog.manage (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-product-catalog/super-admin-product-catalog.controller.ts |
| GET | `/super-admin/product-catalog/imports/errors` | session | super_admin.catalog.view (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-product-catalog/super-admin-product-catalog.controller.ts |
| POST | `/super-admin/product-catalog/imports/errors/{id}/retry` | session | super_admin.catalog.manage (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-product-catalog/super-admin-product-catalog.controller.ts |
| GET | `/super-admin/product-catalog/overview` | session | super_admin.catalog.view (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-product-catalog/super-admin-product-catalog.controller.ts |
| GET | `/super-admin/product-catalog/products` | session | super_admin.catalog.view (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-product-catalog/super-admin-product-catalog.controller.ts |
| POST | `/super-admin/product-catalog/products` | session | super_admin.catalog.manage (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-product-catalog/super-admin-product-catalog.controller.ts |
| GET | `/super-admin/product-catalog/products/{id}/barcodes` | session | super_admin.catalog.view (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-product-catalog/super-admin-product-catalog.controller.ts |
| POST | `/super-admin/product-catalog/products/{id}/barcodes` | session | super_admin.catalog.manage (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-product-catalog/super-admin-product-catalog.controller.ts |
| POST | `/super-admin/product-catalog/products/{id}/retire` | session | super_admin.catalog.manage (derived) | inventory | SuperAdminGuard | modules/super-admin/src/super-admin-product-catalog/super-admin-product-catalog.controller.ts |
| GET | `/super-admin/project-status` | session | super_admin.analytics.view (derived) | support | SuperAdminGuard | project-status/project-status.controller.ts |
| PATCH | `/super-admin/project-status/module` | session | super_admin.analytics.manage (derived) | support | SuperAdminGuard | project-status/project-status.controller.ts |
| GET | `/super-admin/project-status/pos-settings` | session | super_admin.analytics.view (derived) | support | SuperAdminGuard | project-status/project-status.controller.ts |
| GET | `/super-admin/project-status/pos-settings/{moduleKey}` | session | super_admin.analytics.view (derived) | support | SuperAdminGuard | project-status/project-status.controller.ts |
| PATCH | `/super-admin/project-status/pos-settings/{moduleKey}/recheck` | session | super_admin.analytics.manage (derived) | support | SuperAdminGuard | project-status/project-status.controller.ts |
| POST | `/super-admin/promotions/{id}/approve` | session | super_admin.marketing.manage (derived) | deals | SuperAdminGuard | modules/super-admin/src/super-admin-promotions/promotion-management.controller.ts |
| POST | `/super-admin/promotions/{id}/disable` | session | super_admin.marketing.manage (derived) | deals | SuperAdminGuard | modules/super-admin/src/super-admin-promotions/promotion-management.controller.ts |
| POST | `/super-admin/promotions/{id}/reject` | session | super_admin.marketing.manage (derived) | deals | SuperAdminGuard | modules/super-admin/src/super-admin-promotions/promotion-management.controller.ts |
| POST | `/super-admin/promotions/{id}/transition` | session | super_admin.marketing.manage (derived) | deals | SuperAdminGuard | modules/super-admin/src/super-admin-promotions/promotion-management.controller.ts |
| GET | `/super-admin/promotions/overview` | session | super_admin.marketing.view (derived) | deals | SuperAdminGuard | modules/super-admin/src/super-admin-promotions/promotions-oversight.controller.ts |
| POST | `/super-admin/queue/{queueId}/retry-sync` | session | super_admin.operations.manage (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-queue/super-admin-queue.controller.ts |
| GET | `/super-admin/queue/export` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-queue/super-admin-queue.controller.ts |
| GET | `/super-admin/queue/export-pdf` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-queue/super-admin-queue.controller.ts |
| GET | `/super-admin/queue/export-xlsx` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-queue/super-admin-queue.controller.ts |
| POST | `/super-admin/queue/incidents` | session | super_admin.operations.manage (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-queue/super-admin-queue.controller.ts |
| GET | `/super-admin/queue/live-overview` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-queue/super-admin-queue.controller.ts |
| POST | `/super-admin/queue/notify-branch` | session | super_admin.operations.manage (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-queue/super-admin-queue.controller.ts |
| GET | `/super-admin/queue/overview` | session | super_admin.operations.view (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-queue/super-admin-queue.controller.ts |
| POST | `/super-admin/queue/snapshot` | session | super_admin.operations.manage (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-queue/super-admin-queue.controller.ts |
| POST | `/super-admin/queue/support-session` | session | super_admin.operations.manage (derived) | booking | SuperAdminGuard | modules/super-admin/src/super-admin-queue/super-admin-queue.controller.ts |
| GET | `/super-admin/realtime/presence` | session | super_admin.system_operations.view (derived) | operations | SuperAdminGuard | realtime/presence.controller.ts |
| GET | `/super-admin/reconciliation/overview` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-reconciliation/super-admin-reconciliation.controller.ts |
| GET | `/super-admin/report-builder/catalog` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-report-builder/super-admin-report-builder.controller.ts |
| GET | `/super-admin/report-builder/definitions` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-report-builder/super-admin-report-builder.controller.ts |
| POST | `/super-admin/report-builder/definitions` | session | super_admin.analytics.manage (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-report-builder/super-admin-report-builder.controller.ts |
| DELETE | `/super-admin/report-builder/definitions/{id}` | session | super_admin.analytics.manage (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-report-builder/super-admin-report-builder.controller.ts |
| PATCH | `/super-admin/report-builder/definitions/{id}` | session | super_admin.analytics.manage (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-report-builder/super-admin-report-builder.controller.ts |
| POST | `/super-admin/report-builder/run` | session | super_admin.analytics.manage (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-report-builder/super-admin-report-builder.controller.ts |
| GET | `/super-admin/revenue-residuals/accounting-periods` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/accounting-periods` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/accounting-periods/{id}/lock` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/accounting-periods/{id}/reopen` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/agreements` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/agreements` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/agreements/{id}` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/agreements/{id}/versions` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/agreements/{id}/versions` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/expense-categories` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/export` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/export-jobs` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/export-jobs` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/export-jobs/{id}` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/forecast` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/overview` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/partner-payouts` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/partner-payouts/{id}/approve` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/partner-payouts/calculate` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/reconciliations` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/records` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/residual-statements` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/residual-statements/{id}` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/residual-statements/{id}/reconcile` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/residual-statements/{id}/review` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/residual-statements/import` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/revenue-adjustments` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/revenue-adjustments` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/revenue-adjustments/{id}/approve` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/revenue-adjustments/{id}/reject` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/revenue-adjustments/{id}/reverse` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/tenant-incentives` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/tenant-incentives/{id}/approve` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| POST | `/super-admin/revenue-residuals/tenant-incentives/calculate` | session | super_admin.payments.manage (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/revenue-residuals/unpaid-residuals` | session | super_admin.payments.view (derived) | finance | SuperAdminGuard | modules/super-admin/src/super-admin-revenue-residuals/super-admin-revenue-residuals.controller.ts |
| GET | `/super-admin/scheduled-reports` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-scheduled-reports/super-admin-scheduled-reports.controller.ts |
| POST | `/super-admin/scheduled-reports` | session | super_admin.analytics.manage (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-scheduled-reports/super-admin-scheduled-reports.controller.ts |
| DELETE | `/super-admin/scheduled-reports/{id}` | session | super_admin.analytics.manage (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-scheduled-reports/super-admin-scheduled-reports.controller.ts |
| PATCH | `/super-admin/scheduled-reports/{id}` | session | super_admin.analytics.manage (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-scheduled-reports/super-admin-scheduled-reports.controller.ts |
| POST | `/super-admin/scheduled-reports/{id}/run-now` | session | super_admin.analytics.manage (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-scheduled-reports/super-admin-scheduled-reports.controller.ts |
| GET | `/super-admin/scheduled-reports/{id}/runs` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-scheduled-reports/super-admin-scheduled-reports.controller.ts |
| POST | `/super-admin/scheduled-reports/run-due` | session | super_admin.analytics.manage (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-scheduled-reports/super-admin-scheduled-reports.controller.ts |
| GET | `/super-admin/scheduled-reports/runs/{runId}/download` | session | super_admin.analytics.view (derived) | analytics | SuperAdminGuard | modules/super-admin/src/super-admin-scheduled-reports/super-admin-scheduled-reports.controller.ts |
| GET | `/super-admin/security/audit/findings` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/audit-engine.controller.ts |
| POST | `/super-admin/security/audit/run` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/audit-engine.controller.ts |
| GET | `/super-admin/security/audit/runs` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/audit-engine.controller.ts |
| GET | `/super-admin/security/incidents` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/incident.controller.ts |
| POST | `/super-admin/security/incidents` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/incident.controller.ts |
| GET | `/super-admin/security/incidents/{id}` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/incident.controller.ts |
| PATCH | `/super-admin/security/incidents/{id}/transition` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/incident.controller.ts |
| GET | `/super-admin/security/incidents/workflow` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/incident.controller.ts |
| GET | `/super-admin/security/ip-blocks` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/ip-block.controller.ts |
| POST | `/super-admin/security/ip-blocks` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/ip-block.controller.ts |
| DELETE | `/super-admin/security/ip-blocks/{id}` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/ip-block.controller.ts |
| POST | `/super-admin/security/ip-blocks/allowlist` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/ip-block.controller.ts |
| POST | `/super-admin/security/ip-blocks/preview` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/ip-block.controller.ts |
| GET | `/super-admin/security/lockdowns` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/lockdown.controller.ts |
| GET | `/super-admin/security/lockdowns/{id}` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/lockdown.controller.ts |
| POST | `/super-admin/security/lockdowns/{id}/cancel` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/lockdown.controller.ts |
| POST | `/super-admin/security/lockdowns/{id}/confirm` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/lockdown.controller.ts |
| POST | `/super-admin/security/lockdowns/{id}/execute` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/lockdown.controller.ts |
| POST | `/super-admin/security/lockdowns/{id}/lift` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/lockdown.controller.ts |
| POST | `/super-admin/security/lockdowns/propose` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/lockdown.controller.ts |
| GET | `/super-admin/security/mfa-policy` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/policy.controller.ts |
| PATCH | `/super-admin/security/mfa-policy` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/policy.controller.ts |
| GET | `/super-admin/security/overview` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/security.controller.ts |
| GET | `/super-admin/security/password-policy` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/policy.controller.ts |
| PATCH | `/super-admin/security/password-policy` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/policy.controller.ts |
| GET | `/super-admin/security/privileged-access` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/grant.controller.ts |
| GET | `/super-admin/security/privileged-access/{id}` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/grant.controller.ts |
| POST | `/super-admin/security/privileged-access/{id}/approve` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/grant.controller.ts |
| POST | `/super-admin/security/privileged-access/{id}/deny` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/grant.controller.ts |
| POST | `/super-admin/security/privileged-access/{id}/revoke` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/grant.controller.ts |
| GET | `/super-admin/security/privileged-access/active` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/grant.controller.ts |
| POST | `/super-admin/security/privileged-access/expire-sweep` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/grant.controller.ts |
| POST | `/super-admin/security/privileged-access/request` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/grant.controller.ts |
| GET | `/super-admin/security/retention-rules` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/retention.controller.ts |
| GET | `/super-admin/security/retention-rules/{dataClass}` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/retention.controller.ts |
| PATCH | `/super-admin/security/retention-rules/{dataClass}` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/retention.controller.ts |
| POST | `/super-admin/security/retention-rules/{dataClass}/preview-purge` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/retention.controller.ts |
| GET | `/super-admin/security/session-policy` | session | super_admin.security.view (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/policy.controller.ts |
| PATCH | `/super-admin/security/session-policy` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/policy.controller.ts |
| POST | `/super-admin/security/sessions/{id}/revoke` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/session-revoke.controller.ts |
| POST | `/super-admin/security/sessions/revoke` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/session-revoke.controller.ts |
| POST | `/super-admin/security/sessions/revoke/preview` | session | super_admin.security.manage (derived) | security | SuperAdminGuard | modules/super-admin/src/super-admin-security/session-revoke.controller.ts |
| GET | `/super-admin/settings/branding` | session | super_admin.general_settings.view (derived) | tenants | SuperAdminGuard | modules/tenants/src/branding/branding.controller.ts |
| PATCH | `/super-admin/settings/branding` | session | super_admin.general_settings.edit (derived) | tenants | SuperAdminGuard | modules/tenants/src/branding/branding.controller.ts |
| POST | `/super-admin/settings/branding/logo` | session | super_admin.general_settings.edit (derived) | tenants | SuperAdminGuard | modules/tenants/src/branding/branding.controller.ts |
| POST | `/super-admin/settings/branding/restore` | session | super_admin.general_settings.edit (derived) | tenants | SuperAdminGuard | modules/tenants/src/branding/branding.controller.ts |
| GET | `/super-admin/settings/general` | session | super_admin.general_settings.view | platform | SuperAdminGuard | modules/super-admin/src/super-admin-settings/super-admin-settings.controller.ts |
| GET | `/super-admin/settings/general/adoption-rate` | session | super_admin.general_settings.view | platform | SuperAdminGuard | modules/super-admin/src/super-admin-settings/super-admin-settings.controller.ts |
| GET | `/super-admin/settings/general/business-categories` | session | super_admin.general_settings.business_categories.view | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-business-categories/business-categories.controller.ts |
| POST | `/super-admin/settings/general/business-categories` | session | super_admin.general_settings.business_categories.manage | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-business-categories/business-categories.controller.ts |
| POST | `/super-admin/settings/general/business-categories/{id}/activate` | session | super_admin.general_settings.business_categories.manage | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-business-categories/business-categories.controller.ts |
| POST | `/super-admin/settings/general/business-categories/{id}/deactivate` | session | super_admin.general_settings.business_categories.manage | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-business-categories/business-categories.controller.ts |
| POST | `/super-admin/settings/general/business-categories/{id}/rename` | session | super_admin.general_settings.business_categories.manage | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-business-categories/business-categories.controller.ts |
| POST | `/super-admin/settings/general/business-categories/reorder` | session | super_admin.general_settings.business_categories.manage | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-business-categories/business-categories.controller.ts |
| GET | `/super-admin/settings/general/business-categories/summary` | session | super_admin.general_settings.business_categories.view | catalog | SuperAdminGuard | modules/super-admin/src/super-admin-business-categories/business-categories.controller.ts |
| GET | `/super-admin/settings/general/history` | session | super_admin.general_settings.view | platform | SuperAdminGuard | modules/super-admin/src/super-admin-settings/super-admin-settings.controller.ts |
| GET | `/super-admin/settings/general/history/series` | session | super_admin.general_settings.view | platform | SuperAdminGuard | modules/super-admin/src/super-admin-settings/super-admin-settings.controller.ts |
| GET | `/super-admin/settings/general/legal-documents` | session | super_admin.general_settings.legal_documents.view | platform | SuperAdminGuard | modules/super-admin/src/super-admin-legal/legal-documents.controller.ts |
| POST | `/super-admin/settings/general/legal-documents` | session | super_admin.general_settings.legal_documents.manage | platform | SuperAdminGuard | modules/super-admin/src/super-admin-legal/legal-documents.controller.ts |
| GET | `/super-admin/settings/general/legal-documents/{id}` | session | super_admin.general_settings.legal_documents.view | platform | SuperAdminGuard | modules/super-admin/src/super-admin-legal/legal-documents.controller.ts |
| POST | `/super-admin/settings/general/legal-documents/{id}/publish` | session | super_admin.general_settings.legal_documents.publish | platform | SuperAdminGuard | modules/super-admin/src/super-admin-legal/legal-documents.controller.ts |
| POST | `/super-admin/settings/general/legal-documents/{id}/retire` | session | super_admin.general_settings.legal_documents.manage | platform | SuperAdminGuard | modules/super-admin/src/super-admin-legal/legal-documents.controller.ts |
| GET | `/super-admin/settings/general/legal-documents/acceptance-status` | session | super_admin.general_settings.legal_documents.view | platform | SuperAdminGuard | modules/super-admin/src/super-admin-legal/legal-documents.controller.ts |
| GET | `/super-admin/settings/general/legal-documents/history` | session | super_admin.general_settings.legal_documents.view | platform | SuperAdminGuard | modules/super-admin/src/super-admin-legal/legal-documents.controller.ts |
| GET | `/super-admin/settings/general/legal-documents/overview-version` | session | super_admin.general_settings.legal_documents.view | platform | SuperAdminGuard | modules/super-admin/src/super-admin-legal/legal-documents.controller.ts |
| GET | `/super-admin/settings/general/localization-distribution` | session | super_admin.general_settings.view | platform | SuperAdminGuard | modules/super-admin/src/super-admin-settings/super-admin-settings.controller.ts |
| GET | `/super-admin/settings/general/maintenance` | session | super_admin.general_settings.maintenance.view | support | SuperAdminGuard | modules/super-admin/src/super-admin-maintenance/maintenance.controller.ts |
| POST | `/super-admin/settings/general/maintenance/banner` | session | super_admin.general_settings.maintenance.manage | support | SuperAdminGuard | modules/super-admin/src/super-admin-maintenance/maintenance.controller.ts |
| POST | `/super-admin/settings/general/maintenance/disable` | session | super_admin.general_settings.maintenance.manage | support | SuperAdminGuard | modules/super-admin/src/super-admin-maintenance/maintenance.controller.ts |
| POST | `/super-admin/settings/general/maintenance/enable` | session | super_admin.general_settings.maintenance.manage | support | SuperAdminGuard | modules/super-admin/src/super-admin-maintenance/maintenance.controller.ts |
| GET | `/super-admin/settings/general/maintenance/history` | session | super_admin.general_settings.maintenance.view | support | SuperAdminGuard | modules/super-admin/src/super-admin-maintenance/maintenance.controller.ts |
| POST | `/super-admin/settings/general/maintenance/schedule` | session | super_admin.general_settings.maintenance.manage | support | SuperAdminGuard | modules/super-admin/src/super-admin-maintenance/maintenance.controller.ts |
| POST | `/super-admin/settings/general/maintenance/schedule/{id}/cancel` | session | super_admin.general_settings.maintenance.manage | support | SuperAdminGuard | modules/super-admin/src/super-admin-maintenance/maintenance.controller.ts |
| POST | `/super-admin/settings/general/operations` | session | super_admin.general_settings.edit | platform | SuperAdminGuard | modules/super-admin/src/super-admin-settings/super-admin-settings.controller.ts |
| GET | `/super-admin/settings/general/overview` | session | super_admin.general_settings.view | platform | SuperAdminGuard | modules/super-admin/src/super-admin-settings/super-admin-settings.controller.ts |
| POST | `/super-admin/settings/general/reset` | session | super_admin.general_settings.reset | platform | SuperAdminGuard | modules/super-admin/src/super-admin-settings/super-admin-settings.controller.ts |
| POST | `/super-admin/settings/general/save` | session | super_admin.general_settings.edit | platform | SuperAdminGuard | modules/super-admin/src/super-admin-settings/super-admin-settings.controller.ts |
| GET | `/super-admin/settings/general/tenant-presets` | session | super_admin.general_settings.tenant_presets.view | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenant-presets/tenant-presets.controller.ts |
| POST | `/super-admin/settings/general/tenant-presets` | session | super_admin.general_settings.tenant_presets.manage | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenant-presets/tenant-presets.controller.ts |
| GET | `/super-admin/settings/general/tenant-presets/{id}` | session | super_admin.general_settings.tenant_presets.view | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenant-presets/tenant-presets.controller.ts |
| POST | `/super-admin/settings/general/tenant-presets/{id}/make-default` | session | super_admin.general_settings.tenant_presets.manage | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenant-presets/tenant-presets.controller.ts |
| POST | `/super-admin/settings/general/tenant-presets/{id}/update` | session | super_admin.general_settings.tenant_presets.manage | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenant-presets/tenant-presets.controller.ts |
| GET | `/super-admin/settings/general/tenant-presets/defaults` | session | super_admin.general_settings.tenant_presets.view | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenant-presets/tenant-presets.controller.ts |
| POST | `/super-admin/settlements/{id}/match-deposit` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-settlements/super-admin-settlements.controller.ts |
| POST | `/super-admin/settlements/{id}/notes` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-settlements/super-admin-settlements.controller.ts |
| POST | `/super-admin/settlements/{id}/processor-case` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-settlements/super-admin-settlements.controller.ts |
| POST | `/super-admin/settlements/{id}/resolve` | session | super_admin.payments.manage (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-settlements/super-admin-settlements.controller.ts |
| GET | `/super-admin/settlements/export` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-settlements/super-admin-settlements.controller.ts |
| GET | `/super-admin/settlements/export-pdf` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-settlements/super-admin-settlements.controller.ts |
| GET | `/super-admin/settlements/export-xlsx` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-settlements/super-admin-settlements.controller.ts |
| GET | `/super-admin/settlements/overview` | session | super_admin.payments.view (derived) | payments | SuperAdminGuard | modules/super-admin/src/super-admin-settlements/super-admin-settlements.controller.ts |
| GET | `/super-admin/smart-reminders/channels` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| POST | `/super-admin/smart-reminders/channels` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| GET | `/super-admin/smart-reminders/channels/{reminderType}` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| POST | `/super-admin/smart-reminders/channels/preview-fallback` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| POST | `/super-admin/smart-reminders/exports` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| GET | `/super-admin/smart-reminders/flows` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| GET | `/super-admin/smart-reminders/flows/{reminderType}` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| POST | `/super-admin/smart-reminders/flows/disable` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| POST | `/super-admin/smart-reminders/flows/enable` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| GET | `/super-admin/smart-reminders/overview` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| GET | `/super-admin/smart-reminders/plan-features` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| POST | `/super-admin/smart-reminders/plan-features` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| GET | `/super-admin/smart-reminders/plan-features/evaluate` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| GET | `/super-admin/smart-reminders/templates` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| POST | `/super-admin/smart-reminders/templates` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| GET | `/super-admin/smart-reminders/templates/{id}` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| POST | `/super-admin/smart-reminders/templates/{id}/versions` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| POST | `/super-admin/smart-reminders/templates/{id}/versions/{version}/publish` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| POST | `/super-admin/smart-reminders/templates/preview` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| GET | `/super-admin/smart-reminders/tenant-customizations/{tenantId}` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| POST | `/super-admin/smart-reminders/tenant-customizations/{tenantId}` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| GET | `/super-admin/smart-reminders/tenant-customizations/{tenantId}/{reminderType}/effective` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| POST | `/super-admin/smart-reminders/tenant-customizations/{tenantId}/{reminderType}/revert` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| GET | `/super-admin/smart-reminders/timing` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| POST | `/super-admin/smart-reminders/timing` | session | super_admin.communications.manage (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| GET | `/super-admin/smart-reminders/timing/{reminderType}` | session | super_admin.communications.view (derived) | communications | SuperAdminGuard | modules/super-admin/src/super-admin-smart-reminders/smart-reminders.module.ts |
| GET | `/super-admin/sms-packages` | session | super_admin.sms_packages.view | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-packages.controller.ts |
| GET | `/super-admin/sms-packages/{packageId}` | session | super_admin.sms_packages.view | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-packages.controller.ts |
| PATCH | `/super-admin/sms-packages/{packageId}` | session | super_admin.sms_packages.manage | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-packages.controller.ts |
| POST | `/super-admin/sms-packages/{packageId}/disable` | session | super_admin.sms_packages.manage | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-packages.controller.ts |
| POST | `/super-admin/sms-packages/{packageId}/enable` | session | super_admin.sms_packages.manage | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-packages.controller.ts |
| GET | `/super-admin/sms-packages/default-package` | session | super_admin.sms_packages.view | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-packages.controller.ts |
| POST | `/super-admin/sms-packages/default-package` | session | super_admin.sms_packages.manage | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-packages.controller.ts |
| GET | `/super-admin/sms-packages/platform-controls` | session | super_admin.sms_packages.view | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-packages.controller.ts |
| POST | `/super-admin/sms-packages/platform-controls` | session | super_admin.sms_emergency.disable | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-packages.controller.ts |
| GET | `/super-admin/sms-tenant-plan` | session | super_admin.sms_tenant_plan.view | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-tenant-plan.controller.ts |
| GET | `/super-admin/sms-tenant-plan/{tenantId}` | session | super_admin.sms_tenant_plan.view | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-tenant-plan.controller.ts |
| POST | `/super-admin/sms-tenant-plan/{tenantId}/assign` | session | super_admin.sms_tenant_plan.change | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-tenant-plan.controller.ts |
| POST | `/super-admin/sms-tenant-plan/{tenantId}/credit` | session | super_admin.sms_usage.adjust | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-tenant-plan.controller.ts |
| GET | `/super-admin/sms-tenant-plan/{tenantId}/usage` | session | super_admin.sms_usage.view | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-tenant-plan.controller.ts |
| GET | `/super-admin/sms-tenant-plan/billing/analytics` | session | super_admin.sms_billing.view | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-tenant-plan.controller.ts |
| GET | `/super-admin/sms-tenant-plan/billing/charges` | session | super_admin.sms_billing.view | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-tenant-plan.controller.ts |
| GET | `/super-admin/sms-tenant-plan/reconciliation/findings` | session | super_admin.sms_usage.view | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-tenant-plan.controller.ts |
| POST | `/super-admin/sms-tenant-plan/reconciliation/findings/{findingId}/resolve` | session | super_admin.sms_usage.adjust | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/sms-packages/sms-tenant-plan.controller.ts |
| GET | `/super-admin/staff/overview` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| GET | `/super-admin/staff/technicians/{technicianId}` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| GET | `/super-admin/staff/workforce` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| GET | `/super-admin/staff/workforce-connectivity` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| GET | `/super-admin/staff/workforce-cross-transfers` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| POST | `/super-admin/staff/workforce-cross-transfers/{id}/decision` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| GET | `/super-admin/staff/workforce-deactivation-queue` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| GET | `/super-admin/staff/workforce-duplicates` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| POST | `/super-admin/staff/workforce-duplicates/review` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| GET | `/super-admin/staff/workforce-overview` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| GET | `/super-admin/staff/workforce-payroll-sync` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| POST | `/super-admin/staff/workforce-payroll-sync/{id}/retry` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| GET | `/super-admin/staff/workforce-security-activity` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| POST | `/super-admin/staff/workforce-security-activity/review` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| GET | `/super-admin/staff/workforce-transfers` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| POST | `/super-admin/staff/workforce-transfers/{id}/decision` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| GET | `/super-admin/staff/workforce-views` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| POST | `/super-admin/staff/workforce-views` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| DELETE | `/super-admin/staff/workforce-views/{id}` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| GET | `/super-admin/staff/workforce/{userId}` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| POST | `/super-admin/staff/workforce/{userId}/access-support` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| POST | `/super-admin/staff/workforce/{userId}/cross-transfer` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| POST | `/super-admin/staff/workforce/{userId}/deactivate-access` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| POST | `/super-admin/staff/workforce/{userId}/transfer` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/super-admin/src/super-admin-staff/super-admin-staff.controller.ts |
| GET | `/super-admin/stream` | session | super_admin.system_operations.view (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-realtime.controller.ts |
| GET | `/super-admin/support/overview` | session | super_admin.support.view (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-support/super-admin-support.module.ts |
| POST | `/super-admin/support/tickets` | session | super_admin.support.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-support/super-admin-support.module.ts |
| GET | `/super-admin/support/tickets/{id}` | session | super_admin.support.view (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-support/super-admin-support.module.ts |
| POST | `/super-admin/support/tickets/{id}/internal-note` | session | super_admin.support.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-support/super-admin-support.module.ts |
| POST | `/super-admin/support/tickets/{id}/reply` | session | super_admin.support.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-support/super-admin-support.module.ts |
| POST | `/super-admin/support/tickets/{id}/status` | session | super_admin.support.manage (derived) | support | SuperAdminGuard | modules/super-admin/src/super-admin-support/super-admin-support.module.ts |
| GET | `/super-admin/system-health` | session | super_admin.system_operations.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-health/system-health.controller.ts |
| POST | `/super-admin/system-status/alerts/{alertId}/promote` | session | super_admin.system.manage (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| POST | `/super-admin/system-status/incidents` | session | super_admin.system.manage (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| POST | `/super-admin/system-status/incidents/{id}/commander` | session | super_admin.system.manage (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| POST | `/super-admin/system-status/incidents/{id}/status` | session | super_admin.system.manage (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| GET | `/super-admin/system-status/incidents/{id}/timeline` | session | super_admin.system_operations.view (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| POST | `/super-admin/system-status/incidents/{id}/timeline` | session | super_admin.system.manage (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| GET | `/super-admin/system-status/infrastructure` | session | super_admin.system_operations.view (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| POST | `/super-admin/system-status/maintenance` | session | super_admin.system.manage (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| POST | `/super-admin/system-status/notify-tenants` | session | super_admin.system.manage (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| GET | `/super-admin/system-status/overview` | session | super_admin.system_operations.view (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| POST | `/super-admin/system-status/post-incident-reports` | session | super_admin.system.manage (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| GET | `/super-admin/system-status/postmortems-owed` | session | super_admin.system_operations.view (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| POST | `/super-admin/system-status/public-updates` | session | super_admin.system.manage (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| GET | `/super-admin/system-status/realtime` | session | super_admin.system_operations.view (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| GET | `/super-admin/system-status/realtime/tenant/{tenantId}` | session | super_admin.system_operations.view (derived) | operations | SuperAdminGuard | super-admin-system-status/super-admin-system-status.module.ts |
| GET | `/super-admin/system/api` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/system-operations.ts |
| GET | `/super-admin/system/components/{key}/history` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/system-operations.ts |
| GET | `/super-admin/system/cost` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/capacity-ops.ts |
| PUT | `/super-admin/system/cost/prices` | session | super_admin.system.manage | operations | SuperAdminGuard | observability/capacity-ops.ts |
| GET | `/super-admin/system/dashboards/communications` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/ops-dashboards.ts |
| GET | `/super-admin/system/dashboards/deployments` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/ops-dashboards.ts |
| GET | `/super-admin/system/dashboards/incidents` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/ops-dashboards.ts |
| GET | `/super-admin/system/dashboards/mobile` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/ops-dashboards.ts |
| GET | `/super-admin/system/dashboards/payments` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/ops-dashboards.ts |
| GET | `/super-admin/system/dashboards/redis` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/ops-dashboards.ts |
| GET | `/super-admin/system/dashboards/storage` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/ops-dashboards.ts |
| GET | `/super-admin/system/load` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/capacity-ops.ts |
| GET | `/super-admin/system/mobile-telemetry` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/client-events.controller.ts |
| GET | `/super-admin/system/overview` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/system-operations.ts |
| PUT | `/super-admin/system/quotas/plans/{planId}` | session | super_admin.system.manage | operations | SuperAdminGuard | observability/capacity-ops.ts |
| GET | `/super-admin/system/quotas/tenants/{tenantId}` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/capacity-ops.ts |
| PUT | `/super-admin/system/quotas/tenants/{tenantId}` | session | super_admin.system.manage | operations | SuperAdminGuard | observability/capacity-ops.ts |
| GET | `/super-admin/system/runtime-safety` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/runtime-safety.ts |
| GET | `/super-admin/system/webhooks` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/capacity-ops.ts |
| GET | `/super-admin/tap-to-pay/tenants/{tenantId}/devices` | session | super_admin.payments.view (derived) | checkout | SuperAdminGuard | modules/checkout/src/mobile-checkout/ttp-onboarding.controller.ts |
| POST | `/super-admin/tap-to-pay/tenants/{tenantId}/devices/{deviceId}/approve` | session | super_admin.payments.manage (derived) | checkout | SuperAdminGuard | modules/checkout/src/mobile-checkout/ttp-onboarding.controller.ts |
| POST | `/super-admin/tap-to-pay/tenants/{tenantId}/devices/{deviceId}/revoke` | session | super_admin.payments.manage (derived) | checkout | SuperAdminGuard | modules/checkout/src/mobile-checkout/ttp-onboarding.controller.ts |
| GET | `/super-admin/tap-to-pay/tenants/{tenantId}/onboarding` | session | super_admin.payments.view (derived) | checkout | SuperAdminGuard | modules/checkout/src/mobile-checkout/ttp-onboarding.controller.ts |
| POST | `/super-admin/tap-to-pay/tenants/{tenantId}/onboarding` | session | super_admin.payments.manage (derived) | checkout | SuperAdminGuard | modules/checkout/src/mobile-checkout/ttp-onboarding.controller.ts |
| GET | `/super-admin/tech-profiles/dm-reports` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/workforce/src/tech-profile/tech-profile.super-admin.controller.ts |
| PATCH | `/super-admin/tech-profiles/dm-reports/{reportId}` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/workforce/src/tech-profile/tech-profile.super-admin.controller.ts |
| GET | `/super-admin/tech-profiles/verifications` | session | super_admin.technicians.view (derived) | workforce | SuperAdminGuard | modules/workforce/src/tech-profile/tech-profile.super-admin.controller.ts |
| PATCH | `/super-admin/tech-profiles/verifications/{profileId}` | session | super_admin.technicians.manage (derived) | workforce | SuperAdminGuard | modules/workforce/src/tech-profile/tech-profile.super-admin.controller.ts |
| PATCH | `/super-admin/technician-memberships/{membershipId}` | session | super_admin.technicians.memberships_manage | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| GET | `/super-admin/technicians` | session | super_admin.technicians.view | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| GET | `/super-admin/technicians/{profileId}` | session | super_admin.technicians.view | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| POST | `/super-admin/technicians/{profileId}/anonymize` | session | super_admin.technicians.anonymize | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| POST | `/super-admin/technicians/{profileId}/delete-request` | session | super_admin.technicians.delete_request | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| POST | `/super-admin/technicians/{profileId}/lock` | session | super_admin.technicians.security_manage | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| POST | `/super-admin/technicians/{profileId}/merge` | session | super_admin.technicians.merge | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| POST | `/super-admin/technicians/{profileId}/pause` | session | super_admin.technicians.pause | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| POST | `/super-admin/technicians/{profileId}/reactivate` | session | super_admin.technicians.reactivate | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| POST | `/super-admin/technicians/{profileId}/restore` | session | super_admin.technicians.restore | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| POST | `/super-admin/technicians/{profileId}/revoke-sessions` | session | super_admin.technicians.security_manage | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| POST | `/super-admin/technicians/{profileId}/scoped-pause` | session | super_admin.technicians.profile_moderate | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| GET | `/super-admin/technicians/{profileId}/status-history` | session | super_admin.technicians.view | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| GET | `/super-admin/technicians/{profileId}/support` | session | super_admin.technicians.view | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| POST | `/super-admin/technicians/{profileId}/suspend` | session | super_admin.technicians.suspend | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| POST | `/super-admin/technicians/{profileId}/unlock` | session | super_admin.technicians.security_manage | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| GET | `/super-admin/technicians/{profileId}/work-history` | session | super_admin.technicians.view | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| POST | `/super-admin/technicians/delete-requests/{requestId}/decision` | session | super_admin.technicians.delete_request | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| GET | `/super-admin/technicians/duplicates` | session | super_admin.technicians.view | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| GET | `/super-admin/technicians/my-elevation` | session | super_admin.technicians.view | workforce | RolePermissionGuard + SuperAdminGuard | modules/super-admin/src/super-admin-staff/global-tech-admin.controller.ts |
| GET | `/super-admin/tenant-activity` | session | super_admin.analytics.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenant-activity/tenant-activity.controller.ts |
| GET | `/super-admin/tenant-activity/{activityId}` | session | super_admin.analytics.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenant-activity/tenant-activity.controller.ts |
| GET | `/super-admin/tenant-activity/recent` | session | super_admin.analytics.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenant-activity/tenant-activity.controller.ts |
| GET | `/super-admin/tenant-activity/summary` | session | super_admin.analytics.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenant-activity/tenant-activity.controller.ts |
| GET | `/super-admin/tenant-health` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/tenant-health.ts |
| GET | `/super-admin/tenant-locations` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/tenants/src/tenant-locations/super-admin-locations.controller.ts |
| GET | `/super-admin/tenant-locations/{id}` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/tenants/src/tenant-locations/super-admin-locations.controller.ts |
| PATCH | `/super-admin/tenant-locations/{id}/map-pin` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/tenants/src/tenant-locations/super-admin-locations.controller.ts |
| POST | `/super-admin/tenant-locations/{id}/reject` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/tenants/src/tenant-locations/super-admin-locations.controller.ts |
| POST | `/super-admin/tenant-locations/{id}/suspend` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/tenants/src/tenant-locations/super-admin-locations.controller.ts |
| POST | `/super-admin/tenant-locations/{id}/verify` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/tenants/src/tenant-locations/super-admin-locations.controller.ts |
| GET | `/super-admin/tenant-locations/summary` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/tenants/src/tenant-locations/super-admin-locations.controller.ts |
| POST | `/super-admin/tenants` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| GET | `/super-admin/tenants/{id}/audit` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| PATCH | `/super-admin/tenants/{id}/commission` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/lifecycle` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| GET | `/super-admin/tenants/{id}/payment-gateway` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| PATCH | `/super-admin/tenants/{id}/payment-gateway` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/payment-gateway` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| GET | `/super-admin/tenants/{id}/payment-gateway/branches` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/payment-gateway/branches/{branchId}` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/payment-gateway/branches/{branchId}/status` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/payment-gateway/branches/{branchId}/test-connection` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/payment-gateway/disable` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/payment-gateway/pause` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/payment-gateway/resume` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| GET | `/super-admin/tenants/{id}/payment-gateway/settlements` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/payment-gateway/sync-merchant-status` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/payment-gateway/test-connection` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/payment-gateway/verify-credentials` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| GET | `/super-admin/tenants/{id}/payment-gateway/webhooks` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/payment-gateway/webhooks/rotate-secret` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/reactivate` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/reset-owner-password` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| PATCH | `/super-admin/tenants/{id}/status` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/support-access` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/suspend` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/{id}/warning` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| GET | `/super-admin/tenants/{id}/warnings` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| GET | `/super-admin/tenants/{tenantId}/a2p` | session | super_admin.tenants.view (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-a2p/tenant-a2p.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/a2p/brand` | session | super_admin.tenants.edit (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-a2p/tenant-a2p.controller.ts |
| PUT | `/super-admin/tenants/{tenantId}/a2p/business-info` | session | super_admin.tenants.edit (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-a2p/tenant-a2p.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/a2p/campaign` | session | super_admin.tenants.edit (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-a2p/tenant-a2p.controller.ts |
| PUT | `/super-admin/tenants/{tenantId}/a2p/inputs` | session | super_admin.tenants.edit (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-a2p/tenant-a2p.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/a2p/number` | session | super_admin.tenants.edit (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-a2p/tenant-a2p.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/a2p/provision-profile` | session | super_admin.tenants.edit (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-a2p/tenant-a2p.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/a2p/refresh` | session | super_admin.tenants.edit (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-a2p/tenant-a2p.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/ai-booking/link` | session | super_admin.tenants.edit (derived) | ai | SuperAdminGuard | ai-booking/ai-booking-admin.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/ai-booking/link/revoke` | session | super_admin.tenants.edit (derived) | ai | SuperAdminGuard | ai-booking/ai-booking-admin.controller.ts |
| GET | `/super-admin/tenants/{tenantId}/ai-booking/metrics` | session | super_admin.tenants.view (derived) | ai | SuperAdminGuard | ai-booking/ai-booking-admin.controller.ts |
| GET | `/super-admin/tenants/{tenantId}/ai-booking/system-status` | session | super_admin.tenants.view (derived) | ai | SuperAdminGuard | ai-booking/ai-booking-admin.controller.ts |
| GET | `/super-admin/tenants/{tenantId}/go-check-in` | session | super_admin.tenants.view (derived) | booking | SuperAdminGuard | modules/queue/src/go-check-in/go-check-in.admin.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/go-check-in` | session | super_admin.tenants.edit (derived) | booking | SuperAdminGuard | modules/queue/src/go-check-in/go-check-in.admin.controller.ts |
| PATCH | `/super-admin/tenants/{tenantId}/go-check-in/{deviceId}` | session | super_admin.tenants.edit (derived) | booking | SuperAdminGuard | modules/queue/src/go-check-in/go-check-in.admin.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/go-check-in/{deviceId}/disable` | session | super_admin.tenants.edit (derived) | booking | SuperAdminGuard | modules/queue/src/go-check-in/go-check-in.admin.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/go-check-in/{deviceId}/regenerate-token` | session | super_admin.tenants.edit (derived) | booking | SuperAdminGuard | modules/queue/src/go-check-in/go-check-in.admin.controller.ts |
| GET | `/super-admin/tenants/{tenantId}/go-check-in/logs` | session | super_admin.tenants.view (derived) | booking | SuperAdminGuard | modules/queue/src/go-check-in/go-check-in.admin.controller.ts |
| PATCH | `/super-admin/tenants/{tenantId}/go-check-in/settings` | session | super_admin.tenants.edit (derived) | booking | SuperAdminGuard | modules/queue/src/go-check-in/go-check-in.admin.controller.ts |
| GET | `/super-admin/tenants/{tenantId}/hardware` | session | super_admin.tenants.view (derived) | operations | SuperAdminGuard | modules/super-admin/src/super-admin-hardware-packages/super-admin-hardware-packages.module.ts |
| GET | `/super-admin/tenants/{tenantId}/hardware-payment-plan` | session | super_admin.tenants.view (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/hardware-payment-plan` | session | super_admin.tenants.edit (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| PATCH | `/super-admin/tenants/{tenantId}/hardware-payment-plan/{planId}` | session | super_admin.tenants.edit (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/hardware-payment/charge-shortfall` | session | super_admin.tenants.edit (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/hardware-payment/import-volume` | session | super_admin.tenants.edit (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| GET | `/super-admin/tenants/{tenantId}/hardware-payment/invoices` | session | super_admin.tenants.view (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| GET | `/super-admin/tenants/{tenantId}/hardware-payment/ledger` | session | super_admin.tenants.view (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/hardware-payment/pause` | session | super_admin.tenants.edit (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/hardware-payment/recalculate-month` | session | super_admin.tenants.edit (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| GET | `/super-admin/tenants/{tenantId}/hardware-payment/reconciliation` | session | super_admin.tenants.view (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/hardware-payment/resume` | session | super_admin.tenants.edit (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| GET | `/super-admin/tenants/{tenantId}/hardware-payment/settings` | session | super_admin.tenants.view (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| PATCH | `/super-admin/tenants/{tenantId}/hardware-payment/settings` | session | super_admin.tenants.edit (derived) | payments | SuperAdminGuard | modules/payments/src/hardware-payment/hardware-payment.super-admin.controller.ts |
| GET | `/super-admin/tenants/{tenantId}/health` | session | super_admin.system_operations.view | operations | SuperAdminGuard | observability/tenant-health.ts |
| GET | `/super-admin/tenants/{tenantId}/messaging-credentials` | session | super_admin.tenants.view (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-messaging/tenant-messaging.controller.ts |
| PUT | `/super-admin/tenants/{tenantId}/messaging-credentials` | session | super_admin.tenants.edit (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-messaging/tenant-messaging.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/messaging-credentials/test` | session | super_admin.tenants.edit (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-messaging/tenant-messaging.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/messaging-credentials/test-verify` | session | super_admin.tenants.edit (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-messaging/tenant-messaging.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/messaging/platform-offboard` | session | super_admin.integrations.manage | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/tenant-messaging/tenant-messaging.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/messaging/platform-provision` | session | super_admin.integrations.manage | communications | RolePermissionGuard + SuperAdminGuard | modules/communications/src/tenant-messaging/tenant-messaging.controller.ts |
| GET | `/super-admin/tenants/{tenantId}/number` | session | super_admin.tenants.view (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-messaging/tenant-messaging.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/number/buy` | session | super_admin.tenants.edit (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-messaging/tenant-messaging.controller.ts |
| POST | `/super-admin/tenants/{tenantId}/number/register` | session | super_admin.tenants.edit (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-messaging/tenant-messaging.controller.ts |
| GET | `/super-admin/tenants/{tenantId}/number/search` | session | super_admin.tenants.view (derived) | communications | SuperAdminGuard | modules/communications/src/tenant-messaging/tenant-messaging.controller.ts |
| GET | `/super-admin/tenants/{tenantId}/skip-line-checkout` | session | super_admin.tenants.view (derived) | checkout | SuperAdminGuard | modules/checkout/src/skip-line-checkout/skip-line-settings.controller.ts |
| PATCH | `/super-admin/tenants/{tenantId}/skip-line-checkout` | session | super_admin.tenants.edit (derived) | checkout | SuperAdminGuard | modules/checkout/src/skip-line-checkout/skip-line-settings.controller.ts |
| POST | `/super-admin/tenants/bulk-status` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| GET | `/super-admin/tenants/directory-overview` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| POST | `/super-admin/tenants/import` | session | super_admin.tenants.edit (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| GET | `/super-admin/tenants/state` | session | super_admin.tenants.view (derived) | tenants | SuperAdminGuard | modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts |
| GET | `/super-admin/tickets` | session | super_admin.operations.view (derived) | checkout | SuperAdminGuard | modules/super-admin/src/super-admin-tickets/super-admin-tickets.controller.ts |
| POST | `/super-admin/tickets/{ticketId}/deletion-code` | session | super_admin.tickets.remove | checkout | SuperAdminGuard | modules/super-admin/src/super-admin-ticket-removal/ticket-removal.controller.ts |
| POST | `/super-admin/tickets/{ticketId}/deletion-code/reveal` | session | super_admin.tickets.remove | checkout | SuperAdminGuard | modules/super-admin/src/super-admin-ticket-removal/ticket-removal.controller.ts |
| GET | `/super-admin/tickets/{ticketId}/history` | session | super_admin.operations.view (derived) | checkout | SuperAdminGuard | modules/super-admin/src/super-admin-tickets/super-admin-tickets.controller.ts |
| POST | `/super-admin/tickets/{ticketId}/remove` | session | super_admin.tickets.remove | checkout | SuperAdminGuard | modules/super-admin/src/super-admin-ticket-removal/ticket-removal.controller.ts |
| GET | `/super-admin/voice-transcription/overview` | session | super_admin.communications.view (derived) | ai | SuperAdminGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| POST | `/super-admin/voice-transcription/retention-sweep` | session | super_admin.communications.manage (derived) | ai | SuperAdminGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| GET | `/super-admin/voice/analytics` | session | super_admin.communications.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| GET | `/super-admin/voice/calls` | session | super_admin.communications.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| GET | `/super-admin/voice/calls/{callId}` | session | super_admin.communications.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| GET | `/super-admin/voice/fleet` | session | super_admin.communications.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| GET | `/super-admin/voice/gateway-metrics` | session | super_admin.communications.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| GET | `/super-admin/voice/keys` | session | super_admin.communications.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| POST | `/super-admin/voice/keys` | session | super_admin.communications.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| PATCH | `/super-admin/voice/keys/{id}/revoke` | session | super_admin.communications.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| POST | `/super-admin/voice/prompts/{id}/activate` | session | super_admin.communications.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| POST | `/super-admin/voice/prompts/{id}/submit` | session | super_admin.communications.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| GET | `/super-admin/voice/prompts/active` | session | super_admin.communications.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| POST | `/super-admin/voice/prompts/rollback` | session | super_admin.communications.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| GET | `/super-admin/voice/provisioning-metrics` | session | super_admin.communications.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| GET | `/super-admin/voice/suggestions` | session | super_admin.communications.view (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| POST | `/super-admin/voice/suggestions/{id}/approve` | session | super_admin.communications.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| POST | `/super-admin/voice/suggestions/{id}/reject` | session | super_admin.communications.manage (derived) | ai | SuperAdminGuard | modules/super-admin/src/super-admin-voice/super-admin-voice.controller.ts |
| GET | `/super-admin/website-leads` | session | super_admin.onboarding.view (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| POST | `/super-admin/website-leads` | session | super_admin.onboarding.manage (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| GET | `/super-admin/website-leads/{id}` | session | super_admin.onboarding.view (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| PATCH | `/super-admin/website-leads/{id}` | session | super_admin.onboarding.manage (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| PATCH | `/super-admin/website-leads/{id}/assign` | session | super_admin.onboarding.manage (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| POST | `/super-admin/website-leads/{id}/convert-to-application` | session | super_admin.onboarding.manage (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| POST | `/super-admin/website-leads/{id}/follow-ups` | session | super_admin.onboarding.manage (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| POST | `/super-admin/website-leads/{id}/notes` | session | super_admin.onboarding.manage (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| POST | `/super-admin/website-leads/{id}/recalculate-score` | session | super_admin.onboarding.manage (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| PATCH | `/super-admin/website-leads/{id}/status` | session | super_admin.onboarding.manage (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| GET | `/super-admin/website-leads/analytics/by-source` | session | super_admin.onboarding.view (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| GET | `/super-admin/website-leads/analytics/by-status` | session | super_admin.onboarding.view (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| GET | `/super-admin/website-leads/analytics/top-sources` | session | super_admin.onboarding.view (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| GET | `/super-admin/website-leads/export` | session | super_admin.onboarding.view (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| GET | `/super-admin/website-leads/kpis` | session | super_admin.onboarding.view (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| GET | `/super-admin/website-leads/recent-activity` | session | super_admin.onboarding.view (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| GET | `/super-admin/website-leads/state` | session | super_admin.onboarding.view (derived) | marketing | SuperAdminGuard | modules/super-admin/src/super-admin-website-leads/super-admin-website-leads.module.ts |
| GET | `/tech` | session | tech.dashboard.view | workforce | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/ai-schedule/changes` | session | ai_scheduling.view_own | ai | RolePermissionGuard + TenantAuthGuard | modules/ai/src/ai-scheduling-optimizer/ai-scheduling-tech.ts |
| POST | `/tech/cash-handoff/submit` | session | tech.cash.manage | payments | — | modules/workforce/src/tech-cash-handoff/tech-cash-handoff.tech.controller.ts |
| GET | `/tech/certifications` | session | tech.dashboard.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech/technician-certifications.controller.ts |
| POST | `/tech/certifications` | session | tech.profile.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech/technician-certifications.controller.ts |
| DELETE | `/tech/certifications/{id}` | session | tech.profile.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech/technician-certifications.controller.ts |
| PATCH | `/tech/certifications/{id}` | session | tech.profile.edit | workforce | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech/technician-certifications.controller.ts |
| GET | `/tech/compensation-agreements` | session | tech.earnings.view | finance | — | modules/workforce/src/compensation/compensation-tech-agreements.controller.ts |
| POST | `/tech/compensation-agreements/{id}/acknowledge` | session | tech.earnings.view | finance | — | modules/workforce/src/compensation/compensation-tech-agreements.controller.ts |
| POST | `/tech/context/switch` | session | tech.dashboard.view | workforce | TenantAuthGuard | modules/workforce/src/tech-profile/tech-workplaces.controller.ts |
| GET | `/tech/customers` | session | tech.dashboard.view | customers | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech/tech-self-service.controller.ts |
| GET | `/tech/deals` | session | tech.dashboard.view | deals | — | modules/deals/src/deals/deals.tech.controller.ts |
| POST | `/tech/deals` | session | tech.deals.manage | deals | — | modules/deals/src/deals/deals.tech.controller.ts |
| POST | `/tech/deals/{id}/pause` | session | tech.deals.manage | deals | — | modules/deals/src/deals/deals.tech.controller.ts |
| POST | `/tech/deals/{id}/submit` | session | tech.deals.manage | deals | — | modules/deals/src/deals/deals.tech.controller.ts |
| GET | `/tech/deals/services` | session | services.view | deals | — | modules/deals/src/deals/deals.tech.controller.ts |
| GET | `/tech/deals/settings` | session | tech.dashboard.view | deals | — | modules/deals/src/deals/deals.tech.controller.ts |
| GET | `/tech/earnings` | session | tech.earnings.view | finance | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/earnings/canonical` | session | tech.earnings.view | finance | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/earnings/receipt/{ticketId}` | session | tech.earnings.view | finance | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/follow-ups` | session | tech.dashboard.view | marketing | — | modules/communications/src/end-of-day-followups/end-of-day-followups.tech.controller.ts |
| GET | `/tech/follow-ups/{id}` | session | tech.dashboard.view | marketing | — | modules/communications/src/end-of-day-followups/end-of-day-followups.tech.controller.ts |
| POST | `/tech/follow-ups/{id}/custom-message-preview` | session | tech.followups.manage | marketing | — | modules/communications/src/end-of-day-followups/end-of-day-followups.tech.controller.ts |
| POST | `/tech/follow-ups/{id}/dismiss` | session | tech.followups.manage | marketing | — | modules/communications/src/end-of-day-followups/end-of-day-followups.tech.controller.ts |
| PATCH | `/tech/follow-ups/{id}/message` | session | tech.followups.manage | marketing | — | modules/communications/src/end-of-day-followups/end-of-day-followups.tech.controller.ts |
| POST | `/tech/follow-ups/{id}/send` | session | tech.followups.manage | marketing | — | modules/communications/src/end-of-day-followups/end-of-day-followups.tech.controller.ts |
| POST | `/tech/follow-ups/{id}/skip` | session | tech.followups.manage | marketing | — | modules/communications/src/end-of-day-followups/end-of-day-followups.tech.controller.ts |
| GET | `/tech/follow-ups/templates` | session | tech.dashboard.view | marketing | — | modules/communications/src/end-of-day-followups/end-of-day-followups.tech.controller.ts |
| GET | `/tech/follow-ups/today` | session | tech.dashboard.view | marketing | — | modules/communications/src/end-of-day-followups/end-of-day-followups.tech.controller.ts |
| GET | `/tech/help-requests` | session | tech.ticket.accept | workforce | — | modules/queue/src/technician-help/technician-help.controller.ts |
| POST | `/tech/help-requests` | session | tech.ticket.transfer_request | workforce | — | modules/queue/src/technician-help/technician-help.controller.ts |
| POST | `/tech/help-requests/{id}/accept` | session | tech.ticket.accept | workforce | — | modules/queue/src/technician-help/technician-help.controller.ts |
| POST | `/tech/help-requests/{id}/decline` | session | tech.ticket.decline | workforce | — | modules/queue/src/technician-help/technician-help.controller.ts |
| GET | `/tech/help-requests/qualified` | session | tech.ticket.transfer_request | workforce | — | modules/queue/src/technician-help/technician-help.controller.ts |
| POST | `/tech/help/message` | session | tech.dashboard.view | support | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/manager-messages` | session | pos.technicians.view | workforce | — | modules/queue/src/tech/tech.controller.ts |
| PATCH | `/tech/manager-messages/{id}/resolve` | session | pos.technicians.view | workforce | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/me/cash-handoff` | session | tech.cash.manage | payments | — | modules/workforce/src/tech-cash-handoff/tech-cash-handoff.tech.controller.ts |
| GET | `/tech/me/cash-pending` | session | tech.cash.manage | checkout | — | modules/checkout/src/skip-line-checkout/tech-cash-confirmation.controller.ts |
| POST | `/tech/me/delete-account-request` | session | self.profile.edit | identity | — | account/account.controllers.ts |
| GET | `/tech/me/locale` | session | self.profile.view | identity | — | account/language.controller.ts |
| GET | `/tech/me/privacy-export` | session | self.profile.view | identity | — | account/account.controllers.ts |
| GET | `/tech/more/state` | session | tech.dashboard.view | workforce | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/notifications` | session | tech.notifications.manage | communications | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/notifications/read` | session | tech.notifications.manage | communications | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/operations` | session | self.operations.view | operations | TenantAuthGuard | common/async-export/operations.controller.ts |
| GET | `/tech/operations/{id}` | session | self.operations.view | operations | TenantAuthGuard | common/async-export/operations.controller.ts |
| GET | `/tech/operations/{id}/download` | session | self.operations.view | operations | TenantAuthGuard | common/async-export/operations.controller.ts |
| GET | `/tech/payroll` | session | tech.payroll.view | finance | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/payroll/cash-payouts/{payoutId}/acknowledge` | session | tech.payroll.view | finance | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/payroll/cash-payouts/{payoutId}/dispute` | session | tech.payroll.view | finance | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/payroll/inquiries` | session | tech.payroll.view | finance | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/payroll/inquiries` | session | tech.payroll.view | finance | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/payroll/payouts` | session | tech.payroll.view | finance | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/payroll/statements` | session | tech.payroll.view | finance | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/payroll/statements/{statementId}` | session | tech.payroll.view | finance | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/performance` | session | tech.earnings.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech/tech-self-service.controller.ts |
| GET | `/tech/profile` | session | tech.dashboard.view | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| PATCH | `/tech/profile` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| GET | `/tech/profile/analytics` | session | tech.dashboard.view | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/avatar` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| GET | `/tech/profile/before-after` | session | tech.dashboard.view | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/before-after` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| DELETE | `/tech/profile/before-after/{setId}` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| PATCH | `/tech/profile/before-after/{setId}` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| DELETE | `/tech/profile/cover` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/cover` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/membership-request` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/membership-request/{requestId}/cancel` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| GET | `/tech/profile/membership-status` | session | tech.dashboard.view | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| GET | `/tech/profile/messages` | session | tech.dashboard.view | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| GET | `/tech/profile/messages/{threadId}` | session | tech.dashboard.view | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/messages/{threadId}` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/messages/{threadId}/block` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/messages/{threadId}/report` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/pending-changes/withdraw` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| GET | `/tech/profile/photos` | session | tech.dashboard.view | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/photos` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| DELETE | `/tech/profile/photos/{photoId}` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| PATCH | `/tech/profile/photos/{photoId}` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/photos/{photoId}/consent` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/photos/{photoId}/consent/withdraw` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| DELETE | `/tech/profile/photos/{photoId}/showcase` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/photos/{photoId}/showcase` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| PATCH | `/tech/profile/photos/reorder` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| GET | `/tech/profile/public-preview` | session | tech.dashboard.view | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| GET | `/tech/profile/ratings` | session | tech.dashboard.view | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/ratings/{reviewId}/respond` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| POST | `/tech/profile/verification/request` | session | tech.profile.edit | workforce | — | modules/workforce/src/tech-profile/tech-profile.controller.ts |
| GET | `/tech/queue/state` | session | tech.dashboard.view | booking | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/schedule` | session | tech.schedule.view | booking | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/service-history` | session | tech.ticket.view | workforce | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/settings` | session | tech.dashboard.view | tenants | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/skills` | session | tech.dashboard.view | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/skills/change-request` | session | tech.profile.edit | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/skills/change-request/{id}` | session | tech.profile.edit | workforce | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/skills/change-requests` | session | tech.dashboard.view | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/skills/change-requests/{id}/decision` | session | technicians.edit | workforce | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/skills/change-requests/pending` | session | technicians.edit | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/skills/upload-document` | session | tech.profile.edit | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/status/available` | session | tech.break.end | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/status/break` | session | tech.break.start | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/status/end-break` | session | tech.break.end | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/status/start-break` | session | tech.break.start | workforce | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/stream` | session | tech.dashboard.view | operations | TenantAuthGuard | domain-streams/tech-realtime.controller.ts |
| GET | `/tech/tickets` | session | tech.ticket.view | workforce | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/tickets/{id}` | session | tech.ticket.view | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/tickets/{id}/accept` | session | tech.ticket.accept | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/tickets/{id}/add-addon` | session | tech.ticket.add_addon | workforce | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/tickets/{id}/change-requests` | session | tech.ticket.view | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/tickets/{id}/change-requests` | session | tech.ticket.edit_lines | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/tickets/{id}/decline` | session | tech.ticket.decline | workforce | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/tickets/{id}/edit-options` | session | tech.ticket.view | workforce | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/tickets/{id}/membership` | session | tech.ticket.view | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/tickets/{id}/notes` | session | tech.service.note_add | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/tickets/{id}/pause` | session | tech.service.pause | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/tickets/{id}/request-cancel` | session | tech.ticket.cancel_request | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/tickets/{id}/resume` | session | tech.service.pause | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/tickets/{id}/service-done` | session | tech.service.complete | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/tickets/{id}/service-lines` | session | tech.ticket.edit_lines | workforce | — | modules/queue/src/tech/tech.controller.ts |
| DELETE | `/tech/tickets/{id}/service-lines/{lineId}` | session | tech.ticket.edit_lines | workforce | — | modules/queue/src/tech/tech.controller.ts |
| PATCH | `/tech/tickets/{id}/service-lines/{lineId}` | session | tech.ticket.edit_lines | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/tickets/{id}/start-service` | session | tech.service.start | workforce | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/tickets/{ticketId}/cash-payment` | session | tech.cash.manage | checkout | — | modules/checkout/src/skip-line-checkout/tech-cash-confirmation.controller.ts |
| POST | `/tech/tickets/{ticketId}/confirm-cash-received` | session | tech.cash.manage | checkout | — | modules/checkout/src/skip-line-checkout/tech-cash-confirmation.controller.ts |
| POST | `/tech/tickets/{ticketId}/report-cash-not-paid` | session | tech.cash.manage | checkout | — | modules/checkout/src/skip-line-checkout/tech-cash-confirmation.controller.ts |
| GET | `/tech/time-clock` | session | tech.timeclock.punch | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/time-clock/clock-in` | session | tech.timeclock.punch | workforce | — | modules/queue/src/tech/tech.controller.ts |
| POST | `/tech/time-clock/clock-out` | session | tech.timeclock.punch | workforce | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/time-clock/summary` | session | tech.dashboard.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech/tech-self-service.controller.ts |
| GET | `/tech/time-off` | session | tech.schedule.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-off/technician-time-off.controller.ts |
| POST | `/tech/time-off` | session | tech.time_off.request | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-off/technician-time-off.controller.ts |
| DELETE | `/tech/time-off/{id}` | session | tech.time_off.request | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/time-off/technician-time-off.controller.ts |
| GET | `/tech/tips` | session | tech.earnings.view | finance | RolePermissionGuard + TenantAuthGuard | modules/queue/src/tech/tech-self-service.controller.ts |
| GET | `/tech/turn-queue` | session | tech.turn_queue.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| GET | `/tech/turn-queue/summary` | session | tech.turn_queue.view | workforce | RolePermissionGuard + TenantAuthGuard | modules/workforce/src/turn-queue/turn-queue.controller.ts |
| GET | `/tech/working-hours` | session | tech.dashboard.view | workforce | — | modules/queue/src/tech/tech.controller.ts |
| GET | `/tech/workplaces` | session | tech.dashboard.view | workforce | TenantAuthGuard | modules/workforce/src/tech-profile/tech-workplaces.controller.ts |
| POST | `/tech/workplaces/{membershipId}/accept` | session | tech.profile.edit | workforce | TenantAuthGuard | modules/workforce/src/tech-profile/tech-workplaces.controller.ts |
| POST | `/tech/workplaces/{membershipId}/decline` | session | tech.profile.edit | workforce | TenantAuthGuard | modules/workforce/src/tech-profile/tech-workplaces.controller.ts |
| POST | `/technician/inventory/reports` | session | inventory.technician_report.submit | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/technician-inventory.controller.ts |
| GET | `/technician/inventory/reports/mine` | session | inventory.technician_report.submit | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/technician-inventory.controller.ts |
| GET | `/technician/inventory/search` | session | inventory.view_limited | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/technician-inventory.controller.ts |
| POST | `/technician/inventory/units/{unitId}/open` | session | inventory.bottle.open | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/technician-inventory.controller.ts |
| GET | `/tenant/account/invoices/state` | session | settings.view | finance | RolePermissionGuard + TenantAuthGuard | modules/super-admin/src/tenant-billing/tenant-billing.controller.ts |
| GET | `/tenant/account/usage-limits/state` | session | settings.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/tenant-entitlements/tenant-entitlements.controller.ts |
| POST | `/tenant/ai/call-intelligence/events` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/call-intelligence/call-intelligence.controller.ts |
| GET | `/tenant/ai/call-intelligence/recent` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/call-intelligence/call-intelligence.controller.ts |
| GET | `/tenant/ai/call-intelligence/summary` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/call-intelligence/call-intelligence.controller.ts |
| POST | `/tenant/ai/center/copilot` | session | reception_copilot.use | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/action` | session | reception_copilot.use | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| GET | `/tenant/ai/center/copilot/ai-phone-activity` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/availability` | session | reception_copilot.view_recommendations | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/conflict` | session | reception_copilot.view_recommendations | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/context` | session | reception_copilot.view_customer_context | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/draft-message` | session | reception_copilot.draft_messages | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| GET | `/tenant/ai/center/copilot/duplicates` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/explain-service` | session | reception_copilot.explain_services | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/feedback` | session | reception_copilot.give_feedback | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| GET | `/tenant/ai/center/copilot/feedback/summary` | session | reception_copilot.view_usage | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/hold` | session | pos.booking.create | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/hold/release` | session | pos.booking.create | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/intent` | session | reception_copilot.use | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/learning/approve` | session | reception_copilot.approve_learning | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/learning/dismiss` | session | reception_copilot.approve_learning | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/learning/generate` | session | reception_copilot.view_learning | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| GET | `/tenant/ai/center/copilot/learning/knowledge` | session | reception_copilot.view_learning | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| GET | `/tenant/ai/center/copilot/learning/suggestions` | session | reception_copilot.view_learning | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/next-actions` | session | reception_copilot.view_recommendations | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| GET | `/tenant/ai/center/copilot/queue` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/recommendation` | session | reception_copilot.use | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| GET | `/tenant/ai/center/copilot/recommendations` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/session/end` | session | reception_copilot.use | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/session/start` | session | reception_copilot.use | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| GET | `/tenant/ai/center/copilot/settings` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| PATCH | `/tenant/ai/center/copilot/settings` | session | ai.manage | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/take-over-call` | session | reception_copilot.take_over_calls | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| POST | `/tenant/ai/center/copilot/technicians` | session | reception_copilot.view_recommendations | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| GET | `/tenant/ai/center/copilot/waitlist` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| GET | `/tenant/ai/center/overview` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/ai-center/ai-center.controller.ts |
| GET | `/tenant/ai/control-modes` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/ai-governance/ai-governance.controller.ts |
| PATCH | `/tenant/ai/control-modes/{assistantKey}` | session | ai.control.manage | ai | TenantAuthGuard | modules/ai/src/ai-governance/ai-governance.controller.ts |
| GET | `/tenant/ai/packages` | session | ai.use | ai | — | modules/super-admin/src/tenant-ai/tenant-ai.controller.ts |
| GET | `/tenant/ai/plans` | session | ai.use | ai | — | modules/super-admin/src/tenant-ai/tenant-ai.controller.ts |
| PATCH | `/tenant/ai/plans/{code}/cancel` | session | ai.manage | ai | — | modules/super-admin/src/tenant-ai/tenant-ai.controller.ts |
| POST | `/tenant/ai/plans/{code}/trial` | session | ai.manage | ai | — | modules/super-admin/src/tenant-ai/tenant-ai.controller.ts |
| GET | `/tenant/ai/receptionist/agents` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| POST | `/tenant/ai/receptionist/agents` | session | ai.manage | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| GET | `/tenant/ai/receptionist/agents/{id}` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| PATCH | `/tenant/ai/receptionist/agents/{id}` | session | ai.manage | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| POST | `/tenant/ai/receptionist/agents/{id}/provision` | session | ai.manage | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| POST | `/tenant/ai/receptionist/agents/{id}/status` | session | ai.manage | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| GET | `/tenant/ai/receptionist/calls` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| GET | `/tenant/ai/receptionist/calls/{providerCallId}` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| GET | `/tenant/ai/receptionist/faqs` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| POST | `/tenant/ai/receptionist/faqs` | session | ai.manage | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| DELETE | `/tenant/ai/receptionist/faqs/{id}` | session | ai.manage | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| PATCH | `/tenant/ai/receptionist/faqs/{id}` | session | ai.manage | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| GET | `/tenant/ai/receptionist/follow-ups` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| POST | `/tenant/ai/receptionist/follow-ups` | session | ai.manage | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| POST | `/tenant/ai/receptionist/follow-ups/{id}/assign` | session | ai.manage | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| POST | `/tenant/ai/receptionist/follow-ups/{id}/note` | session | ai.manage | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| POST | `/tenant/ai/receptionist/follow-ups/{id}/status` | session | ai.manage | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| GET | `/tenant/ai/receptionist/overview` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| GET | `/tenant/ai/receptionist/provisioning/{jobId}` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| GET | `/tenant/ai/receptionist/settings` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| PATCH | `/tenant/ai/receptionist/settings` | session | ai.manage | ai | TenantAuthGuard | modules/ai/src/voice-booking/tenant-receptionist.controller.ts |
| POST | `/tenant/ai/revenue/attributions` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/ai-revenue/ai-revenue.controller.ts |
| GET | `/tenant/ai/revenue/summary` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/ai-revenue/ai-revenue.controller.ts |
| GET | `/tenant/ai/subscriptions` | session | ai.use | ai | — | modules/super-admin/src/tenant-ai/tenant-ai.controller.ts |
| POST | `/tenant/ai/subscriptions` | session | ai.manage | ai | — | modules/super-admin/src/tenant-ai/tenant-ai.controller.ts |
| PATCH | `/tenant/ai/subscriptions/{code}/cancel` | session | ai.manage | ai | — | modules/super-admin/src/tenant-ai/tenant-ai.controller.ts |
| GET | `/tenant/ai/usage` | session | ai.use | ai | — | modules/super-admin/src/tenant-ai/tenant-ai.controller.ts |
| POST | `/tenant/ai/workflows/runs` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/workflow-runs/workflow-runs.controller.ts |
| GET | `/tenant/ai/workflows/runs/summary` | session | ai.use | ai | TenantAuthGuard | modules/ai/src/workflow-runs/workflow-runs.controller.ts |
| GET | `/tenant/help/articles` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| GET | `/tenant/help/articles/{id}` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/articles/{id}/feedback` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/articles/{id}/view` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/assistant/ask` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/assistant/escalate` | session | help.request | support | — | modules/support/src/help/help.controller.ts |
| GET | `/tenant/help/categories` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| GET | `/tenant/help/dashboard` | session | help.view | tenants | — | modules/tenants/src/tenant-navigation/tenant-navigation.controller.ts |
| GET | `/tenant/help/sessions` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/sessions` | session | help.request | support | — | modules/support/src/help/help.controller.ts |
| GET | `/tenant/help/status` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| GET | `/tenant/help/tickets` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/tickets` | session | help.request | support | — | modules/support/src/help/help.controller.ts |
| GET | `/tenant/help/tickets/{id}` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/tickets/{id}/assign` | session | help.triage | support | — | modules/support/src/help/help.controller.ts |
| GET | `/tenant/help/tickets/{id}/attachments` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/tickets/{id}/attachments` | session | help.request | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/tickets/{id}/attachments/{attachmentId}/delete` | session | help.request | support | — | modules/support/src/help/help.controller.ts |
| GET | `/tenant/help/tickets/{id}/attachments/{attachmentId}/download` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/tickets/{id}/csat` | session | help.request | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/tickets/{id}/notify` | session | help.triage | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/tickets/{id}/priority` | session | help.triage | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/tickets/{id}/reply` | session | help.request | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/tickets/{id}/status` | session | help.triage | support | — | modules/support/src/help/help.controller.ts |
| GET | `/tenant/help/tickets/export` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| GET | `/tenant/help/tickets/stats` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| GET | `/tenant/help/updates` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| GET | `/tenant/help/videos` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| GET | `/tenant/help/videos/{id}` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| POST | `/tenant/help/videos/{id}/progress` | session | help.view | support | — | modules/support/src/help/help.controller.ts |
| GET | `/tenant/inventory/alert-feed` | session | inventory.view | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/alert-feed/{id}/acknowledge` | session | inventory.view | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/alerts` | session | inventory.view | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/brands` | session | inventory.view | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/brands` | session | inventory.brand.manage | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| PATCH | `/tenant/inventory/brands/{id}` | session | inventory.brand.manage | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/brands/{id}/archive` | session | inventory.brand.manage | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/categories` | session | inventory.view | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/categories` | session | inventory.category.manage | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| PATCH | `/tenant/inventory/categories/{id}` | session | inventory.category.manage | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/categories/{id}/archive` | session | inventory.category.manage | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/counts` | session | inventory.stock.count | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/counts` | session | inventory.stock.count | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/counts/{id}` | session | inventory.stock.count | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/counts/{id}/cancel` | session | inventory.stock.count | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/counts/{id}/lines` | session | inventory.stock.count | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/counts/{id}/reconcile` | session | inventory.stock.adjust | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/counts/{id}/submit` | session | inventory.stock.count | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/products` | session | inventory.view | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/products` | session | inventory.create | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/products/{id}` | session | inventory.view | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| PATCH | `/tenant/inventory/products/{id}` | session | inventory.update | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/products/{id}/archive` | session | inventory.archive | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| PATCH | `/tenant/inventory/products/{id}/stock-overrides` | session | inventory.update | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/products/{id}/stock/add` | session | inventory.stock.add | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/purchase-orders` | session | inventory.purchase_order.view | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/purchase-orders` | session | inventory.purchase_order.create | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/purchase-orders/{id}` | session | inventory.purchase_order.view | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/purchase-orders/{id}/approve` | session | inventory.purchase_order.approve | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/purchase-orders/{id}/cancel` | session | inventory.purchase_order.create | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/purchase-orders/{id}/receive` | session | inventory.purchase_order.receive | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/receipt-expense` | session | inventory.create | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/recipes` | session | inventory.view | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/recipes/{serviceId}` | session | inventory.view | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| PUT | `/tenant/inventory/recipes/{serviceId}` | session | inventory.update | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/recipes/{serviceId}/consume` | session | inventory.product_usage.submit | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/summary` | session | inventory.view | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/technician-reports` | session | inventory.technician_report.approve | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/technician-reports/{id}/approve` | session | inventory.technician_report.approve | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/technician-reports/{id}/reject` | session | inventory.technician_report.approve | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/transfers` | session | inventory.transfer | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/transfers` | session | inventory.transfer | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/transfers/{id}` | session | inventory.transfer | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/transfers/branches` | session | inventory.transfer | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/units/{unitId}/mark-damaged` | session | inventory.update | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/units/{unitId}/mark-empty` | session | inventory.update | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/units/{unitId}/mark-low` | session | inventory.update | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/units/{unitId}/open` | session | inventory.update | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/inventory/vendors` | session | inventory.view | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/vendors` | session | inventory.vendor.manage | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| PATCH | `/tenant/inventory/vendors/{id}` | session | inventory.vendor.manage | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| POST | `/tenant/inventory/vendors/{id}/archive` | session | inventory.vendor.manage | inventory | RolePermissionGuard + TenantAuthGuard | modules/inventory/src/inventory.controller.ts |
| GET | `/tenant/locations` | session | locations.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/tenant-locations/tenant-locations.controller.ts |
| POST | `/tenant/locations` | session | locations.create | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/tenant-locations/tenant-locations.controller.ts |
| GET | `/tenant/locations/{id}` | session | locations.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/tenant-locations/tenant-locations.controller.ts |
| PATCH | `/tenant/locations/{id}` | session | locations.update | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/tenant-locations/tenant-locations.controller.ts |
| POST | `/tenant/locations/{id}/apply-address` | session | locations.map.update | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/tenant-locations/tenant-locations.controller.ts |
| POST | `/tenant/locations/{id}/confirm-pin` | session | locations.map.update | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/tenant-locations/tenant-locations.controller.ts |
| PATCH | `/tenant/locations/{id}/map-pin` | session | locations.map.update | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/tenant-locations/tenant-locations.controller.ts |
| GET | `/tenant/locations/{id}/public-preview` | session | locations.view | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/tenant-locations/tenant-locations.controller.ts |
| POST | `/tenant/locations/{id}/publish` | session | locations.publish | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/tenant-locations/tenant-locations.controller.ts |
| POST | `/tenant/locations/{id}/unpublish` | session | locations.unpublish | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/tenant-locations/tenant-locations.controller.ts |
| POST | `/tenant/locations/geocode` | session | locations.update | tenants | RolePermissionGuard + TenantAuthGuard | modules/tenants/src/tenant-locations/tenant-locations.controller.ts |
| DELETE | `/tenant/messaging/credentials` | session | settings.edit | communications | TenantAuthGuard | modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts |
| GET | `/tenant/messaging/credentials` | session | settings.view | communications | TenantAuthGuard | modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts |
| PUT | `/tenant/messaging/credentials` | session | settings.edit | communications | TenantAuthGuard | modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts |
| GET | `/tenant/messaging/credentials/branches` | session | settings.view | communications | TenantAuthGuard | modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts |
| DELETE | `/tenant/messaging/credentials/branches/{branchId}` | session | settings.edit | communications | TenantAuthGuard | modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts |
| GET | `/tenant/messaging/credentials/branches/{branchId}` | session | settings.view | communications | TenantAuthGuard | modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts |
| PUT | `/tenant/messaging/credentials/branches/{branchId}` | session | settings.edit | communications | TenantAuthGuard | modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts |
| POST | `/tenant/messaging/credentials/branches/{branchId}/test-verify` | session | settings.edit | communications | TenantAuthGuard | modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts |
| POST | `/tenant/messaging/credentials/test` | session | settings.edit | communications | TenantAuthGuard | modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts |
| POST | `/tenant/messaging/credentials/test-verify` | session | settings.edit | communications | TenantAuthGuard | modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts |
| GET | `/tenant/messaging/number` | session | settings.view | communications | TenantAuthGuard | modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts |
| POST | `/tenant/messaging/number/buy` | session | settings.edit | communications | TenantAuthGuard | modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts |
| POST | `/tenant/messaging/number/register` | session | settings.edit | communications | TenantAuthGuard | modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts |
| GET | `/tenant/messaging/number/search` | session | settings.view | communications | TenantAuthGuard | modules/communications/src/tenant-messaging/tenant-messaging.tenant.controller.ts |
| GET | `/tenant/navigation` | session | dashboard.view | tenants | — | modules/tenants/src/tenant-navigation/tenant-navigation.controller.ts |
| GET | `/tenant/navigation/badges` | session | dashboard.view | tenants | — | modules/tenants/src/tenant-navigation/tenant-navigation.controller.ts |
| GET | `/tenant/sms-plan` | session | settings.view | communications | — | modules/communications/src/sms-packages/tenant-sms-plan.controller.ts |
| POST | `/tenant/sms-plan/upgrade` | session | settings.edit | communications | — | modules/communications/src/sms-packages/tenant-sms-plan.controller.ts |
| GET | `/tenant/system-status` | session | dashboard.view | tenants | — | modules/tenants/src/tenant-navigation/tenant-navigation.controller.ts |
| POST | `/voice-transcription/webhook` | api_key | — | ai | VoiceAuthGuard + VoiceKeyRateLimitGuard | modules/ai/src/ai-voice-transcription/ai-voice-transcription.controller.ts |
| POST | `/voice/calls/{callId}/outcome` | api_key | — | ai | VoiceAuthGuard + VoiceKeyRateLimitGuard | modules/ai/src/voice-booking/voice-booking.controller.ts |
| POST | `/voice/tool` | api_key | — | ai | VoiceAuthGuard + VoiceKeyRateLimitGuard | modules/ai/src/voice-booking/voice-booking.controller.ts |
| POST | `/webhooks/bank/{token}` | public | — | payments | — | modules/payments/src/deposit-reconciliation/deposit-reconciliation.webhook.controller.ts |
| POST | `/webhooks/payments/{processor}` | public | — | payments | — | modules/payments/src/payments/payment-webhook.controller.ts |
| POST | `/webhooks/twilio/booking-verification/status` | public | — | booking | — | modules/booking/src/customer-booking/booking-verification-webhook.controller.ts |
| POST | `/webhooks/twilio/sms/inbound` | public | — | communications | — | modules/communications/src/messaging-inbound/twilio-inbound.controller.ts |
| POST | `/webhooks/twilio/sms/status` | public | — | communications | — | modules/communications/src/messaging-inbound/twilio-inbound.controller.ts |
