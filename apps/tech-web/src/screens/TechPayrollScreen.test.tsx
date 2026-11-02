// TechPayrollScreen — Payroll wave 2 (§85–§89, §152): paid vs owed per period from recorded payouts, a pay period's own
// earnings line by line (canonical read, period=pay_period), the payments received, and asking about a pay (the technician
// can ask, never change the entry). Mocked API.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../lib/useTechStream', () => ({ useTechStream: () => undefined }));
vi.mock('./TechAgreementsPanel', () => ({ TechAgreementsPanel: () => null }));
vi.mock('../api/techApi', () => ({ techApi: { payroll: vi.fn(), payrollPayouts: vi.fn(), payrollInquiries: vi.fn(), askAboutPayroll: vi.fn(), earningsCanonical: vi.fn(), payStatements: vi.fn().mockResolvedValue({ current: null, statements: [], cashWaiting: [] }), payStatement: vi.fn(), acknowledgeCash: vi.fn(), disputeCash: vi.fn() } }));

import { techApi } from '../api/techApi';
import { TechPayrollScreen } from './TechPayrollScreen';
import { TechNavProvider } from '../shell/nav';

const api = techApi as any;
beforeEach(() => {
  vi.clearAllMocks();
  api.payroll.mockResolvedValue({ paidCents: 40000, unpaidCents: 25000, totalCents: 65000, periods: [
    { periodId: 'p1', label: 'Jun 1–15', periodStart: '2026-06-01', periodEnd: '2026-06-15', status: 'finalized', paidAt: null, servicesCount: 8, grossCents: 100000, commissionCents: 50000, tipsCents: 15000, adjustmentCents: 0, payableCents: 65000, paidCents: 40000, outstandingCents: 25000 },
  ] });
  api.payrollPayouts.mockResolvedValue([{ id: 'o1', periodId: 'p1', periodLabel: 'Jun 1–15', periodStart: '2026-06-01', periodEnd: '2026-06-15', amountCents: 40000, method: 'direct_deposit', status: 'paid', paidAt: '2026-06-16T12:00:00Z', createdAt: '2026-06-16T12:00:00Z' }]);
  api.payrollInquiries.mockResolvedValue([{ id: 'q1', periodId: 'p1', subjectType: 'period', subjectId: null, message: 'Tip on June 10?', status: 'answered', response: 'A refund on June 10.', respondedAt: null, createdAt: '2026-06-17T12:00:00Z' }]);
  api.earningsCanonical.mockResolvedValue({ lines: [{ serviceName: 'Gel Manicure', lineTotalCents: 4500, commissionCents: 2700, completedAt: '2026-06-10T15:00:00Z', ticketId: 't1' }] });
  api.askAboutPayroll.mockResolvedValue({});
});
const renderScreen = () => render(<TechNavProvider><TechPayrollScreen /></TechNavProvider>);

describe('TechPayrollScreen (wave 2)', () => {
  it('shows paid vs owed from recorded payouts, the payments received and the answered question', async () => {
    renderScreen();
    expect(await screen.findByText(/Paid \$400\.00 · owed \$250\.00/)).toBeInTheDocument();
    expect(screen.getByText('Payments received')).toBeInTheDocument();
    expect(screen.getByText(/direct deposit · paid/)).toBeInTheDocument();
    expect(screen.getByText('Answer: A refund on June 10.')).toBeInTheDocument();
  });

  it('opens a pay period\'s own earnings through the canonical pay_period read', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('View earnings'));
    await waitFor(() => expect(api.earningsCanonical).toHaveBeenCalledWith('pay_period', undefined, undefined, 'p1'));
    expect(await screen.findByText(/Gel Manicure/)).toBeInTheDocument();
  });

  it('asks about a pay (needs a message), then refreshes', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Ask about this pay'));
    fireEvent.click(screen.getByText('Send question'));
    expect(await screen.findByText('Write your question.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your question about this pay'), { target: { value: 'Missing tip June 12' } });
    fireEvent.click(screen.getByText('Send question'));
    await waitFor(() => expect(api.askAboutPayroll).toHaveBeenCalledWith({ message: 'Missing tip June 12', periodId: 'p1', subjectType: 'period' }));
    await waitFor(() => expect(api.payroll).toHaveBeenCalledTimes(2));
  });
});
