// POSServingScreen.vi.test — English + Vietnamese POS mandate (WP-C1): Serving and Service Done read in Vietnamese — KPI
// lines, the progress board, a ticket's stage and the staff table (from the server's board words, labelled here), the AI
// insights written from their id + numbers, and the queue's row action. Names and services the salon typed stay as typed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage, useLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
import { POSServingScreen } from './POSServingScreen';
import { POSServiceDoneScreen } from './POSServiceDoneScreen';

vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } } as any);
const byUrl = (map: Record<string, unknown>) => vi.fn(async (url: any) => { const u = String(url); for (const k of Object.keys(map)) if (u.includes(k)) return ok(map[k]); return ok({}); });
const staff = [
  { technicianId: 's1', name: 'Trần Mỹ Linh', specialty: 'Gel', currentLoad: 1, nextAvailable: 'Soon', status: 'Finishing Soon' },
  { technicianId: 's2', name: 'Lan Vo', specialty: 'Acrylic', currentLoad: 0, nextAvailable: 'Now', status: 'Available' },
];
const serving = {
  kpis: { servingNow: 2, activeTickets: 2, delayedServices: 1, nearingCompletion: 1, averageServiceDurationMinutes: 40, totalInServiceSalesCents: 12000, techniciansInService: 2, techniciansTotal: 4, servicesCompletedToday: 5, addOnAttachRatePercent: 40, addOnRevenueCents: 3000, customerSatisfactionAvg: 4.7, onTimeCompletionPercent: 82 },
  tickets: { items: [
    { ticketId: 't1', ticketNumber: 'A1', customerName: 'Nguyễn Thị Hương', isVip: true, serviceNames: ['Gel Manicure'], primaryTechnicianName: 'Trần Mỹ Linh', elapsedMinutes: 36, estimatedDurationMinutes: 30, subtotalCents: 9500, status: 'in_progress', stage: 'Quality Check' },
    { ticketId: 't2', ticketNumber: 'A2', customerName: 'Mai Pham', serviceNames: ['Gel Manicure'], primaryTechnicianName: 'Lan Vo', elapsedMinutes: 10, estimatedDurationMinutes: 45, subtotalCents: 6000, status: 'in_progress', stage: 'Drying' },
  ], pagination: { totalItems: 2 } },
  filters: { statuses: [], technicians: [], serviceCategories: [], stations: [], delayStatuses: [] },
  staff,
  insights: [
    { id: 'overtime', text: '1 service is nearing overtime duration', sub: 'Review and rebalance now.', action: 'Review Now', route: '/serving', severity: 'warn', vars: { count: 1 } },
    { id: 'vip', text: 'Nguyễn Thị Hương should be checked by a manager', sub: 'Review VIP service quality.', action: 'Open Profile', route: '/customers', vars: { name: 'Nguyễn Thị Hương' } },
  ],
};
const done = {
  kpis: { completedServicesToday: 10, ticketsReadyForReview: 2, ticketsReadyForCheckout: 3, qualityIssuesCount: 1, reopenedServicesToday: 1, averageServiceDurationMinutes: 45, estimatedSalesCents: 50000, estimatedCommissionCents: 12000, addOnRevenueCents: 3500, averageTurnaroundSeconds: 360, customerSatisfactionAvg: 4.6, tipsCapturedCents: 4250, rebookingRatePercent: 67 },
  tickets: { items: [
    { ticketId: 'd1', ticketNumber: 'A1', customerName: 'Nguyễn Thị Hương', isVip: true, serviceCount: 1, serviceNames: ['Gel Manicure'], primaryTechnicianName: 'Trần Mỹ Linh', qualityStatus: 'needs_review', checkoutStatus: 'ready', status: 'completed', subtotalCents: 9500 },
    { ticketId: 'd2', ticketNumber: 'A2', customerName: 'Mai Pham', serviceCount: 1, serviceNames: ['Gel Manicure'], primaryTechnicianName: 'Lan Vo', qualityStatus: 'ok', checkoutStatus: 'ready_for_checkout', status: 'completed', subtotalCents: 6000 },
  ], pagination: { totalItems: 2 } },
  filters: { statuses: [], technicians: [], serviceCategories: [], qualityStatuses: [], stations: [] },
  staff,
  insights: [
    { id: 'delayed', text: '2 completed guests ready for checkout', action: 'Review Now', route: '/service-done', vars: { count: 2 } },
    { id: 'vip', text: 'Nguyễn Thị Hương is a VIP guest', sub: 'Prompt rebooking before checkout.', action: 'Open Profile', route: '/customers', vars: { name: 'Nguyễn Thị Hương' } },
  ],
};
const NAMES = ['Nguyễn Thị Hương', 'Mai Pham', 'Lan Vo', 'Trần Mỹ Linh', 'Gel Manicure', 'Gel', 'Acrylic', 'A1', 'A2', 'NT', 'MP', 'TM', 'LV'];   // + avatar initials

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });

describe('Serving / Service Done in Vietnamese (WP-C1)', () => {
  it('Serving: stages, staff, KPI lines and AI insights are Vietnamese', async () => {
    await setLanguage('vi');
    globalThis.fetch = byUrl({ '/pos/serving': serving, '/pos/technicians/state': { rows: { items: [] } } }) as any;
    const { container } = render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    await screen.findAllByText('Nguyễn Thị Hương');
    for (const vi of ['Kiểm tra chất lượng', 'Đang hong khô', '1 dịch vụ đã quá thời gian dự kiến', 'Quản lý nên ghé xem Nguyễn Thị Hương', 'Xem ngay', 'Mở hồ sơ', 'Đã dùng 50% công suất'])
      expect(screen.getAllByText(vi).length, vi).toBeGreaterThan(0);
    // The staff table no longer has a "next available" column (Soon → "Sắp rảnh" / Now → "Ngay bây giờ"); it shows each
    // technician's load and status chip, and the status chip is the server's board word labelled in Vietnamese.
    const staffPanel = within(screen.getByTestId('sv-staff'));
    expect(staffPanel.getByText('Sắp xong')).toBeInTheDocument();     // 'Finishing Soon'
    expect(staffPanel.getByText('Có thể phục vụ')).toBeInTheDocument();   // 'Available'
    for (const en of ['Quality Check', 'Drying', 'Available', 'Review Now', 'Open Profile', 'In Progress', '50% utilized', 'vs 30 min ago']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
  });

  it('Service Done: the row action, staff and AI insights are Vietnamese', async () => {
    await setLanguage('vi');
    globalThis.fetch = byUrl({ '/pos/service-done': done }) as any;
    const { container } = render(<MemoryRouter><POSServiceDoneScreen /></MemoryRouter>);
    await screen.findAllByText('Nguyễn Thị Hương');
    for (const vi of ['2 khách đã làm xong, chờ thanh toán', 'Nguyễn Thị Hương là khách VIP', 'Mời khách đặt lịch lại trước khi thanh toán.', 'Sắp xong'])
      expect(screen.getAllByText(vi).length, vi).toBeGreaterThan(0);
    for (const en of ['Review', 'Open', 'Finishing Soon', 'Available', 'Review Now']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
  });
});

// Vietnamese POS leftover (Oct 27 2026): the change history's summaries are server text — they arrive as code + vars
// (derived at read time from the stored action + before / after) and read in Vietnamese; the stored English is the
// fallback; the actor's role is labelled.
describe('Serving change history in Vietnamese', () => {
  it('revision summaries from summaryCoded (incl. nested parts), role labelled, stored English when no code', async () => {
    await setLanguage('vi');
    const revisions = { ticketId: 't1', currentVersion: 4, revisions: [
      { version: 1, action: 'service_added', summary: 'Added Gel Manicure', summaryCoded: { code: 'SERVING_REV.ADDED', vars: { service: 'Gel Manicure' } }, actorRole: 'OWNER', createdAt: '2026-03-02T15:00:00Z' },
      { version: 2, action: 'service_updated', summary: 'Updated Gel Manicure: price 4500→5000¢, status assigned→serving',
        summaryCoded: { code: 'SERVING_REV.UPDATED_PARTS_2', vars: { service: 'Gel Manicure', n: 2, p0: '@srv.SERVING_REV.PART_PRICE#p0', p0_from: 4500, p0_to: 5000, p1: '@srv.SERVING_REV.PART_STATUS#p1', p1_from: '@status.techTicket.assigned', p1_to: '@status.techTicket.serving' } }, actorRole: 'manager', createdAt: '2026-03-02T15:01:00Z' },
      { version: 3, action: 'service_paused', summary: 'Paused after 12 min', summaryCoded: { code: 'SERVING_REV.PAUSED', vars: { minutes: 12 } }, actorRole: 'technician', createdAt: '2026-03-02T15:02:00Z' },
      { version: 4, action: 'legacy_thing', summary: 'A stored English summary', summaryCoded: null, actorRole: null, createdAt: '2026-03-02T15:03:00Z' },
    ] };
    globalThis.fetch = byUrl({ '/revisions': revisions, '/pos/serving': serving, '/pos/technicians/state': { rows: { items: [] } } }) as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    expect(await screen.findByText('Đã thêm Gel Manicure')).toBeInTheDocument();
    expect(screen.getByText('Đã cập nhật Gel Manicure: giá 4500→5000¢, trạng thái Đã chỉ định→Đang phục vụ')).toBeInTheDocument();
    expect(screen.getByText('Tạm dừng sau 12 phút')).toBeInTheDocument();
    expect(screen.getByText('A stored English summary')).toBeInTheDocument();   // no code → the stored text
    expect(screen.getAllByText(/· Chủ tiệm|· Quản lý|· Thợ/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/OWNER/)).toBeNull();
  });
});

// mandate §7 / §104 (Serving state preserved, report §126 J): a switch re-words the screen in place — the open Manage row
// with a half-typed delay reason and minutes, the selected ticket and the search stay; no extra request is sent.
describe('Serving across language switches', () => {
  it('the open Manage row, its typed reason / minutes and the search survive EN → VI → EN with no new request', async () => {
    const f = byUrl({ '/pos/serving': serving, '/pos/technicians/state': { rows: { items: [] } } });
    globalThis.fetch = f as any;
    function Live() { useLanguage(); return <POSServingScreen />; }
    render(<MemoryRouter><Live /></MemoryRouter>);
    await screen.findAllByText('Nguyễn Thị Hương');
    fireEvent.click(screen.getAllByRole('button', { name: 'Manage' })[0]);
    const reason = screen.getByPlaceholderText('Reason or note') as HTMLInputElement;
    fireEvent.change(reason, { target: { value: 'khách muốn thêm hoa' } });
    const minutes = screen.getByPlaceholderText('e.g. 15') as HTMLInputElement;
    fireEvent.change(minutes, { target: { value: '10' } });
    const calls0 = f.mock.calls.length;
    await act(async () => { await setLanguage('vi'); });
    expect(screen.getByPlaceholderText('VD: 15')).toBe(minutes);            // the same input node, re-worded in place
    expect(reason.value).toBe('khách muốn thêm hoa'); expect(minutes.value).toBe('10');
    expect(screen.getByRole('button', { name: 'Báo trễ' })).toBeInTheDocument();
    await act(async () => { await setLanguage('en'); });
    expect(screen.getByPlaceholderText('e.g. 15')).toBe(minutes);
    expect(reason.value).toBe('khách muốn thêm hoa');
    expect(f.mock.calls.length).toBe(calls0);                                 // a switch fetches nothing
  });
});
