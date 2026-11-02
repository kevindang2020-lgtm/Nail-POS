// Repository port for the Security & Compliance oversight aggregate. Reads real sources only; anything unmodelled is
// simply not queried (the service marks it an honest gap). In-memory returns empties/zeros.
export interface SecurityKpiTotals { twoFaEnabled: number; twoFaTotal: number; failedLogins7d: number; suspiciousSessions: number; privilegedAccounts: number; dataExportEvents7d: number; privacyRequestsOpen: number; activeSessions: number; backupSuccessRatePct: number | null }
export interface DayCount { day: string; count: number }
export interface AuthRow { userId: string; name: string; role: string; mfaEnabled: boolean; lastLogin: string | null; failedLogins: number; sessionStatus: string; privileged: boolean }
export interface SessionRow { userId: string; name: string; role: string; ip: string | null; device: string | null; status: string; lastActivity: string | null }
export interface PrivacyRow { requestType: string; events: number; status: string; requester: string | null; dueDate: string | null; owner: string | null }
export interface RoleRow { roleCategory: string; users: number; privileged: string }
export interface AlertRow { id: string; title: string; severity: string | null; status: string | null; tenant: string | null; createdAt: string | null }
export interface IncidentLogRow { incidentRef: string; tenant: string | null; severity: string; status: string; assignedTo: string | null; updatedAt: string | null }
export interface WorkflowStages { detected: number; investigating: number; contained: number; remediating: number; closed: number }
export interface BlockedIpRow { target: string; threatType: string | null; country: string | null; blockedAt: string | null; status: string }
export interface AuditRow { id: string; occurredAt: string | null; actorName: string | null; actorRole: string | null; module: string | null; action: string | null; status: string | null; severity: string | null; ip: string | null; tenant: string | null }

export interface SecurityRepositoryPort {
  kpiTotals(): Promise<SecurityKpiTotals>;
  failedLoginTrend7d(): Promise<DayCount[]>;
  authOverview(limit: number): Promise<AuthRow[]>;
  activeSessions(limit: number): Promise<SessionRow[]>;
  privacyRequests(limit: number): Promise<PrivacyRow[]>;
  roleRestrictions(): Promise<RoleRow[]>;
  recentAlerts(limit: number): Promise<AlertRow[]>;
  auditFeed(limit: number): Promise<AuditRow[]>;
  failedLoginsToday(): Promise<number>;
  sessionsRevokedToday(): Promise<number>;
  backupJobsCompletedToday(): Promise<{ completed: number; total: number }>;
  recentBlockedIps(limit: number): Promise<BlockedIpRow[]>;
  blockedIpsActive(): Promise<number>;
  blockedIpsToday(): Promise<number>;
  recentIncidents(limit: number): Promise<IncidentLogRow[]>;
  incidentWorkflow(): Promise<WorkflowStages>;
  incidentsOpen(): Promise<number>;
  incidentsOpenedToday(): Promise<number>;
  policyCompliance(): Promise<{ session: boolean | null; password: boolean | null; mfa: boolean | null }>;
  activePrivilegedGrants(): Promise<number>;
}

export class InMemorySecurityRepository implements SecurityRepositoryPort {
  async kpiTotals() { return { twoFaEnabled: 0, twoFaTotal: 0, failedLogins7d: 0, suspiciousSessions: 0, privilegedAccounts: 0, dataExportEvents7d: 0, privacyRequestsOpen: 0, activeSessions: 0, backupSuccessRatePct: null }; }
  async failedLoginTrend7d() { return []; }
  async authOverview() { return []; }
  async activeSessions() { return []; }
  async privacyRequests() { return []; }
  async roleRestrictions() { return []; }
  async recentAlerts() { return []; }
  async auditFeed() { return []; }
  async failedLoginsToday() { return 0; }
  async sessionsRevokedToday() { return 0; }
  async backupJobsCompletedToday() { return { completed: 0, total: 0 }; }
  async recentBlockedIps() { return []; }
  async blockedIpsActive() { return 0; }
  async blockedIpsToday() { return 0; }
  async recentIncidents() { return []; }
  async incidentWorkflow() { return { detected: 0, investigating: 0, contained: 0, remediating: 0, closed: 0 }; }
  async incidentsOpen() { return 0; }
  async incidentsOpenedToday() { return 0; }
  async policyCompliance() { return { session: null, password: null, mfa: null }; }
  async activePrivilegedGrants() { return 0; }
}
