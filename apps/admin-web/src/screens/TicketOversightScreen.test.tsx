import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({
  superAdminApi: {
    tickets: vi.fn().mockResolvedValue({
      ok: true, page: 1, pageSize: 25, total: 2,
      tickets: [
        { ticketId: 'tk1', ticketNumber: '#3041', tenantId: 't1', tenantName: 'Luxe Nails', status: 'paid', customerName: 'Grace Kim', technicianName: 'Mia Tran', totalCents: 8000, version: 3, serviceDoneLocked: true, lockedAt: '2026-06-01T01:00:00.000Z', createdAt: '2026-06-01T00:00:00.000Z', paidAt: '2026-06-01T01:05:00.000Z', removedAt: null },
        { ticketId: 'tk2', ticketNumber: '#3042', tenantId: 't2', tenantName: 'Polish Bar', status: 'cancelled', customerName: 'Nora Patel', technicianName: 'Ava Nguyen', totalCents: 5500, version: 5, serviceDoneLocked: false, lockedAt: null, createdAt: '2026-06-02T00:00:00.000Z', paidAt: null, removedAt: '2026-06-03T00:00:00.000Z' },
      ],
    }),
    ticketHistory: vi.fn().mockResolvedValue({
      ok: true,
      ticket: { ticketId: 'tk1', ticketNumber: '#3041', tenantId: 't1', tenantName: 'Luxe Nails', status: 'paid', customerName: 'Grace Kim', technicianName: 'Mia Tran', totalCents: 8000, version: 3, serviceDoneLocked: true, lockedAt: '2026-06-01T01:00:00.000Z', createdAt: '2026-06-01T00:00:00.000Z', paidAt: '2026-06-01T01:05:00.000Z', removedAt: null, subtotalCents: 7000, taxCents: 0, discountCents: 0, tipCents: 1000, servingStartedAt: null, serviceDoneAt: '2026-06-01T01:00:00.000Z', lockedByUserId: 'u_mgr', lockedTotalCents: 7000 },
      lines: [{ serviceName: 'Gel Manicure', priceCents: 5500, lineTotalCents: 5500, technicianName: 'Mia Tran', status: 'completed', isAddOn: false }],
      revisions: [{ version: 1, action: 'service_added', serviceLineId: 'l1', actorUserId: 'u', actorRole: 'TECH', before: null, after: {}, summary: 'Added Gel Manicure', createdAt: '2026-06-01T00:30:00.000Z' }],
    }),
    generateDeletionCode: vi.fn().mockResolvedValue({ ok: true, generated: true }),
    revealDeletionCode: vi.fn().mockResolvedValue({ ok: true, code: '123456' }),
    removeTicket: vi.fn().mockResolvedValue({ ok: true, removed: true }),
  },
}));

import { TicketOversightScreen } from './TicketOversightScreen';
import { superAdminApi } from '../api/superAdminApi';

describe('TicketOversightScreen — read-only platform ticket oversight (P7)', () => {
  it('renders the list from real data, flags removed tickets, and drills into the revision timeline', async () => {
    render(<MemoryRouter><TicketOversightScreen /></MemoryRouter>);
    expect(await screen.findByText('Ticket Oversight')).toBeInTheDocument();
    // rows from real data
    expect(await screen.findByText('#3041')).toBeInTheDocument();
    expect(screen.getByText('Luxe Nails')).toBeInTheDocument();
    expect(screen.getByText('Grace Kim')).toBeInTheDocument();
    // removed ticket flagged
    expect(screen.getAllByText('Removed').length).toBeGreaterThanOrEqual(1);
    // filtered total in the stat strip
    expect(screen.getByText('Total Tickets')).toBeInTheDocument();

    // drill into history
    fireEvent.click(screen.getByText('#3041'));
    expect(await screen.findByText('Service Added')).toBeInTheDocument();    // revision action label
    expect(screen.getByText('Added Gel Manicure')).toBeInTheDocument();       // revision summary
    expect(screen.getByText('Revision Timeline')).toBeInTheDocument();
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();             // service line
  });

  it('runs the gated deletion flow: generate → reveal → confirm with code + reason → remove', async () => {
    render(<MemoryRouter><TicketOversightScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('#3041'));                          // non-removed ticket → Danger Zone shows
    fireEvent.click(await screen.findByText('Generate authorization code'));
    fireEvent.click(await screen.findByText('Reveal code'));
    expect(await screen.findByText('123456')).toBeInTheDocument();             // revealed code
    fireEvent.change(screen.getByPlaceholderText('Enter 6-digit code'), { target: { value: '123456' } });
    fireEvent.change(screen.getByPlaceholderText(/Reason for removal/), { target: { value: 'Duplicate ticket created in error' } });
    fireEvent.click(screen.getByText('Remove ticket'));
    expect(await screen.findByText('Ticket removed')).toBeInTheDocument();      // honest post-removal confirmation
  });

  it('passes the created-date range to the API', async () => {
    render(<MemoryRouter><TicketOversightScreen /></MemoryRouter>);
    await screen.findByText('#3041');
    fireEvent.change(screen.getByLabelText('Created from'), { target: { value: '2026-06-01' } });
    await waitFor(() => expect((superAdminApi.tickets as any).mock.calls.some((c: any[]) => c[0]?.dateFrom === '2026-06-01')).toBe(true));
  });

  it('applies the 7d date preset to the API', async () => {
    render(<MemoryRouter><TicketOversightScreen /></MemoryRouter>);
    await screen.findByText('#3041');
    fireEvent.click(screen.getByText('7d'));
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const from = new Date(); from.setDate(from.getDate() - 6);
    await waitFor(() => expect((superAdminApi.tickets as any).mock.calls.some((c: any[]) => c[0]?.dateFrom === ymd(from) && c[0]?.dateTo === ymd(new Date()))).toBe(true));
  });
});
