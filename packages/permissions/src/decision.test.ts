// decision.test.ts — BUILD_PLAN Phase 9: the decision object, every reason code, the order, and the policy handlers.
import { describe, it, expect } from 'vitest';
import { decide, effectivePermissions, overrideActive, type AuthzPrincipal } from './decision';
import { policy, sameBranch, ownRecord, requesterNotApprover, amountWithinLimit, runPolicies } from './policies';
import { hasPermission } from './security-core';
import { permissionsFor } from './rbac';

const T = 't1'; const B1 = 'b1'; const B2 = 'b2';
const NOW = Date.parse('2026-10-08T12:00:00Z');
const mgr = (over: Partial<AuthzPrincipal> = {}): AuthzPrincipal => ({ userId: 'u-m', tenantId: T, branchId: B1, role: 'MANAGER', permissions: permissionsFor('MANAGER'), ...over });

describe('decide — reason codes', () => {
  it('granted_by_role / granted_by_template', () => {
    expect(decide(mgr(), 'reports.view')).toMatchObject({ allowed: true, reason: 'granted_by_role', key: 'reports.view' });
    expect(decide(mgr({ templateKey: 'ACCOUNTANT' }), 'reports.view').reason).toBe('granted_by_template');
    // a granular pos.* key resolves through the coarse capability
    expect(decide(mgr(), 'pos.reports.view').allowed).toBe(true);
  });
  it('missing_permission', () => {
    expect(decide(mgr({ permissions: ['pos.login'] }), 'reports.view')).toMatchObject({ allowed: false, reason: 'missing_permission' });
  });
  it('account_inactive comes first — even an owner with everything', () => {
    expect(decide({ ...mgr(), role: 'OWNER', permissions: permissionsFor('OWNER'), status: 'suspended' }, 'pos.login').reason).toBe('account_inactive');
    expect(decide(mgr({ status: 'active' }), 'pos.login').allowed).toBe(true);
  });
  it('realm: platform keys never reach a salon principal; a platform principal holds no salon key', () => {
    expect(decide({ ...mgr(), role: 'OWNER', permissions: permissionsFor('OWNER') }, 'super_admin.users.view').reason).toBe('platform_key_for_tenant');
    const sa: AuthzPrincipal = { userId: 'sa', tenantId: null, role: 'SUPER_ADMIN', permissions: ['super_admin.users.view'] };
    expect(decide(sa, 'reports.view').reason).toBe('tenant_key_for_platform');
    expect(decide(sa, 'super_admin.users.view')).toMatchObject({ allowed: true, reason: 'granted_by_role' });
    expect(decide(sa, 'super_admin.system.manage').reason).toBe('missing_permission');
    // an ALLOW override for a platform key is ignored: the realm check runs first
    expect(decide(mgr({ overrides: [{ permission: 'super_admin.users.view', effect: 'ALLOW' }] }), 'super_admin.users.view').reason).toBe('platform_key_for_tenant');
  });
  it('denied_by_override beats the role, also for the granular key mapped onto the denied capability', () => {
    const p = mgr({ overrides: [{ id: 'o1', permission: 'reports.export', effect: 'DENY' }] });
    expect(decide(p, 'reports.export', null, { now: NOW })).toMatchObject({ allowed: false, reason: 'denied_by_override', detail: 'o1' });
    expect(decide(p, 'pos.reports.export', null, { now: NOW }).reason).toBe('denied_by_override');
    expect(decide(p, 'reports.view', null, { now: NOW }).allowed).toBe(true);
  });
  it('DENY wins over an ALLOW for the same key', () => {
    const p = mgr({ permissions: ['pos.login'], overrides: [{ permission: 'reports.view', effect: 'ALLOW' }, { permission: 'reports.view', effect: 'DENY' }] });
    expect(decide(p, 'reports.view', null, { now: NOW }).reason).toBe('denied_by_override');
  });
  it('a branch-bound DENY applies only in that branch', () => {
    const p = mgr({ overrides: [{ permission: 'reports.view', effect: 'DENY', branchId: B2 }] });
    expect(decide(p, 'reports.view', null, { now: NOW }).allowed).toBe(true);                       // acting in B1
    expect(decide(p, 'reports.view', { tenantId: T, branchId: B2 }, { now: NOW }).reason).toBe('denied_by_override');
  });
  it('granted_by_override / granted_temporarily; an expired or future or revoked ALLOW grants nothing', () => {
    const base = mgr({ permissions: ['pos.login'] });
    expect(decide({ ...base, overrides: [{ permission: 'reports.view', effect: 'ALLOW' }] }, 'reports.view', null, { now: NOW }).reason).toBe('granted_by_override');
    expect(decide({ ...base, overrides: [{ permission: 'reports.view', effect: 'ALLOW', expiresAt: NOW + 60_000 }] }, 'reports.view', null, { now: NOW }).reason).toBe('granted_temporarily');
    expect(decide({ ...base, overrides: [{ permission: 'reports.view', effect: 'ALLOW', expiresAt: NOW - 1 }] }, 'reports.view', null, { now: NOW }).reason).toBe('missing_permission');
    expect(decide({ ...base, overrides: [{ permission: 'reports.view', effect: 'ALLOW', expiresAt: NOW }] }, 'reports.view', null, { now: NOW }).allowed).toBe(false);   // expiry is exclusive
    expect(decide({ ...base, overrides: [{ permission: 'reports.view', effect: 'ALLOW', startsAt: NOW + 1 }] }, 'reports.view', null, { now: NOW }).allowed).toBe(false);
    expect(decide({ ...base, overrides: [{ permission: 'reports.view', effect: 'ALLOW', revokedAt: NOW - 5 }] }, 'reports.view', null, { now: NOW }).allowed).toBe(false);
  });
  it('out_of_branch_scope: BRANCH / SELECTED_BRANCHES confined to their branches; TENANT goes anywhere; another salon never', () => {
    expect(decide(mgr({ scope: 'BRANCH', branchIds: [B1] }), 'reports.view', { tenantId: T, branchId: B2 }).reason).toBe('out_of_branch_scope');
    expect(decide(mgr({ scope: 'SELECTED_BRANCHES', branchIds: [B1, B2] }), 'reports.view', { tenantId: T, branchId: B2 }).allowed).toBe(true);
    expect(decide(mgr({ scope: 'TENANT', branchIds: null }), 'reports.view', { tenantId: T, branchId: B2 }).allowed).toBe(true);
    expect(decide(mgr({ scope: 'BRANCH', branchIds: [B1] }), 'reports.view', { tenantId: T, branchId: null }).allowed).toBe(true);   // a tenant-wide record
    expect(decide(mgr({ scope: 'TENANT' }), 'reports.view', { tenantId: 't-other', branchId: B1 })).toMatchObject({ allowed: false, reason: 'out_of_branch_scope', detail: 'other_tenant' });
  });
  it('out_of_own_scope: an OWN-scoped technician acts on their own records only', () => {
    const tech: AuthzPrincipal = { userId: 'u-t', tenantId: T, branchId: B1, role: 'TECHNICIAN', permissions: permissionsFor('TECHNICIAN'), scope: 'OWN' };
    expect(decide(tech, 'serving.manage', { tenantId: T, ownerUserId: 'someone-else' }).reason).toBe('out_of_own_scope');
    expect(decide(tech, 'serving.manage', { tenantId: T, ownerUserId: 'u-t' }).allowed).toBe(true);
  });
  it('policy_denied: requester-not-approver and amount-within-limit, after the grant', () => {
    const p = mgr();
    expect(decide(p, 'approvals.decide', null, { policies: [policy('requester-not-approver', { requestedByUserId: 'u-m' })] })).toMatchObject({ allowed: false, reason: 'policy_denied', detail: 'requester-not-approver:requester_cannot_approve' });
    expect(decide(p, 'approvals.decide', null, { policies: [policy('requester-not-approver', { requestedByUserId: 'u-x' }), policy('amount-within-limit', { amountCents: 25_001, limitCents: 25_000 })] }).detail).toBe('amount-within-limit:over_your_limit');
    expect(decide(p, 'approvals.decide', null, { policies: [policy('amount-within-limit', { amountCents: 25_000, limitCents: 25_000 })] }).allowed).toBe(true);
    // a policy never GRANTS: missing permission is reported before any policy runs
    expect(decide(mgr({ permissions: [] }), 'approvals.decide', null, { policies: [policy('own-record', { ownerUserId: 'u-m' })] }).reason).toBe('missing_permission');
  });
});

describe('policy handlers', () => {
  const p = { userId: 'u1', branchId: B1, branchIds: [B1] };
  it('same-branch', () => {
    expect(sameBranch(p, { branchId: B1 }).ok).toBe(true);
    expect(sameBranch(p, { branchId: null }).ok).toBe(true);
    expect(sameBranch(p, { branchId: B2 })).toEqual({ ok: false, detail: 'record_in_other_branch' });
    expect(sameBranch({ userId: 'u1', branchIds: null }, { branchId: B2 }).ok).toBe(true);
  });
  it('own-record fails closed on an unknown owner', () => {
    expect(ownRecord(p, { ownerUserId: 'u1' }).ok).toBe(true);
    expect(ownRecord(p, { ownerUserId: 'u2' }).ok).toBe(false);
    expect(ownRecord(p, { ownerUserId: null }).ok).toBe(false);
  });
  it('requester-not-approver fails closed on an unknown requester', () => {
    expect(requesterNotApprover(p, { requestedByUserId: 'u2' }).ok).toBe(true);
    expect(requesterNotApprover(p, { requestedByUserId: 'u1' })).toEqual({ ok: false, detail: 'requester_cannot_approve' });
    expect(requesterNotApprover(p, { requestedByUserId: undefined }).ok).toBe(false);
  });
  it('amount-within-limit: null limit = none; bad amounts refused', () => {
    expect(amountWithinLimit(p, { amountCents: 10, limitCents: null }).ok).toBe(true);
    expect(amountWithinLimit(p, { amountCents: 10.5, limitCents: 100 }).ok).toBe(false);
    expect(amountWithinLimit(p, { amountCents: -1, limitCents: 100 }).ok).toBe(false);
    expect(amountWithinLimit(p, { amountCents: 101, limitCents: 100 }).ok).toBe(false);
  });
  it('runPolicies: first failure wins', () => {
    expect(runPolicies(p, [policy('own-record', { ownerUserId: 'u1' }), policy('same-branch', { branchId: B2 }), policy('own-record', { ownerUserId: 'x' })])).toEqual({ ok: false, name: 'same-branch', detail: 'record_in_other_branch' });
  });
});

describe('effectivePermissions + the hasPermission façade', () => {
  it('grant + live ALLOW − live DENY, per branch; platform keys never folded in', () => {
    const e = effectivePermissions({ role: 'FRONT_DESK', permissions: ['pos.login', 'checkout.view'], overrides: [
      { permission: 'reports.view', effect: 'ALLOW', expiresAt: NOW + 1000 },
      { permission: 'checkout.view', effect: 'DENY', branchId: B2 },
      { permission: 'customers.export', effect: 'ALLOW', expiresAt: NOW - 1 },
      { permission: 'super_admin.users.view', effect: 'ALLOW' },
    ] }, B1, NOW);
    expect(e).toEqual(['checkout.view', 'pos.login', 'reports.view']);
    expect(effectivePermissions({ role: 'FRONT_DESK', permissions: ['pos.login', 'checkout.view'], overrides: [{ permission: 'checkout.view', effect: 'DENY', branchId: B2 }] }, B2, NOW)).toEqual(['pos.login']);
  });
  it('hasPermission answers exactly what decide answers (no OWNER shortcut, SUPER_ADMIN realm split)', () => {
    const ctx = { tenantId: T, branchId: B1, userId: 'u', role: 'FRONT_DESK' as const, permissions: permissionsFor('FRONT_DESK') };
    for (const k of ['checkout.view', 'pos.checkout.take_payment', 'reports.export', 'super_admin.users.view', 'pos.customers.export']) {
      expect(hasPermission(ctx, k)).toBe(decide({ ...ctx }, k).allowed);
    }
    expect(hasPermission({ ...ctx, role: 'SUPER_ADMIN', permissions: ['super_admin.users.view'] }, 'checkout.view')).toBe(false);
  });
  it('overrideActive', () => {
    expect(overrideActive({ permission: 'x', effect: 'ALLOW', expiresAt: '2026-10-08T12:00:01Z' }, NOW)).toBe(true);
    expect(overrideActive({ permission: 'x', effect: 'ALLOW', expiresAt: 'not a date' }, NOW)).toBe(true);   // unparseable = no expiry recorded
  });
});

describe('Security Deep Scan §68: ASSIGNED scope', () => {
  const tech = { userId: 'u-tech', tenantId: 't1', role: 'TECHNICIAN', permissions: ['tech.tickets.view'], scope: 'ASSIGNED' as const };
  it('a record assigned to the principal is allowed; one assigned to someone else is refused out_of_assigned_scope', () => {
    expect(decide(tech, 'tech.tickets.view', { tenantId: 't1', assignedUserIds: ['u-tech', 'u-other'] }).allowed).toBe(true);
    const d = decide(tech, 'tech.tickets.view', { tenantId: 't1', assignedUserIds: ['u-other'] });
    expect(d).toMatchObject({ allowed: false, reason: 'out_of_assigned_scope', scope: 'ASSIGNED' });
  });
  it('the owner of a record counts as assigned; a record naming neither is not decided by scope', () => {
    expect(decide(tech, 'tech.tickets.view', { tenantId: 't1', ownerUserId: 'u-tech' }).allowed).toBe(true);
    expect(decide(tech, 'tech.tickets.view', { tenantId: 't1', ownerUserId: 'u-other' }).reason).toBe('out_of_assigned_scope');
    expect(decide(tech, 'tech.tickets.view', { tenantId: 't1' }).allowed).toBe(true);
  });
  it('the tenant check still runs first', () => {
    expect(decide(tech, 'tech.tickets.view', { tenantId: 't2', assignedUserIds: ['u-tech'] }).reason).toBe('out_of_branch_scope');
  });
});
