import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SALoyaltyDashboard } from '../api/superAdminLoyaltyApi';

const { mockDash, mockCsv, mockGetConfig, mockPutConfig, mockListTpl, mockCreateTpl, mockDetect, mockListSus, mockTransition, mockDetectCorr, mockListCorr, mockReviewCorr } = vi.hoisted(() => ({ mockDash: vi.fn(), mockCsv: vi.fn(), mockGetConfig: vi.fn(), mockPutConfig: vi.fn(), mockListTpl: vi.fn(), mockCreateTpl: vi.fn(), mockDetect: vi.fn(), mockListSus: vi.fn(), mockTransition: vi.fn(), mockDetectCorr: vi.fn(), mockListCorr: vi.fn(), mockReviewCorr: vi.fn() }));
vi.mock('../api/superAdminLoyaltyApi', async () => {
  const actual = await vi.importActual<any>('../api/superAdminLoyaltyApi');
  return { ...actual, superAdminLoyaltyApi: { dashboard: (q: any) => mockDash(q), exportCsv: (q: any) => mockCsv(q), exportXlsx: (q: any) => mockCsv(q), getConfig: () => mockGetConfig(), putConfig: (b: any) => mockPutConfig(b), listTemplates: () => mockListTpl(), createTemplate: (b: any) => mockCreateTpl(b), detectSuspicious: () => mockDetect(), listSuspicious: (q: any) => mockListSus(q), transitionSuspicious: (id: any, b: any) => mockTransition(id, b), detectCorrections: () => mockDetectCorr(), listCorrections: (q: any) => mockListCorr(q), reviewCorrection: (id: any, b: any) => mockReviewCorr(id, b) } };
});

import LoyaltyProgramsScreen from './LoyaltyProgramsScreen';

const dash = (): { ok: true } & SALoyaltyDashboard => ({
  ok: true,
  meta: { generatedAt: '2026-05-06T14:34:00Z', scope: 'platform', centsPerPoint: 1 },
  kpis: { loyaltyMembers: 128741, pointsIssued: 2418640, pointsRedeemed: 1284112, liabilityCents: 38276000, rewardsIssued: 42186, tierMembership: 18924, expiredPoints: 0, suspiciousActivity: 0, engagementPct: 47.2, programPerformancePct: 96.8, activePrograms: 312, avgRedemptionRatePct: 22.6 },
  tierDistribution: { total: 18924, slices: [{ tier: 'Bronze', count: 8642, pct: 45.7 }, { tier: 'Silver', count: 5126, pct: 27.1 }, { tier: 'Gold', count: 3441, pct: 18.2 }, { tier: 'Platinum', count: 1715, pct: 9 }] },
  redemptionStatus: { total: 42186, slices: [{ status: 'redeemed', count: 35912, pct: 85.1 }, { status: 'pending', count: 4816, pct: 11.4 }, { status: 'flagged', count: 1458, pct: 3.5 }] },
  pointsActivityTrend: [{ day: '2026-04-30', issued: null, redeemed: 200000, expired: null }, { day: '2026-05-01', issued: null, redeemed: 250000, expired: null }],
  memberGrowth: [{ day: '2026-04-30', members: 1200, engagementPct: null }],
  topPrograms: [{ tenantId: 'A', tenantName: 'Glamour Studio', name: 'Glow Rewards', type: 'Points', members: 12841, pointsIssued: 512340, pointsRedeemed: 278910, rewardsIssued: 9142, redemptionRatePct: 54.4, liabilityCents: 8721000, status: 'Active' }],
  tenantPerformance: [{ tenantId: 'A', tenantName: 'Glamour Studio', activePrograms: 6, members: 24812, engagementPct: 48.3, redemptionRatePct: 56.2, liabilityCents: 13241000, status: 'Healthy' }],
  suspiciousReview: { available: false, reason: 'No suspicious-redemption case store connected', rows: [] },
  atAGlance: { newMembers: 1842, rewardsRedeemed: 542, pointsIssued: null, expiredPoints: null, liabilityChangeCents: null, flaggedCasesOpen: 10 },
  tenantCount: 312,
});


  const dashWithCases = () => ({ ...dash(), suspiciousReview: { available: true, rows: [{ id: 'sc1', tenantName: 'Glamour Studio', signalType: 'velocity', severity: 'high', status: 'open', detail: { count: 12, day: '2026-05-06' }, detectedAt: '2026-05-06T10:00:00Z' }] }, kpis: { ...dash().kpis, suspiciousActivity: 3 } });

const renderScreen = () => render(<MemoryRouter><LoyaltyProgramsScreen /></MemoryRouter>);
const cfg = { limits: { maxPointsPerTxn: 5000, maxRedemptionPerTxn: 10000, minRedemptionThreshold: 100, maxPointsPerDayPerMember: 20000 }, expiration: { enabled: false, pointExpiryDays: 365, rewardValidityDays: 90 }, programTypes: { points: true, tiered: true, visit_based: false, spend_based: false }, planFeatures: { starter: false, growth: true }, valuation: { centsPerPoint: 1 } };
beforeEach(() => { mockDash.mockReset(); mockCsv.mockReset(); mockGetConfig.mockReset(); mockPutConfig.mockReset(); mockListTpl.mockReset(); mockCreateTpl.mockReset(); mockDetect.mockReset(); mockListSus.mockReset(); mockTransition.mockReset(); mockDetect.mockResolvedValue({ ok: true, upserted: 3, open: 3 }); mockDetectCorr.mockReset(); mockListCorr.mockReset(); mockReviewCorr.mockReset(); mockDetectCorr.mockResolvedValue({ ok: true, upserted: 2, open: 2 }); mockListCorr.mockResolvedValue({ ok: true, corrections: [{ id: 'cor1', tenantId: 'A', customerId: 'c1', discrepancyType: 'balance_mismatch', expectedPoints: 1000, actualPoints: 9999, differencePoints: -8999, status: 'detected', proposedAdjustmentPoints: null, rootCause: null, reason: null, detail: {}, detectedAt: '2026-05-06T10:00:00Z', updatedAt: '2026-05-06T10:00:00Z' }] }); mockReviewCorr.mockResolvedValue({ ok: true, status: 'approved' }); mockGetConfig.mockResolvedValue({ ok: true, config: cfg }); mockListTpl.mockResolvedValue({ ok: true, templates: [] }); mockPutConfig.mockResolvedValue({ ok: true, config: cfg }); globalThis.URL.createObjectURL = vi.fn(() => 'blob:x'); globalThis.URL.revokeObjectURL = vi.fn(); });

describe('LoyaltyProgramsScreen', () => {
  it('renders the title and all 12 KPI cards from the dashboard', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Loyalty Programs')).toBeInTheDocument());
    for (const l of ['Loyalty Members', 'Points Issued', 'Points Redeemed', 'Outstanding Point Liability', 'Rewards Issued', 'Tier Membership', 'Expired Points', 'Suspicious Redemption Activity', 'Loyalty Engagement', 'Program Performance by Tenant', 'Active Loyalty Programs', 'Avg Reward Redemption Rate'])
      expect(screen.getAllByText(l).length).toBeGreaterThan(0);
  });

  it('renders the Platform Controls and Tenant Oversight sections', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Platform Loyalty Controls')).toBeInTheDocument());
    expect(screen.getByText('Tenant Loyalty Oversight')).toBeInTheDocument();
    expect(screen.getAllByText('Configure Expiration Rules').length).toBeGreaterThan(0);
    expect(screen.getByText('Correct Platform Calculation Errors')).toBeInTheDocument();
  });

  it('renders the four analytics and three tables', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Points Activity Trend')).toBeInTheDocument());
    for (const m of ['Member Growth vs Engagement', 'Member Tier Distribution', 'Redemption Status', 'Top Loyalty Programs This Week', 'Program Performance by Tenant', 'Suspicious Redemption Review'])
      expect(screen.getAllByText(m).length).toBeGreaterThan(0);
    expect(screen.getByText('Glow Rewards')).toBeInTheDocument();
  });

  it('surfaces honest not-connected for suspicious review and null at-a-glance metrics', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText(/No suspicious-redemption case store connected/)).toBeInTheDocument());
    expect(screen.getByText('Points Issued Today')).toBeInTheDocument();
    expect(screen.getByText('No issuance event source')).toBeInTheDocument();   // honest — not fabricated
  });

  it('renders 8 Quick Actions', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Quick Actions')).toBeInTheDocument());
    for (const a of ['Configure Program Types', 'Create Default Template', 'Set Points Limits', 'Configure Expiration Rules', 'Review Suspicious Activity', 'Correct Calculation Errors', 'Toggle Loyalty by Plan', 'Export Loyalty Reports'])
      expect(screen.getAllByText(a).length).toBeGreaterThan(0);
  });

  it('exports a real loyalty report via the export endpoint', async () => {
    mockDash.mockResolvedValue(dash());
    mockCsv.mockResolvedValue(new Blob(['x'], { type: 'text/csv' }));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Export Report')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Export Report'));
    await waitFor(() => expect(mockCsv).toHaveBeenCalledTimes(1));
  });


  it('opens real Loyalty Settings and saves configuration through the endpoint', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('Set Points and Reward Limits').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Set Points and Reward Limits')[0]);
    await waitFor(() => expect(mockGetConfig).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('Max points per transaction')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Max points per transaction'), { target: { value: '8000' } });
    fireEvent.click(screen.getByText('Save Configuration'));
    await waitFor(() => expect(mockPutConfig).toHaveBeenCalledWith(expect.objectContaining({ limits: expect.objectContaining({ maxPointsPerTxn: 8000 }) })));
  });

  it('creates a default loyalty template through the endpoint', async () => {
    mockDash.mockResolvedValue(dash());
    mockCreateTpl.mockResolvedValue({ ok: true, id: 't1' });
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('Create Default Loyalty Templates').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Create Default Loyalty Templates')[0]);
    await waitFor(() => expect(screen.getByLabelText('Template name')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Standard Points' } });
    fireEvent.click(screen.getByText('Create Template'));
    await waitFor(() => expect(mockCreateTpl).toHaveBeenCalledWith(expect.objectContaining({ name: 'Standard Points' })));
  });


  it('runs real suspicious detection and reviews a case through the endpoints', async () => {
    mockDash.mockResolvedValueOnce(dash()).mockResolvedValue(dashWithCases());
    mockTransition.mockResolvedValue({ ok: true, status: 'dismissed' });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Run Detection')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Run Detection'));
    await waitFor(() => expect(mockDetect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Velocity')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Dismiss'));
    await waitFor(() => expect(mockTransition).toHaveBeenCalledWith('sc1', expect.objectContaining({ to: 'dismissed' })));
  });


  it('detects and reviews a calculation error through the endpoints (records compensating correction)', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('Correct Platform Calculation Errors').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Correct Platform Calculation Errors')[0]);
    await waitFor(() => expect(mockDetectCorr).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Balance Mismatch')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Reason for cor1'), { target: { value: 'Confirmed cache drift.' } });
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(mockReviewCorr).toHaveBeenCalledWith('cor1', expect.objectContaining({ to: 'approved', reason: 'Confirmed cache drift.' })));
  });

});
