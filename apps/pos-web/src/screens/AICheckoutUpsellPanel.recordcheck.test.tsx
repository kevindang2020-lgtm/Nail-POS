// AICheckoutUpsellPanel.recordcheck.test.tsx — Checkout Upsell 09: a service asked for but not on the ticket is shown as a
// RECORD CHECK, apart from the suggestions, with no price and no Add button; it still shows while payment is in progress.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

let payload: any = null;
vi.mock('../api/posAiCheckoutUpsellApi', () => ({ posAiCheckoutUpsellApi: {
  recommendations: vi.fn(async () => payload), addAddon: vi.fn(), dismiss: vi.fn(),
} }));
import { AICheckoutUpsellPanel } from './AICheckoutUpsellPanel';

const CHECKS = [{ kind: 'requested_not_on_ticket', serviceId: 'art', serviceName: 'Nail Art', nextStep: 'confirm_with_technician' }];
beforeEach(() => { payload = null; });

describe('AI upsell panel — record checks (Checkout Upsell 09)', () => {
  it('shows the record check apart from suggestions: no price, no Add button', async () => {
    payload = { enabled: true, frozen: false, recordChecks: CHECKS, cards: [{ type: 'service_addon', targetId: 'chrome', title: 'Chrome', priceCents: 1000, eligible: true, reason: 'Approved add-on', confidence: 'high' }] };
    render(<AICheckoutUpsellPanel checkoutId="c1" />);
    const box = await screen.findByTestId('ucx-record-checks');
    expect(within(box).getByText('Record check — not a sale')).toBeInTheDocument();
    expect(within(box).getByText('Nail Art — ask the technician whether it was done')).toBeInTheDocument();
    expect(within(box).queryByRole('button')).toBeNull();
    expect(within(box).queryByText(/\$/)).toBeNull();
    expect(screen.getByRole('button', { name: /^Add: Chrome/ })).toBeInTheDocument();   // the sale list is separate
  });
  it('still shows while payment is in progress, and when there are no suggestions', async () => {
    payload = { enabled: true, frozen: true, freezeReason: 'PAYMENT_IN_PROGRESS', recordChecks: CHECKS, cards: [] };
    const { unmount } = render(<AICheckoutUpsellPanel checkoutId="c1" />);
    expect(await screen.findByTestId('ucx-record-checks')).toBeInTheDocument();
    unmount();
    payload = { enabled: true, frozen: false, recordChecks: CHECKS, cards: [] };
    render(<AICheckoutUpsellPanel checkoutId="c2" />);
    expect(await screen.findByTestId('ucx-record-checks')).toBeInTheDocument();
  });
  it('nothing to check (or an older server without the field) shows no record-check box', async () => {
    payload = { enabled: true, frozen: false, cards: [] };
    render(<AICheckoutUpsellPanel checkoutId="c3" />);
    expect(await screen.findByText(/No suggestions/i)).toBeInTheDocument();
    expect(screen.queryByTestId('ucx-record-checks')).toBeNull();
  });
});
