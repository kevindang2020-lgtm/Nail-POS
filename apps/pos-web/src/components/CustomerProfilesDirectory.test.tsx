// Customer Profiles SUNMI (Nov 9 2026): three metrics, view modes over one search model, equal cards, Quick View four tabs.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ summary: vi.fn(), customers: vi.fn(), detail: vi.fn(), quick: vi.fn() }));
vi.mock('../api/posCustomerSearchApi', () => ({ posCustomerSearchApi: { summary: m.summary, customers: m.customers } }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { getDetail: m.detail, quickActivity: m.quick } }));
import { CustomerProfilesDirectory, CustomerQuickView } from './CustomerProfilesDirectory';

const row = (i: number) => ({ id: `c${i}`, name: `Guest ${i}`, phone: '•••1234', visits: i, lastVisitAt: '2026-11-01T15:00:00Z', lifecycle: 'active', member: i === 1, nextAppointment: null, sharedContactProfiles: i === 2 ? 1 : 0 });
beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.summary.mockResolvedValue({ kpis: { customers: 120, active: 40, sharedContactProfiles: 3 }, definitions: { activeDays: 60 } });
  m.customers.mockResolvedValue({ items: Array.from({ length: 8 }, (_, i) => row(i + 1)), total: 120, page: 1, pageSize: 25, pageCount: 5 });
});

describe('Customer Profiles directory', () => {
  it('three metrics and eight equal cards from the server list (newest first)', async () => {
    render(<MemoryRouter><CustomerProfilesDirectory onOpen={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('cpx-kpi-total').textContent).toContain('120'));
    expect(screen.getByTestId('cpx-kpi-active').textContent).toContain('40');
    expect(screen.getByTestId('cpx-kpi-review').textContent).toContain('3');
    expect(await screen.findAllByTestId('cpx-card')).toHaveLength(8);
    expect(m.customers).toHaveBeenCalledWith(expect.objectContaining({ status: 'all', sort: 'newest', page: 1, pageSize: 25 }));
  });
  it('view modes drive the same search model; a filter change goes back to page 1', async () => {
    render(<MemoryRouter><CustomerProfilesDirectory onOpen={() => {}} /></MemoryRouter>);
    await screen.findAllByTestId('cpx-card');
    fireEvent.click(screen.getByTestId('cpx-view-review'));
    await waitFor(() => expect(m.customers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'duplicate', page: 1 })));
    fireEvent.click(screen.getByTestId('cpx-view-active'));
    await waitFor(() => expect(m.customers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active', sort: 'last_visit' })));
    fireEvent.change(screen.getByTestId('cpx-datefield'), { target: { value: 'appointment' } });
    await waitFor(() => expect(m.customers).toHaveBeenLastCalledWith(expect.objectContaining({ dateField: 'appointment', page: 1 })));
  });
  it('a card opens the Quick View for that customer id', async () => {
    const open = vi.fn();
    render(<MemoryRouter><CustomerProfilesDirectory onOpen={open} /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('cpx-card'))[0]);
    expect(open).toHaveBeenCalledWith({ id: 'c1', name: 'Guest 1' });
  });
});

describe('Customer 360 Quick View', () => {
  it('four tabs from the same detail read; Full View hands back', async () => {
    m.detail.mockResolvedValue({ displayName: 'Ana Rivera', status: 'active', loyaltyTier: 'Gold', phone: '555', visitCount: 7, totalSpendCents: 84000, averageSpendCents: 12000,
      loyalty: { points: 320, earned: 500, redeemed: 180, tier: 'Gold' }, membership: { plan: 'VIP Monthly', status: 'active', benefits: [] }, giftCards: [],
      recentVisits: [{ visitId: 'v1', date: '2026-07-01', serviceName: 'Gel Manicure', technicianName: 'Ben', totalCents: 6800, tipCents: 0 }],
      notes: { warnings: 'Avoid e-file', allergyNotes: 'Latex' } });
    const full = vi.fn();
    render(<MemoryRouter><CustomerQuickView customer={{ id: 'c1', name: 'Ana Rivera' }} onClose={() => {}} onFullView={full} /></MemoryRouter>);
    await waitFor(() => expect(m.detail).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText('$840.00')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cpx-tab-loyalty')); expect(await screen.findByText(/VIP Monthly/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cpx-tab-visits')); expect(await screen.findByText('Gel Manicure')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cpx-tab-notes')); expect(within(screen.getByTestId('cpx-panel-notes')).getByText('Latex')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cpx-full')); expect(full).toHaveBeenCalled();
  });
  it('extras Customer 03: Receipts & Activity tab reads the read-only staff endpoint once; no print / resend controls', async () => {
    m.detail.mockResolvedValue({ displayName: 'Ana Rivera', status: 'active', visitCount: 1, loyalty: {}, membership: {}, giftCards: [], recentVisits: [], notes: {} });
    m.quick.mockResolvedValue({ customerId: 'c1', receiptsTotal: 12, limit: { receipts: 10, activity: 15 },
      receipts: [{ receiptId: 'r1', receiptNumber: 'R-1', ticketId: 't1', date: '2026-11-12T15:00:00Z', totalCents: 6800, channel: 'email' }],
      activity: [{ at: '2026-11-12T16:00:00Z', kind: 'profile', code: 'pos_customer_notes_updated', actorName: 'Owner Kim', amountCents: null, refId: null },
        { at: '2026-11-12T15:00:00Z', kind: 'receipt', code: 'receipt_issued', actorName: null, amountCents: 6800, refId: 'r1' }] });
    const full = vi.fn();
    render(<MemoryRouter><CustomerQuickView customer={{ id: 'c1', name: 'Ana Rivera' }} onClose={() => {}} onFullView={full} /></MemoryRouter>);
    await waitFor(() => expect(m.detail).toHaveBeenCalled());
    expect(m.quick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('cpx-tab-activity'));
    const panel = await screen.findByTestId('cpx-activity');
    expect(m.quick).toHaveBeenCalledWith('c1');
    expect(within(panel).getByTestId('cpx-receipt')).toHaveTextContent('R-1');
    expect(within(panel).getByTestId('cpx-receipt')).toHaveTextContent('Emailed');
    const items = within(panel).getAllByTestId('cpx-activity-item');
    expect(items[0]).toHaveTextContent('Owner Kim'); expect(items[1]).toHaveTextContent('Receipt issued · $68.00');
    expect(within(panel).queryByText(/print|resend/i)).toBeNull();
    fireEvent.click(within(panel).getByTestId('cpx-receipts-more')); expect(full).toHaveBeenCalled();
  });
  it('extras Customer 05: advisory follow-up status from the server — upcoming, overdue follow-ups, contact gaps; unknown stays "—"', async () => {
    const base = { displayName: 'Ana Rivera', status: 'active', visitCount: 1, loyalty: {}, membership: {}, giftCards: [], recentVisits: [], notes: {} };
    m.detail.mockResolvedValue({ ...base, followUpStatus: { upcoming: { count: 2, nextDate: '2026-11-15', nextTime: '14:00' }, followUps: { active: 2, overdue: 1, nextDueAt: '2026-11-12T13:00:00Z' }, contact: { hasPhone: true, phoneVerified: false, hasEmail: false } } });
    const v = render(<MemoryRouter><CustomerQuickView customer={{ id: 'c1', name: 'Ana Rivera' }} onClose={() => {}} onFullView={() => {}} /></MemoryRouter>);
    expect(await screen.findByTestId('cpx-fu-upcoming')).toHaveTextContent('2 upcoming booking(s)');
    expect(screen.getByTestId('cpx-fu-tasks')).toHaveTextContent('1 overdue follow-up(s) of 2 open');
    expect(screen.getByTestId('cpx-fu-contact')).toHaveTextContent('Phone not verified · No email');
    expect(screen.getByTestId('cpx-panel-overview')).toHaveTextContent(/Nov 15.*14:00/);
    v.unmount();
    m.detail.mockResolvedValue({ ...base, followUpStatus: { upcoming: { count: 0, nextDate: null, nextTime: null }, followUps: null, contact: { hasPhone: true, phoneVerified: true, hasEmail: true } } });
    render(<MemoryRouter><CustomerQuickView customer={{ id: 'c1', name: 'Ana Rivera' }} onClose={() => {}} onFullView={() => {}} /></MemoryRouter>);
    expect(await screen.findByTestId('cpx-fu-tasks')).toHaveTextContent('Follow-ups: —');
    expect(screen.getByTestId('cpx-fu-upcoming')).toHaveTextContent('No upcoming booking');
    expect(screen.getByTestId('cpx-fu-contact')).toHaveTextContent('Contact details complete');
  });
});
