# SECURITY_THREAT_MODEL.md — Constitution 12 §4–6, §306–308

> **Status note, Oct 10 2026 (BUILD_PLAN Phase 15 doc sweep):** the "Gap / finding" column below is the Sep 22 picture. Most of those gaps are
> closed — `SECURITY_AUDIT.md` records each fix and the code confirms it: H1 dedicated encryption keys, production refuses
> fallbacks (`apps/api/src/common/key-ring.ts`, `secrets-inventory.ts` `requiredInProduction`); H2 security headers incl.
> CSP and frame protection (`apps/api/src/common/security-headers.middleware.ts`); H3 append-only audit tables (migration
> 452); H4 owner multi-salon MFA bypass; M3 per-user / per-key limits (`keyed-rate-limit.ts`; Phase 14 added a per-caller
> gift-card / coupon code-guessing limit); M4 one session policy; M6–M8 plaintext tokens hashed / sealed (migration 451);
> L3 container + IaC scanning (Trivy in `.github/workflows/build-image.yml`, Phase 11/14); the refund-abuse / fraud
> detector (§172–180, `SECURITY_AUDIT.md` Phase 17). Still partial: M5 — some handled events are not yet emitted as
> security events (`SECURITY_AUDIT.md` M5). Hosting-side controls (TLS edge, WAF, PITR, pen test, real devices) are rows in
> `docs/HOSTING_ACTIONS_FOR_KEVIN.md`.

Written against this tree on September 22, 2026. Controls named here exist in code; gaps are named as gaps.

## Trust boundaries (§6)
```
Internet ──▶ Railway edge (TLS termination, DDoS, proxy) ──▶ API instances (NestJS, one Docker image)
                                                                  │  ├─ PostgreSQL (Railway, private network, pooled)
                                                                  │  ├─ Redis (Railway, private network; optional)
                                                                  │  └─ Providers: Twilio, SendGrid, CardPointe/Fiserv/Clover, FCM/APNs, AI
Clients: POS web · Super Admin web · Owner · Tech · Customer · Manager Pay · Customer Display · Kiosk · booking pages
```
Identity boundaries that the code enforces: **Tenant user ≠ Platform user** (`SuperAdminGuard` vs `TenantAuthGuard`;
super admins are blocked from tenant-operational routes) · **Customer ≠ Employee** (`CustomerAuthGuard`; separate
identity table) · **Employee ≠ Owner** (`RolePermissionGuard` + `rbac.ts`) · **Owner ≠ Super Admin** (Support Mode with
reason and expiry, never a tenant token) · **Frontend ≠ backend trust** (tenant/branch/role come only from the signed
session; client keys stripped) · **AI ≠ business authority** (C10 tool registry: server-derived tenant, permission,
schema) · **Webhook ≠ trusted until verified** (all four controllers verify signatures; payment events deduplicated).

## Threat actors (§4) → what stops them today → what is missing
| Actor | Controls in code | Gap / finding |
|---|---|---|
| Unauthenticated attacker | Public routes allow-listed by reason (`check:public`); login throttle by identifier+IP; OTP fraud module; no stack traces (C11 filter) | No security headers (H2); no CSP |
| Malicious customer | Customer realm guard; booking holds with expiry; verification session-bound | Rate limits one-dimensional (M3) |
| Malicious / compromised employee | RBAC deny-by-default; tenant from session; C11 cross-tenant signal + escalation; audit logs | Audit not immutable (H3); no per-actor rate limit |
| Compromised owner | Same + step-up on merchant-account changes | Owner MFA bypass on multi-salon path (H4) |
| Compromised Super Admin | MFA required; Support Mode with reason/expiry; support session realtime scope | Same session TTL as everyone (M4); no security event on MFA reset |
| Compromised webhook sender | Signature verification (HMAC / Twilio); payment `event_id` dedup; tenant resolved from endpoint token, never body | Bank endpoint token + signing secret plaintext in DB (M6) |
| Lost technician phone | Sessions revocable; realtime disconnects on authz version | No app-device registry/revocation (§144–146 gap) |
| Compromised POS workstation / browser extension | httpOnly cookie (JS cannot read it); SameSite=lax; Origin-checked native token path | Clickjacking possible without frame headers (H2) |
| Credential-stuffing | Login throttle; scrypt cost; TOTP replay protection | — |
| SMS-pumping attacker | Booking-verification fraud policy (velocity, attempts, cooldown) | Not yet a scored signal in one engine (§172 gap) |
| Payment-fraud attacker | Processor tokenization; no PAN/CVV stored; declines not treated as outages | Refund abuse detection not built (§180) |
| API scraper | Tenant rate limit; customer search permission | No per-API-key/actor limit (M3) |
| Insider with DB read | Provider/payment/bank/MFA secrets encrypted; passwords/tokens hashed | Bank signing secret and export/kiosk tokens plaintext (M6–M8); key derived from session secret (H1) |
| Supply-chain / dependency | Lockfile; `npm audit` nightly; secret scan on push | No SBOM, no container/IaC scan (L3) |
| Prompt-injection / compromised AI provider | C10: content untrusted, tools authorised server-side, tenant scoped before the call, outputs schema-validated | Adversarial tests not yet in the suite (§293) |

## The eight critical flows (§307–308)
Each: assets · entry point · boundary crossed · controls · remaining risk.
1. **Customer booking** — customer identity, slots. Entry: public booking API. Crosses Internet→API. Controls: booking session, hold expiry, verification session-bound, tenant from slug lookup server-side. Risk: hold abuse limits are per-tenant policy only.
2. **Employee login** — credentials, session. Entry: `/auth/login`. Controls: scrypt, throttle, TOTP + replay protection, signed httpOnly cookie, Origin-gated native token. Risk: H4 (owner path), one TTL for all roles (M4).
3. **Checkout / payment** — money, processor references. Entry: POS `/pos/checkout/*/pay/*`. Controls: permission per route, idempotency (C8), processor tokenization, no card data stored, credentials decrypted only in the resolver. Risk: H1 key hierarchy; refund step-up only on merchant config, not on large refunds (§93 gap).
4. **Twilio OTP** — codes, phone numbers. Entry: verification send/check + Twilio webhook. Controls: single-use, attempt-limited, session-bound; webhook signature; OTP never logged (C11 redaction). Risk: SMS pumping not scored centrally.
5. **AI Receptionist** — call audio, transcript, booking authority. Entry: Twilio voice → AI gateway. Controls: signed context, tool registry (server tenant, permission), transcripts classified HIGHLY_SENSITIVE. Risk: §110 DTMF payment data — no payment-by-voice exists (good); recording retention configurable.
6. **AI OCR** — receipt images. Entry: upload → AI job. Controls: tenant-scoped job, entitlement gate, provider key encrypted. Risk: uploads not magic-byte validated (§159 gap), unscanned (L1).
7. **File upload** — photos, evidence. Entry: tech profile / showcase / evidence. Controls: evidence private + quarantined + scan-gated; media store public by design. Risk: media validation, no scanner vendor (L1, M2).
8. **Support Mode** — a salon's private data. Entry: Super Admin support session. Controls: reason, expiry, platform identity kept, realtime scope checked at subscribe, audit. Risk: §157 data minimisation (support sees full screens), §158 abuse detection not built.

## Mobile threat model (Constitution 6 §290 — BUILD_PLAN Phase 13 D)

The four store apps (customer, technician, owner, manager-pay) are Capacitor shells around the web builds. Each threat →
the mitigation in the tree → what is left (Kevin / native follow-up).

| Threat | Mitigation in the tree | Left |
|---|---|---|
| **Lost / stolen device** | Session in the Keychain / EncryptedSharedPreferences only (`mobile-sdk` native-auth, never localStorage); revoke a device under Security → Devices (ends its sessions, refresh tokens AND its Face ID credential — `auth-devices.ts`); owner + manager-pay lock after 5 / 3 idle minutes and on launch when Face ID is on (`AppLock`); Android `FLAG_SECURE` in owner + manager-pay | iOS native privacy overlay (a WebView cover is best effort before the switcher snapshot) |
| **Stolen session** | 15-minute access token + rotating refresh token, reuse burns the session (Constitution 3); Face ID is a separate device credential (migration 559): bound to the device id, 256-bit, hashed at rest, rotated on every use, a replayed spent secret revokes it, dies with sign-out / password change / device revoke / access change | — |
| **Malicious app / reverse engineering** | No provider secret in any bundle (`check-native-config.mjs` refuses keystores, `key.properties`, `.p8`, `google-services.json` in an app tree; only `VITE_*` public config is compiled in); every rule is server-side | **Three Android upload keystores + `key.properties` with their password are committed** (pre-existing) — Kevin rotates them (`docs/mobile/MOBILE_RELEASE_SETUP.md`); App Attest / Play Integrity (§41) not integrated |
| **MITM** | Release iOS builds have no ATS exception; Android release `network_security_config` permits no cleartext and trusts system CAs only; debug-only exceptions (`Info-Debug.plist` NSAllowsLocalNetworking; `src/debug` network config for 10.0.2.2 / localhost); the native build refuses a non-https API base (`initNative`) | Certificate pinning (optional — not adopted: rotation risk) |
| **Root / jailbreak** | Treated as a risk signal only (§42): server-side authority, Keychain-bound credentials, device revoke | No client detection shipped (optional per §42) |
| **Stale offline state** | Server-state cache scoped by realm / tenant / branch and wiped on sign-out / switch (Phase 13 C); payments never journaled | — |
| **Deep-link abuse** | One closed route list (`api-contracts` mobile-push / mobile-links): a link or tap only NAMES a destination (route name + id), opens only inside a signed-in tree that has that route (`createRouteGate`), the screen loads through the API which authorizes; no token ever travels in a link (§66); the not-installed fallback redirects only to an env-configured host | — |
| **Push spoofing / leakage** | Typed categories with per-app targeting (a tech push never reaches the same person's customer app); the push service drops name / phone / email / amount / token data keys at its choke point; every producer is inventoried and name-free (`push-producers.vitest.spec.ts`, bug 9); a tap re-authorizes; tokens handed back on sign-out and rotated (§63); a push token is never identity (§59) | APNs / FCM credentials are Kevin's (env only) |
| **Local data extraction** | `allowBackup="false"` + data-extraction rules (no cloud backup / device transfer); tokens + the Face ID credential only in secure storage; the biometric item is guarded by `BiometryCurrentSet`-class access control (plugin) | — |
| **API replay** | Idempotency-Key on the money / booking / approval mutations (Constitution 5 + Phase 13 C); the Face ID secret is single-use; refresh tokens single-use | — |
