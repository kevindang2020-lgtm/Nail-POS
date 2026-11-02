// wave 4 UI sweep: with no ticket selected, the Checkout quick actions (Take Payment, Apply Discount, Split Ticket,
// Send Receipt, View Signature, View Summary) did nothing at all — no message, no request.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSCheckoutScreen } from './POSCheckoutScreen';

const checkoutState = {
  kpisFull: { ticketsReadyForPayment: 0, subtotalCents: 0, tipsTodayCents: 0, cardSurchargeCollectedCents: 0, taxCollectedCents: 0, paidTicketsToday: 0, failedPaymentsToday: 0, customerDisplayActiveSessions: 0, receiptDeliveryRatePercent: 0, averageCheckoutSeconds: 0, giftCardLoyaltyRedemptionsCents: 0, upsellCapturePercent: 0 },
  tickets: { items: [], pagination: { totalItems: 0 } },
  paymentSettings: { cardEnabled: true, cashEnabled: true, giftCardEnabled: true, splitPaymentEnabled: true, cardSurchargeEnabled: false, cardSurchargePercent: 0, taxRatePercent: 7, tipsEnabled: true, defaultTipPercents: [15, 18, 20], allowCustomTip: true, allowNoTip: true, customerDisplayMode: 'review_only', fiservStatus: 'sandbox' },
  customerDisplay: { pairedDevices: [], activeSession: null },
};
const mockFetch = (state: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => state, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('Checkout quick actions without a selected ticket', () => {
  it('a ticket quick action with no ticket selected says so (wave 4: Take Payment, Apply Discount … did nothing)', async () => {
    globalThis.fetch = mockFetch(checkoutState) as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('No guests ready for checkout.');
    for (const l of ['Take Payment', 'Apply Discount', 'Send Receipt']) {
      const b = screen.getAllByText(l).map((x) => x.closest('button')).find(Boolean)!;
      fireEvent.click(b);
      expect(screen.getByText('Select a ticket first.')).toBeInTheDocument();
    }
  });
});
