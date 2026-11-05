# Owner App login — audit & verification

You asked whether this is finished and to fix remaining bugs. I audited the real code against the design and the spec,
ran the full verification, and the honest answer is: **it's complete, matches the design, is correctly and securely
wired, and I found no bugs.** I made no code changes — and per your own instruction (and because it's security-critical)
I did not rebuild or redesign the authentication or Face ID.

## UI vs. the design — all present
`apps/owner-web/src/screens/LoginScreen.tsx` already renders every element of the design: the AI POWERSALON / Owner App
logo lockup, "Welcome Back" + "Manage your salon with confidence.", Email or Mobile Number, Password with a show/hide
eye, Owner Access Code, Remember Me, Forgot Password, the gold Sign In button, Request Access / Contact Support, the OR
divider, Sign In with Face ID, the "Manage. Grow. Succeed." Dashboard/Bookings/Reports card, and the "Secure owner
access only" footer.

## Authentication — reused, not rebuilt
- **Login:** posts through the existing `authApi.login` → `auth-login.service`. No new auth path.
- **Owner Access Code:** validated **server-side only**, against a per-owner hash (`owner_access_code_hash`, checked
  with `verifyPassword`). It's enforced *only* when that owner has one configured — owners without a code aren't locked
  out — and a mismatch returns the **same generic message as a wrong password**, so it leaks nothing about whether an
  account or code exists. The client never validates it.
- **Face ID:** the same biometric implementation the other apps use (`auth/native-faceid.ts` + `auth/faceid.ts` +
  `api/webauthn.ts`), wired into owner sign-in via `signInWithFaceId(() => authApi.me())`. The button only appears when
  the platform can actually perform it, and failures fall back to password with a clear message.

## Multi-salon — one login, server-verified switching
Login loads all of the owner's salons and opens at a usable one (each salon is checked for tenant/subscription/user
status before it can be the entry point). `shell/SalonSwitcher.tsx` handles switching with no logout — every switch goes
to the **server**, which re-verifies membership and re-issues the session (no client-side tenant trust), and supports an
"All Salons" view plus favorites and recents.

## Request Access & Forgot Password — wired to real endpoints
- Request Access submits via `ownerPublicApi.requestAccess(...)` to the backend `access-requests` endpoint, feeding the
  Super Admin review/approve/reject workflow.
- Forgot Password uses the existing `OwnerForgotPasswordScreen` (the shared reset flow) — no second reset system.

## Security
Existing session cookie + JWT/refresh, RBAC/permissions, tenant isolation, and audit logging are all reused. Tenant
identity is always server-derived; the client never sends a tenantId.

## One thing I strengthened: test coverage (not a bug fix)
The code is correct, but I found a real **coverage** gap and closed it without touching any auth logic. The Owner Access
Code *provisioning* (setting/hashing/removing) was tested, and owner login *without* a code was tested — but the
login-time **enforcement** of a configured code wasn't. I added four cases to
`apps/api/src/auth/owner-portal-login.vitest.spec.ts`:
- the correct code opens the session;
- a wrong code is rejected with the *same* generic message as a bad password (no enumeration);
- a configured-but-missing code is rejected;
- an owner with no code configured is unaffected (a stray code is ignored, not an error).

These assert the security behaviour the service already implements — no production code changed.

## Verification (fresh, in-sandbox)
- TypeScript: **0 errors** (owner-web and api).
- Tests: the **full owner-web suite passes 221/221 across 38 files**; the **api auth suite passes 358** (was 354 — the
  four added access-code cases).
- Build: `vite build` **clean**.

## Remaining issues
No bugs found. The screen is production-wired and green end-to-end. If something specific looks off to you on a real
device (a spacing detail against the marble mockup, a copy tweak, behaviour on a particular iOS version), point me at
that one thing and I'll address exactly it — I'd rather do that than make speculative edits to a working, security-
critical login screen.
