// TicketRefundPanel.test.tsx — Functional Decision 20 on the POS: the server's refundable amount, a required reason,
// the server's split shown before anything is sent, and the per-payment result (incl. a partial outcome) after.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const refundPreview = vi.fn(); const refundTicket = vi.fn(); const unsettledRefunds = vi.fn(); const settleRefund = vi.fn(); const stepUp = vi.fn();
vi.mock('../api/posCheckoutApi', () => ({ posCheckoutApi: { refundPreview: (...a: any[]) => refundPreview(...a), refundTicket: (...a: any[]) => refundTicket(...a), unsettledRefunds: (...a: any[]) => unsettledRefunds(...a), settleRefund: (...a: any[]) => settleRefund(...a) } }));
const refundImpact = vi.fn();
vi.mock('../api/posDiscountsApi', () => ({ posDiscountsApi: { refundImpact: (...a: any[]) => refundImpact(...a) } }));
vi.mock('../api/posStepUpApi', () => ({ posStepUpApi: { stepUp: (...a: any[]) => stepUp(...a) } }));
import { TicketRefundPanel } from './TicketRefundPanel';

const tenders = [{ paymentId: 'pc', method: 'card', amountCents: 6000, refundedCents: 0, remainingCents: 6000 }, { paymentId: 'pk', method: 'cash', amountCents: 4000, refundedCents: 0, remainingCents: 4000 }];
const preview = (amountCents: number, alloc: [string, string, number][]) => ({ ticketId: 't1', amountCents, refundableCents: 10000, tenders, allocations: alloc.map(([paymentId, method, amountToRefundCents]) => ({ paymentId, method, amountToRefundCents })) });
beforeEach(() => {
  refundPreview.mockReset(); refundTicket.mockReset(); unsettledRefunds.mockReset(); settleRefund.mockReset(); stepUp.mockReset();
  unsettledRefunds.mockResolvedValue({ ticketId: 't1', refunds: [] }); refundImpact.mockReset(); refundImpact.mockResolvedValue({ ticketId: 't1', wholeTicket: true, items: [] });
  refundPreview.mockImplementation(async (_t: string, cents: number) => cents === 1 ? preview(1, [['pc', 'card', 1]]) : cents === 5000 ? preview(5000, [['pc', 'card', 3000], ['pk', 'cash', 2000]]) : preview(cents, [['pc', 'card', cents]]));
});

describe('TicketRefundPanel', () => {
  it('refund impact preview: a whole-ticket refund says the coupon is reversed and its use comes back; an amount refund keeps it', async () => {
    refundImpact.mockResolvedValue({ ticketId: 't1', wholeTicket: true, items: [{ redemptionId: 'r1', dealName: 'Spring Glow', code: '••••NG20', status: 'redeemed', discountCents: 2000, alreadyReversedCents: 0,
      outcome: 'reverse', reverseCents: 2000, placeReturned: true, lines: [{ lineId: 'l1', cents: 1200, refunded: true }, { lineId: 'l2', cents: 800, refunded: true }] }] });
    render(<TicketRefundPanel ticketId="t1" onClose={() => {}} />);
    await screen.findByText('This ticket can still return $100.00.');
    fireEvent.click(screen.getByText('Preview split'));
    const li = await screen.findByTestId('refund-discount');
    expect(li.textContent).toMatch(/Spring Glow — \$20\.00 \(\$12\.00 \+ \$8\.00\)/); expect(li.textContent).toMatch(/Reversed: \$20\.00/); expect(li.textContent).toMatch(/use, budget and code come back/);
    expect(refundImpact).toHaveBeenLastCalledWith('t1', null);
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('Preview split'));
    expect((await screen.findByTestId('refund-discount')).textContent).toMatch(/Kept: an amount refund/);
    expect(refundTicket).not.toHaveBeenCalled();
  });
  it('starts from what the server says the ticket can return', async () => {
    render(<TicketRefundPanel ticketId="t1" onClose={() => {}} />);
    expect(await screen.findByText('This ticket can still return $100.00.')).toBeInTheDocument();
    expect((screen.getByLabelText('Refund amount') as HTMLInputElement).value).toBe('100.00');
  });

  it("the decision's example: $50 of a $60 card + $40 cash ticket → $30 card, $20 cash; nothing is sent until Refund, and Refund needs a reason", async () => {
    refundTicket.mockResolvedValue({ ticketId: 't1', requestedCents: 5000, refundedCents: 5000, complete: true, tenders: [{ paymentId: 'pc', method: 'card', amountCents: 3000, status: 'refunded' }, { paymentId: 'pk', method: 'cash', amountCents: 2000, status: 'refunded' }] });
    render(<TicketRefundPanel ticketId="t1" onClose={() => {}} />);
    await screen.findByText('This ticket can still return $100.00.');
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('Preview split'));
    expect(await screen.findByText('Card: $30.00')).toBeInTheDocument();
    expect(screen.getByText('Cash: $20.00')).toBeInTheDocument();
    expect(refundTicket).not.toHaveBeenCalled();
    const go = screen.getByRole('button', { name: 'Refund $50.00' });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Refund reason'), { target: { value: 'Chipped next day' } });
    fireEvent.click(go);
    await waitFor(() => expect(refundTicket).toHaveBeenCalledWith('t1', { reason: 'Chipped next day', amountCents: 5000 }, expect.stringMatching(/^idem_/)));   // Constitution 5: the refund's idempotency key
    expect(await screen.findByText('Refunded $50.00.')).toBeInTheDocument();
  });

  it('BUILD_PLAN Phase 9: past the salon\'s limit the refund is SENT FOR APPROVAL — said as such, never as a failure', async () => {
    refundTicket.mockResolvedValue({ ticketId: 't1', requestedCents: 5000, refundedCents: 0, complete: false, tenders: [{ paymentId: 'pk', method: 'cash', amountCents: 5000, status: 'approval_pending', approvalId: 'apr-1', error: 'Sent for approval — a manager or the owner has to approve this refund.' }] });
    render(<TicketRefundPanel ticketId="t1" onClose={() => {}} />);
    await screen.findByText('This ticket can still return $100.00.');
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('Preview split'));
    await screen.findByText('Card: $30.00');
    fireEvent.change(screen.getByLabelText('Refund reason'), { target: { value: 'Wrong price' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refund $50.00' }));
    expect(await screen.findByTestId('refund-sent-for-approval')).toHaveTextContent(/sent for approval/);
    expect(screen.getByRole('link', { name: 'Approvals' })).toHaveAttribute('href', '/approvals');
    expect(screen.getByText(/Cash \$50\.00 — sent for approval/)).toBeInTheDocument();
    expect(screen.queryByText(/The rest was not refunded/)).toBeNull();
  });

  it('a partial outcome is said plainly, per payment', async () => {
    refundTicket.mockResolvedValue({ ticketId: 't1', requestedCents: 5000, refundedCents: 0, complete: false, tenders: [{ paymentId: 'pc', method: 'card', amountCents: 3000, status: 'failed', error: 'Declined by processor' }] });
    render(<TicketRefundPanel ticketId="t1" onClose={() => {}} />);
    await screen.findByText('This ticket can still return $100.00.');
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('Preview split'));
    await screen.findByText('Card: $30.00');
    fireEvent.change(screen.getByLabelText('Refund reason'), { target: { value: 'Wrong price' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refund $50.00' }));
    expect(await screen.findByText('Refunded $0.00 of $50.00.')).toBeInTheDocument();
    expect(screen.getByText(/stopped at the payment below/)).toBeInTheDocument();
    expect(screen.getByText(/Card \$30\.00 — failed \(Declined by processor\)/)).toBeInTheDocument();
  });

  it('a gift card says which card the refund goes back to (Oct 6 2026)', async () => {
    refundPreview.mockImplementation(async (_t: string, cents: number) => ({ ticketId: 't1', amountCents: cents, refundableCents: 4000, tenders: [{ paymentId: 'pg', method: 'gift_card', amountCents: 4000, refundedCents: 0, remainingCents: 4000, giftCardLast4: '4321' }],
      allocations: [{ paymentId: 'pg', method: 'gift_card', amountToRefundCents: cents, giftCardLast4: '4321' }] }));
    refundTicket.mockResolvedValue({ ticketId: 't1', requestedCents: 4000, refundedCents: 4000, complete: true, tenders: [{ paymentId: 'pg', method: 'gift_card', amountCents: 4000, status: 'refunded', giftCardLast4: '4321' }] });
    render(<TicketRefundPanel ticketId="t1" onClose={() => {}} />);
    await screen.findByText('This ticket can still return $40.00.');
    fireEvent.click(screen.getByText('Preview split'));
    expect(await screen.findByText('Gift card ending 4321: $40.00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Refund reason'), { target: { value: 'Allergy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refund $40.00' }));
    expect(await screen.findByText(/Gift card ending 4321 \$40\.00 — refunded/)).toBeInTheDocument();
  });

  it('more than the ticket can return cannot even be previewed; a fully refunded ticket says so', async () => {
    const a = render(<TicketRefundPanel ticketId="t1" onClose={() => {}} />);
    await screen.findByText('This ticket can still return $100.00.');
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '100.01' } });
    expect(screen.getByText('Preview split')).toBeDisabled();
    a.unmount();
    refundPreview.mockRejectedValue(new Error('Refund exceeds what this ticket can still return (0 cents remain)'));
    render(<TicketRefundPanel ticketId="t2" onClose={() => {}} />);
    expect(await screen.findByText('This ticket has already been fully refunded.')).toBeInTheDocument();
  });

  it("the server's refusal reason is shown (e.g. it needs an owner or manager)", async () => {
    refundTicket.mockRejectedValue(new Error('This refund needs an owner or manager: it would take the refunds on this payment past the approval limit.'));
    render(<TicketRefundPanel ticketId="t1" onClose={() => {}} />);
    await screen.findByText('This ticket can still return $100.00.');
    fireEvent.click(screen.getByText('Preview split'));
    await screen.findByText('Card: $100.00');
    fireEvent.change(screen.getByLabelText('Refund reason'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refund $100.00' }));
    expect(await screen.findByText(/needs an owner or manager/)).toBeInTheDocument();
  });
});

describe('BUILD_PLAN Phase 5 — refunding services on a discounted ticket', () => {
  it('a service refunds what it was actually paid after its deal — with its tax — and tells the server which services', async () => {
    refundPreview.mockImplementation(async (_t: string, cents: number) => ({ ...preview(cents, [['pc', 'card', cents]]), lines: [
      { serviceLineId: 'l1', serviceName: 'Signature Manicure', priceCents: 5500, netCents: 4400, taxCents: 341, paidCents: 4741 }, { serviceLineId: 'l2', serviceName: 'Gel Add-on', priceCents: 1500, netCents: 1500, taxCents: 116, paidCents: 1616 }] }));
    refundTicket.mockResolvedValue({ ticketId: 't1', requestedCents: 4741, refundedCents: 4741, complete: true, tenders: [{ paymentId: 'pc', method: 'card', amountCents: 4741, status: 'refunded' }] });
    render(<TicketRefundPanel ticketId="t1" onClose={() => {}} />);
    expect(await screen.findByTestId('refund-services')).toHaveTextContent('Signature Manicure — paid $47.41 (incl. $3.41 tax) (menu $55.00, after discounts)');
    fireEvent.click(screen.getByLabelText('Refund Signature Manicure'));
    expect((screen.getByLabelText('Refund amount') as HTMLInputElement).value).toBe('47.41');
    fireEvent.change(screen.getByLabelText('Refund reason'), { target: { value: 'Chipped' } });
    fireEvent.click(screen.getByText('Preview split'));
    fireEvent.click(await screen.findByText('Refund $47.41'));
    await waitFor(() => expect(refundTicket).toHaveBeenCalledWith('t1', { reason: 'Chipped', amountCents: 4741, serviceLineIds: ['l1'] }, expect.any(String)));
  });

  // mandate P0 §228 (Oct 20 2026): a lost processor answer is neither a refund nor a failure
  it("a card tender whose processor answer was lost is shown as 'verifying' — held, not refunded twice, not released", async () => {
    refundTicket.mockResolvedValue({ ticketId: 't1', requestedCents: 5000, refundedCents: 0, complete: false, tenders: [{ paymentId: 'pc', method: 'card', amountCents: 3000, status: 'verifying', error: 'The refund answer was lost. It is being verified with the card processor — do not refund again.' }] });
    unsettledRefunds.mockResolvedValue({ ticketId: 't1', refunds: [{ refundId: 'rf1', paymentId: 'pc', method: 'card', amountCents: 3000, reason: 'Chipped', createdAt: new Date(Date.now() - 5 * 60_000).toISOString(), strandedAt: null, reviewReason: null, canSettle: false }] });
    render(<TicketRefundPanel ticketId="t1" onClose={() => {}} />);
    await screen.findByText('This ticket can still return $100.00.');
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('Preview split'));
    await screen.findByText('Card: $30.00');
    fireEvent.change(screen.getByLabelText('Refund reason'), { target: { value: 'Chipped' } });
    fireEvent.click(screen.getByText('Refund $50.00'));
    expect(await screen.findByTestId('refund-verifying')).toHaveTextContent(/Nothing was refunded twice and nothing was released/);
    expect(screen.getByText(/being verified with the card processor — not refunded again, not released/)).toBeInTheDocument();
    expect(screen.queryByText(/The rest was not refunded/)).toBeNull();   // not called a failure
    await screen.findByTestId('refunds-unsettled');
    expect(screen.getByText('Still being checked automatically.')).toBeInTheDocument();
    expect(screen.queryByText('Processor shows it refunded')).toBeNull();   // no refund permission → no settle controls
  });

  it('a manager settles an undecidable one from the processor record: note required, step-up, then the list refreshes', async () => {
    unsettledRefunds.mockResolvedValueOnce({ ticketId: 't1', refunds: [{ refundId: 'rf1', paymentId: 'pc', method: 'card', amountCents: 3000, reason: 'Chipped', createdAt: new Date(Date.now() - 90 * 60_000).toISOString(), strandedAt: new Date().toISOString(), reviewReason: 'The card processor could not be reached for 75 minutes; check the refund in the processor portal.', canSettle: true }] });
    unsettledRefunds.mockResolvedValue({ ticketId: 't1', refunds: [] });
    const stepUpErr: any = Object.assign(new Error('Confirm your password to continue.'), { code: 'STEP_UP_REQUIRED' });
    settleRefund.mockRejectedValueOnce(stepUpErr).mockResolvedValue({ settled: true, status: 'refunded' });
    stepUp.mockResolvedValue({ ok: true });
    render(<TicketRefundPanel ticketId="t1" onClose={() => {}} />);
    await screen.findByTestId('refunds-unsettled');
    expect(screen.getByText(/Needs a person: The card processor could not be reached/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Processor shows it refunded'));
    expect(await screen.findByText(/Write what the processor record shows/)).toBeInTheDocument();
    expect(settleRefund).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Processor record note'), { target: { value: 'CardPointe portal: refund RET-9 approved 10:42, $30.00' } });
    fireEvent.change(screen.getByLabelText('Processor refund reference'), { target: { value: 'RET-9' } });
    fireEvent.click(screen.getByText('Processor shows it refunded'));
    // 403 STEP_UP_REQUIRED → the inline password prompt → retry once
    const pw = await screen.findByLabelText('Your password');
    fireEvent.change(pw, { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(settleRefund).toHaveBeenCalledTimes(2));
    expect(settleRefund).toHaveBeenLastCalledWith('t1', 'rf1', { outcome: 'refunded', note: 'CardPointe portal: refund RET-9 approved 10:42, $30.00', processorRefundId: 'RET-9' }, expect.stringMatching(/^idem_/));
    await waitFor(() => expect(screen.queryByTestId('refunds-unsettled')).toBeNull());
  });
  // Security Deep Scan C7: POST /pos/checkout/tickets/:id/refund is a step-up route. The checkout client throws its own
  // ApiError (status + body), so the code is read from body.code.
  const stepUpRefusal = () => Object.assign(new Error('This action needs you to confirm your password and authentication code.'), { status: 403, body: { code: 'STEP_UP_REQUIRED' } });
  const toRefund = async () => {
    render(<TicketRefundPanel ticketId="t1" onClose={() => {}} />);
    await screen.findByText('This ticket can still return $100.00.');
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('Preview split'));
    await screen.findByText('Card: $30.00');
    fireEvent.change(screen.getByLabelText('Refund reason'), { target: { value: 'Chipped next day' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refund $50.00' }));
  };
  it('STEP_UP_REQUIRED on the refund → password prompt → the SAME refund (same idempotency key) is retried once', async () => {
    refundTicket.mockRejectedValueOnce(stepUpRefusal()).mockResolvedValue({ ticketId: 't1', requestedCents: 5000, refundedCents: 5000, complete: true, tenders: [{ paymentId: 'pc', method: 'card', amountCents: 3000, status: 'refunded' }, { paymentId: 'pk', method: 'cash', amountCents: 2000, status: 'refunded' }] });
    stepUp.mockResolvedValue({ ok: true });
    await toRefund();
    expect(await screen.findByText(/Refunding money needs your password/)).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Your password'), { target: { value: 'hunter2' } });
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Refunded $50.00.')).toBeInTheDocument();
    expect(stepUp).toHaveBeenCalledWith({ password: 'hunter2', code: '123456' });
    expect(refundTicket).toHaveBeenCalledTimes(2);
    expect(refundTicket.mock.calls[1][2]).toBe(refundTicket.mock.calls[0][2]);
  });
  it('cancelling the step-up prompt refunds nothing and shows no error', async () => {
    refundTicket.mockRejectedValueOnce(stepUpRefusal());
    await toRefund();
    await screen.findByLabelText('Your password');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('Your password')).toBeNull());
    expect(refundTicket).toHaveBeenCalledTimes(1);
    expect(stepUp).not.toHaveBeenCalled();
    expect(document.querySelector('.err')).toBeNull();
    expect(screen.queryByText(/cancel/i)).toBeNull();
  });
});
