import { describe, it, expect } from 'vitest';
import { contextFromSession, branchOrNull, systemContext, isSystemContext, SYSTEM_ROLE } from './context';

describe('@aipowersalon/tenant-context', () => {
  it('contextFromSession: the one derivation — missing tenant/branch become "", permissions default to none, sid is kept', () => {
    const c = contextFromSession({ userId: 'u1', role: 'OWNER', tenantId: 't1', branchId: null, sid: 's1' });
    expect(c).toEqual({ tenantId: 't1', branchId: '', userId: 'u1', role: 'OWNER', permissions: [], sessionId: 's1', restriction: null });
    expect(contextFromSession({ userId: 'sa', role: 'SUPER_ADMIN' }).tenantId).toBe('');
  });
  it('systemContext: one shape for every job; the actor is required and names the system user', () => {
    const c = systemContext({ tenantId: 't1', actor: 'reminders' });
    expect(c).toEqual({ tenantId: 't1', branchId: '', userId: 'system:reminders', role: SYSTEM_ROLE, permissions: [], actor: 'reminders' });
    expect(() => systemContext({ tenantId: 't1', actor: ' ' })).toThrow(/actor is required/);
    expect(isSystemContext(c)).toBe(true);
    expect(isSystemContext({ role: 'OWNER' })).toBe(false);
  });
  it('permissions are copied, never shared with the caller (§74: no shared mutable context)', () => {
    const perms = ['a']; const c = systemContext({ tenantId: 't', actor: 'x', permissions: perms }); perms.push('b');
    expect(c.permissions).toEqual(['a']);
  });
  it('branchOrNull: a UUID stays, "" / garbage / undefined become null (never written into a UUID column)', () => {
    expect(branchOrNull('22222222-2222-2222-2222-222222222222')).toBe('22222222-2222-2222-2222-222222222222');
    expect(branchOrNull('')).toBeNull();
    expect(branchOrNull('  ')).toBeNull();
    expect(branchOrNull(undefined)).toBeNull();
    expect(branchOrNull(null)).toBeNull();
    expect(branchOrNull('main')).toBeNull();
  });
});
