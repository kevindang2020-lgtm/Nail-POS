// route-keys-phase9.vitest.spec.ts — BUILD_PLAN Phase 9 (Constitution 2, default deny): every staff route declares a
// permission, and the keys the last 324 unkeyed routes received reach exactly the roles that could use them before.
//
//  1. The unkeyed baseline is EMPTY and the real tree has no unkeyed staff route (a new one fails check:api-contract).
//  2. Every key added in Phase 9 has the holders the contract says (one holder test per key).
//  3. Behaviour preservation, route by route, on the REAL route manifest: who can call each sampled route now is who
//     could call it before (the realm + the service's own check), or the documented tightening.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROLE_PERMISSIONS, PERMISSIONS, STAFF_SELF_SERVICE, permissionsFor, hasPermission, type Role } from '@aipowersalon/permissions';

const require = createRequire(import.meta.url);
const { routes } = require('../../scripts/audit-routes.js');
const gen: any = await import('../../scripts/openapi.mjs');
const contract: any = await import('../../scripts/check-api-contract.mjs');

const STAFF: Role[] = ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'];
const holdersOf = (key: string): Role[] => STAFF.filter((r) => hasPermission({ role: r, permissions: permissionsFor(r) } as any, key));
/** The key the route declares, looked up on the real manifest by "METHOD /openapi/path". */
const keyOf = (route: string): string => {
  const r = routes.find((x: any) => gen.factsOf(x).key === route);
  if (!r) throw new Error('no such route: ' + route);
  const f = gen.factsOf(r);
  expect(f.perms.length, route + ' declares one key').toBe(1);
  return f.perms[0];
};
const whoCanCall = (route: string): string[] => {
  const path = route.split(' ')[1].replace(/\{[^}]+\}/g, 'x');
  return contract.holders(path, keyOf(route)).filter((l: string) => (STAFF as string[]).includes(l)).sort();
};
const sorted = (xs: string[]) => [...xs].sort();

describe('Phase 9: no unkeyed staff route', () => {
  it('api-contract.unkeyed.baseline.txt has zero entries', () => {
    const lines = readFileSync(join(process.cwd(), 'openapi/api-contract.unkeyed.baseline.txt'), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    expect(lines).toEqual([]);
  });

  it('the real tree: every /pos, /owner, /tenant, /tech session route declares a key, and every key is reachable', () => {
    const r = contract.evaluate();
    expect(r.unkeyedStaff).toEqual([]);
    expect(r.unreachable).toEqual([]);
    expect(r.ineffective).toEqual([]);
  });
});

describe('Phase 9: holders of every new key', () => {
  const EXPECT: Record<string, Role[]> = {
    'self.profile.view': STAFF, 'self.profile.edit': STAFF, 'self.notifications': STAFF,
    'help.view': STAFF, 'help.request': STAFF, 'help.triage': ['OWNER', 'MANAGER'],
    'owner.portfolio.view': ['OWNER'],
    'tech.followups.manage': ['OWNER', 'MANAGER', 'TECHNICIAN'],
    'tech.cash.manage': ['OWNER', 'MANAGER', 'TECHNICIAN'],
    'tech.deals.manage': ['OWNER', 'MANAGER', 'TECHNICIAN'],
    // the five dead keys (audit bug 6) — four registered with the grants their checks meant
    'compensation.view_all': ['OWNER'], 'compensation.manage': ['OWNER'], 'ai.control.manage': ['OWNER'],
    'ai_inventory.view_cost': ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION'],
  };
  for (const [key, roles] of Object.entries(EXPECT)) {
    it(`${key} → ${roles.join(', ')}`, () => {
      expect((PERMISSIONS as readonly string[]).includes(key)).toBe(true);
      expect(sorted(holdersOf(key))).toEqual(sorted(roles));
      expect(ROLE_PERMISSIONS.CUSTOMER).not.toContain(key);
      expect(ROLE_PERMISSIONS.SUPER_ADMIN).not.toContain(key);
    });
  }

  it('pos.pricing.override is NOT registered (nothing checks it since Phase 1 — pos.checkout.override_total does)', () => {
    expect((PERMISSIONS as readonly string[]).includes('pos.pricing.override')).toBe(false);
  });

  it('STAFF_SELF_SERVICE is held by every staff role and by no customer', () => {
    for (const r of STAFF) for (const k of STAFF_SELF_SERVICE) expect(permissionsFor(r)).toContain(k);
    for (const k of STAFF_SELF_SERVICE) expect(permissionsFor('CUSTOMER')).not.toContain(k);
  });
});

describe('Phase 9: behaviour preserved, route by route (real manifest)', () => {
  const ALL = sorted(STAFF);
  const POS = ['FRONT_DESK', 'MANAGER', 'OWNER', 'RECEPTION'];
  const TECH = ['MANAGER', 'OWNER', 'TECHNICIAN'];
  const MGMT = ['MANAGER', 'OWNER'];
  const CASES: [string, string, string[]][] = [
    // Owner app — the key OwnerService already required (this.require(ctx, key))
    ['GET /owner/dashboard/state', 'owner.dashboard.view', MGMT],
    ['GET /owner/bookings/{appointmentId}', 'owner.bookings.details', ['OWNER']],
    ['GET /owner/staff/{technicianId}/earnings', 'owner.staff.earnings.view', ['OWNER']],
    ['GET /owner/reports/{reportId}/export', 'owner.reports.export', ['OWNER']],
    ['POST /owner/alerts/{alertId}/resolve', 'owner.alerts.resolve', ['OWNER']],
    // Receipt/Expense mandate §77 / §82 (Oct 21 2026): a manager records expenses of their own branch (rbac.ts MANAGER)
    ['POST /owner/expenses', 'owner.expenses.manage', MGMT],
    ['POST /owner/payroll/periods/{id}/approve', 'payroll.manage', MGMT],
    // role === 'OWNER' service checks → an owner-only key
    ['POST /owner/security/access-code', 'owner.settings.edit', ['OWNER']],
    ['GET /owner/portfolio', 'owner.portfolio.view', ['OWNER']],
    ['POST /owner/context/switch', 'owner.portfolio.view', ['OWNER']],
    ['GET /owner/compensation/rules', 'compensation.view_all', ['OWNER']],
    ['POST /owner/compensation/versions/{id}/activate', 'compensation.manage', ['OWNER']],
    ['PUT /owner/compensation/tip-policy', 'compensation.manage', ['OWNER']],
    // technician app — the tech.* key TechService already required
    ['GET /tech/tickets', 'tech.ticket.view', TECH],
    ['POST /tech/tickets/{id}/service-done', 'tech.service.complete', TECH],
    ['POST /tech/time-clock/clock-in', 'tech.timeclock.punch', TECH],
    ['POST /tech/skills/change-requests/{id}/decision', 'technicians.edit', MGMT],
    ['PATCH /tech/profile', 'tech.profile.edit', TECH],
    ['POST /tech/follow-ups/{id}/send', 'tech.followups.manage', TECH],
    ['POST /tech/tickets/{ticketId}/confirm-cash-received', 'tech.cash.manage', TECH],
    ['POST /tech/deals', 'tech.deals.manage', TECH],
    ['GET /tech/stream', 'tech.dashboard.view', TECH],
    // self-service + help: every staff role, as before
    ['GET /pos/me/profile', 'self.profile.view', ALL],
    ['PATCH /pos/me/avatar', 'self.profile.edit', ALL],
    ['PATCH /pos/me/notification-prefs', 'self.notifications', ALL],
    ['POST /tech/me/delete-account-request', 'self.profile.edit', ALL],
    ['GET /pos/account/overview', 'self.profile.view', ALL],
    ['GET /tenant/help/articles', 'help.view', ALL],
    ['POST /tenant/help/tickets', 'help.request', ALL],
    ['POST /tenant/help/tickets/{id}/status', 'help.triage', MGMT],
    ['GET /tenant/navigation', 'dashboard.view', ALL],
    // AI — the keys the AI Center already uses on its reads; writes the services gate on ai.manage
    ['POST /tenant/ai/center/copilot/context', 'reception_copilot.view_customer_context', POS],
    ['POST /tenant/ai/center/copilot/learning/approve', 'reception_copilot.approve_learning', MGMT],
    ['PATCH /tenant/ai/center/copilot/settings', 'ai.manage', ['OWNER']],
    ['POST /tenant/ai/receptionist/agents', 'ai.manage', ['OWNER']],
    ['PATCH /tenant/ai/control-modes/{assistantKey}', 'ai.control.manage', ['OWNER']],
    ['POST /tenant/ai/subscriptions', 'ai.manage', ['OWNER']],
    // POS — the coarse capability the service's pos.* check maps to
    ['POST /pos/cash-drawer/open', 'checkout.process_payment', POS],
    ['POST /pos/tickets/{ticketId}/send-app-payment', 'checkout.process_payment', POS],
    ['GET /pos/serving/retail-catalog', 'serving.manage', ALL],
    ['PATCH /pos/reminders', 'communications.manage', POS],
    ['POST /tenant/messaging/number/buy', 'settings.edit', ['OWNER']],
    ['GET /tenant/sms-plan', 'settings.view', MGMT],
  ];
  for (const [route, key, who] of CASES) {
    it(`${route} — ${key} — ${who.join(', ')}`, () => {
      expect(keyOf(route)).toBe(key);
      expect(whoCanCall(route)).toEqual(sorted(who));
    });
  }

  it('documented tightenings: salon billing / backup and the salon Twilio read are no longer open to every staff role', () => {
    expect(whoCanCall('GET /pos/me/billing')).toEqual(MGMT);
    expect(whoCanCall('POST /pos/me/backup/run')).toEqual(['OWNER']);
    expect(whoCanCall('GET /tenant/messaging/credentials')).toEqual(MGMT);
    expect(whoCanCall('GET /tenant/help/tickets/export')).toEqual(ALL);   // an export of the caller's own tickets: unchanged
  });
});
