// accessTestKit.ts — fixtures + a routed fetch for the Phase 9 access screens' tests. Calls go through the REAL api
// client, so a wrong path, verb, query or body fails the test. Routes / bodies are contract §2.6 and §3.4 exactly.
import { vi } from 'vitest';
import type { PermissionDefinition, TeamMemberView, TeamRoleView, TeamEffectivePermissions, AccessReviewView } from '@aipowersalon/api-contracts/tenant';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export type Call = { url: string; method: string; body?: any };
export type Reply = { status?: number; body?: any; headers?: Record<string, string> };
export type Routes = Record<string, Reply | ((c: Call) => Reply)>;

export const def = (key: string, o: Partial<PermissionDefinition> = {}): PermissionDefinition => ({
  key, domain: key.split('.')[0], action: key.split('.').slice(1).join('.'), label: key.replace(/[._]/g, ' '), description: t('pos.lets_them_key', { key: String(key) }),
  sensitivity: 'low', scopes: ['TENANT'], stepUp: false, realm: 'tenant', deprecatedAliases: [], ...o,
});
export const CATALOG: PermissionDefinition[] = [
  def('pos.login', { label: t('pos.sign_in_to_the_pos') }), def('booking.manage', { label: t('pos.manage_bookings') }),
  def('checkout.approve_refund', { label: t('pos.approve_large_refunds'), sensitivity: 'critical', stepUp: true }),
  def('customers.export', { label: t('pos.export_customers'), sensitivity: 'high' }), def('reports.view', { label: t('pos.view_reports_2'), sensitivity: 'medium' }),
  def('settings.edit', { label: t('pos.edit_salon_settings'), sensitivity: 'high' }), def('super_admin.tenants.view', { realm: 'platform', label: t('pos.platform_tenants') }),
];
export const member = (o: Partial<TeamMemberView> = {}): TeamMemberView => ({
  userId: 'u2', name: 'Mai Tran', email: 'mai@x.test', role: 'MANAGER', templateKey: null, templateName: null, status: 'active', homeBranchId: 'b1',
  branchAccess: [], overrides: [], lastLoginAt: '2026-10-01T15:00:00Z', dormant: false, isOwner: false, isPrimaryOwner: false, authorizationVersion: 3, ...o,
});
export const MEMBERS: TeamMemberView[] = [
  member({ userId: 'u1', name: 'Olga Owner', email: 'olga@x.test', role: 'OWNER', isOwner: true, isPrimaryOwner: true, homeBranchId: null }),
  member(),
  member({ userId: 'u3', name: 'Rae Desk', email: 'rae@x.test', role: 'FRONT_DESK', dormant: true, lastLoginAt: null,
    branchAccess: [{ branchId: 'b2', branchName: 'Uptown', role: null, accessLevel: 'staff', isPrimaryOwner: false }],
    overrides: [{ id: 'o1', permission: 'customers.export', effect: 'DENY', branchId: null, reason: 'no exports', grantedByName: 'Olga Owner', startsAt: '2026-10-02T10:00:00Z', expiresAt: null, active: true, temporary: false }] }),
];
export const ROLES: TeamRoleView[] = [
  { key: 'MANAGER', name: 'Manager', baseRole: 'MANAGER', scope: 'TENANT', permissions: ['pos.login', 'booking.manage', 'reports.view', 'checkout.approve_refund', 'customers.export'], custom: false, description: null, memberCount: 1 },
  { key: 'ACCOUNTANT', name: 'Accountant', baseRole: 'MANAGER', scope: 'TENANT', permissions: ['pos.login', 'reports.view'], custom: false, description: t('pos.books_only'), memberCount: 0 },
  { key: 'FRONT_DESK', name: 'Front Desk', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['pos.login', 'booking.manage'], custom: false, description: null, memberCount: 1 },
  { key: 'custom:lead', name: 'Desk Lead', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['pos.login'], custom: true, description: null, memberCount: 0 },
];
export const EFFECTIVE: TeamEffectivePermissions = {
  userId: 'u2', role: 'MANAGER', templateKey: null, scope: 'TENANT', branchIds: null, authorizationVersion: 3,
  permissions: [{ key: 'pos.login', reason: 'granted_by_role', expiresAt: null }, { key: 'reports.view', reason: 'granted_by_role', expiresAt: null },
    { key: 'settings.edit', reason: 'granted_temporarily', expiresAt: '2026-10-09T18:00:00Z' }],
  denied: [{ key: 'customers.export', reason: 'denied_by_override' }],
};
export const review = (o: Partial<AccessReviewView> = {}): AccessReviewView => ({
  id: 'rv1', status: 'open', startedByName: 'Olga Owner', dueAt: null, createdAt: '2026-10-08T12:00:00Z', completedAt: null,
  items: [{ userId: 'u2', name: 'Mai Tran', role: 'MANAGER', templateKey: null, highRiskPermissions: ['checkout.approve_refund'], lastLoginAt: null, decision: null, note: null, decidedAt: null },
    { userId: 'u3', name: 'Rae Desk', role: 'FRONT_DESK', templateKey: null, highRiskPermissions: [], lastLoginAt: null, decision: 'keep', note: 'ok', decidedAt: '2026-10-08T12:30:00Z' }], ...o,
});

export const kit = { routes: {} as Routes, calls: [] as Call[], steppedUp: false };
export function install(routes: Routes) {
  kit.routes = routes; kit.calls = []; kit.steppedUp = false;
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = String(input); const method = (init?.method || 'GET').toUpperCase();
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    const call = { url, method, body }; kit.calls.push(call);
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1(?=\/)/, '')   /* BUILD_PLAN Phase 12: the client calls /api/v1/<path> */.split('?')[0];
    const r = kit.routes[`${method} ${path}`];
    const rep: Reply = typeof r === 'function' ? r(call) : r || { status: 404, body: { code: 'NOT_FOUND', message: t('pos.no_route_method_path', { method: String(method), path: String(path) }) } };
    const status = rep.status ?? 200; const text = JSON.stringify(rep.body ?? null);
    return { ok: status >= 200 && status < 300, status, statusText: 'x', text: async () => text, json: async () => JSON.parse(text), headers: { get: (h: string) => rep.headers?.[h.toLowerCase()] ?? null } } as any;
  }) as any;
}
export const sent = (method: string, frag: string) => kit.calls.filter((c) => c.method === method && c.url.includes(frag));
export const STEP_UP = { status: 403, body: { code: 'STEP_UP_REQUIRED', message: t('pos.this_action_needs_you_to_confirm_y7h0') } };
/** POST /auth/step-up: the right password stamps the session (kit.steppedUp), a wrong one is refused like the server does. */
export const stepUpRoute = (password = 'right-pw') => (c: Call): Reply => {
  if (c.body?.password === password) { kit.steppedUp = true; return { body: { ok: true, strength: 'password' } }; }
  return { status: 403, body: { code: 'STEP_UP_FAILED', message: t('pos.password_is_not_correct') } };
};
/** A route that answers STEP_UP_REQUIRED until the session stepped up, then `ok`. */
export function stepUpGated(ok: (c: Call) => Reply): (c: Call) => Reply {
  return (c) => (kit.steppedUp ? ok(c) : STEP_UP);
}
