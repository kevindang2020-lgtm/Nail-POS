import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const systemStatusOverview = vi.fn();
const createIncident = vi.fn();
const updateIncidentStatus = vi.fn();
vi.mock('../components/KillSwitchesPanel', () => ({ KillSwitchesPanel: () => null }));
vi.mock('../components/PlatformInfrastructurePanels', () => ({ PlatformInfrastructurePanels: () => null }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { tenantHealthList: () => Promise.resolve({ rows: [], generatedAt: 'x' }), realtimeSync: () => Promise.resolve({ status: 'OPERATIONAL', scope: 'this API node', connectedPosClients: 2, connectedOtherClients: 0, activeTenantChannels: 1, eventsPerMinute: 4, eventsDelivered: 40, failedDeliveries: 0, reconnects: 1, connectionsOpened: 3, connectionsClosed: 1, latencyP50Ms: 12, latencyP95Ms: 30, latencyP99Ms: 45 }),
    realtimeTenantDiagnostics: () => Promise.resolve({ tenantId: 'T1', connectedChannels: [], totalSubscribers: 0, lastEvents: [], note: 'none' }),
    systemStatusOverview: (...a: any[]) => systemStatusOverview(...a), createIncident: (...a: any[]) => createIncident(...a), updateIncidentStatus: (...a: any[]) => updateIncidentStatus(...a) } }));

import { SystemStatusScreen } from './SystemStatusScreen';

const kpi = (key: string, label: string, value: string | null, extra: any = {}) => ({ key, label, value, available: value !== null, ...extra });
const overview = () => ({
  kpis: [
    kpi('operational', 'Services Operational', '17'), kpi('degraded', 'Degraded Services', '2', { unfavorableIfUp: true }), kpi('partial', 'Partial Outages', '1', { unfavorableIfUp: true }),
    kpi('major', 'Major Outages', '0', { unfavorableIfUp: true }), kpi('maintenance', 'Scheduled Maintenance', '1'), kpi('open_incidents', 'Open Incidents', '3', { unfavorableIfUp: true }),
    kpi('affected_tenants', 'Affected Tenants', '42', { unfavorableIfUp: true }), kpi('avg_recovery', 'Avg Recovery Time', '18 min'), kpi('public_updates', 'Public Status Updates', '6'), kpi('incident_reports', 'Incident Reports This Month', '9'),
  ],
  services: [
    { key: 'main_app', service: 'Main Application', category: 'Application', status: 'operational', statusLabel: 'Operational', uptimePct: 99.99, responseTimeMs: 120, ownerTeam: 'Platform Team', affectedTenants: 0, lastIncidentAt: '2026-04-20' },
    { key: 'booking', service: 'Booking System', category: 'Application', status: 'degraded', statusLabel: 'Degraded Performance', uptimePct: 99.45, responseTimeMs: 820, ownerTeam: 'Platform Team', affectedTenants: 28, lastIncidentAt: '2026-05-06' },
    { key: 'backups', service: 'Backups', category: 'Infrastructure', status: 'maintenance', statusLabel: 'Scheduled Maintenance', uptimePct: 100, responseTimeMs: null, ownerTeam: 'Infra Team', affectedTenants: 0, lastIncidentAt: null },
  ],
  statusBreakdown: [{ status: 'operational', label: 'Operational', count: 17, pct: 60 }, { status: 'degraded', label: 'Degraded Performance', count: 2, pct: 8 }],
  categoryHealth: [{ category: 'application', label: 'Application', total: 4, operational: 3, allOperational: false }, { category: 'payments', label: 'Payments', total: 2, operational: 2, allOperational: true }],
  globalUptime: { available: true, pct: 99.96 },
  affectedByService: [{ service: 'Booking System', affected: 28 }, { service: 'Queue Synchronization', affected: 14 }],
  activeIncidents: [{ incidentId: 'INC-2026-0506-001', service: 'Booking System', severity: 'High', status: 'Investigating', startedAt: '2026-05-06T10:12:00Z', affectedTenants: 28 }],
  incidentTimeline: [{ stage: 'Detected', count: 3 }, { stage: 'Investigating', count: 1 }, { stage: 'Identified', count: 2 }, { stage: 'Mitigating', count: 1 }, { stage: 'Monitoring', count: 0 }, { stage: 'Resolved', count: 24 }],
  scheduledMaintenance: [{ service: 'Backups', scope: 'Global', windowStart: '2026-05-06T23:00:00Z', windowEnd: '2026-05-07T01:00:00Z', tenantImpact: 0, noticeStatus: 'Published', owner: 'Infra Team' }],
  publicUpdates: [{ time: '2026-05-06T12:20:00Z', title: 'Queue Sync Partial Outage Update', audience: 'All Tenants', status: 'Published' }],
  incidentHistory: [{ incidentId: 'INC-2026-0506-010', service: 'Payment Processing', severity: 'Low', rootCause: 'Third-party API Delay', duration: '1h 22m', status: 'Resolved' }],
  postIncidentReports: [{ reportReference: 'PIR-2026-0504-001', title: 'Booking System Report', incidentReference: 'INC-2026-0506-010', owner: 'John D.', status: 'Published', publishedAt: '2026-05-04T00:00:00Z' }],
  communicationLog: [{ time: '2026-05-06T12:30:00Z', channel: 'Email', audience: '28 Tenants', message: 'Booking System Update', sentBy: 'System' }],
  recoveryProgress: [{ incident: 'INC-2026-0506-001', percentRecovered: 45, nextMilestone: 'Root Cause to be Confirmed', owner: 'John D.' }],
  affectedTenants: [{ tenant: 'VIP Nail Club', branch: 'Downtown', service: 'Booking System', impactLevel: 'High', commStatus: 'In Progress' }],
  healthTrend: { available: true, points: [{ date: '2026-04-30', pct: 99.2 }, { date: '2026-05-01', pct: 99.5 }, { date: '2026-05-06', pct: 98.9 }] },
});

describe('SystemStatusScreen', () => {
  beforeEach(() => { systemStatusOverview.mockReset(); systemStatusOverview.mockResolvedValue(overview()); createIncident.mockReset(); createIncident.mockResolvedValue({ ok: true, incident: { incidentId: 'INC-X', service: 'Payment Processing', severity: 'High', status: 'Investigating' } }); updateIncidentStatus.mockReset(); updateIncidentStatus.mockResolvedValue({ ok: true, incident: { incidentId: 'INC-2026-0506-001', status: 'Identified' } }); });

  it('renders the banner, 10 KPIs, and monitored services', async () => {
    render(<MemoryRouter><SystemStatusScreen /></MemoryRouter>);
    expect(await screen.findByText('System Status', { selector: 'h1' })).toBeInTheDocument();
    expect(screen.getByText(/monitors live platform health/)).toBeInTheDocument();
    expect(screen.getAllByText('Services Operational').length).toBeGreaterThanOrEqual(1); // KPI + at-a-glance
    expect(screen.getByText('Incident Reports This Month')).toBeInTheDocument();
    expect(screen.getByText('Main Application')).toBeInTheDocument();
    expect(screen.getByText('Monitored Services')).toBeInTheDocument();
  });

  it('renders 9 status controls, status breakdown, and global uptime', async () => {
    render(<MemoryRouter><SystemStatusScreen /></MemoryRouter>);
    await screen.findByText('System Status', { selector: 'h1' });
    expect(screen.getByText('Review Service Health')).toBeInTheDocument();
    expect(screen.getByText('Create Post-Incident Reports')).toBeInTheDocument();
    expect(screen.getByText('Status Level Breakdown')).toBeInTheDocument();
    expect(screen.getByText('99.96%')).toBeInTheDocument();
  });

  it('renders active incidents, timeline funnel, and incident history', async () => {
    render(<MemoryRouter><SystemStatusScreen /></MemoryRouter>);
    await screen.findByText('System Status', { selector: 'h1' });
    expect(screen.getAllByText('INC-2026-0506-001').length).toBeGreaterThanOrEqual(1); // active incidents + recovery tracker
    expect(screen.getByText('Incident Timeline / Recovery Progress')).toBeInTheDocument();
    expect(screen.getAllByText('INC-2026-0506-010').length).toBeGreaterThanOrEqual(1); // incident history + PIR related-incident
    expect(screen.getByText('1h 22m')).toBeInTheDocument();
  });

  it('opens the create-incident modal and advances an incident status', async () => {
    render(<MemoryRouter><SystemStatusScreen /></MemoryRouter>);
    await screen.findByText('System Status', { selector: 'h1' });
    fireEvent.click(screen.getByText('+ Create Incident'));
    expect(await screen.findByText('Create incident')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    // active incident is Investigating → advance to identified
    fireEvent.click(screen.getByText('→ identified'));
    await waitFor(() => expect(updateIncidentStatus).toHaveBeenCalledWith('INC-2026-0506-001', 'identified'));
  });

  it('applies a status-level filter server-side', async () => {
    render(<MemoryRouter><SystemStatusScreen /></MemoryRouter>);
    await screen.findByText('System Status', { selector: 'h1' });
    fireEvent.change(screen.getByLabelText('Status Level'), { target: { value: 'degraded' } });
    fireEvent.click(screen.getByText('Apply Filters'));
    await waitFor(() => expect(systemStatusOverview).toHaveBeenCalledWith(expect.objectContaining({ statusLevel: 'degraded' })));
  });

  it('marks health trend and lower trackers NotConnected', async () => {
    render(<MemoryRouter><SystemStatusScreen /></MemoryRouter>);
    await screen.findByText('System Status', { selector: 'h1' });
    expect(screen.getByText('Affected Tenants / Branches')).toBeInTheDocument();
    expect(screen.getByText('Recovery Progress Tracker')).toBeInTheDocument();
    expect(screen.getByText('Communication Log')).toBeInTheDocument();
    expect(screen.getByText('Booking System Update')).toBeInTheDocument();
    expect(screen.getByText('VIP Nail Club')).toBeInTheDocument();
    expect(screen.getByText('Root Cause to be Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Post-Incident Reports')).toBeInTheDocument();
    expect(screen.getByText('PIR-2026-0504-001')).toBeInTheDocument();
  });
});

// Constitution 9 Phase 20 — Live Operations renders the platform stream's aggregates (§60), fed through the shared client.
describe('Live Operations (Constitution 9 §60)', () => {
  it('shows the aggregate snapshot and nothing that could identify a tenant customer', async () => {
    const { superAdminRealtime } = await import('../api/useSuperAdminStream');
    const { act } = await import('@testing-library/react');
    render(<MemoryRouter><SystemStatusScreen /></MemoryRouter>);
    const block = await screen.findByTestId('live-ops');
    expect(block.textContent).toContain('—');                                               // nothing received yet
    await act(async () => {
      superAdminRealtime._ingest({ event: 'platform_ops_snapshot', seq: 1, stream: 'r0', payload: { data: {
        at: 'now', activeTenants: 7, connections: 19, connectedTenants: 5, paymentsPerMinute: 3, queueJoinsPerMinute: 4, bookingsPerMinute: 2,
        eventsPerMinute: 40, latencyP95Ms: 120, health: { status: 'OPERATIONAL', signals: [] } } } });
    });
    expect(block.textContent).toContain('19 across 5 tenants');
    expect(block.textContent).toContain('OPERATIONAL');
    expect(block.textContent).not.toMatch(/Priya|@|\d{3}-\d{4}/);                          // aggregates only (§206)
  });
});
