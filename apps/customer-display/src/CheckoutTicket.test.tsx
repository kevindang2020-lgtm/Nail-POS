// CheckoutTicket.test.tsx — 23-inch spec §30–§33, §91–§95: the display renders the server's customer-safe checkout and
// nothing else — the spec's own §33 example, the original-vs-charged price, every adjustment, the labelled card fee,
// payments received with the balance due, and TOTAL DUE as the strongest element. It computes no money: the amounts on
// screen are exactly the projection's, even when they would not "add up" (the server is the authority).
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { CustomerDisplayCheckout } from '@aipowersalon/api-contracts/customer';
import { CheckoutTicket } from './CheckoutTicket';

const example: CustomerDisplayCheckout = {
  ticketNumber: '#12', date: '2026-10-06T15:00:00.000Z',
  lines: [
    { kind: 'service', name: 'Gel Manicure', technicianName: 'Olivia', quantity: 1, amountCents: 4500 },
    { kind: 'service', name: 'Spa Pedicure', technicianName: 'Lisa', quantity: 1, amountCents: 6000 },
    { kind: 'add_on', name: 'French Tip', technicianName: 'Olivia', quantity: 1, amountCents: 1000 },
    { kind: 'product', name: 'Cuticle Oil', quantity: 1, amountCents: 1200 },
  ],
  adjustments: [{ kind: 'membership', label: 'VIP Membership', amountCents: 1000 }, { kind: 'loyalty', label: 'Loyalty Reward', amountCents: 500 }],
  itemsSubtotalCents: 12700, discountCents: 1500, taxCents: 868, customerFeeCents: 0, tipCents: 2172, giftCardSaleCents: 0,
  totalCents: 14240, paidCents: 0, balanceDueCents: 14240, payments: [], paymentStatus: 'unpaid', paymentMethod: 'cash',
};
const rowOf = (label: string) => screen.getByText(label).closest('.ck-row, .ck-due') as HTMLElement;

describe('the §33 example ticket', () => {
  it('greets the customer and lists each line with its technician; the add-on and the product read as such', () => {
    render(<CheckoutTicket c={example} firstName="Sophia" />);
    expect(screen.getByText('Hi Sophia,')).toBeInTheDocument();
    expect(screen.getByText('Please review your services and payment details.')).toBeInTheDocument();
    const lines = within(screen.getByRole('list', { name: 'Completed services' })).getAllByRole('listitem');
    expect(lines.map((l) => l.textContent)).toEqual([
      'Gel Manicurewith Olivia$45.00', 'Spa Pedicurewith Lisa$60.00', '+ French Tipwith Olivia$10.00', 'Cuticle Oil ×1$12.00',
    ]);
  });
  it('Subtotal, both benefits as savings, Tax, Tip and TOTAL DUE $142.40', () => {
    render(<CheckoutTicket c={example} firstName="Sophia" />);
    expect(within(rowOf('Subtotal')).getByText('$127.00')).toBeInTheDocument();
    expect(within(rowOf('VIP Membership')).getByText('−$10.00')).toBeInTheDocument();
    expect(within(rowOf('Loyalty Reward')).getByText('−$5.00')).toBeInTheDocument();
    expect(within(rowOf('Tax')).getByText('$8.68')).toBeInTheDocument();
    expect(within(rowOf('Tip')).getByText('$21.72')).toBeInTheDocument();
    expect(within(rowOf('Total due')).getByText('$142.40')).toBeInTheDocument();
    expect(screen.queryByText(/surcharge/i)).toBeNull();   // no fee row when none applies (§130 "only when applicable")
  });
});

describe('lines, fees and payments', () => {
  it('a line charged below its catalog price shows the original struck through', () => {
    render(<CheckoutTicket c={{ ...example, lines: [{ kind: 'service', name: 'Gel Manicure', technicianName: 'Olivia', quantity: 1, amountCents: 4000, originalCents: 4500 }] }} />);
    expect(screen.getByLabelText('was $45.00').tagName).toBe('S');
    expect(screen.getByText('$40.00')).toBeInTheDocument();
  });
  it('the card fee appears with the salon\'s own label, only when the projection carries one', () => {
    render(<CheckoutTicket c={{ ...example, customerFeeCents: 427, customerFeeLabel: 'Card Surcharge', totalCents: 14667 }} />);
    expect(within(rowOf('Card Surcharge')).getByText('$4.27')).toBeInTheDocument();
    expect(within(rowOf('Total due')).getByText('$146.67')).toBeInTheDocument();
  });
  it('a gift card that paid part: the payment is listed and the strongest number becomes the BALANCE due', () => {
    render(<CheckoutTicket c={{ ...example, paidCents: 4000, balanceDueCents: 10240, paymentStatus: 'partially_paid', payments: [{ method: 'gift_card', label: 'Gift card', amountCents: 4000 }] }} />);
    expect(within(rowOf('Paid · Gift card')).getByText('−$40.00')).toBeInTheDocument();
    expect(within(rowOf('Balance due')).getByText('$102.40')).toBeInTheDocument();
    expect(screen.queryByText('Total due')).toBeNull();
  });
  it('the display shows the server\'s numbers verbatim — it never recomputes a total', () => {
    render(<CheckoutTicket c={{ ...example, totalCents: 99999, balanceDueCents: 99999 }} />);
    expect(within(rowOf('Total due')).getByText('$999.99')).toBeInTheDocument();
  });
});
