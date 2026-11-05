import { describe, it, expect } from 'vitest';
import { buildPermissionMatrix, TEAM_ROLES } from './team-permissions.dto';

describe('team-permissions — matrix (pure, from rbac)', () => {
  const m = buildPermissionMatrix();
  it('exposes the five team roles with per-role counts', () => {
    expect(m.roles).toEqual(TEAM_ROLES);
    expect(m.roleSummaries).toHaveLength(5);
    const owner = m.roleSummaries.find((r) => r.role === 'OWNER')!;
    const tech = m.roleSummaries.find((r) => r.role === 'TECHNICIAN')!;
    expect(owner.count).toBeGreaterThan(tech.count); // owner has the most
  });
  it('groups permissions by domain and records which roles hold each', () => {
    expect(m.groups.length).toBeGreaterThan(3);
    const flat = m.groups.flatMap((g) => g.permissions);
    const checkoutView = flat.find((p) => p.key === 'checkout.view');
    expect(checkoutView).toBeTruthy();
    expect(checkoutView!.roles).toContain('OWNER');           // owner can view checkout
  });
  it('omits permissions no team role holds (e.g. super_admin.*)', () => {
    const flat = buildPermissionMatrix().groups.flatMap((g) => g.permissions.map((p) => p.key));
    expect(flat.some((k) => k.startsWith('super_admin.'))).toBe(false);
    expect(flat.every((k) => k.length > 0)).toBe(true);
  });
});
