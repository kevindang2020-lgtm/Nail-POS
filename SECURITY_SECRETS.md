# SECURITY_SECRETS.md — Constitution 12 §43–49

**Generated from `apps/api/src/common/secrets-inventory.ts`** — which a test holds true against every environment variable the API
reads. Stored in Railway variables (never committed; a test pins that no `.env` file is tracked).

**Rotation:** for every high-entropy secret the platform fingerprints the value at boot (a truncated SHA-256, never the value) and
records `SECRET_ROTATED` with the date when it changes. Provider-issued credentials are not fingerprinted — a short hash of a guessable
value could be brute-forced offline — so their rotation is a calendar discipline: rotate in the provider console, then in Railway.

**To rotate an encryption key without losing data:** copy the old value into `<VARIABLE>_PREVIOUS`, set the new value, deploy,
re-save the affected credentials from their screens, then remove `_PREVIOUS`. **To rotate `AUTH_SESSION_SECRET`:** every user is signed out.

## Encryption keys (8)

| Variable | Protects | Rotate every | Rotation observed | Production |
|---|---|---|---|---|
| `MFA_ENC_KEY` | authenticator-app (TOTP) secrets | 365 days | yes (fingerprint) | **required — boot refused without it** |
| `PAYMENT_ENC_KEY` | payment-processor credentials | 365 days | yes (fingerprint) | **required — boot refused without it** |
| `PROVIDER_VAULT_KEK` | Twilio and email provider credentials | 365 days | yes (fingerprint) | **required — boot refused without it** |
| `FUNDING_VAULT_KEK` | merchant bank / funding details | 365 days | yes (fingerprint) | **required — boot refused without it** |
| `WEBHOOK_SIGNING_KEK` | outbound webhook secrets, bank-webhook signing secrets | 365 days | yes (fingerprint) | **required — boot refused without it** |
| `AI_PROVIDER_KEK` | AI provider API keys stored per platform | 365 days | yes (fingerprint) | **required — boot refused without it** |
| `TICKET_DELETION_ENC_KEY` | ticket-removal authorization codes | 365 days | yes (fingerprint) | **required — boot refused without it** |
| `APP_DATA_ENCRYPTION_KEY` | optional field-level encryption (returns null when unset) | 365 days | yes (fingerprint) | optional |

## Signing secrets (4)

| Variable | Protects | Rotate every | Rotation observed | Production |
|---|---|---|---|---|
| `AUTH_SESSION_SECRET` | every session cookie (rotating signs every user out) | 180 days | yes (fingerprint) | **required — boot refused without it** |
| `AI_BOOKING_LINK_SECRET` | signed AI-booking links / partner tokens | 180 days | yes (fingerprint) | optional |
| `EVIDENCE_SCAN_TAG_KEY` | HMAC tags proving an evidence file passed scanning | 365 days | yes (fingerprint) | optional |
| `RETELL_WEBHOOK_SIGNING_KEY` | verifying Retell voice webhooks (issued by Retell) — issued by the provider — rotate in their console, then here | 365 days | no | optional |

## Service-to-service shared secrets (7)

| Variable | Protects | Rotate every | Rotation observed | Production |
|---|---|---|---|---|
| `BACKUP_REPORT_TOKEN` | /internal/backups/report | 180 days | yes (fingerprint) | optional |
| `JOBS_SECRET` | scheduled job routes (appointment reminders, hardware payment) | 180 days | yes (fingerprint) | optional |
| `HARDWARE_PAYMENT_CRON_SECRET` | /internal/hardware-payment/run-monthly | 180 days | yes (fingerprint) | optional |
| `SCHEDULED_REPORTS_CRON_SECRET` | /internal/scheduled-reports/run-due | 180 days | yes (fingerprint) | optional |
| `MEMBERSHIP_BILLING_SECRET` | /internal/membership-billing/* | 180 days | yes (fingerprint) | optional |
| `TENANT_WARNING_DISPATCH_CRON_SECRET` | /internal/tenant-warnings/dispatch | 180 days | yes (fingerprint) | optional |
| `AI_BILLING_WEBHOOK_SECRET` | /internal/ai-billing/* (and the billing webhook HMAC) | 180 days | yes (fingerprint) | optional |

## Provider credentials (21)

| Variable | Protects | Rotate every | Rotation observed | Production |
|---|---|---|---|---|
| `TWILIO_AUTH_TOKEN` | the platform Twilio account (SMS, verification) | 180 days | no | optional |
| `TWILIO_ACCOUNT_SID` | identifies the platform Twilio account (not secret alone) | on compromise | no | optional |
| `TWILIO_PRIMARY_PROFILE_SID` | Twilio TrustHub primary profile id | on compromise | no | optional |
| `TWILIO_A2P_POLICY_SID` | Twilio A2P policy id | on compromise | no | optional |
| `TWILIO_SECONDARY_PROFILE_POLICY_SID` | Twilio secondary profile policy id | on compromise | no | optional |
| `SENDGRID_API_KEY` | platform email sending | 180 days | no | optional |
| `OPENAI_API_KEY` | AI provider (OpenAI) | 180 days | no | optional |
| `ANTHROPIC_API_KEY` | AI provider (Anthropic) | 180 days | no | optional |
| `GEMINI_API_KEY` | AI provider (Google Gemini) | 180 days | no | optional |
| `RETELL_API_KEY` | AI voice receptionist (Retell) | 180 days | no | optional |
| `CARDPOINTE_PASSWORD` | platform-level CardPointe API (tenants use their own, encrypted) | 180 days | no | optional |
| `FISERV_SECRET` | platform-level Fiserv API | 180 days | no | optional |
| `COMMERCEHUB_TTP_API_KEY` | Tap-to-Pay (CommerceHub) API key | 180 days | no | optional |
| `COMMERCEHUB_TTP_API_SECRET` | Tap-to-Pay (CommerceHub) API secret | 180 days | no | optional |
| `FCM_SERVER_KEY` | Android push notifications | 365 days | no | optional |
| `APNS_KEY_P8` | iOS push signing key | 365 days | no | optional |
| `APNS_KEY_P8_B64` | iOS push signing key (base64 form) | 365 days | no | optional |
| `APNS_KEY_ID` | identifies the iOS push key (not secret alone) | on compromise | no | optional |
| `CAPTCHA_SECRET_KEY` | server-side CAPTCHA verification on public booking | 365 days | no | optional |
| `GOOGLE_MAPS_SERVER_API_KEY` | server-side geocoding (restrict by IP in Google Cloud) | 365 days | no | optional |
| `GOOGLE_PLACES_API_KEY` | server-side places lookup (restrict by IP in Google Cloud) | 365 days | no | optional |

## Connection strings (6)

| Variable | Protects | Rotate every | Rotation observed | Production |
|---|---|---|---|---|
| `DATABASE_URL` | the production database (URL contains its password) | on compromise | no | **required — boot refused without it** |
| `REDIS_URL` | shared Redis (may contain a password) | on compromise | no | optional |
| `CACHE_REDIS_URL` | cache Redis, if separate | on compromise | no | optional |
| `RATE_LIMIT_REDIS_URL` | rate-limit Redis, if separate | on compromise | no | optional |
| `LOGIN_THROTTLE_REDIS_URL` | login-throttle Redis, if separate | on compromise | no | optional |
| `REALTIME_REDIS_URL` | realtime backbone Redis, if separate | on compromise | no | optional |

## Public by design — safe only when restricted at the provider

- `VITE_GOOGLE_MAPS_BROWSER_API_KEY` — maps in the customer and owner apps. **ships to every browser — MUST be HTTP-referrer-restricted to your domains in Google Cloud**
