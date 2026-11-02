import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminMembershipsApi', () => ({
  membershipProgramsApi: {
    overview: vi.fn().mockResolvedValue({
      ok: true,
      kpiTrends: { activeMembers: { deltaPct: 11.1, favorable: true }, cancelledMembers: { deltaPct: 25, favorable: false } },
      kpis: { totalPrograms: 5, activeMembers: 20, pausedMembers: 5, cancelledMembers: 5, pastDueMembers: 5, trialMembers: 5, mrrCents: 217500, failedPayments: 5, benefitsIssued: 30, benefitsRedeemed: 10, unusedCredits: 20, expiringCredits: 30, tenantParticipation: { active: 2, total: 2 }, branchParticipation: { active: 2, total: 2 }, suspiciousCount: 0 },
      programMix: [{ type: 'premium', count: 2 }, { type: 'nail', count: 1 }],
      statusBreakdown: [{ status: 'active', count: 20 }, { status: 'trial', count: 5 }],
      revenueTrend: [{ date: 'May 01', cents: 10000 }, { date: 'May 02', cents: 15000 }],
      membersVsRedeemed: [{ date: 'May 01', members: 2, redeemed: 1 }, { date: 'May 02', members: 3, redeemed: 2 }],
      topPrograms: [{ planId: 'p1', name: 'VIP Membership', type: 'premium', activeMembers: 8, priceCents: 9900, includedBenefits: 5, redemptionRatePct: 40, revenueCents: 79200, status: 'active' }],
      tenantPerformance: [{ tenantId: 't1', tenant: 'Pilot Nail Salon', activePrograms: 3, members: 24, mrrCents: 130000, billingFailures: 3, pauseRatePct: 12.5, status: 'At Risk' }],
      billingFailures: [{ tenantProgram: 'Pilot Nail Salon / VIP Membership', issue: 'card declined', severity: 'High', status: 'Retry Pending', at: '2026-05-06T00:00:00Z' }],
      atAGlance: { newMembersToday: 0, revenueTodayCents: 0, failedPaymentsToday: 0, benefitsRedeemedToday: 0, expiringCreditsToday: 0, supportCasesOpen: 0 },
    }),
  },
  membershipControlsApi: {
    controls: vi.fn().mockResolvedValue({ ok: true, enabledGlobally: true, planGating: { starter: false, growth: true }, limits: { maxProgramsPerTenant: 25, maxActiveMembersPerTenant: 5000, maxBenefitsPerProgram: 12, maxTrialDays: 30 }, rules: { allowedBillingIntervals: ['month'], allowTrials: true, allowFamily: true, requireAutoRenewConsent: true, maxDiscountPercent: 50 }, plans: [{ code: 'starter', name: 'Starter' }, { code: 'growth', name: 'Growth' }], templates: [{ id: 't1', name: 'Basic Nail Membership', description: null, productType: 'nail', billingInterval: 'month', intervalCount: 1, priceCents: 4900, trialDays: 0, benefits: [], status: 'published', version: 1, updatedAt: '2026-05-06T00:00:00Z' }] }),
    setEnabled: vi.fn().mockResolvedValue({ ok: true }), setGating: vi.fn().mockResolvedValue({ ok: true, planGating: {} }),
    setLimits: vi.fn().mockResolvedValue({ ok: true, limits: {} }), setRules: vi.fn().mockResolvedValue({ ok: true, rules: {} }),
    createTemplate: vi.fn().mockResolvedValue({ ok: true, id: 'new' }), updateTemplate: vi.fn().mockResolvedValue({ ok: true }),
  },
  membershipOversightApi: {
    programs: vi.fn().mockResolvedValue({ ok: true, programs: [{ planId: 'p1', name: 'VIP Membership', productType: 'premium', status: 'active', tenantId: 't1', tenantName: 'Pilot Nail Salon', priceCents: 9900, billingInterval: 'month', activeMembers: 4, totalMembers: 8, revenueCents: 59400 }] }),
    billingFailures: vi.fn().mockResolvedValue({ ok: true, failures: [{ id: 'f1', tenant: 'Pilot Nail Salon', program: 'VIP Membership', memberNumber: 'MBR-00023', amountCents: 9900, reason: 'card declined', attempt: 2, at: '2026-05-06T00:00:00Z' }] }),
    revenue: vi.fn().mockResolvedValue({ ok: true, totalCents: 261000, byTenant: [{ tenant: 'Pilot Nail Salon', revenueCents: 124200, mrrCents: 103500 }], byProgram: [{ program: 'VIP Membership', revenueCents: 59400 }] }),
    cancellations: vi.fn().mockResolvedValue({ ok: true, items: [{ memberNumber: 'MBR-00008', tenant: 'Pilot Nail Salon', program: 'Pedicure Club', status: 'paused', reason: null, at: '2026-05-01T00:00:00Z', resumesAt: '2026-05-21T00:00:00Z' }] }),
  },
  membershipActionsApi: {
    duplicateCharges: vi.fn().mockResolvedValue({ ok: true, cases: [{ tenant: 'Pilot Nail Salon', program: 'Basic Nail Membership', memberNumber: 'MBR-00001', amountCents: 4900, count: 2, confidence: 'high', firstAt: '2026-05-01T10:00:00Z', lastAt: '2026-05-01T11:00:00Z', paymentIds: ['a', 'b'] }] }),
    programImpact: vi.fn().mockResolvedValue({ ok: true, impact: { planId: 'p1', name: 'Basic Nail Membership', status: 'active', tenant: 'Pilot Nail Salon', activeMembers: 4, trialMembers: 0, pastDueMembers: 1, mrrCents: 24500, creditsIssued: 6 } }),
    disableProgram: vi.fn().mockResolvedValue({ ok: true }),
    createCorrection: vi.fn().mockResolvedValue({ ok: true, entryId: 'abcd1234' }),
  },
  membershipSupportApi: {
    suspicious: vi.fn().mockResolvedValue({ ok: true, cases: [{ type: 'duplicate_active_membership', customerId: 'c1', customerName: 'Lena Cho', membershipIds: ['a', 'b', 'c'], count: 3, severity: 'medium', tenant: 'Pilot Nail Salon' }] }),
    activeSession: vi.fn().mockResolvedValue({ ok: true, session: null }),
    enter: vi.fn().mockResolvedValue({ ok: true, session: { id: 's1', tenant: 'Pilot Nail Salon', reason: 'x', accessLevel: 'read_only', expiresAt: '2026-05-06T04:00:00Z' } }),
    exit: vi.fn().mockResolvedValue({ ok: true }),
  },
  membershipExportApi: {
    exportCsv: vi.fn().mockResolvedValue({ filename: 'membership-programs-2026-05-06.csv', csv: 'Program,Revenue\r\nVIP Membership,792.00' }),
  },
  membershipDrilldownApi: {
    members: vi.fn().mockResolvedValue({ ok: true, members: [{ memberNumber: 'MBR-00007', tenant: 'Pilot Nail Salon', program: 'Basic Nail Membership', status: 'past_due', startedAt: '2026-04-01T00:00:00Z', nextBillingAt: '2026-05-10T00:00:00Z' }] }),
    creditsSummary: vi.fn().mockResolvedValue({ ok: true, rows: [{ program: 'VIP Membership', tenant: 'Pilot Nail Salon', issued: 6, redeemed: 2, unused: 4, expiring: 6 }] }),
  },
}));

import MembershipProgramsScreen from './MembershipProgramsScreen';
const renderScreen = () => render(<MemoryRouter><MembershipProgramsScreen /></MemoryRouter>);

describe('MembershipProgramsScreen', () => {
  it('renders the canonical title + subtitle', async () => {
    renderScreen();
    expect((await screen.findAllByText(/Membership Programs/)).length).toBeGreaterThan(0);
    expect(screen.getByText('Oversees membership functionality across all tenants and branches.')).toBeInTheDocument();
  });

  it('renders the 15 platform-oversight KPIs from real data', async () => {
    renderScreen();
    for (const l of ['Total Membership Programs', 'Active Members', 'Paused Memberships', 'Cancelled Memberships', 'Past-Due Memberships', 'Trial Memberships', 'Monthly Recurring Revenue', 'Failed Recurring Payments', 'Membership Benefits Issued', 'Benefits Redeemed', 'Unused Service Credits', 'Expiring Credits', 'Tenant Participation', 'Branch Participation', 'Suspicious or Duplicate']) {
      expect((await screen.findAllByText(l)).length).toBeGreaterThan(0);
    }
  });

  it('renders platform controls, tenant oversight, analytics, and governance cards', async () => {
    renderScreen();
    expect(await screen.findByText('Platform Membership Controls')).toBeInTheDocument();
    expect(await screen.findByText('Tenant Membership Oversight')).toBeInTheDocument();
    expect(await screen.findByText('Program Mix by Type')).toBeInTheDocument();
    expect(await screen.findByText('Recurring Billing Status')).toBeInTheDocument();
    expect(await screen.findByText('Top Membership Programs This Week')).toBeInTheDocument();
    expect(await screen.findByText('Program Performance by Tenant')).toBeInTheDocument();
    expect(await screen.findByText(/Membership Programs vs Loyalty Programs/)).toBeInTheDocument();
    expect(await screen.findByText('At-a-Glance Summary (Today)')).toBeInTheDocument();
  });

  it('opens the Reusable Templates control modal from its tile', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Create Reusable Membership Templates'));
    expect(await screen.findByText(/Existing templates/)).toBeInTheDocument();
    expect(await screen.findByText('Basic Nail Membership')).toBeInTheDocument();
  });

  it('opens the Review Recurring Billing Failures oversight modal from its tile', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Review Recurring Billing Failures'));
    expect(await screen.findByText(/Recurring billing and dunning are performed by the tenant engine/)).toBeInTheDocument();
    expect(await screen.findByText('MBR-00023')).toBeInTheDocument();
  });

  it('opens Review Duplicate Charges and shows the no-auto-refund notice + a detected case', async () => {
    renderScreen();
    fireEvent.click((await screen.findAllByText('Review Duplicate Charges'))[0]);
    expect(await screen.findByText(/no refund is taken automatically/i)).toBeInTheDocument();
    expect(await screen.findByText('Basic Nail Membership')).toBeInTheDocument();
  });

  it('opens Audited Support Mode from its Quick Action with tenant/reason/duration inputs', async () => {
    renderScreen();
    fireEvent.click((await screen.findAllByText('Support Mode'))[0]);
    expect(await screen.findByText(/tenant-scoped, time-limited, and fully audited/i)).toBeInTheDocument();
    expect(await screen.findByText('Enter Support Mode')).toBeInTheDocument();
  });

  it('opens the Suspicious Memberships review from the KPI card with a no-penalty notice', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Suspicious or Duplicate'));
    expect(await screen.findByText(/no customer or tenant is penalized automatically/i)).toBeInTheDocument();
    expect(await screen.findByText('Lena Cho')).toBeInTheDocument();
  });

  it('exports the membership report as CSV from the header button', async () => {
    const { membershipExportApi } = await import('../api/superAdminMembershipsApi');
    (URL as any).createObjectURL = vi.fn(() => 'blob:x'); (URL as any).revokeObjectURL = vi.fn();
    renderScreen();
    fireEvent.click((await screen.findAllByText(/Export Report/))[0]);
    await waitFor(() => expect((membershipExportApi as any).exportCsv).toHaveBeenCalled());
  });

  it('drills a member-status KPI into the filtered members list', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Past-Due Memberships'));
    expect(await screen.findByText('MBR-00007')).toBeInTheDocument();
  });

  it('drills a credit KPI into the per-program credits summary', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Unused Service Credits'));
    expect(await screen.findByText('Service Credits by Program')).toBeInTheDocument();
  });
});
