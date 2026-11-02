import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { HistoryScreen } from './HistoryScreen';

vi.mock('../api/mobileCheckoutApi', () => ({
  mobileCheckoutApi: { payments: vi.fn(), myDevices: vi.fn() },
}));
vi.mock('../lib/useCheckoutStream', () => ({ useCheckoutStream: () => {} }));
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';

const row = (over: Partial<any>) => ({
  paymentId: 'p1', ticketId: 'tk1', ticketNumber: '1042', createdAt: new Date().toISOString(), customerName: 'Anna N.',
  amountCents: 3233, tipCents: 0, refundedCents: 0, method: 'card', paymentSurface: 'tap_to_pay_iphone',
  cardBrand: 'visa', cardLast4: '4242', status: 'PAID', deviceLabel: 'Front iPhone', ...over,
});

describe('HistoryScreen (§103–§106: canonical payments, filters)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mobileCheckoutApi.myDevices as any).mockResolvedValue([{ deviceId: 'dev-1', label: 'Front iPhone' }]);
  });

  it('lists canonical payments with honest statuses, safe card info and surface', async () => {
    (mobileCheckoutApi.payments as any).mockResolvedValue({ items: [
      row({ paymentId: 'p1', amountCents: 3233, status: 'PAID' }),
      row({ paymentId: 'p2', amountCents: 5000, status: 'PARTIALLY_REFUNDED', refundedCents: 1000, method: 'cash', paymentSurface: 'pos', cardBrand: null, cardLast4: null }),
    ], count: 2, generatedAt: '' });
    render(<HistoryScreen />);
    expect(await screen.findByText('$32.33')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getAllByText('Today').length).toBeGreaterThan(0);
    const badges = Array.from(document.querySelectorAll('.pay-badge')).map((e) => e.textContent);
    expect(badges).toEqual(['Paid', 'Partially Refunded']);
    expect(screen.getByText(/•••• 4242 · Tap to Pay/)).toBeInTheDocument();
    // the first load asks for today's range, no status/method filters
    const q = (mobileCheckoutApi.payments as any).mock.calls[0][0];
    expect(q.from).toBeTruthy(); expect(q.to).toBeTruthy(); expect(q.status).toBeUndefined();
  });

  it('passes status / method / device filters to the canonical endpoint', async () => {
    (mobileCheckoutApi.payments as any).mockResolvedValue({ items: [], count: 0, generatedAt: '' });
    render(<HistoryScreen />);
    await screen.findByText('No payments in this range');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'REFUNDED' } });
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'card' } });
    fireEvent.change(await screen.findByLabelText('Device'), { target: { value: 'dev-1' } });
    await waitFor(() => {
      const last = (mobileCheckoutApi.payments as any).mock.calls.at(-1)[0];
      expect(last).toMatchObject({ status: 'REFUNDED', method: 'card', deviceId: 'dev-1' });
    });
  });

  it('shows an honest error state when history cannot load', async () => {
    (mobileCheckoutApi.payments as any).mockRejectedValue(new Error('offline'));
    render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByText('Couldn’t load history')).toBeInTheDocument());
  });
});
