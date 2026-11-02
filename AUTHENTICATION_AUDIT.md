# Authentication Architecture Constitution (3) — audit on THIS tree, Oct 3 2026

Kevin's decision (Oct 3): re-apply Constitutions 1–6 to this repository, Authentication first. The September bundles are
not available here, so this is a re-application FROM THE SPEC onto today's code (modules/, packages/, 493 migrations),
audit-first as the standing rule says: reuse and harden what exists, no `auth_v2`. The decisions made the first time
(Sep 11 2026) are carried forward where they still fit; each is marked.

## What exists on this tree and STAYS

| Area | Where | Verdict |
|---|---|---|
| Passwords (scrypt), TOTP with encrypted secrets, WebAuthn | `modules/identity/src/auth/{account-core,totp,webauthn-*}.ts` | keep |
| Session rows with real revocation; `authorization_version` on users; session store | `session-store.ts`, mig 001 `sessions`, 491 `sessions.locked_at` | keep — §125 / Decision 35 |
| One signed session token with `aud` platform/tenant/customer (added Oct 2: the platform audience cut-over) | `auth-session-token.ts` (`audienceFor`, `AUDIENCE_REQUIRED_FROM_EPOCH`) | keep; §1 realms build on it |
| Login throttle (Redis-backed) and honest OTP for Super Admin | `login-throttle-redis.ts`, `super-admin-login-otp*.ts` | keep |
| Password reset (user + system), MFA reset workflow with `mfa_recovery_tokens` (developer's, mig 469) | `password-reset*.ts`, `mfa-recovery.controller.ts` | keep; §66–67 recovery CODES are a different thing (below) |
| `RequireStepUp` decorator + guard (Constitution 7 §8) | `packages/permissions/src/guards/step-up.ts` | keep — §55–57 step-up SERVICE plugs into it |
| Server-side idle lock (Decision 35) | `sessions.locked_at`, 423 middleware | keep |
| Customer sign-in across salons (identity + per-salon fallback), default salon (Oct 3) | `auth-login.service.ts`, `users.customer_default_at` | keep |
| `refresh_tokens` table | mig 001 (rotated_from_token_id, family columns) | exists, **unused** (2 references, no issuer) — §2 refresh rotation lands on it |
| `device_sessions` table | mig 001 | exists; §21–24 trusted devices need their own trust states — audit before reuse |

## Problems (the gaps the constitution closes)

1. **One cookie for everyone.** `aps_session` carries Super Admin, staff, owner and customer sessions alike; a token has
   an `aud` but no `realm`/`iss`/`typ`, and the cookie name does not change by realm, so a customer-realm token and a
   platform-realm token sit in the same cookie slot of the same browser. (§1–§6)
2. **12-hour bearer access tokens, no refresh.** `DEFAULT_TTL = 12h` in `auth.http.ts`; `refresh_tokens` is never
   written. A stolen token is good for 12 hours; "sign out everywhere" cannot shorten it. (§7–§12, §170)
3. **No MFA recovery codes.** A lost authenticator is an admin reset (mig 469 workflow), not a self-service code. (§66–67)
4. **No trusted devices.** `device_sessions` records devices but nothing grants or lapses trust, and MFA friction never
   changes by device. (§21–24)
5. **Step-up has a decorator but no service.** `RequireStepUp` reads a session's MFA time; there is no "re-prove the
   password + TOTP for THIS session" flow, no `auth_strength`, no typed auth events. (§55–57, §88, §147)
6. **No service principals.** Workers and schedulers run with no identity; the two shared-secret routes
   (`jobs/appointment-reminders`, `internal/scheduled-reports/run-due`) use static headers. (§7, §74, §81–82, §160)
7. **No API keys for integrations**, no OAuth server, no booking-session token (the public booking flow identifies its
   session by a client-supplied id). (§71–73, §76–79)
8. **No risk layer** (new network / impossible travel / credential stuffing signals never change what login asks for),
   **no security notifications** ("new device signed in", "this wasn't me"). (§58–60, §89–90)
9. **Tenant auth policy is saved and never read** — the settings store's `security` category (`mfaForOwner`,
   `rememberTrustedDevices`, `passkeyEnabled`, `pinLogin`) has no enforcement. (§176)
10. **Debug lines in the auth path** — two removed Oct 3 (the identity record incl. password hash; the Super Admin repo
    name). None remain in `modules/identity/src/auth` as of this audit.

## §163 build order mapped onto this tree

| Step | Sections | On this tree | Plan (decision carried from Sep 11 marked ◆) |
|---|---|---|---|
| 1 | §1–6 realms | **DONE Oct 3** (`iss`/`typ`/`actorType` signed; verifier takes the route's realm; `aps_session`/`aps_platform`/`aps_customer`; `/auth/*` shared; logout clears all; live-proven) | Add `realm`/`iss`/`typ`/`actorType` claims; verifier refuses a wrong realm; ◆ one cookie per realm `aps_session` / `aps_platform` / `aps_customer` / `aps_booking` via `realmForPath`; logout clears all |
| 2 | §7–12, §170 refresh | **DONE Oct 3** (server; migration 494; the apps' single-flight refresh is Step 2b) | ◆ `refresh-session.ts` on the existing `refresh_tokens`: opaque hashed token per session, access TTL 15 min (`AUTH_ACCESS_TTL`), `POST /auth/refresh` rotates with compare-and-set, reuse burns the family; web refresh cookie `<realm>_refresh` path `/auth/refresh`; native gets it in the body; the access COOKIE lives the session's life while the TOKEN's exp stays short |
| 2b | frontends | **DONE Oct 3** (one wrapper in packages/api-client, installed in all six apps; native keeps the rotating pair in the Keychain; real-browser check passes, control without the wrapper fails) | ◆ `auth-refresh-fetch.ts` in every app: on a 401 refresh once (single-flight), retry once, never on auth routes; tenant-context middleware exempts `auth/refresh` |
| 3 | §66–67 recovery codes | **DONE Oct 3** (migration 495; generation re-proves a current TOTP in the request; live-proven) | ◆ new `mfa_recovery_codes` (hashed, single-use, generation retires the set); login's MFA check accepts a code once; routes on `mfa.controller.ts`; `team.mfa.reset` stays the admin path |
| 4 | §21–24 devices | **DONE Oct 3** (migration 496 auth_devices + sessions.auth_device_id / last_mfa_at; web `aps_device` cookie; live-proven) | ◆ `auth_devices` with six trust states, TRUSTED always has `trusted_until`; `GET /auth/devices`, trust (MFA-satisfied only), revoke (ends sessions + refresh); login binds the session to `x-device-id` / `aps_device`; `mayReduceFriction` behind `AUTH_TRUSTED_DEVICE_SKIPS_MFA` (ships OFF) |
| 5 | §55–57, §88, §147 step-up + events | **DONE Oct 3** (migration 497 auth_events + session strength; step-up open to every realm; live-proven) | ◆ `auth-step-up.ts`: `last_primary_auth_at/last_mfa_at/last_step_up_at/auth_strength` on sessions, `auth_events` table with credential scrub, `POST /auth/step-up` re-proves password + TOTP on the SAME session; wire into the existing `RequireStepUp` guard rather than a second decorator |
| 6 | §7, §74, §81–82, §160 service principals | **DONE Oct 3** (three principals, 5-min tokens on SERVICE_TOKEN_SECRET, all seven internal routes, legacy headers retire by unsetting; live-proven) | ◆ seven named principals with least-privilege scopes, tokens on the same signer (service realm, 5 min), `SERVICE_TOKEN_SECRET` mandatory in production; `ServiceAuthGuard` + `@RequireServiceScope`; the two shared-secret routes accept the legacy header only while set |
| 7 | §76–78 API keys | **DONE Oct 3** (existing tenant_api_keys now authenticate requests — read-only allow-list; 24 h rotation overlap; usage ledger; migration 498; live-proven) | ◆ `tenant_api_keys` rotation overlap + `tenant_api_key_uses` ledger; `X-API-Key` / `Bearer ak_…` read before the session path; role INTEGRATION, integration realm |
| 8 | §177 security screen | **DONE Oct 3** (Recovery Codes, Devices, Sign-in Activity cards; migration 499 trigger: any session revoke ends its refresh tokens; live-proven) | add Recovery Codes + Trusted Devices sections; revoking sessions also revokes their refresh tokens (§44) |
| 9 | §176 tenant policy | **DONE Oct 3** (enforced once saved; enrollment-only session instead of lock-out; POS Sign-in Policy card; live-proven) | ◆ `tenant-auth-policy.ts` feeds login's tenant-force hook (`mfaForOwner` forces MFA for OWNER/MANAGER); settings screen shows the five facts as enforced |
| 10 | §71–73 booking token, §89–90 notifications, §79 OAuth, §58–60 risk | **10a notifications DONE Oct 3** (new-device email + "This wasn't me", migration 500); **10b risk DONE Oct 3** (IP-wide credential-stuffing block; elevated = new device AND new network for an account with history → authenticator required if the user has one; RISK_ELEVATED logged). NOT built, Kevin's call: impossible travel (no geo-IP data) and an email-code challenge for accounts without an authenticator (changes every app's sign-in screen). **10c booking token DONE Oct 4** (the bookingSessionId handed out is a signed token bound to salon + customer, 2 h; raw/forged ids refused — no app change). **10d OAuth DONE Oct 4** (authorization code + PKCE S256, migration 501, register-oauth-client.mjs, POS consent page + Connected Apps; read-only like API keys). **Constitution 3 re-application COMPLETE.** | in that order; each its own commit with tests and mutations |

Hosting (§156–158, §174) and performance measurement (§171) remain Kevin's side, as before.

## Migration numbering

Migrations start at **494** on this tree (the first build used 478–483 on a different tree; those numbers are taken here
by Decisions 18/38/… ). Each step names its migration in its commit.

## Verification standard for every step

Tests at three levels (pure rule, service with the in-memory twin, real Postgres), mutation-checked; the identity suite
(381 today), the auth-matrix live login proof (`scripts/auth-matrix-e2e.mjs`), the 25 gates + 4 audits, and the API
battery before each commit. The session-sid coverage and auth-boundary tests are updated — never deleted — when a
route's authentication changes.

## Status — Oct 4 2026: every §163 step re-applied on this tree

Steps 1–10 are built, each with real-Postgres tests, mutation checks and a live run (commits 263e727 → this one;
migrations 494–501). Open decisions for Kevin, none blocking: (1) impossible-travel detection needs a geo-IP source;
(2) an email-code challenge for elevated sign-ins by accounts with no authenticator would change every app's sign-in
screen; (3) API keys and OAuth apps are READ-ONLY until an integration actor for writes is designed. Hosting (§156–158,
§174) and performance measurement (§171) remain on the deployment side.

