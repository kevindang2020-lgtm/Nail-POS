// Constitution 7 §5–§7, §25, §281 — platform role matrix invariants.
import { describe, it, expect } from 'vitest';
import { PERMISSIONS, platformPermissionsFor, permissionsFor, hasPermission } from './index';
import { PLATFORM_ROLES, PLATFORM_DOMAINS, PLATFORM_DOMAIN_NEW_KEYS, SUPER_ADMIN_ONLY_KEYS, platformDomainKeyFor, platformPathKey } from './platform-roles';

const ALL = PERMISSIONS.filter((k) => k.startsWith('super_admin.')) as string[];

describe('platform roles (§5)', () => {
  it('PLATFORM_SUPER_ADMIN holds exactly what a SUPER_ADMIN holds today — nobody is locked out', () => {
    expect([...platformPermissionsFor('PLATFORM_SUPER_ADMIN')].sort()).toEqual([...permissionsFor('SUPER_ADMIN')].sort());
  });
  it('every role is a subset of the platform keys, and only the top role holds the super-admin-only keys', () => {
    for (const r of PLATFORM_ROLES) {
      const keys = platformPermissionsFor(r) as string[];
      expect(keys.every((k) => ALL.includes(k)), r).toBe(true);
      if (r !== 'PLATFORM_SUPER_ADMIN') for (const k of SUPER_ADMIN_ONLY_KEYS) expect(keys, `${r} must not hold ${k}`).not.toContain(k);
    }
  });
  it('no role but the top one can change platform roles (§25 self-escalation)', () => {
    const holders = PLATFORM_ROLES.filter((r) => (platformPermissionsFor(r) as string[]).includes('super_admin.platform_roles.manage'));
    expect(holders).toEqual(['PLATFORM_SUPER_ADMIN']);
  });
  it('PLATFORM_AUDITOR is read-only: every key it holds is a view key, and none is view_sensitive', () => {
    const keys = platformPermissionsFor('PLATFORM_AUDITOR') as string[];
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.filter((k) => !k.endsWith('.view'))).toEqual([]);
    expect(keys.filter((k) => k.endsWith('view_sensitive'))).toEqual([]);
  });
  it('least privilege spot checks: support cannot move money, finance cannot change security, AI admin cannot touch billing', () => {
    expect(platformPermissionsFor('PLATFORM_SUPPORT')).not.toContain(PLATFORM_DOMAINS.billing.manage);
    expect(platformPermissionsFor('PLATFORM_SUPPORT')).not.toContain(PLATFORM_DOMAINS.payments.manage);
    expect(platformPermissionsFor('PLATFORM_SUPPORT')).not.toContain(PLATFORM_DOMAINS.customers.view);   // customer data goes through Support Mode
    expect(platformPermissionsFor('PLATFORM_FINANCE')).toContain(PLATFORM_DOMAINS.payments.manage);
    expect(platformPermissionsFor('PLATFORM_FINANCE')).not.toContain(PLATFORM_DOMAINS.security.view);
    expect(platformPermissionsFor('PLATFORM_AI_ADMIN')).toContain(PLATFORM_DOMAINS.ai.manage);
    expect(platformPermissionsFor('PLATFORM_AI_ADMIN')).not.toContain(PLATFORM_DOMAINS.billing.view);
  });
  it('an unknown or missing platform role resolves to READ-ONLY, never to everything (fail safe)', () => {
    expect(platformPermissionsFor(null)).toEqual(platformPermissionsFor('PLATFORM_AUDITOR'));
    expect(platformPermissionsFor('ROOT' as any)).toEqual(platformPermissionsFor('PLATFORM_AUDITOR'));
  });
  it('the new domain keys are all in the Permission list (so SUPER_ADMIN holds them) and none duplicates an existing key', () => {
    for (const k of PLATFORM_DOMAIN_NEW_KEYS) expect(ALL, k).toContain(k);
    expect(new Set(PLATFORM_DOMAIN_NEW_KEYS).size).toBe(PLATFORM_DOMAIN_NEW_KEYS.length);
  });
});

describe('in-plane default deny (§7)', () => {
  it('derives read vs manage from the method, and the domain from the path (two segments under /platform)', () => {
    expect(platformPathKey('/super-admin/platform/users/:id')).toBe('platform/users');
    expect(platformDomainKeyFor('/super-admin/billing/invoices', 'GET')).toBe(PLATFORM_DOMAINS.billing.view);
    expect(platformDomainKeyFor('/super-admin/billing/invoices', 'POST')).toBe(PLATFORM_DOMAINS.billing.manage);
    expect(platformDomainKeyFor('/super-admin/platform/users/:id/role', 'PATCH')).toBe(PLATFORM_DOMAINS.users.manage);
    expect(platformDomainKeyFor('/pos/checkout', 'GET')).toBeNull();                               // not a platform path
    expect(platformDomainKeyFor('/super-admin/not-a-real-area/x', 'GET')).toBeNull();              // unclassified → the guard denies
  });
  it('the admin app\'s live stream is classified with System Status (it was unclassified → 403 for every Super Admin)', () => {
    expect(platformDomainKeyFor('/super-admin/stream', 'GET')).toBe(PLATFORM_DOMAINS.system.view);
  });
  it('D7 (Oct 22 2026): ticket oversight is operations, gift-card settlement is finance; the old support grant still removes tickets', () => {
    // POS Ticket Oversight: operations read it; the removal flow is its own key held by SUPPORT (as before) and OPERATIONS
    expect(platformDomainKeyFor('/super-admin/tickets', 'GET')).toBe(PLATFORM_DOMAINS.operations.view);
    expect(platformDomainKeyFor('/super-admin/tickets/abc/history', 'GET')).toBe(PLATFORM_DOMAINS.operations.view);
    for (const r of ['PLATFORM_SUPPORT', 'PLATFORM_OPERATIONS', 'PLATFORM_ADMIN', 'PLATFORM_SUPER_ADMIN'] as const) {
      expect(platformPermissionsFor(r), r).toContain('super_admin.tickets.remove');
      expect(platformPermissionsFor(r), r).toContain(PLATFORM_DOMAINS.operations.view);
    }
    expect(platformPermissionsFor('PLATFORM_FINANCE')).not.toContain('super_admin.tickets.remove');
    expect(platformPermissionsFor('PLATFORM_AUDITOR')).not.toContain('super_admin.tickets.remove');
    // gift cards: programs stay marketing, settlement is payments (finance holds payments.*; marketing has no role)
    expect(platformPathKey('/super-admin/gift-cards/settlement/batches/1')).toBe('gift-cards/settlement');
    expect(platformDomainKeyFor('/super-admin/gift-cards/settlement', 'GET')).toBe(PLATFORM_DOMAINS.payments.view);
    expect(platformDomainKeyFor('/super-admin/gift-cards/settlement/batches', 'POST')).toBe(PLATFORM_DOMAINS.payments.manage);
    expect(platformDomainKeyFor('/super-admin/gift-cards/programs', 'GET')).toBe(PLATFORM_DOMAINS.marketing.view);
    const finance: any = { role: 'SUPER_ADMIN', permissions: platformPermissionsFor('PLATFORM_FINANCE') };
    expect(hasPermission(finance, platformDomainKeyFor('/super-admin/gift-cards/settlement/batches', 'POST')!)).toBe(true);
    expect(hasPermission(finance, platformDomainKeyFor('/super-admin/gift-cards/programs', 'POST')!)).toBe(false);
    // an unknown gift-cards sub-surface is unclassified → denied, never silently marketing
    expect(platformDomainKeyFor('/super-admin/gift-cards/other', 'GET')).toBeNull();
  });
  it('a SUPPORT identity passes a support read and is refused a billing write', () => {
    const ctx: any = { role: 'SUPER_ADMIN', permissions: platformPermissionsFor('PLATFORM_SUPPORT') };
    expect(hasPermission(ctx, platformDomainKeyFor('/super-admin/support/tickets', 'GET')!)).toBe(true);
    expect(hasPermission(ctx, platformDomainKeyFor('/super-admin/billing/credits', 'POST')!)).toBe(false);
  });
});
