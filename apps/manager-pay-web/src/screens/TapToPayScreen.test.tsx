import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PayNavProvider, usePayNav } from '../shell/nav';
import { TapToPayScreen } from './TapToPayScreen';

vi.mock('../api/mobileCheckoutApi', () => ({
  mobileCheckoutApi: { createAttempt: vi.fn(), attemptReadiness: vi.fn(), cancelAttempt: vi.fn(), captureResult: vi.fn(), verifyAttempt: vi.fn(), getAttempt: vi.fn() },
}));
vi.mock('../native/tapToPay', () => ({ isTapToPayAvailable: vi.fn(), captureTapToPay: vi.fn() }));
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';
import { isTapToPayAvailable, captureTapToPay } from '../native/tapToPay';

const attempt = (status: string) => ({ id: 'a1', ticketId: 'tk1', amountCents: 3233, method: 'tap_to_pay', status, idempotencyKey: 'K1', createdAt: '', updatedAt: '' });

// Harness renders the pushed top screen so we can observe navigation to Success.
function Host() {
  const nav = usePayNav();
  if (nav.top?.kind === 'success') return <div>SUCCESS {nav.top.amountCents}</div>;
  if (nav.top?.kind === 'tapToPay') return <TapToPayScreen ticketId="tk1" idempotencyKey="K1" amountCents={3233} />;
  return <button onClick={() => nav.openTapToPay('tk1', 'K1', 3233)}>go</button>;
}
const renderFlow = () => { render(<PayNavProvider><Host /></PayNavProvider>); fireEvent.click(screen.getByText('go')); };

describe('TapToPayScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mobileCheckoutApi.createAttempt as any).mockResolvedValue(attempt('created'));
    (mobileCheckoutApi.cancelAttempt as any).mockResolvedValue(attempt('canceled'));
    (mobileCheckoutApi.attemptReadiness as any).mockResolvedValue(attempt('ready'));
  });

  it('shows the honest native-pending placeholder when the reader is not available', async () => {
    (isTapToPayAvailable as any).mockReturnValue(false);
    renderFlow();
    expect(await screen.findByText('Native Tap to Pay reader attaches on the on-device build', { exact: false })).toBeInTheDocument();
    expect(captureTapToPay).not.toHaveBeenCalled();
    expect(screen.queryByText('SUCCESS 3233')).not.toBeInTheDocument();
  });

  it('runs the native capture and routes to Success on a confirmed result', async () => {
    (isTapToPayAvailable as any).mockReturnValue(true);
    (captureTapToPay as any).mockResolvedValue({ outcome: 'approved', processorRef: 'PR1' });
    (mobileCheckoutApi.captureResult as any).mockResolvedValue({ idempotencyKey: 'K1', from: 'ready', to: 'confirmed', outcome: 'approved' });
    renderFlow();
    expect(await screen.findByText('SUCCESS 3233')).toBeInTheDocument();
    // the device id rides along (mandate §65: the intent names the device that captured)
    expect(mobileCheckoutApi.captureResult).toHaveBeenCalledWith('K1', expect.objectContaining({ outcome: 'approved', processorRef: 'PR1', deviceId: expect.any(String) }));
  });

  it('shows a decline and a retry when the capture is declined', async () => {
    (isTapToPayAvailable as any).mockReturnValue(true);
    (captureTapToPay as any).mockResolvedValue({ outcome: 'declined' });
    (mobileCheckoutApi.captureResult as any).mockResolvedValue({ idempotencyKey: 'K1', from: 'ready', to: 'declined', outcome: 'declined' });
    renderFlow();
    // §192: "Payment Declined — Please ask the customer for another payment method." — no processor detail
    expect(await screen.findByText('Payment Declined')).toBeInTheDocument();
    expect(screen.getByText('Please ask the customer for another payment method.')).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });

  it('shows the not-set-up message when the backend readiness step fails', async () => {
    (isTapToPayAvailable as any).mockReturnValue(false);
    (mobileCheckoutApi.attemptReadiness as any).mockResolvedValue(attempt('failed'));
    renderFlow();
    expect(await screen.findByText('isn’t set up to take Tap to Pay yet.', { exact: false })).toBeInTheDocument();
  });

  it('cancels the attempt when Cancel is pressed', async () => {
    (isTapToPayAvailable as any).mockReturnValue(false);
    renderFlow();
    await screen.findByText('Hold card or contactless device near iPhone.');   // M6-4 exact wording, never "insert or swipe"
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(mobileCheckoutApi.cancelAttempt).toHaveBeenCalledWith('K1'));
  });

  it('§74–§77: a timeout after the tap is VERIFYING — the backend is asked, the reader is never run again', async () => {
    (isTapToPayAvailable as any).mockReturnValue(true);
    (captureTapToPay as any).mockResolvedValue({ outcome: 'timeout' });
    (mobileCheckoutApi.captureResult as any).mockResolvedValue({ idempotencyKey: 'K1', from: 'ready', to: 'timed_out', outcome: 'timeout' });
    (mobileCheckoutApi.verifyAttempt as any).mockResolvedValue({ status: 'timed_out', decision: { action: 'wait', reason: 'x' } });
    renderFlow();
    expect(await screen.findByText('Verifying Payment')).toBeInTheDocument();
    expect(screen.getByText('Payment status is being verified. Do not charge the customer again.')).toBeInTheDocument();
    await waitFor(() => expect(mobileCheckoutApi.verifyAttempt).toHaveBeenCalledWith('K1'));
    expect(captureTapToPay).toHaveBeenCalledTimes(1);
    // the provider later confirms: Success, from the verify answer — still one capture
    (mobileCheckoutApi.verifyAttempt as any).mockResolvedValue({ status: 'confirmed', decision: { action: 'confirm', processorRef: 'R' }, paymentId: 'p1' });
    fireEvent.click(screen.getByText('Check status now'));
    expect(await screen.findByText('SUCCESS 3233')).toBeInTheDocument();
    expect(captureTapToPay).toHaveBeenCalledTimes(1);
  });

  it('§130/§160 relaunch recovery: a recovered attempt is read back and verified — no createAttempt, no new capture', async () => {
    (isTapToPayAvailable as any).mockReturnValue(true);
    (mobileCheckoutApi.getAttempt as any).mockResolvedValue({ ...attempt('unknown'), terminal: false, recoverable: true });
    (mobileCheckoutApi.verifyAttempt as any).mockResolvedValue({ status: 'unknown', decision: { action: 'wait', reason: 'x' } });
    render(<PayNavProvider><TapToPayScreen ticketId="tk1" idempotencyKey="K1" amountCents={3233} recovered /></PayNavProvider>);
    expect(await screen.findByText('Verifying Payment')).toBeInTheDocument();
    await waitFor(() => expect(mobileCheckoutApi.verifyAttempt).toHaveBeenCalledWith('K1'));
    expect(mobileCheckoutApi.createAttempt).not.toHaveBeenCalled();
    expect(captureTapToPay).not.toHaveBeenCalled();
  });

  it('§198: the kill switch answers TAP_TO_PAY_DISABLED → "temporarily unavailable, use the terminal, cash…" (never a decline)', async () => {
    (isTapToPayAvailable as any).mockReturnValue(false);
    (mobileCheckoutApi.createAttempt as any).mockRejectedValue(Object.assign(new Error('off'), { code: 'TAP_TO_PAY_DISABLED', status: 409 }));
    renderFlow();
    expect(await screen.findByText('Tap to Pay is temporarily unavailable. Use the terminal, cash or another payment option.')).toBeInTheDocument();
    expect(screen.queryByText('Payment Declined')).not.toBeInTheDocument();
  });
});
