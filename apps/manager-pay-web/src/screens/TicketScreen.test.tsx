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
    refundPreview: vi.fn(),
    refundTicket: vi.fn(),
    voidPayment: vi.fn(),
    retailCatalog: vi.fn(),
    addRetail: vi.fn(),
    applyDiscount: vi.fn(),
    takeoverLock: vi.fn(),
    cashTender: vi.fn(),
  },
}));
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';
vi.mock('../api/authApi', () => ({ authApi: { stepUp: vi.fn() } }));
import { authApi } from '../api/authApi';

const DETAIL = {
  ticketId: 'tk1', ticketNumber: '204', status: 'ready',
  customer: { fullName: 'Jordan Lee', initials: 'JL', phoneMasked: '•••• 1234', isVip: true, loyaltyPoints: 120 },
  services: [{ serviceLineId: 'sl_gel_manicure', serviceName: 'Gel Manicure', technicianName: 'Mia', priceCents: 3000 }],
  totals: { subtotalCents: 3000, discountCents: 0, tipCents: 0, taxCents: 233, surchargeCents: 0, totalDueCents: 3233 },
  // mandate §55 / §48: the checkout version + what the canonical payments already cover
  version: 'v1aaaaaaaaaaaaaa', paidCents: 0, balanceDueCents: 3233, claim: null,
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

  it('shows Paid / Balance Due once a partial has been captured (§48, §87) — the button charges the BALANCE, not the total', async () => {
    (mobileCheckoutApi.ticket as any).mockResolvedValue({ ...DETAIL, paidCents: 2000, balanceDueCents: 1233 });
    (mobileCheckoutApi.ticketBalance as any).mockResolvedValue({ totalDueCents: 3233, confirmedCents: 2000, inFlightCents: 0, remainingCents: 1233, isFullyPaid: false });
    renderScreen();
    expect(await screen.findByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Balance Due')).toBeInTheDocument();
    expect(screen.getByText('Proceed to Payment · $12.33')).toBeInTheDocument();
  });

  it('shows no Paid / Balance Due rows when nothing has been captured yet', async () => {
    renderScreen();
    await screen.findByText('Jordan Lee');
    expect(screen.queryByText('Balance Due')).not.toBeInTheDocument();
  });

  it('§55/§155: proceed sends the checkout version; a VERSION_CONFLICT answer refreshes the ticket and never opens Tap to Pay', async () => {
    (mobileCheckoutApi.proceed as any).mockResolvedValue({ canProceed: false, reason: 'CHECKOUT_VERSION_CONFLICT', message: 'changed', balanceCents: 4000, version: 'v2bbbbbbbbbbbbbb' });
    renderScreen();
    fireEvent.click(await screen.findByText('Proceed to Payment', { exact: false }));
    expect(await screen.findByText('This checkout changed at the front desk.', { exact: false })).toBeInTheDocument();
    expect(mobileCheckoutApi.proceed).toHaveBeenCalledWith('tk1', expect.objectContaining({ expectedVersion: 'v1aaaaaaaaaaaaaa' }));
    expect(mobileCheckoutApi.ticket).toHaveBeenCalledTimes(2);   // refreshed
    expect(screen.queryByText('TAPTOPAY', { exact: false })).not.toBeInTheDocument();
  });

  it('M6-6 §31: a CHECKOUT_STALE claim is re-made at the current version (re-claim), the ticket refreshed, Tap to Pay not opened', async () => {
    (mobileCheckoutApi.proceed as any).mockResolvedValue({ canProceed: false, reason: 'CHECKOUT_STALE', message: 'stale', balanceCents: 4000, version: 'v2bbbbbbbbbbbbbb' });
    renderScreen();
    fireEvent.click(await screen.findByText('Proceed to Payment', { exact: false }));
    expect(await screen.findByText('This checkout changed at the front desk.', { exact: false })).toBeInTheDocument();
    await waitFor(() => expect(mobileCheckoutApi.acquireLock).toHaveBeenCalledTimes(2));   // open + the re-claim
    await waitFor(() => expect(mobileCheckoutApi.ticket).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('TAPTOPAY', { exact: false })).not.toBeInTheDocument();
  });

  it('§46: when the POS holds the claim the screen says so; the takeover control appears ONLY with the override permission', async () => {
    (mobileCheckoutApi.acquireLock as any).mockRejectedValue(Object.assign(new Error('locked'), { status: 409 }));
    (mobileCheckoutApi.ticket as any).mockResolvedValue({ ...DETAIL, claim: { source: 'pos', ownedByCaller: false, userId: 'u9', userName: 'Front Desk', deviceId: null, deviceLabel: null, expiresAt: '', message: '' } });
    renderScreen();
    expect(await screen.findByText('This checkout is currently being processed at the front desk POS.', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Take over')).not.toBeInTheDocument();
  });

  it('§83–§84: the cash part of a split is recorded through the canonical endpoint with an idempotency key', async () => {
    (mobileCheckoutApi.cashTender as any).mockResolvedValue({ paymentId: 'p1', duplicate: false, totalDueCents: 3233, paidCents: 1000, remainingCents: 2233, ticketPaid: false });
    renderScreen();
    fireEvent.click(await screen.findByText('Cash part of a split'));
    fireEvent.change(screen.getByLabelText('Cash part of a split'), { target: { value: '10.00' } });
    fireEvent.click(screen.getByText('Record cash tender'));
    fireEvent.click(await screen.findByText('Confirm'));
    await waitFor(() => expect(mobileCheckoutApi.cashTender).toHaveBeenCalledWith('tk1', expect.objectContaining({ amountCents: 1000, idempotencyKey: expect.any(String) })));
    expect(await screen.findByText('Cash of $10.00 recorded. Balance due $22.33.')).toBeInTheDocument();
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
    expect(await screen.findByText('This checkout is currently being processed at', { exact: false })).toBeInTheDocument();
    await waitFor(() => {
      const btn = screen.getByText('Proceed to Payment', { exact: false }).closest('button')!;
      expect(btn).toBeDisabled();
    });
  });

  it('Functional Decision 20: "Refund across payments" previews the split ($50 → $30 card + $20 cash), confirms inline, and reports each part', async () => {
    (mobileCheckoutApi.ticketPayments as any).mockResolvedValue([
      { paymentId: 'pc', method: 'card', amountCents: 6000, tipCents: 0, status: 'approved', createdAt: '2026-01-01' },
      { paymentId: 'pk', method: 'cash', amountCents: 4000, tipCents: 0, status: 'approved', createdAt: '2026-01-01' },
    ]);
    (mobileCheckoutApi.refundPreview as any).mockResolvedValue({ amountCents: 5000, refundableCents: 10000, allocations: [{ paymentId: 'pc', method: 'card', amountToRefundCents: 3000, action: 'refund' }, { paymentId: 'pk', method: 'cash', amountToRefundCents: 2000, action: 'refund' }] });
    (mobileCheckoutApi.refundTicket as any).mockResolvedValue({ requestedCents: 5000, refundedCents: 5000, complete: true, tenders: [{ paymentId: 'pc', method: 'card', amountCents: 3000, status: 'refunded' }, { paymentId: 'pk', method: 'cash', amountCents: 2000, status: 'refunded' }] });
    renderScreen();
    fireEvent.click(await screen.findByText('Refund across payments'));
    fireEvent.change(screen.getByLabelText('Split refund reason'), { target: { value: 'service redo' } });
    fireEvent.change(screen.getByLabelText('Split refund amount'), { target: { value: '50.00' } });
    fireEvent.click(screen.getByText('Preview split'));
    await waitFor(() => expect(mobileCheckoutApi.refundPreview).toHaveBeenCalledWith('tk1', 5000));
    const split = await screen.findByLabelText('Refund split');
    expect(split.textContent).toContain('$30.00'); expect(split.textContent).toContain('$20.00');
    expect(mobileCheckoutApi.refundTicket).not.toHaveBeenCalled();                  // nothing moves before confirming
    fireEvent.click(screen.getByText('Submit refund'));
    fireEvent.click(await screen.findByText('Confirm'));
    await waitFor(() => expect(mobileCheckoutApi.refundTicket).toHaveBeenCalledWith('tk1', { reason: 'service redo', amountCents: 5000 }, expect.stringMatching(/^idem_/)));   // Constitution 5: the action's idempotency key
    expect(await screen.findByText(/Refund of \$50\.00 complete/)).toBeInTheDocument();
  });

  it('"Refund across payments" is only offered when the ticket has more than one payment', async () => {
    (mobileCheckoutApi.ticketPayments as any).mockResolvedValue([{ paymentId: 'pay1', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', createdAt: '2026-01-01' }]);
    renderScreen();
    await screen.findByText('Refund');
    expect(screen.queryByText('Refund across payments')).toBeNull();
  });

  it('Constitution 5: a retry after a failed refund sends the SAME key; a corrected amount gets a NEW one', async () => {
    (mobileCheckoutApi.ticketPayments as any).mockResolvedValue([{ paymentId: 'pay1', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', createdAt: '2026-01-01' }]);
    const rp = mobileCheckoutApi.refundPayment as any;
    rp.mockReset(); rp.mockRejectedValueOnce(new Error('Network timeout')).mockRejectedValueOnce(new Error('Network timeout')).mockResolvedValue({ status: 'refunded' });
    renderScreen();
    fireEvent.click(await screen.findByText('Refund'));
    fireEvent.change(await screen.findByLabelText('Refund reason'), { target: { value: 'customer changed mind' } });
    const submit = async () => { fireEvent.click(screen.getByText('Submit Refund')); fireEvent.click(await screen.findByText('Confirm')); };
    await submit(); await waitFor(() => expect(rp).toHaveBeenCalledTimes(1)); await screen.findByText(/Network timeout/);
    await submit(); await waitFor(() => expect(rp).toHaveBeenCalledTimes(2)); await screen.findByText(/Network timeout/);
    expect(rp.mock.calls[1][2]).toBe(rp.mock.calls[0][2]);                        // the retry is the same action
    fireEvent.change(screen.getByLabelText(/Refund amount/i), { target: { value: '20.00' } });
    await submit(); await waitFor(() => expect(rp).toHaveBeenCalledTimes(3));
    expect(rp.mock.calls[2][1].amountCents).toBe(2000);
    expect(rp.mock.calls[2][2]).not.toBe(rp.mock.calls[0][2]);                    // a corrected amount is a new action
  });

  it('refunds in FULL through the inline panel — no native dialog ever fires', async () => {
    (mobileCheckoutApi.ticketPayments as any).mockResolvedValue([{ paymentId: 'pay1', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', createdAt: '2026-01-01' }]);
    const promptSpy = vi.spyOn(window, 'prompt');
    renderScreen();
    fireEvent.click(await screen.findByText('Refund'));
    fireEvent.change(await screen.findByLabelText('Refund reason'), { target: { value: 'customer changed mind' } });
    fireEvent.click(screen.getByText('Submit Refund'));
    fireEvent.click(await screen.findByText('Confirm'));   // Jul 29: money-moving submit is confirm-gated inline
    await waitFor(() => expect(mobileCheckoutApi.refundPayment).toHaveBeenCalledWith('pay1', { reason: 'customer changed mind', amountCents: 5000 }, expect.stringMatching(/^idem_/)));
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
    await waitFor(() => expect(mobileCheckoutApi.refundPayment).toHaveBeenCalledWith('pay1', { reason: 'redo one service', amountCents: 2000, serviceLineIds: ['sl_gel_manicure'], tipRefunded: true }, expect.stringMatching(/^idem_/)));

    (mobileCheckoutApi.refundPayment as any).mockClear();
    fireEvent.click(await screen.findByText('Refund'));
    fireEvent.change(await screen.findByLabelText('Refund reason'), { target: { value: 'typo test' } });
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Submit Refund'));
    fireEvent.click(await screen.findByText('Confirm'));   // Jul 29: money-moving submit is confirm-gated inline
    await screen.findByText(/between \$0\.01 and/);
    expect(mobileCheckoutApi.refundPayment).not.toHaveBeenCalled();
  });

  // Security Deep Scan C7: refund / void are step-up routes (403 STEP_UP_REQUIRED → password prompt → one retry)
  const STEP_UP = () => Object.assign(new Error('This action needs you to confirm your password and authentication code.'), { status: 403, code: 'STEP_UP_REQUIRED' });
  const submitFullRefund = async () => {
    fireEvent.click(await screen.findByText('Refund'));
    fireEvent.change(await screen.findByLabelText('Refund reason'), { target: { value: 'customer changed mind' } });
    fireEvent.click(screen.getByText('Submit Refund'));
    fireEvent.click(await screen.findByText('Confirm'));
  };
  it('a refund answered STEP_UP_REQUIRED opens the password + code prompt and retries the SAME refund once', async () => {
    (mobileCheckoutApi.ticketPayments as any).mockResolvedValue([{ paymentId: 'pay1', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', createdAt: '2026-01-01' }]);
    const rp = mobileCheckoutApi.refundPayment as any;
    rp.mockReset(); rp.mockRejectedValueOnce(STEP_UP()).mockResolvedValue({ refundId: 'r1', status: 'refunded' });
    (authApi.stepUp as any).mockResolvedValue({ ok: true });
    renderScreen();
    await submitFullRefund();
    const dlg = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    fireEvent.change(screen.getAllByLabelText('Your password').pop()!, { target: { value: 'pw' } });
    fireEvent.change(screen.getAllByLabelText('6-digit code (if you use an authenticator app)').pop()!, { target: { value: '123456' } });
    fireEvent.click(dlg.querySelector('button:last-child') as HTMLElement);
    await waitFor(() => expect(authApi.stepUp).toHaveBeenCalledWith('pw', '123456'));
    await waitFor(() => expect(rp).toHaveBeenCalledTimes(2));
    expect(rp.mock.calls[1][2]).toBe(rp.mock.calls[0][2]);                         // same idempotency key
    expect(await screen.findByText(/Refund submitted for \$50\.00/)).toBeInTheDocument();
  });
  it('cancelling the step-up prompt on a void moves nothing and shows no error', async () => {
    (mobileCheckoutApi.ticketPayments as any).mockResolvedValue([{ paymentId: 'pay1', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', createdAt: '2026-01-01' }]);
    const vp = mobileCheckoutApi.voidPayment as any;
    vp.mockReset(); vp.mockRejectedValueOnce(STEP_UP());
    renderScreen();
    fireEvent.click(await screen.findByText('Void'));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'wrong card' } });
    fireEvent.click(screen.getAllByRole('button').find((b) => /^(OK|Submit|Confirm|Continue)$/i.test(b.textContent || ''))!);
    const dlg = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    fireEvent.click(Array.from(dlg.querySelectorAll('button')).find((b) => b.textContent === 'Cancel')!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Confirm it is you' })).toBeNull());
    expect(vp).toHaveBeenCalledTimes(1);
    expect(authApi.stepUp).not.toHaveBeenCalled();
    expect(screen.queryByText(/Void failed|cancelled|needs you to confirm/)).toBeNull();
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

  it('§17/§184: a high-value charge asks for the password, stamps step-up, then proceeds again', async () => {
    (mobileCheckoutApi.proceed as any)
      .mockResolvedValueOnce({ canProceed: false, reason: 'STEP_UP_REQUIRED', message: 'This amount needs you to confirm your password before charging.', balanceCents: 3233, stepUpRequired: true })
      .mockResolvedValueOnce({ canProceed: true, idempotencyKey: 'K-step', balanceCents: 3233 });
    (authApi.stepUp as any).mockResolvedValue({ ok: true });
    renderScreen();
    fireEvent.click(await screen.findByText('Proceed to Payment · $32.33'));
    expect(await screen.findByText('This amount needs you to confirm your password before charging.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByText('Confirm and continue'));
    await waitFor(() => expect(authApi.stepUp).toHaveBeenCalledWith('pw'));
    await waitFor(() => expect(mobileCheckoutApi.proceed).toHaveBeenCalledTimes(2));
  });

  it('§17: a wrong password keeps the charge blocked and says so', async () => {
    (mobileCheckoutApi.proceed as any).mockResolvedValue({ canProceed: false, reason: 'STEP_UP_REQUIRED', message: 'Confirm your password.', balanceCents: 3233 });
    (authApi.stepUp as any).mockRejectedValue(new Error('Incorrect password.'));
    renderScreen();
    fireEvent.click(await screen.findByText('Proceed to Payment · $32.33'));
    fireEvent.change(await screen.findByLabelText('Your password'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByText('Confirm and continue'));
    expect(await screen.findByText('Incorrect password.')).toBeInTheDocument();
    expect(mobileCheckoutApi.proceed).toHaveBeenCalledTimes(1);
  });
});
