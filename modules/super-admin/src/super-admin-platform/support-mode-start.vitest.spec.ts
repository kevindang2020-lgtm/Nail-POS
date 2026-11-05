// Constitution 7 §74–§81 — starting a Support Mode session: reason, short duration, scope class, least privilege.
import { describe, it, expect } from 'vitest';
import { SuperAdminPlatformService, supportScopeFrom } from './super-admin-platform.service';
import { InMemorySuperAdminPlatformRepo } from './super-admin-platform.repository';

const support = { userId: 'u-support', email: 's@platform.test', permissions: ['super_admin.support.view', 'super_admin.support.manage', 'super_admin.tenants.view'] };
const admin = { ...support, userId: 'u-admin', permissions: [...support.permissions, 'super_admin.tenants.edit'] };
const svc = () => { const repo = new InMemorySuperAdminPlatformRepo(); return { repo, s: new SuperAdminPlatformService(repo) }; };
const ok = { tenantId: 't1', reason: 'customer cannot book online since noon', minutes: 30 };

describe('Support Mode start', () => {
  it('starts READ_ONLY by default — WITHOUT a password in the body (step-up is the route\'s, on the session)', async () => {
    const { s } = svc();
    const r: any = await s.startSupport(support as any, ok);
    expect(r.scope).toBe('READ_ONLY');
    expect(r.reason).toBe(ok.reason);
  });
  it('refuses a short reason and anything outside 15–60 minutes (§77: short, never long-lived)', async () => {
    const { s } = svc();
    await expect(s.startSupport(support as any, { ...ok, reason: 'booking' })).rejects.toThrow(/at least 10/);
    await expect(s.startSupport(support as any, { ...ok, minutes: 480 })).rejects.toThrow(/15–60/);
    await expect(s.startSupport(support as any, { ...ok, minutes: 5 })).rejects.toThrow(/15–60/);
  });
  it('§81/§76: ELEVATED_SUPPORT needs tenant-edit — a support-only account is refused, an admin is allowed', async () => {
    const { s } = svc();
    await expect(s.startSupport(support as any, { ...ok, scope: 'ELEVATED_SUPPORT' })).rejects.toThrow(/tenant-edit/);
    expect(((await s.startSupport(admin as any, { ...ok, scope: 'ELEVATED_SUPPORT' })) as any).scope).toBe('ELEVATED_SUPPORT');
  });
  it('maps the screen\'s earlier access levels onto the scope classes and refuses unknown ones', () => {
    expect(supportScopeFrom('read_only')).toBe('READ_ONLY');
    expect(supportScopeFrom('read_operational')).toBe('READ_ONLY');
    expect(supportScopeFrom('limited_support')).toBe('STANDARD_SUPPORT');
    expect(supportScopeFrom(undefined)).toBe('READ_ONLY');
    expect(supportScopeFrom('owner')).toBeNull();
  });
});
