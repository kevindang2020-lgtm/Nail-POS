import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockOverview, mockListHolds, mockPlaceHold, mockReleaseHold, mockListInv, mockGetInv, mockOpenInv, mockInvNote, mockInvStatus, mockListEv, mockGetEv, mockExportEv, mockDownloadEv, mockVerifyEv, mockTamper, mockSetTamper, mockVerifyTamper, mockListFlags, mockScanFlags, mockReviewFlag, mockListRet, mockSetRet } = vi.hoisted(() => ({ mockOverview: vi.fn(), mockListHolds: vi.fn(), mockPlaceHold: vi.fn(), mockReleaseHold: vi.fn(), mockListInv: vi.fn(), mockGetInv: vi.fn(), mockOpenInv: vi.fn(), mockInvNote: vi.fn(), mockInvStatus: vi.fn(), mockListEv: vi.fn(), mockGetEv: vi.fn(), mockExportEv: vi.fn(), mockDownloadEv: vi.fn(), mockVerifyEv: vi.fn(), mockTamper: vi.fn(), mockSetTamper: vi.fn(), mockVerifyTamper: vi.fn(), mockListFlags: vi.fn(), mockScanFlags: vi.fn(), mockReviewFlag: vi.fn(), mockListRet: vi.fn(), mockSetRet: vi.fn() }));
vi.mock('../api/superAdminAuditLogsApi', () => ({ superAdminAuditLogsApi: { overview: (q: any) => mockOverview(q), listHolds: (s?: string) => mockListHolds(s), placeHold: (b: any) => mockPlaceHold(b), releaseHold: (id: string, b: any) => mockReleaseHold(id, b), listInvestigations: (s?: string) => mockListInv(s), getInvestigation: (id: string) => mockGetInv(id), openInvestigation: (b: any) => mockOpenInv(b), addInvestigationNote: (id: string, b: any) => mockInvNote(id, b), setInvestigationStatus: (id: string, b: any) => mockInvStatus(id, b), listEvidence: () => mockListEv(), getEvidence: (id: string) => mockGetEv(id), exportEvidence: (b?: any) => mockExportEv(b), downloadEvidence: (id: string) => mockDownloadEv(id), verifyEvidence: (id: string) => mockVerifyEv(id), tamperControls: () => mockTamper(), setTamperControl: (b: any) => mockSetTamper(b), verifyTamperControl: (k: string) => mockVerifyTamper(k), listExportFlags: (s?: string) => mockListFlags(s), scanExportFlags: () => mockScanFlags(), reviewExportFlag: (id: string, b: any) => mockReviewFlag(id, b), listRetentionPolicies: () => mockListRet(), setRetentionPolicy: (b: any) => mockSetRet(b) } }));

import { AuditLogsOverviewScreen } from './AuditLogsOverviewScreen';

const kpi = (key: string, label: string, over: any = {}) => ({ key, label, value: 100, display: '100', available: true, deltaPct: 5, direction: 'up', semantic: 'neutral', ...over });
const overview = (over: any = {}) => ({
  ok: true, metadata: { generatedAt: new Date().toISOString(), windowDays: 7 }, scope: { tenantId: null, label: 'All tenants' },
  tamperResistance: { appendOnly: true, editable: false, note: 'Audit logs are append-only and cannot be edited or deleted by administrators.' },
  kpis: [
    kpi('total', 'Total Logged Events'), kpi('critical', 'Critical Events', { semantic: 'bad' }), kpi('failed_logins', 'Failed Logins', { semantic: 'bad' }), kpi('data_exports', 'Data Exports'), kpi('role_changes', 'Role Changes'),
    kpi('support_access', 'Support-Mode Access'), kpi('ai_config', 'AI Config Changes'),
    kpi('legal_hold', 'Legal Hold Records'), kpi('investigations', 'Investigations Open'), kpi('evidence_packets', 'Exported Evidence Packets'),
  ],
  eventsByCategory: { total: 16, segments: [{ key: 'auth', label: 'Authentication', count: 8, pct: 50 }, { key: 'tenants', label: 'Tenant Management', count: 3, pct: 18.8 }] },
  resultBreakdown: { total: 16, segments: [{ key: 'success', label: 'Success', count: 11, pct: 68.8 }, { key: 'failed', label: 'Failed', count: 3, pct: 18.8 }, { key: 'warning', label: 'Warning', count: 1, pct: 6.3 }, { key: 'under_review', label: 'Under Review', count: 1, pct: 6.3 }] },
  eventVolumeTrend: [{ day: '2026-05-06', count: 16 }],
  topUsers: [{ user: 'Jessica Miller', events: 5842 }],
  suspiciousQueue: [{ time: new Date().toISOString(), user: 'Olivia Brown', event: 'login', status: 'failed', risk: 'high', riskLabel: 'High', ip: '203.0.113.10' }],
  auditTrail: [{ time: new Date().toISOString(), user: 'Jessica Miller', role: 'Super Admin', tenant: 'Glamour Studio', action: 'role_changed', previous: 'Staff', next: 'Manager', ip: '203.0.113.10', device: 'Chrome / Windows', reason: 'Promotion', result: 'Success' }],
  recentExports: [{ time: new Date().toISOString(), user: 'Lily Adams', scope: 'payments', summary: 'export' }],
  beforeAfterReview: [{ time: new Date().toISOString(), user: 'x', action: 'ai_config_changed', previous: 'GPT-3.5', next: 'GPT-4' }],
  accessSourceSummary: { total: 16, segments: [{ key: 'Chrome / Windows', label: 'Chrome / Windows', count: 10, pct: 62.5 }] },
  legalHoldRecords: { available: true, records: [] },
  openInvestigations: { available: true, investigations: [] },
  retentionStatus: { available: true, appendOnly: true, adminEditable: false, controls: [{ key: 'worm_storage', label: 'WORM Storage', value: 'Enabled', status: 'compliant', detail: null, lastVerifiedAt: new Date().toISOString() }, { key: 'digital_signature', label: 'Digital Signature Validation', value: 'Not configured', status: 'not_configured', detail: null, lastVerifiedAt: null }], configuredCount: 1, totalControls: 5, anyFailing: false, lastVerifiedAt: new Date().toISOString(), retention: { available: true, policies: [{ id: 'r1', category: 'auth', hotDays: 90, archiveDays: 275, version: 1, status: 'active', reason: null, effectiveDate: '2026-06-01', totalDays: 365, purgeEligible: 4 }], categoriesConfigured: 1, note: 'Retention is previewed only — never a delete.' } },
  atAGlance: { eventsToday: 16, failedLoginsToday: 3, highRiskToday: 4, openInvestigations: { available: true, value: 0 }, legalHoldsActive: { available: true, value: 0 }, exportsFlagged: { available: true, value: 2 } },
  ...over,
});

const renderScreen = () => render(<MemoryRouter><AuditLogsOverviewScreen /></MemoryRouter>);

describe('AuditLogsOverviewScreen', () => {
  beforeEach(() => { mockOverview.mockReset(); mockListHolds.mockReset(); mockPlaceHold.mockReset(); mockReleaseHold.mockReset(); mockListInv.mockReset(); mockGetInv.mockReset(); mockOpenInv.mockReset(); mockInvNote.mockReset(); mockInvStatus.mockReset(); mockListEv.mockReset(); mockGetEv.mockReset(); mockExportEv.mockReset(); mockDownloadEv.mockReset(); mockVerifyEv.mockReset(); mockTamper.mockReset(); mockSetTamper.mockReset(); mockVerifyTamper.mockReset(); mockListFlags.mockReset(); mockScanFlags.mockReset(); mockReviewFlag.mockReset(); mockListRet.mockReset(); mockSetRet.mockReset(); mockListHolds.mockResolvedValue({ holds: [] }); mockListInv.mockResolvedValue({ investigations: [] }); mockListEv.mockResolvedValue({ packs: [] }); mockListFlags.mockResolvedValue({ flags: [] }); mockListRet.mockResolvedValue({ available: true, policies: [], categoriesConfigured: 0, note: '' }); (URL as any).createObjectURL = vi.fn(() => 'blob:mock'); (URL as any).revokeObjectURL = vi.fn(); });

  it('renders header, tamper banner, and all 10 KPIs (all backed by real data)', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByRole('heading', { name: /Audit Logs/ })).toBeInTheDocument());
    expect(screen.getByText(/append-only and cannot be edited or deleted/)).toBeInTheDocument();
    for (const l of ['Total Logged Events', 'Critical Events', 'Failed Logins', 'Data Exports', 'Support-Mode Access']) expect(screen.getByText(l)).toBeInTheDocument();
    expect(screen.getAllByText('Legal Hold Records').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Exported Evidence Packets').length).toBeGreaterThan(0);
    // every governance surface is now backed by real data — nothing renders "Not tracked"
    expect(screen.queryByText('Not tracked')).toBeNull();
  });

  it('renders the audit trail with previous/new, charts, panels, and at-a-glance', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Platform Audit Trail')).toBeInTheDocument());
    // trail derives previous → new
    expect(screen.getByText('Staff')).toBeInTheDocument();
    expect(screen.getAllByText('Manager').length).toBeGreaterThan(0);
    for (const h of ['Audit Events by Category', 'Event Volume Trend (Last 7 Days)', 'Result Breakdown', 'Top Users by Logged Activity', 'Suspicious Activity Queue', 'Recent Data Export Events', 'Before-and-After Review', 'Tamper-Resistance & Retention Status', 'Access Source Summary', 'At-a-Glance Summary (Today)']) {
      expect(screen.getByText(h)).toBeInTheDocument();
    }
    // suspicious high-risk + before/after value
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('GPT-3.5')).toBeInTheDocument();
    // legal hold + investigations panels real (empty)
    expect(screen.getByText(/No legal holds in place/)).toBeInTheDocument();
    expect(screen.getByText(/No open investigations/)).toBeInTheDocument();
  });

  it('opens an investigation with a required title', async () => {
    mockOverview.mockResolvedValue(overview());
    mockOpenInv.mockResolvedValue({ ok: true, investigation: { id: 'i1', caseRef: 'INV-2026-XY9Z1', title: 'Suspicious exports', tenantId: null, severity: 'high', assignee: null, status: 'open', description: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, linkedEvents: 0 });
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Investigate Logs' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '+ Investigate Logs' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Investigations' })).toBeInTheDocument());
    // title required — blocked client-side
    fireEvent.click(screen.getByText('Open investigation'));
    await waitFor(() => expect(screen.getByText(/An investigation title is required/)).toBeInTheDocument());
    expect(mockOpenInv).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Investigation title'), { target: { value: 'Suspicious exports' } });
    fireEvent.change(screen.getByLabelText('Investigation severity'), { target: { value: 'high' } });
    fireEvent.click(screen.getByText('Open investigation'));
    await waitFor(() => expect(mockOpenInv).toHaveBeenCalledWith(expect.objectContaining({ title: 'Suspicious exports', severity: 'high' })));
    await waitFor(() => expect(screen.getByText(/INV-2026-XY9Z1 opened/)).toBeInTheDocument());
  });

  it('places a legal hold with a required reason (logs unchanged)', async () => {
    mockOverview.mockResolvedValue(overview());
    mockPlaceHold.mockResolvedValue({ ok: true, hold: { id: 'h1', holdRef: 'LH-2026-AB12X', scopeType: 'tenant', scopeValue: 't1', reason: 'r', legalAuthority: null, status: 'active', createdAt: new Date().toISOString(), reviewDate: null, expirationDate: null, releasedAt: null, releaseReason: null }, protectedCount: 13 });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Place Logs Under Legal Hold')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Place Logs Under Legal Hold'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Place Logs Under Legal Hold' })).toBeInTheDocument());
    // reason required — blocked client-side
    fireEvent.click(screen.getByText('Place hold'));
    await waitFor(() => expect(screen.getByText(/A reason is required to place a legal hold/)).toBeInTheDocument());
    expect(mockPlaceHold).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Hold scope value'), { target: { value: 't1' } });
    fireEvent.change(screen.getByLabelText('Hold reason'), { target: { value: 'Litigation preservation' } });
    fireEvent.click(screen.getByText('Place hold'));
    await waitFor(() => expect(mockPlaceHold).toHaveBeenCalledWith(expect.objectContaining({ scopeType: 'tenant', scopeValue: 't1', reason: 'Litigation preservation' })));
    await waitFor(() => expect(screen.getByText(/protecting 13 event\(s\). Logs are unchanged/)).toBeInTheDocument());
  });

  it('exports an audit evidence packet with a checksum from the header action', async () => {
    mockOverview.mockResolvedValue(overview());
    mockExportEv.mockResolvedValue({ ok: true, pack: { id: 'p1', packRef: 'EP-2026-AB12X', requestedBy: 'super_admin', scope: {}, format: 'csv', eventCount: 14, checksum: 'a'.repeat(64), manifest: {}, redactionApplied: true, status: 'ready', createdAt: new Date().toISOString(), expiresAt: null }, filename: 'audit-evidence-EP-2026-AB12X.csv', mimeType: 'text/csv', content: 'Date & Time,User\nx,y', checksum: 'a'.repeat(64), manifest: {} });
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: '⭳ Export Audit Evidence' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '⭳ Export Audit Evidence' }));
    await waitFor(() => expect(mockExportEv).toHaveBeenCalled());
    await waitFor(() => expect((URL as any).createObjectURL).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/EP-2026-AB12X generated — 14 event\(s\)/)).toBeInTheDocument());
  });

  it('sets a tamper-resistance / retention control (real config, not hardcoded)', async () => {
    mockOverview.mockResolvedValue(overview());
    mockSetTamper.mockResolvedValue({ ok: true, control: { key: 'retention_policy', label: 'Retention Policy', value: '7 Years', status: 'active', detail: null, lastVerifiedAt: new Date().toISOString() } });
    renderScreen();
    // panel shows the real WORM control + honest not-configured signature
    await waitFor(() => expect(screen.getByText('Tamper-Resistance & Retention Status')).toBeInTheDocument());
    expect(screen.getAllByText('WORM Storage').length).toBeGreaterThan(0);
    expect(screen.getByText('not configured')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Manage'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Tamper-Resistance and Retention' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Tamper control'), { target: { value: 'retention_policy' } });
    // value required — blocked
    fireEvent.click(screen.getByText('Save control'));
    await waitFor(() => expect(screen.getByText(/A value is required/)).toBeInTheDocument());
    expect(mockSetTamper).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Control value'), { target: { value: '7 Years' } });
    fireEvent.change(screen.getByLabelText('Control status'), { target: { value: 'active' } });
    fireEvent.click(screen.getByText('Save control'));
    await waitFor(() => expect(mockSetTamper).toHaveBeenCalledWith(expect.objectContaining({ controlKey: 'retention_policy', value: '7 Years', status: 'active' })));
    await waitFor(() => expect(screen.getByText(/Retention Policy: 7 Years \(active\)/)).toBeInTheDocument());
  });

  it('scans and reviews flagged data exports', async () => {
    mockOverview.mockResolvedValue(overview());
    mockScanFlags.mockResolvedValue({ ok: true, scanned: 8, created: 3 });
    mockListFlags.mockResolvedValueOnce({ flags: [] }).mockResolvedValue({ flags: [{ id: 'f1', eventRef: 'e1', ruleKey: 'large_export', ruleVersion: 1, risk: 'high', reason: 'Large export (5000 records)', status: 'open', reviewNote: null, createdAt: new Date().toISOString() }] });
    mockReviewFlag.mockResolvedValue({ ok: true, id: 'f1', status: 'reviewed' });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Review Data Exports')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Review Data Exports'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Flagged Data Exports' })).toBeInTheDocument());
    fireEvent.click(screen.getByText('Scan recent exports'));
    await waitFor(() => expect(mockScanFlags).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/Scanned 8 export event\(s\) — 3 new flag\(s\)/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('large_export')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Reviewed'));
    await waitFor(() => expect(mockReviewFlag).toHaveBeenCalledWith('f1', { status: 'reviewed', note: undefined }));
  });

  it('sets a per-category retention policy and shows purge-eligibility (never a delete)', async () => {
    mockOverview.mockResolvedValue(overview());
    mockSetRet.mockResolvedValue({ ok: true, policy: { id: 'r2', category: 'payments', hotDays: 365, archiveDays: 1460, version: 1, status: 'active', reason: null, effectiveDate: '2026-07-02', totalDays: 1825, purgeEligible: 0 } });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Tamper-Resistance & Retention Status')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Manage'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Tamper-Resistance and Retention' })).toBeInTheDocument());
    // existing policy + eligibility preview render
    expect(screen.getByText('Per-category retention policies')).toBeInTheDocument();
    expect(screen.getByText('90d hot + 275d archive')).toBeInTheDocument();
    expect(screen.getByText('4 eligible')).toBeInTheDocument();
    // set a new policy
    fireEvent.change(screen.getByLabelText('Retention category'), { target: { value: 'payments' } });
    fireEvent.change(screen.getByLabelText('Hot days'), { target: { value: '365' } });
    fireEvent.change(screen.getByLabelText('Archive days'), { target: { value: '1460' } });
    fireEvent.click(screen.getByText('Set'));
    await waitFor(() => expect(mockSetRet).toHaveBeenCalledWith({ category: 'payments', hotDays: 365, archiveDays: 1460 }));
    await waitFor(() => expect(screen.getByText(/Retention for payments: 365d hot \+ 1460d archive \(v1\)/)).toBeInTheDocument());
  });

  it('opens an informative, tamper-resistant modal for a quick action', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByText('View Security Logs')).toBeInTheDocument());
    fireEvent.click(screen.getByText('View Security Logs'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'View Security Logs' })).toBeInTheDocument());
    expect(screen.getByText(/append-only and can never be edited or deleted/)).toBeInTheDocument();
  });

  it('shows a live indicator and preserves data on a background refresh failure', async () => {
    vi.useFakeTimers();
    try {
      mockOverview.mockResolvedValueOnce(overview());
      renderScreen();
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/auto-refresh 25s/)).toBeInTheDocument();
      mockOverview.mockRejectedValueOnce(new Error('blip'));
      await vi.advanceTimersByTimeAsync(25_000);
      expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
      expect(screen.getByText('Total Logged Events')).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('shows an error state with retry', async () => {
    mockOverview.mockRejectedValue(new Error('down'));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Couldn’t load Audit Logs')).toBeInTheDocument());
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  // SCAN (Oct 12): the overview's filter bar was "(visual)" — Apply / Reset had no handler and the search box went
  // nowhere. Apply now opens the paged browser with the search as its action filter; the selects the browser cannot
  // filter on say so (disabled with a reason) instead of pretending.
  it('Apply Filters opens the paged browser with the search as the action filter; unsupported filters are disabled', async () => {
    mockOverview.mockResolvedValue(overview());
    let at = '';
    const { Routes, Route, useLocation } = await import('react-router-dom');
    const Where = () => { const l = useLocation(); at = l.pathname + l.search; return null; };
    render(<MemoryRouter initialEntries={['/audit-logs']}><Routes><Route path="/audit-logs" element={<AuditLogsOverviewScreen />} /><Route path="/audit-logs/browse" element={<Where />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('heading', { name: /Audit Logs/ })).toBeInTheDocument());
    for (const f of ['User', 'Role', 'Branch', 'Result', 'IP Address', 'Device']) expect(screen.getByLabelText(f)).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Search logs'), { target: { value: 'support_access' } });
    fireEvent.click(screen.getByText('Reset Filters'));
    expect((screen.getByLabelText('Search logs') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Search logs'), { target: { value: 'support_access' } });
    fireEvent.click(screen.getByText('Apply Filters'));
    await waitFor(() => expect(at).toBe('/audit-logs/browse?action=support_access'));
  });
});
