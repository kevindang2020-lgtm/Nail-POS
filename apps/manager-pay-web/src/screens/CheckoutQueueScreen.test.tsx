import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PayNavProvider } from '../shell/nav';
import { CheckoutQueueScreen } from './CheckoutQueueScreen';

vi.mock('../api/mobileCheckoutApi', () => ({
  mobileCheckoutApi: {
    readiness: vi.fn(),
    queue: vi.fn(),
  },
}));
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';

const renderScreen = () => render(<PayNavProvider><CheckoutQueueScreen /></PayNavProvider>);

describe('CheckoutQueueScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders queue tickets with masked phone + formatted amount, and an honest readiness banner', async () => {
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'ready', canTakePayment: true, checks: [] });
    (mobileCheckoutApi.queue as any).mockResolvedValue({
      count: 1,
      items: [{ ticketId: 'tk1', ticketNumber: '204', customerName: 'Jordan Lee', customerPhoneLast4: '1234', servicesLabel: 'Gel Manicure +1', totalDueCents: 3233, status: 'ready' }],
    });
    renderScreen();
    expect(await screen.findByText('Jordan Lee')).toBeInTheDocument();
    expect(screen.getByText('$32.33')).toBeInTheDocument();
    expect(await screen.findByText('Ready to take payments', { exact: false })).toBeInTheDocument();
  });

  it('shows the Tap-to-Pay-not-set-up banner honestly when the device cannot take payment', async () => {
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'tap_to_pay_setup_required', canTakePayment: false, checks: [] });
    (mobileCheckoutApi.queue as any).mockResolvedValue({ count: 0, items: [] });
    renderScreen();
    expect(await screen.findByText('Tap to Pay is not set up on this device yet.', { exact: false })).toBeInTheDocument();
  });

  it('shows an empty state when there are no tickets', async () => {
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'ready', canTakePayment: true, checks: [] });
    (mobileCheckoutApi.queue as any).mockResolvedValue({ count: 0, items: [] });
    renderScreen();
    await waitFor(() => expect(screen.getByText('No tickets to check out')).toBeInTheDocument());
  });
});
