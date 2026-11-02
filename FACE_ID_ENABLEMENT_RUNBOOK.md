# Enabling Face ID safely — a runbook

Face ID (WebAuthn) is fully built and wired, but ships **off**. This is how to turn it on without risk. It's an
operations task, not a code change — nothing in the login or Face ID code needs to be touched.

## What the flag actually does

`FACE_ID_ENABLED` is a clean global switch, read at the API:

- **Off (default):** every `/auth/webauthn/*` route returns 404 — as if the feature doesn't exist. Nothing hints that a
  disabled feature is hiding behind them.
- **On (`FACE_ID_ENABLED=1` or `=true`):** the enrollment and sign-in ceremonies become available.

Turning it on does **not** enrol anyone or change how anyone signs in today. It only *opens the door* to Face ID for
users who then choose to set it up.

## Why it's off by default

It's a deliberate safeguard from the security hardening: the signature verifier is real and **fails closed** (a forged
or replayed signature is rejected, not accepted). Shipping the feature dark until it's explicitly wanted means an
environment can't accidentally expose a biometric surface before its origin config is confirmed.

## The one real prerequisite: trusted origins

WebAuthn ties every ceremony to an exact origin and relying-party ID. The system derives these from a **configured
allowlist of trusted web origins** — never from an arbitrary request origin (that's what stops a phishing site relaying
a ceremony). Before enabling, confirm the environment's real origin is on that allowlist, or set the explicit overrides:

- `WEBAUTHN_ORIGIN` — the exact origin users load (e.g. `https://pay.yourdomain.com`).
- `WEBAUTHN_RP_ID` — that origin's hostname (e.g. `pay.yourdomain.com`).

Get these wrong and ceremonies simply fail to verify — no security hole, but Face ID won't work. This is the single most
common cause of "it enrolled but won't sign me in."

## How users actually get Face ID (the enrolment model)

1. A user signs in **with their password first** (enrolment endpoints require an authenticated session).
2. From Account, they enrol Face ID on that device (`register/begin` → `register/finish`).
3. On later sign-ins, "Use Face ID" runs the authenticate ceremony.

Password sign-in is always present and always works. Face ID is an **addition**, never a replacement — so no one can be
locked out by it.

## Safe rollout

1. **Staging first.** Set `FACE_ID_ENABLED=1` and the origin config in a staging environment only.
2. **Smoke test the full loop** on a real device: password login → enrol Face ID → sign out → sign in with Face ID.
   Then confirm the failure paths behave: a wrong/absent credential falls back to the password message, not a lockout.
3. **Confirm the 404→available flip.** With the flag off, `/auth/webauthn/status` 404s; with it on, it responds. That's
   your proof the switch is doing what you expect.
4. **Enable in production** by setting the same env vars. No deploy of new code is required — it's configuration.
5. **Watch** the first days: enrolment counts, authenticate success/failure ratio, and any uptick in password-fallback
   messages (which usually points at an origin/RP-ID mismatch, not a real failure).

## Rollback (instant, safe)

Set `FACE_ID_ENABLED` back to off. Every WebAuthn route 404s again, the "Use Face ID" button's ceremony stops being
offered, and **password sign-in is entirely unaffected** — nobody is locked out. Already-enrolled credentials sit
dormant and light back up if you re-enable. There's no data to unwind.

## What you do *not* need to worry about

- It never replaces password auth, so the blast radius of enabling (or disabling) is small.
- The verifier fails closed, so a misconfiguration fails safe (Face ID won't work) rather than open (accepting bad
  signatures).
- Super Admin (admin-web) intentionally has no Face ID — it stays on password + MFA, operator-recovered. Enabling this
  flag doesn't change that.

## Scope note

This runbook is guidance only. The login and Face ID implementation is a protected area and was not modified — enabling
the feature is done entirely through environment configuration in your own deployment.

## Phase 13 D (Oct 2026): native Face ID is now a device credential

Native apps no longer enrol the 15-minute access token (audit bug 2). Enrolling (signed in, password used in the last
10 minutes) calls `POST /auth/biometric/enroll`; the server issues a 256-bit secret bound to the device id (migration 559,
hashed at rest) which the app stores in a Keychain / Keystore item the OS guards with biometrics (BIOMETRY_CURRENT_SET).
Face ID sign-in calls `POST /auth/biometric/login`: the server re-checks the account (exactly like a token refresh), the
device and the salon's passkey policy, opens a FRESH session and rotates the secret (a replayed old one revokes it). Sign-out,
a password change, a device revoke or an access change end it. The same `FACE_ID_ENABLED` switch governs both the native
path (`GET /auth/biometric/status`) and WebAuthn — enable it after the real-device check in docs/mobile/MOBILE_RELEASE_SETUP.md §4.
