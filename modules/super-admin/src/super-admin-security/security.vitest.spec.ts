import { describe, it, expect, vi } from 'vitest';
import { SecurityService } from './security.service';

function harness() {
  const repo = {
    kpiTotals: vi.fn(async () => ({ twoFaEnabled: 423, twoFaTotal: 512, failedLogins7d: 186, suspiciousSessions: 24, privilegedAccounts: 38, dataExportEvents7d: 56, privacyRequestsOpen: 14, activeSessions: 61, backupSuccessRatePct: 99.2 })),
    failedLoginTrend7d: vi.fn(async () => [{ day: '2026-05-05', count: 58 }, { day: '2026-05-06', count: 86 }]),
    authOverview: vi.fn(async () => [{ userId: 'u1', name: 'Jessica Miller', role: 'SUPER_ADMIN', mfaEnabled: true, lastLogin: '2026-05-06T02:10:00Z', failedLogins: 0, sessionStatus: 'active', privileged: true }, { userId: 'u2', name: 'Isabella Davis', role: 'FRONT_DESK', mfaEnabled: true, lastLogin: null, failedLogins: 6, sessionStatus: 'suspicious', privileged: false }]),
    activeSessions: vi.fn(async () => [{ userId: 'u1', name: 'Jessica Miller', role: 'SUPER_ADMIN', ip: '192.168.1.22', device: 'Chrome / Win', status: 'active', lastActivity: '2026-05-06T02:10:00Z' }]),
    privacyRequests: vi.fn(async () => [{ requestType: 'data_access_request', events: 6, status: 'in_progress', requester: 'Ava Garcia', dueDate: '2026-05-16T00:00:00Z', owner: 'u9' }]),
    roleRestrictions: vi.fn(async () => [{ roleCategory: 'Super Admin', users: 6, privileged: 'Full Access' }]),
    recentAlerts: vi.fn(async () => [{ id: 'a1', title: 'Multiple failed logins detected', severity: 'high', status: 'new', tenant: 'VIP Nail Club', createdAt: '2026-05-06T02:12:00Z' }]),
    auditFeed: vi.fn(async () => [{ id: 'e1', occurredAt: '2026-05-06T02:00:00Z', actorName: 'Jessica Miller', actorRole: 'super_admin', module: 'auth', action: 'mfa_enforced', status: 'success', severity: 'info', ip: '10.0.0.5', tenant: 't1' }, { id: 'e2', occurredAt: '2026-05-06T01:00:00Z', actorName: 'X', actorRole: 'owner', module: 'billing', action: 'invoice_paid', status: 'success', severity: 'info', ip: '10.0.0.6', tenant: 't1' }]),
    failedLoginsToday: vi.fn(async () => 42),
    sessionsRevokedToday: vi.fn(async () => 15),
    backupJobsCompletedToday: vi.fn(async () => ({ completed: 1, total: 1 })),
    recentBlockedIps: vi.fn(async () => [{ target: '203.0.113.45', threatType: 'brute_force', country: 'US', blockedAt: '2026-05-06T02:00:00Z', status: 'blocked' }]),
    blockedIpsActive: vi.fn(async () => 3),
    blockedIpsToday: vi.fn(async () => 3),
    recentIncidents: vi.fn(async () => [{ incidentRef: 'INC-2026-054', tenant: 't1', severity: 'high', status: 'investigating', assignedTo: 'u9', updatedAt: '2026-05-06T02:20:00Z' }]),
    incidentWorkflow: vi.fn(async () => ({ detected: 3, investigating: 2, contained: 1, remediating: 1, closed: 15 })),
    incidentsOpen: vi.fn(async () => 7),
    incidentsOpenedToday: vi.fn(async () => 2),
    policyCompliance: vi.fn(async () => ({ session: true, password: true, mfa: true })),
    activePrivilegedGrants: vi.fn(async () => 4),
  };
  return { svc: new SecurityService(repo as any) };
}

describe('SecurityService.overview', () => {
  it('resolves the real KPIs and keeps the six unmodelled ones honest gaps', async () => {
    const o = await (harness().svc.overview());
    expect(o.kpis.twoFaEnabledUsers).toMatchObject({ value: 423, available: true });
    expect(o.kpis.failedLoginActivity).toMatchObject({ value: 186, available: true, deltaTone: 'bad' });
    expect(o.kpis.privilegedAccounts.deltaTone).toBe('review');
    expect(o.kpis.backupStatus).toMatchObject({ value: '99.2%', available: true });
    expect(o.kpis.securityIncidents).toMatchObject({ value: 7, available: true });
    expect(o.kpis.sessionPolicyStatus).toMatchObject({ value: 'Compliant', available: true });
    expect(o.kpis.passwordPolicyStatus).toMatchObject({ value: 'Compliant', available: true });
    expect((o as any).activePrivilegedGrants).toBe(4);
    for (const g of ['complianceStatus', 'encryptionStatus'] as const) {
      expect(o.kpis[g].available).toBe(false);
    }
  });

  it('masks IPs everywhere and only surfaces security-relevant audit rows', async () => {
    const o = await (harness().svc.overview());
    expect(o.activeSessions[0].ip).toBe('192.168.1.xxx');
    expect(o.activeSessions[0].location).toMatch(/Approx/);
    expect(o.auditFeed).toHaveLength(1); // billing row filtered out
    expect(o.auditFeed[0]).toMatchObject({ module: 'Auth', action: 'Mfa Enforced', ip: '10.0.0.xxx' });
  });

  it('maps auth overview with risk levels and gaps the unmodelled panels', async () => {
    const o = await (harness().svc.overview());
    expect(o.authOverview[0]).toMatchObject({ name: 'Jessica Miller', mfaStatus: 'Enabled', privileged: true, riskLevel: 'Low' });
    expect(o.authOverview[1].riskLevel).toBe('High'); // 6 failed logins
    for (const g of ['suspiciousMix', 'complianceBreakdown', 'encryptionHealth', 'pciControls', 'backupRecovery'] as const) {
      expect((o as any)[g].available).toBe(false);
    }
    expect(o.atAGlance.failedLoginsToday).toMatchObject({ value: 42, available: true });
    expect(o.atAGlance.incidentsOpened).toMatchObject({ value: 2, available: true });
    expect((o as any).securityIncidents).toMatchObject({ available: true });
    expect((o as any).securityIncidents.rows[0]).toMatchObject({ incidentRef: 'INC-2026-054', severity: 'High' });
    expect((o as any).incidentWorkflow).toMatchObject({ available: true });
    expect((o as any).incidentWorkflow.stages.detected).toBe(3);
    expect(o.atAGlance.blockedIps).toMatchObject({ value: 3, available: true });
    expect((o as any).blockedIps).toMatchObject({ available: true, activeCount: 3 });
    expect((o as any).blockedIps.rows[0]).toMatchObject({ target: '203.0.113.45', threatType: 'Brute Force' });
  });
});
