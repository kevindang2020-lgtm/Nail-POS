import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PayNavProvider } from '../shell/nav';
import { SuccessScreen } from './SuccessScreen';

vi.mock('../api/mobileCheckoutApi', () => ({ mobileCheckoutApi: { ticket: vi.fn(), sendReceipt: vi.fn() } }));
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';

const detail = {
  ticketId: 'tk1', status: 'ready',
  customer: { name: 'Jordan Lee', phoneLast4: '1234', emailMasked: 'j•••@mail.com' },
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
    expect(screen.getByText('Payment complete')).toBeInTheDocument();
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
});
