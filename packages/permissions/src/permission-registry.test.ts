// BUILD_PLAN Phase 9 — the permission metadata registry, the plane helpers and the worker service principals.
import { describe, it, expect } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS } from './rbac';
import { hasPermission, PAYMENT_PERMISSION_ALIASES } from './security-core';
import {
  PERMISSION_REGISTRY, EXPLICIT_PERMISSION_METADATA, definitionOf, catalogKeyFor, derivedSensitivity, isHighRiskPermission,
  requiresStepUp, rolesHolding, splitKey, realmOf, labelOf,
} from './permission-registry';
import { POS_ROUTE_KEY_ALIASES } from './permission-aliases.generated';
import { isPlatformPrincipal, isStaffPrincipal, hasTenantWideScope } from './principal';
import { WORKER_GRANTS, workerPrincipal, invalidWorkerGrant, isWorkerPrincipal } from './worker-principals';
import { isSystemContext } from '@aipowersalon/tenant-context';

describe('permission registry', () => {
  it('every catalog key has exactly one definition, in catalog order', () => {
    expect(PERMISSION_REGISTRY.map((d) => d.key)).toEqual([...PERMISSIONS]);
    for (const k of PERMISSIONS) expect(definitionOf(k)?.key).toBe(k);
  });

  it('every legacy pos.* route key the backend uses resolves to a catalog key (else the route denies everyone)', () => {
    const unresolved = POS_ROUTE_KEY_ALIASES.filter((a) => !catalogKeyFor(a));
    expect(unresolved).toEqual([]);
  });

  it('every resolvable alias is folded into exactly one definition', () => {
    const folded = PERMISSION_REGISTRY.flatMap((d) => d.deprecatedAliases);
    expect(new Set(folded).size).toBe(folded.length);
    for (const a of POS_ROUTE_KEY_ALIASES) if (!(PERMISSIONS as readonly string[]).includes(a)) expect(folded).toContain(a);
    expect(definitionOf('pos.checkout.refund')?.key).toBe('checkout.manage_overrides');
    expect(definitionOf('pos.checkout.refund')?.deprecatedAliases).toContain('pos.checkout.refund');
  });

  it('every tenant-side key the rules rate high or critical carries a REVIEWED explicit entry', () => {
    const missing = (PERMISSIONS as readonly string[])
      .filter((k) => realmOf(k) !== 'platform' && ['high', 'critical'].includes(derivedSensitivity(k)) && !EXPLICIT_PERMISSION_METADATA[k]);
    expect(missing).toEqual([]);
    for (const d of PERMISSION_REGISTRY.filter((x) => x.realm !== 'platform' && (x.sensitivity === 'high' || x.sensitivity === 'critical'))) {
      const x = EXPLICIT_PERMISSION_METADATA[d.key];
      expect(x, d.key).toBeTruthy();
      expect(x.description.length, d.key).toBeGreaterThan(15);
      expect(x.scopes.length, d.key).toBeGreaterThan(0);
    }
  });

  it('explicit entries name catalog keys only (no stale metadata)', () => {
    expect(Object.keys(EXPLICIT_PERMISSION_METADATA).filter((k) => !(PERMISSIONS as readonly string[]).includes(k))).toEqual([]);
  });

  it('the dangerous families are high or critical and need step-up where they change access or money', () => {
    for (const k of ['roles.manage', 'permissions.override', 'branch_access.manage', 'ownership.transfer', 'access_review.manage', 'approvals.manage_policies', 'checkout.approve_refund', 'payroll.manage', 'settings.edit', 'subscription.manage']) {
      expect(definitionOf(k)?.sensitivity, k).toBe('critical');
      expect(requiresStepUp(k), k).toBe(true);
    }
    for (const k of ['customers.export', 'reports.export', 'checkout.manage_overrides', 'payroll.view']) expect(isHighRiskPermission(k), k).toBe(true);
    expect(isHighRiskPermission('checkin.view')).toBe(false);
    expect(isHighRiskPermission('super_admin.billing.export')).toBe(false);   // the platform plane is not in a salon's report
  });

  it('derives domain / action / realm / scopes / label from the key', () => {
    expect(splitKey('inventory.purchase_order.approve')).toEqual({ domain: 'inventory.purchase_order', action: 'approve' });
    expect(splitKey('super_admin.billing.invoices.create')).toEqual({ domain: 'billing.invoices', action: 'create' });
    expect(realmOf('tech.earnings.view')).toBe('technician');
    expect(realmOf('owner.finance.view')).toBe('owner');
    expect(realmOf('super_admin.tenants.view')).toBe('platform');
    expect(definitionOf('tech.schedule.view')?.scopes).toEqual(['OWN']);
    expect(definitionOf('super_admin.tenants.view')?.scopes).toEqual(['PLATFORM']);   // Security Deep Scan §68: explicit platform scope
    expect(labelOf('customers.export')).toBe('Export customers');
  });

  it('rolesHolding reads the real grants', () => {
    expect(rolesHolding('customers.export').sort()).toEqual(['MANAGER', 'OWNER']);
    expect(rolesHolding('pos.login')).toContain('TECHNICIAN');
    expect(rolesHolding('ownership.transfer')).toEqual(['OWNER']);
  });
});

describe('plane helpers', () => {
  it('the planes are identities; everything else is a permission', () => {
    expect(isPlatformPrincipal({ role: 'SUPER_ADMIN' })).toBe(true);
    expect(isPlatformPrincipal('OWNER')).toBe(false);
    for (const r of ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN', 'owner']) expect(isStaffPrincipal(r), r).toBe(true);
    for (const r of ['CUSTOMER', 'CUSTOMER_DISPLAY', 'SUPER_ADMIN', 'customer']) expect(isStaffPrincipal(r as any), String(r)).toBe(false);
    expect(isStaffPrincipal({ role: '' })).toBe(true);   // an internal caller with no role passes, as the old FORBIDDEN_ROLES lists let it
    expect(isStaffPrincipal('SUPER_ADMIN', { allowPlatform: true })).toBe(true);
  });
  it('tenant-wide scope is the owner.branches.compare permission, not the OWNER role', () => {
    expect(hasTenantWideScope({ role: 'OWNER', permissions: [...ROLE_PERMISSIONS.OWNER] } as any)).toBe(true);
    expect(hasTenantWideScope({ role: 'OWNER', permissions: [] } as any)).toBe(false);   // an OWNER-role token with the key denied
    expect(hasTenantWideScope({ role: 'MANAGER', permissions: [...ROLE_PERMISSIONS.MANAGER] } as any)).toBe(false);
    expect(hasTenantWideScope({ role: 'MANAGER', permissions: ['owner.branches.compare'] } as any)).toBe(true);   // an ALLOW override
  });
});

describe('worker service principals', () => {
  it('every declared grant is a tenant catalog key (never super_admin.*)', () => {
    for (const [job, keys] of Object.entries(WORKER_GRANTS)) expect(invalidWorkerGrant(keys as readonly string[]), job).toEqual([]);
    expect(invalidWorkerGrant(['super_admin.tenants.view', 'no.such.key', 'customers.view'])).toEqual(['super_admin.tenants.view', 'no.such.key']);
  });
  it('a job acts as worker:<job> with only its keys', () => {
    const w = workerPrincipal('dormant-accounts', { tenantId: '00000000-0000-0000-0000-000000000001' });
    expect(w.actor).toBe('worker:dormant-accounts');
    expect(w.userId).toBe('system:worker:dormant-accounts');
    expect(isSystemContext(w)).toBe(true);
    expect(isWorkerPrincipal(w)).toBe(true);
    expect(hasPermission(w as any, 'security_reports.view')).toBe(true);
    expect(hasPermission(w as any, 'checkout.approve_refund')).toBe(false);
    expect(hasPermission(w as any, 'customers.export')).toBe(false);
  });
  it('an undeclared job is refused', () => {
    expect(() => workerPrincipal('nope' as any, { tenantId: 't' })).toThrow(/unknown job/);
  });
});

// Secure Tap to Pay mandate §44 / §45 (M6-6): the mandate's permission names are aliases of the catalog keys that already
// govern each action — one permission system, the role defaults unchanged.
describe('Tap to Pay mandate permission names (§44)', () => {
  const ctx = (role: string, permissions: string[]) => ({ tenantId: 't', branchId: 'b', userId: 'u', role, permissions } as any);
  it('every mandate name resolves to a catalog key and is listed as that key\'s alias', () => {
    for (const [alias, key] of Object.entries(PAYMENT_PERMISSION_ALIASES)) {
      expect(catalogKeyFor(alias), alias).toBe(key);
      expect(definitionOf(alias)?.key, alias).toBe(key);
      expect(definitionOf(key)?.deprecatedAliases, alias).toContain(alias);
    }
  });
  it('a check for the mandate name is a check for its catalog key', () => {
    expect(hasPermission(ctx('MANAGER', ['mobile_checkout.tap_to_pay']), 'payments.tap_to_pay')).toBe(true);
    expect(hasPermission(ctx('MANAGER', ['checkout.view']), 'payments.tap_to_pay')).toBe(false);
    expect(hasPermission(ctx('MANAGER', ['checkout.manage_overrides']), 'payments.refund')).toBe(true);
    expect(hasPermission(ctx('MANAGER', ['checkout.manage_overrides']), 'payments.void')).toBe(true);
    expect(hasPermission(ctx('OWNER', ['settings.edit']), 'payment_devices.revoke')).toBe(true);
  });
  it('§45 role defaults: a technician holds no Tap to Pay / refund / device management by default; front desk no refunds', () => {
    const tech = [...(ROLE_PERMISSIONS as any).TECHNICIAN ?? []] as string[];
    for (const k of ['payments.tap_to_pay', 'payments.refund', 'payments.void', 'payment_devices.approve', 'payment_devices.revoke']) expect(hasPermission(ctx('TECHNICIAN', tech), k), k).toBe(false);
    const fd = [...(ROLE_PERMISSIONS as any).FRONT_DESK ?? []] as string[];
    for (const k of ['payments.refund', 'payments.void', 'payment_devices.revoke']) expect(hasPermission(ctx('FRONT_DESK', fd), k), k).toBe(false);
  });
});
