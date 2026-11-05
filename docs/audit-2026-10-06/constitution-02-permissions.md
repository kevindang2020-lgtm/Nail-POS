# Constitution 2 — Permissions & Authorization (154 §) vs the tree (Oct 6 2026, 7301539f)

Verdict: **PARTIAL, about 55–60%** — §153: 16 done, 30 partial, 5 missing of 51. Many partials are platform-only or
cosmetic. The arc's own pieces are still absent (metadata registry + generator, tenant approvals engine, decision object,
explicit-deny overrides, `authorization_version`). The Oct 3 conformance note overstated two things: template scopes are
stored and displayed but **never read at runtime**, and "DIRECT_GRANT_ONLY" exists only in a document.

Gates run read-only today: `check-api-contract.mjs` → reachable ✓, 0 unclassified platform paths, **324 unkeyed staff
routes (baseline 324; was 363 on Oct 4)**; `permission-check.mjs` → 366 catalog keys, 284 used on routes, 215 unused, every
decorator key resolves; `unguarded-route-check.mjs` → 75 public routes, 0 unreviewed.

## Status by area
| Requirement | Status | Evidence |
|---|---|---|
| One typed catalog | PARTIAL | `packages/permissions/src/rbac.ts:9-145` 366 keys (170 `super_admin.*`, 196 tenant); no metadata (description, sensitivity, scopes, step-up), no generator/docs, no `permission_definitions` table |
| One naming convention | PARTIAL | routes use `pos.<domain>.<action>` keys NOT in the catalog, mapped by string pattern in `requiredCapability()` (`security-core.ts:64-90`); other prefixes `owner.*`, `tech.*`, `mobile_checkout.*`; side lists in `tech-permissions.ts`, `integration-permissions.ts`, `community-permissions.ts`, `event-ops-permissions.ts` |
| 10 tenant role templates | DONE (alt) | `role-templates.ts:35-56` over the 7 base roles; no BOOKKEEPER / CUSTOMER_SERVICE |
| Custom roles | DONE | 486 `staff_roles`; `modules/identity/src/staff-roles/staff-roles.ts`; `validateCustomRole` narrows the base role only |
| Several roles per user | MISSING | `staff_role_assignments` PK (tenant_id, user_id) |
| Platform roles separate | DONE (C7) | `platform-roles.ts` (11 roles), 460, `PlatformDomainGuard` default deny |
| TENANT / PLATFORM scope | DONE | tenantId from the signed session; client keys stripped (`tenant-context.middleware.ts:111-121`); RLS 458; triggers 450 |
| OWN scope | DONE | technician surfaces from `ctx.userId` |
| ASSIGNED scope | PARTIAL | per domain; no shared building block |
| BRANCH / SELECTED_BRANCHES | PARTIAL | `user_branch_access` (068) drives the Owner App; **template scope never read at runtime** → Branch Manager == General Manager; staff with no grants can switch to any branch (`branch-access.ts:47-55`, enforced by a test); only Super Admin writes `user_branch_access` |
| Scope vs actual resource | PARTIAL | `okSameBranch` 1 caller |
| Policy conditions | PARTIAL | hand-written per service (e.g. `refund-approval.ts`); no handler layer |
| Decision object / reason codes | MISSING | boolean `hasPermission`; `ForbiddenException('Missing permission: …')` + `PERMISSION_DENIED` |
| Default deny | PARTIAL | platform done; tenant `RolePermissionGuard` passes any handler without a key (`role-permission.guard.ts:11`); 324 unkeyed routes (`apps/api/openapi/api-contract.unkeyed.baseline.txt`); 22 routes open to any signed-in realm (`apps/api/security/authz-baseline.json`) |
| Explicit DENY | PARTIAL | technician overrides `allowed:false` (`tech-permissions.ts:25-37`); Super Admin hard deny on tenant keys |
| Direct user grants / denies | MISSING | no `tenant_user_permission_overrides` |
| Temporary grants / expiry | PARTIAL | platform only (`privileged_access_grants` 268, `access_requests` 271, support sessions) |
| Grant ceiling / no self-escalation | PARTIAL | platform done; tenant: ceiling is the base role not what the actor holds; self-assignment possible (bug 1) |
| Last-owner protection | MISSING | — |
| Tenant approvals engine (thresholds, maker/checker, `approvals.*`, screen) | MISSING | refund "approval" = the manager doing it; thresholds platform-wide from env ($50 cash / $200 any, `refund-approval.ts:20-23`) |
| Platform maker/checker | DONE (C7) | `platform_approvals` (470) |
| Separation of duties | PARTIAL | `deals.service.ts:111-119` no requester ≠ approver |
| Resolve once per session | DONE | minted at sign-in (`auth-login.service.ts:563-583`) in the signed token |
| Versioning / cache invalidation | MISSING (requests) / PARTIAL (streams) | no `authorization_version`; refresh re-signs old claims (`auth.controller.ts:173-175`); stream `authzVersion` hashes role/branch/status/branch access only (`realtime/authz-revalidation.ts:48-52`) |
| Session revocation on critical change | PARTIAL | mechanism works; `setUserRole`, `disableUser`, `assignRole` never trigger it |
| Per-route declarations + coverage gate | DONE differently (C5) | 1,085 `@RequirePermission`, 284 keys; global guards `app.module.ts:149-163`; `check:api-contract` ratchet |
| Domain re-checks | PARTIAL | refunds, AI booking, copilot; **105 raw role-name comparisons across 25+ backend files** never classified (§148) |
| Customer plane | DONE | realm tokens, `CustomerAuthGuard`, `RealmGuard` |
| Machine plane | PARTIAL | API keys (498), OAuth (501) → INTEGRATION; AI_AGENT principal (`ai-tool-registry.ts:16,134`); no worker service principal |
| Support mode | DONE (C7) | 464/465 |
| Step-up for sensitive actions | PARTIAL | global `StepUpGuard`, 24 uses, all platform; none on tenant permission changes, merchant/Twilio settings, large refunds, exports |
| Entitlements separate | PARTIAL | `feature-registry.ts`, `AiEntitlementGuard`; no general plan guard / `PLAN_LIMIT_REACHED` |
| Field-level access | PARTIAL | platform `field-policy.ts` + interceptor; tenant only `customers.export` + inventory cost |
| Roles & Permissions screen | PARTIAL | `POSTeamPermissionsScreen.tsx`: assign template, custom role (raw checkboxes), read-only matrix; no branch access, temporary access, preview, per-user view, audit, descriptions |
| Permission-driven navigation | PARTIAL | Super Admin done (`navPermissions.ts`); POS `tenant-nav.tsx` gates by role lists; `tenant-access.ts:88` OWNER bypass |
| Tenant approvals screen; access review; high-risk report; dormant accounts | MISSING | `super-admin-platform.repository.ts:121` "needs an access-review process (honest gap)" |
| Audit of permission changes | PARTIAL | `staff-roles.controller.ts:29-34` old/new template only; no diff/reason/correlation; no `authorization_audit_events` |
| Tests | PARTIAL | present: template-subset, platform least-privilege, refund holders, cross-tenant, realm, step-up, stream revalidation; missing: per-role ALLOW/DENY matrix, self-assign / peer-widening escalation, last owner, temporary expiry |

## §153 Definition of Done
DONE (16): roles identified; tenant vs platform; customer plane; OWN; TENANT; PLATFORM; tenant access enforced; AI
authorization (C10 tool gate — latent bug 7); Support Mode; support audited; revocation mechanism; cross-tenant tests;
build/typecheck/lint (Oct 4); no known cross-tenant hole.
PARTIAL (30): inspected; registry; service principals; scopes; ASSIGNED; BRANCH; SELECTED_BRANCHES; explicit deny; default
deny; policy conditions; step-up; approvals; separation of duties; self-escalation; ceilings; field-level; branch access;
frontend/backend/mobile controls; realtime (templates not hashed); exports; entitlements; temporary grants; expiry; cache
safe; versioning; access audit; escalation tests; role-matrix tests.
MISSING (5): legacy role checks audited; last-owner; worker authorization; cache invalidation; no unsafe legacy role checks.

## Duplicates
Role models ×7 (`users.role`; templates/custom roles; `user_branch_access.role`/`access_level` which can REPLACE the session
role at branch selection, `branch-access.ts:73-87`; `technician_permissions` `pos.tech.*`; `users.platform_role`; access-request
`ROLE_RANK`; POS frontend RECEPTIONIST/ACCOUNTANT names that do not exist server-side). Permission lists ×5. ~12 separate
approval flows (platform_approvals, privileged grants, access requests, refund threshold, deals, purchase orders, technician
reports, OCR dual approval, revenue-residual ≥ $10k, worker transfers, skill changes, follow-ups, community advisories,
copilot learning, owner Approval Center). Two POS roster screens (`POSUsersRolesScreen`, `POSTeamPermissionsScreen`).

## Bugs
1. **Self-escalation (confirmed).** `assignRole` has no actor ≠ target check (`staff-roles.ts:76-91`); custom-role ceiling is
   the base role (`role-templates.ts:80-91`) → a narrowed manager with `technicians.edit` can give themselves GENERAL_MANAGER
   or create a full-manager custom role; any manager can re-widen another manager.
2. **Template scope cosmetic (confirmed)** — `FUNCTIONAL_DECISIONS_AUDIT.md:30` says "used at sign-in"; it is not.
3. **Permission changes don't reach live sessions (confirmed)** — refresh re-signs the old claims; changes apply only when
   the session ends (12 h, or 30 days with remember-me).
4. **Branch switching (confirmed, deliberate)** — staff without grants can move to any branch of the salon.
5. **Platform-plane leak (likely).** `super-admin-platform.service.ts:1139-1150` accepts SUPER_ADMIN for ANY user incl.
   salon staff, no step-up, no `platform_roles.manage`; no last-owner check.
6. **Owner shortcuts + dead keys (confirmed).** `role === 'OWNER'` bypasses in `compensation.controller.ts:20,28`,
   `cash-drawer.service.ts:15`, `owner.service.ts:40,45,68`, `tenant-access.ts:88`; five keys checked in services exist in no
   catalog (`compensation.manage`, `compensation.view_all`, `ai.control.manage`, `ai_inventory.view_cost`,
   `pos.pricing.override`); `booking.controller.ts:64` compares lowercase `'owner'`/`'manager'` (never matches).
7. **AI tool gate (latent).** exact `ctx.permissions.includes('pos.*')` (`ai-tool-registry.ts:151`) vs sessions holding the
   mapped catalog keys → would deny every staff member once a tool is enabled.
8. Stale docs: `PERMISSION_AUDIT.md` (230 routes / 291 keys), API DoD #57 (363 unkeyed).

## Build order
Kevin decides: staff confined to home branch + owner-managed branch access? one template per person or several roles?
default refund/approval thresholds per salon and who approves what? payment-device approval (code: tenant OWNER only,
`mobile-checkout.service.ts:112`) — confirm; MANAGER + `inventory.cost.view` (code grants it, `rbac.ts:194`) — confirm.
Code: (1) self-escalation fix (block self-assignment, ceiling = actor's own permissions, dedicated `roles.manage` key,
step-up); (2) authorization version per tenant/user bumped on any role/template/override/branch/status change, checked per
request (cached), re-derived on refresh, templates in the stream hash, auto-revoke on demotion/termination; (3) enforce
template scope at sign-in + branch selection, salon-side branch-access endpoints, FK/consistency + role CHECK on
`user_branch_access`; (4) metadata registry + generator, fold `pos.*` keys in, extend `check:perms` to service-level keys;
(5) decision object with reason codes, typed policy handlers, user-level overrides; (6) one tenant approvals engine (reuse
`platform_approvals`), move refund thresholds / deals / purchase orders onto it, approvals screen; (7) last-owner protection +
ownership transfer; stop `users/:id/role` setting SUPER_ADMIN on salon users; (8) work down 324 unkeyed routes + 105 role-name
checks, remove OWNER shortcuts; (9) tenant temporary grants, access review, high-risk report, dormant alert, worker service
principals, export snapshots, denial metrics, role-matrix + escalation tests.
