# MERGED_PROJECT_MAP.md — AI PowerSalon

Module/route/table maps for the merged tree. **Bold** = added or rewired during this merge.

## Frontend module map (9 apps)
- **pos-web** (25 screens): Overview, Dashboard, Check-In, Booking, Tech Appointments, Live Schedule, Tech
  Queue, Queue, Serving, Service Done, Checkout, End-of-Day Cash, Cash Drawer, Customers, **Messages**,
  Follow-Up Queue, NailShowcase, Technicians, Skill Requests, Services, Reports, Follow-Up Settings, Settings.
- **admin-web** (28 screens): Dashboard, Tenants, Applications, WebsiteLeads, HardwarePackages, HardwarePayments,
  HardwarePaymentReports, PaymentGateways, AIPackages, AiSubscriptions, UsageLimits, UsersRoles, SupportAccess,
  Billing, PlatformReports, SystemHealth, AuditLogs, Alerts, AppControls, CheckInDevices, TenantActivity,
  SuperAdminOwners, SuperAdminNailShowcaseModeration, ProjectStatus, Settings, Login, Hardware, Leads.
- **owner-web**: multi-salon home, branch performance, staff/tech performance, cash screens, expenses,
  finance reports, hardware/payment, alerts, booking overview.
- **tech-web**: queue/earnings, ticket detail, live ticket edit, schedule, profile, notifications, settings.
- **customer-web**: booking, favorites, find techs, tech profiles, social posts, ratings, visits.
- **customer-display** / **go-check-in-kiosk** / **go-check-in-admin**: device-facing checkout & kiosk check-in.

## Backend module map (64 modules) — selected
- POS flow: booking, check-in, queue, serving, service-done, checkout, cash-drawer, tech-cash-handoff,
  skip-line-checkout.
- Catalog/people: services, customers, technicians, tech-profile, tech-appointments, tech-queue.
- Payments: payments (webhook + reconciliation), hardware-payment.
- AI: ai, tenant-ai, super-admin-ai, ai-subscription-billing.
- Super-Admin: **super-admin-platform** (consolidates applications, leads, hardware, audit-logs,
  payment-gateways, ai-packages, usage-limits, reports, users/roles, support-sessions, app-flags),
  super-admin-tenants, super-admin-owners, super-admin-dashboard, super-admin-overview, super-admin-alerts,
  super-admin-tenant-activity, super-admin-billing, super-admin-website-leads, super-admin-hardware-packages.
- Customer/owner surfaces: customer, customer-booking, customer-registration, customer-salons,
  customer-payments, customer-display, owner, wallet, nail-showcase, end-of-day-followups.
- Platform: auth (+ password-reset, mfa, system-reset), realtime (SSE), push, health, system-health,
  tenant-warning-dispatch, go-check-in.
- **notifications** (ported): tenant→customer SMS/email send, log, opt-out/opt-in.
- **reminders** (ported): appointment-reminder config + scheduler job.

## API endpoint map — merged feature (full app surface in API_ENDPOINTS.md)
| Method | Path | Controller | Auth |
|---|---|---|---|
| POST | `/pos/notifications/send` | NotificationsController | TenantAuthGuard |
| GET  | `/pos/notifications` | NotificationsController | TenantAuthGuard |
| POST | `/pos/notifications/opt-out` | NotificationsController | TenantAuthGuard |
| POST | `/pos/notifications/opt-in` | NotificationsController | TenantAuthGuard |
| GET  | `/pos/notifications/opt-outs` | NotificationsController | TenantAuthGuard |
| GET  | `/pos/reminders` | PosRemindersController | TenantAuthGuard |
| PATCH| `/pos/reminders` | PosRemindersController | TenantAuthGuard |
| POST | `/jobs/appointment-reminders` | ReminderJobController | shared `JOBS_SECRET` header (middleware-excluded) |

## Database model map — merged tables (migrations 101–103)
- `notifications` (id, tenant_id, channel, to_address, subject, body, customer_id, status, provider_id,
  failure_reason, created_at) — send log; idx `(tenant_id, created_at DESC)`.
- `notification_opt_outs` (PK `tenant_id, channel, address`; reason, opted_out_at) — compliance store.
- `reminder_settings` (PK `tenant_id`; enabled, lead_minutes, window_minutes, channel, updated_at) — per-tenant config.
- `appointment_reminders_sent` (PK `tenant_id, appointment_id`; reminded_at) — idempotency log.
- Credit metering reuses existing `tenant_usage_limits` (PK `tenant_id, metric`; metrics `sms_credits`,
  `email_credits`) via `notifications.credit-meter.ts`.

## Super-Admin module map
`super-admin-platform` is the unified controller; sidebar surfaces (admin-web) map to: Tenants, Applications,
Website Leads, Hardware Packages, Payment Gateways, Subscriptions/Billing, AI Packages, Usage Limits, Users &
Roles, Support Access, Platform Reports, System Health, Audit Logs, Settings.

## POS module map
Reception POS screens (pos-web) → matching API: check-in→`/check-in`, booking→`/booking`,
tech-queue→`/tech-queue`, queue→`/queue`, serving→`/serving`, service-done→`/service-done`,
checkout→`/checkout`, customers→`/customers`, **messages→`/pos/notifications` + `/pos/reminders`**,
follow-ups→`/pos/follow-ups`, reports→`/reports`, settings→`/pos/settings`.

## AI package module map
`ai` (gateway/tools) · `tenant-ai` (tenant config + POS panel) · `super-admin-ai` (platform admin) ·
`ai-subscription-billing` (overage/billing sync). Admin screens: AIPackages, AiSubscriptions, UsageLimits.
