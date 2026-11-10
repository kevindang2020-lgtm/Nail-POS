import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const servicesMock = vi.fn(), revMock = vi.fn(), techMock = vi.fn(), payMock = vi.fn();
vi.mock('../api/posReportsApi', () => ({
  posReportsApi: {
    state: vi.fn(), sales: vi.fn(), exportReport: vi.fn(),
    services: (...a: any[]) => servicesMock(...a),
    serviceRevenue: (...a: any[]) => revMock(...a),
    technicians: (...a: any[]) => techMock(...a),
    payments: (...a: any[]) => payMock(...a),
  },
}));

import { POSServicesReportScreen } from './POSServicesReportScreen';
import { POSTechniciansReportScreen } from './POSTechniciansReportScreen';
import { POSPaymentsReportScreen } from './POSPaymentsReportScreen';

beforeEach(() => { revMock.mockReset(); servicesMock.mockReset(); techMock.mockReset(); payMock.mockReset(); });

const rev = (over: Record<string, unknown> = {}) => ({
  period: { from: '2026-11-01', to: '2026-11-10', timezone: 'America/New_York' }, basis: 'paid_ticket_service_lines', asOf: '2026-11-10T20:00:00Z', filters: { q: null, category: null },
  totals: { grossCents: 21000, units: 5, lines: 5, tickets: 3, averageCents: 4200, ticketDiscountCents: 500, refundedCents: 0 },
  categories: [{ key: 'Nails', name: 'Nails', units: 3, grossCents: 12500, lines: 2, percentOfTop: 100, unmapped: false }, { key: '__no_lines__', name: '', units: 0, grossCents: 3000, lines: 1, percentOfTop: 24, unmapped: true }],
  history: { items: [{ id: 'l1', ticketId: 't3', ticketNumber: '5003', occurredAt: '2026-11-10T15:00:00Z', serviceId: null, serviceName: '', category: '', unmapped: true, noLines: true, technicianId: null, technician: '', customer: 'Ann N', units: 0, grossCents: 3000 },
    { id: 'l2', ticketId: 't2', ticketNumber: '5002', occurredAt: '2026-11-09T15:00:00Z', serviceId: 's1', serviceName: 'Classic Manicure', category: 'Nails', unmapped: false, technicianId: 'x', technician: 'Lisa T', customer: '', units: 2, grossCents: 8000 }], total: 60, page: 1, pageSize: 25 },
  customersVisible: true, ...over,
});
const at = (url = '/tenant/reports/services') => render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/tenant/reports/services" element={<POSServicesReportScreen />} /><Route path="/reports" element={<div>daily summary</div>} /></Routes></MemoryRouter>);

describe('POSServicesReportScreen — the expanded Revenue by Service workspace (batch 9 guide 2)', () => {
  it('shows categories, totals over every match and the newest-first lines, with N/A-free labels for the special buckets', async () => {
    revMock.mockResolvedValue(rev());
    at();
    expect(await screen.findByRole('heading', { name: 'Services Report' })).toBeInTheDocument();
    expect(screen.getByTestId('svc-kpi-sales')).toHaveTextContent('$210.00');
    expect(screen.getAllByText('No service lines recorded').length).toBeGreaterThan(0);
    expect(screen.getByText('Classic Manicure')).toBeInTheDocument();
    expect(screen.getByText('#5003')).toBeInTheDocument();
    expect(revMock).toHaveBeenCalledWith(expect.objectContaining({ preset: 'month', page: 1, pageSize: 25 }));
  });
  it('a category click filters the lines, shows a chip, and Clear all resets to page 1', async () => {
    revMock.mockResolvedValue(rev());
    at('/tenant/reports/services?preset=week&page=2');
    fireEvent.click(await screen.findByTestId('svc-bar-Nails'));
    await waitFor(() => expect(revMock).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'week', category: 'Nails', page: 1 })));
    expect(await screen.findByTestId('svc-chip-category')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('svc-clear-all'));
    await waitFor(() => expect(revMock).toHaveBeenLastCalledWith(expect.objectContaining({ category: undefined, page: 1 })));
  });
  it('search is debounced, server-side, and resets the page; paging keeps the filters', async () => {
    revMock.mockResolvedValue(rev());
    at('/tenant/reports/services?category=Nails');
    fireEvent.change(await screen.findByTestId('svc-search'), { target: { value: '714-555' } });
    await waitFor(() => expect(revMock).toHaveBeenLastCalledWith(expect.objectContaining({ q: '714-555', category: 'Nails', page: 1 })));
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    await waitFor(() => expect(revMock).toHaveBeenLastCalledWith(expect.objectContaining({ q: '714-555', category: 'Nails', page: 2 })));
  });
  it('hides the customer column without permission; an error clears the figures instead of showing stale ones', async () => {
    revMock.mockResolvedValueOnce(rev({ customersVisible: false }));
    at();
    expect(await screen.findByText(/Customer names are hidden/)).toBeInTheDocument();
    expect(screen.queryByText('Ann N')).toBeNull();
    revMock.mockRejectedValue({ status: 403 });
    fireEvent.click(screen.getByTestId('svc-bar-Nails'));
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
    expect(screen.queryByTestId('svc-kpi-sales')).toBeNull();
  });
  it('the empty period says so with its dates — never a fake $0 chart', async () => {
    revMock.mockResolvedValue(rev({ categories: [], totals: { grossCents: 0, units: 0, lines: 0, tickets: 0, averageCents: null, ticketDiscountCents: 0, refundedCents: 0 }, history: { items: [], total: 0, page: 1, pageSize: 25 } }));
    at();
    expect(await screen.findByTestId('svc-empty')).toHaveTextContent('2026-11-01');
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });
});

describe('POSTechniciansReportScreen (batch 9 guide 6)', () => {
  const techRows = [{ technicianId: 't1', rank: 1, name: 'Anna Tech', roleLabel: 'Technician', revenueCents: 120000, completedServices: 8, tickets: 6 },
    { technicianId: 't2', rank: 2, name: 'Bảo Ngọc', roleLabel: 'Technician', revenueCents: 40000, completedServices: 3, tickets: 2 },
    { technicianId: '__unassigned__', rank: 0, name: '', roleLabel: 'Technician', revenueCents: 1500, completedServices: 1, tickets: 1, unattributed: true }];
  const techAt = (url = '/tenant/reports/technicians') => render(<MemoryRouter initialEntries={[url]}><POSTechniciansReportScreen /></MemoryRouter>);
  it('keeps the cards, chart and leaderboard; named technicians only in the cards; the unassigned row stays visible', async () => {
    techMock.mockResolvedValue(techRows);
    techAt();
    expect(await screen.findByRole('heading', { name: 'Technicians Report' })).toBeInTheDocument();
    expect(screen.getByTestId('tech-kpi-rev')).toHaveTextContent('$1,600.00');
    expect(screen.getAllByText('No technician on the line').length).toBeGreaterThan(0);
    expect(screen.getByTestId('tech-basis')).toHaveTextContent('$15.00');
    expect(techMock).toHaveBeenCalledWith({ preset: 'month' });              // `preset`, not the ignored `period`
  });
  it('filters by name (accent-free), and a technician opens their own service lines', async () => {
    techMock.mockResolvedValue(techRows);
    revMock.mockResolvedValue({ period: { from: '2026-11-01', to: '2026-11-10', timezone: 'UTC' }, totals: { grossCents: 40000, units: 3, tickets: 2 }, history: { items: [], total: 0, page: 1, pageSize: 25 }, customersVisible: true });
    techAt();
    fireEvent.change(await screen.findByTestId('tech-filter'), { target: { value: 'bao' } });
    expect(screen.queryByText('Anna Tech', { selector: 'td' })).toBeNull();
    fireEvent.click(screen.getByTestId('tech-bar-t2'));
    expect(await screen.findByTestId('tech-detail')).toBeInTheDocument();
    await waitFor(() => expect(revMock).toHaveBeenCalledWith(expect.objectContaining({ technician: 't2', preset: 'month', page: 1 })));
    expect(await screen.findByTestId('tech-detail-totals')).toHaveTextContent('$400.00');
  });
});

describe('POSPaymentsReportScreen', () => {
  it('renders payment-method KPIs', async () => {
    payMock.mockResolvedValue({ cardCents: 90000, cashCents: 20000, giftCardCents: 5000, splitCount: 2, refundsCents: 1000, cardSurchargeCents: 300, processorStatus: 'Connected' });
    render(<POSPaymentsReportScreen />);
    expect(await screen.findByRole('heading', { name: 'Payments Report' })).toBeInTheDocument();
    expect(screen.getAllByText('$1,150.00').length).toBeGreaterThan(0); // total collected
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });
});
