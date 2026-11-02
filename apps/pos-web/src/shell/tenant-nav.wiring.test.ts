// tenant-nav.wiring.test.ts — locks the sidebar ↔ route wiring model (full-wiring pass 2026-07-03).
// EXISTING_ROUTES (tenant-nav.tsx) is the single source of truth for which nav routes have a dedicated screen;
// App.tsx registers featureRoutes() unfiltered. These tests fail if the two ever drift again (the old inline
// App.tsx filter is gone), if a dedicated screen becomes unreachable from the sidebar, or if a nav item points
// at a route nothing registers.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { TENANT_NAV, EXISTING_ROUTES, featureRoutes, allNavItems, requiredPermissions } from './tenant-nav';
import { gateFor } from './tenant-access';

// vitest runs with cwd = apps/pos-web; import.meta.url is not a file: URL under the jsdom transform.
const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const dedicated = new Set(
  [...appSrc.matchAll(/<Route path="([^"]+)" element=\{<(\w+)/g)]
    .filter((m) => m[2] !== 'FeaturePage')
    .map((m) => '/' + m[1].replace(/^\//, '')),
);

describe('tenant sidebar ↔ route wiring invariants', () => {
  it('every EXISTING_ROUTES entry has a dedicated <Route> in App.tsx (no stale entries)', () => {
    const stale = [...EXISTING_ROUTES].filter((r) => !dedicated.has(r));
    expect(stale).toEqual([]);
  });

  it('featureRoutes() never collides with a dedicated App.tsx route (anti-double-registration)', () => {
    const collisions = featureRoutes().map((it) => it.route).filter((r) => dedicated.has(r));
    expect(collisions).toEqual([]);
  });

  it('every nav route resolves: dedicated screen or FeaturePage — never unregistered', () => {
    const featureSet = new Set(featureRoutes().map((it) => it.route));
    const unresolved = allNavItems()
      .map((it) => it.route)
      .filter((r) => !dedicated.has(r) && !featureSet.has(r));
    expect(unresolved).toEqual([]);
  });

  it('previously-orphaned dedicated screens are reachable from the sidebar', () => {
    const navRoutes = new Set(allNavItems().map((it) => it.route));
    for (const r of [
      '/tech-appointments',            // POSTechAppointmentsScreen
      '/technicians/skill-requests',   // POSSkillRequestsScreen
      '/tenant/ai/plans',              // POSAIPlansScreen
      '/tenant/devices/logs',          // TenantLogsScreen
      '/tenant/integrations/api-webhooks', // TenantApiWebhooksScreen
      '/settings/follow-ups',          // EndOfDayFollowUpSettings
    ]) expect(navRoutes.has(r), r).toBe(true);
  });

  it('no nav item points at the removed /tenant/account/ai-packages placeholder', () => {
    expect(allNavItems().some((it) => it.route === '/tenant/account/ai-packages')).toBe(false);
  });

  // BUILD_PLAN Phase 7 (audit: two "AI Scheduling Optimizer" entries — one opened the package page, not the optimizer)
  it('exactly one AI Scheduling Optimizer entry, pointing at the optimizer; the old /tenant/ai/scheduling route redirects', () => {
    const entries = allNavItems().filter((it) => it.label === 'AI Scheduling Optimizer' || it.aiPackageCode === 'ai_scheduling_optimizer');
    expect(entries.map((e) => e.route)).toEqual(['/tenant/ai/scheduling-optimizer']);
    expect(appSrc).toMatch(/<Route path="tenant\/ai\/scheduling" element=\{<Navigate to="\/tenant\/ai\/scheduling-optimizer" replace \/>\} \/>/);
  });

  // BUILD_PLAN Phase 8: one Safety Community entry, gated by community.feed.view; every community page and the
  // /community/posts/:id deep link (the alert / notification target) has a dedicated route
  it('Safety Community: one nav entry gated by community.feed.view; the deep link and every page are routed', () => {
    const entries = allNavItems().filter((it) => it.route === '/community' || it.label === 'Safety Community');
    expect(entries.map((e) => [e.route, e.permission])).toEqual([['/community', 'community.feed.view']]);
    for (const p of ['community', 'community/posts/:id', 'community/new', 'community/drafts', 'community/drafts/:id', 'community/approvals', 'community/incidents', 'community/settings'])
      expect(appSrc, p).toContain(`<Route path="${p}" element={<Community`);
  });

  it('nav item ids are unique (React key invariant)', () => {
    const ids = allNavItems().map((it) => it.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it('every item route is absolute', () => {
    for (const s of TENANT_NAV) for (const it of s.items) expect(it.route.startsWith('/'), `${s.section} › ${it.label}`).toBe(true);
  });
});

// ── BUILD_PLAN Phase 9 (Constitution 2): the sidebar follows PERMISSIONS — no role lists, no OWNER shortcut ─────────────
// The server's catalog + role grants are read from packages/permissions/src/rbac.ts (as text, transpiled here — an app
// may not import a backend package), so a key renamed or a grant moved on the server shows up here.
const RBAC_SRC = readFileSync(resolve(process.cwd(), '../../packages/permissions/src/rbac.ts'), 'utf8');
const CATALOG = new Set([...RBAC_SRC.slice(RBAC_SRC.indexOf('export const PERMISSIONS = ['), RBAC_SRC.indexOf('] as const;')).matchAll(/'([a-z0-9_.]+)'/g)].map((m) => m[1]));
const rbac = (() => {
  const js = ts.transpileModule(RBAC_SRC, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod: any = { exports: {} };
  new Function('exports', 'require', 'module', js)(mod.exports, (m: string) => (m === './platform-roles' ? { PLATFORM_ROLE_GRANTS: {}, PLATFORM_FALLBACK_ROLE: 'X', isPlatformRole: () => false } : {}), mod);
  return mod.exports as { ROLE_PERMISSIONS: Record<string, string[]> };
})();
const visibleFor = (perms: string[]) => allNavItems().filter((it) => gateFor(it, { permissions: perms, features: [], aiPackages: [], subscriptionStatus: 'active' }) !== 'no-permission').map((it) => it.id);
const ids = () => allNavItems().map((it) => it.id);
// What each role saw under the OLD role lists (computed from the pre-Phase-9 tenant-nav.tsx, Oct 8 2026). The only
// deliberate changes: 'acc-users' (a second door to the same roster) is gone, 'acc-access-governance' is new (owner),
// 'approvals' is new (approvals.view: owner, manager, front desk — not technicians).
const OWNER_ONLY = ['ai-platform-settings', 'rep-multi', 'mg-features', 'int-gateway', 'int-api', 'acc-subscription', 'acc-ai', 'acc-billing', 'acc-invoices', 'acc-access-governance'];
const FRONT_OF_HOUSE = ['overview', 'checkin', 'booking', 'techqueue', 'queue', 'serving', 'done', 'checkout', 'approvals', 'safety-community',
  'cust-dir', 'cust-profiles', 'cust-history', 'cust-loyalty', 'cust-giftcards', 'cust-notes', 'cust-saved-cards', 'cust-retention', 'cust-showcase',
  'memberships', 'comm-ai-recept', 'comm-messages', 'comm-sms', 'comm-reminders', 'comm-missed', 'comm-notify'];
const TECHNICIAN = ['overview', 'techqueue', 'queue', 'serving', 'done', 'safety-community'];

describe('Phase 9 — permission-driven POS navigation', () => {
  it('every key a nav item or section needs exists in the server catalog', () => {
    expect(CATALOG.size).toBeGreaterThan(300);
    const keys = new Set(allNavItems().flatMap((it) => requiredPermissions(it)));
    expect([...keys].filter((k) => !CATALOG.has(k))).toEqual([]);
  });
  it('no role lists anywhere: sections and items declare permissions only', () => {
    for (const s of TENANT_NAV) {
      expect('roles' in s, s.section).toBe(false);
      for (const it of s.items) expect('roles' in it, it.id).toBe(false);
    }
    const src = readFileSync(resolve(process.cwd(), 'src/shell/tenant-nav.tsx'), 'utf8') + readFileSync(resolve(process.cwd(), 'src/shell/tenant-access.ts'), 'utf8');
    expect(src).not.toMatch(/roles:\s*\[|TenantRole|roleAllowed/);
    expect(src).not.toMatch(/===\s*'OWNER'|!==\s*'OWNER'/);   // the OWNER bypass in gateFor is gone
  });
  it('an OWNER role name without the keys sees nothing gated; the keys alone decide', () => {
    const ownerNamed = { role: 'OWNER', permissions: [] as string[], features: [], aiPackages: [], subscriptionStatus: 'active' };
    expect(gateFor({ id: 'team-permissions' }, ownerNamed)).toBe('no-permission');   // bug 6: the old gateFor let any OWNER through
    expect(gateFor({ id: 'acc-access-governance' }, ownerNamed)).toBe('no-permission');
    expect(gateFor({ id: 'team-permissions' }, { permissions: ['technicians.edit', 'roles.view'], features: [], aiPackages: [], subscriptionStatus: 'active' })).toBe('ok');
    expect(gateFor({ id: 'team-permissions' }, { permissions: ['roles.view'], features: [], aiPackages: [], subscriptionStatus: 'active' })).toBe('no-permission');   // the TEAM section key is needed too
    expect(gateFor({ id: 'checkin' }, { permissions: ['checkin.view'], features: [], aiPackages: [], subscriptionStatus: 'active' })).toBe('no-permission');   // a list = ALL of them
  });
  it('each server role sees exactly what it saw under the old role lists (the per-role snapshot)', () => {
    const all = ids();
    expect(visibleFor(rbac.ROLE_PERMISSIONS.OWNER)).toEqual(all);
    expect(visibleFor(rbac.ROLE_PERMISSIONS.MANAGER)).toEqual(all.filter((id) => !OWNER_ONLY.includes(id)));
    expect(visibleFor(rbac.ROLE_PERMISSIONS.FRONT_DESK)).toEqual(all.filter((id) => FRONT_OF_HOUSE.includes(id)));
    expect(visibleFor(rbac.ROLE_PERMISSIONS.RECEPTION)).toEqual(all.filter((id) => FRONT_OF_HOUSE.includes(id)));
    expect(visibleFor(rbac.ROLE_PERMISSIONS.TECHNICIAN)).toEqual(all.filter((id) => TECHNICIAN.includes(id)));
  });
  it('one Roles & Permissions entry (roles.view); Users & Roles redirects to it; the governance screen is routed', () => {
    expect(allNavItems().filter((it) => /Roles/.test(it.label)).map((it) => [it.route, requiredPermissions(it)])).toEqual([['/tenant/team/permissions', ['technicians.edit', 'roles.view']]]);
    expect(appSrc).toMatch(/<Route path="tenant\/account\/users-roles" element=\{<Navigate to="\/tenant\/team\/permissions" replace \/>\} \/>/);
    expect(appSrc).toContain('<Route path="tenant/team/permissions/:userId" element={<POSMemberAccessScreen />} />');
    expect(appSrc).toContain('<Route path="tenant/security/access" element={<POSAccessGovernanceScreen />} />');
  });
  it('one Approvals entry (approvals.view) pointing at the approvals inbox screen', () => {
    expect(allNavItems().filter((it) => it.route === '/approvals').map((it) => requiredPermissions(it))).toEqual([['approvals.view']]);
    expect(appSrc).toContain('<Route path="approvals" element={<POSApprovalsScreen />} />');
  });
});
