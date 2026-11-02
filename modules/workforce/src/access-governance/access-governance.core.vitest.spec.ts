// BUILD_PLAN Phase 9 — access governance, the pure rules (high-risk via the decision object, dormant, decisions, denials).
import { describe, it, expect } from 'vitest';
import { permissionsFor } from '@aipowersalon/permissions';
import { highRiskGrants, HIGH_RISK_KEYS, dormantRows, dormantThreshold, dormantEpisodeKey, validateReviewDecision, denialMetrics, denialWindow } from './access-governance.core';

const T = 't1';
const NOW = Date.parse('2026-10-08T12:00:00Z');
const member = (role: string, over: Partial<Parameters<typeof highRiskGrants>[0]> = {}) => ({ userId: 'u-' + role, tenantId: T, role, status: 'active', templateKey: null, grant: permissionsFor(role as any), overrides: [], ...over });

describe('high-risk grants (decided like the guards)', () => {
  it('the list is the registry\'s tenant high / critical keys — no platform key', () => {
    expect(HIGH_RISK_KEYS).toContain('customers.export');
    expect(HIGH_RISK_KEYS).toContain('permissions.override');
    expect(HIGH_RISK_KEYS.some((k) => k.startsWith('super_admin.'))).toBe(false);
    expect(HIGH_RISK_KEYS).not.toContain('checkin.view');
  });
  it('an owner holds the critical ones by role; a technician holds none', () => {
    const o = highRiskGrants(member('OWNER'), NOW);
    expect(o.find((g) => g.key === 'ownership.transfer')).toMatchObject({ sensitivity: 'critical', via: 'granted_by_role' });
    expect(highRiskGrants(member('TECHNICIAN'), NOW).filter((g) => g.sensitivity === 'critical')).toEqual([]);
  });
  it('an ALLOW override shows up with its reason; a temporary one says so; an expired one does not', () => {
    const g = highRiskGrants(member('FRONT_DESK', { overrides: [
      { permission: 'customers.export', effect: 'ALLOW' },
      { permission: 'reports.export', effect: 'ALLOW', expiresAt: new Date(NOW + 3_600_000).toISOString() },
      { permission: 'payroll.view', effect: 'ALLOW', expiresAt: new Date(NOW - 1).toISOString() },
    ] }), NOW);
    expect(g.find((x) => x.key === 'customers.export')?.via).toBe('granted_by_override');
    expect(g.find((x) => x.key === 'reports.export')?.via).toBe('granted_temporarily');
    expect(g.find((x) => x.key === 'payroll.view')).toBeUndefined();
  });
  it('a DENY override removes a role grant; an inactive account holds nothing', () => {
    expect(highRiskGrants(member('MANAGER', { overrides: [{ permission: 'customers.export', effect: 'DENY' }] }), NOW).find((x) => x.key === 'customers.export')).toBeUndefined();
    expect(highRiskGrants(member('OWNER', { status: 'inactive' }), NOW)).toEqual([]);
  });
  it('a template narrows the grant (an accountant has payroll but no exports of customers)', () => {
    const g = highRiskGrants(member('MANAGER', { templateKey: 'ACCOUNTANT', grant: ['pos.login', 'payroll.view', 'reports.export'] }), NOW);
    expect(g.map((x) => x.key).sort()).toEqual(['payroll.view', 'reports.export']);
    expect(g[0].via).toBe('granted_by_template');
  });
});

describe('dormant accounts', () => {
  const day = 86_400_000;
  const u = (id: string, lastDaysAgo: number | null, status = 'active', createdDaysAgo = 400) => ({ userId: id, name: id, role: 'FRONT_DESK', status, lastLoginAt: lastDaysAgo === null ? null : new Date(NOW - lastDaysAgo * day).toISOString(), createdAt: new Date(NOW - createdDaysAgo * day).toISOString() });
  it('active, quiet for more than the threshold; never-signed-in counts from creation; inactive accounts are not dormant', () => {
    const rows = dormantRows([u('a', 10), u('b', 61), u('c', null), u('d', 200, 'inactive'), u('e', null, 'active', 5)], 60, NOW);
    expect(rows.map((r) => r.userId)).toEqual(['c', 'b']);
    expect(rows.find((r) => r.userId === 'b')?.daysSince).toBe(61);
    expect(rows.find((r) => r.userId === 'c')?.daysSince).toBeNull();
  });
  it('threshold clamps (default 60, 7..365)', () => {
    expect(dormantThreshold(undefined)).toBe(60); expect(dormantThreshold('3')).toBe(7); expect(dormantThreshold('9999')).toBe(365); expect(dormantThreshold('90')).toBe(90); expect(dormantThreshold('x')).toBe(60);
  });
  it('one alert per dormancy episode', () => {
    expect(dormantEpisodeKey(null)).toBe('never');
    expect(dormantEpisodeKey('2026-01-01T00:00:00Z')).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('review decisions', () => {
  it('validates the decision; change needs a template; revoke needs a note; never on yourself', () => {
    expect(validateReviewDecision({ userId: 'x', decision: 'keep' }, 'me')).toMatchObject({ ok: true });
    expect(validateReviewDecision({ userId: 'x', decision: 'nope' as any }, 'me')).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(validateReviewDecision({ userId: 'x', decision: 'change' }, 'me')).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(validateReviewDecision({ userId: 'x', decision: 'revoke' }, 'me')).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(validateReviewDecision({ userId: 'me', decision: 'revoke', note: 'left' }, 'me')).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(validateReviewDecision({ userId: 'me', decision: 'keep' }, 'me')).toMatchObject({ ok: true });
    expect(validateReviewDecision({ userId: 'x', decision: 'change', templateKey: 'RECEPTIONIST' }, 'me')).toMatchObject({ ok: true, value: { templateKey: 'RECEPTIONIST' } });
  });
});

describe('denial metrics', () => {
  it('sums by key, reason and person', () => {
    const m = denialMetrics([
      { permission: 'customers.export', reason: 'missing_permission', userId: 'u1', name: 'Ann', count: 3 },
      { permission: 'customers.export', reason: 'denied_by_override', userId: 'u2', name: 'Bob', count: 1 },
      { permission: 'reports.view', reason: 'missing_permission', userId: 'u1', name: 'Ann', count: 2 },
    ], 'f', 't');
    expect(m.total).toBe(6);
    expect(m.byKey[0]).toEqual({ key: 'customers.export', count: 4 });
    expect(m.byReason[0]).toEqual({ reason: 'missing_permission', count: 5 });
    expect(m.byUser[0]).toEqual({ userId: 'u1', name: 'Ann', count: 5 });
  });
  it('the window: default 7 days, from before to, at most 92 days', () => {
    expect(denialWindow(undefined, undefined, NOW)).toEqual({ from: new Date(NOW - 7 * 86_400_000).toISOString(), to: new Date(NOW).toISOString() });
    expect(denialWindow('2026-10-08', '2026-10-01', NOW)).toBeNull();
    expect(denialWindow('2026-01-01', '2026-10-01', NOW)).toBeNull();
    expect(denialWindow('garbage', undefined, NOW)).toBeNull();
  });
  it('a date-only "to" covers that whole day (found by the Phase 9 live proof: "to today" dropped today\'s denials)', () => {
    expect(denialWindow('2026-10-08', '2026-10-08', NOW)).toEqual({ from: '2026-10-08T00:00:00.000Z', to: '2026-10-08T23:59:59.999Z' });
    expect(denialWindow('2026-10-01', '2026-10-08T12:00:00Z', NOW)!.to).toBe('2026-10-08T12:00:00.000Z');
  });
});
