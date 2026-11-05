import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const detail = vi.fn();
vi.mock('../api/posCheckoutApi', () => ({ posCheckoutApi: { detail: (...a: any[]) => detail(...a), technicianSplit: () => Promise.resolve({ participantCount: 0, technicians: [] }) } }));

import { CheckoutTicketInner } from './CheckoutTicketInner';

const ticket = {
  ticketId: 't1', ticketNumber: '1042',
  customer: { fullName: 'Grace Kim', isVip: true, phone: '(555) 111-2222', loyaltyTier: 'Gold' },
  completedServices: [{ serviceLineId: 'l1', serviceName: 'Gel Manicure', technicianName: 'Mia', priceCents: 4500 }],
  promotion: { code: 'SAVE10', amountCents: 500 },
  technicians: { primary: { name: 'Mia Johnson' }, helpers: [] },
  totals: { subtotalCents: 4500, taxCents: 300, tipCents: 900, surchargeCents: 0, totalDueCents: 5200, paymentMethod: 'card' },
  receiptDeliveryOptions: { sms: true, email: false, app: true, print: true },
  serviceNotes: 'Handle with care',
};

beforeEach(() => { detail.mockReset(); detail.mockResolvedValue(ticket); });

describe('CheckoutTicketInner (iPad checkout view — real data)', () => {
  it('loads the real ticket: customer, services, money breakdown, discount, payment and receipt', async () => {
    render(<CheckoutTicketInner ticketId="t1" />);
    await waitFor(() => expect(screen.getByText('Grace Kim')).toBeTruthy());
    expect(detail).toHaveBeenCalledWith('t1');
    expect(screen.getByText('Gel Manicure')).toBeTruthy();
    expect(screen.getByText('Total Due')).toBeTruthy();
    expect(screen.getByText('$52.00')).toBeTruthy();               // total due
    expect(screen.getByText(/SAVE10/)).toBeTruthy();               // discount
    expect(screen.getByText('Card')).toBeTruthy();                 // payment method
    expect(screen.getByText('SMS ✓')).toBeTruthy();                // receipt channel
    expect(screen.getByText(/Handle with care/)).toBeTruthy();     // service notes
  });

  it('renders an error state when the ticket fails to load', async () => {
    detail.mockRejectedValueOnce(new Error('nope'));
    render(<CheckoutTicketInner ticketId="t1" />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
