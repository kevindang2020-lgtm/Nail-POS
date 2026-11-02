import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockOverview, mockAuditRun, mockAuditRuns, mockAuditFindings } = vi.hoisted(() => ({ mockOverview: vi.fn(), mockAuditRun: vi.fn(), mockAuditRuns: vi.fn(), mockAuditFindings: vi.fn() }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { securityOverview: () => mockOverview(), securityLockdowns: () => Promise.resolve([]), securityAuditRun: () => mockAuditRun() ?? Promise.resolve({}), securityAuditRuns: () => mockAuditRuns() ?? Promise.resolve([]), securityAuditFindings: () => mockAuditFindings() ?? Promise.resolve([]) } }));

import { SecurityScreen } from './SecurityScreen';

const kreal = (value: number | string) => ({ value, available: true });
const kgap = (note: string) => ({ value: null, available: false, note });
const gap = (note: string) => ({ available: false as const, note });
const overview = {
  kpis: {
    twoFaEnabledUsers: { value: 423, available: true, note: '82.6% of 512' }, failedLoginActivity: { value: 186, available: true, deltaTone: 'bad', note: 'x' },
    suspiciousSessions: { value: 24, available: true, deltaTone: 'good', note: 'x' }, privilegedAccounts: { value: 38, available: true, deltaTone: 'review', note: 'x' },
    dataExportEvents: kreal(56), privacyRequests: kreal(14), securityIncidents: kreal(7), complianceStatus: kgap('No compliance-control schema'),
    encryptionStatus: kgap('No encryption-health schema'), backupStatus: kreal('99.2%'), sessionPolicyStatus: kreal('Compliant'), passwordPolicyStatus: kreal('Compliant'),
  },
  failedLoginTrend: [{ day: '2026-05-05', count: 58 }, { day: '2026-05-06', count: 86 }],
  authOverview: [{ userId: 'u1', name: 'Jessica Miller', role: 'Super Admin', mfaStatus: 'Enabled', lastLogin: '2026-05-06T02:10:00Z', failedLogins: 0, sessionStatus: 'Active', privileged: true, riskLevel: 'Low' }],
  activeSessions: [{ user: 'Jessica Miller', ip: '192.168.1.xxx', device: 'Chrome / Win', location: 'Approx. (by IP)', role: 'Super Admin', lastActivity: '2026-05-06T02:10:00Z', status: 'Active', tone: 'good' }],
  privacyRequests: [{ requestType: 'Data Access Request', events: 6, status: 'In Progress', requester: 'Ava Garcia', dueDate: '2026-05-16T00:00:00Z', owner: 'Assigned' }],
  roleRestrictions: [{ roleCategory: 'Super Admin', users: 6, privileged: 'Full Access' }],
  activePrivilegedGrants: 4,
  recentAlerts: [{ id: 'a1', title: 'Multiple failed logins detected', severity: 'High', tenant: 'VIP Nail Club', createdAt: '2026-05-06T02:12:00Z' }],
  auditFeed: [{ id: 'e1', occurredAt: '2026-05-06T02:00:00Z', actor: 'Jessica Miller', actorRole: 'Super Admin', module: 'Auth', action: 'Mfa Enforced', status: 'Success', severity: 'Info', ip: '10.0.0.xxx', tenant: 't1' }],
  atAGlance: {
    failedLoginsToday: { value: 42, available: true, deltaTone: 'bad' }, incidentsOpened: { value: 2, available: true }, privacyRequestsPending: { value: 14, available: true },
    sessionsRevoked: { value: 15, available: true }, blockedIps: { value: 3, available: true }, backupJobsCompleted: { value: 1, available: true, completionPct: 100 },
  },
  suspiciousMix: gap('No session risk-tier scoring schema'), complianceBreakdown: gap('No compliance-control schema'), encryptionHealth: gap('No encryption-health schema'),
  securityIncidents: { available: true, rows: [{ incidentRef: 'INC-2026-054', severity: 'High', status: 'Investigating', assignedTo: 'Assigned', updatedAt: '2026-05-06T02:20:00Z' }] }, blockedIps: { available: true, activeCount: 3, rows: [{ target: '203.0.113.45', threatType: 'Brute Force', country: 'US', blockedAt: '2026-05-06T02:00:00Z', status: 'blocked' }] }, pciControls: gap('No PCI-control schema'),
  incidentWorkflow: { available: true, stages: { detected: 3, investigating: 2, contained: 1, remediating: 1, closed: 15 } }, backupRecovery: gap('No verified backup/DR-plan schema'),
};

beforeEach(() => { mockOverview.mockReset(); mockOverview.mockResolvedValue(overview); });

describe('SecurityScreen — Security & Compliance', () => {
  it('renders header, star, subtitle, permission banner, and both header actions', async () => {
    render(<MemoryRouter><SecurityScreen /></MemoryRouter>);
    expect(await screen.findByText('Security & Compliance')).toBeInTheDocument();
    expect(screen.getByText('The central security-management area.')).toBeInTheDocument();
    expect(screen.getByText(/Ordinary support employees do not have access/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export Security Report/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Emergency Lockdown/ })).toBeInTheDocument();
  });

  it('renders all 12 KPIs (real + honest gaps), 7 filters, 12 controls, 7 quick actions, 6 glance cards', async () => {
    render(<MemoryRouter><SecurityScreen /></MemoryRouter>);
    await screen.findByText('Security & Compliance');
    ['2FA Enabled Users', 'Failed Login Activity', 'Suspicious Sessions', 'Privileged Accounts', 'Data-Export Events', 'Privacy Requests', 'Security Incidents', 'Compliance Status', 'Encryption Status', 'Backup Status', 'Session Policy Status', 'Password Policy Status'].forEach((l) => expect(screen.getAllByText(l).length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText('423')).toBeInTheDocument();
    expect(screen.getAllByText('Not connected').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('No session risk-tier scoring schema')).toBeInTheDocument();
    ['Enforce Two-Factor Authentication', 'Configure Password Policies', 'Revoke Active Sessions', 'Block IP Addresses', 'Initiate Emergency Account Lockdown'].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
    const qa = (screen.getByText('Quick Actions')).closest('section')!;
    ['Lock Account', 'Revoke Sessions', 'Force Password Reset', 'Export Report', 'Review Alerts', 'Open Incident', 'Privacy Workflow'].forEach((l) => expect(within(qa).getByRole('button', { name: l })).toBeInTheDocument());
    ['Failed Logins Today', 'Incidents Opened', 'Privacy Requests Pending', 'Sessions Revoked', 'Blocked IPs', 'Backup Jobs Completed Today'].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
  });

  it('renders the real modules with masked IPs and honest gaps for unmodelled panels', async () => {
    render(<MemoryRouter><SecurityScreen /></MemoryRouter>);
    await screen.findByText('Security & Compliance');
    ['Authentication & Access Overview', 'Failed Login Trend', 'Suspicious Session Activity', 'Compliance Score Breakdown', 'Active Session Monitor', 'Role Restrictions & Privileged Access', 'Recent Security Alerts', 'Backup & Recovery Compliance'].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
    const sessions = screen.getByText('Active Session Monitor').closest('section')!;
    expect(within(sessions).getByText('192.168.1.xxx')).toBeInTheDocument();
    const alerts = screen.getByText('Recent Security Alerts').closest('section')!;
    expect(within(alerts).getByText('Multiple failed logins detected')).toBeInTheDocument();
    const blocked = screen.getByText('Blocked IPs & Threat Signals').closest('section')!;
    expect(within(blocked).getByText('203.0.113.45')).toBeInTheDocument();
    const incidents = screen.getByText('Security Incident Log').closest('section')!;
    expect(within(incidents).getByText('INC-2026-054')).toBeInTheDocument();
    const workflow = screen.getByText('Incident Response Workflow').closest('section')!;
    expect(within(workflow).getByText('Detected')).toBeInTheDocument();
    const roles = screen.getByText('Role Restrictions & Privileged Access').closest('section')!;
    expect(within(roles).getByText(/4 active time-boxed elevations/)).toBeInTheDocument();
  });

  it('Emergency Lockdown opens the deliberate, multi-step wizard (never one-click)', async () => {
    render(<MemoryRouter><SecurityScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Emergency Lockdown/ }));
    expect(await screen.findByRole('dialog', { name: /Emergency lockdown/ })).toBeInTheDocument();
    expect(screen.getByText(/never one-click/)).toBeInTheDocument();
    expect(screen.getByText(/never locked out of your own session/)).toBeInTheDocument();
  });
});


// ---- Automated Security Audit section (the in-platform 1am engine, Jul 26 2026) ----
describe('automated security audit section', () => {
  it('renders runs + deduplicated findings, and Run audit now triggers the engine and refreshes', async () => {
    mockAuditRuns.mockResolvedValue([{ id: 'r1', trigger: 'scheduled', status: 'completed', startedAt: '2026-07-26T01:00:00Z', findingsOpen: 2, findingsResolved: 1 }]);
    mockAuditFindings.mockResolvedValue([
      { id: 'f1', severity: 'high', status: 'open', title: 'Super Admin account(s) without confirmed MFA', detail: '1 user', occurrences: 3 },
      { id: 'f2', severity: 'medium', status: 'resolved', title: 'Audit schedule gap detected', detail: null, occurrences: 1 },
    ]);
    mockAuditRun.mockResolvedValue({ ran: true, open: 2, resolved: 0 });
    render(<MemoryRouter><SecurityScreen /></MemoryRouter>);
    const sec = within(await screen.findByTestId('audit-engine'));
    expect(await sec.findByText('Super Admin account(s) without confirmed MFA')).toBeTruthy();
    expect(sec.getByText('3×')).toBeTruthy();                                  // dedupe visible: occurrences, not 3 rows
    expect(sec.getByText('completed')).toBeTruthy();
    fireEvent.click(sec.getByText('Run audit now'));
    expect(await sec.findByText(/Run complete: 2 open, 0 resolved/)).toBeTruthy();
    expect(mockAuditRun).toHaveBeenCalledTimes(1);
    expect(mockAuditRuns.mock.calls.length).toBeGreaterThanOrEqual(2);         // refreshed after the run
  });

  it('the advisory-lock skip is surfaced honestly, not shown as success', async () => {
    mockAuditRuns.mockResolvedValue([]);
    mockAuditFindings.mockResolvedValue([]);
    mockAuditRun.mockResolvedValue({ ran: false, skippedReason: 'another instance is running the audit (advisory lock held)' });
    render(<MemoryRouter><SecurityScreen /></MemoryRouter>);
    const sec = within(await screen.findByTestId('audit-engine'));
    fireEvent.click(sec.getByText('Run audit now'));
    expect(await sec.findByText(/advisory lock held/)).toBeTruthy();
  });

  // SCAN (Oct 12): the filter bar's selects were uncontrolled with one option each and "Apply Filters" claimed
  // "Server-side filtering is wired…" while sending nothing — the overview endpoint takes no filters. Disabled, with why.
  it('the filter bar does not pretend to filter: the overview is platform-wide and the controls say so', async () => {
    render(<MemoryRouter><SecurityScreen /></MemoryRouter>);
    const apply = await screen.findByText('Apply Filters');
    expect(apply).toBeDisabled();
    expect(screen.getByText('Reset Filters')).toBeDisabled();
    expect(apply.getAttribute('title')).toMatch(/not available/i);
    expect(screen.queryByText(/filtering is wired/i)).toBeNull();
  });
});
