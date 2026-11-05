# CONTROL PLANE FINAL REPORT — Constitution 7 (Super Admin & Control Plane)

Built on the repository carrying Constitutions 8–13 (the developer's tree carries 1–6). 36 commits, `30615fa` → `8381b97`
(Sep 27–28 2026). Definition of Done, measured by `node apps/api/scripts/control-plane-dod-check.mjs`:
**69 DONE · 4 PARTIAL · 0 NOT DONE of 73.** Every PARTIAL line names what is missing (§53 below).

## 1. Existing Super Admin Discovery
`CONTROL_PLANE_AUDIT.md` + `docs/control-plane-route-inventory.md`: 110 super-admin controllers, ~1,006 routes, 90 path
segments; 138 routes declared a permission; one platform role (SUPER_ADMIN, all 142 keys); no step-up; no `/platform`;
148 admin screens with a static sidebar; plans/features/limits/usage already enforced server-side; audit_logs append-only.

## 2. Problems Found
Fixed in this work (each with a test that fails without the fix): one all-powerful platform role and ~870 routes with no
in-plane check; Support Access start always failing (password demanded in the body, never sent); the chosen access level
discarded; View POS entering a salon with a placeholder reason, no step-up, and a URL no app handled; bulk suspension
without step-up; customers able to book at suspended/closed salons; reminders and follow-ups still sent for suspended
salons; the AI platform kill switch unreachable (nothing supplied it); **skip-line card payments charged through a
server-wide processor instead of the salon's own gateway**; 25 parallel support extensions all succeeding (cap checked,
not enforced); a SUPER_ADMIN invitation carrying no platform role and sendable by a Platform Admin; the Salon Health list
returning every salon in one response; 9 lint errors with lint in no gate.

## 3. Final Control Plane Diagram
```
Super Admin app (admin-web) ── permission-aware sidebar · StepUpHost · SupportModeBanner · Kill Switches · Platform search
        │ HTTPS, httpOnly session (signed: role, platformRole, restriction)
        ▼
API ── RealmGuard (plane by role+path) ─ RolePermissionGuard (explicit keys) ─ PlatformDomainGuard (derived keys, default deny)
     ─ StepUpGuard (critical actions) ─ SuspendedAccessGuard (billing-only sessions)
     /super-admin/*  ≡  /api/v1/platform/*  (alias)
        ▼
Domain modules (super-admin, platform, payments, deals, ai, communications, booking, identity) ── PostgreSQL
     platform_settings (kill switches) · audit_logs (append-only) · lifecycle trigger (status ↔ lifecycle_state)
```

## 4. Final Sidebar Architecture
`shell/navPermissions.ts`: each of 142 destinations → a control-plane domain VIEW key; `visibleNavGroups()` filters items,
children and empty groups by the signed session's permissions. Tests pin completeness and key existence on the server.

## 5. Platform Authentication
Platform sessions are SUPER_ADMIN sessions separated by RealmGuard (Constitution 12). The platform role rides as a SIGNED
claim; unknown/missing role → read-only. Step-up (§8): `POST /auth/step-up` re-proves password + single-use TOTP for the
same session. Not here: a platform token AUDIENCE (Authentication constitution, developer's tree).

## 6. Platform Role Matrix
`packages/permissions/src/platform-roles.ts`: 11 roles as predicates over 170 keys (142 existing + 28 domain keys);
PLATFORM_SUPER_ADMIN = everything; PLATFORM_ADMIN = all but platform_roles.manage + security.manage; AUDITOR read-only.

## 7. Platform API
Every platform route has an effective key (explicit or derived from 133 path keys); unclassified paths are refused; a
coverage test fails the build on an unclassified route. `/api/v1/platform/*` is an alias of `/super-admin/*` (D1).

## 8. Tenant Lifecycle
`lifecycle_state` (9 states) beside the access `status`, kept consistent by a trigger for every writer (migration 463);
transition table in `tenant-lifecycle-core.ts`; `POST /super-admin/tenants/:id/lifecycle` (step-up); Tenants panel.

## 9. Tenant Creation
Existing creation and onboarding/approval flows reused (unchanged); new tenants enter ONBOARDING by the trigger.

## 10. Suspension
Reason code (7) + written reason + step-up (single and bulk); per-cause policy table (`suspension-policy.ts`) shown on
the Tenants panel with honest enforcement state; enforced per cause: staff sign-in, customer booking, scheduled messages,
owner billing-only session (POS + Owner App) and the salon's own data exports; settlements are paid by the processor to
the salon's merchant account, so holding them (SECURITY / FRAUD) is processor-side. Reactivation of SECURITY/FRAUD needs the security permission; compromised
integrations stay disabled. Closure: 90-day retention, blocked by legal holds.

## 11. Plans — reused (super-admin-plans), unchanged.
## 12. Feature Entitlements — reused; enforced server-side (customers, technicians, branches, AI, SMS). Above them, ONE
feature registry (§30–§33, migration 471): stable keys, §31 metadata, a §33 status (AVAILABLE / BETA / DISABLED /
DEPRECATED / EMERGENCY_DISABLED), the kill switch that covers each feature, and the §32 resolver (registry → status →
kill switch → plan entitlement + tenant override) returning structured reasons. Feature Registry screen in the sidebar.
## 13. Feature Kill Switches
One centre (`/super-admin/kill-switches`, System Status panel): AI automatic actions, SMS emergency stop, booking
verification provider, Deals engine, CardPointe and Clover card payments — permission, step-up, reason, history, audit.
## 14. Plan Limits — reused; temporary overrides honour expires_at.
## 15. Usage Metering — reused (usage_counters / entitlement evaluation).
## 16. Usage Alerts
80/90/100 % once per tenant/metric/month (migration 466); owner alert + platform list; hourly gated sweep.
## 17. Onboarding — reused (application intake → approvals).
## 18. Support Center — reused (support tickets); searchable from the platform search.
## 19. Support Mode
Scope classes (READ_ONLY / STANDARD / ELEVATED — elevated needs tenant-edit), reason ≥ 10, 15–60 min, extension ≤ 2 ×
and ≤ 2 h total (enforced atomically), SUPPORT MODE banner with Exit/Extend, owner notified on start and extension.
ONE store (support_access_sessions) for all three entries — Support Access, Tenants screen, Memberships — and realtime
scoping reads it (legacy rows still honoured until they end).
## 20. Support Mode Security — step-up on entry and extension; audit on start/extend/end; no customer search outside it.
## 21. Live Operations — reused (Constitution 11). 
## 22. System Status — reused + Salon Health + Kill Switches panels.
## 23. Incident Management — reused (Constitution 11).
## 24. Payments Oversight — reused; plus per-integration kill switches and the skip-line gateway fix.
## 25. Communications Oversight — reused; reminders/follow-ups skip suspended salons.
## 26. AI & Automation — reused (Constitution 10); the platform auto-action kill switch made reachable.
## 27. Platform Settings — reused; kill switches write platform_settings with immutable history.
## 28. Security — step-up, default deny, platform staff (roles, invite with a named role, suspend, sessions, revoke, MFA reset
through a secure workflow: one-time hashed token + own password + live code; migration 469), grant ceiling, last-SA rule.
## 29. Audit — every new mutation writes audit_logs (append-only by trigger, migration 452).
## 30. Cross-Tenant Analytics — `privacySafeBenchmark` (aggregates only, cohort ≥ 5, viewer excluded); no tenant-facing
salon comparison exists today; unscoped tenant-facing queries refused by the tenant-isolation test.
## 31. Frontend Architecture — one admin-web app (148 screens); isolated API client; permission-aware navigation.
## 32. Pagination — Salon Health paged (100/page, cursor, totals); platform search capped per group; audit pages.
## 33. Realtime — reused (Constitution 9); lifecycle/status changes follow the §343 fallback rule.
## 34. Bulk Operations — bulk status needs step-up, reason code and reason; per-tenant results.
## 35. Platform Approvals — maker/checker (§119/§120/§182, migration 470): a registered action runs immediately while its
policy is off (default — a single operator is never locked out) and becomes a request when on; another platform user
holding the required permission approves with step-up and it executes once; self-approval refused in code and by a
CHECK; requests expire (24 h); every step audited; policy changes need platform_roles.manage + step-up + reason. First
action: plan-limit overrides. Approvals screen in the sidebar.
## 36. Data Masking — field-level minimisation (§82, §43): a global interceptor masks compensation, bank, customer
contact and private-note fields in Super Admin responses for any platform role lacking that class's permission
(`field-policy.ts`, exact keys only). PLATFORM_SUPER_ADMIN is untouched; screens used by narrower roles should be checked
for masked values when those roles are first handed out.
## 37. Integration Diagnostics — reused (Constitution 11/12). 
## 38. Job Operations — reused (Constitution 8/13).
## 38a. Secrets — `check:secrets` (gate 25): every read of the 28 secret-bearing tables (select * / selectAll / named
columns) is reviewed; all 59 are in-process uses (verify a hash, decrypt to call a provider, seal) with reasons; a probe
that selects a sealed credential fails the gate.
## 39. Security Tests — step-up, default deny, realm, prohibitions (role never from a body), CI security lane 22/0.
## 40. Privilege Escalation Tests — role matrix invariants, grant ceiling (roles and invitations), self-change, last SA.
## 41. Support Mode Tests — start rules, scope, banner, extension (incl. 25-way race), owner notices.
## 42. Tenant Isolation Tests — static tenant-isolation test (three reviewed allowlist entries added with reasons).
## 43. Feature Entitlement Tests — reused suites. 
## 44. Plan Limit Tests — reused suites.
## 45. Load Tests — `npm run test:load:control-plane` at §289 scale (10k tenants, 200k audit rows, 240k snapshots, 500
sessions): Salon Health page 377 ms, search 44 ms, audit page 57 ms, my sessions 15 ms, kill switches 17 ms.
## 46–47. Files Changed / Created — 86 modified, 82 added (`git diff --stat 30615fa^ 8381b97`); new sources include
platform-roles.ts, platform-domain.guard.ts, step-up.ts (both), suspended-access.guard.ts, platform-alias.ts,
suspension-policy.ts, tenant-lifecycle-core.ts, platform-staff/*, platform-search.ts, kill-switches.ts,
support-access-notice.ts, usage-alerts.ts, benchmark.ts, lint-ratchet.mjs, and 9 screens/components.
## 48. Database Migrations — 460 platform roles · 461 session step-up · 462 suspension reason · 463 lifecycle + trigger ·
464 support scope · 465 extension count · 466 usage alerts · 467 closed_at · 468 invitation platform role ·
469 MFA recovery tokens · 470 platform approvals · 471 platform feature registry.
## 49. Environment Configuration — none new required. Kill switches live in platform_settings (absent = running).
`PAYMENTS_ALLOW_ENV_FALLBACK=1` is now the only way a server-wide processor is used (development).
## 50. Deployment Order — migrations 460–468 (additive; 460 backfills every existing SUPER_ADMIN to PLATFORM_SUPER_ADMIN;
463 backfills lifecycle from status) → API → admin-web, pos-web, owner-web.
## 51. Migration Plan — no data rewritten beyond the two backfills; legacy tokens keep the full set they were minted with.
## 52. Rollback Plan — API/web roll back independently; the new columns are nullable/defaulted and ignored by old code;
the lifecycle trigger keeps status correct for old code; dropping it is safe (status remains the access gate).
## 53. Remaining Risks (the 4 PARTIAL lines, plus the recovery-link note)
Platform token audience (developer's tree) · `/platform` is an alias · the MFA recovery link is handed over by the
administrator (no automatic email yet) ·
frontend is one app · the
two-row last-Super-Admin race is proven only by row locks in real Postgres (the PGlite load run cannot serialise it).

**FINAL CONTROL PLANE PRINCIPLE — held:** the platform governs tenants through audited, permissioned, step-up-protected,
server-enforced controls; nothing is hidden-only, nothing is silently permanent, and every override names a reason.
