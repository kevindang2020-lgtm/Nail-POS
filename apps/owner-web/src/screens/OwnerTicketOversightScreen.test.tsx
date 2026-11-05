// OwnerTicketOversightScreen (owner, read-only): tenant + owner-branch scoped ticket list with status chips + search +
// pagination, and a tap-to-expand history (snapshot + service lines + revision timeline + lock/removed badges). Verifies
// row + badge + money rendering, the history drill-in call + render, a friendly 403, and that a status chip filters the
// query. Data is typed from /owner/tickets[/:id/history].
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: undefined }) }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/ownerApi', () => ({ ownerTicketsApi: { list: vi.fn(), history: vi.fn() } }));

import { ownerTicketsApi } from '../api/ownerApi';
import { OwnerTicketOversightScreen } from './OwnerTicketOversightScreen';

const row = (over: any = {}) => ({ ticketId: 'tk1', ticketNumber: '#3041', branchId: 'b1', status: 'paid', customerName: 'Grace Kim', technicianName: 'Mia', totalCents: 8000, version: 3, serviceDoneLocked: true, createdAt: '2026-06-01T15:00:00.000Z', paidAt: '2026-06-01T16:00:00.000Z', removedAt: null, ...over });
const listResp = (tickets: any[], total?: number) => ({ tickets, total: total ?? tickets.length, page: 1, pageSize: 25 });
const history = {
  ticket: { ...row(), subtotalCents: 7000, taxCents: 0, discountCents: 0, tipCents: 1000, servingStartedAt: null, serviceDoneAt: '2026-06-01T15:50:00.000Z' },
  lines: [{ serviceName: 'Gel X', priceCents: 6000, lineTotalCents: 6000, technicianName: 'Mia', status: 'completed', isAddOn: false }],
  revisions: [{ version: 1, action: 'service_added', actorRole: 'TECH', summary: 'Added Gel X', createdAt: '2026-06-01T15:10:00.000Z' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  (ownerTicketsApi.list as any).mockResolvedValue(listResp([
    row(),
    row({ ticketId: 'tk2', ticketNumber: '#3042', customerName: 'Removed Guy', serviceDoneLocked: false, removedAt: '2026-06-02T00:00:00.000Z', status: 'cancelled', totalCents: 4500 }),
  ]));
  (ownerTicketsApi.history as any).mockResolvedValue(history);
});

describe('OwnerTicketOversightScreen', () => {
  it('renders tickets with lock + removed badges and money', async () => {
    render(<OwnerTicketOversightScreen />);
    expect(await screen.findByText('#3041')).toBeInTheDocument();
    expect(screen.getByText('#3042')).toBeInTheDocument();
    expect(screen.getByText('🔒 Locked')).toBeInTheDocument();
    expect(screen.getByText('Removed')).toBeInTheDocument();
    expect(screen.getByText('$80.00')).toBeInTheDocument();
    expect(screen.getByText('$45.00')).toBeInTheDocument();
  });

  it('loads ticket history when a row is tapped', async () => {
    render(<OwnerTicketOversightScreen />);
    fireEvent.click(await screen.findByText('#3041'));
    await waitFor(() => expect(ownerTicketsApi.history).toHaveBeenCalledWith('tk1'));
    expect(await screen.findByText('Gel X')).toBeInTheDocument();
    expect(screen.getByText(/service added/i)).toBeInTheDocument();
  });

  it('shows a friendly message on 403', async () => {
    (ownerTicketsApi.list as any).mockRejectedValue({ status: 403 });
    render(<OwnerTicketOversightScreen />);
    expect(await screen.findByText(/do not have access to ticket oversight/i)).toBeInTheDocument();
  });

  it('filters by status when a chip is tapped', async () => {
    render(<OwnerTicketOversightScreen />);
    await screen.findByText('#3041');
    fireEvent.click(screen.getByText('Paid'));
    await waitFor(() => expect((ownerTicketsApi.list as any).mock.calls.some((c: any[]) => c[0]?.status === 'paid')).toBe(true));
  });

  it('passes the created-date range to the API', async () => {
    render(<OwnerTicketOversightScreen />);
    await screen.findByText('#3041');
    fireEvent.change(screen.getByLabelText('Created from'), { target: { value: '2026-06-01' } });
    await waitFor(() => expect((ownerTicketsApi.list as any).mock.calls.some((c: any[]) => c[0]?.dateFrom === '2026-06-01')).toBe(true));
  });

  it('applies the 7d date preset to the API', async () => {
    render(<OwnerTicketOversightScreen />);
    await screen.findByText('#3041');
    fireEvent.click(screen.getByText('7d'));
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const from = new Date(); from.setDate(from.getDate() - 6);
    await waitFor(() => expect((ownerTicketsApi.list as any).mock.calls.some((c: any[]) => c[0]?.dateFrom === ymd(from) && c[0]?.dateTo === ymd(new Date()))).toBe(true));
  });
});
