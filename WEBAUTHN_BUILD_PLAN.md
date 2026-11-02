# Passkey / WebAuthn — Build Plan & Status

`WebAuthnService` (Face ID / Touch ID login) has complete, unit-tested domain logic (both ceremonies: challenge
issue/consume, clientData/origin/RP-ID checks, sign-count, attestation/assertion via a `verifier` port) but no
controller and no production adapters. This documents exactly what has been prepared and what remains — and why the
remaining core must be built with real-device testing rather than blind-authored.

## Done (safe, additive, verified — in the current build)

- **Dependency installed:** `@simplewebauthn/server@^13.3.2` (the standard WebAuthn verifier), in `apps/api/package.json`.
- **DB tables (migration `356_webauthn_passkeys.sql`):** `webauthn_credentials` (credential_id, user_id, tenant_id,
  public_key, sign_count, transports, device_label, timestamps) and `webauthn_challenges` (handle, challenge, user_id,
  tenant_id, purpose, expires_at). Additive and inert — nothing writes to them yet.
- **Kysely types:** `WebauthnCredentialsTable` / `WebauthnChallengesTable` added to `src/database/kysely.types.ts`.
- **Verified:** API build clean; `webauthn.service.vitest.spec.ts` 6/6; nothing else affected.

## Integration points (traced, so the remaining build is unambiguous)

- **Session issuance is reusable** — `WebAuthnService`'s `sessions.create(userId)` port is the *same* one the
  password-reset flow already backs (`password-reset.ports.kysely.ts:96`): revoke active sessions → insert `sessions` →
  `signSession(claims, { secret: AUTH_SESSION_SECRET, ttlSeconds })` → insert `refresh_tokens` → return
  `{ accessToken, refreshToken }`. Passkey login reuses this verbatim — no bespoke session path.
- **Session cookie** — the controller applies the returned `accessToken` via the existing `SESSION_COOKIE`
  (`aps_session`) using the same `sessionCookie(token, ttl, secure)` shape as `loginResponse` (`auth.http.ts:33`).
- **DTOs already exist** — `webauthn.dto.ts` defines Begin/Finish Registration + Authentication request bodies.
- **v13 verifier API** — `verifyRegistrationResponse(opts)` / `verifyAuthenticationResponse(opts)` (single options
  object each); `generateRegistrationOptions` / `generateAuthenticationOptions` available if preferred over the
  in-repo `webauthn-core` option builders.

## Remaining (the security-critical core — build with device testing)

1. **`webauthn.ports.kysely.ts`** — implement the 9 `Ports`:
   - `creds`, `challenges`: straightforward Kysely CRUD on the two new tables.
   - `sessions`: reuse the password-reset implementation verbatim.
   - `users.findById` / `findForAuthn`, `tenants.resolveId`: reuse existing user/tenant lookups.
   - `audit`: reuse the `audit_events` sink.
   - `clock`, `rng`, `config` (rpId/rpName/expectedOrigin from env): trivial.
   - **`verifier`**: bridge to `@simplewebauthn/server` v13 — map the port's base64url inputs to the library's
     expected `response` shape (base64url ↔ Uint8Array, COSE public key), pass `expectedRPID`/`expectedOrigin`/
     `expectedChallenge`, and translate the result. **This is the piece that must be validated against a real
     authenticator — its correctness cannot be verified without a live ceremony.**
2. **`webauthn.controller.ts`** — `POST /auth/webauthn/register/begin|finish`, `.../authenticate/begin|finish`;
   `finishAuthentication` applies the session cookie exactly like `loginResponse`.
3. **`webauthn.module.ts`** — wire service + adapters + controller. **Config-gated:** if `WEBAUTHN_RP_ID` /
   `WEBAUTHN_ORIGIN` are unset, endpoints return `503 not-configured` (feature inert by default).
4. **Register** `WebAuthnModule` in `app.module.ts` (behind the config gate) + exclude the 4 routes from the global
   tenant-context middleware (they're pre-session, like `/auth/login`).

## Mandatory verification before enabling (why this isn't shippable blind)

- **Real-device E2E:** register + authenticate a passkey from an actual iOS/Android/security-key authenticator against
  a deployed origin — this is the only way to validate the `verifier` bridge, COSE handling, origin/RP-ID, and
  sign-count. No emulator in a build container can produce a valid attestation/assertion.
- **Security review:** confirm no user-existence disclosure on `authenticate/begin`, correct tenant scoping of
  credentials, single-use challenges, and that a failed assertion never issues a session.
- Keep the config gate OFF in production until the above pass.

**Bottom line:** the foundation is in and de-risked; the remaining core is small and unambiguous, but it is
authentication for a payment system and its cryptographic bridge is untestable in this environment — so it should be
finished in a focused, device-tested, reviewed pass, not auto-generated.
