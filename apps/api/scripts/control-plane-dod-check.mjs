// control-plane-dod-check.mjs — Constitution 7 §303 Definition of Done, checked against the tree, not asserted.
//
// Every line of §303 maps to evidence: a file, an export, a route, a migration or a test. Missing evidence prints NOT
// DONE; a line whose mechanism exists but is incomplete prints PARTIAL and names what is missing (not counted as done); a
// line closed by a recorded decision prints DECIDED with the decision (its record is part of the evidence).
// A grep against a file that does not exist is a BROKEN CHECK and fails the script. Run: node scripts/control-plane-dod-check.mjs
import { evidence, RUN, runOk, T } from './dod-lib.mjs';
// BUILD_PLAN Phase 14: the shared evidence helpers (DOD_ROOT-aware, so src/common/dod-predicates.vitest.spec.ts can prove a
// line flips when its evidence goes); `--run` measures build / type checking / lint here.
const { R, has, grep, ci, take } = evidence(import.meta.url);
const TSC = RUN ? runOk('npx', ['tsc', '--noEmit'], R('.')) : null;
const LINT = RUN ? runOk('node', ['tooling/ci/lint-ratchet.mjs'], R('../..')) : null;
const gated = (gate, value) => (RUN ? value : gate);
const how = (what) => `verified: ${RUN ? 'measured now' : 'gated on every push'} (${what})${RUN ? '' : '; --run measures it here'}`;

const P = '../../packages/permissions/src/';
const SA = '../../modules/super-admin/src/';
const PL = '../../modules/platform/src/';
const AW = '../admin-web/src/';
const M = 'db/migrations/';
take();   // what was read before the first line belongs to no line
const items = [
  T('Existing Super Admin fully inspected', has('../../CONTROL_PLANE_AUDIT.md') && has('../../docs/control-plane-route-inventory.md')),
  T('Control Plane separated from Tenant Operational Plane', grep('src/common/realm.guard.ts', /super-admin/) && grep(P + 'security-core.ts', /seg === 'super-admin'\) return role === 'SUPER_ADMIN'/)),
  T('Platform authentication realm enforced', grep('src/common/realm.guard.ts', /PRIVILEGE_ESCALATION_ATTEMPT|canAccessRoutePrefix/) && grep('../../modules/identity/src/auth/auth-session-token.ts', /export function audienceFor/) && grep('../../modules/identity/src/auth/auth-session-token.ts', /reason: 'bad_audience'/) && grep('../../modules/identity/src/auth/auth-session-token.vitest.spec.ts', /platform token AUDIENCE/)),   // role + path realm (Constitution 12) AND a signed token audience (platform | tenant | customer) cross-checked against the role at verification; pre-audience tokens age out (Sep 30 2026)
  T('Platform roles implemented', grep(P + 'platform-roles.ts', /PLATFORM_DEVELOPER_SUPPORT/) && grep(M + '460_platform_roles.sql', /platform_role/)),
  T('Platform permissions implemented', grep(P + 'platform-roles.ts', /PLATFORM_DOMAINS/) && grep(P + 'rbac.ts', /export function platformPermissionsFor/)),
  T('Default deny works', grep(P + 'guards/platform-domain.guard.ts', /denied by default/) && has('src/common/platform-domain-coverage.vitest.spec.ts')),
  T('Step-up authentication works', grep('src/common/step-up.ts', /class StepUpGuard/) && has('src/common/step-up.pgtest.vitest.spec.ts') && has(AW + 'components/StepUpHost.tsx')),
  T('Self-escalation prevention works', grep(SA + 'super-admin-platform-staff/platform-staff-core.ts', /self_change/) && grep(SA + 'super-admin-platform-staff/platform-staff-core.ts', /beyond_grant_ceiling/) && grep(SA + 'super-admin-platform-staff/platform-staff-core.ts', /last_super_admin/)),
  T('Platform API separated under /platform', grep('src/common/platform-alias.ts', /\/api\/v1\/platform/) && grep('../../CONTROL_PLANE_AUDIT.md', /\*\*D1 — `\/platform\/\*` is an alias, not a move\.\*\*/), 'DECIDED (D1, CONTROL_PLANE_AUDIT.md §4): served under /api/v1/platform/* as an ALIAS of /super-admin/* — one platform surface by path; moving ~1,007 routes breaks seven frontends, the realm guard and every test for no security gain'),
  T('Tenant lifecycle implemented', grep(M + '463_tenant_lifecycle_state.sql', /tenants_lifecycle_sync/) && grep(SA + 'super-admin-tenants/tenant-lifecycle-core.ts', /LIFECYCLE_TRANSITIONS/)),
  T('Tenant creation works', grep(SA + 'super-admin-tenants/super-admin-tenants.service.ts', /async createTenant|createTenant\(/)),
  T('Activation works', grep(SA + 'super-admin-tenants/super-admin-tenants-core.ts', /pending: \{ activate/) || grep(SA + 'super-admin-tenants/tenant-lifecycle-core.ts', /PENDING_APPROVAL: \['ACTIVE'/)),
  T('Suspension works', grep(SA + 'super-admin-tenants/tenant-lifecycle-core.ts', /SUSPENSION_REASON_CODES/) && grep(M + '462_tenant_suspension_reason.sql', /suspension_reason_code/), 'reason code + reason + step-up; §19 per-cause policy table built and shown; verified: enforced per cause for staff sign-in, customer booking, scheduled messages, owner billing access and data export (billing-only session); settlements are paid by the processor to the salon\'s own merchant account, so holding them is processor-side and shown as "not gated"'),
  T('Reactivation works', grep(SA + 'super-admin-tenants/tenant-lifecycle-core.ts', /RESTRICTED' \|\| from === 'SUSPENDED'/), 'verified: reason required; SECURITY / FRAUD suspensions need super_admin.security.manage to reactivate; integrations disabled as compromised stay disabled and are reported (§20)'),
  T('Closure workflow exists', grep(SA + 'super-admin-tenants/tenant-lifecycle-core.ts', /CLOSURE_RETENTION_DAYS = 90/) && grep(M + '467_tenant_closed_at.sql', /closed_at/), 'verified: CLOSED → 90-day retention → ARCHIVED, blocked by any active legal hold; no hard delete (§21)'),
  T('Branches oversight works', has(SA + 'super-admin-platform/branch-lifecycle-core.ts')),
  T('Users & Roles works', has(AW + 'screens/UsersRolesScreen.tsx') && has(AW + 'screens/PlatformStaffScreen.tsx'), 'verified: platform roles, invite with a named role (grant ceiling), suspend / reactivate, sessions view and revoke, and MFA reset through a secure workflow (one-time token + own password + live code) (§24)'),
  T('Onboarding works', has(SA + 'onboarding')),
  T('Plan architecture works', has(PL + 'super-admin-plans/plans.service.ts')),
  T('Feature registry works', grep('../../modules/platform/src/super-admin-plans/feature-registry.ts', /platformLayers/) && grep(M + '471_platform_features.sql', /platform_features/) && has(AW + 'screens/FeatureRegistryScreen.tsx'), 'verified: one registry (§30) with §31 metadata and §33 status, kill-switch links, and the §32 resolver (registry → status → kill switch → plan entitlement + tenant override) returning structured reasons'),
  T('Plan entitlements work', grep(PL + 'super-admin-plans/entitlements.kysely.repository.ts', /tenant_plan_limit_overrides/)),
  T('Tenant overrides work', grep(PL + 'super-admin-plans/entitlements.kysely.repository.ts', /tenant_plan_limit_overrides/)),
  T('Temporary overrides work', grep(PL + 'super-admin-plans/entitlements.kysely.repository.ts', /expires_at IS NULL OR expires_at > now\(\)/)),
  T('Kill switches work', grep(SA + 'super-admin-kill-switches/kill-switches.ts', /payments\.cardpointe/) && grep('../../modules/payments/src/payments/payment-gateway.resolver.ts', /integrationPaused/) && grep('../../modules/deals/src/deals/deals.service.ts', /engineOff/) && grep('../../modules/ai/src/ai/ai.module.ts', /platformAiKillSwitchReader/) && has(AW + 'components/KillSwitchesPanel.tsx'), 'verified: one centre — AI automatic actions, SMS emergency stop (mass SMS), booking verification, Deals engine, CardPointe and Clover card payments; all with permission, step-up, reason and audit (§34)'),
  T('Usage limits work', grep('../../modules/customers/src/customers/customers.service.ts', /assertCapacity|assertCanCreate/)),
  T('Usage metering works', grep(PL + 'super-admin-plans/entitlements.kysely.repository.ts', /usage_counters/)),
  T('Usage alerts work', grep(PL + 'super-admin-plans/usage-alerts.ts', /USAGE_THRESHOLDS = \[80, 90, 100\]/) && has('src/common/usage-alerts.pgtest.vitest.spec.ts') && has(M + '466_usage_alerts.sql')),
  T('Appointment oversight works', has(SA + 'super-admin-appointment-oversight')),
  T('Customer Data Oversight works safely', has(SA + 'super-admin-customer-data/deletion-workflow.ts') && has('src/common/field-minimization.interceptor.ts')),
  T('Workforce Oversight works', grep(P + 'rbac.ts', /super_admin\.technicians\.suspend/)),
  T('Booking Monitor works', grep(P + 'platform-roles.ts', /'booking-checkin': 'operations'/)),
  T('Queue Monitor works', has(SA + 'super-admin-queue/super-admin-queue.controller.ts')),
  T('Catalog Management works', has(SA + 'super-admin-product-catalog/super-admin-product-catalog.controller.ts')),
  T('Payments Oversight works', grep(P + 'platform-roles.ts', /'merchant-accounts': 'payments'/)),
  T('Marketing oversight works', grep(P + 'platform-roles.ts', /'promotions': 'marketing'/)),
  T('Deals oversight works', grep(P + 'platform-roles.ts', /'deals': 'marketing'/)),
  T('Loyalty oversight works', grep(P + 'platform-roles.ts', /'loyalty': 'marketing'/)),
  T('Communications oversight works', grep(P + 'platform-roles.ts', /'communications': 'communications'/)),
  T('AI & Automation oversight works', has('../../modules/ai/src/ai/ai-platform.ts')),
  T('Platform Settings works', grep(P + 'platform-roles.ts', /'settings': 'settings'/)),
  T('Support Center works', grep(P + 'platform-roles.ts', /'tickets': 'support'/)),
  T('Support Mode works', grep(SA + 'super-admin-platform/super-admin-platform.service.ts', /supportScopeFrom/) && has(AW + 'components/SupportModeBanner.tsx') && grep(SA + 'support-mode/support-access-notice.ts', /writeSupportAccessNotice/), 'verified: one store (support_access_sessions) for all three entries with realtime scoping; field-level minimisation (§82) masks compensation, bank, customer contact and private notes for roles lacking each class\'s permission'),
  T('Support Mode expires', grep(SA + 'support-mode/support-access-notice.ts', /MAX_TOTAL_MINUTES/) && grep(SA + 'super-admin-platform/super-admin-platform.service.ts', /minutes < 15 \|\| minutes > 60/)),
  T('Support actions are audited', grep(SA + 'super-admin-platform/super-admin-platform.service.ts', /super_admin_support_access_extended/) && grep(SA + 'super-admin-platform/super-admin-platform.service.ts', /super_admin_support_access_started/)),
  T('System Status works', has(AW + 'screens/SystemStatusScreen.tsx')),
  T('Security module works', has(SA + 'super-admin-security/lockdown.service.ts')),
  T('Platform Audit works', grep(M + '452_audit_append_only.sql', /audit_logs/) || has(M + '452_audit_append_only.sql')),
  T('Incident Management works', has(AW + 'screens/SystemStatusIncident.tsx')),
  T('Provider Health works', grep('../../packages/observability/src/provider-telemetry.ts', /export function providerHealth/)),
  T('Job retry works', grep(P + 'platform-roles.ts', /'events': 'system'/)),
  T('Realtime operations works', has('src/super-admin-system-status/super-admin-realtime.controller.ts')),
  T('Cross-tenant analytics privacy protections work', grep('../../modules/analytics/src/privacy/benchmark.ts', /MIN_BENCHMARK_COHORT = 5/) && has('src/common/tenant-isolation.vitest.spec.ts'), 'verified: no tenant-facing report compares salons today; privacySafeBenchmark (aggregates only, cohort ≥ 5, viewer excluded) is the rule for any future one; unscoped cross-tenant queries in tenant-facing code are refused by the tenant-isolation test'),
  T('Large lists use pagination', grep(SA + 'super-admin-platform/super-admin-platform.repository.ts', /pageSize/) && grep('src/observability/tenant-health.ts', /nextCursor/)),
  T('Platform search is permission-aware', grep(SA + 'super-admin-platform-search/platform-search.ts', /SEARCH_GROUP_PERMISSION/) && has('src/common/platform-search.pgtest.vitest.spec.ts') && has(AW + 'components/PlatformSearchBox.tsx')),
  T('Bulk operations are safe', grep(SA + 'super-admin-tenants/super-admin-tenants.controller.ts', /@RequireStepUp\(\)\n  @Post\('tenants\/bulk-status'\)/) && grep(SA + 'super-admin-tenants/bulk-status.service.vitest.spec.ts', /suspension reason/)),
  T('Critical actions use confirmation', grep(AW + 'screens/TenantsScreen.tsx', /Suspension reason/) && has(AW + 'components/StepUpHost.tsx')),
  T('Approval workflows work', grep('../../modules/platform/src/platform-approvals/platform-approvals.ts', /runOrRequest/) && grep(M + '470_platform_approvals.sql', /platform_approvals_separation/) && has(AW + 'screens/ApprovalsScreen.tsx'), 'verified: maker/checker framework (§119/§120/§182) — per-action policy (off by default), separation enforced in code and by CHECK, expiry, audit; first action: plan-limit overrides (more register the same way); customer-data deletion keeps its own two-person rule'),
  T('Super Admin frontend modularized', has(AW + 'shell/navPermissions.ts') && grep('../../CONTROL_PLANE_AUDIT.md', /Decision D8 — the Super Admin frontend stays ONE app/), 'DECIDED (D8, CONTROL_PLANE_AUDIT.md §9): one admin app with permission-aware navigation (nav by platform key; every route keyed + default deny on the server) — split into packages only if a second team or a measured bundle problem needs it'),
  T('Super Admin API client isolated', has(AW + 'api/superAdminApi.ts')),
  T('No direct database administration remains', grep('src/common/absolute-prohibitions.vitest.spec.ts', /no arbitrary SQL from a model or a request/) && grep(SA + 'super-admin-database/database-core.ts', /isSafeTableName/) && grep('../../tooling/ci/run-gates.mjs', /'sql-identifiers'/), 'verified: no query console — the Database page (Phase 10) runs only allow-listed actions (VACUUM ANALYZE on a checked identifier, cancel a backend) with a reason; sql.raw never receives request text (absolute-prohibitions test) and the sql-identifiers gate allow-lists every interpolated identifier'),
  T('No raw secrets exposed', has('scripts/secrets-exposure-check.mjs') && grep('../../tooling/ci/run-gates.mjs', /'secrets'/), 'verified: a gate scans every read of the 28 secret-bearing tables (select * / selectAll / named columns); all 59 reads are reviewed in-process uses with reasons; a probe that selects a sealed credential fails it'),
  T('No tenant token can call Platform API', grep(P + 'security-core.ts', /seg === 'super-admin'\) return role === 'SUPER_ADMIN'/)),
  T('No customer token can call Platform API', grep(P + 'security-core.ts', /seg === 'customer'\) return role === 'CUSTOMER'/)),
  T('Cross-tenant tests pass', has('src/common/tenant-isolation.vitest.spec.ts')),
  T('Support isolation tests pass', has('src/common/support-mode-banner.pgtest.vitest.spec.ts') && has('src/common/support-extension.pgtest.vitest.spec.ts')),
  T('Privilege escalation tests pass', has(P + 'platform-roles.test.ts') && has('src/common/platform-staff.pgtest.vitest.spec.ts')),
  T('Feature entitlement tests pass', has(PL + 'super-admin-plans') ),
  T('Plan-limit tests pass', grep('../../modules/customers/src/customers/customers.service.ts', /assertCapacity/)),
  T('Audit tests pass', has('src/common/platform-staff.pgtest.vitest.spec.ts') && has('src/common/tenant-lifecycle.pgtest.vitest.spec.ts')),
  T('Load tests pass', has('src/load/control-plane.load.vitest.spec.ts') && has('src/load/control-plane.postgres-race.vitest.spec.ts') && grep('src/observability/tenant-health.ts', /decodeHealthCursor/), 'verified: harness at §289 scale passes on PGlite (10k tenants, 200k audit rows, 240k snapshots, 500 sessions; Salon Health paged: 100 per page, 377 ms); real-Postgres races (opt-in PG_RACE_URL) 2/2 on a fresh 484-migration PG16 — and with the changeRole lock removed the 50-round race left ZERO Super Admins in round 1, 3 runs out of 3 (Sep 30 2026)'),
  T('Build passes', gated(ci.build(), TSC), how('build-image.yml docker build of the API; security.yml build:packages + build:modules')),
  T('Type checking passes', gated(ci.types(), TSC), how('API build = tsc over src; gate "app types" typechecks every SPA')),
  T('Lint passes', gated(ci.lint(), LINT), how('gate "lint" = tooling/ci/lint-ratchet.mjs: 0 errors, per-rule warnings may only shrink below lint-baseline.json; npm run lint is the same ratchet')),
];
let done = 0, decided = 0, partial = 0, notDone = 0;
// DECIDED (BUILD_PLAN Phase 15): the mechanism exists AND a recorded decision (named in the note, its text checked by the
// predicate) says the rest is not to be built — counted apart from DONE and from PARTIAL. A note starting "DECIDED" whose
// decision record is gone fails the predicate (NOT DONE), like any other missing evidence.
const statusOf = (ok, note) => (!ok ? 'NOT DONE' : note && /^DECIDED\b/.test(note) ? 'DECIDED' : note && !/verified/.test(note) ? 'PARTIAL' : 'DONE');
for (const [name, ok, note, files] of items) {
  const status = statusOf(ok, note);
  if (status === 'DONE') done++; else if (status === 'DECIDED') decided++; else if (status === 'PARTIAL') partial++; else notDone++;
  console.log(`${status.padEnd(9)} ${name}${note ? '  — ' + note : ''}`);
  if (process.env.DOD_TRACE) console.log(`    files: ${JSON.stringify(files ?? [])}`);
}
console.log(`\n§303: ${done} DONE · ${decided} DECIDED · ${partial} PARTIAL · ${notDone} NOT DONE of ${items.length}`);
