# MFA / TOTP — how it works and how to turn it on for production

Real authenticator-app MFA (RFC 6238 TOTP) is **fully implemented and verified** — enrollment, confirmation,
replay-guarded verification at login, and AES-256-GCM at-rest encryption of the secret.

## The endpoints (signed-in user)
- `POST /auth/mfa/enroll` → generates a secret, stores an *unconfirmed* factor, returns `{ secret, otpauthUri }` (show once; render the URI as a QR to scan).
- `POST /auth/mfa/confirm` `{ code }` → verifies the code against the pending secret; on success confirms the factor and sets `users.mfa_enabled`.
- `GET  /auth/mfa/status` → `{ enrolled, confirmed }`.

Once a user has a **confirmed** factor, the login flow requires a real TOTP code for them (with replay protection — a
code can't be reused within its time-step).

## Local vs production
For easy local testing, a user who is MFA-required but has **not** enrolled a real factor can sign in with any
well-formed 6-digit code (a convenience fallback — e.g. the seeded super-admin). **This fallback is disabled in
production:** set `MFA_REQUIRE_TOTP=1` (it is also off automatically whenever `NODE_ENV=production`). With it on, a bare
6-digit code is refused — the user must enroll a real authenticator.

Verified behavior with `MFA_REQUIRE_TOTP=1`: a code from the enrolled authenticator → **SUCCESS**; an arbitrary
`123456` → **rejected**.

## Production bootstrap (the chicken-and-egg)
A privileged user can't reach the in-app enrollment endpoint until they have a session, but can't get a session until
MFA is satisfied. Resolve it once per admin with the operator script, which enrolls a **confirmed** factor directly and
prints the secret + otpauth URI to scan:

```bash
DATABASE_URL=postgres://…  AUTH_SESSION_SECRET='<same value the API uses>' \
npx tsx apps/api/scripts/enroll-mfa.ts --email admin@company.com --super-admin
# tenant user:
npx tsx apps/api/scripts/enroll-mfa.ts --email owner@salon.com --salon LUXE
```

Run it with the **same** secret-encryption key as the API (`MFA_ENC_KEY`, or `AUTH_SESSION_SECRET` if `MFA_ENC_KEY`
is unset) or the stored secret can't be decrypted at login. After enrollment the user signs in with their authenticator
code. Thereafter, ordinary users self-enroll via the in-app endpoints after their first sign-in.

## Keys
- `MFA_ENC_KEY` (64-hex = 32 bytes) encrypts TOTP secrets at rest; if unset it's derived from `AUTH_SESSION_SECRET`.
  Set a stable `MFA_ENC_KEY` in production so secrets remain decryptable across restarts/instances.
