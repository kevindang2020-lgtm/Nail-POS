# AUTH_AND_SECURITY.md
### Roles, permissions, sessions, MFA, tenant isolation, auditing — as implemented, with file pointers

## 1. Roles (7) and the permission catalog (332 keys)
`apps/api/src/auth/rbac.ts` is the single source of truth:
- `Role = 'SUPER_ADMIN' | 'OWNER' | 'MANAGER' | 'FRONT_DESK' | 'RECEPTION' | 'TECHNICIAN' | 'CUSTOMER'`
- `PERMISSIONS` — a flat catalog of **332 keys** (`pos.*`, domain keys like `checkout.process_payment`,
  and the `super_admin.*` families).
- `permissionsFor(role)` (line ~202) — a pure function mapping each role to its subset. SUPER_ADMIN checks are
  explicit (`role === 'SUPER_ADMIN'`), not wildcard string magic.
Change access by editing the catalog/mapping — never by sprinkling ad-hoc role strings in controllers.

## 2. How routes are protected (two legitimate styles)
- Declarative: `@RequirePermission('key')` on the handler — the dominant style; see API_INVENTORY.md, which
  lists the key per route.
- Imperative: `ctx.permissions.includes('key')` inside services/controllers where the check depends on data.
Both are real enforcement. The `check:perms` gate verifies every decorator key exists in the catalog (the
dangerous direction — a typo'd key can never silently grant access). Mount-level guards add
SuperAdminGuard on `super-admin/*`.

## 3. Sessions — HMAC-signed cookie, verifier that reports, never throws
`apps/api/src/auth/auth-session-token.ts`: payload (userId, tenantId, branchId, role, permissions,
subscriptionStatus, iat/exp) → base64url + HMAC-SHA256 signature with `AUTH_SESSION_SECRET`; timing-safe
compare. `verifySession` returns `{valid:false, reason}` for EVERY failure mode — bad signature, expiry,
tampering, and (Jul 29 hardening) even a validly-signed non-JSON payload returns `'malformed'` rather than
throwing. Session travels as an httpOnly cookie; the server derives ALL trusted context (tenant/branch/role/
permissions) from it — request bodies never carry identity.

## 4. Login portals and MFA
One login controller (`src/auth/auth.controller.ts @Post('login')`) serves the four portals (Super Admin,
tenant staff/POS, customer, technician) with role-appropriate responses — the end-to-end truth is executable:
`node apps/api/scripts/auth-matrix-e2e.mjs` runs 13 live checks across all portals against a running API.
- **Super Admin MFA**: login returns `200 + MFA_REQUIRED` and NO cookie until the TOTP challenge passes;
  factors live in `mfa_factors`, secrets encrypted with `MFA_ENC_KEY`. Local seed accepts any 6-digit code.
- **WebAuthn/passkeys**: `src/auth/webauthn*` — challenge issue/consume, origin + sign-count verification,
  tenant scoping. All failures speak the service's error vocabulary (`clientdata_malformed`, …) — attacker-
  controlled browser JSON cannot surface as a raw exception (Jul 29 hardening, pinned).
- Signed, expiring tokens also protect public flows (booking links: `ai-booking-signed-context.ts` — same
  report-never-throw verifier contract).

## 5. Tenant isolation
Server-derived ctx (see §3) + row-level `tenant_id` predicates (DATABASE_ARCHITECTURE.md §1) + the
`check:tenant` gate with a reviewed-exceptions baseline. Cross-tenant reads exist ONLY in super-admin
aggregation services listed in that baseline.

## 6. Auditing
Sensitive actions write to `audit_logs` with before/after snapshots in `metadata_json` (e.g. every SMS package
edit, master-control flip, tenant mutation). Pattern: audit writes are best-effort (`.catch(() => {})`) — an
audit failure never breaks the user action, and the action's own success/failure is what's audited.

## 7. Security tooling that runs on every push
`.github/workflows/security.yml` → `npm run security:fast` (16 checks: secret scan, dependency audit, the 13
static gates' security-relevant subset, HTML-app checks). `security:full` adds the slow lanes. The repo ships a
verified `.gitignore` (proven by a real `git add` dry run — see PUSH_TO_GITHUB.md) and ZERO real `.env` files.
Full credential inventory: SECRETS_REQUIRED.md.

## 8. Known deliberate limits (stated, not hidden)
Production CORS/TLS/rate-limit tuning, live Twilio callback signature verification against real traffic, and
live processor behavior are OWNER-environment items — coded, not yet exercised against production endpoints.
They appear in the security lane as NOT VERIFIED rather than silently green.
