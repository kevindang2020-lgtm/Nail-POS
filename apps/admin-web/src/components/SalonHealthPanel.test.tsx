import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { tenantHealthList: vi.fn() } }));
import { superAdminApi } from '../api/superAdminApi';
import { SalonHealthPanel } from './SalonHealthPanel';

const row = (id: string, name: string, overall: string, payments = overall) => ({ tenantId: id, tenantName: name, observedAt: '2026-09-27T11:05:00.000Z', overall,
  components: { payments, messaging: 'HEALTHY', booking: 'HEALTHY', devices: 'UNKNOWN', jobs: 'HEALTHY' }, realtime: null, failedQueries: [] });
function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }

describe('Salon Health (Constitution 11 §156)', () => {
  beforeEach(() => { vi.clearAllMocks(); (superAdminApi.tenantHealthList as any).mockResolvedValue({ rows: [row('t2', 'Bravo Spa', 'OUTAGE'), row('t1', 'Alpha Nails', 'HEALTHY')], generatedAt: 'x' }); });

  it('lists every salon with its overall and each component, worst first by default; unused reads "Not in use"', async () => {
    render(<MemoryRouter><SalonHealthPanel /></MemoryRouter>);
    const panel = await screen.findByTestId('salon-health');
    await waitFor(() => expect(within(panel).getByText('Bravo Spa')).toBeInTheDocument());
    const rows = within(panel).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Bravo Spa')).toBeInTheDocument();
    expect(within(rows[0]).getAllByText('Outage')).toHaveLength(2);           // overall + payments
    expect(within(rows[1]).getByText('Not in use')).toBeInTheDocument();       // devices UNKNOWN is not "Healthy"
    expect(superAdminApi.tenantHealthList).toHaveBeenCalledWith('worst', undefined);
  });

  it('re-reads with the chosen sort and status filter', async () => {
    render(<MemoryRouter><SalonHealthPanel /></MemoryRouter>);
    await screen.findByText('Bravo Spa');
    fireEvent.change(screen.getByLabelText('Sort salons'), { target: { value: 'name' } });
    await waitFor(() => expect(superAdminApi.tenantHealthList).toHaveBeenLastCalledWith('name', undefined));
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'OUTAGE' } });
    await waitFor(() => expect(superAdminApi.tenantHealthList).toHaveBeenLastCalledWith('name', 'OUTAGE'));
  });

  it('clicking a salon opens it on the Tenants page', async () => {
    render(<MemoryRouter initialEntries={['/system-status']}><Routes><Route path="*" element={<><SalonHealthPanel /><Where /></>} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByText('Bravo Spa'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/tenants?tenantId=t2'));
  });

  it('says so honestly when there are no snapshots yet, and when the read fails', async () => {
    (superAdminApi.tenantHealthList as any).mockResolvedValueOnce({ rows: [], generatedAt: 'x' });
    const { unmount } = render(<MemoryRouter><SalonHealthPanel /></MemoryRouter>);
    expect(await screen.findByText('No snapshots yet — the hourly sweep has not run.')).toBeInTheDocument();
    unmount();
    (superAdminApi.tenantHealthList as any).mockRejectedValueOnce(new Error('boom'));
    render(<MemoryRouter><SalonHealthPanel /></MemoryRouter>);
    expect(await screen.findByText('Salon health could not be read right now.')).toBeInTheDocument();
  });
  it('§290: shows "showing N of total" and loads the next page on request', async () => {
    (superAdminApi.tenantHealthList as any)
      .mockResolvedValueOnce({ rows: [row('t2', 'Bravo Spa', 'OUTAGE')], generatedAt: 'x', total: 2, nextCursor: 'c1' })
      .mockResolvedValueOnce({ rows: [row('t1', 'Alpha Nails', 'HEALTHY')], generatedAt: 'x', total: 2, nextCursor: null });
    render(<MemoryRouter><SalonHealthPanel /></MemoryRouter>);
    expect(await screen.findByText(/showing 1 of 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(superAdminApi.tenantHealthList).toHaveBeenLastCalledWith('worst', undefined, 'c1'));
    expect(await screen.findByText('Alpha Nails')).toBeInTheDocument();
    expect(screen.getByText(/showing 2 of 2/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});
