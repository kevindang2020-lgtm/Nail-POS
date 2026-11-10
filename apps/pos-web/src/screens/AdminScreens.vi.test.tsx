// AdminScreens.vi.test — English + Vietnamese POS mandate (WP-C4): management screens render in Vietnamese with no
// leftover English in what staff read — Approvals (kind / status / why-not labels were English maps), Sales Report (period
// tabs, KPI cards), Locations (KPI cards, editor fields) — and the AI-scheduling settings summary follows an instant switch
// (its memo used to keep the old language). Data the salon typed (names, titles, reasons) stays as typed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';

vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
const approvals = vi.hoisted(() => ({ list: vi.fn(), one: vi.fn(), create: vi.fn(), decide: vi.fn(), cancel: vi.fn(), policies: vi.fn(), updatePolicy: vi.fn() }));
vi.mock('../api/posApprovalsApi', async (orig) => ({ ...(await orig<any>()), posApprovalsApi: approvals }));
const reports = vi.hoisted(() => ({ state: vi.fn(), sales: vi.fn(), exportReport: vi.fn(async () => ({})) }));
vi.mock('../api/posReportsApi', () => ({ posReportsApi: reports }));
const locations = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../api/posLocationsApi', () => ({ posLocationsApi: locations }));
const sched = vi.hoisted(() => ({ settingsVersions: vi.fn() }));
vi.mock('../api/posAiSchedulingOptimizerApi', () => ({ posAiSchedulingOptimizerApi: sched }));

import { POSApprovalsScreen } from './approvals/POSApprovalsScreen';
import { POSSalesReportScreen } from './POSSalesReportScreen';
import { TenantLocationsScreen } from './TenantLocationsScreen';
import { SchedSettingsCard } from './ai-scheduling/SchedSettingsCard';

const req = (over: Record<string, unknown> = {}) => ({
  id: 'a1', kind: 'discount_override', status: 'pending', branchId: 'b1', branchName: 'Main', subjectType: 'request', subjectId: null, title: 'Discount for Mai', amountCents: 8000,
  requestedByUserId: 'u-fd', requestedByName: 'Fran', reason: 'Loyal guest', decidedByName: null, decidedAt: null, decisionNote: null,
  requiredPermission: 'checkout.approve_refund', canDecide: false, whyNot: 'over_your_limit', expiresAt: '2026-10-09T12:00:00.000Z', createdAt: '2026-10-08T12:00:00.000Z', version: 1, payload: {}, ...over,
});

beforeEach(() => { vi.clearAllMocks(); });
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });

describe('Management screens in Vietnamese (WP-C4)', () => {
  it('Approvals: kind, status and the why-not are Vietnamese; English labels gone', async () => {
    await setLanguage('vi');
    approvals.list.mockResolvedValue({ items: [req()], page: 1, pageSize: 50, total: 1, hasMore: false });
    const { container } = render(<MemoryRouter><POSApprovalsScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Discount for Mai')).toBeInTheDocument());
    expect(screen.getByText(/Ghi đè giảm giá · Đang chờ/)).toBeInTheDocument();
    expect(screen.getByText('Số tiền này vượt hạn mức duyệt của bạn — chủ tiệm phải duyệt.')).toBeInTheDocument();
    for (const en of ['Discount override', 'Waiting', 'This amount is over your approval limit — the owner has to approve it.']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, ['Discount for Mai', 'Fran', 'Main', 'Loyal guest']).join(' | ')).toBe('');
  });

  it('Sales Report: period tabs and KPI cards are Vietnamese', async () => {
    await setLanguage('vi');
    reports.state.mockResolvedValue({
      salesKpis: { grossSalesCents: 9000, netSalesCents: 8500, serviceSalesCents: 7000, productSalesCents: 2000, tipsCents: 1500, taxCollectedCents: 800, cardSurchargeCents: 0, discountsCents: 0, refundsCents: 0, ticketsCount: 12, customersCount: 9, averageTicketCents: 750 },
      salesTrend: { points: [{ label: 'Wk1', grossSalesCents: 4000, netSalesCents: 3800 }] },
      revenueByService: [{ serviceId: 's1', serviceName: 'Gel Manicure', revenueCents: 6500, serviceCount: 5, percentOfTop: 100 }],
    });
    const { container } = render(<MemoryRouter><POSSalesReportScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Gel Manicure').length).toBeGreaterThan(0));
    expect(screen.getByTestId('preset-year')).toHaveTextContent(/Năm/);
    expect(screen.getAllByText('Doanh số gộp').length).toBeGreaterThan(0);
    for (const en of ['This Year', 'Gross Sales', 'Avg Ticket']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, ['Gel Manicure', 'Wk']).join(' | ')).toBe('');
  });

  it('Locations: KPI cards and the editor fields are Vietnamese', async () => {
    await setLanguage('vi');
    const loc = { id: 'l1', tenant_id: 't1', name: 'Downtown', public_display_name: 'Lotus Downtown', verification_status: 'verified', is_public: true };
    locations.list.mockResolvedValue({ locations: [loc], summary: { total: 1, active: 1, published: 1, unverified: 0, missingPins: 0, acceptingBookings: 1 } });
    render(<MemoryRouter><TenantLocationsScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Tổng số chi nhánh')).toBeInTheDocument());
    for (const en of ['Total Locations', 'Missing Map Pins', 'Accepting Bookings']) expect(screen.queryByText(en), en).toBeNull();
  });

  it('AI scheduling settings: the "right now" summary follows an instant switch (no stale memo)', async () => {
    sched.settingsVersions.mockResolvedValue([]);
    const config = { automationEnabled: false, allowedAutoActions: ['add_internal_warning'], confidenceThreshold: 0.85, weights: { preferredTimeProximity: 1, waitReduction: 1, gapFit: 1, preferencePreservation: 1, utilization: 1, fragmentation: 1, overtimeAvoidance: 1, workloadBalance: 1, idleReduction: 1 }, gapMinServiceMin: 30, largeBlockMin: 90, utilizationTargetPct: 80, bookingIntervalMin: 15, minLeadTimeMin: 60, maxHorizonDays: 14, humanReviewRequired: true, recommendationTtlMin: 30, proposalTtlHours: 24 };
    const view: any = { effective: { enabled: true, killed: false, platformKilled: false, automationAllowed: false, config }, tenant: null, branch: null };
    render(<SchedSettingsCard tick={0} can={() => false} onChanged={() => {}} view={view} reload={() => {}} />);
    const eff = await screen.findByTestId('sched-effective');
    expect(eff.textContent).toMatch(/enabled · automation off/);
    await act(async () => { await setLanguage('vi'); });
    expect(screen.getByTestId('sched-effective').textContent).toMatch(/đã bật · tắt tự động hóa/);
    expect(screen.getByTestId('sched-effective').textContent).not.toMatch(/enabled|automation off/);
  });
});
