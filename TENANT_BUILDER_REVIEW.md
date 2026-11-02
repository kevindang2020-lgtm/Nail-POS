# Tenant query-builder baseline — review notes (check:tenant-builder)

151 Kysely builder statements on tenant tables still name no tenant_id (as of this review). The gate fails on any NEW one; this list may only shrink.
Each group below was reviewed; the reason is why the statement is not a cross-salon leak today. Postgres row-level security is still not in place and remains the real backstop.

Regenerate the location list: `node apps/api/scripts/tenant-builder-check.mjs --list`.

## Global technician profiles (technicians work across salons; keyed by global_tech_profile_id / own-profile checks) — 51

- `tech-profile/tech-profile.service.ts:106` technicians
- `tech-profile/tech-profile.service.ts:168` tech_salon_memberships
- `tech-profile/tech-profile.service.ts:220` reviews
- `tech-profile/tech-profile.service.ts:309` tech_portfolio_photos
- `tech-profile/tech-profile.service.ts:346` tech_salon_memberships
- `tech-profile/tech-profile.service.ts:466` reviews
- `tech-profile/tech-profile.service.ts:791` reviews
- `tech-profile/tech-profile.service.ts:845` tech_salon_memberships
- `tech-profile/tech-profile.service.ts:1132` tech_portfolio_photos
- `tech-profile/tech-profile.service.ts:1141` tech_portfolio_photos
- `tech-profile/tech-profile.service.ts:1170` nail_photo_consent
- `tech-profile/tech-profile.service.ts:1193` nail_photo_consent
- `tech-profile/tech-profile.service.ts:1264` before_after_sets
- `tech-profile/tech-profile.service.ts:1274` before_after_sets
- `tech-profile/tech-profile.service.ts:1289` tech_portfolio_photos
- `tech-profile/tech-profile.service.ts:186` reviews
- `tech-profile/tech-profile.service.ts:216` reviews
- `tech-profile/tech-profile.service.ts:248` reviews
- `tech-profile/tech-profile.service.ts:266` tech_portfolio_photos
- `tech-profile/tech-profile.service.ts:306` tech_portfolio_photos
- `tech-profile/tech-profile.service.ts:310` tech_portfolio_photos
- `tech-profile/tech-profile.service.ts:493` technician_services
- `tech-profile/tech-profile.service.ts:523` tech_portfolio_photos
- `tech-profile/tech-profile.service.ts:525` nail_photo_consent
- `tech-profile/tech-profile.service.ts:618` customers
- `tech-profile/tech-profile.service.ts:621` technicians
- `tech-profile/tech-profile.service.ts:624` pos_tech_appointments
- `tech-profile/tech-profile.service.ts:626` tickets
- `tech-profile/tech-profile.service.ts:632` tech_portfolio_photos
- `tech-profile/tech-profile.service.ts:634` nail_photo_consent
- `tech-profile/tech-profile.service.ts:637` reviews
- `tech-profile/tech-profile.service.ts:663` technician_services
- `tech-profile/tech-profile.service.ts:678` reviews
- `tech-profile/tech-profile.service.ts:683` before_after_sets
- `tech-profile/tech-profile.service.ts:689` nail_showcase_posts
- `tech-profile/tech-profile.service.ts:719` technicians
- `tech-profile/tech-profile.service.ts:841` tech_salon_memberships
- `tech-profile/tech-profile.service.ts:853` services
- `tech-profile/tech-profile.service.ts:955` ticket_service_lines
- `tech-profile/tech-profile.service.ts:1022` tech_portfolio_photos
- `tech-profile/tech-profile.service.ts:1068` tech_portfolio_photos
- `tech-profile/tech-profile.service.ts:1091` tech_portfolio_photos
- `tech-profile/tech-profile.service.ts:1106` tech_portfolio_photos
- `tech-profile/tech-profile.service.ts:1152` nail_photo_consent
- `tech-profile/tech-profile.service.ts:1168` nail_photo_consent
- `tech-profile/tech-profile.service.ts:1191` nail_photo_consent
- `tech-profile/tech-profile.service.ts:1213` before_after_sets
- `tech-profile/tech-profile.service.ts:1227` before_after_sets
- `tech-profile/tech-profile.service.ts:1242` before_after_sets
- `tech-profile/tech-profile.service.ts:1285` tech_portfolio_photos
- `tech/tech.kysely.repository.ts:138` tech_portfolio_photos

## Customer social layer (a customer spans salons; keyed by the customer's own ids) — 46

- `nail-showcase/nail-photo-consent.kysely.repository.ts:49` nail_photo_consent
- `nail-showcase/nail-showcase-social.kysely.repository.ts:43` customer_social_profiles
- `nail-showcase/nail-showcase-social.kysely.repository.ts:47` customer_social_profiles
- `nail-showcase/nail-showcase-social.kysely.repository.ts:50` customer_social_profiles
- `nail-showcase/nail-showcase-social.kysely.repository.ts:55` customer_social_profiles
- `nail-showcase/nail-showcase-social.kysely.repository.ts:101` customer_follows
- `nail-showcase/nail-showcase-social.kysely.repository.ts:108` customer_social_profiles
- `nail-showcase/nail-showcase-social.kysely.repository.ts:242` customer_social_profiles
- `nail-showcase/nail-showcase-social.kysely.repository.ts:276` customer_blocks
- `nail-showcase/nail-showcase.kysely.repository.ts:127` nail_showcase_posts
- `nail-showcase/nail-showcase.kysely.repository.ts:130` nail_showcase_posts
- `nail-showcase/nail-showcase.kysely.repository.ts:133` nail_showcase_posts
- `nail-showcase/nail-showcase.kysely.repository.ts:151` nail_showcase_posts
- `nail-showcase/nail-showcase.kysely.repository.ts:225` nail_showcase_posts
- `nail-showcase/nail-showcase.kysely.repository.ts:237` nail_showcase_posts
- `nail-showcase/nail-showcase.kysely.repository.ts:257` nail_showcase_reports
- `customer-salons/customer-salons.service.ts:75` reviews
- `customer-salons/customer-salons.service.ts:80` technicians
- `nail-showcase/nail-photo-consent.kysely.repository.ts:42` nail_photo_consent
- `nail-showcase/nail-showcase-social.kysely.repository.ts:22` customer_social_profiles
- `nail-showcase/nail-showcase-social.kysely.repository.ts:71` users
- `nail-showcase/nail-showcase-social.kysely.repository.ts:90` customer_follows
- `nail-showcase/nail-showcase-social.kysely.repository.ts:105` customer_follows
- `nail-showcase/nail-showcase-social.kysely.repository.ts:106` customer_follows
- `nail-showcase/nail-showcase-social.kysely.repository.ts:112` customer_follows
- `nail-showcase/nail-showcase-social.kysely.repository.ts:116` customer_follows
- `nail-showcase/nail-showcase-social.kysely.repository.ts:122` customer_follows
- `nail-showcase/nail-showcase-social.kysely.repository.ts:130` nail_showcase_posts
- `nail-showcase/nail-showcase-social.kysely.repository.ts:141` nail_showcase_posts
- `nail-showcase/nail-showcase-social.kysely.repository.ts:151` nail_showcase_posts
- `nail-showcase/nail-showcase-social.kysely.repository.ts:266` branches
- `nail-showcase/nail-showcase-social.kysely.repository.ts:280` customer_blocks
- `nail-showcase/nail-showcase-social.kysely.repository.ts:281` customer_blocks
- `nail-showcase/nail-showcase-social.kysely.repository.ts:285` customer_blocks
- `nail-showcase/nail-showcase-social.kysely.repository.ts:289` customer_blocks
- `nail-showcase/nail-showcase-social.kysely.repository.ts:290` customer_blocks
- `nail-showcase/nail-showcase.kysely.repository.ts:39` users
- `nail-showcase/nail-showcase.kysely.repository.ts:46` ticket_service_lines
- `nail-showcase/nail-showcase.kysely.repository.ts:54` nail_showcase_posts
- `nail-showcase/nail-showcase.kysely.repository.ts:70` nail_showcase_photos
- `nail-showcase/nail-showcase.kysely.repository.ts:83` nail_showcase_posts
- `nail-showcase/nail-showcase.kysely.repository.ts:89` nail_showcase_photos
- `nail-showcase/nail-showcase.kysely.repository.ts:95` nail_showcase_posts
- `nail-showcase/nail-showcase.kysely.repository.ts:178` technicians
- `nail-showcase/nail-showcase.kysely.repository.ts:179` services
- `nail-showcase/nail-showcase.kysely.repository.ts:251` nail_showcase_reports

## Auth: users, sessions, MFA, password-reset tokens (a person, not a salon) — 15

- `auth/account.controller.ts:29` users
- `auth/mfa.controller.ts:36` users
- `auth/password-reset.ports.kysely.ts:69` users
- `auth/password-reset.ports.kysely.ts:90` password_reset_tokens
- `auth/password-reset.ports.kysely.ts:93` password_reset_tokens
- `auth/password-reset.ports.kysely.ts:96` password_reset_tokens
- `auth/password-reset.ports.kysely.ts:102` password_reset_tokens
- `auth/password-reset.ports.kysely.ts:108` sessions
- `auth/system-reset.ports.kysely.ts:46` sessions
- `auth/system-reset.ports.kysely.ts:96` users
- `auth/system-reset.ports.kysely.ts:99` users
- `account/account.repository.ts:12` account_deletion_requests
- `auth/account.controller.ts:25` users
- `auth/mfa.controller.ts:24` users
- `auth/system-reset.ports.kysely.ts:92` users

## Event infrastructure (outbox, dead letters, consumer bookkeeping — platform tables) — 11

- `events/consumer-runner.ts:83` event_dead_letters
- `events/event-ops.service.ts:101` event_dead_letters
- `events/event-ops.service.ts:107` event_dead_letters
- `events/outbox-publisher.ts:59` outbox_events
- `events/outbox-publisher.ts:66` outbox_events
- `events/consumer-runner.ts:45` processed_events
- `events/consumer-runner.ts:62` event_dead_letters
- `events/event-ops.service.ts:90` processed_events
- `events/event-ops.service.ts:91` event_dead_letters
- `events/event-ops.service.ts:97` event_dead_letters
- `events/event-ops.service.ts:134` event_dead_letters

## Device-keyed kiosk / display / push (the device's own session or token is the key) — 17

- `customer-display/customer-display.repository.ts:111` customer_display_sessions
- `customer-display/customer-display.repository.ts:119` customer_display_sessions
- `customer-display/customer-display.repository.ts:134` customer_display_sessions
- `go-check-in/go-check-in.kysely.repository.ts:57` go_checkin_devices
- `go-check-in/go-check-in.kysely.repository.ts:66` go_checkin_sessions
- `go-check-in/go-check-in.kysely.repository.ts:71` go_checkin_sessions
- `push/push.kysely.repository.ts:17` device_push_tokens
- `customer-display/customer-display.repository.ts:69` customer_display_sessions
- `customer-display/customer-display.repository.ts:76` tickets
- `customer-display/customer-display.repository.ts:80` payments
- `customer-display/customer-display.repository.ts:147` customer_display_sessions
- `customer-display/terminal-capture.service.ts:83` customer_display_sessions
- `go-check-in/go-check-in.kysely.repository.ts:44` go_checkin_devices
- `go-check-in/go-check-in.kysely.repository.ts:45` go_checkin_devices
- `go-check-in/go-check-in.kysely.repository.ts:65` go_checkin_sessions
- `go-check-in/go-check-in.kysely.repository.ts:159` branches
- `push/push.kysely.repository.ts:20` device_push_tokens

## Caller-supplied scope (page(baseWhere, f): tenant lists pass a tenant_id predicate; platform lists are Super Admin) — 9

- `audit/audit.kysely.repository.ts:50` audit_events
- `audit/audit.kysely.repository.ts:53` audit_events
- `campaigns/campaigns.kysely.repository.ts:96` campaigns
- `campaigns/campaigns.kysely.repository.ts:98` campaigns
- `communications/communications.kysely.repository.ts:56` communication_threads
- `communications/communications.kysely.repository.ts:58` communication_threads
- `communications/communications.kysely.repository.ts:70` communication_messages
- `payroll/payroll.kysely.repository.ts:59` payroll_periods
- `payroll/payroll.kysely.repository.ts:61` payroll_periods

## Platform billing / gateway lookups (hardware payment plans, merchant-id and webhook-event lookups) — 8

- `hardware-payment/hardware-payment.kysely.repository.ts:29` hardware_revenue_split_settings
- `hardware-payment/hardware-payment.kysely.repository.ts:36` hardware_revenue_split_settings
- `hardware-payment/hardware-payment.kysely.repository.ts:89` hardware_payment_invoices
- `hardware-payment/hardware-payment.kysely.repository.ts:126` hardware_card_volume
- `hardware-payment/hardware-payment.kysely.repository.ts:82` hardware_payment_invoices
- `hardware-payment/hardware-payment.kysely.repository.ts:86` hardware_payment_invoices
- `payments/payment-gateway.resolver.ts:109` tenant_payment_config
- `payments/payment-webhook.service.ts:172` payment_gateway_events

## Reviewed individually — 4 remain, with reasons
- `end-of-day-followups/end-of-day-followups.kysely.repository.ts` purgeExpired — the retention sweep deletes soft-deleted
  tasks past the cutoff for EVERY salon; cross-tenant is the job (a background worker, no caller).
- `ai/ai-control-plane.service.ts` runningJobs / safetyEventCount — platform-wide counts for the AI control plane.
- `dashboard/dashboard.kysely.repository.ts` service-name subquery — correlated by whereRef to the outer, tenant-scoped
  ticket row; it cannot reach another salon's lines.
- (resolved in this pass: the review-reputation credential lookup, the claimed gift card read-back, the change-request
  read-back and two policy-version read-backs now filter by tenant; checkout's day totals were already scoped — the gate
  now follows a cast-wrapped builder's chain.)
