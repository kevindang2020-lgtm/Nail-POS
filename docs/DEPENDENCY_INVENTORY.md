# DEPENDENCY_INVENTORY.md — external services and packages of operational weight

Constitution 4 §192 (BUILD_PLAN Phase 11). Written October 8, 2026 from the tree: every row names the file that calls the
dependency. Env vars are **names only** (values live in Railway variables; `apps/api/src/common/secrets-inventory.ts`
classifies the secret ones). "Timeout" and "breaker" are what the CODE enforces, not what the provider promises.

Shared mechanics:
- **`instrumentedFetch(provider, fetch)`** — `packages/observability/src/provider-telemetry.ts`. Bounds every call with
  `PROVIDER_TIMEOUT_MS` (cardpointe / clover / fiserv 60 s, twilio 15 s, email 15 s, fcm 10 s, apns 10 s, anything else
  30 s), counts it, opens a per-host circuit after **5 consecutive provider failures for 30 s**
  (`circuit-breaker.ts`, `DEFAULT_BREAKER_POLICY`), and sends a W3C `traceparent`. The card terminal path passes
  `breaker: false` (a call that waits on the customer says nothing about the provider's health).
- **AI gateway** — `modules/ai/src/ai/ai-platform.ts` + `ai-provider-health.ts`: per-task timeout from
  `ai-task-registry.ts` (20–30 s), its own provider circuit breakers, one transient retry, failover to a compatible
  provider, tenant budgets.
- Provider health is on Super Admin → System Operations (`providerHealth()`); "Owner" is the platform owner for every
  row (one operator today).

## Platform services (host of record: Railway)

| Service | Purpose | Env vars (names) | Failure mode | Timeout | Breaker | Fallback / degradation | Code |
|---|---|---|---|---|---|---|---|
| **PostgreSQL 16** (Railway) | system of record: every tenant, ticket, payment, job, event | `DATABASE_URL`, `DATABASE_REPLICA_URL` (read replica, optional — the `DATABASE_READ` handle), `PG_POOL_MAX`, `PG_READ_POOL_MAX`, `PG_WORKER_POOL_MAX`, `PG_WORKER_DATABASE_URL`, `PG_CONNECT_TIMEOUT_MS`, `PG_IDLE_TIMEOUT_MS`, `PG_STATEMENT_TIMEOUT_MS`, `PG_IDLE_IN_TRANSACTION_TIMEOUT_MS`, `PG_WORKER_STATEMENT_TIMEOUT_MS`, `PG_WORKER_IDLE_IN_TRANSACTION_TIMEOUT_MS`, `PG_APPLICATION_NAME` | down → `/health/ready` 503, requests fail fast, process stays up (drill-db-failover); a killed connection is discarded (`keepPoolAlive`) | connect 10 s; statement 30 s (api) / 120 s (all) / 600 s (worker pool); idle-in-transaction 30/60/120 s (`ROLE_TIMEOUTS`, `packages/database/src/kysely.provider.ts`) | n/a | none by design (no stale money reads); `MAINTENANCE_BREAK_GLASS` works without it | `packages/database/src/kysely.provider.ts` |
| **Redis** (optional) | cache, rate limits, login throttle, realtime fan-out, presence | `REDIS_URL`, `CACHE_REDIS_URL`, `RATE_LIMIT_REDIS_URL`, `LOGIN_THROTTLE_REDIS_URL`, `REALTIME_REDIS_URL`, `CACHE_STORE`, `RATE_LIMIT_STORE`, `LOGIN_THROTTLE_STORE`, `REALTIME_BUS`, `REALTIME_CHANNEL` | down → cache and rate limiters fail open; **login throttle throws (500) and each command waits 2–6 s** (drill-redis-loss, `DISASTER_RECOVERY.md` §3.3) | connect 5 s; per command: none (2 reconnect retries) | no | in-memory throttle / pass-through cache when the `*_STORE` switch is unset; single-node realtime | `packages/cache/src/redis.ts`, `apps/api/src/common/cache.module.ts`, `tenant-rate-limit.ts`, `keyed-rate-limit.ts`, `modules/identity/src/auth/login-throttle-redis.ts`, `apps/api/src/realtime/realtime.module.ts` |
| **Object storage — media** (S3 or compatible) | technician avatars, portfolios, showcase, support attachments | `MEDIA_STORE`, `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION`, `AWS_REGION`, `MEDIA_S3_ENDPOINT`, `MEDIA_S3_FORCE_PATH_STYLE`, `MEDIA_S3_PREFIX`, `MEDIA_ENV`, `MEDIA_CDN_BASE_URL`, `MEDIA_ROOT`, `MEDIA_LIFECYCLE` | upload fails → the request errors; reads are direct URLs | AWS SDK defaults | no | `MEDIA_STORE` unset → container disk (**lost at every deploy**) | `packages/media/src/media-storage.ts`, `apps/api/src/media/media-lifecycle.ts` |
| **Object storage — evidence** (S3, private) | safety-community evidence blobs + malware-scan tags | `EVIDENCE_S3_BUCKET`, `EVIDENCE_S3_REGION`, `EVIDENCE_S3_ENDPOINT`, `EVIDENCE_S3_PREFIX`, `EVIDENCE_S3_FORCE_PATH_STYLE`, `EVIDENCE_SCAN_ENABLED`, `EVIDENCE_SCAN_TAG_KEY` | upload refused; scanner not connected → evidence stays unscanned | AWS SDK defaults; signed URL TTL ≤ 1 h | no | `EVIDENCE_SCAN_ENABLED=0` → not-connected scanner | `modules/safety/src/tenant-safety-community/evidence-blob-store.ts`, `evidence-scanner.ts` |
| **OTLP trace backend** (optional) | distributed traces | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER_ARG` | backend down → spans dropped from a bounded queue, counted; never fails a request | exporter-bound | n/a | traces off when the endpoint is unset | `packages/observability/src/tracing/exporter.ts` |
| **Prometheus scraper** (optional, pulls) | metrics | `METRICS_TOKEN` | none on the API side | — | — | System Operations reads the same registry in-process | `apps/api/src/health/metrics.controller.ts` |

## Payments

| Service | Purpose | Env vars (names) | Failure mode | Timeout | Breaker | Fallback | Code |
|---|---|---|---|---|---|---|---|
| **CardPointe / CardConnect (Fiserv)** | card authorization/capture, terminals (Bolt), inquiry | per tenant in `tenant_payment_config` (encrypted); platform: `CARDPOINTE_BASE_URL`, `CARDPOINTE_SITE`, `CARDPOINTE_MERCHID`, `CARDPOINTE_USERNAME`, `CARDPOINTE_PASSWORD`, `CARDPOINTE_CURRENCY`, `PAYMENTS_SANDBOX` | charge errors / no answer → attempt stays `processing`; the stranded sweep asks the processor (never charges/voids) | 60 s (terminal: longer, `breaker: false`) | yes (not on the terminal path) | cash; `needs_review` + owner alert for unknown outcomes; kill switch | `modules/payments/src/payments/payment-gateway.resolver.ts`, `processor.factory.ts`, `apps/api/src/customer-display/customer-display.module.ts`, `modules/checkout/src/checkout/payment-attempt-sweep.ts` |
| **Clover** | card processing for Clover salons | per tenant (encrypted) | as CardPointe | 60 s | yes | as CardPointe; kill switch | `modules/payments/src/payments/payment-gateway.resolver.ts` (CloverPaymentAdapter) |
| **Fiserv residuals / CommerceHub Tap-to-Pay** | residual reports; Tap-to-Pay (not live) | `FISERV_MERCHANT_ID`, `FISERV_SECRET`, `FISERV_RESIDUAL_URL`, `FISERV_RESIDUAL_AUTH`, `COMMERCEHUB_BASE_URL`, `COMMERCEHUB_TTP_*` (8 names) | CommerceHub call fails → Tap-to-Pay unavailable; residual import fails → retried next run | 60 s (CommerceHub, `instrumentedFetch('fiserv', …)`) | yes (CommerceHub) | none needed (reporting); Tap-to-Pay is not live | `modules/checkout/src/mobile-checkout/fiserv-commercehub-ttp.adapter.ts`; residual import `modules/payments/src/hardware-payment/hardware-payment.scheduler.ts` |

## Messaging and notifications

| Service | Purpose | Env vars (names) | Failure mode | Timeout | Breaker | Fallback | Code |
|---|---|---|---|---|---|---|---|
| **Twilio** (SMS, Verify, TrustHub/A2P, Voice Intelligence) | receipts, reminders, OTP, A2P registration, call transcripts | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TWILIO_STATUS_CALLBACK_URL`, `TWILIO_VERIFY_BASE_URL`, `TWILIO_A2P_POLICY_SID`, `TWILIO_PRIMARY_PROFILE_SID`, `TWILIO_SECONDARY_PROFILE_POLICY_SID`, `TWILIO_ISV_EMAIL`, `TWILIO_INTELLIGENCE_BASE_URL`, `TWILIO_AGENT_MEDIA_CHANNEL`; per tenant `tenant_messaging_credentials` | send fails → logged on the notification row; OTP unavailable | 15 s | yes | SMS kill switch; no provider configured → simulated delivery in dev; **Voice Intelligence adapter uses a bare fetch (no timeout)** | `packages/notifications`, `modules/communications/src/tenant-a2p/twilio-trusthub-client.ts`, `modules/ai/src/ai-voice-transcription/ai-voice-transcription-twilio.adapter.ts` |
| **SendGrid** (email) | receipts, alerts, invites | `SENDGRID_API_KEY`, `SENDGRID_FROM` | send fails → logged | 15 s | yes | alert notifier also SMSes `ONCALL_PHONE` | `packages/notifications` (`instrumentedFetch('email', …)`) |
| **APNs** | iOS push | `APNS_KEY_P8`, `APNS_KEY_P8_B64`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`, `APNS_TOPIC_{TECH,CUSTOMER,OWNER,MANAGER,POS}`, `APNS_ENV` | push lost (best effort) | 10 s (`req.setTimeout`) | recorded | in-app notifications remain | `modules/communications/src/push/push-providers.ts` |
| **FCM** | Android push | `FCM_SERVICE_ACCOUNT_JSON`, `FCM_SERVICE_ACCOUNT_B64`, `FCM_SERVER_KEY` | push lost (best effort) | 10 s | yes | in-app notifications | same file |

## AI and voice

| Service | Purpose | Env vars (names) | Failure mode | Timeout | Breaker | Fallback | Code |
|---|---|---|---|---|---|---|---|
| **OpenAI / Anthropic / Google Gemini** | AI tasks (booking assistant, insights, OCR assist, …) | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`; per tenant BYO keys (`AI_PROVIDER_KEK`) | task fails → feature degrades; POS keeps working | per task 20–30 s | yes (AI gateway) | failover to a compatible provider; AI kill switch | `modules/ai/src/ai/ai-providers.ts`, `ai-platform.ts` |
| **Retell AI** | voice receptionist | `RETELL_API_KEY`, `RETELL_API_BASE_URL`, `RETELL_DEFAULT_VOICE_ID`, `RETELL_WEBHOOK_SIGNING_KEY` | agent provisioning fails; calls fall to the salon line | **none (bare fetch)** | no | the salon's own phone | `modules/ai/src/voice-booking/retell-voice.adapter.ts` |

## Location, anti-abuse, publishing

| Service | Purpose | Env vars (names) | Failure mode | Timeout | Breaker | Fallback | Code |
|---|---|---|---|---|---|---|---|
| **Google Places** | nearby salon search | `GOOGLE_PLACES_API_KEY`, `ENABLE_GOOGLE_NEARBY_SALON_SEARCH` | returns [] | **none (injected fetch)** | no | partner results only; in-process cache | `modules/customers/src/customer-salons/google-places.provider.ts` |
| **Google Geocoding** | branch addresses | `GOOGLE_MAPS_SERVER_API_KEY`, `GOOGLE_MAPS_DEFAULT_COUNTRY` | returns no hits | **none** | no | manual address entry | `modules/tenants/src/tenant-locations/maps-geocoding.provider.ts` |
| **CAPTCHA** (Turnstile / hCaptcha) | booking-verification challenge | `CAPTCHA_PROVIDER`, `CAPTCHA_SITE_KEY`, `CAPTCHA_SECRET_KEY` | **fails closed** (a challenge that cannot be checked is not passed) | **none (bare fetch)** | no | only challenged requests are affected | `modules/booking/src/customer-booking/booking-verification-fraud.adapters.ts` |
| **Google Business Profile / X** | AI review-reply publishing | per tenant OAuth | publish fails → reply stays a draft | **none (bare fetch)** | no | owner posts by hand | `modules/ai/src/ai-review-reputation/ai-review-reputation-publish.ts` |

Gap (not in this phase's scope; listed so it is not forgotten): Retell, Google Places/Geocoding, CAPTCHA, Twilio Voice
Intelligence and the review publisher still call `fetch` without a timeout — a hung provider holds that request for
undici's default (~5 min). None is on the booking/checkout money path. Fix: route each through `instrumentedFetch`.

## Packages of operational weight (npm)

| Package | Why it matters | Where |
|---|---|---|
| `pg` / `pg-pool` | every database connection; pool `error` listener required (bug E1) | `packages/database` |
| `kysely` | query builder + migrations ledger readers | `packages/database` |
| `ioredis` | every Redis client (one constructor: `makeIoredis`) | `packages/cache/src/redis.ts` |
| `@nestjs/*` | HTTP server, DI, shutdown hooks (graceful drain) | `apps/api` |
| `@aws-sdk/client-s3` | media + evidence storage | `packages/media`, `modules/safety` |
| `pino` | structured logs with redaction | `packages/observability` |
| Node.js 22 (`node:22-slim`) | runtime; `fetch`/undici defaults | `Dockerfile` |

Owner of every row: the platform owner. Review this file when a provider is added (CI: a new `instrumentedFetch('<name>'`
without a row here is a review finding).
