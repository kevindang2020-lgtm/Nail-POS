// a11y.test — §220 (Oct 21 2026): axe-core over the customer app's key screens as a guest sees them. Every violation
// fails with the rule and the node, so a missing label or an unnamed button never ships.
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@aipowersalon/testing/a11y';
vi.mock('../api/customerApi', () => ({ customerApi: { paymentTokenizer: vi.fn().mockResolvedValue({ available: false }), payBookingDeposit: vi.fn(), bookingDeposit: vi.fn() } }));
import { BookingDepositCard } from './BookingDepositCard';

describe('accessibility (axe)', () => {
  it('the booking deposit card', async () => {
    const { container } = render(<BookingDepositCard appointmentId="a1" initial={{ depositId: 'd1', appointmentId: 'a1', status: 'pending', amountCents: 2500, cardLast4: null, refundableUntil: '2026-11-04T15:00:00.000Z', forfeitOnNoShow: true, appliedCents: null, refundedCents: null, endedReason: null, failureReason: null }} />);
    await screen.findByTestId('booking-deposit-in-person');
    await expectNoA11yViolations(container);
  });
});
