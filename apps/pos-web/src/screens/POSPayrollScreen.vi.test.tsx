// POSPayrollScreen.vi.test — English + Vietnamese POS mandate (WP-C2): Team › Payroll and its period workspace read in
// Vietnamese (period statuses, pay-line breakdown, technician term "Thợ"); no leftover English. Same mocked API as
// POSPayrollScreen.test.tsx; no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { POSPayrollScreen } from './POSPayrollScreen';
import { posPayrollApi } from '../api/posPayrollApi';

vi.mock('../api/posTechniciansApi', () => ({ posTechniciansApi: { directory: vi.fn().mockResolvedValue([{ id: 'sam', fullName: 'Sam Lee' }, { id: 'ava', fullName: 'Ava Kim' }]) } }));
vi.mock('../api/posStepUpApi', () => ({ posStepUpApi: { stepUp: vi.fn().mockResolvedValue({ ok: true }) } }));
vi.mock('../api/posPayrollApi', () => ({
  posPayrollApi: {
    getState: vi.fn(), getPeriod: vi.fn(), createPeriod: vi.fn(), buildFromSales: vi.fn(), validation: vi.fn(), prepare: vi.fn(), sendBack: vi.fn(),
    finalize: vi.fn(), pay: vi.fn(), reopen: vi.fn(), payouts: vi.fn(), recordPayout: vi.fn(), setPayoutStatus: vi.fn(), exportPeriod: vi.fn(), exportHistory: vi.fn(), technician: vi.fn(),
    createAdjustment: vi.fn(), carryForward: vi.fn(), adjustments: vi.fn(), decideAdjustment: vi.fn(), exceptions: vi.fn(), exceptionAction: vi.fn(), inquiries: vi.fn(), respondInquiry: vi.fn(),
    provider: vi.fn(), payPlans: vi.fn(), createPayPlan: vi.fn(), archivePayPlan: vi.fn(), deductionTypes: vi.fn(), saveDeductionType: vi.fn(), ticketTip: vi.fn(), setTicketTip: vi.fn(),
  },
}));

const P = (status: string, extra: Record<string, unknown> = {}) => ({ id: 'p1', label: 'Jun 1–15', periodStart: '2026-06-01', periodEnd: '2026-06-15', status, version: 4, previewHash: 'h'.repeat(64),
  dashboardStatus: status === 'review' ? 'READY_TO_APPROVE' : status === 'finalized' ? 'LOCKED' : status === 'paid' ? 'PAID' : 'OPEN', totalGrossCents: 200000, totalCommissionCents: 100000, totalTipsCents: 30000, totalPayableCents: 130000, ...extra });
const LINE = { id: 'l1', technicianId: 'sam', technicianName: 'Sam Lee', servicesCount: 8, grossSalesCents: 100000, commissionType: 'canonical', commissionValue: 0, commissionCents: 50000, tipsCents: 15000,
  adjustmentCents: 0, payableCents: 65000, netCents: 65000, paidCents: 0, outstandingCents: 65000 };
const detail = (status: string, extra: Record<string, unknown> = {}) => ({ period: P(status, extra), lines: [LINE], payouts: [], totals: { payableCents: 65000, paidCents: 0, outstandingCents: 65000 } });
const api = posPayrollApi as any;

beforeEach(() => {
  vi.clearAllMocks();
  api.getState.mockResolvedValue({ kpis: { totalPeriods: 1, openPeriods: 1, unpaidPayableCents: 130000, lifetimePayableCents: 130000, lifetimeCommissionCents: 100000, lifetimeTipsCents: 30000 }, periods: [P('review')], pagination: {} });
  api.getPeriod.mockResolvedValue(detail('review'));
  api.validation.mockResolvedValue({ ok: true, blocking: 0, warnings: 1, issues: [{ code: 'PENDING_ADJUSTMENTS', severity: 'warning', message: 'Some adjustments are waiting for a decision.', count: 1 }] });
  api.exportHistory.mockResolvedValue([]); api.provider.mockResolvedValue({ configured: false, provider: null, capabilities: [], reason: 'none' });
  api.adjustments.mockResolvedValue([]); api.exceptions.mockResolvedValue([]); api.inquiries.mockResolvedValue([]); api.payPlans.mockResolvedValue([]); api.deductionTypes.mockResolvedValue([]);
});


afterEach(async () => { await setLanguage('en'); });
// data: period label, technician names, the server's validation message (the API's own English; errors.<CODE> covers coded errors)
const DATA = ['Jun', 'Sam Lee', 'Ava Kim', 'SL', 'Some adjustments are waiting for a decision.'];

describe('POSPayrollScreen in Vietnamese', () => {
  it('the period list and the open period read in Vietnamese', async () => {
    await setLanguage('vi');
    const { container } = render(<POSPayrollScreen />);
    fireEvent.click(await screen.findByText('Jun 1–15'));
    await screen.findByText('Sam Lee');
    await waitFor(() => expect(screen.getAllByText('Sẵn sàng duyệt').length).toBeGreaterThan(0));   // READY_TO_APPROVE
    for (const en of ['Ready to approve', 'In review', 'Payroll']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, DATA).join(' | ')).toBe('');
  });
});
