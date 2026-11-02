import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PayNavProvider } from '../shell/nav';
import { SuccessScreen } from './SuccessScreen';

vi.mock('../api/mobileCheckoutApi', () => ({ mobileCheckoutApi: { ticket: vi.fn(), sendReceipt: vi.fn() } }));
vi.mock('../lib/useCheckoutStream', () => ({ checkoutRealtime: { onEvent: () => () => {} }, useCheckoutStream: () => {} }));
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';

const detail = {
  ticketId: 'tk1', status: 'ready',
  customer: { fullName: 'Jordan Lee', initials: 'JL', phoneMasked: '•••• 1234', emailMasked: 'j•••@mail.com' },
  services: [], totals: { subtotalCents: 3000, discountCents: 0, tipCents: 0, taxCents: 233, surchargeCents: 0, totalDueCents: 3233 },
  receiptDeliveryOptions: { sms: true, email: true, app: true, print: true },
};

const renderScreen = () => render(<PayNavProvider><SuccessScreen ticketId="tk1" amountCents={3233} /></PayNavProvider>);

describe('SuccessScreen — Receipt & Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mobileCheckoutApi.ticket as any).mockResolvedValue(detail);
  });

  it('shows the completed amount and receipt delivery options from the ticket', async () => {
    renderScreen();
    expect(screen.getByText('Payment Successful')).toBeInTheDocument();
    expect(await screen.findByText('•••• 1234')).toBeInTheDocument();
    expect(screen.getByText('j•••@mail.com')).toBeInTheDocument();
  });

  it('sends a receipt and confirms when the channel is configured', async () => {
    (mobileCheckoutApi.sendReceipt as any).mockResolvedValue({ channel: 'sms', configured: true, delivery: 'sent', receiptNumber: 'R1' });
    renderScreen();
    fireEvent.click(await screen.findByText('Text message'));
    expect(await screen.findByText('Receipt sent', { exact: false })).toBeInTheDocument();
    expect(mobileCheckoutApi.sendReceipt).toHaveBeenCalledWith('tk1', 'sms');
  });

  it('shows the honest disabledReason when a channel is not configured (no fake send)', async () => {
    (mobileCheckoutApi.sendReceipt as any).mockResolvedValue({ channel: 'email', configured: false, disabledReason: 'Email receipts are not configured yet.' });
    renderScreen();
    fireEvent.click(await screen.findByText('Email'));
    expect(await screen.findByText('Email receipts are not configured yet.')).toBeInTheDocument();
  });

  it('§80: shows the card as brand + last 4 only and the payment reference, never more', async () => {
    render(<PayNavProvider><SuccessScreen ticketId="tk1" amountCents={3233} cardBrand="visa" cardLast4="4242" paymentId="abcdef12-3456" /></PayNavProvider>);
    expect(screen.getByText('Visa •••• 4242')).toBeInTheDocument();
    expect(screen.getByText('ABCDEF12')).toBeInTheDocument();
  });

  it('§102: a queued receipt says so honestly (async delivery)', async () => {
    (mobileCheckoutApi.sendReceipt as any).mockResolvedValue({ channel: 'sms', configured: true, delivery: 'queued' });
    renderScreen();
    fireEvent.click(await screen.findByText('Text message'));
    expect(await screen.findByText(/Receipt queued/)).toBeInTheDocument();
  });

  it('§61: in handoff mode Done goes through Return to Staff (no Save-to-profile for the customer)', async () => {
    render(<PayNavProvider><SuccessScreen ticketId="tk1" amountCents={3233} handoff /></PayNavProvider>);
    expect(screen.queryByText('Save to customer profile')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('No receipt · Return to Staff'));
    expect(await screen.findByRole('dialog', { name: 'Return to Staff' })).toBeInTheDocument();
  });
});
