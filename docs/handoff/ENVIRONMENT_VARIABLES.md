# ENVIRONMENT_VARIABLES.md

Documents expected environment variables. **No real secrets here** — placeholders only. The sanitized template lives at root `.env.example` (and a copy in `docs/handoff/.env.example`). Several `.env.*.example` variants exist (development/local/production).

> Security: every secret below is **server-only**. Never expose payment, AI, JWT, or webhook secrets in frontend code. Client-safe values are limited to public API origins and publishable identifiers.

## Runtime
| Variable | Service | Req? | Scope | Example | Notes |
|---|---|---|---|---|---|
| `NODE_ENV` | app | yes | server | `production` | |
| `PORT` | app | yes | server | `3000` | Match the service port |
| `REPO_DRIVER` | data | yes | server | `postgres` | `postgres` = live DB; unset → in-memory adapters (dev/tests only) |
| `PG_POOL_MAX` | data | opt | server | `10` | |
| `DATABASE_URL` | Postgres | yes | server | `postgres://USER:PASSWORD@HOST:5432/aps?sslmode=require` | Append `?sslmode=require` for RDS |

## Security / session
| Variable | Req? | Scope | Example | Notes |
|---|---|---|---|---|
| `AUTH_SESSION_SECRET` | yes | server | `change-me-to-a-long-random-string` | Signs `aps_session`; rotating invalidates sessions |
| `AUTH_SESSION_TTL` | opt | server | `86400` | Seconds |
| `ENCRYPTION_KEY` / secrets-at-rest key | yes (prod) | server | `base64:...` | Encrypts stored secrets; rotating invalidates encrypted data |

## Payments (Fiserv CardPointe/Bolt + Clover only)
| Variable | Req? | Scope | Example | Notes |
|---|---|---|---|---|
| `PAYMENTS_SANDBOX` | opt | server | `1` | Sandbox flag for dev |
| `CARDPOINTE_*` (merchant/site/API creds) | prod | server | `YOUR_CARDPOINTE_*` | Per-tenant MID configured in-app, not globally |
| `CLOVER_*` (app/secret/merchant) | prod | server | `YOUR_CLOVER_*` | |
| Payment webhook signing secret | prod | server | `whsec_PLACEHOLDER` | Validate + idempotent processing |

> Never store raw PAN/CVV. No Stripe/Square variables — those processors are removed.

## Communications
| Variable | Service | Scope | Example |
|---|---|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio | server | `ACxxx…` / `YOUR_TWILIO_AUTH_TOKEN` |
| `TWILIO_*` (messaging/voice/caller-id) | Twilio | server | per-tenant number mapping |
| `SENDGRID_API_KEY` | SendGrid | server | `SG.PLACEHOLDER` |
| `SENDGRID_FROM` | SendGrid sender (optional) | server | defaults to `nailsalons@aipowersalon.com` — verify that address as a sender in SendGrid |
| FCM credentials | FCM | server | service-account JSON path |

## AI Gateway
| Variable | Scope | Example | Notes |
|---|---|---|---|
| `OPENAI_API_KEY` | server | `sk-PLACEHOLDER` | Only via backend AI Gateway; never in frontend |
| AI plan/limit config | server | — | Enforced server-side per tenant |

## Frontend (client-safe only)
| Variable | Scope | Example | Notes |
|---|---|---|---|
| `VITE_API_ORIGIN` / API base URL | client-safe | `https://api.example.com` | Public origin only (see `CONFIG_API_ORIGIN.md`) |

Refer to root `.env.example`, `.env.development.example`, `.env.local.example`, `.env.production.example` for the full authoritative list.
