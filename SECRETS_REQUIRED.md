# SECRETS_REQUIRED.md
### Every credential the platform needs, how it is injected, and what exists today
**No secret values appear in this repository or this document.** The repo ships only `*.example` / `*.template`
env files; the security CI + a real `git add` audit verify zero leaks (see PUSH_TO_GITHUB.md).

## Secrets audit result (fresh, Jul 30 2026)
Pattern scan across all apps, packages, and docs: **0 real credentials.** The only matches are deliberate test
fixtures asserting that masking/encryption WORK (e.g. crypto round-trip specs, masked `••••` display strings in a
sample repository) — each one is an assertion, not a key. Real `.env` files present: **0** (examples/templates only).

## What the developer must obtain from the OWNER (never from this package)
| Secret | Env var name(s) | Used by | Status |
| --- | --- | --- | --- |
| Production database URL | `DATABASE_URL` | API | BLOCKED — owner provisions hosting |
| Session signing secret | `AUTH_SESSION_SECRET` | API auth | Generate per environment |
| MFA encryption key | `MFA_ENC_KEY` (32 hex) | API auth | Generate per environment |
| App-data encryption key | `APP_DATA_ENCRYPTION_KEY` | field encryption | Generate per environment |
| Fiserv/CommerceHub sandbox + prod | `COMMERCEHUB_*` | payments | **BLOCKED — owner has not received creds** |
| Twilio account + messaging | `TWILIO_*` | SMS verification, A2P | BLOCKED — owner account |
| SendGrid | `SENDGRID_*` | email | BLOCKED — owner account |
| APNs key (.p8) + ids | `APNS_KEY_P8(_B64)`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC*`, `APNS_ENV` | iOS push | BLOCKED — owner Apple account |
| Firebase service account | `FCM_SERVICE_ACCOUNT_JSON(_B64)` | Android push | BLOCKED — owner Firebase project |
| OpenAI / AI providers | stored ENCRYPTED in DB via Super Admin AI config (not env) | AI features | Owner enters in Super Admin UI |

Full variable list: `.env.example` (158 documented names ≥ 128 referenced in code). Injection: local via shell/
`.env` (gitignored); production via the host's secret manager — never committed, never in the image.

## Ground rules (from DEVELOPER_HANDOFF.md, unchanged)
Owner-held accounts; developer gets limited roles; keys rotate on offboarding; a push to GitHub is NOT a deploy.
