# CONTROL_PLANE_AUDIT — Constitution 7 (Super Admin / Control Plane), Phases 1–2

Constitution 7 (`AI_PowerSalon_Super_Admin__amp__Control_Plane_Architecture_Constitution_7.md`, 304 sections, 21-phase
build order §301, 28 prohibitions §302, 74-item Definition of Done §303, 53-part final report §304). Standing rule: audit
first, reuse and harden what exists, no `_v2` rebuilds.

**Base tree.** This is the repository that carries Constitutions 8–13 and the payment gateway (HEAD `a73a4b1` when this
audit was written). Constitutions 1–6 — including Authentication (the `PLATFORM_REALM` token audience and step-up this
constitution's §4 and §8 build on) and API (the `/api/v1` alias) — were built on the developer's tree and are **not in
this one**. Where this constitution depends on them, the gap is recorded below instead of assuming they exist.

All numbers below were measured in this tree on Sep 27 2026 (grep/parse of source and migrations).

---

## 1. What exists (Phase 1 — discovery)

### Platform API (backend)
| Measure | Value |
|---|---|
| Controllers mounted under `super-admin/*` | **110** (in 127 files; most in `modules/super-admin`, some in `modules/platform`, `apps/api/src/observability`, `apps/api/src/events`) |
| Routes under those controllers | **~1,007** |
| Routes that declare a permission (`@RequirePermission` / event / integration permission decorators) | **~140** (≈14%) |
| Routes with step-up re-authentication | **0** (the emergency lockdown confirms a typed phrase + re-auth inside its own service; nothing generic) |
| `/platform/*` or `/api/v1/platform/*` paths | **0** |
| Arbitrary-SQL / query-console endpoints | **0** — the 22 `sql.raw` sites in platform code interpolate allowlisted sort columns, interval constants and status lists, never request text |

### Platform authorization
- **One platform role: `SUPER_ADMIN`** (a value of `users.role`). `rbac.ts` grants it **every** `super_admin.*` key (142
  keys). That is §5's forbidden "`admin = true`" in practice — there is no PLATFORM_SUPPORT / FINANCE / SECURITY /
  OPERATIONS / AUDITOR / AI_ADMIN / BILLING_ADMIN / ONBOARDING / DEVELOPER_SUPPORT.
- `hasPermission()` lets `SUPER_ADMIN` pass only `super_admin.*` keys — so the **cross-plane** default deny holds (a Super
  Admin cannot use a tenant `pos.*` permission, and tenant roles never hold `super_admin.*`).
- `SuperAdminGuard` checks the role only. `RolePermissionGuard` returns **allow** for any handler without a key — so for
  the ~867 unkeyed platform routes, **within** the plane there is no default deny (§7): any platform identity reaches all
  of them. Harmless today (one role holds everything); decisive the moment a second platform role exists.
- `RealmGuard` (Constitution 12) separates planes by path: `/super-admin/*` → `SUPER_ADMIN` only; `/customer/*` →
  `CUSTOMER` only; staff paths never `CUSTOMER`; a crossing is recorded as `PRIVILEGE_ESCALATION_ATTEMPT`. **This is §4's
  boundary, enforced by role + path. There is no token audience (`aipowersalon-platform-admin`) in this tree** — that
  lives in the Authentication constitution on the other tree.
- The 001 schema already has `roles`, `permissions`, `role_permissions`, `user_roles`, `user_permissions` — unused for
  platform staff.
- **No platform-staff management**: Users & Roles (`UsersRolesScreen`) manages tenant users across salons. There is no
  way to create a second platform user with a narrower role, no grant ceiling (§25), no last-Super-Admin protection (§26).

### Tenancy, plans, features, usage (Phases 6–8) — mostly EXISTS
- Tenant lifecycle: `tenants.status` ∈ active / pending / suspended / cancelled; `SuperAdminTenantsService.changeStatus`
  (audited, realtime `tenant_status_updated`, Constitution 9).
- Plans / features / limits: `subscription_plans` (+versions), `plan_features`, `plan_limits`, `plan_add_ons`,
  `tenant_feature_flags`, `tenant_feature_overrides`, `tenant_plan_limit_overrides`, `tenant_usage_limits`,
  `usage_counters`, `subscription_changes`, grandfathering, overage, proration, scheduled changes, utilization —
  `modules/platform/src/super-admin-plans` (35 files).
- **Entitlements are enforced server-side**, not by UI toggle: `customers.service` (`assertCanCreate`, `assertCapacity`),
  `technicians.service`, `tenant-location.service` (`checkLimit('branches')`), `GET /tenant/entitlements`.
- AI plan/entitlement gating (Constitution 10), SMS packages + entitlement gate + usage ledger.

### Support (Phases 10–11) — PARTIAL
- Support Center: `support_tickets` (+messages, events, attachments).
- Support Mode: `support_access_sessions` (**reason NOT NULL, expires_at NOT NULL** — §76–77 already in the schema),
  `support_session_requests`, `support_session_events`, `super_admin_support_sessions`; admin-web `SupportAccessScreen`,
  `ActiveSupportSessions`; realtime scope + expiry termination (Constitution 9 §225).
- Not found: a Support Mode banner in the tenant apps (§75), tenant notification of support access (§84), read-vs-write
  split (§81), step-up on entry (§8).

### Operations, security, audit (Phases 12–14) — mostly EXISTS (Constitutions 8, 11, 12)
- System Status / Live Operations / incidents (`status_incidents`, events, impact, post-incident reports, scheduled
  maintenance), system operations, tenant health (list + detail, Constitution 11), job registry, event ops + dead
  letters + replay (Constitution 8), realtime health (Constitution 9).
- Security: security incidents, security audit runs/findings, emergency lockdown (`emergency_lockdowns`,
  `LockdownService` with typed confirmation), privilege-escalation events.
- Audit: `audit_logs` **append-only by trigger** (migration 452) — §103 holds; `audit_events`, settings audit.
- Legal holds, retention rules + purge runs, deletion requests, platform announcements (+targets).

### Frontend (Phase 19)
- Route inventory by path segment (90 segments, 1,006 routes, 138 keyed): `docs/control-plane-route-inventory.md`.
- admin-web: **148 screens**; sidebar = static `NAV_GROUPS` in `shell/AdminLayout.tsx` — **not permission-aware** (§10).
- One API client module family (`src/api/superAdmin*.ts`) — isolated from tenant clients (§184 holds).

---

## 2. Control plane boundary (Phase 2)

| Boundary rule | State in this tree |
|---|---|
| Super Admin is not a tenant owner (§3) | ✅ separate role; `hasPermission` refuses tenant keys to `SUPER_ADMIN` |
| Tenant tokens cannot reach platform routes (§4) | ✅ `RealmGuard` by role + path; ⚠️ no platform token audience (other tree) |
| Customer / public booking tokens cannot reach platform routes | ✅ `RealmGuard` (customer → 404 on staff paths; `/super-admin` → `SUPER_ADMIN` only) |
| Browser never reaches DB / Redis / cloud credentials (§2) | ✅ no such path found |
| No arbitrary SQL (§113, §302) | ✅ none found |
| Every platform endpoint declares a platform permission (§6) | ❌ ~140 of ~1,007 |
| Default deny inside the plane (§7) | ❌ unkeyed routes allow any platform identity |
| Platform roles (§5) | ❌ one role |
| Step-up for critical platform actions (§8) | ❌ none generic |

---

## 3. Gap map — the 21 phases (§301) onto this tree

| Phase | Status | Existing code to reuse | Gap |
|---|---|---|---|
| 1 Discovery | ✅ this document | — | — |
| 2 Boundary | ✅ mostly | RealmGuard, `hasPermission` | platform token audience (other tree) |
| 3 Platform authentication | ⚠️ | SA login + `super_admin_login_otp`, MFA factors, sessions | realm/audience claim; step-up stamp |
| 4 Platform permissions | ❌ | 142 `super_admin.*` keys, `rbac.ts`, 001 role tables | platform role matrix, default deny, grant ceiling, last-SA protection, permission-aware nav |
| 5 Platform API `/platform/*` | ❌ | ~1,007 `/super-admin/*` routes | alias, not a move (Decision D1) |
| 6 Tenant lifecycle | ⚠️ | `changeStatus`, statuses | explicit state machine (allowed transitions), closure workflow (§270) |
| 7 Plans & features | ✅ mostly | super-admin-plans, entitlements (enforced) | feature registry metadata/kill switch/rollout audit (to verify phase by phase) |
| 8 Usage metering | ✅ mostly | `usage_counters`, utilization snapshots, AI/SMS ledgers | aggregation cadence + alerts (to verify) |
| 9 Onboarding | ✅ | application intake → approvals (earlier arc) | verify against §27–28 |
| 10 Support Center | ✅ | support tickets | case status vocabulary (§73) |
| 11 Support Mode | ⚠️ | support_access_sessions (reason + expiry), realtime scope | step-up entry, banner, tenant notice, read/write split |
| 12 System operations | ✅ | Constitution 11 | — |
| 13 Security | ⚠️ | security incidents, lockdown | session/device views for platform users; step-up |
| 14 Audit | ✅ | append-only `audit_logs` (452) | platform-audit record fields (§102) — verify |
| 15 AI & automation | ✅ | Constitution 10 control plane | — |
| 16 Communications | ✅ mostly | SMS packages, Twilio oversight, announcements | verify §57–59 |
| 17 Payments oversight | ✅ mostly | merchant accounts, gateways, disputes, settlements, deposit reconciliation | — |
| 18 Analytics | ⚠️ | SA analytics, report builder | privacy-safe aggregation (§107 k-anonymity) — verify |
| 19 Frontend | ⚠️ | 148 screens, isolated client | permission-aware nav (§10) |
| 20 Realtime | ✅ | Constitution 9 platform stream | — |
| 21 Tests | ⚠️ | many suites | platform role-matrix + privilege-escalation tests (§275, §281) |

---

## 4. Decisions

- **D1 — `/platform/*` is an alias, not a move.** ~1,007 routes, seven frontends, the realm guard, the route-inventory
  gates and every test key on `/super-admin/*`. Moving them breaks all of it for no security gain; the constitution's
  goal (one platform API surface, separated from tenant APIs) already holds by path. `/platform/*` will be mounted as an
  alias of `/super-admin/*` (the approach the API constitution used for `/api/v1`).
- **D2 — Keep the `super_admin.*` key namespace.** The spec's `platform.*` names are examples; renaming 142 keys breaks
  every decorator and every live session. A documented mapping table relates each §6 example to its existing key; new
  keys use the existing namespace.
- **D3 — Platform roles are permission sets over the existing keys**, stored in the existing 001 tables (`roles` /
  `role_permissions` / `user_roles`) rather than a new role store. `SUPER_ADMIN` stays the platform-user marker and maps
  to PLATFORM_SUPER_ADMIN (all keys) — every existing platform account keeps exactly what it has (no lockout). Narrower
  roles resolve to subsets at login.
- **D4 — Default deny inside the plane by DERIVATION, then ratchet.** Rather than hand-annotating ~867 routes at once, a
  platform guard derives a domain key for any unkeyed `/super-admin/*` route (its controller's domain + read/manage by
  method) and denies an identity that lacks it; explicit keys always win. A ratchet test freezes the unkeyed count so it
  only shrinks. No behavior change for PLATFORM_SUPER_ADMIN.
- **D5 — Step-up is built here on this tree's primitives** (password + TOTP verification, a short-lived step-up stamp on
  the session row) and applied to §8's list. It does not wait for the other tree's Authentication constitution; when the
  trees merge, that implementation wins where the two overlap (merge rule: the developer's tree wins on overlap).

## 5. Build order for this tree
1. Platform role matrix + default deny by derivation + ratchet (Phase 4), with privilege-escalation tests (§25, §26, §281).
2. Step-up for critical platform actions (Phases 3/13, §8).
3. `/platform/*` alias (Phase 5).
4. Tenant lifecycle state machine + closure workflow (Phase 6).
5. Support Mode hardening: step-up entry, banner, tenant notice, read/write split (Phase 11).
6. Permission-aware Super Admin navigation (Phase 19, §10).
7. Verify-and-close passes for Phases 7–10 and 12–18 against their sections, then tests (Phase 21), the §303 DoD check
   and the §304 report.

---

## 6. Progress (updated Sep 27 2026)
| Unit | Commit | Status |
|---|---|---|
| Discovery + boundary + route inventory | `30615fa`, `59a269d` | done |
| Platform roles (11) + in-plane deny by default (PlatformDomainGuard, coverage ratchet) | `a22c7ce` | done |
| Platform staff roles: grant ceiling, no self-change, last Super Admin, sessions revoked, audit | `a1d7a45` | done |
| Step-up for critical actions (§8) + prompt-and-retry in the Super Admin app | `0a1a22d` | done |
| `/api/v1/platform/*` alias (§5) | `fea8939` | done |
| Permission-aware sidebar (§10) | `d1813ee` | done |
| Suspension reason code + reason; bulk status step-up (§18/§20/§21) | `bdd53c3` | done |
| Tenant lifecycle state + transition table (§16) | `96a130d`, `3181621` | done (screen included) |
| Support Mode start fixed, scope classes, View POS reason + step-up (§74–§81) | `1bb6627` | done |
| SUPPORT MODE banner (§75) | `9ce2387` | done |
| View POS → Support Mode inside Super Admin (D7) | `516bfa8` | done |

## 7. Tenant lifecycle (§16–§21) — measured starting point and plan
**Today:** `tenants.status` ∈ pending / active / suspended / cancelled with an explicit transition table
(`super-admin-tenants-core.ts` LEGAL_TRANSITIONS: pending→active|cancelled, active→suspended|cancelled,
suspended→active|cancelled, cancelled terminal); every change is audited and pushes `tenant_status_updated`; suspend /
reactivate now need step-up (`0a1a22d`). A reason is optional for a single change (bulk requires one).

**Gaps against §16–§21:** the richer lifecycle (DRAFT, ONBOARDING, PENDING_APPROVAL, PAST_DUE, RESTRICTED, CLOSED,
ARCHIVED); a suspension REASON CODE (BILLING / SECURITY / TERMS / FRAUD / TENANT_REQUEST / PLATFORM_OPERATION / OTHER)
and a mandatory reason; a per-cause suspension POLICY (employee login, customer booking, settlements, scheduled
communications, owner billing access, data export); reactivation policy validation (integrations disabled for security
stay disabled); CLOSED → retention → ARCHIVED instead of a terminal "cancelled".

**Decision D6 — lifecycle state beside the access status, one writer.** `tenants.status` is read as the ACCESS gate by
the session middleware, realtime authorization revalidation, RLS and many services; changing its vocabulary would touch
all of them at once. A `lifecycle_state` column carries §16's vocabulary; each lifecycle state maps to exactly one access
status (ACTIVE / PAST_DUE → active; RESTRICTED / SUSPENDED → suspended; DRAFT / ONBOARDING / PENDING_APPROVAL → pending;
CLOSED / ARCHIVED → cancelled), and only the lifecycle service writes either column, in one transaction.

**Build order:** (1) reason code + mandatory reason on suspension, recorded and audited; (2) lifecycle_state + transition
table + the single writer; (3) suspension policy per cause, enforced where each capability is checked; (4) reactivation
validation; (5) closure → retention → archive.

## 8. Decision D7 — Support Mode happens inside Super Admin (§74, §80)
**Finding:** the Tenants screen's "View POS" created a support session and opened `/tenant/<id>/pos?supportSession=…`;
no app routes that path, so the admin landed nowhere while a session and audit row were created.
**Decision:** the button is now "Support Mode": reason (10+ characters) → step-up → a time-limited READ_ONLY session →
the shell's SUPPORT MODE banner (tenant, reason, scope, expiry, Exit), with tenant data reached through the existing
oversight screens. No link to a route that does not exist. A read-only POS view is NOT built: it needs a support realm
in the POS app that accepts `PLATFORM_SUPPORT + supportSessionId + tenantContext` (§80) and never an owner token — a
separate, security-reviewed unit if it is wanted.

**Still open in the Support Mode arc:** tenant notification (§84), session extension with reason (§78), and merging the
three session stores (support_access_sessions, super_admin_support_sessions, membership_support_sessions).

## 8. Definition of Done (§303), measured — Sep 28 2026
`node apps/api/scripts/control-plane-dod-check.mjs` checks every §303 line against the tree:
**56 DONE · 12 PARTIAL · 5 NOT DONE of 73.** PARTIAL lines name what is missing; they are not counted as done.

Since §6: suspension reason codes (`bdd53c3`), the explicit lifecycle + screen (`96a130d`, `3181621`), Support Mode fixes
(`1bb6627`), the SUPPORT MODE banner (`9ce2387`), View POS → Support Mode (`68f658e`, D7), owner notices (`6034272`),
session extension (`2128882`).

NOT DONE: usage alerts (§41); cross-tenant analytics privacy (§107); permission-aware platform search (§106); load tests;
lint as a gate. PARTIAL: platform token audience (other tree); /platform is an alias (D1); suspension policy per cause,
reactivation validation, closure retention (§19–§21); platform-user invite/suspend/MFA/sessions (§24); a single feature
registry (§30); platform-wide kill switches (§35); merging the three support-session stores and field-level minimisation
(§82); a general approval workflow (§114); frontend split; a screen-by-screen secrets re-audit.

## 9. Decision D8 — the Super Admin frontend stays ONE app (§303 "Super Admin frontend modularized") — Oct 10 2026
**Finding:** `apps/admin-web` is one Vite app (167 screen components in `src/screens`, 65 typed API clients in `src/api`)
with permission-aware navigation (`src/shell/navPermissions.ts`: an item shows only when the platform role holds its key)
and route-level checks on the server (every `/super-admin/*` route keyed, default deny — D4). It is not split into packages.
**Decision:** keep one app. Splitting screens into workspace packages adds build and versioning cost and buys no security
(the server decides every request) and no isolation (one platform realm, one session). The constitution's goal — a
platform frontend separated from the tenant apps, showing each platform role only what it may use — holds. Revisit only
if a second team owns part of the plane or the bundle size becomes a measured problem (route-level `lazy()` splitting is
the first step then, not packages).
**Default taken:** one app. **Kevin:** no action unless you want it split.

## 10. §303 status after Phase 15 (Oct 10 2026)
`node apps/api/scripts/control-plane-dod-check.mjs`: **71 DONE · 2 DECIDED · 0 PARTIAL · 0 NOT DONE of 73.** The two
DECIDED lines are D1 (`/platform/*` is an alias of `/super-admin/*`) and D8 (one admin app); the script prints each with
its decision and checks the decision text is recorded here.
