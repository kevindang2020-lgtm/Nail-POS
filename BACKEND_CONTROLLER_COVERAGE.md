# Backend Controller Coverage & Orphan-Code Audit (authoritative)

Checked against the **running app's real route table** (routes enumerated from the live Express router), not static
guesswork.

## Controllers: are they all wired in?

- **212 distinct `@Controller` prefixes** in source (including controllers embedded in `.service.ts` / `.module.ts` /
  `.controllers.ts` files, not just `*.controller.ts`).
- **211 of 212 mount their routes in the running app.**
- **1 unregistered: `pos/ai-ocr-receipt`** — already handled (frontend entry removed; backend retained pending
  integration; see `POS_WEB_WIRING_AUDIT.md`).

## Modules: any built but never loaded?

- **180 module classes — all imported/referenced** into the graph (app.module.ts carries 225 Module references).
- **0 orphan modules.** No whole feature is sitting unloaded.

## Exported provider classes referenced only in their own file (7 of 640)

Not every class should have a controller — services, adapters, and ports are internal by design. Classified honestly:

| Class | Verdict |
|---|---|
| `AiReadinessService` | **False positive.** Wired via a co-located `AiReadinessController` in the same file; `/super-admin/ai/readiness` mounts and returns 200 live. Correctly exposed. |
| `InMemoryAppointmentAdapter` | **Not dead — test double.** Referenced by AI-queue-assignment spec files; production uses the Kysely adapter. Not a controller candidate. |
| `InMemoryQueueDataAdapter` | **Not dead — test double** (5 spec files). |
| `InMemoryQueueScanAdapter` | **Not dead — test double** (3 spec files). |
| `InMemoryWorkloadAdapter` | **Not dead — test double** (4 spec files). |
| `UnconfiguredMembershipChargeAdapter` | **Not dead.** Default fail-closed charger (`membership-billing.service.ts:46`). Internal by design. |
| `WebAuthnService` | **Genuine built-but-unexposed feature.** Passkey/WebAuthn auth: service + `webauthn-core.ts` + `webauthn.dto.ts` exist and are unit-tested, admin-web `SecurityPolicyModal.tsx` expects it, but there is **no controller**, so it isn't reachable. See prerequisites below. |

### WebAuthn: why it can't be "just wired" (concrete prerequisites, all missing)

The service is well-built (both ceremonies: challenge issue/consume, clientData/origin/RP-ID checks, sign-count,
attestation/assertion via a `verifier` port). But exposing it in production needs infrastructure that does not exist:

1. **`@simplewebauthn/server` dependency** — not in `package.json` or `node_modules`. The service's `verifier` port is
   explicitly meant to be backed by it; the attestation/assertion cryptography cannot run without it. → adding a
   crypto dependency to the auth stack.
2. **DB tables** — no migrations for a credential store (`credential_id`, `public_key`, `sign_count`, `user_id`,
   `tenant_id`) or a challenge store. → new auth-data-model tables.
3. **Concrete port adapters** — only mock ports exist (in the spec). Need Kysely-backed credential + challenge stores
   and the `@simplewebauthn/server`-backed verifier adapter.
4. **Session establishment** — `finishAuthentication` must issue a session the same way password login does
   (`res.cookie(aps_session…)`), with correct tenant scoping and no user-existence disclosure.

This is a deliberate, security-critical **feature build** (add a dependency + create auth tables + adapters + module +
session wiring), not an audit-level "register the controller" fix. Stubbing it (in-memory challenges/credentials, fake
verifier) would produce a passkey login that is non-functional or insecure — so it is left flagged for a reviewed build.

## What I did NOT do, and why

- **I did not auto-generate controllers for the adapters.** They are internal DI implementations; exposing them over
  HTTP would create ungoverned endpoints. If any are truly unused, the correct action is deletion (a cleanup decision),
  not adding a controller.
- **I did not blind-build a controller for `WebAuthnService`.** WebAuthn is authentication-critical (registration and
  assertion ceremonies, challenge/attestation verification, RP-ID/origin checks, session + credential storage). A
  controller written without the intended auth-flow design would risk a real authentication vulnerability. This needs
  deliberate integration against the existing auth/session/MFA model — flagged for that, not force-wired.

## Bottom line

Every controller that exists is wired in except one known case, and every module loads. The only code "sitting without
a controller" that was *meant* to be reachable is `WebAuthnService` (a security feature that needs careful, deliberate
integration) and possibly a few unused internal adapters (cleanup, not controllers). Nothing else is orphaned.
