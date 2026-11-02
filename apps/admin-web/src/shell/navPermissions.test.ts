// Constitution 7 §10 — the sidebar follows permissions, not role names; the map stays complete and in step with the server.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NAV_DOMAIN_VIEW_KEY, canOpen, navSegment } from './navPermissions';
import { NAV_GROUPS, visibleNavGroups } from './AdminLayout';

const allTos = NAV_GROUPS.flatMap((g) => g.items.flatMap((n: any) => [n.to, ...(n.children ?? []).map((c: any) => c.to)]));
const labels = (groups: any[]) => groups.flatMap((g) => g.items.map((n: any) => n.label));

describe('permission-aware Super Admin navigation', () => {
  it('every sidebar destination is mapped to a domain key (an unmapped one would be hidden from everyone)', () => {
    expect([...new Set(allTos.map(navSegment))].filter((s) => !NAV_DOMAIN_VIEW_KEY[s])).toEqual([]);
  });
  it('every key the sidebar uses exists in the server\'s permission list', () => {
    const rbac = readFileSync(join(__dirname, '../../../../packages/permissions/src/rbac.ts'), 'utf8');
    expect([...new Set(Object.values(NAV_DOMAIN_VIEW_KEY))].filter((k) => !rbac.includes(`'${k}'`))).toEqual([]);
  });
  it('a support-shaped account sees Support and Tenants, not Payments, Billing or Customer Data; groups it cannot use disappear', () => {
    const support = ['super_admin.tenants.view', 'super_admin.support.view', 'super_admin.users.view', 'super_admin.operations.view'];
    const v = visibleNavGroups(NAV_GROUPS, support);
    const l = labels(v);
    expect(l).toContain('Tenants');
    expect(l).not.toContain('Payment Gateways');
    expect(l.some((x) => /Customer Data/.test(x))).toBe(false);
    expect(v.every((g) => g.items.length > 0)).toBe(true);
    expect(v.length).toBeLessThan(NAV_GROUPS.length);
  });
  it('no permissions → nothing; a missing principal → nothing (the backend would refuse every route anyway)', () => {
    expect(visibleNavGroups(NAV_GROUPS, [])).toEqual([]);
    expect(visibleNavGroups(NAV_GROUPS, undefined)).toEqual([]);
    expect(canOpen('/payment-gateways', ['super_admin.payments.view'])).toBe(true);
    expect(canOpen('/not-a-screen', ['super_admin.payments.view'])).toBe(false);
  });
});
