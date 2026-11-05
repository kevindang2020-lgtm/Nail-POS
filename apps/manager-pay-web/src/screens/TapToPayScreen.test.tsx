import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PayNavProvider, usePayNav } from '../shell/nav';
import { TapToPayScreen } from './TapToPayScreen';

vi.mock('../api/mobileCheckoutApi', () => ({
  mobileCheckoutApi: { createAttempt: vi.fn(), attemptReadiness: vi.fn(), cancelAttempt: vi.fn(), captureResult: vi.fn() },
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
    expect(mobileCheckoutApi.captureResult).toHaveBeenCalledWith('K1', { outcome: 'approved', processorRef: 'PR1' });
  });

  it('shows a decline and a retry when the capture is declined', async () => {
    (isTapToPayAvailable as any).mockReturnValue(true);
    (captureTapToPay as any).mockResolvedValue({ outcome: 'declined' });
    (mobileCheckoutApi.captureResult as any).mockResolvedValue({ idempotencyKey: 'K1', from: 'ready', to: 'declined', outcome: 'declined' });
    renderFlow();
    expect(await screen.findByText('The card was declined.', { exact: false })).toBeInTheDocument();
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
    await screen.findByText('Hold card near the top');
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(mobileCheckoutApi.cancelAttempt).toHaveBeenCalledWith('K1'));
  });
});
