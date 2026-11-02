// Security & Compliance oversight service — composes the dashboard from real auth/session/privacy/alert/audit/backup
// sources via security-core. Unmodelled modules (security incidents, IP blocks, threat signals, compliance/PCI controls,
// encryption health, DR, MFA/password/session policy records, incident workflow) render as honest gaps, never fabricated.
import type { SecurityRepositoryPort } from './security.repository';
import { assembleSecurityKpis, assembleFailedLoginTrend, maskIp, sessionStatusTone, isSecurityAuditModule } from './security-core';

const cap = (s: string | null) => (s ? s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : '—');

export class SecurityService {
  constructor(private readonly repo: SecurityRepositoryPort, private readonly posture?: { snapshot(): Promise<unknown> }) {}

  async overview() {
    const [totals, trend, auth, sessions, privacy, roles, alerts, audit, failedToday, revokedToday, backupToday, blockedIpRows, blockedActive, blockedToday, incidentRows, incidentStages, incidentsOpen, incidentsOpenedToday, policy, activeGrants] = await Promise.all([
      this.repo.kpiTotals(), this.repo.failedLoginTrend7d(), this.repo.authOverview(8), this.repo.activeSessions(8),
      this.repo.privacyRequests(6), this.repo.roleRestrictions(), this.repo.recentAlerts(7), this.repo.auditFeed(40),
      this.repo.failedLoginsToday(), this.repo.sessionsRevokedToday(), this.repo.backupJobsCompletedToday(),
      this.repo.recentBlockedIps(8), this.repo.blockedIpsActive(), this.repo.blockedIpsToday(),
      this.repo.recentIncidents(8), this.repo.incidentWorkflow(), this.repo.incidentsOpen(), this.repo.incidentsOpenedToday(),
      this.repo.policyCompliance(), this.repo.activePrivilegedGrants(),
    ]);

    const kpis = assembleSecurityKpis({
      twoFaEnabled: totals.twoFaEnabled, twoFaTotal: totals.twoFaTotal, failedLogins7d: totals.failedLogins7d,
      suspiciousSessions: totals.suspiciousSessions, privilegedAccounts: totals.privilegedAccounts, dataExportEvents7d: totals.dataExportEvents7d,
      privacyRequestsOpen: totals.privacyRequestsOpen, backupSuccessRatePct: totals.backupSuccessRatePct, securityIncidentsOpen: incidentsOpen, sessionPolicyCompliant: policy.session, passwordPolicyCompliant: policy.password,
      // honest gaps (no schema): securityIncidentsOpen, complianceScorePct, encryptionCoveragePct, session/password policy
    });

    return {
      kpis,
      failedLoginTrend: assembleFailedLoginTrend(trend),
      authOverview: auth.map((a) => ({ userId: a.userId, name: a.name, role: cap(a.role), mfaStatus: a.mfaEnabled ? 'Enabled' : 'Disabled', lastLogin: a.lastLogin, failedLogins: a.failedLogins, sessionStatus: a.sessionStatus === 'none' ? '—' : cap(a.sessionStatus), privileged: a.privileged, riskLevel: a.failedLogins >= 5 ? 'High' : a.failedLogins >= 2 ? 'Medium' : 'Low' })),
      activeSessions: sessions.map((s) => ({ user: s.name, ip: maskIp(s.ip), device: s.device ? s.device.slice(0, 32) : '—', location: 'Approx. (by IP)', role: cap(s.role), lastActivity: s.lastActivity, status: cap(s.status), tone: sessionStatusTone(s.status) })),
      privacyRequests: privacy.map((p) => ({ requestType: cap(p.requestType), events: p.events, status: cap(p.status), requester: p.requester || '—', dueDate: p.dueDate, owner: p.owner ? 'Assigned' : '—' })),
      roleRestrictions: roles,
      activePrivilegedGrants: activeGrants,
      recentAlerts: alerts.map((a) => ({ id: a.id, title: a.title, severity: a.severity ? cap(a.severity) : null, tenant: a.tenant, createdAt: a.createdAt })),
      auditFeed: audit.filter((r) => isSecurityAuditModule(r.module || '')).map((r) => ({ id: r.id, occurredAt: r.occurredAt, actor: r.actorName || '—', actorRole: r.actorRole ? cap(r.actorRole) : '', module: cap(r.module), action: cap(r.action), status: r.status ? cap(r.status) : '—', severity: r.severity ? cap(r.severity) : '—', ip: maskIp(r.ip), tenant: r.tenant })),
      atAGlance: {
        failedLoginsToday: { value: failedToday, available: true, deltaTone: 'bad' as const },
        incidentsOpened: { value: incidentsOpenedToday, available: true, deltaTone: 'bad' as const },
        privacyRequestsPending: { value: totals.privacyRequestsOpen, available: true, deltaTone: 'neutral' as const },
        sessionsRevoked: { value: revokedToday, available: true, deltaTone: 'neutral' as const },
        blockedIps: { value: blockedToday, available: true, deltaTone: 'neutral' as const },
        backupJobsCompleted: backupToday.total > 0 ? { value: backupToday.completed, available: true, completionPct: Math.round((backupToday.completed / backupToday.total) * 100) } : { value: null, available: false, note: 'No backup jobs today' },
      },
      blockedIps: blockedIpRows.length > 0 ? { available: true, rows: blockedIpRows.map((b) => ({ target: b.target, threatType: b.threatType ? b.threatType.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '—', country: b.country || '—', blockedAt: b.blockedAt, status: b.status })), activeCount: blockedActive } : { available: false, note: 'No IP blocks recorded yet' },
      // Honest gaps — no schema to source these from (to be built as real foundations)
      suspiciousMix: { available: false, note: 'No session risk-tier scoring schema' },
      complianceBreakdown: { available: false, note: 'No compliance-control schema' },
      // Constitution 12 §270: filled from key-ring / rotation / posture / security events — no longer a placeholder.
      encryptionHealth: this.posture ? await this.posture.snapshot().catch(() => ({ available: false, note: 'Security posture could not be read' })) : { available: false, note: 'No encryption-health schema' },
      securityIncidents: incidentRows.length > 0 ? { available: true, rows: incidentRows.map((i) => ({ incidentRef: i.incidentRef, severity: cap(i.severity), status: cap(i.status), assignedTo: i.assignedTo ? 'Assigned' : '—', updatedAt: i.updatedAt })) } : { available: false, note: 'No security incidents recorded yet' },
      incidentWorkflow: (incidentStages.detected + incidentStages.investigating + incidentStages.contained + incidentStages.remediating + incidentStages.closed) > 0 ? { available: true, stages: incidentStages } : { available: false, note: 'No security incidents recorded yet' },
      pciControls: { available: false, note: 'No PCI-control schema' },
      backupRecovery: { available: false, note: 'No verified backup/DR-plan schema (only raw backup requests)' },
      meta: { generatedAt: new Date().toISOString() },
    };
  }
}
