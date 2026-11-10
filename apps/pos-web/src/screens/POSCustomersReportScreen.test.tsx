// batch 9 guide 7 (Nov 10 2026): the tabs drive the period; real changes or "no earlier period"; the period customer list
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const custMock = vi.fn(), stateMock = vi.fn(), getMock = vi.fn();
vi.mock('../api/posReportsApi', () => ({ posReportsApi: { customers: (...a: any[]) => custMock(...a), state: (...a: any[]) => stateMock(...a) } }));
vi.mock('../api/client', async (orig) => ({ ...(await orig() as any), api: { get: (...a: any[]) => getMock(...a) } }));
import { POSCustomersReportScreen } from './POSCustomersReportScreen';

const ins = (over: Record<string, unknown> = {}) => ({ newCustomers: 12, newCustomersTrendPercent: -50, returningCustomers: 30, returningCustomersTrendPercent: null, retentionRatePercent: 71.4, retentionRateTrendPercent: null, retentionReturned: 25, retentionCohort: 35, ...over });
const page = { items: [{ customerId: 'c1', customer: 'Ann N', phoneLast4: '0101', type: 'returning', visits: 2, lastVisitAt: '2026-11-09T15:00:00Z', netSalesCents: 9600 }], total: 1, page: 1, pageSize: 25, q: null, type: 'all', from: '2026-11-01', to: '2026-11-10', timezone: 'America/New_York', moneyVisible: true };
const at = (url = '/tenant/reports/customers') => render(<MemoryRouter initialEntries={[url]}><POSCustomersReportScreen /></MemoryRouter>);
beforeEach(() => { custMock.mockReset(); stateMock.mockReset(); getMock.mockReset(); stateMock.mockResolvedValue({ dateRange: { from: '2026-11-01', to: '2026-11-10', timezone: 'America/New_York' } }); getMock.mockResolvedValue(page); });

describe('POSCustomersReportScreen', () => {
  it('keeps the three cards and the mix; the change is real or says there is no base; retention shows its cohort', async () => {
    custMock.mockResolvedValue(ins());
    at();
    expect(await screen.findByRole('heading', { name: 'Customers Report' })).toBeInTheDocument();
    expect(screen.getByText('71.4%')).toBeInTheDocument();
    expect(screen.getByTestId('cust-delta-new')).toHaveTextContent('▼ 50% vs previous period');
    expect(screen.getByTestId('cust-delta-ret')).toHaveTextContent('No earlier period to compare');
    expect(screen.getByTestId('cust-retention-basis')).toHaveTextContent('25 of 35 returned');
    expect(custMock).toHaveBeenCalledWith({ preset: 'month' });                 // `preset`, not the ignored `period`
  });
  it('a preset changes the period; the mix filters the customer list', async () => {
    custMock.mockResolvedValue(ins());
    at();
    fireEvent.click(await screen.findByTestId('preset-today'));
    await waitFor(() => expect(custMock).toHaveBeenCalledWith({ preset: 'today' }));
    expect(await screen.findByText('Ann N')).toBeInTheDocument();
    expect(screen.getByText('•••-0101')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cust-bar-new'));
    await waitFor(() => expect(getMock).toHaveBeenLastCalledWith('/pos/reports/customers/page', expect.objectContaining({ type: 'new', page: 1 })));
  });
  it('shows a permission message on 403 and no stale cards', async () => {
    custMock.mockRejectedValue({ status: 403 });
    at();
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
    expect(screen.queryByText('Retention Rate')).toBeNull();
  });
});
