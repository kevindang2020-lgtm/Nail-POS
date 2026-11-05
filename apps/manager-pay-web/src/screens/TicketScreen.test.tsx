import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PayNavProvider, usePayNav } from '../shell/nav';
import { TicketScreen } from './TicketScreen';

vi.mock('../api/mobileCheckoutApi', () => ({
  mobileCheckoutApi: {
    ticket: vi.fn(),
    acquireLock: vi.fn(),
    refreshLock: vi.fn(),
    releaseLock: vi.fn(),
    proceed: vi.fn(),
    ticketBalance: vi.fn(),
    ticketPayments: vi.fn(),
    refundPayment: vi.fn(),
    voidPayment: vi.fn(),
    retailCatalog: vi.fn(),
    addRetail: vi.fn(),
    applyDiscount: vi.fn(),
  },
}));
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';

const DETAIL = {
  ticketId: 'tk1', ticketNumber: '204', status: 'ready',
  customer: { name: 'Jordan Lee', phoneLast4: '1234', isVip: true, loyaltyPoints: 120 },
  services: [{ serviceLineId: 'sl_gel_manicure', serviceName: 'Gel Manicure', technicianName: 'Mia', priceCents: 3000 }],
  totals: { subtotalCents: 3000, discountCents: 0, tipCents: 0, taxCents: 233, surchargeCents: 0, totalDueCents: 3233 },
};

const renderScreen = () => render(<PayNavProvider><TicketScreen ticketId="tk1" /></PayNavProvider>);

describe('TicketScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mobileCheckoutApi.acquireLock as any).mockResolvedValue({ acquired: true, action: 'acquired', expiresAt: '' });
    (mobileCheckoutApi.releaseLock as any).mockResolvedValue({ released: true });
    (mobileCheckoutApi.ticket as any).mockResolvedValue(DETAIL);
    (mobileCheckoutApi.ticketBalance as any).mockResolvedValue({ totalDueCents: 3233, confirmedCents: 0, inFlightCents: 0, remainingCents: 3233, isFullyPaid: false });
    (mobileCheckoutApi.ticketPayments as any).mockResolvedValue([]);
    (mobileCheckoutApi.refundPayment as any).mockResolvedValue({ refundId: 'r1', status: 'refunded' });
    (mobileCheckoutApi.voidPayment as any).mockResolvedValue({ status: 'voided' });
    (mobileCheckoutApi.retailCatalog as any).mockResolvedValue({ products: [{ productId: 'p1', name: 'Cuticle Oil', retailPriceCents: 1200 }] });
    (mobileCheckoutApi.addRetail as any).mockResolvedValue({ ok: true });
    (mobileCheckoutApi.applyDiscount as any).mockResolvedValue({ ok: true });
  });

  it('shows a collected / remaining breakdown once a partial has been captured', async () => {
    (mobileCheckoutApi.ticketBalance as any).mockResolvedValue({ totalDueCents: 3233, confirmedCents: 2000, inFlightCents: 0, remainingCents: 1233, isFullyPaid: false });
    renderScreen();
    expect(await screen.findByText('Collected')).toBeInTheDocument();
    expect(screen.getByText('Remaining')).toBeInTheDocument();
  });

  it('shows no collected/remaining rows when nothing has been captured yet', async () => {
    renderScreen();
    await screen.findByText('Jordan Lee');
    expect(screen.queryByText('Collected')).not.toBeInTheDocument();
  });

  it('renders the canonical ticket and confirms the lock is held', async () => {
    renderScreen();
    expect(await screen.findByText('Jordan Lee')).toBeInTheDocument();
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();
    expect(await screen.findByText('You have this ticket open', { exact: false })).toBeInTheDocument();
    expect(await screen.findByText('Proceed to Payment', { exact: false })).toBeInTheDocument();
  });

  it('surfaces the Tap-to-Pay block reason honestly on proceed', async () => {
    (mobileCheckoutApi.proceed as any).mockResolvedValue({ canProceed: false, reason: 'tap_to_pay_setup_required', message: 'Payment is not ready on this device.', balanceCents: 3233 });
    renderScreen();
    const btn = await screen.findByText('Proceed to Payment', { exact: false });
    fireEvent.click(btn);
    expect(await screen.findByText('Payment is not ready on this device.')).toBeInTheDocument();
  });

  it('navigates to Tap to Pay when proceed is green', async () => {
    (mobileCheckoutApi.proceed as any).mockResolvedValue({ canProceed: true, balanceCents: 3233, idempotencyKey: 'K1', attemptState: 'created' });
    // Host renders the pushed top screen so we can observe the navigation without rendering the real Tap-to-Pay screen.
    function Host() {
      const nav = usePayNav();
      if (nav.top?.kind === 'tapToPay') return <div>TAPTOPAY {nav.top.amountCents} {nav.top.idempotencyKey}</div>;
      return <TicketScreen ticketId="tk1" />;
    }
    render(<PayNavProvider><Host /></PayNavProvider>);
    const btn = await screen.findByText('Proceed to Payment', { exact: false });
    fireEvent.click(btn);
    expect(await screen.findByText('TAPTOPAY 3233 K1', { exact: false })).toBeInTheDocument();
  });

  it('disables charging and shows a notice when the ticket is locked elsewhere', async () => {
    (mobileCheckoutApi.acquireLock as any).mockRejectedValue(Object.assign(new Error('locked'), { status: 409 }));
    renderScreen();
    expect(await screen.findByText('open elsewhere', { exact: false })).toBeInTheDocument();
    await waitFor(() => {
      const btn = screen.getByText('Proceed to Payment', { exact: false }).closest('button')!;
      expect(btn).toBeDisabled();
    });
  });

  it('refunds in FULL through the inline panel — no native dialog ever fires', async () => {
    (mobileCheckoutApi.ticketPayments as any).mockResolvedValue([{ paymentId: 'pay1', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', createdAt: '2026-01-01' }]);
    const promptSpy = vi.spyOn(window, 'prompt');
    renderScreen();
    fireEvent.click(await screen.findByText('Refund'));
    fireEvent.change(await screen.findByLabelText('Refund reason'), { target: { value: 'customer changed mind' } });
    fireEvent.click(screen.getByText('Submit Refund'));
    fireEvent.click(await screen.findByText('Confirm'));   // Jul 29: money-moving submit is confirm-gated inline
    await waitFor(() => expect(mobileCheckoutApi.refundPayment).toHaveBeenCalledWith('pay1', { reason: 'customer changed mind', amountCents: 5000 }));
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('a PARTIAL refund shows the line picker and sends serviceLineIds + tipRefunded; junk amount blocks', async () => {
    (mobileCheckoutApi.ticketPayments as any).mockResolvedValue([{ paymentId: 'pay1', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', createdAt: '2026-01-01' }]);
    renderScreen();
    fireEvent.click(await screen.findByText('Refund'));
    fireEvent.change(await screen.findByLabelText('Refund reason'), { target: { value: 'redo one service' } });
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '20.00' } });
    fireEvent.click(await screen.findByLabelText(/Gel Manicure/i, { selector: 'input' }).catch?.(() => null) ?? screen.getByText(/Gel Manicure ·/).previousSibling as any);
    fireEvent.click(screen.getByText('The tip on these services was also refunded'));
    fireEvent.click(screen.getByText('Submit Refund'));
    fireEvent.click(await screen.findByText('Confirm'));   // Jul 29: money-moving submit is confirm-gated inline
    await waitFor(() => expect(mobileCheckoutApi.refundPayment).toHaveBeenCalledWith('pay1', { reason: 'redo one service', amountCents: 2000, serviceLineIds: ['sl_gel_manicure'], tipRefunded: true }));

    (mobileCheckoutApi.refundPayment as any).mockClear();
    fireEvent.click(await screen.findByText('Refund'));
    fireEvent.change(await screen.findByLabelText('Refund reason'), { target: { value: 'typo test' } });
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Submit Refund'));
    fireEvent.click(await screen.findByText('Confirm'));   // Jul 29: money-moving submit is confirm-gated inline
    await screen.findByText(/between \$0\.01 and/);
    expect(mobileCheckoutApi.refundPayment).not.toHaveBeenCalled();
  });

  it('cancelling the panel refunds nothing', async () => {
    (mobileCheckoutApi.ticketPayments as any).mockResolvedValue([{ paymentId: 'pay1', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', createdAt: '2026-01-01' }]);
    renderScreen();
    fireEvent.click(await screen.findByText('Refund'));
    fireEvent.click(await screen.findByText('Cancel'));
    await new Promise((r) => setTimeout(r, 0));
    expect(mobileCheckoutApi.refundPayment).not.toHaveBeenCalled();
  });

  // TapPay prototype pass (Jul 28, 2026): ticket composition on mobile — canonical engines, no client-named prices.
  it('Add Retail Product lists the catalog and adds via the real endpoint, then reloads the ticket', async () => {
    render(<TicketScreen ticketId="tk1" />);
    await screen.findByText('Gel Manicure');
    fireEvent.click(screen.getByRole('button', { name: /Add Retail Product/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Cuticle Oil/ }));
    await screen.findByText(/Added Cuticle Oil/);
    expect((mobileCheckoutApi.addRetail as any)).toHaveBeenCalledWith('tk1', { productId: 'p1', quantity: 1 });
    expect((mobileCheckoutApi.ticket as any).mock.calls.length).toBeGreaterThanOrEqual(2); // reloaded after the write
  });

  it('Add Discount parses dollars to integer cents; junk input blocks and calls nothing', async () => {
    render(<TicketScreen ticketId="tk1" />);
    await screen.findByText('Gel Manicure');
    fireEvent.click(screen.getByRole('button', { name: /Add Discount/ }));
    fireEvent.change(screen.getByLabelText('Discount amount'), { target: { value: '5.50' } });
    fireEvent.click(screen.getByRole('button', { name: /Apply Discount/ }));
    await screen.findByText(/Discount applied/);
    expect((mobileCheckoutApi.applyDiscount as any)).toHaveBeenCalledWith('tk1', { discountCents: 550, reason: undefined });

    fireEvent.click(screen.getByRole('button', { name: /Add Discount/ }));
    fireEvent.change(screen.getByLabelText('Discount amount'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Apply Discount/ }));
    await screen.findByText(/greater than zero/);
    expect((mobileCheckoutApi.applyDiscount as any)).toHaveBeenCalledTimes(1);
  });
});
