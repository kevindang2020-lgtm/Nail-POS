// AICheckoutUpsellPanel.schedule.test.tsx — Decision 27: when the server refuses an add-on because it would run into
// the technician's next appointment, the panel says exactly that (not a generic failure).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const addAddon = vi.fn(async () => { throw new Error('ADDON_SCHEDULE_CONFLICT'); });
vi.mock('../api/posAiCheckoutUpsellApi', () => ({ posAiCheckoutUpsellApi: {
  recommendations: vi.fn(async () => ({ enabled: true, frozen: false, cards: [{ type: 'service_addon', targetId: 'spa', title: 'Paraffin Spa', priceCents: 1500, eligible: true, reason: 'Approved add-on', confidence: 'high' }] })),
  addAddon: (...a: any[]) => (addAddon as any)(...a), dismiss: vi.fn(),
} }));
import { AICheckoutUpsellPanel } from './AICheckoutUpsellPanel';

describe('AI upsell panel — schedule conflict', () => {
  it("shows that the add-on would run into the technician's next appointment", async () => {
    render(<AICheckoutUpsellPanel checkoutId="c1" />);
    fireEvent.click(await screen.findByRole('button', { name: /^Add: Paraffin Spa/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Confirm Paraffin Spa/ }));
    expect(await screen.findByText("That add-on would run into the technician's next appointment — not added.")).toBeInTheDocument();
    expect(addAddon).toHaveBeenCalledWith('c1', 'spa');
  });
});
