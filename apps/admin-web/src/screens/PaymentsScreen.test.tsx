import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockList, mockDetail, mockAuth } = vi.hoisted(() => ({ mockList: vi.fn(), mockDetail: vi.fn(), mockAuth: vi.fn() }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { paymentsTransactions: (q: any) => mockList(q), paymentTransactionDetail: (id: string) => mockDetail(id), paymentAuthorizationHistory: (id: string) => mockAuth(id) } }));

import { PaymentsScreen } from './PaymentsScreen';

const result = {
  total: 2,
  rows: [
    { id: 'TXN-20260506-0001', tenant: 'Glamour Studio', branch: 'Downtown', merchant: 'GLAM••01', customer: 'Emma Johnson', amountCents: 8750, tipCents: 1000, taxCents: 645, discountCents: 500, surchargeCents: 213, totalChargedCents: 10108, method: 'card', card: 'Visa •••• 4242', status: 'completed', statusLabel: 'Approved', statusTone: 'ok', refundStatus: 'No Refund', settlementStatus: 'Settled', processor: 'fiserv', reference: 'TKN-1', createdAt: '2026-05-06T14:28:00Z' },
    { id: 'TXN-20260506-0007', tenant: 'The Hair Lounge', branch: 'City Center', merchant: 'HAIR••03', customer: 'Olivia Martinez', amountCents: 9000, tipCents: 0, taxCents: 0, discountCents: 0, surchargeCents: 0, totalChargedCents: 9000, method: 'card', card: 'Mastercard •••• 7788', status: 'declined', statusLabel: 'Declined', statusTone: 'danger', refundStatus: 'No Refund', settlementStatus: 'Unknown', processor: 'cardpointe', reference: null, createdAt: '2026-05-06T13:16:00Z' },
  ],
  kpis: {
    totalTransactions: { value: 24812, available: true }, grossVolumeCents: { value: 41276842, available: true }, approved: { value: 22631, available: true },
    failedDeclined: { value: 1248, available: true }, refundsVoids: { value: 812, available: true }, settled: { value: 21987, available: true },
    processingFeesCents: { value: 1284739, available: true }, duplicateAlerts: { value: 36, available: true },
  },
  byMethod: [{ method: 'card', count: 10, cents: 5000 }],
  trend: [{ day: '2026-05-06', cents: 5000 }, { day: '2026-05-05', cents: 4000 }],
  failed: [{ id: 'TXN-20260506-0701', amountCents: 9000, reason: 'Declined', createdAt: '2026-05-06T14:11:00Z' }],
  processors: [{ processor: 'fiserv', lastSyncAt: '2026-05-06T14:20:00Z', events: 5 }],
};
const detail = {
  id: 'TXN-20260506-0001', tenant: 'Glamour Studio', branch: 'Downtown', merchant: 'GLAM••01', authorizationCode: null,
  refundStatus: 'No Refund', settlementStatus: 'Settled', processorResponse: 'Approved', deviceUsed: null, method: 'card', card: 'Visa •••• 4242',
  tokenReference: 'TKN-1', customer: 'Emma Johnson', email: 'e•••@example.com', phone: '•••• 89', amountCents: 8750, tipCents: 1000, taxCents: 645,
  discountCents: 500, surchargeCents: 213, totalChargedCents: 10108, statusLabel: 'Approved', createdAt: '2026-05-06T14:28:00Z',
};

beforeEach(() => { mockList.mockReset(); mockDetail.mockReset(); mockAuth.mockReset(); mockList.mockResolvedValue(result); mockDetail.mockResolvedValue(detail); mockAuth.mockResolvedValue({ id: 'TXN-20260506-0001', events: [{ label: 'Authorization approved', tone: 'ok', processor: 'fiserv', processorTransactionId: 'PX1', correlationId: 'evt_1', signatureValid: true, processed: true, at: '2026-05-06T14:15:00Z' }, { label: 'Settlement failed', tone: 'danger', processor: 'fiserv', processorTransactionId: 'PX1', correlationId: 'evt_2', signatureValid: false, processed: false, at: '2026-05-06T15:00:00Z' }] }); });

describe('PaymentsScreen — Payments & Transactions', () => {
  it('renders the header, 8 KPIs, filter controls, table and charts', async () => {
    render(<MemoryRouter><PaymentsScreen /></MemoryRouter>);
    expect(await screen.findByText('Payments & Transactions')).toBeInTheDocument();
    expect(screen.getByText('Provides a searchable platform-level view of payment activity.')).toBeInTheDocument();
    ['Total Transactions', 'Gross Payment Volume', 'Approved Transactions', 'Failed / Declined Payments', 'Refunds & Voids', 'Settled Transactions', 'Processing Fees', 'Duplicate Charge Alerts'].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
    ['Search transactions...'].forEach((p) => expect(screen.getByPlaceholderText(p)).toBeInTheDocument());
    expect(screen.getByLabelText('Transaction Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Settlement Status')).toBeInTheDocument();
    expect(screen.getByText('Reset Filters')).toBeInTheDocument();
    expect(screen.getByText('Payment Volume Trend')).toBeInTheDocument();
    expect(screen.getByText('Top Payment Methods')).toBeInTheDocument();
    expect(screen.getByText('Failed Payments')).toBeInTheDocument();
    expect(screen.getByText('Processor & Sync Status')).toBeInTheDocument();
    // masked card in the table, never a PAN
    expect(screen.getByText('Visa •••• 4242')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b\d{13,19}\b/);
  });

  it('renders all ten Super Admin Actions', async () => {
    render(<MemoryRouter><PaymentsScreen /></MemoryRouter>);
    const panel = (await screen.findByText('Super Admin Actions')).closest('section')!;
    ['Search Transactions', 'View Authorization History', 'Investigate Failed Payments', 'Review Refunds', 'Review Voids', 'Review Duplicate Charges', 'Review Processor Errors', 'Export Transaction Reports', 'Retry Supported Synchronization', 'Escalate Processing Problems'].forEach((l) => expect(within(panel).getByRole('button', { name: l })).toBeInTheDocument());
  });

  it('selects a row (orange highlight) and shows masked Selected Transaction Details + security notice', async () => {
    render(<MemoryRouter><PaymentsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Emma Johnson'));
    await waitFor(() => expect(mockDetail).toHaveBeenCalledWith('TXN-20260506-0001'));
    const panel = screen.getByText('Selected Transaction Details').closest('section')!;
    expect(within(panel).getByText('e•••@example.com')).toBeInTheDocument();
    expect(within(panel).getByText('•••• 89')).toBeInTheDocument();
    expect(within(panel).getByText('$101.08')).toBeInTheDocument(); // total charged
    expect(within(panel).getByText(/Masked and tokenized card details only/)).toBeInTheDocument();
    // authorization code + device are honest gaps
    expect(within(panel).getByText('Authorization Code').closest('div')!.textContent).toContain('—');
  });

  it('Retry Supported Synchronization explains it never recharges a customer', async () => {
    render(<MemoryRouter><PaymentsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry Supported Synchronization' }));
    expect(await screen.findByText(/never recharges a customer/)).toBeInTheDocument();
  });

  it('Investigate Failed Payments applies the failed filter (server-side)', async () => {
    render(<MemoryRouter><PaymentsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Investigate Failed Payments' }));
    await waitFor(() => expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ status: 'Failed' })));
  });

  it('View Authorization History opens the real processor event sequence (§22)', async () => {
    render(<MemoryRouter><PaymentsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Emma Johnson')); // select row
    await waitFor(() => expect(mockDetail).toHaveBeenCalled());
    const panel = (await screen.findByText('Super Admin Actions')).closest('section')!;
    fireEvent.click(within(panel).getByRole('button', { name: 'View Authorization History' }));
    await waitFor(() => expect(mockAuth).toHaveBeenCalledWith('TXN-20260506-0001'));
    const dialog = await screen.findByRole('dialog', { name: 'Authorization History' });
    expect(within(dialog).getByText('Authorization approved')).toBeInTheDocument();
    expect(within(dialog).getByText('Settlement failed')).toBeInTheDocument();
    expect(within(dialog).getByText(/signature unverified/)).toBeInTheDocument();
  });
});
